import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVOLUTION_DATA_SPLIT_V1 as SPLIT,
  EVOLUTION_GATES_V1,
  EVOLUTION_GATES_V1_HASH,
  EVOLUTION_GATES_V2,
  EVOLUTION_GATES_V2_HASH,
  EVOLUTION_GATES_V3,
  EVOLUTION_GATES_V3_HASH,
  EVOLUTION_GATE_VERSIONS,
  analyzeMarketConditions,
  buildResearchContext,
  failedGates,
  isGateVersionKey,
  isGatesV2,
  isGatesV3,
  lineageHoldoutGate,
  lineageRedundancyGate,
  lineageScreeningGates,
  lineageTThreshold,
  portfolioComparison,
  portfolioCurve,
  selectFinalists,
  signalOverlap,
  spanningAlphaTest,
  statusAfterFinal,
  studentT975,
  successorRoute,
  type CompactTrade,
  type DailyEquityPoint,
  type FoldStability,
  type HistoryEntry,
  type LineageReference,
  type LineageScreeningInput,
  type LineageWindows,
  type PairedMonthlyTest,
  type PortfolioComparison,
  type SpanningAlphaTest,
  type WindowMetrics
} from "../src/index.js";

const V3 = EVOLUTION_GATES_V3;

interface WmValues {
  sharpe: number | null;
  averageR?: number | null;
  profitFactor?: number | null;
  maxDrawdownPct?: number | null;
  stressedAverageR?: number | null;
  costShare?: number | null;
  exposurePct?: number | null;
  netReturnPct?: number | null;
  trades?: number;
}

/** A WindowMetrics with the fields gates v3 reads set explicitly. */
function wm(values: WmValues): WindowMetrics {
  return {
    label: "test",
    from: SPLIT.windows.DISCOVERY.from,
    to: SPLIT.windows.VALIDATION.to,
    startingCapital: 20000,
    trades: values.trades ?? 100,
    wins: 50,
    losses: 50,
    winRatePct: 50,
    profitFactor: values.profitFactor === undefined ? 2 : values.profitFactor,
    netPnl: 1000,
    expectancy: 10,
    averageR: values.averageR === undefined ? 0.4 : values.averageR,
    rStdDev: 1,
    tStatR: 3,
    netReturnPct: values.netReturnPct === undefined ? 5 : values.netReturnPct,
    annualizedReturnPct: 1,
    maxDrawdownPct: values.maxDrawdownPct === undefined ? 1 : values.maxDrawdownPct,
    sharpe: values.sharpe,
    sortino: 1,
    calmar: 1,
    exposurePct: values.exposurePct === undefined ? 25 : values.exposurePct,
    averageHoldHours: 100,
    tradesPerYear: 20,
    totalExecutionCost: 100,
    costShareOfGrossProfitPct: values.costShare === undefined ? 5 : values.costShare,
    stressed: { multiplier: 2, netPnl: 900, profitFactor: 1.8, averageR: values.stressedAverageR === undefined ? 0.35 : values.stressedAverageR, netReturnPct: 4.5 },
    perSymbol: {},
    buyAndHoldReturnPct: 100,
    buyAndHoldMaxDrawdownPct: 80
  };
}

const folds = (positiveFolds: number, concentration: number): FoldStability => ({ foldsWithTrades: 5, positiveFolds, positiveRatio: positiveFolds / 5, concentration, worstFold: null });

function windows(discovery: WmValues, validation: WmValues, inSample: WmValues, stability: FoldStability = folds(5, 0.4)): LineageWindows {
  return { discovery: wm(discovery), validation: wm(validation), inSample: wm(inSample), folds: stability };
}

const paired = (tStat: number | null, months = 69, informativeMonths = 60): PairedMonthlyTest => ({
  months,
  informativeMonths,
  meanDifference: tStat === null ? 0 : tStat * 0.0003,
  standardError: 0.0003,
  iidStandardError: 0.00025,
  hacStandardError: 0.0003,
  lag: 3,
  tStat,
  criticalT: months - 1 >= 3 ? studentT975(months - 1) : null,
  naiveTStat: tStat
});

const alpha = (tStat: number | null, months = 69, informativeMonths = 60): SpanningAlphaTest => ({ ...paired(tStat, months, informativeMonths), betas: [0.1, 0.05] });

/**
 * EVO-REG-0004 and the challenger CRYPTO_REGIME_LONG_V1 on discovery,
 * validation and both, as recorded by the first real Claude run
 * (EVO-RUN-20261015T152351-22d709). Illustration only: v3 is never applied
 * to EVO-REG-0004 retroactively.
 */
const REG_0004 = windows(
  { sharpe: 1.1049, averageR: 0.3621, profitFactor: 2.1211, maxDrawdownPct: 0.6975, stressedAverageR: 0.3397, costShare: 3.26, exposurePct: 28.6, netReturnPct: 3.71, trades: 81 },
  { sharpe: 1.1234, averageR: 0.3498, profitFactor: 2.7864, maxDrawdownPct: 0.4895, stressedAverageR: 0.3182, costShare: 5.64, exposurePct: 35.2, netReturnPct: 1.32, trades: 30 },
  { sharpe: 1.11, averageR: 0.3588, profitFactor: 2.2456, maxDrawdownPct: 0.6975, stressedAverageR: 0.3339, costShare: 3.82, exposurePct: 30.3, netReturnPct: 5.08, trades: 111 },
  folds(4, 0.58)
);
const CHALLENGER = windows(
  { sharpe: 1.0425, averageR: 0.3998, profitFactor: 2.2886, maxDrawdownPct: 0.941, stressedAverageR: 0.3708, costShare: 4.06, exposurePct: 23.1, netReturnPct: 4.61, trades: 91 },
  { sharpe: 1.1537, averageR: 0.481, profitFactor: 2.5211, maxDrawdownPct: 0.6025, stressedAverageR: 0.439, costShare: 5.2, exposurePct: 32.4, netReturnPct: 1.81, trades: 30 },
  { sharpe: 1.072, averageR: 0.4199, profitFactor: 2.3485, maxDrawdownPct: 0.941, stressedAverageR: 0.3877, costShare: 4.38, exposurePct: 25.5, netReturnPct: 6.5, trades: 121 },
  folds(4, 0.5)
);
const CHAMPION = windows(
  { sharpe: 0.5665, averageR: 0.205, profitFactor: 1.3252, maxDrawdownPct: 1.35, stressedAverageR: 0.0824, costShare: 14.2, exposurePct: 2.4, netReturnPct: 3.14, trades: 121 },
  { sharpe: -1.2398, averageR: -0.3005, profitFactor: 0.5923, maxDrawdownPct: 1.18, stressedAverageR: -0.4383, costShare: 30, exposurePct: 2.9, netReturnPct: -1.14, trades: 30 },
  { sharpe: 0.2977, averageR: 0.1045, profitFactor: 1.157, maxDrawdownPct: 2.19, stressedAverageR: -0.021, costShare: 16.1, exposurePct: 2.5, netReturnPct: 1.97, trades: 151 },
  folds(3, 0.6)
);

/** A clearly better regime refinement: higher Sharpe in both windows, nothing materially worse. */
const BETTER = windows(
  { sharpe: 1.35, averageR: 0.45, profitFactor: 2.5, maxDrawdownPct: 0.85, stressedAverageR: 0.42, costShare: 4, exposurePct: 24, netReturnPct: 5.6, trades: 90 },
  { sharpe: 1.45, averageR: 0.52, profitFactor: 2.7, maxDrawdownPct: 0.55, stressedAverageR: 0.47, costShare: 5, exposurePct: 31, netReturnPct: 2.2, trades: 29 },
  { sharpe: 1.36, averageR: 0.47, profitFactor: 2.55, maxDrawdownPct: 0.85, stressedAverageR: 0.43, costShare: 4.2, exposurePct: 25, netReturnPct: 8, trades: 119 },
  folds(5, 0.45)
);

const ROOT_REGIME = "ROOT:CRYPTO_REGIME_LONG_V1";
const ROOT_BREAKOUT = "ROOT:CRYPTO_TREND_CORE_LONG_V1";

const reference = (key: string, metrics: LineageWindows, roles: LineageReference["roles"], t: number | null = 4): LineageReference => ({ key, roles, metrics, paired: paired(t) });

const PORTFOLIO_FLAT: PortfolioComparison = {
  members: [ROOT_BREAKOUT, ROOT_REGIME],
  without: { discovery: { netReturnPct: 4, maxDrawdownPct: 1, sharpe: 0.9 }, validation: { netReturnPct: 0.5, maxDrawdownPct: 0.8, sharpe: 0.2 }, inSample: { netReturnPct: 4.5, maxDrawdownPct: 1.1, sharpe: 0.75 } },
  with: { discovery: { netReturnPct: 4, maxDrawdownPct: 1, sharpe: 0.92 }, validation: { netReturnPct: 0.5, maxDrawdownPct: 0.8, sharpe: 0.21 }, inSample: { netReturnPct: 4.5, maxDrawdownPct: 1.1, sharpe: 0.77 } },
  alpha: alpha(0.8)
};

const PORTFOLIO_GAIN: PortfolioComparison = {
  members: [ROOT_BREAKOUT, ROOT_REGIME],
  without: { discovery: { netReturnPct: 4, maxDrawdownPct: 1.2, sharpe: 0.9 }, validation: { netReturnPct: 0.5, maxDrawdownPct: 0.9, sharpe: 0.2 }, inSample: { netReturnPct: 4.5, maxDrawdownPct: 1.2, sharpe: 0.75 } },
  with: { discovery: { netReturnPct: 6, maxDrawdownPct: 0.9, sharpe: 1.15 }, validation: { netReturnPct: 1.5, maxDrawdownPct: 0.7, sharpe: 0.6 }, inSample: { netReturnPct: 7.5, maxDrawdownPct: 0.9, sharpe: 1.05 } },
  alpha: alpha(3.4)
};

function input(overrides: Partial<LineageScreeningInput> = {}): LineageScreeningInput {
  return {
    family: "REGIME_LONG",
    candidate: BETTER,
    references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "PARENT", "FAMILY_BEST"])],
    existing: [
      { key: ROOT_BREAKOUT, correlation: 0.4, signalOverlap: 0.2 },
      { key: ROOT_REGIME, correlation: 0.95, signalOverlap: 0.9 }
    ],
    portfolio: PORTFOLIO_FLAT,
    trials: 43,
    screeningsThisMonth: 1,
    ...overrides
  };
}

const byGate = (gates: ReturnType<typeof lineageScreeningGates>["gates"], id: string) => gates.find((gate) => gate.gate === id)!;
const blocking = (gates: ReturnType<typeof lineageScreeningGates>["gates"]) => failedGates(gates).map((gate) => gate.gate);

describe("gate versions with v3", () => {
  it("leaves v1 and v2 exactly as pre-registered and pins v3", () => {
    assert.equal(EVOLUTION_GATES_V1_HASH, "65da3536653e56c054dd1aea13cba824e30b509085bbe0d367487639d6e82c76");
    assert.equal(EVOLUTION_GATES_V2_HASH, "8341a3c7bcd6a09d852187d5e55ef6190765a7659702d9e620d9817ad8fd5e96");
    assert.equal(EVOLUTION_GATES_V3_HASH, "250bf745365f432f1b2e5b99e6b39f0a507fd73b341e0061daeb5d413677c88b");
    // v4 is registered next to v3 (gates-v4.test.ts); v1–v3 keep their hashes.
    assert.deepEqual(Object.keys(EVOLUTION_GATE_VERSIONS), ["v1", "v2", "v3", "v4"]);
    assert.equal(isGateVersionKey("v3"), true);
    assert.equal(isGateVersionKey("v5"), false);
  });

  it("builds v3 on the v1 base gates and has no successor switch", () => {
    const { lineage, version, ...shared } = EVOLUTION_GATES_V3;
    const { version: v1Version, ...v1Shared } = EVOLUTION_GATES_V1;
    assert.deepEqual(shared, v1Shared);
    assert.equal(version, "evolution-gates-v3");
    assert.notEqual(version, v1Version);
    assert.equal(isGatesV3(EVOLUTION_GATES_V3), true);
    assert.equal(isGatesV2(EVOLUTION_GATES_V3), false, "v3 never routes by correlation");
    assert.equal(isGatesV3(EVOLUTION_GATES_V2), false);
    assert.equal(Object.isFrozen(lineage), true);
    assert.equal(Object.isFrozen(lineage.value), true);
    assert.equal(Object.isFrozen(lineage.diversification), true);
    assert.equal(Object.isFrozen(lineage.methods), true);
    // The successor thresholds carry over unchanged; only the switch disappears.
    assert.equal(lineage.value.minSharpeDelta, EVOLUTION_GATES_V2.successor.minSharpeDelta);
    assert.equal(lineage.value.minPairedT, EVOLUTION_GATES_V2.successor.minPairedT);
  });
});

describe("gates v3 — closing the correlation loophole", () => {
  it("v2 let EVO-REG-0004 (correlation 0.887) escape the comparison with its root", () => {
    const route = successorRoute({ rootKey: ROOT_REGIME, correlations: [{ key: ROOT_REGIME, value: 0.887 }], policy: EVOLUTION_GATES_V2.successor });
    assert.equal(route.routed, false);
  });

  it("v3 measures EVO-REG-0004 against the challenger anyway and rejects it", () => {
    const { gates, assessment } = lineageScreeningGates(
      input({
        candidate: REG_0004,
        references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "PARENT", "FAMILY_BEST"], 0.9)],
        existing: [
          { key: ROOT_BREAKOUT, correlation: 0.405, signalOverlap: 0.1 },
          { key: ROOT_REGIME, correlation: 0.887, signalOverlap: 0.85 }
        ]
      }),
      V3
    );
    assert.equal(assessment.path, null);
    assert.deepEqual(blocking(gates), ["LINEAGE_DECISION"]);
    assert.equal(byGate(gates, "LINEAGE_DECISION").reasonCode, "NO_VALUE_NO_DIVERSIFICATION");
    assert.equal(byGate(gates, "VALUE_RISK_ADJUSTED").passed, false, "ΔSharpe 0.04 is no clear improvement");
    assert.equal(byGate(gates, "VALUE_CONSISTENCY").passed, false, "worse than the challenger in validation");
    assert.equal(byGate(gates, "VALUE_SIGNIFICANCE").passed, false);
    const deterioration = byGate(gates, "VALUE_NO_MATERIAL_DETERIORATION");
    assert.equal(deterioration.passed, false);
    assert.match(deterioration.message, /Ø R Validierung 0,35 gegenüber 0,48/);
    assert.match(deterioration.message, /doppelten Kosten/);
    assert.equal(byGate(gates, "DIVERSIFICATION_INDEPENDENCE").passed, false, "a near-copy is never independent");
    assert.equal(assessment.references[0]!.deteriorations.length, 2);
  });

  it("decides the value path identically at correlation 0.89, 0.91 or 0.6", () => {
    const verdict = (correlation: number) => {
      const { gates } = lineageScreeningGates(
        input({ candidate: REG_0004, references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "FAMILY_BEST"], 0.9)], existing: [{ key: ROOT_REGIME, correlation, signalOverlap: 0.85 }] }),
        V3
      );
      return gates.filter((gate) => gate.gate.startsWith("VALUE_")).map((gate) => `${gate.gate}:${gate.passed}`);
    };
    assert.deepEqual(verdict(0.89), verdict(0.91));
    assert.deepEqual(verdict(0.89), verdict(0.6));
  });

  it("a weaker successor cannot pass by lowering its correlation: it then needs to be a real diversifier", () => {
    // Same weak numbers, correlation pushed to 0.45 but entries shared with the root (exits changed).
    const { gates, assessment } = lineageScreeningGates(
      input({ candidate: REG_0004, references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "FAMILY_BEST"], 0.9)], existing: [{ key: ROOT_REGIME, correlation: 0.45, signalOverlap: 0.8 }], portfolio: PORTFOLIO_GAIN }),
      V3
    );
    assert.equal(assessment.path, null);
    assert.equal(byGate(gates, "DIVERSIFICATION_INDEPENDENCE").reasonCode, "NOT_INDEPENDENT_SHARED_SIGNALS");
  });

  it("accepts a clearly better successor through the value path, whatever its correlation", () => {
    for (const correlation of [0.97, 0.7]) {
      const { gates, assessment } = lineageScreeningGates(input({ existing: [{ key: ROOT_REGIME, correlation, signalOverlap: 0.9 }] }), V3);
      assert.equal(assessment.path, "VALUE", `correlation ${correlation}`);
      assert.deepEqual(blocking(gates), []);
      assert.equal(byGate(gates, "DIVERSIFICATION_INDEPENDENCE").informational, true);
      assert.equal(byGate(gates, "VALUE_RISK_ADJUSTED").informational, undefined);
    }
  });

  it("compares with root, parent and family best separately — beating one is not enough", () => {
    const strongerSibling = windows(
      { sharpe: 1.5, averageR: 0.5 },
      { sharpe: 1.6, averageR: 0.55 },
      { sharpe: 1.55, averageR: 0.52, maxDrawdownPct: 0.8, stressedAverageR: 0.47, trades: 110 }
    );
    const { gates, assessment } = lineageScreeningGates(
      input({
        references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "PARENT"]), reference("EVO-REG-0099", strongerSibling, ["FAMILY_BEST"], -1.2)]
      }),
      V3
    );
    assert.equal(assessment.valuePassed, false);
    assert.equal(assessment.references.find((entry) => entry.key === ROOT_REGIME)!.improvement, true);
    assert.equal(assessment.references.find((entry) => entry.key === "EVO-REG-0099")!.improvement, false);
    assert.match(byGate(gates, "VALUE_RISK_ADJUSTED").message, /EVO-REG-0099 \(bester Familienvertreter\)/);
  });

  it("against a weak reference demands an own Sharpe of 0.5 instead of a relative gain", () => {
    const weak = windows({ sharpe: 0.62 }, { sharpe: 0.2 }, { sharpe: 0.45, averageR: 0.2, profitFactor: 1.5, trades: 120 }, folds(5, 0.4));
    const breakout = (sharpe: number) =>
      lineageScreeningGates(
        input({
          family: "BREAKOUT_LONG",
          candidate: windows({ sharpe: sharpe + 0.2 }, { sharpe: 0.3 }, { sharpe, averageR: 0.25, profitFactor: 1.5, trades: 120 }, folds(5, 0.4)),
          references: [reference(ROOT_BREAKOUT, CHAMPION, ["ROOT", "PARENT", "FAMILY_BEST"])],
          existing: [{ key: ROOT_BREAKOUT, correlation: 0.8, signalOverlap: 0.9 }]
        }),
        V3
      ).assessment.references[0]!.improvement;
    assert.equal(breakout(0.48), false, "Δ 0.18 but own Sharpe below 0.5");
    assert.equal(breakout(0.55), true);
    void weak;
  });
});

describe("gates v3 — not every metric has to improve", () => {
  it("tolerates small losses in profit factor and drawdown", () => {
    const tolerated = windows(
      { sharpe: 1.35, averageR: 0.45 },
      { sharpe: 1.45, averageR: 0.46 },
      { sharpe: 1.36, averageR: 0.47, profitFactor: 2.15, maxDrawdownPct: 1.02, stressedAverageR: 0.36, costShare: 9, exposurePct: 27, trades: 100 },
      folds(4, 0.6)
    );
    const { assessment } = lineageScreeningGates(input({ candidate: tolerated }), V3);
    assert.deepEqual(assessment.references[0]!.deteriorations, []);
    assert.equal(assessment.path, "VALUE");
  });

  it("rejects material losses in cost robustness, phases or capital binding", () => {
    const check = (inSample: WmValues, stability = folds(5, 0.45)) =>
      lineageScreeningGates(input({ candidate: windows({ sharpe: 1.35, averageR: 0.45 }, { sharpe: 1.45, averageR: 0.52 }, { sharpe: 1.36, averageR: 0.47, profitFactor: 2.5, trades: 119, ...inSample }, stability) }), V3).assessment.references[0]!
        .deteriorations;
    assert.match(check({ stressedAverageR: 0.3 }).join(), /doppelten Kosten/);
    assert.match(check({ costShare: 16 }).join(), /Kostenanteil/);
    assert.match(check({}, folds(2, 0.45)).join(), /positive Marktphasen/);
    assert.match(check({}, folds(5, 0.7)).join(), /Phasenanteil/);
    assert.match(check({ exposurePct: 40, netReturnPct: 8 }).join(), /Kapitalbindung/);
    assert.deepEqual(check({ exposurePct: 40, netReturnPct: 14 }), [], "more time in the market is fine when each unit of it earns more");
    assert.match(check({ profitFactor: 1.9 }).join(), /Profit Factor/);
    assert.match(check({ trades: 80 }).join(), /Trades/);
  });
});

describe("gates v3 — genuine diversification", () => {
  const diversifier = windows(
    { sharpe: 0.7, averageR: 0.25 },
    { sharpe: 0.6, averageR: 0.2 },
    { sharpe: 0.66, averageR: 0.23, profitFactor: 1.6, maxDrawdownPct: 1.4, stressedAverageR: 0.15, costShare: 12, exposurePct: 18, trades: 140 }
  );
  const independent = [
    { key: ROOT_BREAKOUT, correlation: 0.15, signalOverlap: 0.1 },
    { key: ROOT_REGIME, correlation: 0.2, signalOverlap: 0.05 }
  ];

  it("accepts a weaker but independent strategy that demonstrably improves the portfolio", () => {
    const { gates, assessment } = lineageScreeningGates(
      input({ candidate: diversifier, references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "PARENT", "FAMILY_BEST"], -1)], existing: independent, portfolio: PORTFOLIO_GAIN }),
      V3
    );
    assert.equal(assessment.path, "DIVERSIFICATION");
    assert.deepEqual(blocking(gates), []);
    assert.equal(byGate(gates, "LINEAGE_DECISION").reasonCode, "GENUINE_DIVERSIFIER");
    assert.equal(byGate(gates, "VALUE_RISK_ADJUSTED").passed, false);
    assert.equal(byGate(gates, "VALUE_RISK_ADJUSTED").informational, true);
    assert.equal(statusAfterFinal(gates, []), "PROPOSED");
  });

  it("refuses a parameter variant that only looks independent by its daily returns", () => {
    const { gates, assessment } = lineageScreeningGates(
      input({ candidate: diversifier, existing: [independent[0]!, { key: ROOT_REGIME, correlation: 0.3, signalOverlap: 0.85 }], portfolio: PORTFOLIO_GAIN }),
      V3
    );
    assert.equal(assessment.path, null);
    assert.equal(byGate(gates, "DIVERSIFICATION_INDEPENDENCE").passed, false);
  });

  it("needs a portfolio gain in both windows, no deeper drawdown and a significant α", () => {
    const base = { candidate: diversifier, references: [reference(ROOT_REGIME, CHALLENGER, ["ROOT", "FAMILY_BEST"], -1)], existing: independent };
    const oneWindow: PortfolioComparison = { ...PORTFOLIO_GAIN, with: { ...PORTFOLIO_GAIN.with, validation: { ...PORTFOLIO_GAIN.with.validation, sharpe: 0.15 } } };
    assert.equal(lineageScreeningGates(input({ ...base, portfolio: oneWindow }), V3).assessment.path, null);
    const deeper: PortfolioComparison = { ...PORTFOLIO_GAIN, with: { ...PORTFOLIO_GAIN.with, inSample: { ...PORTFOLIO_GAIN.with.inSample, maxDrawdownPct: 1.3 } } };
    assert.equal(lineageScreeningGates(input({ ...base, portfolio: deeper }), V3).assessment.path, null);
    const weakAlpha: PortfolioComparison = { ...PORTFOLIO_GAIN, alpha: alpha(2.3) };
    const result = lineageScreeningGates(input({ ...base, portfolio: weakAlpha }), V3);
    assert.equal(result.assessment.path, null, "t 2.3 is below √(2·ln 43) = 2.74");
    assert.equal(byGate(result.gates, "DIVERSIFICATION_SIGNIFICANCE").limit, "2,74");
    const shortSample: PortfolioComparison = { ...PORTFOLIO_GAIN, alpha: alpha(4, 30, 30) };
    assert.equal(byGate(lineageScreeningGates(input({ ...base, portfolio: shortSample }), V3).gates, "DIVERSIFICATION_SIGNIFICANCE").reasonCode, "INSUFFICIENT_ALPHA_SAMPLE");
  });
});

describe("gates v3 — budget, redundancy, holdout, selection", () => {
  it("blocks a family once its monthly validation budget is used up", () => {
    const { gates } = lineageScreeningGates(input({ screeningsThisMonth: V3.lineage.maxScreeningsPerFamilyPerMonth + 1 }), V3);
    assert.deepEqual(blocking(gates), ["LINEAGE_BUDGET"]);
  });

  it("keeps foreign near-copies redundant but leaves the own lineage to the lineage check", () => {
    assert.equal(lineageRedundancyGate({ correlations: [{ key: ROOT_BREAKOUT, value: 0.93 }], lineageKeys: [ROOT_REGIME] }, V3).reasonCode, "REDUNDANT_WITH_EXISTING");
    const own = lineageRedundancyGate({ correlations: [{ key: ROOT_REGIME, value: 0.97 }], lineageKeys: [ROOT_REGIME] }, V3);
    assert.equal(own.passed, true);
    assert.equal(own.reasonCode, "NEAR_COPY_OF_OWN_LINEAGE");
  });

  it("uses the holdout only as a guard: EVO-REG-0004 would also have been stopped there", () => {
    const holdout = (sharpe: number) => wm({ sharpe });
    const reg0004 = lineageHoldoutGate({ path: "VALUE", candidate: holdout(0.68), references: [{ key: ROOT_REGIME, holdout: holdout(1.08) }], portfolio: null }, V3);
    assert.equal(reg0004.passed, false);
    assert.equal(reg0004.reasonCode, "WORSE_THAN_LINEAGE_ON_HOLDOUT");
    assert.match(lineageHoldoutGate({ path: "VALUE", candidate: holdout(1.05), references: [{ key: ROOT_REGIME, holdout: holdout(1.08) }], portfolio: null }, V3).message, /nicht als Nachweis/);
    assert.equal(lineageHoldoutGate({ path: "DIVERSIFICATION", candidate: null, references: [], portfolio: { sharpeWith: 0.9, sharpeWithout: 1 } }, V3).passed, false);
    assert.equal(lineageHoldoutGate({ path: "DIVERSIFICATION", candidate: null, references: [], portfolio: { sharpeWith: 0.98, sharpeWithout: 1 } }, V3).passed, true);
    assert.equal(lineageHoldoutGate({ path: "DIVERSIFICATION", candidate: null, references: [], portfolio: null }, V3).passed, false);
  });

  it("selects at most one finalist per family", () => {
    const selected = selectFinalists(
      [
        { key: "EVO-REG-0010", score: 80, passedScreening: true, group: "REGIME_LONG" },
        { key: "EVO-REG-0011", score: 79, passedScreening: true, group: "REGIME_LONG" },
        { key: "EVO-BRK-0010", score: 60, passedScreening: true, group: "BREAKOUT_LONG" }
      ],
      2,
      { maxPerGroup: 1 }
    );
    assert.deepEqual(selected, ["EVO-REG-0010", "EVO-BRK-0010"]);
  });

  it("never lets an informational sub-check reject on its own", () => {
    const { gates } = lineageScreeningGates(input(), V3);
    assert.ok(gates.some((gate) => !gate.passed && gate.informational === true), "the diversification path failed informationally");
    assert.equal(statusAfterFinal(gates, []), "PROPOSED");
  });

  it("uses the multiple-testing threshold that never falls below the Student-t quantile", () => {
    assert.equal(lineageTThreshold(2, 43, studentT975(68)), Math.sqrt(2 * Math.log(43)));
    assert.equal(lineageTThreshold(2, 2, studentT975(5)), studentT975(5));
    assert.equal(lineageTThreshold(2, 43, null), Number.POSITIVE_INFINITY);
  });
});

// ─── Pure helpers ─────────────────────────────────────────────────────────

const day = (index: number) => new Date(Date.UTC(2018, 3, 1) + index * 86_400_000).toISOString().slice(0, 10);
function curve(returns: (index: number) => number, days = 2100, start = 20000): DailyEquityPoint[] {
  const points: DailyEquityPoint[] = [];
  let equity = start;
  for (let index = 0; index < days; index += 1) {
    equity *= 1 + returns(index);
    points.push({ day: day(index), equity });
  }
  return points;
}
/** Deterministic pseudo-noise in −1 … 1. */
const noise = (seed: number) => (index: number) => Math.sin(index * 12.9898 + seed * 78.233) * 0.5 + Math.sin(index * 4.1414 + seed) * 0.5;
const portfolioCurveOf = (curves: DailyEquityPoint[][]) => portfolioCurve(curves.map((entry, index) => ({ key: String(index), curve: entry, startingCash: entry[0]!.equity })));

describe("spanning α, signal overlap and the portfolio comparison", () => {
  const from = SPLIT.windows.DISCOVERY.from;
  const to = SPLIT.windows.VALIDATION.to;
  const market = noise(1);

  it("finds no α in a copy of an existing strategy and a clear α in an independent earner", () => {
    const strong = curve((index) => 0.0006 + 0.004 * market(index));
    const weak = curve((index) => 0.00005 + 0.005 * noise(3)(index));
    const copy = curve((index) => 0.0006 + 0.004 * market(index), 2100, 5000);
    const copyTest = spanningAlphaTest(copy, [strong, weak], from, to);
    assert.ok(copyTest.betas !== null && Math.abs(copyTest.betas[0]! - 1) < 1e-9 && Math.abs(copyTest.betas[1]!) < 1e-9, `β ${copyTest.betas}`);
    assert.equal(copyTest.tStat, null, "an exact copy leaves nothing to test");
    assert.equal(copyTest.criticalT, studentT975(copyTest.months - 3));
    // Against the equal-weight mix the same copy shows an "α": it merely overweights the strong strategy.
    const mix = portfolioCurveOf([strong, weak]);
    const mixTest = spanningAlphaTest(copy, [mix], from, to);
    assert.ok(mixTest.tStat !== null && mixTest.tStat > 2, `t against the mix ${mixTest.tStat}`);
    const earner = curve((index) => 0.0008 + 0.002 * noise(7)(index));
    const earnerTest = spanningAlphaTest(earner, [strong, weak], from, to);
    assert.ok(earnerTest.tStat !== null && earnerTest.tStat > 3, `t ${earnerTest.tStat}`);
    assert.ok(earnerTest.months >= 60);
  });

  it("measures shared entries per symbol within the signal window", () => {
    const trade = (symbol: string, anchorAt: string): CompactTrade => ({
      symbol,
      anchorAt,
      openedAt: anchorAt,
      closedAt: anchorAt,
      exitReason: "TP",
      entryPrice: 1,
      quantity: 1,
      plannedRisk: 1,
      grossPnl: 1,
      fees: 0,
      spreadCost: 0,
      slippageCost: 0,
      netPnl: 1,
      rMultiple: 1,
      holdHours: 1,
      marketRegime: null
    });
    const reference = [trade("BTCUSDT", "2020-01-01T00:00:00.000Z"), trade("ETHUSDT", "2020-02-01T00:00:00.000Z")];
    assert.equal(signalOverlap([trade("BTCUSDT", "2020-01-01T12:00:00.000Z"), trade("ETHUSDT", "2020-02-01T23:00:00.000Z")], reference, 24), 1);
    assert.equal(signalOverlap([trade("ETHUSDT", "2020-01-01T12:00:00.000Z"), trade("BTCUSDT", "2020-03-01T00:00:00.000Z")], reference, 24), 0, "same time, other symbol is no shared signal");
    assert.equal(signalOverlap([trade("BTCUSDT", "2020-01-01T12:00:00.000Z"), trade("BTCUSDT", "2020-05-01T00:00:00.000Z")], reference, 24), 0.5);
    // Entering while the reference already holds the same symbol is the same opportunity, however late.
    const held = [{ ...trade("BTCUSDT", "2021-01-01T00:00:00.000Z"), closedAt: "2021-01-20T00:00:00.000Z" }];
    assert.equal(signalOverlap([trade("BTCUSDT", "2021-01-10T00:00:00.000Z"), trade("BTCUSDT", "2021-01-25T00:00:00.000Z")], held, 24), 0.5);
    assert.equal(signalOverlap([], reference, 24), null);
  });

  it("improves the portfolio Sharpe with an independent earner, not with a copy", () => {
    const a = curve((index) => 0.0003 + 0.005 * market(index));
    const b = curve((index) => 0.0002 + 0.005 * noise(3)(index));
    const existing = [
      { key: ROOT_BREAKOUT, curve: a, startingCash: 20000 },
      { key: ROOT_REGIME, curve: b, startingCash: 20000 }
    ];
    const windowsOf = { discovery: SPLIT.windows.DISCOVERY, validation: SPLIT.windows.VALIDATION };
    const earner = portfolioComparison({ existing, candidate: { key: "X", curve: curve((index) => 0.0004 + 0.003 * noise(9)(index)), startingCash: 20000 }, windows: windowsOf });
    assert.ok(earner.with.inSample.sharpe! > earner.without.inSample.sharpe!);
    assert.deepEqual(earner.members, [ROOT_BREAKOUT, ROOT_REGIME]);
    const copy = portfolioComparison({ existing, candidate: { key: "Y", curve: a, startingCash: 20000 }, windows: windowsOf });
    assert.ok(copy.with.inSample.sharpe! - copy.without.inSample.sharpe! < 0.1);
  });
});

describe("research context under v3", () => {
  const analysis = analyzeMarketConditions({ split: SPLIT, referenceSymbol: "BTCUSDT", bars: {}, subjects: [] });
  const entry = (candidateKey: string, operatorDecision?: HistoryEntry["operatorDecision"]): HistoryEntry => ({
    candidateKey,
    family: "REGIME_LONG",
    parentKey: ROOT_REGIME,
    generation: 1,
    hypothesis: "h",
    changes: [],
    parameters: {},
    verdict: "PASSED_SCREENING",
    failedGates: [],
    discovery: null,
    ...(operatorDecision === undefined ? {} : { operatorDecision })
  });

  it("explains the lineage rule and the remaining budget, and drops operator-rejected parents", () => {
    const context = buildResearchContext({
      split: SPLIT,
      benchmarks: [],
      analysis,
      history: [entry("EVO-REG-0004", "REJECTED_BY_OPERATOR"), entry("EVO-REG-0007")],
      hypotheses: 4,
      lineageRule: { remainingScreenings: { BREAKOUT_LONG: 4, REGIME_LONG: 0 } }
    });
    assert.ok(context.constraints.some((constraint) => constraint.includes("unabhängig von seiner Korrelation")));
    assert.ok(context.constraints.some((constraint) => constraint.includes("BREAKOUT_LONG 4, REGIME_LONG 0")));
    assert.equal(context.allowedParents.includes("EVO-REG-0004"), false);
    assert.equal(context.allowedParents.includes("EVO-REG-0007"), true);
  });
});
