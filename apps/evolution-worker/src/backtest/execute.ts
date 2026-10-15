/**
 * One evolution backtest = one run of the unchanged historical shadow replay
 * (`@signalpilot/shadow-replay`: production strategy, risk, fill, portfolio
 * and performance engines, hour by hour, look-ahead free) for one subject,
 * symbol and window, reduced to a `BacktestSummary`.
 */

import {
  evolutionExecutionProfile,
  replayPlanFor,
  type BacktestSummary,
  type BacktestWindowKey,
  type CandidateGenome,
  type CompactTrade,
  type DailyEquityPoint,
  type PeriodBenchmark
} from "@signalpilot/evolution";
import { runShadowReplay, type ReplayMarketData, type ReplayPeriodMetrics, type ReplayResult } from "@signalpilot/shadow-replay";

export type BacktestSubject = { readonly kind: "ROOT"; readonly rootKey: string } | { readonly kind: "GENOME"; readonly genome: CandidateGenome };

export interface BacktestJob {
  readonly jobId: string;
  readonly kind: "BACKTEST" | "TECHNICAL";
  readonly subjectKey: string;
  readonly subject: BacktestSubject;
  readonly symbol: string;
  readonly windowKey: BacktestWindowKey | "TECHNICAL";
  readonly from: string;
  readonly to: string;
  /** Anchors before this instant are the first period (`discovery`), the rest the second (`validation`). */
  readonly splitAt?: string;
  readonly codeVersion: string;
}

export interface TechnicalResult {
  readonly deterministic: boolean;
  readonly invariantViolations: number;
  readonly cycles: number;
  readonly invalidInput: number;
  readonly outputHashes: readonly string[];
}

export type BacktestJobResult =
  | { readonly jobId: string; readonly ok: true; readonly dataFingerprint: string; readonly summary?: BacktestSummary; readonly technical?: TechnicalResult }
  | { readonly jobId: string; readonly ok: false; readonly error: string };

export const BACKTEST_STARTING_CASH = 10_000;

const num = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

function period(label: string, metrics: ReplayPeriodMetrics | null): PeriodBenchmark | null {
  if (metrics === null) return null;
  return {
    label,
    buyAndHoldReturnPct: num(metrics.buyAndHoldReturnPct),
    buyAndHoldMaxDrawdownPct: num(metrics.buyAndHoldMaxDrawdownPct),
    exposurePct: num(metrics.exposurePct)
  };
}

function compactTrades(result: ReplayResult): CompactTrade[] {
  return result.trades.map((trade) => ({
    symbol: trade.symbol,
    anchorAt: trade.anchorAt,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    exitReason: trade.exitReason,
    entryPrice: Number(trade.entryPrice),
    quantity: Number(trade.quantity),
    plannedRisk: Number(trade.plannedRiskAmount),
    grossPnl: Number(trade.grossPnl),
    fees: Number(trade.fees),
    spreadCost: Number(trade.spreadCost),
    slippageCost: Number(trade.slippageCost),
    netPnl: Number(trade.netPnl),
    rMultiple: num(trade.rMultiple),
    holdHours: Math.round(((Date.parse(trade.closedAt) - Date.parse(trade.openedAt)) / 3_600_000) * 100) / 100,
    marketRegime: trade.marketRegime
  }));
}

/** Hourly mark-to-market curve → last equity of each UTC day (2 decimals). */
export function dailyEquity(result: ReplayResult): DailyEquityPoint[] {
  const byDay = new Map<string, number>();
  for (const point of result.equityCurve) byDay.set(point.at.slice(0, 10), Math.round(Number(point.equity) * 100) / 100);
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, equity]) => ({ day, equity }));
}

const top = (counts: Readonly<Record<string, number>>, limit = 6) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));

function replay(market: ReplayMarketData, job: BacktestJob): { result: ReplayResult; durationMs: number } {
  const plan = replayPlanFor(job.subject.kind === "ROOT" ? { rootKey: job.subject.rootKey } : { genome: job.subject.genome });
  const started = Date.now();
  const result = runShadowReplay(
    market,
    {
      symbol: job.symbol,
      strategyKey: plan.strategyKey,
      mode: plan.mode,
      regimePolicy: plan.regimePolicy,
      startingCash: String(BACKTEST_STARTING_CASH),
      executionProfile: evolutionExecutionProfile(job.symbol),
      from: job.from,
      to: job.to,
      trainTestSplitAt: job.splitAt,
      codeVersion: job.codeVersion
    },
    plan.hooks
  );
  return { result, durationMs: Date.now() - started };
}

export function executeBacktest(market: ReplayMarketData, job: BacktestJob): BacktestSummary {
  if (job.windowKey === "TECHNICAL") throw new Error("Technical jobs use executeTechnicalCheck.");
  const { result, durationMs } = replay(market, job);
  const periods: Record<string, PeriodBenchmark> = {};
  const overall = period("overall", result.metrics.overall);
  if (overall !== null) periods.overall = overall;
  const first = period(job.splitAt === undefined ? "overall" : "discovery", result.metrics.training);
  const second = period("validation", result.metrics.test);
  if (job.splitAt !== undefined && first !== null) periods.discovery = first;
  if (job.splitAt !== undefined && second !== null) periods.validation = second;
  return {
    subjectKey: job.subjectKey,
    symbol: job.symbol,
    windowKey: job.windowKey,
    from: job.from,
    to: job.to,
    startingCash: BACKTEST_STARTING_CASH,
    finalEquity: Number(result.finalEquity),
    trades: compactTrades(result),
    dailyEquity: dailyEquity(result),
    funnel: {
      cycles: result.funnel.cycles,
      candidates: result.funnel.candidates,
      riskApproved: result.funnel.riskApproved,
      riskRejected: result.funnel.riskRejected,
      entriesFilled: result.funnel.entriesFilled,
      topStrategyReasons: top(result.funnel.strategyReasons),
      topRiskReasons: top(result.funnel.riskReasons)
    },
    periods,
    replayEngineVersion: result.engineVersion,
    outputHash: result.outputHash,
    invariantViolations: result.invariantViolations,
    firstAnchorAt: result.firstAnchorAt,
    lastAnchorAt: result.lastAnchorAt,
    durationMs
  };
}

/**
 * Technical test of a subject: the replay runs twice over a short window and
 * must produce the same output hash, without a portfolio invariant violation
 * and with decisions on valid input.
 */
export function executeTechnicalCheck(market: ReplayMarketData, job: BacktestJob): TechnicalResult {
  const first = replay(market, job).result;
  const second = replay(market, job).result;
  return {
    deterministic: first.outputHash === second.outputHash,
    invariantViolations: first.invariantViolations + second.invariantViolations,
    cycles: first.funnel.cycles,
    invalidInput: first.funnel.invalidInput,
    outputHashes: [first.outputHash, second.outputHash]
  };
}
