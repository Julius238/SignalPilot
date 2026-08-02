/**
 * Deterministic snapshot builder for the strategy tests.
 *
 * Every value is fixed: no clock, no randomness, no environment. Two calls with
 * the same overrides produce byte-identical snapshots, which is what the golden
 * and determinism tests rely on (docs/trading/12-test-and-acceptance-plan.md,
 * "gleicher Snapshot -> gleicher Hash/Output").
 */

import {
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  STRATEGY_INPUT_SNAPSHOT_VERSION,
  TIMEFRAME_INTERVAL_MS,
  type SnapshotCandleV1,
  type SnapshotDataQualityV1,
  type SnapshotSignalV1,
  type StrategyInputSnapshotV1,
  type StrategyTimeframe
} from "../../src/index.js";

export const AS_OF = "2026-08-02T09:05:00.000Z";

/** Anchor close times, all inside the pinned freshness limits relative to AS_OF. */
export const ANCHOR_CLOSE = {
  "1h": "2026-08-02T08:59:59.999Z",
  "4h": "2026-08-02T07:59:59.999Z",
  "1d": "2026-08-01T23:59:59.999Z"
} as const;

const CANDLE_COUNT = 250;

const iso = (epochMs: number): string => new Date(epochMs).toISOString();

/** Fixed-scale decimal string so the snapshot never carries a JS float. */
const money = (value: number): string => (Math.round(value * 1e6) / 1e6).toFixed(6);

/**
 * Sawtooth uptrend: a steady drift plus a repeating wave, so RSI(14) lands
 * inside `[50, 72]` instead of the 100 a monotone series would produce.
 */
const WAVE = [0, 1, -1, 2, -2, 1] as const;

function closeAt(index: number, base: number, drift: number, waveAmplitude: number): number {
  return base + index * drift + WAVE[index % WAVE.length] * waveAmplitude;
}

export interface SeriesShape {
  readonly base: number;
  readonly drift: number;
  readonly waveAmplitude: number;
  readonly halfRange: number;
  readonly volume: number;
  /** Extra move of the anchor candle on top of the previous close. */
  readonly anchorMove: number;
  /** Volume of the anchor candle. */
  readonly anchorVolume: number;
}

export const BTC_1H_SHAPE: SeriesShape = {
  base: 20000,
  drift: 15,
  waveAmplitude: 40,
  halfRange: 110,
  volume: 100,
  anchorMove: 420,
  anchorVolume: 320
};

export const BTC_4H_SHAPE: SeriesShape = {
  base: 15000,
  drift: 40,
  waveAmplitude: 60,
  halfRange: 200,
  volume: 400,
  anchorMove: 120,
  anchorVolume: 500
};

export const BTC_1D_SHAPE: SeriesShape = {
  base: 8000,
  drift: 70,
  waveAmplitude: 90,
  halfRange: 400,
  volume: 2000,
  anchorMove: 200,
  anchorVolume: 2400
};

export function buildCandles(
  timeframe: StrategyTimeframe,
  shape: SeriesShape,
  options: { readonly idPrefix: string; readonly count?: number; readonly anchorCloseTime?: string } = {
    idPrefix: "c"
  }
): SnapshotCandleV1[] {
  const count = options.count ?? CANDLE_COUNT;
  const interval = TIMEFRAME_INTERVAL_MS[timeframe];
  const anchorCloseMs = Date.parse(options.anchorCloseTime ?? ANCHOR_CLOSE[timeframe]);
  // Binance close times are `openTime + interval - 1 ms`; keep that convention.
  const anchorOpenMs = anchorCloseMs + 1 - interval;

  const closes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    closes.push(closeAt(index, shape.base, shape.drift, shape.waveAmplitude));
  }
  closes[count - 1] = closes[count - 2] + shape.anchorMove;

  return closes.map((close, index) => {
    const openMs = anchorOpenMs - (count - 1 - index) * interval;
    const open = index === 0 ? close - shape.drift : closes[index - 1];
    const isAnchor = index === count - 1;
    return {
      id: `${options.idPrefix}-${timeframe}-${String(index).padStart(3, "0")}`,
      openTime: iso(openMs),
      closeTime: iso(openMs + interval - 1),
      open: money(open),
      high: money(Math.max(open, close) + shape.halfRange),
      low: money(Math.min(open, close) - shape.halfRange),
      close: money(close),
      volume: money(isAnchor ? shape.anchorVolume : shape.volume),
      source: "BINANCE"
    };
  });
}

export function buildDataQuality(
  timeframe: StrategyTimeframe,
  overrides: Partial<SnapshotDataQualityV1> = {}
): SnapshotDataQualityV1 {
  return {
    id: `dq-${timeframe}`,
    provider: "BINANCE",
    timeframe,
    observedAt: "2026-08-02T09:00:00.000Z",
    latestClosedCandle: ANCHOR_CLOSE[timeframe],
    candleCount: CANDLE_COUNT,
    expectedCandleCount: CANDLE_COUNT,
    gapCount: 0,
    missingCandleCount: 0,
    providerErrorCount: 0,
    rateLimitCount: 0,
    entitlementErrorCount: 0,
    noDataCount: 0,
    lastErrorKind: null,
    ...overrides
  };
}

const SIGNAL_CREATED_AT: Readonly<Record<StrategyTimeframe, string>> = {
  "1h": "2026-08-02T09:02:00.000Z",
  "4h": "2026-08-02T08:05:00.000Z",
  "1d": "2026-08-02T00:10:00.000Z"
};

export function buildSignal(
  timeframe: StrategyTimeframe,
  overrides: Partial<SnapshotSignalV1> = {}
): SnapshotSignalV1 {
  return {
    id: `signal-${timeframe}`,
    timeframe,
    signalType: "BREAKOUT",
    status: timeframe === "1h" ? "STRONG_WATCH" : "WATCH",
    direction: "BULLISH",
    riskLevel: "MEDIUM",
    baseScore: 74,
    adjustedScore: 78,
    adjustedScoreSource: "RULE_APPLICATION",
    adjustedStatus: timeframe === "1h" ? "STRONG_WATCH" : "WATCH",
    riskScore: 30,
    ruleApplicationId: `rule-${timeframe}`,
    outputId: `output-${timeframe}`,
    createdAt: SIGNAL_CREATED_AT[timeframe],
    ...overrides
  };
}

export interface SnapshotOverrides {
  readonly symbol?: string;
  readonly assetId?: string;
  readonly idPrefix?: string;
  readonly shapes?: Partial<Record<StrategyTimeframe, SeriesShape>>;
  readonly asOf?: string;
}

/** A snapshot that satisfies every pinned condition of `CRYPTO_MTF_BREAKOUT_V1`. */
export function buildPassingSnapshot(overrides: SnapshotOverrides = {}): StrategyInputSnapshotV1 {
  const symbol = overrides.symbol ?? "BTCUSDT";
  const assetId = overrides.assetId ?? "asset-btc";
  const idPrefix = overrides.idPrefix ?? symbol.toLowerCase();
  const shapes = {
    "1h": overrides.shapes?.["1h"] ?? BTC_1H_SHAPE,
    "4h": overrides.shapes?.["4h"] ?? BTC_4H_SHAPE,
    "1d": overrides.shapes?.["1d"] ?? BTC_1D_SHAPE
  } as const;

  return {
    snapshotVersion: STRATEGY_INPUT_SNAPSHOT_VERSION,
    asOf: overrides.asOf ?? AS_OF,
    asset: {
      id: assetId,
      symbol,
      assetType: "CRYPTO",
      exchange: "BINANCE",
      provider: "BINANCE",
      baseCurrency: symbol.replace("USDT", ""),
      quoteCurrency: "USDT",
      instrumentStatus: "ACTIVE",
      isActive: true,
      isTradable: true,
      isLeveraged: false,
      isInverse: false,
      isStablecoin: false
    },
    strategy: {
      strategyId: "strategy-1",
      strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
      strategyVersionId: "strategy-version-1",
      version: 1,
      status: "ACTIVE",
      engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
      codeVersion: "0000000000000000000000000000000000000000",
      specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
    },
    assignment: {
      id: `assignment-${idPrefix}`,
      portfolioId: "portfolio-shadow-1",
      timeframe: "1h",
      enabled: true,
      validFrom: "2026-07-01T00:00:00.000Z",
      validTo: null
    },
    series: {
      "1h": {
        timeframe: "1h",
        candles: buildCandles("1h", shapes["1h"], { idPrefix }),
        dataQuality: buildDataQuality("1h")
      },
      "4h": {
        timeframe: "4h",
        candles: buildCandles("4h", shapes["4h"], { idPrefix }),
        dataQuality: buildDataQuality("4h")
      },
      "1d": {
        timeframe: "1d",
        candles: buildCandles("1d", shapes["1d"], { idPrefix }),
        dataQuality: buildDataQuality("1d")
      }
    },
    signals: {
      "1h": buildSignal("1h"),
      "4h": buildSignal("4h"),
      "1d": buildSignal("1d")
    },
    multiTimeframe: {
      version: "multi-timeframe/1.0.0",
      alignment: "BULLISH_ALIGNED",
      alignmentScore: "0.780000000000",
      alignmentScoreRaw: 78,
      primaryTimeframe: "1d",
      confirmingTimeframes: ["4h", "1h"],
      conflictingTimeframes: [],
      riskLevel: "MEDIUM",
      sourceSignalIds: ["signal-1d", "signal-4h", "signal-1h"]
    },
    marketRegime: {
      id: "regime-1",
      generatedAt: "2026-08-02T09:00:00.000Z",
      equityRegime: "RISK_ON",
      cryptoRegime: "RISK_ON",
      overallRegime: "RISK_ON",
      riskMode: "NORMAL",
      confidence: 72
    },
    executionProfile: {
      id: `execution-profile-${idPrefix}`,
      version: 1,
      status: "ACTIVE",
      tickSize: "0.010000000000",
      stepSize: "0.000010000000",
      minQuantity: "0.000100000000",
      minNotional: "10.000000000000",
      feeBps: 10,
      fullSpreadBps: 6,
      slippageBps: 8,
      maxParticipationRate: "0.010000000000",
      source: "MANUAL_CONSERVATIVE",
      sourceObservedAt: "2026-08-01T00:00:00.000Z",
      specificationHash: "0".repeat(64)
    },
    contextEvents: [],
    policyVersions: {
      inputAssemblerVersion: "strategy-input-assembler-v1/1.0.0",
      indicatorVersion: "strategy-indicators-v1/1.0.0",
      multiTimeframeVersion: "multi-timeframe/1.0.0",
      breakoutPolicyVersion: "breakout-policy-v1/1.0.0",
      freshnessPolicyVersion: "freshness-policy-v1/1.0.0"
    }
  };
}

/** Recursively strips `readonly` so tests can mutate a cloned snapshot. */
export type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

/** Structured clone that keeps the snapshot plain-JSON and mutable. */
export function clone<T>(value: T): DeepMutable<T> {
  return JSON.parse(JSON.stringify(value)) as DeepMutable<T>;
}
