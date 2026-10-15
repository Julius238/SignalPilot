/**
 * Market-condition analysis of a research cycle (step 1 and 2 of the cycle).
 *
 * Works on the DISCOVERY window only: it describes how BTC and ETH behaved
 * per segment and attributes the closed trades of already tested strategies
 * to the market condition at their decision time — trend phase, position
 * against the 200-day average, volatility tercile, regime at entry and exit
 * type. The result tells the hypothesis step which conditions favoured or
 * hurt the existing strategies. Purely descriptive; no parameter is fitted.
 */

import { mean } from "./metrics.js";
import type { CompactTrade } from "./metrics.js";
import type { EvolutionDataSplit } from "./split.js";

export interface DailyBar {
  /** UTC day, YYYY-MM-DD. */
  readonly day: string;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export type TrendPhase = "BULL" | "BEAR" | "SIDEWAYS";
export type VolatilityTercile = "LOW" | "MID" | "HIGH";

export interface DayCondition {
  readonly day: string;
  readonly phase: TrendPhase;
  readonly aboveSma200: boolean | null;
  readonly volatility: VolatilityTercile | null;
}

export interface SegmentSummary {
  readonly symbol: string;
  readonly segment: string;
  readonly returnPct: number | null;
  readonly annualizedVolatilityPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly bullDaysPct: number;
  readonly bearDaysPct: number;
}

export interface ConditionBucket {
  readonly subject: string;
  readonly dimension: "PHASE" | "TREND_200D" | "VOLATILITY" | "REGIME_AT_ENTRY" | "EXIT_REASON" | "SYMBOL";
  readonly bucket: string;
  readonly trades: number;
  readonly averageR: number | null;
  readonly winRatePct: number | null;
  readonly netPnl: number;
}

export interface ConditionFinding {
  readonly subject: string;
  readonly dimension: ConditionBucket["dimension"];
  readonly favourable: { readonly bucket: string; readonly averageR: number; readonly trades: number } | null;
  readonly unfavourable: { readonly bucket: string; readonly averageR: number; readonly trades: number } | null;
  /** German one-liner. */
  readonly sentence: string;
}

export interface MarketAnalysis {
  readonly window: { readonly from: string; readonly to: string };
  readonly segments: readonly SegmentSummary[];
  readonly buckets: readonly ConditionBucket[];
  readonly findings: readonly ConditionFinding[];
}

/** Trend phase from the trailing 90-day return of the reference asset. */
export const PHASE_LOOKBACK_DAYS = 90;
export const PHASE_THRESHOLD = 0.2;
const VOL_LOOKBACK_DAYS = 30;
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Per-day conditions of a reference series (BTC). Uses only bars up to each
 * day, so a condition never depends on later prices. Volatility terciles are
 * cut at the tercile boundaries of the days inside `window` itself.
 */
export function classifyDays(bars: readonly DailyBar[], window: { readonly from: string; readonly to: string }): DayCondition[] {
  const sorted = [...bars].sort((a, b) => (a.day < b.day ? -1 : 1));
  const fromDay = window.from.slice(0, 10);
  const toDay = window.to.slice(0, 10);
  const vols: { day: string; vol: number | null }[] = [];
  const raw: { day: string; phase: TrendPhase; aboveSma200: boolean | null }[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const bar = sorted[index]!;
    if (bar.day < fromDay || bar.day > toDay) continue;
    const past = index >= PHASE_LOOKBACK_DAYS ? sorted[index - PHASE_LOOKBACK_DAYS]! : null;
    const change = past === null || past.close <= 0 ? 0 : bar.close / past.close - 1;
    const phase: TrendPhase = change > PHASE_THRESHOLD ? "BULL" : change < -PHASE_THRESHOLD ? "BEAR" : "SIDEWAYS";
    const sma = index >= 199 ? mean(sorted.slice(index - 199, index + 1).map((entry) => entry.close)) : null;
    let vol: number | null = null;
    if (index >= VOL_LOOKBACK_DAYS) {
      const returns: number[] = [];
      for (let offset = index - VOL_LOOKBACK_DAYS + 1; offset <= index; offset += 1) {
        const previous = sorted[offset - 1]!.close;
        if (previous > 0) returns.push(Math.log(sorted[offset]!.close / previous));
      }
      const average = mean(returns) ?? 0;
      vol = Math.sqrt(returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, returns.length - 1)) * Math.sqrt(365);
    }
    vols.push({ day: bar.day, vol });
    raw.push({ day: bar.day, phase, aboveSma200: sma === null ? null : bar.close > sma });
  }
  const known = vols.map((entry) => entry.vol).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const low = known.length === 0 ? null : known[Math.floor(known.length / 3)]!;
  const high = known.length === 0 ? null : known[Math.floor((2 * known.length) / 3)]!;
  return raw.map((entry, index) => {
    const vol = vols[index]!.vol;
    const volatility: VolatilityTercile | null =
      vol === null || low === null || high === null ? null : vol < low ? "LOW" : vol < high ? "MID" : "HIGH";
    return { day: entry.day, phase: entry.phase, aboveSma200: entry.aboveSma200, volatility };
  });
}

function summarizeSegment(symbol: string, segment: string, bars: readonly DailyBar[], conditions: ReadonlyMap<string, DayCondition>): SegmentSummary {
  if (bars.length < 2) return { symbol, segment, returnPct: null, annualizedVolatilityPct: null, maxDrawdownPct: null, bullDaysPct: 0, bearDaysPct: 0 };
  const returns: number[] = [];
  let peak = bars[0]!.close;
  let worst = 0;
  for (let index = 1; index < bars.length; index += 1) {
    returns.push(Math.log(bars[index]!.close / bars[index - 1]!.close));
    peak = Math.max(peak, bars[index]!.close);
    worst = Math.max(worst, (peak - bars[index]!.close) / peak);
  }
  const average = mean(returns) ?? 0;
  const sd = Math.sqrt(returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, returns.length - 1));
  const days = bars.map((bar) => conditions.get(bar.day)).filter((condition): condition is DayCondition => condition !== undefined);
  const share = (phase: TrendPhase) => (days.length === 0 ? 0 : round((days.filter((day) => day.phase === phase).length / days.length) * 100, 1));
  return {
    symbol,
    segment,
    returnPct: round((bars.at(-1)!.close / bars[0]!.close - 1) * 100, 2),
    annualizedVolatilityPct: round(sd * Math.sqrt(365) * 100, 2),
    maxDrawdownPct: round(worst * 100, 2),
    bullDaysPct: share("BULL"),
    bearDaysPct: share("BEAR")
  };
}

function bucketsOf(subject: string, trades: readonly CompactTrade[], conditions: ReadonlyMap<string, DayCondition>): ConditionBucket[] {
  const groups = new Map<string, { dimension: ConditionBucket["dimension"]; bucket: string; trades: CompactTrade[] }>();
  const add = (dimension: ConditionBucket["dimension"], bucket: string, trade: CompactTrade) => {
    const key = `${dimension}|${bucket}`;
    const group = groups.get(key) ?? { dimension, bucket, trades: [] };
    group.trades.push(trade);
    groups.set(key, group);
  };
  for (const trade of trades) {
    const condition = conditions.get(trade.anchorAt.slice(0, 10));
    if (condition !== undefined) {
      add("PHASE", condition.phase, trade);
      if (condition.aboveSma200 !== null) add("TREND_200D", condition.aboveSma200 ? "ABOVE" : "BELOW", trade);
      if (condition.volatility !== null) add("VOLATILITY", condition.volatility, trade);
    }
    add("REGIME_AT_ENTRY", trade.marketRegime ?? "UNKNOWN", trade);
    add("EXIT_REASON", trade.exitReason, trade);
    add("SYMBOL", trade.symbol, trade);
  }
  return [...groups.values()]
    .map((group) => {
      const rs = group.trades.map((trade) => trade.rMultiple).filter((value): value is number => value !== null);
      const average = mean(rs);
      return {
        subject,
        dimension: group.dimension,
        bucket: group.bucket,
        trades: group.trades.length,
        averageR: average === null ? null : round(average),
        winRatePct: round((group.trades.filter((trade) => trade.netPnl > 0).length / group.trades.length) * 100, 1),
        netPnl: round(group.trades.reduce((sum, trade) => sum + trade.netPnl, 0), 2)
      };
    })
    .sort((a, b) => (a.dimension === b.dimension ? a.bucket.localeCompare(b.bucket) : a.dimension.localeCompare(b.dimension)));
}

const DIMENSION_LABEL: Record<ConditionBucket["dimension"], string> = {
  PHASE: "Trendphase",
  TREND_200D: "Lage zum 200-Tage-Schnitt",
  VOLATILITY: "Volatilität",
  REGIME_AT_ENTRY: "Regime beim Einstieg",
  EXIT_REASON: "Ausstiegsart",
  SYMBOL: "Markt"
};

/** Best and worst bucket per dimension (≥ `minTrades` trades each). */
export function conditionFindings(buckets: readonly ConditionBucket[], minTrades = 5): ConditionFinding[] {
  const findings: ConditionFinding[] = [];
  const keys = [...new Set(buckets.map((bucket) => `${bucket.subject}|${bucket.dimension}`))];
  for (const key of keys) {
    const [subject, dimension] = key.split("|") as [string, ConditionBucket["dimension"]];
    if (dimension === "EXIT_REASON") continue;
    const eligible = buckets.filter(
      (bucket) => bucket.subject === subject && bucket.dimension === dimension && bucket.trades >= minTrades && bucket.averageR !== null
    );
    if (eligible.length < 2) continue;
    const sorted = [...eligible].sort((a, b) => b.averageR! - a.averageR!);
    const best = sorted[0]!;
    const worst = sorted.at(-1)!;
    if (best.averageR! - worst.averageR! < 0.15) continue;
    findings.push({
      subject,
      dimension,
      favourable: { bucket: best.bucket, averageR: best.averageR!, trades: best.trades },
      unfavourable: { bucket: worst.bucket, averageR: worst.averageR!, trades: worst.trades },
      sentence: `${subject}: ${DIMENSION_LABEL[dimension]} ${best.bucket} begünstigt (Ø ${best.averageR!.toFixed(2)}R, ${best.trades} Trades), ${worst.bucket} benachteiligt (Ø ${worst.averageR!.toFixed(2)}R, ${worst.trades} Trades).`
    });
  }
  return findings;
}

/**
 * Full analysis. `bars` must not contain days after the DISCOVERY window —
 * the function throws instead of silently analysing validation or later data.
 */
export function analyzeMarketConditions(input: {
  readonly split: EvolutionDataSplit;
  readonly referenceSymbol: string;
  readonly bars: Readonly<Record<string, readonly DailyBar[]>>;
  readonly subjects: readonly { readonly key: string; readonly trades: readonly CompactTrade[] }[];
}): MarketAnalysis {
  const window = input.split.windows.DISCOVERY;
  const lastAllowed = window.to.slice(0, 10);
  for (const [symbol, bars] of Object.entries(input.bars)) {
    if (bars.some((bar) => bar.day > lastAllowed)) throw new Error(`Market analysis received ${symbol} bars after the discovery window.`);
  }
  for (const subject of input.subjects) {
    if (subject.trades.some((trade) => Date.parse(trade.anchorAt) > Date.parse(window.to) || Date.parse(trade.anchorAt) < Date.parse(window.from))) {
      throw new Error(`Market analysis received ${subject.key} trades outside the discovery window.`);
    }
  }
  const reference = input.bars[input.referenceSymbol] ?? [];
  const conditions = new Map(classifyDays(reference, window).map((condition) => [condition.day, condition] as const));
  const segments: SegmentSummary[] = [];
  for (const [symbol, bars] of Object.entries(input.bars).sort(([a], [b]) => a.localeCompare(b))) {
    for (const fold of input.split.folds.filter((candidate) => candidate.window === "DISCOVERY")) {
      const inside = bars.filter((bar) => bar.day >= fold.from.slice(0, 10) && bar.day <= fold.to.slice(0, 10));
      segments.push(summarizeSegment(symbol, fold.key, inside, conditions));
    }
  }
  const buckets = input.subjects.flatMap((subject) => bucketsOf(subject.key, subject.trades, conditions));
  return { window: { from: window.from, to: window.to }, segments, buckets, findings: conditionFindings(buckets) };
}
