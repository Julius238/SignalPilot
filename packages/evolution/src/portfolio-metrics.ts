/**
 * Measures of the gates-v4 portfolio decision (comparison A against
 * comparison B of the chronological portfolio replay, `portfolio.ts`).
 *
 * Every number comes from the two simulated portfolios themselves — group
 * equity, member equity and member trades of one chronological run each —
 * never from adding up separate backtests. Specification:
 * docs/trading/research/2026-10-15-evolution-gates-v4-draft.md, sections 3–6.
 */

import { EVOLUTION_COST_STRESS_MULTIPLIER, executionCostOf } from "./costs.js";
import {
  correlationOfDailyReturns,
  curveStats,
  mean,
  signalOverlap,
  windowMetrics,
  type BacktestSummary,
  type CompactTrade,
  type CurveStats,
  type DailyEquityPoint,
  type WindowMetrics
} from "./metrics.js";
import { monthlyReturns, pairedMonthlyTest, spanningAlphaTest, type PairedMonthlyTest, type SpanningAlphaTest } from "./paired.js";
import type { PortfolioMemberSummary, PortfolioSummary } from "./portfolio.js";
import type { EvolutionDataSplit } from "./split.js";

export type PortfolioWindowKey = "IN_SAMPLE" | "DISCOVERY" | "VALIDATION" | "HOLDOUT";

export interface PortfolioWindowSide extends CurveStats {
  /** Window return ÷ window max drawdown (both in %); null without a drawdown. */
  readonly returnToDrawdown: number | null;
}

export interface PortfolioWindowComparison {
  readonly key: PortfolioWindowKey;
  readonly from: string;
  readonly to: string;
  readonly baseline: PortfolioWindowSide;
  readonly withCandidate: PortfolioWindowSide;
  readonly netReturnDelta: number | null;
  readonly sharpeDelta: number | null;
  readonly drawdownRatio: number | null;
}

export interface EfficiencyMeasure {
  readonly baselineAverage: number | null;
  readonly withCandidateAverage: number | null;
  /** Δ net return (in-sample, %) per Δ average (percentage point). */
  readonly incrementalEfficiency: number | null;
  /** Net return of A per its average. */
  readonly baselineEfficiency: number | null;
}

export interface IncrementFold {
  readonly key: string;
  /** Group PnL of B minus group PnL of A over the fold (quote currency). */
  readonly increment: number;
  readonly candidateTrades: number;
}

export interface GeometryRelation {
  readonly key: string;
  readonly candidateHoldHours: number | null;
  readonly referenceHoldHours: number | null;
  readonly holdRatio: number | null;
  readonly candidateTradesPerYear: number | null;
  readonly referenceTradesPerYear: number | null;
  readonly frequencyRatio: number | null;
  /** Both dimensions within the geometry factor: the reference's trade metrics are hard minimums. */
  readonly comparable: boolean;
  readonly candidate: TradeQuality;
  readonly reference: TradeQuality;
}

export interface TradeQuality {
  readonly trades: number;
  readonly validationAverageR: number | null;
  readonly profitFactor: number | null;
  readonly stressedAverageR: number | null;
  readonly losses: number;
  readonly netPnl: number;
}

export interface ExistingRelation {
  readonly key: string;
  readonly correlation: number | null;
  readonly signalOverlap: number | null;
  /** The existing portfolio's result is identical in A and B (no group limit interacted). */
  readonly identicalInBothComparisons: boolean;
  readonly tradesBaseline: number;
  readonly tradesWithCandidate: number;
  readonly netPnlBaseline: number;
  readonly netPnlWithCandidate: number;
}

export interface PortfolioAssessment {
  readonly candidateKey: string;
  readonly existingKeys: readonly string[];
  readonly totalCapital: number;
  readonly windows: Readonly<Record<Exclude<PortfolioWindowKey, "HOLDOUT">, PortfolioWindowComparison>>;
  readonly drawdownWithCandidatePct: number | null;
  readonly openRisk: EfficiencyMeasure;
  readonly capitalBound: EfficiencyMeasure;
  readonly increment: {
    readonly folds: readonly IncrementFold[];
    readonly foldsWithTrades: number;
    readonly positiveFolds: number;
    readonly positiveRatio: number | null;
    readonly concentration: number | null;
  };
  readonly costStress: {
    readonly multiplier: number;
    readonly netReturnDelta: number | null;
    readonly sharpeDelta: number | null;
  };
  /** Candidate portfolio (in B) regressed on every existing portfolio (in B), monthly. */
  readonly alpha: SpanningAlphaTest;
  readonly alphaByWindow: Readonly<Record<"DISCOVERY" | "VALIDATION", number | null>>;
  /** α̂ ÷ mean monthly return of the candidate (reported only). */
  readonly alphaShare: number | null;
  /** Share of the candidate's monthly variance the existing portfolios explain (reported only). */
  readonly rSquared: number | null;
  /** Group of B minus group of A, monthly. */
  readonly incrementTest: PairedMonthlyTest;
  readonly candidateTrades: number;
  readonly candidateExecutionCost: number;
  readonly existing: readonly ExistingRelation[];
  readonly geometry: readonly GeometryRelation[];
  readonly stage2RejectionsWithCandidate: Readonly<Record<string, number>>;
  readonly invariantViolations: number;
}

const DAY = (iso: string) => iso.slice(0, 10);
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const minus = (a: number | null, b: number | null): number | null => (finite(a) && finite(b) ? a - b : null);

function windowSide(curve: readonly DailyEquityPoint[], from: string, to: string): PortfolioWindowSide {
  const stats = curveStats(curve, from, to);
  return {
    ...stats,
    returnToDrawdown: finite(stats.netReturnPct) && finite(stats.maxDrawdownPct) && stats.maxDrawdownPct > 0 ? stats.netReturnPct / stats.maxDrawdownPct : null
  };
}

function compareWindow(key: PortfolioWindowKey, from: string, to: string, a: PortfolioSummary, b: PortfolioSummary): PortfolioWindowComparison {
  const baseline = windowSide(a.group.dailyEquity, from, to);
  const withCandidate = windowSide(b.group.dailyEquity, from, to);
  return {
    key,
    from,
    to,
    baseline,
    withCandidate,
    netReturnDelta: minus(withCandidate.netReturnPct, baseline.netReturnPct),
    sharpeDelta: minus(withCandidate.sharpe, baseline.sharpe),
    drawdownRatio: finite(withCandidate.maxDrawdownPct) && finite(baseline.maxDrawdownPct) && baseline.maxDrawdownPct > 0 ? withCandidate.maxDrawdownPct / baseline.maxDrawdownPct : null
  };
}

/** Group equity at the end of `to` (last point on or before) minus at the end of the day before `from`. */
function groupChange(curve: readonly DailyEquityPoint[], from: string, to: string, startingCapital: number): number | null {
  const fromDay = DAY(from);
  const toDay = DAY(to);
  const before = [...curve].reverse().find((point) => point.day < fromDay);
  const end = [...curve].reverse().find((point) => point.day <= toDay);
  if (end === undefined || end.day < fromDay) return null;
  return end.equity - (before?.equity ?? startingCapital);
}

/** Every portfolio's equity minus (multiplier − 1) × the execution costs of the trades closed so far. */
function costStressedGroupCurve(summary: PortfolioSummary, multiplier: number): DailyEquityPoint[] {
  const extraByDay = new Map<string, number>();
  for (const member of summary.members) {
    for (const trade of member.trades) {
      const day = DAY(trade.closedAt);
      extraByDay.set(day, (extraByDay.get(day) ?? 0) + (multiplier - 1) * executionCostOf(trade));
    }
  }
  const days = [...extraByDay.keys()].sort();
  let cursor = 0;
  let cumulative = 0;
  return summary.group.dailyEquity.map((point) => {
    while (cursor < days.length && days[cursor]! <= point.day) {
      cumulative += extraByDay.get(days[cursor]!)!;
      cursor += 1;
    }
    return { day: point.day, equity: point.equity - cumulative };
  });
}

/** A strategy portfolio as the single-subject backtest shape `windowMetrics` reads. */
function asBacktest(member: PortfolioMemberSummary, from: string, to: string): BacktestSummary {
  return {
    subjectKey: member.key,
    symbol: "PORTFOLIO",
    windowKey: "DISCOVERY_VALIDATION",
    from,
    to,
    startingCash: member.startingCash,
    finalEquity: member.finalEquity,
    trades: member.trades,
    dailyEquity: member.dailyEquity,
    funnel: { cycles: member.funnel.cycles, candidates: member.funnel.candidates, riskApproved: member.funnel.riskApproved, riskRejected: member.funnel.riskRejected, entriesFilled: member.funnel.entriesFilled, topStrategyReasons: [], topRiskReasons: [] },
    periods: {},
    replayEngineVersion: "portfolio-member",
    outputHash: member.outputHash,
    invariantViolations: member.invariantViolations,
    firstAnchorAt: null,
    lastAnchorAt: null,
    durationMs: 0
  };
}

function memberWindow(member: PortfolioMemberSummary, label: string, from: string, to: string): WindowMetrics {
  return windowMetrics({ label, from, to, backtests: [asBacktest(member, from, to)] });
}

function tradeQuality(inSample: WindowMetrics, validation: WindowMetrics): TradeQuality {
  return {
    trades: inSample.trades,
    validationAverageR: validation.averageR,
    profitFactor: inSample.profitFactor,
    stressedAverageR: inSample.stressed.averageR,
    losses: inSample.losses,
    netPnl: inSample.netPnl
  };
}

/** R² of an OLS of the candidate's monthly returns on the existing portfolios' monthly returns. */
function regressionRSquared(candidate: readonly DailyEquityPoint[], factors: readonly (readonly DailyEquityPoint[])[], from: string, to: string): number | null {
  const maps = factors.map((curve) => new Map(monthlyReturns(curve, from, to).map((entry) => [entry.month, entry.value] as const)));
  const rows = monthlyReturns(candidate, from, to)
    .filter((entry) => maps.every((map) => map.has(entry.month)))
    .map((entry) => ({ y: entry.value, x: [1, ...maps.map((map) => map.get(entry.month)!)] }));
  const p = factors.length + 1;
  if (rows.length - p < 3) return null;
  const xtx = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => rows.reduce((sum, row) => sum + row.x[i]! * row.x[j]!, 0)));
  const xty = Array.from({ length: p }, (_, i) => rows.reduce((sum, row) => sum + row.x[i]! * row.y, 0));
  // Gaussian elimination with partial pivoting.
  const a = xtx.map((row, index) => [...row, xty[index]!]);
  for (let column = 0; column < p; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < p; row += 1) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    if (Math.abs(a[pivot]![column]!) < 1e-15) return null;
    [a[column], a[pivot]] = [a[pivot]!, a[column]!];
    for (let row = column + 1; row < p; row += 1) {
      const factor = a[row]![column]! / a[column]![column]!;
      for (let k = column; k <= p; k += 1) a[row]![k]! -= factor * a[column]![k]!;
    }
  }
  const beta = new Array<number>(p).fill(0);
  for (let row = p - 1; row >= 0; row -= 1) {
    let value = a[row]![p]!;
    for (let k = row + 1; k < p; k += 1) value -= a[row]![k]! * beta[k]!;
    beta[row] = value / a[row]![row]!;
  }
  const meanY = mean(rows.map((row) => row.y))!;
  const tss = rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0);
  if (tss <= 0) return null;
  const rss = rows.reduce((sum, row) => sum + (row.y - row.x.reduce((total, value, k) => total + value * beta[k]!, 0)) ** 2, 0);
  return 1 - rss / tss;
}

const ratio = (a: number | null, b: number | null): number | null => (finite(a) && finite(b) && b > 0 ? a / b : null);

function efficiency(netReturnDelta: number | null, baselineNetReturn: number | null, baselineAverage: number | null, withCandidateAverage: number | null): EfficiencyMeasure {
  const delta = minus(withCandidateAverage, baselineAverage);
  return {
    baselineAverage,
    withCandidateAverage,
    incrementalEfficiency: finite(netReturnDelta) && finite(delta) && delta > 0 ? netReturnDelta / delta : null,
    baselineEfficiency: ratio(baselineNetReturn, baselineAverage)
  };
}

/**
 * Checks that A and B are the two comparisons of one fixed-slot frame: same
 * window, same total capital, same existing portfolios in the same order,
 * the reserve of A equal to the candidate's slot in B and the candidate last.
 */
export function checkComparisonFrame(baseline: PortfolioSummary, withCandidate: PortfolioSummary, candidateKey: string): void {
  if (baseline.comparison !== "BASELINE" || withCandidate.comparison !== "WITH_CANDIDATE") throw new Error("Expected comparison A (BASELINE) and comparison B (WITH_CANDIDATE).");
  if (baseline.from !== withCandidate.from || baseline.to !== withCandidate.to) throw new Error("Comparisons A and B cover different windows.");
  if (Math.abs(baseline.group.totalCapital - withCandidate.group.totalCapital) > 1e-9) throw new Error("Comparisons A and B use different total capital.");
  const existingA = baseline.members.map((member) => member.key);
  const existingB = withCandidate.members.slice(0, -1).map((member) => member.key);
  if (existingA.join("|") !== existingB.join("|")) throw new Error("Comparisons A and B hold different existing strategies.");
  const candidate = withCandidate.members.at(-1);
  if (candidate === undefined || candidate.key !== candidateKey) throw new Error(`The candidate ${candidateKey} must be the last portfolio of comparison B.`);
  const slots = [...baseline.members.map((member) => member.startingCash), baseline.reserveCash, ...withCandidate.members.map((member) => member.startingCash)];
  if (slots.some((slot) => Math.abs(slot - slots[0]!) > 1e-9) || withCandidate.reserveCash !== 0) throw new Error("Every portfolio must hold exactly one equal slot.");
}

export function assessPortfolioComparison(input: {
  readonly baseline: PortfolioSummary;
  readonly withCandidate: PortfolioSummary;
  readonly candidateKey: string;
  readonly split: EvolutionDataSplit;
  readonly geometryFactor: number;
  readonly costMultiplier?: number;
  readonly minFoldTrades?: number;
}): PortfolioAssessment {
  const { baseline: a, withCandidate: b, candidateKey, split } = input;
  checkComparisonFrame(a, b, candidateKey);
  const D = split.windows.DISCOVERY;
  const V = split.windows.VALIDATION;
  const windows = {
    IN_SAMPLE: compareWindow("IN_SAMPLE", D.from, V.to, a, b),
    DISCOVERY: compareWindow("DISCOVERY", D.from, D.to, a, b),
    VALIDATION: compareWindow("VALIDATION", V.from, V.to, a, b)
  };
  const candidate = b.members.at(-1)!;
  const existingB = b.members.slice(0, -1);
  const totalCapital = a.group.totalCapital;

  // Increment of the group per market phase (calendar-year folds).
  const minFoldTrades = input.minFoldTrades ?? 2;
  const folds: IncrementFold[] = split.folds.map((fold) => {
    const changeA = groupChange(a.group.dailyEquity, fold.from, fold.to, totalCapital) ?? 0;
    const changeB = groupChange(b.group.dailyEquity, fold.from, fold.to, totalCapital) ?? 0;
    const trades = candidate.trades.filter((trade) => trade.anchorAt >= fold.from && trade.anchorAt <= fold.to).length;
    return { key: fold.key, increment: changeB - changeA, candidateTrades: trades };
  });
  const relevant = folds.filter((fold) => fold.candidateTrades >= minFoldTrades);
  const positive = relevant.filter((fold) => fold.increment > 0);
  const positiveSum = positive.reduce((sum, fold) => sum + fold.increment, 0);

  // Analytic cost stress over every portfolio of A and B.
  const multiplier = input.costMultiplier ?? EVOLUTION_COST_STRESS_MULTIPLIER;
  const stressedA = windowSide(costStressedGroupCurve(a, multiplier), D.from, V.to);
  const stressedB = windowSide(costStressedGroupCurve(b, multiplier), D.from, V.to);

  // Statistics: own α against every existing portfolio, and the paired increment of the group.
  const factorCurves = existingB.map((member) => member.dailyEquity);
  const alpha = spanningAlphaTest(candidate.dailyEquity, factorCurves, D.from, V.to);
  const alphaDiscovery = spanningAlphaTest(candidate.dailyEquity, factorCurves, D.from, D.to).meanDifference;
  const alphaValidation = spanningAlphaTest(candidate.dailyEquity, factorCurves, V.from, V.to).meanDifference;
  const candidateMonthly = mean(monthlyReturns(candidate.dailyEquity, D.from, V.to).map((entry) => entry.value));
  const alphaShare = finite(alpha.meanDifference) && finite(candidateMonthly) && candidateMonthly !== 0 ? alpha.meanDifference / candidateMonthly : null;

  // Geometry and trade quality against every existing portfolio (within B).
  const candidateInSample = memberWindow(candidate, "Kandidat", D.from, V.to);
  const candidateValidation = memberWindow(candidate, "Kandidat Validierung", V.from, V.to);
  const geometry: GeometryRelation[] = existingB.map((member) => {
    const inSample = memberWindow(member, member.key, D.from, V.to);
    const validation = memberWindow(member, `${member.key} Validierung`, V.from, V.to);
    const holdRatio = ratio(candidateInSample.averageHoldHours, inSample.averageHoldHours);
    const frequencyRatio = ratio(candidateInSample.tradesPerYear, inSample.tradesPerYear);
    const within = (value: number | null) => finite(value) && value >= 1 / input.geometryFactor && value <= input.geometryFactor;
    return {
      key: member.key,
      candidateHoldHours: candidateInSample.averageHoldHours,
      referenceHoldHours: inSample.averageHoldHours,
      holdRatio,
      candidateTradesPerYear: candidateInSample.tradesPerYear,
      referenceTradesPerYear: inSample.tradesPerYear,
      frequencyRatio,
      comparable: within(holdRatio) && within(frequencyRatio),
      candidate: tradeQuality(candidateInSample, candidateValidation),
      reference: tradeQuality(inSample, validation)
    };
  });

  const existing: ExistingRelation[] = existingB.map((member) => {
    const inA = a.members.find((entry) => entry.key === member.key)!;
    return {
      key: member.key,
      correlation: correlationOfDailyReturns(candidate.dailyEquity, member.dailyEquity),
      signalOverlap: signalOverlap(candidate.trades as CompactTrade[], member.trades as CompactTrade[], 24),
      identicalInBothComparisons: inA.outputHash === member.outputHash,
      tradesBaseline: inA.trades.length,
      tradesWithCandidate: member.trades.length,
      netPnlBaseline: inA.trades.reduce((sum, trade) => sum + trade.netPnl, 0),
      netPnlWithCandidate: member.trades.reduce((sum, trade) => sum + trade.netPnl, 0)
    };
  });

  return {
    candidateKey,
    existingKeys: existingB.map((member) => member.key),
    totalCapital,
    windows,
    drawdownWithCandidatePct: windows.IN_SAMPLE.withCandidate.maxDrawdownPct,
    openRisk: efficiency(windows.IN_SAMPLE.netReturnDelta, windows.IN_SAMPLE.baseline.netReturnPct, a.group.averageOpenRiskPct, b.group.averageOpenRiskPct),
    capitalBound: efficiency(windows.IN_SAMPLE.netReturnDelta, windows.IN_SAMPLE.baseline.netReturnPct, a.group.averageCapitalBoundPct, b.group.averageCapitalBoundPct),
    increment: {
      folds,
      foldsWithTrades: relevant.length,
      positiveFolds: positive.length,
      positiveRatio: relevant.length === 0 ? null : positive.length / relevant.length,
      concentration: positiveSum > 0 ? Math.max(...positive.map((fold) => fold.increment)) / positiveSum : null
    },
    costStress: { multiplier, netReturnDelta: minus(stressedB.netReturnPct, stressedA.netReturnPct), sharpeDelta: minus(stressedB.sharpe, stressedA.sharpe) },
    alpha,
    alphaByWindow: { DISCOVERY: alphaDiscovery, VALIDATION: alphaValidation },
    alphaShare,
    rSquared: regressionRSquared(candidate.dailyEquity, factorCurves, D.from, V.to),
    incrementTest: pairedMonthlyTest(b.group.dailyEquity, a.group.dailyEquity, D.from, V.to),
    candidateTrades: candidate.trades.length,
    candidateExecutionCost: candidate.trades.reduce((sum, trade) => sum + executionCostOf(trade), 0),
    existing,
    geometry,
    stage2RejectionsWithCandidate: b.group.stage2Rejections,
    invariantViolations: [...a.members, ...b.members].reduce((sum, member) => sum + member.invariantViolations, 0)
  };
}

/** Comparison B against A on the previously analysed holdout: a guard, never evidence. */
export function holdoutGuardMeasures(baseline: PortfolioSummary, withCandidate: PortfolioSummary, candidateKey: string, split: EvolutionDataSplit): PortfolioWindowComparison {
  checkComparisonFrame(baseline, withCandidate, candidateKey);
  const H = split.windows.HOLDOUT;
  return compareWindow("HOLDOUT", H.from, H.to, baseline, withCandidate);
}
