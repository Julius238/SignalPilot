import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARENA_POLICY_V1,
  ArenaEvidenceStatus,
  ArenaParticipantStatus,
  ArenaPolicyError,
  ArenaRecommendation,
  ArenaTransitionReason,
  NEUTRAL_FITNESS,
  applyChampionSuccession,
  arenaPolicyHash,
  checkArenaTransition,
  computeArenaFitness,
  evaluateArenaEvidence,
  parseArenaPolicy,
  rankArenaCohort,
  recommendArenaAction,
  type ArenaCohortEntry,
  type ArenaFitnessInput
} from "../src/index.js";

const policy = ARENA_POLICY_V1;

/** A year of forward trading with sufficient evidence, overridable per test. */
function input(overrides: Partial<ArenaFitnessInput> = {}): ArenaFitnessInput {
  return {
    initialCapital: 10_000,
    equity: 10_500,
    forwardDays: 365,
    closedTrades: 40,
    wins: 16,
    losses: 24,
    maxDrawdownFraction: 0.02,
    profitFactor: 1.6,
    averageR: 0.3,
    winRate: 0.4,
    averageWin: 80,
    averageLoss: -35,
    maxLossStreak: 5,
    costs: 120,
    closedNetPnl: 500,
    exposureFraction: 0.3,
    ...overrides
  };
}

describe("arena policy", () => {
  it("parses its own defaults and hashes them stably", () => {
    assert.deepEqual(parseArenaPolicy(JSON.parse(JSON.stringify(policy))), policy);
    assert.equal(arenaPolicyHash(policy), arenaPolicyHash(parseArenaPolicy(JSON.parse(JSON.stringify(policy)))));
  });

  it("refuses weights that do not sum to 100 and inconsistent thresholds", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.fitness.weights.growth = 31;
    assert.throws(() => parseArenaPolicy(broken), ArenaPolicyError);
    const inverted = JSON.parse(JSON.stringify(policy));
    inverted.lifecycle.retireFitness = 45;
    assert.throws(() => parseArenaPolicy(inverted), ArenaPolicyError);
    const missing = JSON.parse(JSON.stringify(policy));
    delete missing.survival.floorFraction;
    assert.throws(() => parseArenaPolicy(missing), ArenaPolicyError);
  });
});

describe("evidence gate", () => {
  it("is provisional at the start and passes by trades or by time, each with a floor", () => {
    assert.equal(evaluateArenaEvidence({ closedTrades: 0, forwardDays: 0 }, policy.evidence).status, ArenaEvidenceStatus.PROVISIONAL);
    // 30 trades but only two days: not enough.
    assert.equal(evaluateArenaEvidence({ closedTrades: 30, forwardDays: 2 }, policy.evidence).status, ArenaEvidenceStatus.PROVISIONAL);
    const byTrades = evaluateArenaEvidence({ closedTrades: 30, forwardDays: 30 }, policy.evidence);
    assert.deepEqual([byTrades.status, byTrades.passedBy], [ArenaEvidenceStatus.SUFFICIENT, "TRADES"]);
    // Six idle months are not evidence either.
    assert.equal(evaluateArenaEvidence({ closedTrades: 3, forwardDays: 200 }, policy.evidence).status, ArenaEvidenceStatus.PROVISIONAL);
    const byTime = evaluateArenaEvidence({ closedTrades: 10, forwardDays: 182 }, policy.evidence);
    assert.deepEqual([byTime.status, byTime.passedBy], [ArenaEvidenceStatus.SUFFICIENT, "TIME"]);
    assert.equal(evaluateArenaEvidence({ closedTrades: 15, forwardDays: 30 }, policy.evidence).progress, 0.5);
  });
});

describe("arena fitness", () => {
  it("is exactly neutral without any forward evidence", () => {
    const result = computeArenaFitness(
      input({
        equity: 10_000,
        forwardDays: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        maxDrawdownFraction: 0,
        profitFactor: null,
        averageR: null,
        winRate: null,
        averageWin: null,
        averageLoss: null,
        maxLossStreak: 0,
        costs: 0,
        closedNetPnl: 0,
        exposureFraction: 0
      }),
      policy
    );
    assert.equal(result.evidence.status, ArenaEvidenceStatus.PROVISIONAL);
    assert.equal(result.fitness, NEUTRAL_FITNESS);
    assert.equal(result.rawFitness, NEUTRAL_FITNESS, "no trades, no growth: every component neutral");
  });

  it("does not reward a large gain bought with an extreme drawdown", () => {
    const reckless = computeArenaFitness(
      input({ equity: 14_000, closedNetPnl: 4_000, maxDrawdownFraction: 0.5, maxLossStreak: 12, averageR: 0.4 }),
      policy
    );
    const robust = computeArenaFitness(input({ equity: 10_500, maxDrawdownFraction: 0.02 }), policy);
    assert.ok(reckless.returnFraction > robust.returnFraction * 5);
    assert.ok(
      robust.fitness > reckless.fitness,
      `robust ${robust.fitness.toFixed(1)} must beat reckless ${reckless.fitness.toFixed(1)}`
    );
    // A drawdown beyond the 10 % reference caps the fitness at neutral.
    assert.equal(reckless.rawFitness, NEUTRAL_FITNESS);
    assert.ok(reckless.weightedScore > reckless.riskCeiling);
  });

  it("measures growth after costs and penalises costs that eat the edge", () => {
    const cheap = computeArenaFitness(input({ costs: 50 }), policy);
    const expensive = computeArenaFitness(input({ costs: 1_500 }), policy);
    assert.ok(cheap.fitness > expensive.fitness);
    const costs = expensive.components.find((component) => component.key === "costs")!;
    assert.ok(Math.abs(costs.measure! - 1_500 / 2_000) < 1e-12);
  });

  it("shrinks toward neutral while the evidence is provisional", () => {
    const full = computeArenaFitness(input(), policy);
    const early = computeArenaFitness(input({ closedTrades: 6, wins: 3, losses: 3, forwardDays: 20 }), policy);
    assert.equal(full.evidence.status, ArenaEvidenceStatus.SUFFICIENT);
    assert.equal(early.evidence.status, ArenaEvidenceStatus.PROVISIONAL);
    assert.ok(Math.abs(early.fitness - NEUTRAL_FITNESS) < Math.abs(early.rawFitness - NEUTRAL_FITNESS));
    assert.equal(full.fitness, full.rawFitness);
  });

  it("reports every component with weight, measure and contribution", () => {
    const result = computeArenaFitness(input(), policy);
    assert.equal(result.components.length, 9);
    assert.equal(
      result.components.reduce((sum, component) => sum + component.weight, 0),
      100
    );
    assert.ok(Math.abs(result.components.reduce((sum, component) => sum + component.contribution, 0) - result.weightedScore) < 1e-9);
    assert.equal(result.rawFitness, Math.min(result.weightedScore, result.riskCeiling));
    assert.ok(Math.abs(result.logGrowth - Math.log(1.05)) < 1e-12);
    assert.deepEqual(computeArenaFitness(input(), policy), result, "deterministic");
  });
});

const sufficient = evaluateArenaEvidence({ closedTrades: 40, forwardDays: 365 }, policy.evidence);
const provisional = evaluateArenaEvidence({ closedTrades: 2, forwardDays: 5 }, policy.evidence);
const base = { netPnl: 100, survivalFloorBreached: false, hardStopReasons: [] as string[] };

describe("arena recommendations (only recommended, never applied)", () => {
  it("holds every performance verdict until the evidence gate", () => {
    const result = recommendArenaAction(
      { ...base, status: ArenaParticipantStatus.ACTIVE, evidence: provisional, fitness: 10 },
      policy
    );
    assert.equal(result.recommendation, ArenaRecommendation.HOLD);
    assert.deepEqual(result.reasonCodes, ["EVIDENCE_PROVISIONAL"]);
  });

  it("recommends probation for a hard stop at once, whatever the evidence", () => {
    const result = recommendArenaAction(
      { ...base, status: ArenaParticipantStatus.CHAMPION, evidence: provisional, fitness: 70, hardStopReasons: ["RISK_LOCK"] },
      policy
    );
    assert.equal(result.recommendation, ArenaRecommendation.PROBATION);
    assert.ok(result.reasonCodes.includes("RISK_LOCK"));
  });

  it("puts a survival-floor breach on probation first and retires only with evidence", () => {
    const early = recommendArenaAction(
      { ...base, status: ArenaParticipantStatus.ACTIVE, evidence: provisional, fitness: 45, survivalFloorBreached: true },
      policy
    );
    assert.equal(early.recommendation, ArenaRecommendation.PROBATION);
    const late = recommendArenaAction(
      { ...base, status: ArenaParticipantStatus.PROBATION, evidence: sufficient, fitness: 45, survivalFloorBreached: true },
      policy
    );
    assert.equal(late.recommendation, ArenaRecommendation.RETIRE);
  });

  it("walks ACTIVE → PROBATION/PROVEN and PROBATION → ACTIVE/RETIRED on fitness bands", () => {
    const at = (status: ArenaParticipantStatus, fitness: number, netPnl = 100) =>
      recommendArenaAction({ ...base, status, evidence: sufficient, fitness, netPnl }, policy).recommendation;
    assert.equal(at(ArenaParticipantStatus.ACTIVE, 39), ArenaRecommendation.PROBATION);
    assert.equal(at(ArenaParticipantStatus.ACTIVE, 50), ArenaRecommendation.HOLD);
    assert.equal(at(ArenaParticipantStatus.ACTIVE, 61), ArenaRecommendation.PROMOTE_PROVEN);
    assert.equal(at(ArenaParticipantStatus.ACTIVE, 61, -5), ArenaRecommendation.HOLD, "no PROVEN at a loss");
    assert.equal(at(ArenaParticipantStatus.PROBATION, 34), ArenaRecommendation.RETIRE);
    assert.equal(at(ArenaParticipantStatus.PROBATION, 45), ArenaRecommendation.HOLD);
    assert.equal(at(ArenaParticipantStatus.PROBATION, 52), ArenaRecommendation.REINSTATE);
    assert.equal(at(ArenaParticipantStatus.RETIRED, 90), ArenaRecommendation.HOLD);
  });

  it("recommends champion succession only past the margin", () => {
    const entry = (
      participantId: string,
      status: ArenaParticipantStatus,
      fitness: number
    ): ArenaCohortEntry => ({
      participantId,
      participantKey: participantId,
      status,
      evidence: ArenaEvidenceStatus.SUFFICIENT,
      fitness,
      rawFitness: fitness,
      recommendation: { recommendation: ArenaRecommendation.HOLD, targetStatus: null, reasonCodes: [] }
    });
    const close = applyChampionSuccession(
      [entry("champ", ArenaParticipantStatus.CHAMPION, 62), entry("proven", ArenaParticipantStatus.PROVEN, 65)],
      policy
    );
    assert.equal(close.get("proven")?.recommendation, ArenaRecommendation.HOLD);
    const clear = applyChampionSuccession(
      [entry("champ", ArenaParticipantStatus.CHAMPION, 62), entry("proven", ArenaParticipantStatus.PROVEN, 68)],
      policy
    );
    assert.equal(clear.get("proven")?.recommendation, ArenaRecommendation.PROMOTE_CHAMPION);
    assert.equal(clear.get("champ")?.recommendation, ArenaRecommendation.DEMOTE_CHAMPION);

    const ranks = rankArenaCohort([
      entry("a", ArenaParticipantStatus.ACTIVE, 55),
      entry("b", ArenaParticipantStatus.CHAMPION, 58),
      entry("c", ArenaParticipantStatus.RETIRED, 99),
      entry("d", ArenaParticipantStatus.CANDIDATE, 99)
    ]);
    assert.deepEqual([...ranks.entries()], [
      ["b", 1],
      ["a", 2]
    ]);
  });
});

describe("arena transitions (operator commands)", () => {
  const context = {
    reason: ArenaTransitionReason.PERFORMANCE,
    evidence: ArenaEvidenceStatus.SUFFICIENT,
    survivalFloorBreached: false,
    hardStop: false,
    forwardStarted: true,
    cohortHasOtherChampion: false
  } as const;

  it("never retires or promotes on performance before the evidence gate", () => {
    for (const to of [ArenaParticipantStatus.RETIRED, ArenaParticipantStatus.PROVEN, ArenaParticipantStatus.PROBATION]) {
      const result = checkArenaTransition(ArenaParticipantStatus.ACTIVE, to, {
        ...context,
        evidence: ArenaEvidenceStatus.PROVISIONAL
      });
      assert.equal(result.ok, false, to);
      if (!result.ok) assert.equal(result.reasonCode, "ARENA_EVIDENCE_INSUFFICIENT");
    }
  });

  it("allows probation on a hard stop or the survival floor without evidence, but only when it is real", () => {
    const provisionalContext = { ...context, evidence: ArenaEvidenceStatus.PROVISIONAL };
    assert.equal(
      checkArenaTransition(ArenaParticipantStatus.CHAMPION, ArenaParticipantStatus.PROBATION, {
        ...provisionalContext,
        reason: ArenaTransitionReason.HARD_STOP,
        hardStop: true
      }).ok,
      true
    );
    assert.equal(
      checkArenaTransition(ArenaParticipantStatus.ACTIVE, ArenaParticipantStatus.PROBATION, {
        ...provisionalContext,
        reason: ArenaTransitionReason.HARD_STOP
      }).ok,
      false
    );
    assert.equal(
      checkArenaTransition(ArenaParticipantStatus.ACTIVE, ArenaParticipantStatus.RETIRED, {
        ...provisionalContext,
        reason: ArenaTransitionReason.SURVIVAL_FLOOR,
        survivalFloorBreached: true
      }).ok,
      false,
      "retirement for losses waits for evidence"
    );
    assert.equal(
      checkArenaTransition(ArenaParticipantStatus.ACTIVE, ArenaParticipantStatus.RETIRED, {
        ...provisionalContext,
        reason: ArenaTransitionReason.STRATEGY_DEFECT
      }).ok,
      true,
      "a broken strategy can be withdrawn at any time"
    );
  });

  it("keeps RETIRED terminal and one champion per cohort", () => {
    assert.equal(checkArenaTransition(ArenaParticipantStatus.RETIRED, ArenaParticipantStatus.ACTIVE, context).ok, false);
    assert.equal(
      checkArenaTransition(ArenaParticipantStatus.PROVEN, ArenaParticipantStatus.CHAMPION, {
        ...context,
        cohortHasOtherChampion: true
      }).ok,
      false
    );
    assert.equal(checkArenaTransition(ArenaParticipantStatus.ACTIVE, ArenaParticipantStatus.CHAMPION, context).ok, false);
  });
});
