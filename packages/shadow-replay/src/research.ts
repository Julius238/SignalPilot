/**
 * Point-in-time research inputs, derived exactly the way the live research
 * worker derives them (apps/worker/src/jobs/analyzeCryptoSignals.ts and
 * calculateMarketRegime.ts), but only from candles that had closed at the
 * cycle's pipeline time. Nothing here looks at a later candle.
 */

import { buildIndicatorSnapshot } from "@signalpilot/indicators";
import {
  buildSignalRegimeContext,
  calculateMarketRegimeReport,
  type MarketRegime,
  type MarketRegimeReport,
  type RiskMode
} from "@signalpilot/market-regime";
import { calculateMultiTimeframeSummary, type MultiTimeframeSignalInput } from "@signalpilot/multi-timeframe";
import { scoreSignal } from "@signalpilot/scoring-engine";
import { applySignalRules } from "@signalpilot/signal-rules";

import type { RegimePolicy, ReplayCandle, ReplaySeries, ReplayTimeframe } from "./contracts.js";

/** Same window and minimum as the live signal job. */
export const SIGNAL_CANDLE_LIMIT = 250;
export const SIGNAL_MINIMUM_CANDLES = 20;
/** Same cap as the live default (`SIGNAL_RULES_MAX_DELTA`). */
export const SIGNAL_RULES_MAX_DELTA = 15;
/** The live regime job reads the last 220 daily candles per benchmark. */
export const REGIME_CANDLE_LIMIT = 220;

export const TIMEFRAME_MS: Readonly<Record<ReplayTimeframe, number>> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

export interface DerivedSignal {
  readonly timeframe: ReplayTimeframe;
  readonly signalType: string;
  readonly status: string;
  readonly direction: string;
  readonly score: number;
  readonly riskLevel: string;
  readonly riskScore: number;
  readonly createdAtMs: number;
}

/**
 * Index of the last candle with `closeTime <= atMs` (candles ascending), or -1.
 * Binary search: called for every cycle and timeframe.
 */
export function lastClosedIndex(candles: readonly ReplayCandle[], atMs: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (candles[mid].closeTime <= atMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * One timeframe's signal as the live job would persist it: base scoring,
 * then the explainable rule adjustments. Persisted fields carry the adjusted
 * values (`status = finalStatus`, `score = adjustedScore`,
 * `riskLevel = finalRiskLevel`).
 */
export function deriveSignal(input: {
  readonly symbol: string;
  readonly timeframe: ReplayTimeframe;
  readonly window: readonly ReplayCandle[];
  readonly regime: MarketRegimeReport | null;
  readonly otherSignals: readonly MultiTimeframeSignalInput[];
  readonly createdAtMs: number;
}): DerivedSignal | null {
  const indicators = buildIndicatorSnapshot(
    input.window.map((candle) => ({
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    }))
  );
  if (indicators.candleCount < SIGNAL_MINIMUM_CANDLES) return null;

  const decision = scoreSignal({
    asset: { symbol: input.symbol, assetType: "crypto" },
    timeframe: input.timeframe,
    indicators
  });

  const current: MultiTimeframeSignalInput = {
    symbol: decision.symbol,
    timeframe: decision.timeframe,
    status: decision.status,
    direction: decision.direction,
    signalType: decision.signalType,
    score: decision.score,
    riskLevel: decision.riskLevel,
    riskScore: decision.riskScore,
    createdAt: new Date(input.createdAtMs)
  } as MultiTimeframeSignalInput;
  const multiTimeframeSummary = calculateMultiTimeframeSummary([...input.otherSignals, current]);

  const marketRegimeContext =
    input.regime === null
      ? null
      : buildSignalRegimeContext({
          symbol: input.symbol,
          assetType: "crypto",
          signalDirection: decision.direction,
          signalStatus: decision.status,
          report: input.regime
        });

  const rules = applySignalRules({
    asset: { symbol: input.symbol, assetType: "crypto" },
    signalDecision: decision,
    multiTimeframeSummary,
    marketRegimeContext,
    // The live job feeds paper-evaluation statistics from the database. They
    // describe a different (paper) process and are not reconstructible
    // point-in-time, so the replay leaves them out.
    performanceReport: null,
    dataQuality: {
      qualityScore: indicators.candleCount >= 200 ? 80 : 55,
      hasMinimumCandles: indicators.candleCount >= 200,
      missingMarketRegimeContext: marketRegimeContext === null
    },
    maxDelta: SIGNAL_RULES_MAX_DELTA
  });

  return {
    timeframe: input.timeframe,
    signalType: decision.signalType,
    status: rules.finalStatus,
    direction: decision.direction,
    score: rules.adjustedScore,
    riskLevel: rules.finalRiskLevel,
    riskScore: decision.riskScore,
    createdAtMs: input.createdAtMs
  };
}

export function toMultiTimeframeInput(symbol: string, signal: DerivedSignal): MultiTimeframeSignalInput {
  return {
    symbol,
    timeframe: signal.timeframe,
    status: signal.status,
    direction: signal.direction,
    signalType: signal.signalType,
    score: signal.score,
    riskLevel: signal.riskLevel,
    riskScore: signal.riskScore,
    createdAt: new Date(signal.createdAtMs)
  } as MultiTimeframeSignalInput;
}

const CRYPTO_BENCHMARKS = ["BTCUSDT", "ETHUSDT"];
const EQUITY_BENCHMARKS = ["SPY", "QQQ", "IWM"];
const CONTINUOUS_MAX_AGE_MS = 48 * 60 * 60 * 1000 + 15 * 60 * 1000;
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * The regime report the live job would have written at `generatedAtMs`:
 * last 220 closed daily candles per benchmark, stale benchmarks dropped.
 */
export function deriveRegime(
  series: readonly ReplaySeries[],
  generatedAtMs: number,
  policy: RegimePolicy
): MarketRegimeReport {
  const wanted = policy === "CRYPTO_ONLY" ? CRYPTO_BENCHMARKS : [...EQUITY_BENCHMARKS, ...CRYPTO_BENCHMARKS];
  const benchmarks = series.flatMap((entry) => {
    if (!wanted.includes(entry.symbol)) return [];
    const daily = entry.candles["1d"] ?? [];
    const last = lastClosedIndex(daily, generatedAtMs);
    if (last < 0) return [];
    const window = daily.slice(Math.max(0, last + 1 - REGIME_CANDLE_LIMIT), last + 1);
    const maxAge = entry.assetType === "CRYPTO" ? CONTINUOUS_MAX_AGE_MS : SESSION_MAX_AGE_MS;
    if (window.length < 20 || generatedAtMs - window[window.length - 1].closeTime > maxAge) return [];
    return [
      {
        symbol: entry.symbol,
        assetType: entry.assetType,
        timeframe: "1d",
        candles: window.map((candle) => ({ close: candle.close, high: candle.high, low: candle.low }))
      }
    ];
  });

  const report = calculateMarketRegimeReport({ benchmarks, generatedAt: new Date(generatedAtMs) });
  return policy === "CRYPTO_ONLY" ? normaliseToCrypto(report) : report;
}

/**
 * Research assumption for data sets without equity benchmarks: the crypto
 * regime stands for the whole market, and confidence counts coverage against
 * the two crypto benchmarks only. Same weights as the production formula.
 */
function normaliseToCrypto(report: MarketRegimeReport): MarketRegimeReport {
  const crypto = report.cryptoRegime;
  const covered = report.benchmarkSummaries.filter(
    (summary) => CRYPTO_BENCHMARKS.includes(summary.symbol) && summary.trendDirection !== "UNKNOWN"
  ).length;
  const agreement = crypto !== "UNKNOWN" && crypto !== "MIXED" ? 12.5 : 0;
  const mixedPenalty = crypto === "MIXED" ? 8 : 0;
  const confidence = Math.round(Math.min(100, Math.max(0, (covered / CRYPTO_BENCHMARKS.length) * 65 + agreement - mixedPenalty)));
  return {
    ...report,
    overallRegime: crypto,
    riskMode: riskModeFor(crypto, confidence),
    confidence,
    summary: `${report.summary} [Replay-Annahme: nur Krypto-Benchmarks]`
  };
}

function riskModeFor(regime: MarketRegime, confidence: number): RiskMode {
  if (regime === "UNKNOWN") return "UNKNOWN";
  if (regime === "RISK_OFF") return "HIGH_RISK";
  if (regime === "RISK_ON" && confidence >= 75) return "AGGRESSIVE";
  if (regime === "MIXED") return "DEFENSIVE";
  return "NORMAL";
}

export interface DerivedDataQuality {
  readonly candleCount: number;
  readonly expectedCandleCount: number;
  readonly gapCount: number;
  readonly missingCandleCount: number;
  readonly latestClosedCandle: number | null;
}

/**
 * Gap audit over the whole stored history up to `atMs`, like the live
 * `refreshCandleDataQuality`. `gapEnds` holds, ascending, the close time of
 * every candle that follows a gap — precomputed once per series.
 */
export function deriveDataQuality(
  candles: readonly ReplayCandle[],
  gapEnds: readonly number[],
  timeframe: ReplayTimeframe,
  atMs: number
): DerivedDataQuality {
  const last = lastClosedIndex(candles, atMs);
  if (last < 0) {
    return { candleCount: 0, expectedCandleCount: 0, gapCount: 0, missingCandleCount: 0, latestClosedCandle: null };
  }
  const candleCount = last + 1;
  const span = candles[last].openTime - candles[0].openTime;
  const expectedCandleCount = Math.floor(span / TIMEFRAME_MS[timeframe]) + 1;
  let gapCount = 0;
  for (const end of gapEnds) {
    if (end > atMs) break;
    gapCount += 1;
  }
  return {
    candleCount,
    expectedCandleCount,
    gapCount,
    missingCandleCount: Math.max(0, expectedCandleCount - candleCount),
    latestClosedCandle: candles[last].closeTime
  };
}

export function findGapEnds(candles: readonly ReplayCandle[], timeframe: ReplayTimeframe): number[] {
  const step = TIMEFRAME_MS[timeframe];
  const ends: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].openTime - candles[index - 1].openTime !== step) ends.push(candles[index].closeTime);
  }
  return ends;
}
