/**
 * Research metrics over evolution backtests.
 *
 * Every candidate is replayed per symbol with its own 10 000 USDT account,
 * exactly like a shadow portfolio. A candidate's result is the combination of
 * both accounts (BTC + ETH, 20 000 USDT): profit factor and expectancy from
 * the closed trades, return, drawdown and risk-adjusted ratios from the
 * mark-to-market daily equity. Nothing here is a forecast; these are
 * descriptive statistics of a historical simulation.
 */

import { EVOLUTION_COST_STRESS_MULTIPLIER, executionCostOf, stressedNetPnl } from "./costs.js";
import type { EvolutionDataSplit, EvolutionFold } from "./split.js";

export interface CompactTrade {
  readonly symbol: string;
  readonly anchorAt: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly exitReason: string;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly plannedRisk: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly spreadCost: number;
  readonly slippageCost: number;
  readonly netPnl: number;
  readonly rMultiple: number | null;
  readonly holdHours: number;
  readonly marketRegime: string | null;
}

export interface DailyEquityPoint {
  /** UTC day, YYYY-MM-DD; equity at the last hourly mark of that day. */
  readonly day: string;
  readonly equity: number;
}

export type BacktestWindowKey = "DISCOVERY_VALIDATION" | "HOLDOUT";

export interface BacktestFunnelSummary {
  readonly cycles: number;
  readonly candidates: number;
  readonly riskApproved: number;
  readonly riskRejected: number;
  readonly entriesFilled: number;
  readonly topStrategyReasons: readonly { readonly code: string; readonly count: number }[];
  readonly topRiskReasons: readonly { readonly code: string; readonly count: number }[];
}

export interface PeriodBenchmark {
  readonly label: string;
  readonly buyAndHoldReturnPct: number | null;
  readonly buyAndHoldMaxDrawdownPct: number | null;
  readonly exposurePct: number | null;
}

/** One replay of one subject on one symbol and window, reduced to what research needs. */
export interface BacktestSummary {
  readonly subjectKey: string;
  readonly symbol: string;
  readonly windowKey: BacktestWindowKey;
  readonly from: string;
  readonly to: string;
  readonly startingCash: number;
  readonly finalEquity: number;
  readonly trades: readonly CompactTrade[];
  readonly dailyEquity: readonly DailyEquityPoint[];
  readonly funnel: BacktestFunnelSummary;
  /** Replay period benchmarks: `overall`, and for DISCOVERY_VALIDATION `discovery` and `validation`. */
  readonly periods: Readonly<Record<string, PeriodBenchmark>>;
  readonly replayEngineVersion: string;
  readonly outputHash: string;
  readonly invariantViolations: number;
  readonly firstAnchorAt: string | null;
  readonly lastAnchorAt: string | null;
  readonly durationMs: number;
}

export interface SymbolBreakdown {
  readonly trades: number;
  readonly netPnl: number;
  readonly averageR: number | null;
  readonly profitFactor: number | null;
}

export interface WindowMetrics {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly startingCapital: number;
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly netPnl: number;
  /** Mean net PnL per closed trade (quote currency). */
  readonly expectancy: number | null;
  readonly averageR: number | null;
  readonly rStdDev: number | null;
  /** t-statistic of the mean R against zero (n ≥ 3). */
  readonly tStatR: number | null;
  readonly netReturnPct: number | null;
  readonly annualizedReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly sharpe: number | null;
  readonly sortino: number | null;
  /** Annualised return over max drawdown. */
  readonly calmar: number | null;
  readonly exposurePct: number | null;
  readonly averageHoldHours: number | null;
  readonly tradesPerYear: number | null;
  readonly totalExecutionCost: number;
  /** Execution costs as share of the gross profit of winning trades. */
  readonly costShareOfGrossProfitPct: number | null;
  readonly stressed: {
    readonly multiplier: number;
    readonly netPnl: number;
    readonly profitFactor: number | null;
    readonly averageR: number | null;
    readonly netReturnPct: number | null;
  };
  readonly perSymbol: Readonly<Record<string, SymbolBreakdown>>;
  /** Equal-weight buy-and-hold of the same symbols over the same window, one round trip of costs. */
  readonly buyAndHoldReturnPct: number | null;
  readonly buyAndHoldMaxDrawdownPct: number | null;
}

export interface FoldMetrics {
  readonly key: string;
  readonly window: string;
  readonly trades: number;
  readonly netPnl: number;
  readonly averageR: number | null;
  readonly profitFactor: number | null;
  readonly winRatePct: number | null;
}

export interface FoldStability {
  readonly foldsWithTrades: number;
  readonly positiveFolds: number;
  readonly positiveRatio: number | null;
  /** Largest single fold's share of the summed positive fold PnL (0–1). */
  readonly concentration: number | null;
  readonly worstFold: FoldMetrics | null;
}

const DAY_MS = 86_400_000;
const round = (value: number, digits = 6): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export function tStatistic(values: readonly number[]): number | null {
  if (values.length < 3) return null;
  const sd = sampleStdDev(values);
  if (sd === null || sd === 0) return null;
  return mean(values)! / (sd / Math.sqrt(values.length));
}

export function profitFactor(pnls: readonly number[]): number | null {
  const gains = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = -pnls.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  // No losing trade: the ratio is unbounded, reported as not computable (never as 0).
  if (losses === 0) return null;
  return gains / losses;
}

const inWindow = (iso: string, from: string, to: string): boolean => {
  const at = Date.parse(iso);
  return at >= Date.parse(from) && at <= Date.parse(to);
};

const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * Sum of the accounts' daily equity on the days every account reports;
 * missing days of one account carry its last known equity forward.
 */
export function combineDailyEquity(series: readonly (readonly DailyEquityPoint[])[], startingCash: readonly number[]): DailyEquityPoint[] {
  const days = [...new Set(series.flatMap((points) => points.map((point) => point.day)))].sort();
  const cursors = series.map(() => 0);
  const last = startingCash.map((cash) => cash);
  return days.map((day) => {
    series.forEach((points, index) => {
      while (cursors[index]! < points.length && points[cursors[index]!]!.day <= day) {
        last[index] = points[cursors[index]!]!.equity;
        cursors[index]! += 1;
      }
    });
    return { day, equity: round(last.reduce((sum, equity) => sum + equity, 0), 6) };
  });
}

/** Daily simple returns of an equity curve, keyed by the day they end on. */
export function dailyReturns(points: readonly DailyEquityPoint[]): { day: string; value: number }[] {
  const result: { day: string; value: number }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!.equity;
    if (previous > 0) result.push({ day: points[index]!.day, value: points[index]!.equity / previous - 1 });
  }
  return result;
}

export function maxDrawdownPct(points: readonly DailyEquityPoint[]): number | null {
  if (points.length === 0) return null;
  let peak = points[0]!.equity;
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.max(worst, (peak - point.equity) / peak);
  }
  return worst * 100;
}

function sharpe(returns: readonly number[]): number | null {
  const sd = sampleStdDev(returns);
  if (sd === null || sd === 0) return null;
  return (mean(returns)! / sd) * Math.sqrt(365);
}

function sortino(returns: readonly number[]): number | null {
  if (returns.length < 2) return null;
  const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length);
  if (downside === 0) return null;
  return (mean(returns)! / downside) * Math.sqrt(365);
}

/** Pearson correlation of two daily return series on their common days (≥ 30 days), else null. */
export function correlationOfDailyReturns(a: readonly DailyEquityPoint[], b: readonly DailyEquityPoint[]): number | null {
  const left = new Map(dailyReturns(a).map((entry) => [entry.day, entry.value]));
  const pairs = dailyReturns(b)
    .filter((entry) => left.has(entry.day))
    .map((entry) => [left.get(entry.day)!, entry.value] as const);
  if (pairs.length < 30) return null;
  const mx = mean(pairs.map((pair) => pair[0]))!;
  const my = mean(pairs.map((pair) => pair[1]))!;
  let covariance = 0;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of pairs) {
    covariance += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  if (vx === 0 || vy === 0) return null;
  return covariance / Math.sqrt(vx * vy);
}

const nullable = (value: number | null, digits = 6): number | null => (value === null || !Number.isFinite(value) ? null : round(value, digits));

/**
 * Combined metrics of one subject over one window (or fold) from its
 * per-symbol backtests. Trades are assigned by their anchor (decision) time.
 */
export function windowMetrics(input: {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly backtests: readonly BacktestSummary[];
  /** Replay period whose buy-and-hold/exposure benchmarks describe this window, if any. */
  readonly periodKey?: string;
}): WindowMetrics {
  const { from, to, backtests } = input;
  const trades = backtests.flatMap((backtest) => backtest.trades.filter((trade) => inWindow(trade.anchorAt, from, to)));
  const startingCapital = backtests.reduce((sum, backtest) => sum + backtest.startingCash, 0);
  const pnls = trades.map((trade) => trade.netPnl);
  const rs = trades.map((trade) => trade.rMultiple).filter((value): value is number => value !== null && Number.isFinite(value));
  const wins = trades.filter((trade) => trade.netPnl > 0).length;
  const fromDay = dayOf(from);
  const toDay = dayOf(to);
  const combined = combineDailyEquity(
    backtests.map((backtest) => backtest.dailyEquity),
    backtests.map((backtest) => backtest.startingCash)
  ).filter((point) => point.day >= fromDay && point.day <= toDay);
  // Start the window from the equity of the day before it, so the first day's move counts.
  const allCombined = combineDailyEquity(
    backtests.map((backtest) => backtest.dailyEquity),
    backtests.map((backtest) => backtest.startingCash)
  );
  const before = [...allCombined].reverse().find((point) => point.day < fromDay);
  const curve = before === undefined ? combined : [before, ...combined];
  const returns = dailyReturns(curve).map((entry) => entry.value);
  const startEquity = curve[0]?.equity ?? null;
  const endEquity = curve.at(-1)?.equity ?? null;
  const netReturnPct = startEquity !== null && endEquity !== null && startEquity > 0 ? (endEquity / startEquity - 1) * 100 : null;
  const years = (Date.parse(to) - Date.parse(from) + 1) / (365 * DAY_MS);
  const annualized = netReturnPct !== null && years > 0 ? ((1 + netReturnPct / 100) ** (1 / years) - 1) * 100 : null;
  const drawdown = maxDrawdownPct(curve);
  const stressedPnls = trades.map((trade) => stressedNetPnl(trade));
  const stressedRs = trades
    .filter((trade) => trade.plannedRisk > 0)
    .map((trade) => stressedNetPnl(trade) / trade.plannedRisk);
  const totalCost = trades.reduce((sum, trade) => sum + executionCostOf(trade), 0);
  const grossProfit = trades.filter((trade) => trade.grossPnl > 0).reduce((sum, trade) => sum + trade.grossPnl, 0);
  const symbols = [...new Set(backtests.map((backtest) => backtest.symbol))].sort();
  const perSymbol: Record<string, SymbolBreakdown> = {};
  for (const symbol of symbols) {
    const own = trades.filter((trade) => trade.symbol === symbol);
    const ownR = own.map((trade) => trade.rMultiple).filter((value): value is number => value !== null);
    perSymbol[symbol] = {
      trades: own.length,
      netPnl: round(own.reduce((sum, trade) => sum + trade.netPnl, 0)),
      averageR: nullable(mean(ownR)),
      profitFactor: nullable(profitFactor(own.map((trade) => trade.netPnl)))
    };
  }
  const periods = input.periodKey === undefined ? [] : backtests.map((backtest) => backtest.periods[input.periodKey!]).filter((period) => period !== undefined);
  const avgOf = (values: (number | null | undefined)[]): number | null => {
    const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return known.length === values.length && known.length > 0 ? mean(known) : null;
  };
  return {
    label: input.label,
    from,
    to,
    startingCapital,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length === 0 ? null : round((wins / trades.length) * 100, 4),
    profitFactor: nullable(profitFactor(pnls)),
    netPnl: round(pnls.reduce((sum, value) => sum + value, 0)),
    expectancy: nullable(mean(pnls)),
    averageR: nullable(mean(rs)),
    rStdDev: nullable(sampleStdDev(rs)),
    tStatR: nullable(tStatistic(rs), 4),
    netReturnPct: nullable(netReturnPct),
    annualizedReturnPct: nullable(annualized),
    maxDrawdownPct: nullable(drawdown),
    sharpe: nullable(sharpe(returns), 4),
    sortino: nullable(sortino(returns), 4),
    calmar: annualized !== null && drawdown !== null && drawdown > 0 ? round(annualized / drawdown, 4) : null,
    exposurePct: nullable(avgOf(periods.map((period) => period!.exposurePct))),
    averageHoldHours: nullable(mean(trades.map((trade) => trade.holdHours)), 2),
    tradesPerYear: years > 0 ? round(trades.length / years, 2) : null,
    totalExecutionCost: round(totalCost),
    costShareOfGrossProfitPct: grossProfit > 0 ? round((totalCost / grossProfit) * 100, 4) : null,
    stressed: {
      multiplier: EVOLUTION_COST_STRESS_MULTIPLIER,
      netPnl: round(stressedPnls.reduce((sum, value) => sum + value, 0)),
      profitFactor: nullable(profitFactor(stressedPnls)),
      averageR: nullable(mean(stressedRs)),
      netReturnPct:
        startingCapital > 0 ? round((stressedPnls.reduce((sum, value) => sum + value, 0) / startingCapital) * 100) : null
    },
    perSymbol,
    buyAndHoldReturnPct: nullable(avgOf(periods.map((period) => period!.buyAndHoldReturnPct))),
    buyAndHoldMaxDrawdownPct: nullable(avgOf(periods.map((period) => period!.buyAndHoldMaxDrawdownPct)))
  };
}

export function foldMetrics(split: EvolutionDataSplit, backtests: readonly BacktestSummary[]): FoldMetrics[] {
  return split.folds.map((fold: EvolutionFold) => {
    const trades = backtests.flatMap((backtest) => backtest.trades.filter((trade) => inWindow(trade.anchorAt, fold.from, fold.to)));
    const rs = trades.map((trade) => trade.rMultiple).filter((value): value is number => value !== null);
    const wins = trades.filter((trade) => trade.netPnl > 0).length;
    return {
      key: fold.key,
      window: fold.window,
      trades: trades.length,
      netPnl: round(trades.reduce((sum, trade) => sum + trade.netPnl, 0)),
      averageR: nullable(mean(rs)),
      profitFactor: nullable(profitFactor(trades.map((trade) => trade.netPnl))),
      winRatePct: trades.length === 0 ? null : round((wins / trades.length) * 100, 4)
    };
  });
}

/** Stability over the walk-forward segments that have at least `minTrades` trades. */
export function foldStability(folds: readonly FoldMetrics[], minTrades = 2): FoldStability {
  const relevant = folds.filter((fold) => fold.trades >= minTrades);
  const positive = relevant.filter((fold) => fold.netPnl > 0);
  const positiveSum = positive.reduce((sum, fold) => sum + fold.netPnl, 0);
  const worst = relevant.length === 0 ? null : [...relevant].sort((a, b) => a.netPnl - b.netPnl)[0]!;
  return {
    foldsWithTrades: relevant.length,
    positiveFolds: positive.length,
    positiveRatio: relevant.length === 0 ? null : round(positive.length / relevant.length, 4),
    concentration: positiveSum > 0 ? round(Math.max(...positive.map((fold) => fold.netPnl)) / positiveSum, 4) : null,
    worstFold: worst
  };
}

export interface CurveStats {
  readonly netReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly sharpe: number | null;
}

/** Return, drawdown and Sharpe of any equity curve inside [from, to] (portfolio comparisons, gates v3). */
export function curveStats(curve: readonly DailyEquityPoint[], from: string, to: string): CurveStats {
  const fromDay = from.slice(0, 10);
  const toDay = to.slice(0, 10);
  const sorted = [...curve].sort((a, b) => (a.day < b.day ? -1 : 1));
  const before = [...sorted].reverse().find((point) => point.day < fromDay);
  const inside = sorted.filter((point) => point.day >= fromDay && point.day <= toDay);
  const window = before === undefined ? inside : [before, ...inside];
  const start = window[0]?.equity ?? null;
  const end = window.at(-1)?.equity ?? null;
  return {
    netReturnPct: start !== null && end !== null && start > 0 ? nullable((end / start - 1) * 100) : null,
    maxDrawdownPct: nullable(maxDrawdownPct(window)),
    sharpe: nullable(sharpe(dailyReturns(window).map((entry) => entry.value)), 4)
  };
}

/**
 * Share of the candidate's trades that act on an opportunity a reference
 * strategy already acts on (gates v3, diversification path): same symbol and
 * either the reference decided to enter within ±`windowHours`, or it already
 * held a position at the candidate's decision. A parameter variant that only
 * changes exits or holding time keeps entering where its parent is (or just
 * was) in the market — a low daily-return correlation cannot hide that.
 * Null without trades.
 */
export function signalOverlap(candidate: readonly CompactTrade[], reference: readonly CompactTrade[], windowHours: number): number | null {
  if (candidate.length === 0) return null;
  const window = windowHours * 3_600_000;
  const bySymbol = new Map<string, { anchor: number; opened: number; closed: number }[]>();
  for (const trade of reference) {
    const list = bySymbol.get(trade.symbol) ?? [];
    list.push({ anchor: Date.parse(trade.anchorAt), opened: Date.parse(trade.openedAt), closed: Date.parse(trade.closedAt) });
    bySymbol.set(trade.symbol, list);
  }
  const shared = candidate.filter((trade) => {
    const at = Date.parse(trade.anchorAt);
    return (bySymbol.get(trade.symbol) ?? []).some((other) => Math.abs(other.anchor - at) <= window || (other.opened <= at && at <= other.closed));
  }).length;
  return round(shared / candidate.length, 4);
}
