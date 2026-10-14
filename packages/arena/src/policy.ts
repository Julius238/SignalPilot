/**
 * Arena policy: the thresholds and references the fitness, evidence and
 * survival rules run on. Stored per cohort (hashed) and deliberately separate
 * from every strategy's parameters — a strategy can neither read nor change
 * them, and changing them never touches a running strategy version.
 *
 * None of these values relaxes or replaces a hard risk limit: the risk
 * engine's limits stay the only thing that sizes, refuses or stops a trade.
 */

import { buildSpecificationHash } from "@signalpilot/trading-domain";

export const ARENA_POLICY_VERSION = "arena-policy-v1";

export interface ArenaEvidencePolicy {
  /** Path A: enough trades — at least this many closed forward trades … */
  readonly minClosedTrades: number;
  /** … and at least this long in the forward test (days). */
  readonly minForwardDays: number;
  /** Path B: enough time — this long in the forward test (days) … */
  readonly longRunForwardDays: number;
  /** … and at least this many closed trades. */
  readonly longRunMinClosedTrades: number;
}

export interface ArenaSurvivalPolicy {
  /** Survival floor as a fraction of the participant's own initial capital. */
  readonly floorFraction: number;
}

export interface ArenaFitnessWeights {
  readonly growth: number;
  readonly riskAdjustedGrowth: number;
  readonly drawdown: number;
  readonly profitFactor: number;
  readonly averageR: number;
  readonly hitRate: number;
  readonly lossStreak: number;
  readonly costs: number;
  readonly capitalEfficiency: number;
}

export interface ArenaFitnessPolicy {
  readonly weights: ArenaFitnessWeights;
  /** Annualised log growth that scores 0.88 (tanh(1)) on the growth component. */
  readonly referenceAnnualLogGrowth: number;
  /** Annualised log growth per log-drawdown that scores 0.88 on risk-adjusted growth. */
  readonly referenceCalmar: number;
  /** Drawdown (fraction) at which the drawdown component reaches 0. */
  readonly drawdownReference: number;
  /** Smallest drawdown (fraction) divided by, so a lucky streak cannot divide by zero. */
  readonly drawdownFloor: number;
  /** Results shorter than this are annualised as if they had lasted this long (days). */
  readonly annualisationFloorDays: number;
  /** Average R that scores 0.88. */
  readonly referenceAverageR: number;
  /** Hit-rate excess over break-even that scores 0.88. */
  readonly hitRateBandwidth: number;
  /** Losing streak at which the streak component reaches 0. */
  readonly lossStreakReference: number;
  /** Annualised log growth per unit of time in market that scores 0.88. */
  readonly referenceInMarketLogGrowth: number;
  /** Time-in-market floor for capital efficiency (fraction). */
  readonly minExposureForEfficiency: number;
}

export interface ArenaLifecyclePolicy {
  /** Below this fitness (with sufficient evidence) a participant is recommended for probation. */
  readonly probationFitness: number;
  /** Below this fitness on probation (with sufficient evidence) retirement is recommended. */
  readonly retireFitness: number;
  /** A participant on probation at or above this fitness is recommended back to ACTIVE. */
  readonly reinstateFitness: number;
  /** At or above this fitness (with sufficient evidence and positive P&L) PROVEN is recommended. */
  readonly provenFitness: number;
  /** A PROVEN challenger must beat the champion's fitness by this margin. */
  readonly championMargin: number;
}

export interface ArenaPolicy {
  readonly version: typeof ARENA_POLICY_VERSION;
  readonly evidence: ArenaEvidencePolicy;
  readonly survival: ArenaSurvivalPolicy;
  readonly fitness: ArenaFitnessPolicy;
  readonly lifecycle: ArenaLifecyclePolicy;
}

/**
 * Defaults of Arena V1. Evidence mirrors the comparison rule pre-registered
 * for the first forward test ("30 closed trades or 6 months"), each path with
 * a floor on the other dimension so neither 30 trades in two days nor six idle
 * months counts as evidence.
 */
export const ARENA_POLICY_V1: ArenaPolicy = Object.freeze({
  version: ARENA_POLICY_VERSION,
  evidence: Object.freeze({
    minClosedTrades: 30,
    minForwardDays: 30,
    longRunForwardDays: 182,
    longRunMinClosedTrades: 10
  }),
  survival: Object.freeze({ floorFraction: 0.9 }),
  fitness: Object.freeze({
    weights: Object.freeze({
      growth: 30,
      riskAdjustedGrowth: 25,
      drawdown: 15,
      profitFactor: 7,
      averageR: 7,
      hitRate: 4,
      lossStreak: 4,
      costs: 4,
      capitalEfficiency: 4
    }),
    referenceAnnualLogGrowth: 0.05,
    referenceCalmar: 1,
    drawdownReference: 0.1,
    drawdownFloor: 0.01,
    annualisationFloorDays: 30,
    referenceAverageR: 0.5,
    hitRateBandwidth: 0.1,
    lossStreakReference: 10,
    referenceInMarketLogGrowth: 0.2,
    minExposureForEfficiency: 0.05
  }),
  lifecycle: Object.freeze({
    probationFitness: 40,
    retireFitness: 35,
    reinstateFitness: 50,
    provenFitness: 60,
    championMargin: 5
  })
});

export class ArenaPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArenaPolicyError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function readNumber(source: Record<string, unknown>, key: string, check: (value: number) => boolean): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || !check(value)) {
    throw new ArenaPolicyError(`Arena policy field ${key} is missing or out of range.`);
  }
  return value;
}

const positive = (value: number) => value > 0;
const nonNegative = (value: number) => value >= 0;
const fraction = (value: number) => value > 0 && value < 1;
const score = (value: number) => value >= 0 && value <= 100;

/**
 * Validates a stored policy and returns it typed. Fails closed on any missing,
 * non-finite or inconsistent value; never fills in a default silently.
 */
export function parseArenaPolicy(value: unknown): ArenaPolicy {
  if (!isRecord(value) || value.version !== ARENA_POLICY_VERSION) {
    throw new ArenaPolicyError(`Arena policy must declare version ${ARENA_POLICY_VERSION}.`);
  }
  const { evidence, survival, fitness, lifecycle } = value;
  if (!isRecord(evidence) || !isRecord(survival) || !isRecord(fitness) || !isRecord(lifecycle) || !isRecord(fitness.weights)) {
    throw new ArenaPolicyError("Arena policy sections evidence, survival, fitness(.weights) and lifecycle are required.");
  }
  const weights = fitness.weights;
  const parsed: ArenaPolicy = {
    version: ARENA_POLICY_VERSION,
    evidence: {
      minClosedTrades: readNumber(evidence, "minClosedTrades", nonNegative),
      minForwardDays: readNumber(evidence, "minForwardDays", nonNegative),
      longRunForwardDays: readNumber(evidence, "longRunForwardDays", positive),
      longRunMinClosedTrades: readNumber(evidence, "longRunMinClosedTrades", nonNegative)
    },
    survival: { floorFraction: readNumber(survival, "floorFraction", fraction) },
    fitness: {
      weights: {
        growth: readNumber(weights, "growth", nonNegative),
        riskAdjustedGrowth: readNumber(weights, "riskAdjustedGrowth", nonNegative),
        drawdown: readNumber(weights, "drawdown", nonNegative),
        profitFactor: readNumber(weights, "profitFactor", nonNegative),
        averageR: readNumber(weights, "averageR", nonNegative),
        hitRate: readNumber(weights, "hitRate", nonNegative),
        lossStreak: readNumber(weights, "lossStreak", nonNegative),
        costs: readNumber(weights, "costs", nonNegative),
        capitalEfficiency: readNumber(weights, "capitalEfficiency", nonNegative)
      },
      referenceAnnualLogGrowth: readNumber(fitness, "referenceAnnualLogGrowth", positive),
      referenceCalmar: readNumber(fitness, "referenceCalmar", positive),
      drawdownReference: readNumber(fitness, "drawdownReference", fraction),
      drawdownFloor: readNumber(fitness, "drawdownFloor", fraction),
      annualisationFloorDays: readNumber(fitness, "annualisationFloorDays", positive),
      referenceAverageR: readNumber(fitness, "referenceAverageR", positive),
      hitRateBandwidth: readNumber(fitness, "hitRateBandwidth", positive),
      lossStreakReference: readNumber(fitness, "lossStreakReference", positive),
      referenceInMarketLogGrowth: readNumber(fitness, "referenceInMarketLogGrowth", positive),
      minExposureForEfficiency: readNumber(fitness, "minExposureForEfficiency", fraction)
    },
    lifecycle: {
      probationFitness: readNumber(lifecycle, "probationFitness", score),
      retireFitness: readNumber(lifecycle, "retireFitness", score),
      reinstateFitness: readNumber(lifecycle, "reinstateFitness", score),
      provenFitness: readNumber(lifecycle, "provenFitness", score),
      championMargin: readNumber(lifecycle, "championMargin", nonNegative)
    }
  };
  const weightSum = Object.values(parsed.fitness.weights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(weightSum - 100) > 1e-9) {
    throw new ArenaPolicyError(`Arena fitness weights must sum to 100, got ${weightSum}.`);
  }
  const { retireFitness, probationFitness, reinstateFitness, provenFitness } = parsed.lifecycle;
  if (!(retireFitness <= probationFitness && probationFitness <= reinstateFitness && reinstateFitness <= provenFitness)) {
    throw new ArenaPolicyError("Arena lifecycle thresholds must satisfy retire ≤ probation ≤ reinstate ≤ proven.");
  }
  return parsed;
}

/** Canonical hash a cohort stores next to its policy and every evaluation records. */
export function arenaPolicyHash(policy: ArenaPolicy): string {
  return buildSpecificationHash(policy);
}
