import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVOLUTION_DATA_SPLIT_V1 as SPLIT,
  EVOLUTION_GATES_V1,
  EVOLUTION_GATES_V1_HASH,
  EVOLUTION_GATES_V2_HASH,
  EVOLUTION_GATES_V3,
  EVOLUTION_GATES_V3_HASH,
  EVOLUTION_GATES_V4,
  EVOLUTION_GATES_V4_HASH,
  EVOLUTION_GATE_VERSIONS,
  FAMILY_SPECS,
  assessPortfolioComparison,
  checkComparisonFrame,
  holdoutGuardMeasures,
  independentFamilyFinalGates,
  independentFamilyScreeningGates,
  isGateVersionKey,
  isGatesV2,
  isGatesV3,
  isGatesV4,
  independentFamilyStructure,
  type CompactTrade,
  type DailyEquityPoint,
  type IndependentFamilyStructure,
  type PortfolioAssessment,
  type PortfolioMemberSummary,
  type PortfolioSummary
} from "../src/index.js";

// Synthetic return paths only: the tests prove the decision rules, never anything about a strategy.

const DAY_MS = 86_400_000;
const FROM = Date.parse(SPLIT.windows.DISCOVERY.from) - 30 * DAY_MS;
const TO = Date.parse(SPLIT.windows.VALIDATION.to);
const SLOT = 20_000;
const DAYS = Math.round((TO - FROM) / DAY_MS) + 1;
const dayOf = (index: number) => new Date(FROM + index * DAY_MS).toISOString().slice(0, 10);

/** Deterministic standard-normal noise (Box–Muller over a linear congruential generator). */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 1) / 4294967297;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** Daily returns of a synthetic strategy portfolio. */
function returns(drift: number | ((index: number) => number), volatility: number, seed: number): number[] {
  const draw = noise(seed);
  return Array.from({ length: DAYS }, (_, index) => (typeof drift === "number" ? drift : drift(index)) + volatility * draw());
}

function curveOf(daily: readonly number[], start = SLOT): DailyEquityPoint[] {
  let equity = start;
  return daily.map((value, index) => {
    equity *= 1 + value;
    return { day: dayOf(index), equity };
  });
}

/** Weekly trades whose costs and hold times describe the strategy's geometry. */
function tradesOf(options: { readonly every?: number; readonly holdHours?: number; readonly cost?: number; readonly r?: number; readonly activeDays?: (index: number) => boolean } = {}): CompactTrade[] {
  const trades: CompactTrade[] = [];
  for (let index = 31; index < DAYS; index += options.every ?? 7) {
    if (options.activeDays !== undefined && !options.activeDays(index)) continue;
    const at = `${dayOf(index)}T09:00:00.000Z`;
    const hold = options.holdHours ?? 48;
    const r = options.r ?? 0.3;
    trades.push({
      symbol: "BTCUSDT",
      anchorAt: at,
      openedAt: at,
      closedAt: new Date(Date.parse(at) + hold * 3_600_000).toISOString(),
      exitReason: "TIME_EXIT",
      entryPrice: 30000,
      quantity: 0.1,
      plannedRisk: 50,
      grossPnl: r * 50 + 3,
      fees: (options.cost ?? 4) * 0.6,
      spreadCost: (options.cost ?? 4) * 0.1,
      slippageCost: (options.cost ?? 4) * 0.3,
      netPnl: r * 50 + 3 - (options.cost ?? 4) * 0.6,
      rMultiple: r,
      holdHours: hold,
      marketRegime: "RISK_ON"
    });
  }
  return trades;
}

function member(key: string, daily: readonly number[], trades: readonly CompactTrade[] = tradesOf()): PortfolioMemberSummary {
  const dailyEquity = curveOf(daily);
  return {
    key,
    strategyKey: key,
    researchIdentity: null,
    startingCash: SLOT,
    finalEquity: dailyEquity.at(-1)!.equity,
    trades,
    dailyEquity,
    funnel: { cycles: 1, candidates: trades.length, riskApproved: trades.length, riskRejected: 0, entriesFilled: trades.length },
    groupRejected: 0,
    groupRejections: {},
    invariantViolations: 0,
    killSwitchEngagements: 0,
    outputHash: `hash-${key}`
  };
}

function summary(comparison: PortfolioSummary["comparison"], members: readonly PortfolioMemberSummary[], reserve: number, risk: { open: number; capital: number }): PortfolioSummary {
  const dailyEquity = members[0]!.dailyEquity.map((point, index) => ({ day: point.day, equity: members.reduce((sum, entry) => sum + entry.dailyEquity[index]!.equity, reserve) }));
  return {
    comparison,
    engineVersion: "portfolio-replay-v1/1.0.0",
    groupRiskVersion: "group-risk-v1/1.0.0",
    from: SPLIT.windows.DISCOVERY.from,
    to: SPLIT.windows.VALIDATION.to,
    firstAnchorAt: null,
    lastAnchorAt: null,
    reserveCash: reserve,
    members,
    group: {
      totalCapital: SLOT * (members.length + (reserve > 0 ? 1 : 0)),
      finalEquity: dailyEquity.at(-1)!.equity,
      netReturnPct: null,
      maxDrawdownPct: null,
      averageOpenRiskPct: risk.open,
      peakOpenRiskPct: risk.open * 2,
      averageCapitalBoundPct: risk.capital,
      peakCapitalBoundPct: risk.capital * 2,
      hours: DAYS * 24,
      hoursWithOpenPositions: DAYS * 12,
      stage2Rejections: {},
      groupKillSwitchEngagements: 0,
      dailyEquity
    },
    outputHash: `hash-${comparison}`,
    durationMs: 0
  };
}

const CHAMPION = member("ROOT:CRYPTO_TREND_CORE_LONG_V1", returns(0.00004, 0.0012, 11), tradesOf({ every: 3, holdHours: 17, r: 0.1 }));
const CHALLENGER = member("ROOT:CRYPTO_REGIME_LONG_V1", returns(0.0001, 0.0015, 12), tradesOf({ every: 9, holdHours: 210, r: 0.42 }));
const BASELINE_RISK = { open: 0.14, capital: 1.8 };

function frame(candidate: PortfolioMemberSummary, risk = { open: 0.18, capital: 2.3 }) {
  const baseline = summary("BASELINE", [CHAMPION, CHALLENGER], SLOT, BASELINE_RISK);
  const withCandidate = summary("WITH_CANDIDATE", [CHAMPION, CHALLENGER, candidate], 0, risk);
  return { baseline, withCandidate };
}

function assess(candidate: PortfolioMemberSummary, risk?: { open: number; capital: number }): PortfolioAssessment {
  const { baseline, withCandidate } = frame(candidate, risk);
  return assessPortfolioComparison({ baseline, withCandidate, candidateKey: candidate.key, split: SPLIT, geometryFactor: EVOLUTION_GATES_V4.independentFamily.thresholds.geometryFactor });
}

const STRUCTURE: IndependentFamilyStructure = {
  declaredIndependent: true,
  entryParametersOnly: true,
  exitsFrozen: true,
  ownEntryEvaluator: true,
  preregistrationHash: "f".repeat(64)
};

function decide(assessment: PortfolioAssessment, overrides: { structure?: Partial<IndependentFamilyStructure>; trials?: number; screeningsThisMonth?: number } = {}) {
  return independentFamilyScreeningGates(
    {
      family: "TEST_INDEPENDENT_FAMILY",
      structure: { ...STRUCTURE, ...overrides.structure },
      assessment,
      trials: overrides.trials ?? 53,
      screeningsThisMonth: overrides.screeningsThisMonth ?? 1
    },
    EVOLUTION_GATES_V4
  );
}
const failedOf = (result: ReturnType<typeof decide>) => result.gates.filter((entry) => !entry.passed).map((entry) => entry.gate);
const gateOf = (result: ReturnType<typeof decide>, id: string) => result.gates.find((entry) => entry.gate === id)!;

/** An independent earner: its own drift, independent noise, short holds, many trades. */
const EARNER = member("EVO-TST-0001", returns(0.0006, 0.0012, 21), tradesOf({ every: 4, holdHours: 40, r: 0.25 }));

describe("gates v4 — versioning", () => {
  it("leaves v1, v2 and v3 exactly as pre-registered and pins v4", () => {
    assert.equal(EVOLUTION_GATES_V1_HASH, "65da3536653e56c054dd1aea13cba824e30b509085bbe0d367487639d6e82c76");
    assert.equal(EVOLUTION_GATES_V2_HASH, "8341a3c7bcd6a09d852187d5e55ef6190765a7659702d9e620d9817ad8fd5e96");
    assert.equal(EVOLUTION_GATES_V3_HASH, "250bf745365f432f1b2e5b99e6b39f0a507fd73b341e0061daeb5d413677c88b");
    assert.equal(EVOLUTION_GATES_V4_HASH, "8f55cf8e14b9ca82923f2aae7bab4ed12c318e45c28f31c9f5e03e1ba054554c");
    assert.equal(EVOLUTION_GATES_V4.version, "evolution-gates-v4");
    assert.equal(EVOLUTION_GATE_VERSIONS.v4, EVOLUTION_GATES_V4);
    assert.equal(isGateVersionKey("v4"), true);
  });

  it("keeps every v3 threshold and method for the existing families", () => {
    const { independentFamily, version, ...shared } = EVOLUTION_GATES_V4;
    const { version: v3Version, ...v3Shared } = EVOLUTION_GATES_V3;
    assert.deepEqual(shared, v3Shared);
    assert.notEqual(version, v3Version);
    assert.ok(independentFamily !== undefined);
    // The research cycle routes BREAKOUT_LONG and REGIME_LONG through the v3 lineage rule.
    assert.equal(isGatesV3(EVOLUTION_GATES_V4), true);
    assert.equal(isGatesV2(EVOLUTION_GATES_V4), false);
    assert.equal(isGatesV4(EVOLUTION_GATES_V4), true);
    assert.equal(isGatesV4(EVOLUTION_GATES_V3), false);
    for (const key of Object.keys(EVOLUTION_GATES_V1) as (keyof typeof EVOLUTION_GATES_V1)[]) {
      if (key !== "version") assert.equal(EVOLUTION_GATES_V4[key], EVOLUTION_GATES_V1[key], key);
    }
  });

  it("fixes the simulation the decision rests on: fixed slots, the group rules, both symbols", () => {
    const simulation = EVOLUTION_GATES_V4.independentFamily.simulation;
    assert.equal(simulation.slotCash, 20_000);
    assert.equal(simulation.reserveSlotsInBaseline, 1);
    assert.deepEqual(simulation.groupRules, ["R-010-DAILY-LOSS", "R-013-GROSS-EXPOSURE", "R-014-ASSET-EXPOSURE", "R-015-CORRELATION"]);
    assert.deepEqual(simulation.symbols, ["BTCUSDT", "ETHUSDT"]);
    assert.equal(simulation.engineVersion, "portfolio-replay-v1/1.0.0");
    assert.equal(simulation.groupRiskVersion, "group-risk-v1/1.0.0");
    assert.ok(Object.isFrozen(EVOLUTION_GATES_V4.independentFamily.thresholds));
  });
});

describe("gates v4 — independent families", () => {
  it("leaves both existing families on the v3 lineage rule", () => {
    for (const spec of [FAMILY_SPECS.BREAKOUT_LONG, FAMILY_SPECS.REGIME_LONG]) {
      assert.equal(spec.independence, undefined, spec.family);
      assert.equal(independentFamilyStructure(spec).declaredIndependent, false, spec.family);
    }
  });

  it("reads the structural declaration and refuses a searchable exit", () => {
    const declared = {
      ...FAMILY_SPECS.REGIME_LONG,
      independence: { entryEvaluator: "test-evaluator/1.0.0", researchIdentity: "RESEARCH:TEST_V1", frozenExits: { maxHoldHours: 72 }, preregistrationHash: "a".repeat(64) }
    };
    const structure = independentFamilyStructure(declared);
    assert.equal(structure.declaredIndependent, true);
    assert.equal(structure.exitsFrozen, true);
    assert.equal(structure.preregistrationHash, "a".repeat(64));
    // REGIME_LONG's genome holds stop, target and holding time: not an entry-only family.
    assert.equal(structure.entryParametersOnly, false);
    const entryOnly = { ...declared, parameters: declared.parameters.filter((parameter) => parameter.name === "regimeMinimumConfidence") };
    assert.equal(independentFamilyStructure(entryOnly).entryParametersOnly, true);
  });
});

describe("gates v4 — the comparison frame", () => {
  it("refuses comparisons that are not one fixed-slot frame", () => {
    const { baseline, withCandidate } = frame(EARNER);
    assert.doesNotThrow(() => checkComparisonFrame(baseline, withCandidate, EARNER.key));
    assert.throws(() => checkComparisonFrame(withCandidate, baseline, EARNER.key), /comparison A/);
    assert.throws(() => checkComparisonFrame(baseline, { ...withCandidate, to: "2023-06-30T23:59:59.999Z" }, EARNER.key), /different windows/);
    assert.throws(() => checkComparisonFrame(baseline, { ...withCandidate, group: { ...withCandidate.group, totalCapital: 80_000 } }, EARNER.key), /total capital/);
    assert.throws(() => checkComparisonFrame(baseline, { ...withCandidate, members: [CHALLENGER, CHAMPION, EARNER] }, EARNER.key), /different existing/);
    assert.throws(() => checkComparisonFrame(baseline, { ...withCandidate, members: [CHAMPION, CHALLENGER, { ...EARNER, startingCash: 40_000 }] }, EARNER.key), /equal slot/);
    assert.throws(() => checkComparisonFrame(baseline, withCandidate, "EVO-OTHER"), /must be the last/);
  });
});

describe("gates v4 — the portfolio path", () => {
  it("accepts an independent earner that improves the portfolio with its own, significant return", () => {
    const assessment = assess(EARNER);
    const result = decide(assessment);
    assert.deepEqual(failedOf(result), []);
    assert.equal(result.decision.passed, true);
    assert.ok(assessment.alpha.tStat! > 2.82);
    assert.ok(assessment.incrementTest.tStat! > 2.82);
    assert.equal(gateOf(result, "TRADE_GEOMETRY").reasonCode, "GEOMETRY_DIFFERS_TRADE_METRICS_REPORTED");
  });

  it("does not count an exact copy of an existing strategy as an additional trading edge", () => {
    const copy = { ...CHALLENGER, key: "EVO-COPY-0001" };
    const result = decide(assess(copy));
    assert.equal(result.decision.passed, false);
    assert.equal(gateOf(result, "OWN_ALPHA").reasonCode, "ALPHA_NOT_TESTABLE_COPY_OR_NO_VARIANCE");
  });

  it("does not count a re-weighted or mixed version of existing strategies as an edge", () => {
    const challenger = returns(0.0001, 0.0015, 12);
    const champion = returns(0.00004, 0.0012, 11);
    const levered = member("EVO-LEVER-0001", challenger.map((value) => 2 * value));
    const mixed = member("EVO-MIX-0001", challenger.map((value, index) => 0.5 * value + 0.5 * champion[index]!));
    for (const candidate of [levered, mixed]) {
      const result = decide(assess(candidate));
      assert.equal(result.decision.passed, false, candidate.key);
      assert.equal(gateOf(result, "OWN_ALPHA").passed, false, candidate.key);
    }
  });

  it("rejects a near copy whose extra return is noise", () => {
    const challenger = returns(0.0001, 0.0015, 12);
    const jitter = returns(0, 0.0002, 31);
    const near = member("EVO-NEAR-0001", challenger.map((value, index) => value + jitter[index]!));
    const result = decide(assess(near));
    assert.equal(gateOf(result, "OWN_ALPHA").reasonCode, "NO_OWN_ALPHA");
    assert.equal(result.decision.passed, false);
  });

  it("needs a net gain in each window, not only overall", () => {
    const validationStart = Math.round((Date.parse(SPLIT.windows.VALIDATION.from) - FROM) / DAY_MS);
    const fades = member("EVO-FADE-0001", returns((index) => (index < validationStart ? 0.0009 : -0.0004), 0.0012, 22), tradesOf({ every: 4, holdHours: 40 }));
    const result = decide(assess(fades));
    assert.equal(gateOf(result, "PORTFOLIO_NET_GAIN").passed, false);
    assert.equal(result.decision.passed, false);
  });

  it("rejects an increment that only survives cheap execution", () => {
    const expensive = { ...EARNER, key: "EVO-COSTLY-0001", trades: tradesOf({ every: 1, holdHours: 20, cost: 400 }) };
    const result = decide(assess(expensive));
    assert.equal(gateOf(result, "INCREMENT_COST_STRESS").passed, false);
  });

  it("rejects an increment carried by one market phase", () => {
    const start2020 = Math.round((Date.parse("2020-01-01T00:00:00.000Z") - FROM) / DAY_MS);
    const end2020 = Math.round((Date.parse("2020-12-31T00:00:00.000Z") - FROM) / DAY_MS);
    const inPhase = (index: number) => index >= start2020 && index <= end2020;
    const lucky = member("EVO-LUCKY-0001", returns((index) => (inPhase(index) ? 0.004 : 0), 0.0004, 23), tradesOf({ every: 4, holdHours: 40 }));
    const result = decide(assess(lucky));
    assert.equal(gateOf(result, "INCREMENT_STABILITY").passed, false);
  });

  it("rejects added risk and capital that are not paid", () => {
    const thin = member("EVO-THIN-0001", returns(0.00008, 0.0012, 24), tradesOf({ every: 4, holdHours: 40 }));
    const result = decide(assess(thin, { open: 0.6, capital: 9 }));
    assert.equal(gateOf(result, "PORTFOLIO_RISK_EFFICIENCY").passed, false);
    assert.equal(gateOf(result, "PORTFOLIO_CAPITAL_EFFICIENCY").passed, false);
  });

  it("treats the challenger's trade metrics as minimums only when the geometry is comparable", () => {
    // Built like the challenger (similar hold and frequency) but with weaker trades.
    const lookalike = { ...EARNER, key: "EVO-LOOK-0001", trades: tradesOf({ every: 9, holdHours: 200, r: 0.1 }) };
    const result = decide(assess(lookalike));
    assert.equal(gateOf(result, "TRADE_GEOMETRY").reasonCode, "COMPARABLE_GEOMETRY_WORSE_TRADES");
    assert.equal(gateOf(result, "TRADE_GEOMETRY").passed, false);
  });

  it("requires the structural independence and respects the family budget", () => {
    const assessment = assess(EARNER);
    assert.equal(gateOf(decide(assessment, { structure: { preregistrationHash: null } }), "INDEPENDENT_FAMILY").passed, false);
    assert.equal(gateOf(decide(assessment, { structure: { exitsFrozen: false } }), "INDEPENDENT_FAMILY").passed, false);
    assert.equal(gateOf(decide(assessment, { screeningsThisMonth: 11 }), "LINEAGE_BUDGET").passed, false);
  });

  it("raises the significance bar with the multiple-testing counter and never lowers it", () => {
    const assessment = assess(EARNER);
    const at53 = decide(assessment, { trials: 53 }).decision;
    const at300 = decide(assessment, { trials: 300 }).decision;
    assert.ok(at53.alphaThreshold >= Math.sqrt(2 * Math.log(53)) - 1e-9);
    assert.ok(at300.alphaThreshold > at53.alphaThreshold);
    assert.ok(at53.alphaThreshold >= 2 && at53.incrementThreshold >= 2);
  });

  it("reports α share, R², correlation and signal overlap without deciding on them", () => {
    const assessment = assess(EARNER);
    assert.ok(assessment.alphaShare !== null && assessment.rSquared !== null);
    assert.equal(assessment.existing.length, 2);
    const ids = decide(assessment).gates.map((entry) => entry.gate);
    assert.ok(!ids.some((id) => /SHARE|R_SQUARED|CORRELATION|OVERLAP/.test(id)));
  });
});

describe("gates v4 — finals", () => {
  it("needs neighbours that also add to the portfolio and uses the holdout only to stop", () => {
    const { baseline, withCandidate } = frame(EARNER);
    const holdout = holdoutGuardMeasures(baseline, withCandidate, EARNER.key, SPLIT);
    const good = independentFamilyFinalGates({ neighbours: [{ key: "N1", netReturnDelta: 1, sharpeDelta: 0.1 }], holdout: { ...holdout, sharpeDelta: 0.1, netReturnDelta: 0.5 } }, EVOLUTION_GATES_V4);
    assert.ok(good.every((entry) => entry.passed));
    const fragile = independentFamilyFinalGates({ neighbours: [{ key: "N1", netReturnDelta: 1, sharpeDelta: 0.1 }, { key: "N2", netReturnDelta: -0.2, sharpeDelta: 0.05 }], holdout: { ...holdout, sharpeDelta: 0.1, netReturnDelta: 0.5 } }, EVOLUTION_GATES_V4);
    assert.equal(fragile.find((entry) => entry.gate === "PORTFOLIO_NEIGHBOURS")!.passed, false);
    const stopped = independentFamilyFinalGates({ neighbours: [{ key: "N1", netReturnDelta: 1, sharpeDelta: 0.1 }], holdout: { ...holdout, sharpeDelta: -0.2, netReturnDelta: 0.5 } }, EVOLUTION_GATES_V4);
    assert.equal(stopped.find((entry) => entry.gate === "PORTFOLIO_HOLDOUT_GUARD")!.passed, false);
  });
});
