/**
 * Survival fitness of an arena participant: how well it grows its own capital
 * after every cost, adjusted for the risk it took to get there.
 *
 * Every component is a score in [0, 1] where 0.5 is neutral (no edge, no
 * evidence); the raw fitness is their weighted sum (0–100), capped by the
 * risk ceiling 50 + 50 × drawdown score: a drawdown at or beyond the policy's
 * reference can never score above neutral, however large the gain. The fitness that
 * ranks participants is the raw value shrunk toward the neutral 50 by the
 * evidence progress, so a handful of lucky trades cannot rank first and a
 * handful of unlucky ones cannot rank last. The full breakdown is returned so
 * it can be stored and shown next to the number.
 *
 * Pure and deterministic: same input, same policy → same result.
 */

import type { ArenaFitnessPolicy, ArenaPolicy } from "./policy.js";
import { evaluateArenaEvidence, type ArenaEvidenceResult } from "./evidence.js";

export const ARENA_FITNESS_ENGINE_VERSION = "arena-fitness-v1/1.0.0";
export const NEUTRAL_FITNESS = 50;

export interface ArenaFitnessInput {
  /** The participant's own starting capital (never topped up). */
  readonly initialCapital: number;
  /** Conservative mark-to-market capital now, after every cost. */
  readonly equity: number;
  readonly forwardDays: number;
  readonly closedTrades: number;
  readonly wins: number;
  readonly losses: number;
  /** Deepest peak-to-trough fall of the capital curve since the forward start (0–1). */
  readonly maxDrawdownFraction: number;
  /** Null when undefined: no closed trade, or no losing trade. */
  readonly profitFactor: number | null;
  readonly averageR: number | null;
  /** 0–1, null without closed trades. */
  readonly winRate: number | null;
  readonly averageWin: number | null;
  /** Negative, null without losing trades. */
  readonly averageLoss: number | null;
  readonly maxLossStreak: number;
  /** Fees plus simulated spread and slippage of the closed trades. */
  readonly costs: number;
  /** Net P&L of the closed trades (already after their costs). */
  readonly closedNetPnl: number;
  /** Share of the forward period with an open position (0–1), null if unknown. */
  readonly exposureFraction: number | null;
}

export type ArenaFitnessComponentKey = keyof ArenaFitnessPolicy["weights"];

export interface ArenaFitnessComponent {
  readonly key: ArenaFitnessComponentKey;
  readonly weight: number;
  /** The measured quantity the score was derived from (null when not measurable). */
  readonly measure: number | null;
  readonly score: number;
  /** weight × score, the component's share of the raw fitness. */
  readonly contribution: number;
  /** Why the score is neutral, when it is neutral for lack of data. */
  readonly neutralReason: string | null;
}

export interface ArenaFitnessResult {
  readonly engineVersion: typeof ARENA_FITNESS_ENGINE_VERSION;
  readonly returnFraction: number;
  /** ln(equity / initial capital). */
  readonly logGrowth: number;
  /** logGrowth × 365 / max(days, annualisation floor). */
  readonly annualizedLogGrowth: number;
  /** −ln(1 − max drawdown): the drawdown in the same log units as growth. */
  readonly drawdownLog: number;
  readonly components: readonly ArenaFitnessComponent[];
  /** Σ weight × score before the risk ceiling. */
  readonly weightedScore: number;
  /** 50 + 50 × drawdown score; 100 while the drawdown is not measurable yet. */
  readonly riskCeiling: number;
  /** min(weighted score, risk ceiling). */
  readonly rawFitness: number;
  readonly evidence: ArenaEvidenceResult;
  /** 50 + evidence progress × (raw − 50). */
  readonly fitness: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Maps a signed measure onto (0, 1): 0 → 0.5, ±reference → 0.5 ± 0.38. */
const squash = (measure: number, reference: number) => 0.5 + 0.5 * Math.tanh(measure / reference);

export class ArenaFitnessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArenaFitnessInputError";
  }
}

function validate(input: ArenaFitnessInput): void {
  const finite = (value: number | null) => value === null || Number.isFinite(value);
  if (!(input.initialCapital > 0) || !(input.equity >= 0)) {
    throw new ArenaFitnessInputError("Initial capital must be positive and equity non-negative.");
  }
  if (!(input.maxDrawdownFraction >= 0 && input.maxDrawdownFraction < 1)) {
    throw new ArenaFitnessInputError("Max drawdown must be a fraction in [0, 1).");
  }
  if (
    !(input.forwardDays >= 0) ||
    !Number.isInteger(input.closedTrades) ||
    input.closedTrades < 0 ||
    ![input.profitFactor, input.averageR, input.winRate, input.averageWin, input.averageLoss, input.exposureFraction].every(finite) ||
    !Number.isFinite(input.costs) ||
    !Number.isFinite(input.closedNetPnl)
  ) {
    throw new ArenaFitnessInputError("Fitness input contains a non-finite or negative count.");
  }
}

export function computeArenaFitness(input: ArenaFitnessInput, policy: ArenaPolicy): ArenaFitnessResult {
  validate(input);
  const fitness = policy.fitness;
  const weights = fitness.weights;
  const hasTrades = input.closedTrades > 0;

  const returnFraction = input.equity / input.initialCapital - 1;
  // A wiped-out participant is as bad as it gets; ln(0) would be −∞.
  const logGrowth = input.equity > 0 ? Math.log(input.equity / input.initialCapital) : Number.NEGATIVE_INFINITY;
  const annualizedLogGrowth = (logGrowth * 365) / Math.max(input.forwardDays, fitness.annualisationFloorDays);
  const drawdownLog = -Math.log(1 - input.maxDrawdownFraction);
  const drawdownFloorLog = -Math.log(1 - fitness.drawdownFloor);

  const component = (
    key: ArenaFitnessComponentKey,
    measure: number | null,
    score: number | null,
    neutralReason: string | null = null
  ): ArenaFitnessComponent => {
    const value = score === null ? 0.5 : clamp01(score);
    return {
      key,
      weight: weights[key],
      measure: measure === null || !Number.isFinite(measure) ? null : measure,
      score: value,
      contribution: weights[key] * value,
      neutralReason: score === null ? neutralReason : null
    };
  };

  // Hit rate is only good or bad relative to the hit rate the payoff needs.
  const breakEvenWinRate =
    input.averageWin !== null && input.averageLoss !== null && input.averageWin > 0
      ? Math.abs(input.averageLoss) / (input.averageWin + Math.abs(input.averageLoss))
      : null;
  const hitRateScore = (): number | null => {
    if (!hasTrades || input.winRate === null) return null;
    if (input.losses === 0) return 1;
    if (input.wins === 0) return 0;
    return breakEvenWinRate === null ? null : squash(input.winRate - breakEvenWinRate, fitness.hitRateBandwidth);
  };

  // Share of the pre-cost edge of the closed trades that costs consumed.
  const preCostEdge = input.closedNetPnl + input.costs;
  const costShare = preCostEdge > 0 ? input.costs / preCostEdge : null;
  const costScore = !hasTrades ? null : preCostEdge > 0 ? 1 - (costShare ?? 0) : input.costs > 0 ? 0 : null;

  const exposure = input.exposureFraction;
  const inMarketGrowth =
    exposure === null ? null : annualizedLogGrowth / Math.max(exposure, fitness.minExposureForEfficiency);

  const components: ArenaFitnessComponent[] = [
    component("growth", annualizedLogGrowth, squash(annualizedLogGrowth, fitness.referenceAnnualLogGrowth)),
    component(
      "riskAdjustedGrowth",
      annualizedLogGrowth / Math.max(drawdownLog, drawdownFloorLog),
      squash(annualizedLogGrowth / Math.max(drawdownLog, drawdownFloorLog), fitness.referenceCalmar)
    ),
    component(
      "drawdown",
      input.maxDrawdownFraction,
      hasTrades || input.maxDrawdownFraction > 0 ? 1 - drawdownLog / -Math.log(1 - fitness.drawdownReference) : null,
      "NO_CLOSED_TRADES"
    ),
    component(
      "profitFactor",
      input.profitFactor,
      !hasTrades
        ? null
        : input.profitFactor === null
          ? input.losses === 0 && input.wins > 0
            ? 1
            : null
          : input.profitFactor <= 0
            ? 0
            : squash(Math.log(input.profitFactor), Math.log(2)),
      "NO_CLOSED_TRADES"
    ),
    component(
      "averageR",
      input.averageR,
      hasTrades && input.averageR !== null ? squash(input.averageR, fitness.referenceAverageR) : null,
      hasTrades ? "NO_PLANNED_RISK" : "NO_CLOSED_TRADES"
    ),
    component("hitRate", input.winRate, hitRateScore(), "NO_CLOSED_TRADES"),
    component(
      "lossStreak",
      input.maxLossStreak,
      hasTrades ? 1 - input.maxLossStreak / fitness.lossStreakReference : null,
      "NO_CLOSED_TRADES"
    ),
    component("costs", costShare, costScore, "NO_CLOSED_TRADES"),
    component(
      "capitalEfficiency",
      inMarketGrowth,
      inMarketGrowth === null || (!hasTrades && (exposure ?? 0) === 0)
        ? null
        : squash(inMarketGrowth, fitness.referenceInMarketLogGrowth),
      "NO_MARKET_EXPOSURE"
    )
  ];

  const weightedScore = components.reduce((sum, entry) => sum + entry.contribution, 0);
  const drawdownComponent = components.find((entry) => entry.key === "drawdown")!;
  const riskCeiling =
    drawdownComponent.neutralReason === null ? NEUTRAL_FITNESS + NEUTRAL_FITNESS * drawdownComponent.score : 100;
  const rawFitness = Math.min(weightedScore, riskCeiling);
  const evidence = evaluateArenaEvidence(
    { closedTrades: input.closedTrades, forwardDays: input.forwardDays },
    policy.evidence
  );
  return {
    engineVersion: ARENA_FITNESS_ENGINE_VERSION,
    returnFraction,
    logGrowth,
    annualizedLogGrowth,
    drawdownLog,
    components,
    weightedScore,
    riskCeiling,
    rawFitness,
    evidence,
    fitness: NEUTRAL_FITNESS + evidence.progress * (rawFitness - NEUTRAL_FITNESS)
  };
}
