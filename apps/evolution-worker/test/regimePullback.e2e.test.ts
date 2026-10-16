/**
 * End-to-end: the independent family REGIME_PULLBACK_LONG under gates v4 —
 * pre-registered hypothesis (seed) or AI hypothesis → candidate → technical
 * test → own backtests → chronological portfolio replays A/B → v4 decision →
 * persisted gates, manifest, identity and report, against real PostgreSQL.
 * The market is synthetic and the split compressed to a few weeks (every
 * portfolio replay evaluates every hour of its window, so the window length
 * sets the run time): the test proves the machinery, never a strategy.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  EVOLUTION_FAMILY_SEEDS,
  EVOLUTION_GATES_V1,
  EVOLUTION_GATES_V2,
  EVOLUTION_GATES_V3,
  EVOLUTION_GATES_V4,
  EVOLUTION_GATES_V4_HASH,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH,
  genomeHash,
  type AiRequest,
  type EvolutionDataSplit,
  type EvolutionGateSet,
  type GateResult,
  type PortfolioCheckRecord,
  type ResearchAiProvider
} from "@signalpilot/evolution";
import { CRYPTO_REGIME_LONG_V1_KEY } from "@signalpilot/strategy-engine";

import type { EvolutionJob } from "../src/backtest/execute.js";
import { InProcessBacktestRunner, type BacktestRunner } from "../src/backtest/pool.js";
import { screenIndependentCandidate } from "../src/cycle/portfolioAssessment.js";
import { runResearchCycle, type CycleDeps } from "../src/cycle/researchCycle.js";
import { NO_AI_PROVIDER, independentSearchStatus, seedPreflight } from "../src/cycle/seed.js";
import { verifyEvolutionAuditChain } from "../src/persistence/audit.js";
import { DB_SKIP_REASON, PERMISSIVE_GATES_V4, SYNTHETIC_SPLIT, memoizedRunner, resetEvolutionTables, silentLog, syntheticMarket, testConfig, testDatabase } from "./support.js";

const db = testDatabase();

/** Three weeks of discovery, ten days of validation, one week of holdout. */
const SPLIT: EvolutionDataSplit = {
  ...SYNTHETIC_SPLIT,
  key: "evolution-split-test-pullback",
  windows: {
    DISCOVERY: { ...SYNTHETIC_SPLIT.windows.DISCOVERY, from: "2023-10-01T00:00:00.000Z", to: "2023-10-21T23:59:59.999Z" },
    VALIDATION: { ...SYNTHETIC_SPLIT.windows.VALIDATION, from: "2023-10-22T00:00:00.000Z", to: "2023-10-31T23:59:59.999Z" },
    HOLDOUT: { ...SYNTHETIC_SPLIT.windows.HOLDOUT, from: "2023-11-01T00:00:00.000Z", to: "2023-11-07T23:59:59.999Z" }
  },
  forwardFrom: "2023-11-08T00:00:00.000Z",
  folds: [
    { key: "2023-10a", window: "DISCOVERY", from: "2023-10-01T00:00:00.000Z", to: "2023-10-10T23:59:59.999Z" },
    { key: "2023-10b", window: "DISCOVERY", from: "2023-10-11T00:00:00.000Z", to: "2023-10-21T23:59:59.999Z" },
    { key: "2023-10c", window: "VALIDATION", from: "2023-10-22T00:00:00.000Z", to: "2023-10-31T23:59:59.999Z" }
  ]
};
const seed = EVOLUTION_FAMILY_SEEDS.REGIME_PULLBACK_LONG!;
const RESEARCH = "RESEARCH:REGIME_PULLBACK_LONG_V1";
const V4_SCREENING = [
  "LINEAGE_BUDGET",
  "INDEPENDENT_FAMILY",
  "TRADE_GEOMETRY",
  "PORTFOLIO_NET_GAIN",
  "PORTFOLIO_SHARPE_GAIN",
  "PORTFOLIO_DRAWDOWN",
  "PORTFOLIO_RISK_EFFICIENCY",
  "PORTFOLIO_CAPITAL_EFFICIENCY",
  "INCREMENT_STABILITY",
  "INCREMENT_COST_STRESS",
  "OWN_ALPHA",
  "INCREMENT_SIGNIFICANCE",
  "PORTFOLIO_DECISION"
];

describe("REGIME_PULLBACK_LONG end to end (gates v4)", { skip: db === null ? DB_SKIP_REASON : false, timeout: 1_800_000 }, () => {
  // A synthetic market on which the seed is profitable enough for the permissive v1 base gates (final-stage test).
  const { market, fingerprint, discoveryBars } = syntheticMarket(SPLIT, { btc: 23, eth: 123 });
  let clock = Date.parse("2026-10-16T09:00:00.000Z");
  const jobs: string[] = [];
  const prompts: string[] = [];
  // Shared by every cycle: a replay repeated across cycles (comparison A of each run, the seed's replays
  // after the forced-pass test clears the tables) is computed once.
  const replays = memoizedRunner(new InProcessBacktestRunner(market, fingerprint));
  const runner = (): BacktestRunner => ({
    run: (job: EvolutionJob) => {
      jobs.push(job.kind === "PORTFOLIO" ? `${job.spec.comparison}@${job.spec.from.slice(0, 10)}${job.spec.candidate === undefined ? "" : `:${job.spec.candidate.key}`}` : `${job.kind}:${job.subjectKey}`);
      return replays.run(job);
    },
    close: () => replays.close()
  });
  const deps = (overrides: Partial<CycleDeps> = {}): CycleDeps => ({
    db: db!,
    config: testConfig(),
    provider: NO_AI_PROVIDER,
    runner: runner(),
    market: { dir: "synthetic", fingerprint, cutoffAt: SPLIT.forwardFrom, files: [], discoveryBars },
    log: silentLog,
    now: () => new Date((clock += 1000)),
    split: SPLIT,
    gates: EVOLUTION_GATES_V4,
    ...overrides
  });
  /** An AI that proposes one hypothesis inside the family (or, with `family`, another one). */
  const scripted = (parentKey: string, changes: { parameter: string; value: string }[], title: string): ResearchAiProvider => ({
    name: "mock",
    billable: false,
    async complete(request: AiRequest) {
      if (request.task === "HYPOTHESIS_GENERATION") prompts.push(request.prompt);
      const json =
        request.task === "HYPOTHESIS_GENERATION"
          ? {
              summary: "scripted",
              hypotheses: [
                { title, marketObservation: "Test", rationale: "Test", family: "REGIME_PULLBACK_LONG", parentKey, changes, expectedEffect: "Test", falsificationCriterion: "Test" }
              ]
            }
          : { summary: "scripted review", warnings: [], nextSteps: [] };
      const usage = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
      return { servedModel: request.model, text: JSON.stringify(json), json, usage, usageByModel: [{ model: request.model, usage }], stopReason: "end_turn", requestId: null, attempts: 1 };
    }
  });
  const gatesOf = (row: { gatesJson: unknown }) => (row.gatesJson as GateResult[] | null) ?? [];

  before(async () => resetEvolutionTables(db!));
  after(async () => {
    await resetEvolutionTables(db!);
    await db!.$disconnect();
  });

  for (const [label, gates] of [
    ["v1", EVOLUTION_GATES_V1],
    ["v2", EVOLUTION_GATES_V2],
    ["v3", EVOLUTION_GATES_V3]
  ] as const) {
    it(`refuses the family under gates ${label} before touching any data`, async () => {
      const outcome = await runResearchCycle(deps({ gates: gates as EvolutionGateSet }), { trigger: "MANUAL", seed: "REGIME_PULLBACK_LONG" });
      assert.equal(outcome.status, "SKIPPED");
      assert.match(outcome.reason ?? "", /Gates v4/);
      assert.equal(await db!.evolutionRun.count(), 0);
      assert.equal(await db!.evolutionBacktest.count(), 0);
    });
  }

  it("refuses gates that are not the pre-registered ones in production", async () => {
    // Without injected gates the configured version decides; the default (v3) is refused.
    const { gates: _injected, ...production } = deps();
    void _injected;
    const outcome = await runResearchCycle(production, { trigger: "MANUAL", seed: "REGIME_PULLBACK_LONG" });
    assert.equal(outcome.status, "SKIPPED");
    assert.match(outcome.reason ?? "", /Gates v4/);
    assert.equal(await db!.evolutionRun.count(), 0);
  });

  it("prepares evaluate-seed: a clean preflight under the pre-registered gates v4, with the multiple-testing counter", async () => {
    const preflight = await seedPreflight(db!, { family: "REGIME_PULLBACK_LONG", gates: EVOLUTION_GATES_V4, config: testConfig(), now: new Date(clock), split: SPLIT });
    assert.deepEqual(preflight.problems, []);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.preregistration.intact, true);
    assert.equal(preflight.gates.hash, EVOLUTION_GATES_V4_HASH);
    assert.equal(preflight.seed!.genomeHash, genomeHash(seed.genome));
    assert.deepEqual(preflight.trials, { now: 0, afterScreening: 1, ifFinalist: 3, alphaThresholdAfterScreening: 2 });
    assert.deepEqual(preflight.budget.family, { month: 0, total: 0, maxPerMonth: 4, maxTotal: 9 });
    const v3 = await seedPreflight(db!, { family: "REGIME_PULLBACK_LONG", gates: EVOLUTION_GATES_V3, config: testConfig(), now: new Date(clock) });
    assert.equal(v3.ok, false);
    const challenger = await seedPreflight(db!, { family: "REGIME_LONG", gates: EVOLUTION_GATES_V4, config: testConfig(), now: new Date(clock) });
    assert.match(challenger.problems.join(" "), /keine eigenständige Familie/);
    assert.equal(await db!.evolutionRun.count(), 0, "the preflight writes nothing");
  });

  it("evaluates the pre-registered seed without AI through the v4 portfolio path, although the agent is paused", async () => {
    jobs.length = 0;
    const outcome = await runResearchCycle(deps(), { trigger: "MANUAL", seed: "REGIME_PULLBACK_LONG" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    assert.deepEqual(outcome.candidates.map((candidate) => candidate.key), ["EVO-RPB-0001"]);
    assert.equal((await db!.evolutionAgentState.findFirstOrThrow()).status, "PAUSED", "a new installation stays paused");

    const run = await db!.evolutionRun.findFirstOrThrow({ include: { hypotheses: true, aiCalls: true } });
    assert.equal(run.providerName, "none");
    assert.equal(run.billable, false);
    assert.equal(run.aiCalls.length, 0, "no AI call at all");
    const manifest = run.dataManifestJson as unknown as {
      gatesVersion: string;
      gatesHash: string;
      mode: string;
      forwardDataUsed: boolean;
      seed: { key: string; preregistrationHash: string; genomeHash: string };
      independentFamilies: Record<string, { preregistrationHash: string; researchIdentity: string; portfolioPath: boolean }>;
    };
    assert.equal(manifest.gatesVersion, "evolution-gates-v4");
    assert.equal(manifest.gatesHash, EVOLUTION_GATES_V4_HASH);
    assert.equal(manifest.mode, "PREREGISTERED_SEED");
    assert.equal(manifest.seed.key, "SEED:REGIME_PULLBACK_LONG_V1");
    assert.equal(manifest.seed.preregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(manifest.seed.genomeHash, genomeHash(seed.genome));
    assert.equal(manifest.independentFamilies.REGIME_PULLBACK_LONG!.preregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(manifest.independentFamilies.REGIME_PULLBACK_LONG!.researchIdentity, RESEARCH);
    assert.equal(manifest.independentFamilies.REGIME_PULLBACK_LONG!.portfolioPath, true);
    assert.equal(manifest.forwardDataUsed, false);
    assert.equal(run.hypotheses.length, 1);
    assert.equal(run.hypotheses[0]!.outcome, "PREREGISTERED_SEED");
    assert.equal(run.hypotheses[0]!.aiCallId, null);
    assert.equal(run.hypotheses[0]!.title, seed.hypothesis.title);

    const candidate = await db!.evolutionCandidate.findUniqueOrThrow({ where: { candidateKey: "EVO-RPB-0001" }, include: { backtests: true } });
    assert.equal(candidate.family, "REGIME_PULLBACK_LONG");
    assert.equal(candidate.generation, 1);
    assert.equal(candidate.parentKey, "SEED:REGIME_PULLBACK_LONG_V1");
    assert.equal(candidate.rootStrategyKey, RESEARCH, "the lineage belongs to the research identity, not to the challenger");
    assert.equal(candidate.genomeHash, genomeHash(seed.genome));
    assert.deepEqual(candidate.changesJson, []);
    assert.deepEqual(candidate.backtests.filter((entry) => entry.role === "CANDIDATE").map((entry) => [entry.subjectKey, entry.symbol]).sort(), [["EVO-RPB-0001", "BTCUSDT"], ["EVO-RPB-0001", "ETHUSDT"]]);

    // v1 base gates on its own backtests, then exactly the v4 portfolio gates — no v3 lineage rule.
    const gates = gatesOf(candidate);
    const ids = gates.filter((gate) => gate.stage === "SCREENING").map((gate) => gate.gate as string);
    for (const id of ["MIN_TRADES", "DISCOVERY_EDGE", "VALIDATION_EDGE", "COST_STRESS", "DRAWDOWN", "FOLD_STABILITY", "REDUNDANCY", "BENCHMARK", ...V4_SCREENING]) assert.ok(ids.includes(id), id);
    assert.equal(ids.includes("LINEAGE_DECISION"), false);
    const structural = gates.find((gate) => gate.gate === ("INDEPENDENT_FAMILY" as string))!;
    assert.equal(structural.passed, true);
    assert.ok(structural.message.includes(REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH.slice(0, 12)));
    assert.equal(gates.find((gate) => gate.gate === ("LINEAGE_BUDGET" as string))!.actual, "1");
    // A month of synthetic data cannot carry an own α (36 months required): the seed is rejected, nothing is proposed.
    assert.equal(gates.find((gate) => gate.gate === ("OWN_ALPHA" as string))!.passed, false);
    assert.equal(candidate.status, "REJECTED");
    assert.ok(candidate.statusReasons.includes("NO_ROBUST_PORTFOLIO_VALUE"));

    const metrics = candidate.metricsJson as unknown as {
      identity: { researchIdentity: string; engineVersion: string; preregistrationHash: string; seed: boolean; replayHull: { strategyKey: string } };
      portfolio: PortfolioCheckRecord;
      gateVersion: string;
    };
    assert.equal(metrics.gateVersion, "evolution-gates-v4");
    assert.equal(metrics.identity.researchIdentity, RESEARCH);
    assert.equal(metrics.identity.engineVersion, "crypto-regime-pullback-research-v1/1.0.0");
    assert.equal(metrics.identity.preregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(metrics.identity.seed, true);
    assert.equal(metrics.identity.replayHull.strategyKey, CRYPTO_REGIME_LONG_V1_KEY);
    const portfolio = metrics.portfolio;
    assert.equal(portfolio.gatesHash, EVOLUTION_GATES_V4_HASH);
    assert.equal(portfolio.preregistrationHash, REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH);
    assert.equal(portfolio.decision.passed, false);
    assert.equal(portfolio.decision.trials, 1, "synthetic split: no prior exposure, the seed is the first configuration");
    assert.equal(portfolio.dataFingerprint, fingerprint);
    // Fixed-slot frame: the same total capital; A keeps the slot as cash, B puts the candidate on it.
    assert.equal(portfolio.baseline.group.totalCapital, portfolio.withCandidate.group.totalCapital);
    assert.equal(portfolio.baseline.reserveCash, 20_000);
    assert.equal(portfolio.withCandidate.reserveCash, 0);
    assert.deepEqual(portfolio.baseline.members.map((member) => member.key), ["ROOT:CRYPTO_TREND_CORE_LONG_V1", "ROOT:CRYPTO_REGIME_LONG_V1"]);
    assert.deepEqual(
      portfolio.withCandidate.members.map((member) => [member.key, member.strategyKey, member.replayHull]),
      [
        ["ROOT:CRYPTO_TREND_CORE_LONG_V1", "CRYPTO_TREND_CORE_LONG_V1", null],
        ["ROOT:CRYPTO_REGIME_LONG_V1", CRYPTO_REGIME_LONG_V1_KEY, null],
        ["EVO-RPB-0001", RESEARCH, CRYPTO_REGIME_LONG_V1_KEY]
      ],
      "no stored row attributes the candidate's trades to the challenger; the hull appears only as replayHull"
    );
    assert.ok(portfolio.withCandidate.members.every((member) => member.startingCash === 20_000));
    assert.ok(portfolio.assessment.existing.some((relation) => relation.key === "ROOT:CRYPTO_REGIME_LONG_V1"));

    // Comparison A once, comparison B once, both over discovery + validation.
    assert.deepEqual(jobs.filter((job) => job.startsWith("BASELINE")), [`BASELINE@${SPLIT.windows.DISCOVERY.from.slice(0, 10)}`]);
    assert.deepEqual(jobs.filter((job) => job.startsWith("WITH_CANDIDATE")), [`WITH_CANDIDATE@${SPLIT.windows.DISCOVERY.from.slice(0, 10)}:EVO-RPB-0001`]);

    // Exposure: A as reference data, the candidate's validation use counts for the family budget.
    assert.equal(await db!.evolutionDataExposure.count({ where: { subjectKey: "PORTFOLIO:A", purpose: "BENCHMARK" } }), 4);
    assert.equal(await db!.evolutionDataExposure.count({ where: { subjectKey: "EVO-RPB-0001", windowKey: "VALIDATION", purpose: "SELECTION" } }), 2);

    assert.ok(candidate.reportMarkdown!.includes("Portfolio-Prüfung (Gates v4)"));
    assert.ok(candidate.reportMarkdown!.includes(RESEARCH));
    assert.ok(candidate.reportMarkdown!.includes("nur technisch"));
    assert.ok(candidate.reportMarkdown!.includes("Abstammung: SEED:REGIME_PULLBACK_LONG_V1 → EVO-RPB-0001"));
    assert.equal((await verifyEvolutionAuditChain(db!)).ok, true);
  });

  it("refuses a second run of the same seed", async () => {
    const runs = await db!.evolutionRun.count();
    const outcome = await runResearchCycle(deps(), { trigger: "MANUAL", seed: "REGIME_PULLBACK_LONG" });
    assert.equal(outcome.status, "SKIPPED");
    assert.match(outcome.reason ?? "", /bereits als EVO-RPB-0001 bewertet/);
    assert.equal(await db!.evolutionRun.count(), runs);
  });

  it("closes the family after a failed seed (F4): the AI may not search it, even when the operator opened stage 2", async () => {
    prompts.length = 0;
    const config = testConfig({ independentFamilySearch: ["REGIME_PULLBACK_LONG"] });
    const status = await independentSearchStatus(db!, { family: "REGIME_PULLBACK_LONG", gates: EVOLUTION_GATES_V4, config, now: new Date(clock), requirePreregisteredGates: false });
    assert.equal(status.open, false);
    assert.match(status.reason ?? "", /F4/);
    const backtests = await db!.evolutionBacktest.count();
    const outcome = await runResearchCycle(
      deps({ config, provider: scripted("EVO-RPB-0001", [{ parameter: "pullbackDepthAtr1d", value: "2" }], "Tieferer Rücksetzer nach gescheitertem Start") }),
      { trigger: "MANUAL", force: true }
    );
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    assert.equal(outcome.candidates.length, 0);
    const hypothesis = await db!.evolutionHypothesis.findFirstOrThrow({ where: { title: "Tieferer Rücksetzer nach gescheitertem Start" } });
    assert.equal(hypothesis.outcome, "FAMILY_STAGE_CLOSED");
    assert.equal((await db!.evolutionBacktest.count()) > backtests, false, "no backtest of a closed family");
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.includes("REGIME_PULLBACK_LONG"), false, "a closed family never reaches the AI's context");
  });

  it("walks a forced-pass seed through the v4 final stage and opens stage 2 for an AI hypothesis on the portfolio path", async () => {
    await resetEvolutionTables(db!);
    jobs.length = 0;
    prompts.length = 0;
    // Tests only: force the v4 screening verdict (the synthetic market is far too short for an own α) to reach the final stage.
    const forced: typeof screenIndependentCandidate = async (context, input) => {
      const result = await screenIndependentCandidate(context, input);
      return { ...result, gates: result.gates.map((gate) => ({ ...gate, passed: true })), decision: { ...result.decision, passed: true, failed: [] } };
    };
    const seedOutcome = await runResearchCycle(deps({ gates: PERMISSIVE_GATES_V4, portfolioPath: { screen: forced } }), { trigger: "MANUAL", seed: "REGIME_PULLBACK_LONG" });
    assert.equal(seedOutcome.status, "COMPLETED", seedOutcome.reason ?? "");
    const seeded = await db!.evolutionCandidate.findUniqueOrThrow({ where: { candidateKey: "EVO-RPB-0001" } });
    const final = gatesOf(seeded).filter((gate) => gate.stage === "FINAL").map((gate) => gate.gate as string);
    for (const id of ["PARAMETER_ROBUSTNESS", "WALK_FORWARD", "HOLDOUT", "PORTFOLIO_NEIGHBOURS", "PORTFOLIO_HOLDOUT_GUARD"]) assert.ok(final.includes(id), id);
    const portfolio = (seeded.metricsJson as unknown as { portfolio: PortfolioCheckRecord }).portfolio;
    // The pre-registered neighbours (depth 1.25 and 1.75) — in their own backtests and in their own comparison B.
    assert.deepEqual(portfolio.neighbours!.map((entry) => entry.key), ["EVO-RPB-0001~N1", "EVO-RPB-0001~N2"]);
    const neighbourGenomes = (await db!.evolutionBacktest.findMany({ where: { role: "NEIGHBOUR", symbol: "BTCUSDT" }, orderBy: { subjectKey: "asc" } })).map(
      (row) => (row.configJson as { subject: { genome: { parameters: Record<string, unknown> } } }).subject.genome.parameters.pullbackDepthAtr1d
    );
    assert.deepEqual(neighbourGenomes, ["1.25", "1.75"]);
    assert.ok(portfolio.holdout !== null && portfolio.holdout.key === "HOLDOUT");
    // Comparison A once per window (in-sample, holdout); B for the seed, both neighbours and the holdout.
    const from = SPLIT.windows.DISCOVERY.from.slice(0, 10);
    const holdoutFrom = SPLIT.windows.HOLDOUT.from.slice(0, 10);
    assert.deepEqual(jobs.filter((job) => job.startsWith("BASELINE")).sort(), [`BASELINE@${from}`, `BASELINE@${holdoutFrom}`].sort());
    assert.deepEqual(
      jobs.filter((job) => job.startsWith("WITH_CANDIDATE")).sort(),
      [`WITH_CANDIDATE@${from}:EVO-RPB-0001`, `WITH_CANDIDATE@${from}:EVO-RPB-0001~N1`, `WITH_CANDIDATE@${from}:EVO-RPB-0001~N2`, `WITH_CANDIDATE@${holdoutFrom}:EVO-RPB-0001`].sort()
    );
    assert.equal(await db!.evolutionDataExposure.count({ where: { subjectKey: "PORTFOLIO:A", windowKey: "HOLDOUT", purpose: "BENCHMARK" } }), 2);
    assert.ok(["PROPOSED", "REJECTED"].includes(seeded.status));

    // Stage 2 needs the operator: without EVOLUTION_INDEPENDENT_FAMILY_SEARCH the family stays closed.
    const closed = await runResearchCycle(deps({ gates: PERMISSIVE_GATES_V4, provider: scripted("EVO-RPB-0001", [{ parameter: "pullbackLookbackHours", value: "48" }], "Ohne Freigabe") }), { trigger: "MANUAL", force: true });
    assert.equal(closed.candidates.length, 0);
    assert.equal((await db!.evolutionHypothesis.findFirstOrThrow({ where: { title: "Ohne Freigabe" } })).outcome, "FAMILY_STAGE_CLOSED");

    // Under v3 the family is refused without a backtest, even when opened.
    const opened = testConfig({ independentFamilySearch: ["REGIME_PULLBACK_LONG"] });
    const candidateBacktests = () => db!.evolutionBacktest.count({ where: { role: { in: ["CANDIDATE", "NEIGHBOUR"] } } });
    const before = await candidateBacktests();
    const underV3 = await runResearchCycle(deps({ config: opened, gates: EVOLUTION_GATES_V3, provider: scripted("EVO-RPB-0001", [{ parameter: "pullbackLookbackHours", value: "48" }], "Unter Gates v3") }), { trigger: "MANUAL", force: true });
    assert.equal(underV3.candidates.length, 0);
    assert.equal((await db!.evolutionHypothesis.findFirstOrThrow({ where: { title: "Unter Gates v3" } })).outcome, "GATES_VERSION_UNSUITABLE");
    assert.equal(await candidateBacktests(), before, "refused without a backtest");

    // Opened, under v4: hypothesis → candidate → replay → portfolio A/B → v4 decision.
    jobs.length = 0;
    prompts.length = 0;
    const stage2 = await runResearchCycle(
      deps({ config: opened, gates: PERMISSIVE_GATES_V4, provider: scripted("EVO-RPB-0001", [{ parameter: "pullbackLookbackHours", value: "48" }], "Kürzeres Rücksetzer-Fenster") }),
      { trigger: "MANUAL", force: true }
    );
    assert.equal(stage2.status, "COMPLETED", stage2.reason ?? "");
    assert.deepEqual(stage2.candidates.map((candidate) => candidate.key), ["EVO-RPB-0002"]);
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0]!.includes("Eigenständige Familie REGIME_PULLBACK_LONG"), "an opened family is described to the AI with its fixed exits and budget");
    const child = await db!.evolutionCandidate.findUniqueOrThrow({ where: { candidateKey: "EVO-RPB-0002" } });
    assert.equal(child.parentKey, "EVO-RPB-0001");
    assert.equal(child.generation, 2);
    assert.equal(child.rootStrategyKey, RESEARCH);
    const childIds = gatesOf(child).filter((gate) => gate.stage === "SCREENING").map((gate) => gate.gate as string);
    for (const id of V4_SCREENING) assert.ok(childIds.includes(id), id);
    assert.equal(childIds.includes("LINEAGE_DECISION"), false, "never the v3 lineage rule");
    assert.ok((child.metricsJson as unknown as { portfolio: PortfolioCheckRecord | null }).portfolio !== null);
    // Comparison A of the new run comes from that run's cache: one per window, B for the AI candidate.
    assert.deepEqual(jobs.filter((job) => job.startsWith("BASELINE")), [`BASELINE@${from}`]);
    assert.ok(jobs.includes(`WITH_CANDIDATE@${from}:EVO-RPB-0002`));
    assert.equal((await verifyEvolutionAuditChain(db!)).ok, true);
  });
});
