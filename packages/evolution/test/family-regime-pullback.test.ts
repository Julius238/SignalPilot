import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateSyntheticSeries, runShadowReplay, type ReplayMarketData } from "@signalpilot/shadow-replay";
import {
  CRYPTO_REGIME_LONG_V1_KEY,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
  REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
  REGIME_PULLBACK_RESEARCH_V1_KEY,
  getStrategy,
  type StrategyEvaluationResultV1
} from "@signalpilot/strategy-engine";

import {
  EVOLUTION_COST_MODEL_V1,
  EVOLUTION_DATA_SPLIT_V1,
  EVOLUTION_DATA_SPLIT_V1_HASH,
  EVOLUTION_FAMILIES,
  EVOLUTION_FAMILY_SEEDS,
  EVOLUTION_GATES_V4_HASH,
  EVOLUTION_ROOTS,
  EXIT_PARAMETER_NAMES,
  FAMILY_SPECS,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH,
  analyzeMarketConditions,
  applyChanges,
  buildResearchContext,
  candidateKeyFor,
  digestPortfolioSummary,
  distanceFromRoot,
  evolutionExecutionProfile,
  familyResearchIdentity,
  genomeHash,
  genomeReplayPlan,
  independentFamilyStructure,
  isIndependentFamily,
  neighbourGenomes,
  parseCandidateKey,
  parseParameterValue,
  portfolioReplayConfig,
  regimePullbackPreregistrationIntact,
  regimePullbackSpecificationHash,
  seedByKey,
  validateGenome,
  versionLabel,
  type CandidateGenome,
  type HistoryEntry,
  type PortfolioSummary
} from "../src/index.js";

const seed = EVOLUTION_FAMILY_SEEDS.REGIME_PULLBACK_LONG!;
const spec = FAMILY_SPECS.REGIME_PULLBACK_LONG;

describe("REGIME_PULLBACK_LONG — pre-registration", () => {
  it("pins the pre-registration hash in code, family specification and seed", () => {
    assert.equal(REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH, "b96bcc97c4d6d1f9e2af5d66c896a0f3e233125934401292e694961421cf1c44");
    assert.equal(REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(regimePullbackPreregistrationIntact(), true);
    assert.equal(spec.independence?.preregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(seed.preregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(seed.pinnedPreregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
  });

  it("is decided under gates v4, the unchanged split and cost model", () => {
    const prereg = REGIME_PULLBACK_LONG_V1_PREREGISTRATION;
    assert.equal(prereg.gates.hash, EVOLUTION_GATES_V4_HASH);
    assert.equal(EVOLUTION_GATES_V4_HASH, "8f55cf8e14b9ca82923f2aae7bab4ed12c318e45c28f31c9f5e03e1ba054554c");
    assert.equal(prereg.split.key, EVOLUTION_DATA_SPLIT_V1.key);
    assert.equal(prereg.split.hash, EVOLUTION_DATA_SPLIT_V1_HASH);
    assert.equal(prereg.costModel, EVOLUTION_COST_MODEL_V1.key);
    assert.equal(prereg.multipleTesting.atPreregistration, 52);
    assert.deepEqual(prereg.budget, { maxScreeningsPerMonth: 4, maxScreeningsTotal: 9, maxHypothesesPerRun: 2, maxAiRunsPerMonth: 2 });
    assert.ok(Object.isFrozen(prereg));
  });

  it("declares an honest independence: own evaluator, own identity, entry parameters only, frozen exits", () => {
    const structure = independentFamilyStructure(spec);
    assert.deepEqual(structure, {
      declaredIndependent: true,
      entryParametersOnly: true,
      exitsFrozen: true,
      ownEntryEvaluator: true,
      preregistrationHash: REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH
    });
    assert.equal(spec.independence!.entryEvaluator, REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION);
    assert.equal(spec.independence!.researchIdentity, "RESEARCH:REGIME_PULLBACK_LONG_V1");
    assert.deepEqual(spec.independence!.frozenExits, { stopAtrMultiple1d: "2", takeProfitRMultiple: "4", minimumRewardRisk: "2", maxHoldHours: 72, regimeExit: false });
    for (const parameter of spec.parameters) assert.equal(EXIT_PARAMETER_NAMES.has(parameter.name), false, parameter.name);
    assert.equal(isIndependentFamily("REGIME_PULLBACK_LONG"), true);
    assert.equal(isIndependentFamily("REGIME_LONG"), false);
    assert.equal(isIndependentFamily("BREAKOUT_LONG"), false);
    assert.equal(familyResearchIdentity("REGIME_PULLBACK_LONG"), REGIME_PULLBACK_RESEARCH_V1_KEY);
    assert.equal(familyResearchIdentity("REGIME_LONG"), null);
    assert.equal(getStrategy(REGIME_PULLBACK_RESEARCH_V1_KEY), null, "the research identity is never registered");
    assert.deepEqual(EVOLUTION_FAMILIES, ["BREAKOUT_LONG", "REGIME_LONG", "REGIME_PULLBACK_LONG"]);
  });

  it("has a closed space of exactly 240 configurations", () => {
    const values = spec.parameters.map((parameter) => {
      if (parameter.kind === "boolean") return ["false", "true"];
      if (parameter.allowed !== undefined) return parameter.allowed.map(String);
      const list: string[] = [];
      for (let value = parameter.min!; value <= parameter.max! + 1e-9; value += parameter.step!) list.push(value.toFixed(2));
      return list;
    });
    assert.deepEqual(values.map((entry) => entry.length), [5, 8, 2, 3]);
    const hashes = new Set<string>();
    const walk = (index: number, changes: { parameter: string; value: string }[]) => {
      if (index === values.length) {
        const parameters = Object.fromEntries(changes.map((change, position) => [change.parameter, (parseParameterValue(spec.parameters[position]!, change.value) as { value: string | number | boolean }).value]));
        const genome: CandidateGenome = { family: "REGIME_PULLBACK_LONG", parameters };
        assert.deepEqual(validateGenome(genome), [], JSON.stringify(parameters));
        hashes.add(genomeHash(genome));
        return;
      }
      for (const value of values[index]!) walk(index + 1, [...changes, { parameter: spec.parameters[index]!.name, value }]);
    };
    walk(0, []);
    assert.equal(hashes.size, 240);
    assert.equal(REGIME_PULLBACK_LONG_V1_PREREGISTRATION.gridSize, 240);
    // Exits are not reachable from a hypothesis.
    for (const exit of ["stopAtrMultiple1d", "takeProfitRMultiple", "maxHoldHours", "exitOnRegimeGateClosed"]) {
      assert.equal(applyChanges(seed.genome, [{ parameter: exit, value: "3" }]).issues[0]?.code, "UNSUPPORTED_PARAMETER", exit);
    }
  });

  it("fixes a valid, normalised seed and its two pre-registered neighbours", () => {
    assert.equal(seed.key, "SEED:REGIME_PULLBACK_LONG_V1");
    assert.deepEqual(seed.genome.parameters, { pullbackLookbackHours: 72, pullbackDepthAtr1d: "1.5", requireReversalCandle: true, capitulationVolumeMinimum: "0" });
    assert.deepEqual(validateGenome(seed.genome), []);
    assert.equal(genomeHash(seed.genome), "cb8e72d9d8c50422602193a50e10d27e3c6ee261d52b631379e52351be33c6b3");
    assert.deepEqual(seed.neighbours.map((neighbour) => neighbour.parameters.pullbackDepthAtr1d), ["1.25", "1.75"]);
    assert.deepEqual(neighbourGenomes(seed.genome, ["pullbackDepthAtr1d"], 2).map(genomeHash), seed.neighbours.map(genomeHash));
    assert.equal(distanceFromRoot(seed.genome), 0);
    assert.equal(distanceFromRoot(seed.neighbours[0]!), 1);
    assert.equal(seedByKey(seed.key), seed);
  });

  it("leaves every existing genome and root unchanged", () => {
    assert.equal(EVOLUTION_ROOTS.length, 2);
    assert.deepEqual(
      EVOLUTION_ROOTS.map((root) => [root.key, genomeHash(root.genome)]),
      [
        ["ROOT:CRYPTO_TREND_CORE_LONG_V1", "2c3f61546bd8bbd3a52e7a1f0cfb6acb4f5e47af77fee551eb7d8453c9b6cd97"],
        ["ROOT:CRYPTO_REGIME_LONG_V1", "81193e8c0f7aecbfc94f94797c6594e39344549af91dfe372bc4ea6ab15414bb"]
      ]
    );
    const challenger = EVOLUTION_ROOTS.find((root) => root.role === "CHALLENGER")!;
    assert.equal(genomeReplayPlan(challenger.genome).hooks.regimeExit?.enabled, true, "the challenger family keeps its regime exit");
    assert.equal(genomeReplayPlan(challenger.genome).researchIdentity, undefined);
  });

  it("numbers candidates EVO-RPB-…", () => {
    assert.equal(candidateKeyFor("REGIME_PULLBACK_LONG", 1), "EVO-RPB-0001");
    assert.deepEqual(parseCandidateKey("EVO-RPB-0007"), { family: "REGIME_PULLBACK_LONG", sequence: 7 });
    assert.equal(versionLabel("REGIME_PULLBACK_LONG", 1, "EVO-RPB-0001"), "Regime-Rücksetzer · G1 · EVO-RPB-0001");
  });
});

describe("REGIME_PULLBACK_LONG — research identity and replay hull", () => {
  it("compiles into its own evaluator under the challenger's key as a hull, without the regime exit", () => {
    const plan = genomeReplayPlan(seed.genome);
    assert.equal(plan.strategyKey, CRYPTO_REGIME_LONG_V1_KEY);
    assert.deepEqual(plan.researchIdentity, {
      key: REGIME_PULLBACK_RESEARCH_V1_KEY,
      engineVersion: REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
      specificationHash: regimePullbackSpecificationHash(seed.genome.parameters)
    });
    assert.notEqual(plan.researchIdentity!.specificationHash, CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH);
    assert.notEqual(regimePullbackSpecificationHash(seed.neighbours[0]!.parameters), plan.researchIdentity!.specificationHash);
    assert.equal(plan.hooks.regimeExit?.enabled, false);
    assert.equal(typeof plan.hooks.evaluate, "function");
  });

  it("labels its portfolio with the research identity and refuses a foreign label", () => {
    const existing = EVOLUTION_ROOTS.map((root) => ({ key: root.key, subject: { kind: "ROOT" as const, rootKey: root.key } }));
    const window = { from: "2023-01-01T00:00:00.000Z", to: "2023-02-01T00:00:00.000Z" };
    const config = portfolioReplayConfig({ comparison: "WITH_CANDIDATE", existing, candidate: { key: "EVO-RPB-0001", subject: { kind: "GENOME", genome: seed.genome } }, ...window, codeVersion: "test" });
    const member = config.members.at(-1)!;
    assert.equal(member.key, "EVO-RPB-0001");
    assert.equal(member.strategyKey, CRYPTO_REGIME_LONG_V1_KEY);
    assert.equal(member.researchIdentity, REGIME_PULLBACK_RESEARCH_V1_KEY);
    assert.ok(config.members.slice(0, -1).every((entry) => entry.researchIdentity === undefined));
    assert.throws(
      () => portfolioReplayConfig({ comparison: "WITH_CANDIDATE", existing, candidate: { key: "EVO-RPB-0001", subject: { kind: "GENOME", genome: seed.genome }, researchIdentity: "RESEARCH:SOMETHING_ELSE" }, ...window, codeVersion: "test" }),
      /belongs to RESEARCH:REGIME_PULLBACK_LONG_V1/
    );
  });

  it("stores a portfolio member under its research identity; the hull appears only as replayHull", () => {
    const summary = {
      comparison: "WITH_CANDIDATE",
      engineVersion: "portfolio-replay-v1/1.0.0",
      groupRiskVersion: "group-risk-v1/1.0.0",
      from: "2023-01-01T00:00:00.000Z",
      to: "2023-02-01T00:00:00.000Z",
      firstAnchorAt: null,
      lastAnchorAt: null,
      reserveCash: 0,
      members: [
        { key: "ROOT:CRYPTO_REGIME_LONG_V1", strategyKey: CRYPTO_REGIME_LONG_V1_KEY, researchIdentity: null },
        { key: "EVO-RPB-0001", strategyKey: CRYPTO_REGIME_LONG_V1_KEY, researchIdentity: REGIME_PULLBACK_RESEARCH_V1_KEY }
      ].map((entry) => ({
        ...entry,
        startingCash: 20_000,
        finalEquity: 20_100,
        trades: [],
        dailyEquity: [{ day: "2023-01-01", equity: 20_000 }],
        funnel: { cycles: 1, candidates: 0, riskApproved: 0, riskRejected: 0, entriesFilled: 0 },
        groupRejected: 0,
        groupRejections: {},
        invariantViolations: 0,
        killSwitchEngagements: 0,
        outputHash: "x"
      })),
      group: { totalCapital: 40_000, finalEquity: 40_200, netReturnPct: 0.5, maxDrawdownPct: 0, averageOpenRiskPct: 0, peakOpenRiskPct: 0, averageCapitalBoundPct: 0, peakCapitalBoundPct: 0, hours: 1, hoursWithOpenPositions: 0, stage2Rejections: {}, groupKillSwitchEngagements: 0, dailyEquity: [{ day: "2023-01-01", equity: 40_000 }] },
      outputHash: "y",
      durationMs: 1
    } satisfies PortfolioSummary;
    const digest = digestPortfolioSummary(summary);
    assert.deepEqual(
      digest.members.map((entry) => [entry.key, entry.strategyKey, entry.replayHull]),
      [
        ["ROOT:CRYPTO_REGIME_LONG_V1", CRYPTO_REGIME_LONG_V1_KEY, null],
        ["EVO-RPB-0001", REGIME_PULLBACK_RESEARCH_V1_KEY, CRYPTO_REGIME_LONG_V1_KEY]
      ]
    );
    assert.equal("dailyEquity" in digest.group, false);
  });

  // Synthetic candles: the test proves the wiring (own evaluator, R-020 in the risk engine, no regime exit), never a strategy.
  it("replays with its own evaluator: R-020 alone filters the regime, exits are stop, target or 72 h", () => {
    const start = Date.UTC(2022, 0, 1);
    const market: ReplayMarketData = {
      origin: "SYNTHETIC",
      synthetic: true,
      series: [
        generateSyntheticSeries({ symbol: "BTCUSDT", startMs: start, hours: 420 * 24, startPrice: 30000, seed: 3, baseVolume: 900 }),
        generateSyntheticSeries({ symbol: "ETHUSDT", startMs: start, hours: 420 * 24, startPrice: 1800, seed: 5, baseVolume: 9000 })
      ]
    };
    // A permissive genome of the grid, so the synthetic market produces candidates in and outside RISK_ON.
    const genome = applyChanges(seed.genome, [
      { parameter: "pullbackLookbackHours", value: "24" },
      { parameter: "pullbackDepthAtr1d", value: "0.75" },
      { parameter: "requireReversalCandle", value: "false" }
    ]).genome;
    assert.deepEqual(validateGenome(genome), []);
    const plan = genomeReplayPlan(genome);
    const evaluations: StrategyEvaluationResultV1[] = [];
    const result = runShadowReplay(
      market,
      { symbol: "BTCUSDT", strategyKey: plan.strategyKey, mode: plan.mode, regimePolicy: plan.regimePolicy, startingCash: "10000", executionProfile: evolutionExecutionProfile("BTCUSDT"), codeVersion: "test" },
      { ...plan.hooks, onEvaluation: (_at, evaluation) => evaluations.push(evaluation) }
    );
    assert.ok(result.funnel.candidates > 0, "the synthetic market must produce pullback candidates");
    assert.ok(evaluations.length > 0);
    for (const evaluation of evaluations) {
      assert.equal(evaluation.engineVersion, REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION);
      assert.equal(evaluation.reasonCodes.some((code) => code.startsWith("REGIME_")), false, evaluation.reasonCodes.join(","));
    }
    // The evaluator proposes regardless of the regime; the unchanged risk engine rejects outside RISK_ON
    // (R-020-REGIME, reason MARKET_REGIME_CONFLICT) — the only regime rule the family is subject to.
    assert.ok((result.funnel.riskReasons.MARKET_REGIME_CONFLICT ?? 0) > 0, JSON.stringify(result.funnel.riskReasons));
    for (const trade of result.trades) {
      assert.notEqual(trade.exitReason, "INVALIDATION", "no regime exit");
      assert.ok(Date.parse(trade.closedAt) - Date.parse(trade.openedAt) <= 73 * 3_600_000, `${trade.openedAt} → ${trade.closedAt}`);
    }
  });
});

describe("REGIME_PULLBACK_LONG — what the AI sees", () => {
  const analysis = analyzeMarketConditions({ split: EVOLUTION_DATA_SPLIT_V1, referenceSymbol: "BTCUSDT", bars: {}, subjects: [] });
  const entry = (candidateKey: string, family: HistoryEntry["family"]): HistoryEntry => ({
    candidateKey,
    family,
    parentKey: family === "REGIME_PULLBACK_LONG" ? seed.key : "ROOT:CRYPTO_REGIME_LONG_V1",
    generation: 1,
    hypothesis: "h",
    changes: [],
    parameters: {},
    verdict: "PASSED_SCREENING",
    failedGates: [],
    discovery: null
  });
  const history = [entry("EVO-REG-0001", "REGIME_LONG"), entry("EVO-RPB-0001", "REGIME_PULLBACK_LONG")];

  it("keeps a closed independent family out of the context entirely", () => {
    const context = buildResearchContext({ split: EVOLUTION_DATA_SPLIT_V1, benchmarks: [], analysis, history, hypotheses: 2 });
    assert.deepEqual(context.families.map((family) => family.family), ["BREAKOUT_LONG", "REGIME_LONG"]);
    assert.deepEqual(context.history.map((item) => item.candidateKey), ["EVO-REG-0001"]);
    assert.equal(context.allowedParents.includes("EVO-RPB-0001"), false);
    assert.ok(context.constraints[0]!.includes("der beiden Familien"));
  });

  it("lists an opened family with its fixed exits, the portfolio rule and the remaining budget", () => {
    const context = buildResearchContext({
      split: EVOLUTION_DATA_SPLIT_V1,
      benchmarks: [],
      analysis,
      history,
      hypotheses: 2,
      independentFamilies: { REGIME_PULLBACK_LONG: { remainingThisMonth: 3, remainingTotal: 8, maxHypothesesPerRun: 2 } }
    });
    assert.deepEqual(context.families.map((family) => family.family), ["BREAKOUT_LONG", "REGIME_LONG", "REGIME_PULLBACK_LONG"]);
    assert.ok(context.allowedParents.includes("EVO-RPB-0001"));
    const rule = context.constraints.find((constraint) => constraint.startsWith("Eigenständige Familie REGIME_PULLBACK_LONG"));
    assert.ok(rule !== undefined && rule.includes("3 Prüfungen in diesem Monat, 8 insgesamt, höchstens 2 Hypothesen"));
  });
});
