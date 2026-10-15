import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVOLUTION_DATA_SPLIT_V1 as SPLIT,
  EVOLUTION_GATES_V1,
  EVOLUTION_GATES_V1_HASH,
  EVOLUTION_GATES_V2,
  EVOLUTION_GATES_V2_HASH,
  EVOLUTION_GATE_VERSIONS,
  analyzeMarketConditions,
  buildResearchContext,
  isGatesV2,
  meanStandardError,
  monthlyReturns,
  neweyWestLag,
  pairedMonthlyTest,
  routedRedundancyGate,
  screeningGates,
  selectFinalists,
  studentT975,
  successorHoldoutGate,
  successorRoute,
  successorScreeningGates,
  successorTThreshold,
  type PairedMonthlyTest,
  type SuccessorScreeningInput,
  type WindowMetrics
} from "../src/index.js";

const POLICY = EVOLUTION_GATES_V2.successor;

/** A WindowMetrics with only the fields the successor rule reads set explicitly. */
function wm(values: { sharpe: number | null; averageR?: number | null; maxDrawdownPct?: number | null; stressedAverageR?: number | null; trades?: number }): WindowMetrics {
  return {
    label: "test",
    from: SPLIT.windows.DISCOVERY.from,
    to: SPLIT.windows.VALIDATION.to,
    startingCapital: 20000,
    trades: values.trades ?? 100,
    wins: 50,
    losses: 50,
    winRatePct: 50,
    profitFactor: 2,
    netPnl: 1000,
    expectancy: 10,
    averageR: values.averageR === undefined ? 0.4 : values.averageR,
    rStdDev: 1,
    tStatR: 3,
    netReturnPct: 5,
    annualizedReturnPct: 1,
    maxDrawdownPct: values.maxDrawdownPct === undefined ? 1 : values.maxDrawdownPct,
    sharpe: values.sharpe,
    sortino: 1,
    calmar: 1,
    exposurePct: 25,
    averageHoldHours: 100,
    tradesPerYear: 20,
    totalExecutionCost: 100,
    costShareOfGrossProfitPct: 10,
    stressed: { multiplier: 2, netPnl: 900, profitFactor: 1.8, averageR: values.stressedAverageR === undefined ? 0.35 : values.stressedAverageR, netReturnPct: 4.5 },
    perSymbol: {},
    buyAndHoldReturnPct: 100,
    buyAndHoldMaxDrawdownPct: 80
  };
}

const PAIRED_OK: PairedMonthlyTest = {
  months: 69,
  informativeMonths: 50,
  meanDifference: 0.0012,
  standardError: 0.0003,
  iidStandardError: 0.00025,
  hacStandardError: 0.0003,
  lag: 3,
  tStat: 4,
  criticalT: studentT975(68),
  naiveTStat: 4.8
};

/** Reference = the challenger's published numbers on discovery + validation (2026-10-15 run). */
const CHALLENGER = {
  discovery: wm({ sharpe: 1.05, averageR: 0.4 }),
  validation: wm({ sharpe: 1.15, averageR: 0.481 }),
  inSample: wm({ sharpe: 1.072, averageR: 0.42, maxDrawdownPct: 0.94, stressedAverageR: 0.388, trades: 121 })
};

function input(overrides: Partial<SuccessorScreeningInput> = {}): SuccessorScreeningInput {
  return {
    rootKey: "ROOT:CRYPTO_REGIME_LONG_V1",
    correlation: 0.97,
    candidate: {
      discovery: wm({ sharpe: 1.3, averageR: 0.45 }),
      validation: wm({ sharpe: 1.35, averageR: 0.5 }),
      inSample: wm({ sharpe: 1.32, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.42, trades: 118 })
    },
    reference: CHALLENGER,
    paired: PAIRED_OK,
    trials: 37,
    screeningsThisMonth: 1,
    ...overrides
  };
}

const failed = (gates: ReturnType<typeof successorScreeningGates>) => gates.filter((gate) => !gate.passed).map((gate) => gate.reasonCode);

describe("gate versions", () => {
  it("keeps v1 exactly as pre-registered on 2026-10-15 (commit efe4df8)", () => {
    assert.equal(EVOLUTION_GATES_V1_HASH, "65da3536653e56c054dd1aea13cba824e30b509085bbe0d367487639d6e82c76");
    assert.equal(EVOLUTION_GATES_V1.version, "evolution-gates-v1");
    assert.equal(isGatesV2(EVOLUTION_GATES_V1), false);
    assert.equal(Object.isFrozen(EVOLUTION_GATES_V1), true);
  });

  it("pins v2 and changes nothing of v1 besides the version and the successor policy", () => {
    assert.equal(EVOLUTION_GATES_V2_HASH, "8341a3c7bcd6a09d852187d5e55ef6190765a7659702d9e620d9817ad8fd5e96");
    const { successor, version, ...shared } = EVOLUTION_GATES_V2;
    const { version: v1Version, ...v1Shared } = EVOLUTION_GATES_V1;
    assert.deepEqual(shared, v1Shared);
    assert.equal(version, "evolution-gates-v2");
    assert.notEqual(version, v1Version);
    assert.equal(successor.correlationTrigger, EVOLUTION_GATES_V1.maxCorrelationWithExisting);
    assert.deepEqual(Object.keys(EVOLUTION_GATE_VERSIONS), ["v1", "v2", "v3"]);
    assert.equal(Object.isFrozen(EVOLUTION_GATES_V2.successor), true);
  });

  it("v1 still rejects every near-copy as redundant", () => {
    const v1 = screeningGates(
      {
        technical: { passed: true, failures: [] },
        dataIntegrity: { passed: true, failures: [] },
        discovery: wm({ sharpe: 1.3 }),
        validation: wm({ sharpe: 1.3 }),
        inSample: wm({ sharpe: 1.3 }),
        folds: { foldsWithTrades: 4, positiveFolds: 4, positiveRatio: 1, concentration: 0.3, worstFold: null },
        correlations: [{ key: "ROOT:CRYPTO_REGIME_LONG_V1", value: 0.97 }],
        champion: wm({ sharpe: 0.3 })
      },
      EVOLUTION_GATES_V1
    );
    assert.equal(v1.find((gate) => gate.gate === "REDUNDANCY")!.reasonCode, "REDUNDANT_WITH_EXISTING");
  });
});

describe("paired statistics", () => {
  it("computes month-end returns, the first month from the equity before the window", () => {
    const curve = [
      { day: "2020-12-31", equity: 100 },
      { day: "2021-01-15", equity: 105 },
      { day: "2021-01-31", equity: 110 },
      { day: "2021-02-28", equity: 99 },
      { day: "2021-03-31", equity: 99 }
    ];
    const returns = monthlyReturns(curve, "2021-01-01T00:00:00.000Z", "2021-03-31T23:59:59.999Z");
    assert.deepEqual(returns.map((entry) => entry.month), ["2021-01", "2021-02", "2021-03"]);
    assert.ok(Math.abs(returns[0]!.value - 0.1) < 1e-12);
    assert.ok(Math.abs(returns[1]!.value - (99 / 110 - 1)) < 1e-12);
    assert.equal(returns[2]!.value, 0);
  });

  it("uses Student-t quantiles for small samples, never the normal 1.96", () => {
    for (const [df, exact] of [[3, 3.1824], [10, 2.2281], [23, 2.0687], [68, 1.9955], [1000, 1.9623]] as const) {
      assert.ok(Math.abs(studentT975(df) - exact) < 0.005, `df ${df}: ${studentT975(df)}`);
    }
    assert.throws(() => studentT975(2), /at least 3/);
    assert.deepEqual([12, 36, 69, 120].map(neweyWestLag), [2, 3, 3, 4]);
  });

  it("widens the standard error for autocorrelated months and never shrinks it below iid", () => {
    // Slow wave around a small positive mean: neighbouring months are strongly correlated.
    const wave = Array.from({ length: 72 }, (_, month) => 0.001 + 0.004 * Math.sin((2 * Math.PI * month) / 24));
    const estimate = meanStandardError(wave)!;
    assert.ok(estimate.hacStandardError > 1.5 * estimate.iidStandardError, JSON.stringify(estimate));
    assert.equal(estimate.standardError, estimate.hacStandardError);
    const naiveT = estimate.mean / estimate.iidStandardError;
    const robustT = estimate.mean / estimate.standardError;
    assert.ok(naiveT > 2.5 && robustT < 2, `naive ${naiveT}, robust ${robustT}`);
    // Alternating signs (negative autocorrelation): HAC would be smaller; the iid error is used instead.
    const alternating = Array.from({ length: 60 }, (_, month) => 0.001 + (month % 2 === 0 ? 0.003 : -0.003));
    const conservative = meanStandardError(alternating)!;
    assert.ok(conservative.hacStandardError < conservative.iidStandardError);
    assert.equal(conservative.standardError, conservative.iidStandardError);
  });

  it("reports an undefined t for identical strategies instead of dividing by zero", () => {
    const curve = Array.from({ length: 400 }, (_, index) => ({ day: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10), equity: 10000 + index }));
    const test = pairedMonthlyTest(curve, curve, "2020-01-01T00:00:00.000Z", "2021-01-31T23:59:59.999Z");
    assert.ok(test.months >= 12);
    assert.equal(test.informativeMonths, 0);
    assert.equal(test.tStat, null);
  });
});

describe("successor routing", () => {
  const route = (correlations: { key: string; value: number | null }[]) => successorRoute({ rootKey: "ROOT:CRYPTO_REGIME_LONG_V1", correlations, policy: POLICY });

  it("routes only near-copies of the own root", () => {
    assert.equal(route([{ key: "ROOT:CRYPTO_REGIME_LONG_V1", value: 0.98 }, { key: "ROOT:CRYPTO_TREND_CORE_LONG_V1", value: 0.4 }]).routed, true);
    assert.equal(route([{ key: "ROOT:CRYPTO_TREND_CORE_LONG_V1", value: 0.95 }, { key: "ROOT:CRYPTO_REGIME_LONG_V1", value: 0.3 }]).routed, false);
    const both = route([{ key: "ROOT:CRYPTO_REGIME_LONG_V1", value: 0.98 }, { key: "ROOT:CRYPTO_TREND_CORE_LONG_V1", value: 0.93 }]);
    assert.equal(both.routed, false);
    assert.deepEqual(both.foreignNearCopies, ["ROOT:CRYPTO_TREND_CORE_LONG_V1"]);
    assert.equal(route([{ key: "ROOT:CRYPTO_REGIME_LONG_V1", value: 0.9 }]).routed, false, "exactly at the trigger is not a near-copy (same strict bound as v1)");
    const routed = route([{ key: "ROOT:CRYPTO_REGIME_LONG_V1", value: 0.98 }]);
    const gate = routedRedundancyGate(routed);
    assert.equal(gate.passed, true);
    assert.equal(gate.reasonCode, "ROUTED_TO_SUCCESSOR_CHECK");
  });
});

describe("successor gates", () => {
  it("accepts a clear, consistent, significant improvement without deterioration", () => {
    const gates = successorScreeningGates(input(), POLICY);
    assert.deepEqual(failed(gates), []);
    assert.deepEqual(gates.map((gate) => gate.gate), ["SUCCESSOR_BUDGET", "SUCCESSOR_IMPROVEMENT", "SUCCESSOR_CONSISTENCY", "SUCCESSOR_SIGNIFICANCE", "SUCCESSOR_NO_DETERIORATION"]);
  });

  it("rejects the three challenger refinements of 2026-10-15 (no rescue by v2)", () => {
    // Published numbers (docs/trading/research/2026-10-15-evolution-v1-e2e-mock.md); not re-evaluated, only shown to fail.
    const reg0002 = { discovery: wm({ sharpe: 1.176 }), validation: wm({ sharpe: 1.079, averageR: 0.377 }), inSample: wm({ sharpe: 1.15, averageR: 0.397, maxDrawdownPct: 0.77, stressedAverageR: 0.372, trades: 110 }) };
    const reg0003 = { discovery: wm({ sharpe: 1.08 }), validation: wm({ sharpe: 1.12, averageR: 0.45 }), inSample: wm({ sharpe: 1.1, averageR: 0.46, maxDrawdownPct: 1.02, trades: 116 }) };
    const reg0001 = { discovery: wm({ sharpe: 1.0 }), validation: wm({ sharpe: 0.9, averageR: 0.27 }), inSample: wm({ sharpe: 1.0, averageR: 0.4, maxDrawdownPct: 0.94, trades: 113 }) };
    assert.ok(failed(successorScreeningGates(input({ candidate: reg0002 }), POLICY)).includes("NOT_A_CLEAR_IMPROVEMENT"));
    assert.ok(failed(successorScreeningGates(input({ candidate: reg0002 }), POLICY)).includes("IMPROVEMENT_NOT_IN_BOTH_WINDOWS"));
    assert.ok(failed(successorScreeningGates(input({ candidate: reg0002 }), POLICY)).includes("DETERIORATES_AGAINST_REFERENCE"));
    assert.ok(failed(successorScreeningGates(input({ candidate: reg0003 }), POLICY)).includes("NOT_A_CLEAR_IMPROVEMENT"));
    assert.ok(failed(successorScreeningGates(input({ candidate: reg0001 }), POLICY)).includes("NOT_A_CLEAR_IMPROVEMENT"));
  });

  it("requires the relative gain against a strong reference", () => {
    const strong = { ...CHALLENGER, inSample: wm({ sharpe: 1.6, averageR: 0.42, maxDrawdownPct: 0.94, stressedAverageR: 0.388, trades: 121 }) };
    const justAbsolute = input({ reference: strong, candidate: { ...input().candidate, inSample: wm({ sharpe: 1.75, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.42, trades: 118 }) } });
    assert.ok(failed(successorScreeningGates(justAbsolute, POLICY)).includes("NOT_A_CLEAR_IMPROVEMENT"), "+0.15 is only +9.4 % of 1.6");
    const enough = input({ reference: strong, candidate: { ...input().candidate, inSample: wm({ sharpe: 1.77, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.42, trades: 118 }) } });
    assert.ok(!failed(successorScreeningGates(enough, POLICY)).includes("NOT_A_CLEAR_IMPROVEMENT"));
  });

  it("replaces the relative gain by an absolute floor for weak, zero or negative references", () => {
    for (const referenceSharpe of [0.3, 0, -0.4]) {
      const reference = { ...CHALLENGER, inSample: wm({ sharpe: referenceSharpe, averageR: 0.42, maxDrawdownPct: 0.94, stressedAverageR: 0.388, trades: 121 }) };
      const belowFloor = input({ reference, candidate: { ...input().candidate, inSample: wm({ sharpe: 0.46, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.42, trades: 118 }) } });
      const gate = successorScreeningGates(belowFloor, POLICY).find((entry) => entry.gate === "SUCCESSOR_IMPROVEMENT")!;
      assert.equal(gate.passed, false, `reference ${referenceSharpe}: beating a weak reference is not enough`);
      assert.match(gate.message, /nicht aussagekräftig/);
      const aboveFloor = input({ reference, candidate: { ...input().candidate, inSample: wm({ sharpe: 0.55, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.42, trades: 118 }) } });
      assert.equal(successorScreeningGates(aboveFloor, POLICY).find((entry) => entry.gate === "SUCCESSOR_IMPROVEMENT")!.passed, true);
    }
  });

  it("fails closed without a computable Sharpe", () => {
    const missing = input({ candidate: { ...input().candidate, inSample: wm({ sharpe: null }) } });
    assert.ok(failed(successorScreeningGates(missing, POLICY)).includes("SHARPE_NOT_COMPUTABLE"));
  });

  it("demands the improvement in discovery and validation", () => {
    const onlyDiscovery = input({ candidate: { ...input().candidate, validation: wm({ sharpe: 1.1, averageR: 0.5 }) } });
    assert.ok(failed(successorScreeningGates(onlyDiscovery, POLICY)).includes("IMPROVEMENT_NOT_IN_BOTH_WINDOWS"));
  });

  it("refuses short or uninformative paired samples and undefined statistics", () => {
    for (const paired of [
      { ...PAIRED_OK, months: 30, criticalT: studentT975(29) },
      { ...PAIRED_OK, informativeMonths: 20 },
      { ...PAIRED_OK, months: 3, criticalT: null }
    ]) {
      assert.ok(failed(successorScreeningGates(input({ paired }), POLICY)).includes("INSUFFICIENT_PAIRED_SAMPLE"));
    }
    assert.ok(failed(successorScreeningGates(input({ paired: { ...PAIRED_OK, tStat: null } }), POLICY)).includes("PAIRED_DIFFERENCE_UNDEFINED"));
  });

  it("raises the significance bar with every configuration ever tested", () => {
    assert.equal(successorTThreshold(POLICY, 1, 1.995), 2);
    assert.ok(Math.abs(successorTThreshold(POLICY, 37, 1.995) - Math.sqrt(2 * Math.log(37))) < 1e-12);
    assert.ok(successorTThreshold(POLICY, 1000, 1.995) > 3.7);
    assert.equal(successorTThreshold(POLICY, 1, 2.3), 2.3, "a small sample's t quantile wins when it is higher");
    const sameT = input({ paired: { ...PAIRED_OK, tStat: 3.2 } });
    assert.equal(successorScreeningGates(sameT, POLICY).find((gate) => gate.gate === "SUCCESSOR_SIGNIFICANCE")!.passed, true);
    assert.equal(successorScreeningGates({ ...sameT, trials: 1000 }, POLICY).find((gate) => gate.gate === "SUCCESSOR_SIGNIFICANCE")!.passed, false);
  });

  it("rejects any deterioration against the reference", () => {
    const base = input().candidate;
    const cases = [
      { ...base, validation: wm({ sharpe: 1.35, averageR: 0.42 }) },
      { ...base, inSample: wm({ sharpe: 1.32, averageR: 0.47, maxDrawdownPct: 1.1, stressedAverageR: 0.42, trades: 118 }) },
      { ...base, inSample: wm({ sharpe: 1.32, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.3, trades: 118 }) },
      { ...base, inSample: wm({ sharpe: 1.32, averageR: 0.47, maxDrawdownPct: 0.9, stressedAverageR: 0.42, trades: 90 }) }
    ];
    for (const candidate of cases) {
      assert.ok(failed(successorScreeningGates(input({ candidate }), POLICY)).includes("DETERIORATES_AGAINST_REFERENCE"), JSON.stringify(candidate.inSample.trades));
    }
  });

  it("limits successor attempts per root and month", () => {
    assert.ok(failed(successorScreeningGates(input({ screeningsThisMonth: POLICY.maxScreeningsPerRootPerMonth + 1 }), POLICY)).includes("SUCCESSOR_MONTHLY_LIMIT_REACHED"));
  });

  it("uses the previously analysed holdout only as a guard, never as evidence", () => {
    const pass = successorHoldoutGate({ rootKey: "ROOT:CRYPTO_REGIME_LONG_V1", candidate: wm({ sharpe: 1.0 }), reference: wm({ sharpe: 1.05 }) }, POLICY);
    assert.equal(pass.passed, true);
    assert.match(pass.message, /nicht als Nachweis/);
    assert.equal(successorHoldoutGate({ rootKey: "ROOT:CRYPTO_REGIME_LONG_V1", candidate: wm({ sharpe: 0.8 }), reference: wm({ sharpe: 1.05 }) }, POLICY).passed, false);
    assert.equal(successorHoldoutGate({ rootKey: "ROOT:CRYPTO_REGIME_LONG_V1", candidate: null, reference: wm({ sharpe: 1.05 }) }, POLICY).passed, false);
  });

  it("caps successor finalists per run", () => {
    const entries = [
      { key: "EVO-REG-0010", score: 90, passedScreening: true, successor: true },
      { key: "EVO-REG-0011", score: 85, passedScreening: true, successor: true },
      { key: "EVO-BRK-0010", score: 70, passedScreening: true }
    ];
    assert.deepEqual(selectFinalists(entries, 2, { maxSuccessors: POLICY.maxFinalistsPerRun }), ["EVO-REG-0010", "EVO-BRK-0010"]);
    assert.deepEqual(selectFinalists(entries, 2), ["EVO-REG-0010", "EVO-REG-0011"], "v1 behaviour without the option is unchanged");
  });

  it("tells the AI about the successor rule only under v2", () => {
    const analysis = analyzeMarketConditions({ split: SPLIT, referenceSymbol: "BTCUSDT", bars: {}, subjects: [] });
    const base = { split: SPLIT, benchmarks: [], analysis, history: [], hypotheses: 2 };
    const v1 = buildResearchContext(base);
    const v2 = buildResearchContext({ ...base, successorRule: true });
    assert.equal(v2.constraints.length, v1.constraints.length + 1);
    assert.match(v2.constraints.at(-1)!, /eigenen Wurzel/);
  });
});
