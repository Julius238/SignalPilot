/**
 * Gates-v4 portfolio path of a candidate from an independent family.
 *
 * Runs the two comparisons of the pre-registered fixed-slot frame through the
 * backtest runner (child processes in production): comparison A once per
 * research run and window (existing strategies plus the reserve slot, shared
 * by every candidate), comparison B per candidate (the candidate on the
 * reserve slot). Both are chronological multi-strategy portfolio replays with
 * the unchanged risk engine and the cross-portfolio stage 2; nothing is
 * added up from separate backtests. The measures and the decision come from
 * `@signalpilot/evolution` (`portfolio-metrics.ts`, `gates-v4.ts`).
 *
 * The research cycle calls this only for families that declare independence
 * (`FamilySpec.independence`); until such a family exists the existing
 * families keep the unchanged v3 path.
 */

import {
  assessPortfolioComparison,
  holdoutGuardMeasures,
  independentFamilyFinalGates,
  independentFamilyScreeningGates,
  type EvolutionDataSplit,
  type EvolutionGatesV4,
  type GateResultV4,
  type IndependentFamilyDecision,
  type IndependentFamilyStructure,
  type NeighbourPortfolioResult,
  type PortfolioAssessment,
  type PortfolioComparisonKind,
  type PortfolioMemberSpec,
  type PortfolioSummary
} from "@signalpilot/evolution";

import type { BacktestRunner } from "../backtest/pool.js";

export interface PortfolioWindow {
  readonly from: string;
  readonly to: string;
}

export interface PortfolioRunContext {
  readonly runner: BacktestRunner;
  /** Existing strategies in decision order: the roots, then operator-approved candidates by key. */
  readonly existing: readonly PortfolioMemberSpec[];
  readonly codeVersion: string;
  readonly split: EvolutionDataSplit;
  /** Comparison A per window, shared by every candidate of the run. */
  readonly baselineCache: Map<string, Promise<{ summary: PortfolioSummary; dataFingerprint: string }>>;
  readonly jobId: (label: string) => string;
}

async function runComparison(
  context: PortfolioRunContext,
  comparison: PortfolioComparisonKind,
  window: PortfolioWindow,
  candidate?: PortfolioMemberSpec
): Promise<{ summary: PortfolioSummary; dataFingerprint: string }> {
  const label = comparison === "BASELINE" ? "portfolio-A" : `portfolio-B-${candidate!.key}`;
  const result = await context.runner.run({
    jobId: context.jobId(label),
    kind: "PORTFOLIO",
    spec: {
      comparison,
      existing: context.existing,
      ...(candidate === undefined ? {} : { candidate }),
      from: window.from,
      to: window.to,
      codeVersion: context.codeVersion
    }
  });
  if (!result.ok) throw new Error(`Portfolio comparison ${label} failed: ${result.error}`);
  if (result.portfolio === undefined) throw new Error(`Portfolio comparison ${label} returned no summary.`);
  return { summary: result.portfolio, dataFingerprint: result.dataFingerprint };
}

/** Comparisons A and B over one window; A comes from the run's cache. */
export async function comparisonPair(
  context: PortfolioRunContext,
  candidate: PortfolioMemberSpec,
  window: PortfolioWindow
): Promise<{ baseline: PortfolioSummary; withCandidate: PortfolioSummary; dataFingerprint: string }> {
  const key = `${window.from}|${window.to}|${context.codeVersion}|${context.existing.map((member) => member.key).join(",")}`;
  let baseline = context.baselineCache.get(key);
  if (baseline === undefined) {
    baseline = runComparison(context, "BASELINE", window);
    context.baselineCache.set(key, baseline);
  }
  const [a, b] = await Promise.all([baseline, runComparison(context, "WITH_CANDIDATE", window, candidate)]);
  if (a.dataFingerprint !== b.dataFingerprint) throw new Error("Comparisons A and B ran on different market data.");
  return { baseline: a.summary, withCandidate: b.summary, dataFingerprint: a.dataFingerprint };
}

export interface IndependentScreening {
  readonly baseline: PortfolioSummary;
  readonly withCandidate: PortfolioSummary;
  readonly assessment: PortfolioAssessment;
  readonly gates: readonly GateResultV4[];
  readonly decision: IndependentFamilyDecision;
  readonly dataFingerprint: string;
}

/** Screening of one candidate on discovery + validation: measures and the v4 portfolio decision. */
export async function screenIndependentCandidate(
  context: PortfolioRunContext,
  input: {
    readonly family: string;
    readonly candidate: PortfolioMemberSpec;
    readonly structure: IndependentFamilyStructure;
    readonly gates: EvolutionGatesV4;
    readonly trials: number;
    readonly screeningsThisMonth: number;
  }
): Promise<IndependentScreening> {
  const window = { from: context.split.windows.DISCOVERY.from, to: context.split.windows.VALIDATION.to };
  const { baseline, withCandidate, dataFingerprint } = await comparisonPair(context, input.candidate, window);
  const assessment = assessPortfolioComparison({
    baseline,
    withCandidate,
    candidateKey: input.candidate.key,
    split: context.split,
    geometryFactor: input.gates.independentFamily.thresholds.geometryFactor,
    costMultiplier: input.gates.independentFamily.thresholds.costStressMultiplier,
    minFoldTrades: input.gates.independentFamily.thresholds.minFoldTrades
  });
  const decided = independentFamilyScreeningGates(
    { family: input.family, structure: input.structure, assessment, trials: input.trials, screeningsThisMonth: input.screeningsThisMonth },
    input.gates
  );
  return { baseline, withCandidate, assessment, gates: decided.gates, decision: decided.decision, dataFingerprint };
}

/** Final stage: one-step neighbours (discovery + validation) and the holdout guard (previously analysed, never evidence). */
export async function finalIndependentCandidate(
  context: PortfolioRunContext,
  input: { readonly candidate: PortfolioMemberSpec; readonly neighbours: readonly PortfolioMemberSpec[]; readonly gates: EvolutionGatesV4 }
): Promise<{ readonly gates: readonly GateResultV4[]; readonly neighbours: readonly NeighbourPortfolioResult[] }> {
  const inSample = { from: context.split.windows.DISCOVERY.from, to: context.split.windows.VALIDATION.to };
  const neighbours = await Promise.all(
    input.neighbours.map(async (neighbour) => {
      const pair = await comparisonPair(context, neighbour, inSample);
      const assessment = assessPortfolioComparison({
        baseline: pair.baseline,
        withCandidate: pair.withCandidate,
        candidateKey: neighbour.key,
        split: context.split,
        geometryFactor: input.gates.independentFamily.thresholds.geometryFactor,
        costMultiplier: input.gates.independentFamily.thresholds.costStressMultiplier,
        minFoldTrades: input.gates.independentFamily.thresholds.minFoldTrades
      });
      return { key: neighbour.key, netReturnDelta: assessment.windows.IN_SAMPLE.netReturnDelta, sharpeDelta: assessment.windows.IN_SAMPLE.sharpeDelta };
    })
  );
  const holdoutWindow = { from: context.split.windows.HOLDOUT.from, to: context.split.windows.HOLDOUT.to };
  const holdoutPair = await comparisonPair(context, input.candidate, holdoutWindow);
  const holdout = holdoutGuardMeasures(holdoutPair.baseline, holdoutPair.withCandidate, input.candidate.key, context.split);
  return { gates: independentFamilyFinalGates({ neighbours, holdout }, input.gates), neighbours };
}
