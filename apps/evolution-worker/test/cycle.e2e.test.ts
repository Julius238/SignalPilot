/**
 * End-to-end: mock AI → hypotheses → executable candidates → technical tests
 * → backtests (the unchanged shadow replay) → gates → persisted results and
 * reports, against real PostgreSQL. The market is synthetic and the split
 * compressed; the test proves the machinery, never real performance.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  EVOLUTION_GATES_V2,
  HYPOTHESIS_RESPONSE_SCHEMA,
  MockResearchProvider,
  assertContextLeakFree,
  diffGenomes,
  extractResearchContext,
  type AiRequest,
  type CandidateGenome,
  type ResearchAiProvider
} from "@signalpilot/evolution";

import { InProcessBacktestRunner } from "../src/backtest/pool.js";
import { runResearchCycle, type CycleDeps } from "../src/cycle/researchCycle.js";
import { setAgentStatus } from "../src/persistence/agentState.js";
import { verifyEvolutionAuditChain } from "../src/persistence/audit.js";
import { DB_SKIP_REASON, PERMISSIVE_GATES, PERMISSIVE_GATES_V2, PERMISSIVE_GATES_V3, SYNTHETIC_SPLIT, resetEvolutionTables, silentLog, syntheticMarket, testConfig, testDatabase } from "./support.js";

const db = testDatabase();

describe("research cycle end to end", { skip: db === null ? DB_SKIP_REASON : false, timeout: 900_000 }, () => {
  const { market, fingerprint, discoveryBars } = syntheticMarket();
  const prompts: string[] = [];
  const mock = new MockResearchProvider();
  const recordingProvider: ResearchAiProvider = {
    name: "mock",
    billable: false,
    async complete(request: AiRequest) {
      prompts.push(request.prompt);
      return mock.complete(request);
    }
  };
  let clock = Date.parse("2026-10-16T01:15:00.000Z");
  const deps = (): CycleDeps => ({
    db: db!,
    config: testConfig(),
    provider: recordingProvider,
    runner: new InProcessBacktestRunner(market, fingerprint),
    market: { dir: "synthetic", fingerprint, cutoffAt: SYNTHETIC_SPLIT.forwardFrom, files: [], discoveryBars },
    log: silentLog,
    now: () => new Date((clock += 1000)),
    split: SYNTHETIC_SPLIT,
    gates: PERMISSIVE_GATES
  });

  before(async () => resetEvolutionTables(db!));
  after(async () => {
    await resetEvolutionTables(db!);
    await db!.$disconnect();
  });

  it("does nothing while the agent is paused (the default of a new installation)", async () => {
    const outcome = await runResearchCycle(deps(), { trigger: "SCHEDULED" });
    assert.equal(outcome.status, "SKIPPED");
    assert.equal(await db!.evolutionRun.count(), 0);
  });

  it("runs a complete cycle and stores every step", async () => {
    await setAgentStatus(db!, { status: "ACTIVE", reason: "e2e", actor: "test", actorType: "OPERATOR", now: new Date(clock) });
    const outcome = await runResearchCycle(deps(), { trigger: "MANUAL" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    assert.equal(outcome.candidates.length, 3);

    const run = await db!.evolutionRun.findFirstOrThrow({ include: { hypotheses: true, candidates: true, aiCalls: true } });
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.billable, false);
    assert.equal(Number(run.aiCostUsd), 0, "mock usage is never billed");
    assert.equal((run.dataManifestJson as { forwardDataUsed: boolean }).forwardDataUsed, false);
    assert.ok(run.reportMarkdown!.includes("Forschungsdurchlauf"));
    assert.deepEqual(run.aiCalls.map((call) => call.task).sort(), ["HYPOTHESIS_GENERATION", "RESULT_REVIEW"]);
    assert.ok(run.aiCalls.every((call) => call.status === "SUCCEEDED" && call.inputTokens > 0 && !call.billable));
    assert.equal(run.hypotheses.length, 3);
    assert.ok(run.hypotheses.every((hypothesis) => hypothesis.outcome === "ACCEPTED"));

    // The AI context held discovery information only.
    const context = extractResearchContext(prompts[0]!)!;
    assertContextLeakFree(context, SYNTHETIC_SPLIT);
    // Holdout and forward data share the month after validation: no date of it reaches the AI.
    assert.ok(!prompts.join("\n").includes(SYNTHETIC_SPLIT.windows.HOLDOUT.from.slice(0, 7)), "no holdout date ever reaches the AI");

    for (const candidate of run.candidates) {
      assert.match(candidate.candidateKey, /^EVO-(BRK|REG)-\d{4}$/);
      assert.equal(candidate.generation, 1);
      assert.ok(candidate.parentKey.startsWith("ROOT:"));
      assert.ok(["PROPOSED", "REJECTED", "RESERVE", "TECHNICAL_FAILED"].includes(candidate.status), candidate.status);
      assert.ok(candidate.reportMarkdown!.includes(`Forschungsbericht ${candidate.candidateKey}`));
      if (candidate.status !== "TECHNICAL_FAILED") {
        assert.ok(candidate.windowsSeen.includes("DISCOVERY") && candidate.windowsSeen.includes("VALIDATION"));
        const gates = candidate.gatesJson as { gate: string; passed: boolean; message: string }[];
        assert.ok(gates.length >= 10);
        assert.ok(gates.every((gate) => gate.message.length > 0));
      }
    }
    const finalists = run.candidates.filter((candidate) => candidate.holdoutEvaluated);
    assert.equal(finalists.length, 1, "exactly one finalist (permissive gates, maxFinalists 1)");
    const finalist = finalists[0]!;
    const finalGates = (finalist.gatesJson as { stage: string; gate: string }[]).filter((gate) => gate.stage === "FINAL").map((gate) => gate.gate);
    assert.deepEqual(finalGates, ["PARAMETER_ROBUSTNESS", "WALK_FORWARD", "HOLDOUT"]);
    assert.ok(finalist.windowsSeen.includes("HOLDOUT"));
    assert.ok((finalist.metricsJson as { walkForward: unknown }).walkForward !== null);

    // Backtests: 2 roots + 3 candidates on 2 symbols, 1 neighbour, 1 holdout.
    const backtests = await db!.evolutionBacktest.findMany();
    assert.equal(backtests.filter((entry) => entry.role === "BENCHMARK").length, 4);
    assert.equal(backtests.filter((entry) => entry.role === "NEIGHBOUR").length, 2);
    assert.equal(backtests.filter((entry) => entry.windowKey === "HOLDOUT").length, 2);
    assert.ok(backtests.every((entry) => entry.invariantViolations === 0));

    // Exposure ledger: holdout seen exactly by the finalist.
    const holdoutExposure = await db!.evolutionDataExposure.findMany({ where: { windowKey: "HOLDOUT" } });
    assert.deepEqual([...new Set(holdoutExposure.map((entry) => entry.subjectKey))], [finalist.candidateKey]);

    const chain = await verifyEvolutionAuditChain(db!);
    assert.equal(chain.ok, true);
    assert.ok(chain.events >= 8);
  });

  it("a second cycle reuses cached benchmarks, refuses repeats and builds on surviving candidates", async () => {
    const before = await db!.evolutionBacktest.count({ where: { role: "BENCHMARK" } });
    const outcome = await runResearchCycle(deps(), { trigger: "MANUAL" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    assert.equal(await db!.evolutionBacktest.count({ where: { role: "BENCHMARK" } }), before, "benchmarks come from the cache");
    const second = await db!.evolutionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" }, include: { hypotheses: true, candidates: true } });
    const genomes = await db!.evolutionCandidate.findMany({ select: { genomeHash: true } });
    assert.equal(new Set(genomes.map((entry) => entry.genomeHash)).size, genomes.length, "no genome is ever tested twice");
    const history = extractResearchContext(prompts.at(-2)!)!.history;
    assert.ok(history.length >= 3, "the second hypothesis call sees the first cycle's results");
    assert.ok(history.every((entry) => entry.verdict !== "NOT_EVALUATED" || entry.discovery === null));
    for (const candidate of second.candidates) {
      if (candidate.parentKey.startsWith("EVO-")) {
        const parent = await db!.evolutionCandidate.findUniqueOrThrow({ where: { candidateKey: candidate.parentKey } });
        assert.equal(candidate.generation, parent.generation + 1);
        assert.equal(candidate.parentCandidateId, parent.id);
      }
    }
    assert.equal((await verifyEvolutionAuditChain(db!)).ok, true);
  });

  it("gates v2 routes near-copies of the own root to the successor rule and never re-decides earlier candidates", async () => {
    const snapshot = async () =>
      (await db!.evolutionCandidate.findMany({ orderBy: { candidateKey: "asc" } })).map((row) => ({
        key: row.candidateKey,
        status: row.status,
        reasons: row.statusReasons,
        gates: row.gatesJson,
        version: row.version,
        updatedAt: row.updatedAt.toISOString()
      }));
    const before = await snapshot();
    const outcome = await runResearchCycle({ ...deps(), gates: PERMISSIVE_GATES_V2 }, { trigger: "MANUAL" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    const after = await snapshot();
    assert.ok(after.length > before.length, "the v2 cycle added candidates");
    for (const earlier of before) {
      assert.deepEqual(after.find((row) => row.key === earlier.key), earlier, `earlier decision of ${earlier.key} is never re-evaluated`);
    }

    const run = await db!.evolutionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" }, include: { candidates: true } });
    const manifest = run.dataManifestJson as { gatesVersion: string; gatesHash: string };
    assert.equal(manifest.gatesVersion, "evolution-gates-test-v2");
    assert.equal(manifest.gatesHash.length, 64);
    const trigger = EVOLUTION_GATES_V2.successor.correlationTrigger;
    let routed = 0;
    for (const candidate of run.candidates.filter((entry) => entry.gatesJson !== null)) {
      const metrics = candidate.metricsJson as { correlations: { key: string; value: number | null }[]; successor: unknown };
      const ownRoot = `ROOT:${candidate.rootStrategyKey}`;
      const near = metrics.correlations.filter((entry) => entry.value !== null && entry.value > trigger);
      const shouldRoute = near.some((entry) => entry.key === ownRoot) && near.every((entry) => entry.key === ownRoot);
      const gates = candidate.gatesJson as { gate: string; reasonCode: string }[];
      const successorGates = gates.filter((gate) => gate.gate.startsWith("SUCCESSOR_")).map((gate) => gate.gate);
      if (shouldRoute) {
        routed += 1;
        assert.equal(gates.find((gate) => gate.gate === "REDUNDANCY")!.reasonCode, "ROUTED_TO_SUCCESSOR_CHECK");
        assert.deepEqual(successorGates.slice(0, 5), ["SUCCESSOR_BUDGET", "SUCCESSOR_IMPROVEMENT", "SUCCESSOR_CONSISTENCY", "SUCCESSOR_SIGNIFICANCE", "SUCCESSOR_NO_DETERIORATION"]);
        assert.ok(metrics.successor !== null);
        // The compressed synthetic split has one month: the paired test must refuse to decide on that.
        assert.ok(gates.some((gate) => gate.reasonCode === "INSUFFICIENT_PAIRED_SAMPLE"));
        assert.equal(candidate.status, "REJECTED");
        assert.ok(candidate.reportMarkdown!.includes("Nachfolger-Prüfung (Gates v2)"));
      } else {
        assert.deepEqual(successorGates, [], candidate.candidateKey);
      }
    }
    assert.ok(routed >= 1, "the mock's one-step regime refinements are near-copies of the challenger");
  });

  it("gates v3 measures every candidate against its lineage, includes approved strategies and never re-decides earlier candidates", async () => {
    // An operator-approved candidate becomes an existing strategy: a lineage reference and a portfolio member.
    const proposed = await db!.evolutionCandidate.findFirst({ where: { status: "PROPOSED" }, orderBy: { candidateKey: "asc" } });
    if (proposed !== null) {
      await db!.evolutionCandidate.update({ where: { id: proposed.id }, data: { status: "APPROVED_FOR_FORWARD_TEST", decidedBy: "test", decidedAt: new Date(clock), version: { increment: 1 } } });
    }
    const snapshot = async () =>
      (await db!.evolutionCandidate.findMany({ orderBy: { candidateKey: "asc" } })).map((row) => ({
        key: row.candidateKey,
        status: row.status,
        reasons: row.statusReasons,
        gates: row.gatesJson,
        metrics: row.metricsJson,
        version: row.version
      }));
    const before = await snapshot();
    const outcome = await runResearchCycle({ ...deps(), gates: PERMISSIVE_GATES_V3 }, { trigger: "MANUAL" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    const after = await snapshot();
    assert.ok(after.length > before.length, "the v3 cycle added candidates");
    for (const earlier of before) {
      assert.deepEqual(after.find((row) => row.key === earlier.key), earlier, `earlier decision of ${earlier.key} is never re-evaluated`);
    }

    const run = await db!.evolutionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" }, include: { candidates: true } });
    assert.equal((run.dataManifestJson as { gatesVersion: string }).gatesVersion, "evolution-gates-test-v3");
    let screened = 0;
    for (const candidate of run.candidates.filter((entry) => entry.gatesJson !== null)) {
      screened += 1;
      const gates = candidate.gatesJson as { gate: string; reasonCode: string; passed: boolean; informational?: boolean }[];
      const metrics = candidate.metricsJson as { lineage: { path: string | null; references: { key: string; roles: string[] }[]; existing: { key: string }[]; portfolio: { members: string[] } } | null };
      assert.ok(metrics.lineage !== null, candidate.candidateKey);
      const ids = gates.map((gate) => gate.gate);
      for (const id of ["LINEAGE_BUDGET", "VALUE_RISK_ADJUSTED", "VALUE_CONSISTENCY", "VALUE_SIGNIFICANCE", "VALUE_NO_MATERIAL_DETERIORATION", "DIVERSIFICATION_INDEPENDENCE", "DIVERSIFICATION_PORTFOLIO_GAIN", "DIVERSIFICATION_SIGNIFICANCE", "LINEAGE_DECISION"]) {
        assert.ok(ids.includes(id), `${candidate.candidateKey} misses ${id}`);
      }
      assert.equal(ids.some((id) => id.startsWith("SUCCESSOR_")), false, "v3 never routes by correlation");
      assert.notEqual(gates.find((gate) => gate.gate === "REDUNDANCY")!.reasonCode, "ROUTED_TO_SUCCESSOR_CHECK");
      // Every candidate is compared with its own root, whatever its correlation.
      const root = metrics.lineage!.references.find((reference) => reference.key === `ROOT:${candidate.rootStrategyKey}`);
      assert.ok(root !== undefined && root.roles.includes("ROOT"), candidate.candidateKey);
      if (candidate.parentKey.startsWith("EVO-")) {
        assert.ok(metrics.lineage!.references.some((reference) => reference.key === candidate.parentKey && reference.roles.includes("PARENT")));
      }
      if (proposed !== null) {
        assert.ok(metrics.lineage!.existing.some((entry) => entry.key === proposed.candidateKey), "approved candidates are existing strategies");
        assert.ok(metrics.lineage!.portfolio.members.includes(proposed.candidateKey));
      }
      // The compressed synthetic split has one month: neither paired test may decide on that.
      assert.equal(metrics.lineage!.path, null);
      assert.equal(candidate.status, "REJECTED");
      assert.ok(candidate.statusReasons.includes("NO_VALUE_NO_DIVERSIFICATION"));
      assert.ok(gates.filter((gate) => !gate.passed && gate.gate !== "LINEAGE_DECISION" && gate.gate !== "LINEAGE_BUDGET").every((gate) => gate.informational === true));
      assert.ok(candidate.reportMarkdown!.includes("Linienprüfung (Gates v3)"));
    }
    assert.ok(screened >= 1);
  });

  it("gates v3 does not test hypotheses of a family whose monthly validation budget is used up", async () => {
    const exhausted = { ...PERMISSIVE_GATES_V3, lineage: { ...PERMISSIVE_GATES_V3.lineage, maxScreeningsPerFamilyPerMonth: 0 } };
    const scripted: ResearchAiProvider = {
      name: "mock",
      billable: false,
      async complete(request: AiRequest) {
        if (request.task !== "HYPOTHESIS_GENERATION") return new MockResearchProvider().complete(request);
        assert.match(request.prompt, /REGIME_LONG 0/, "the AI is told that nothing is left this month");
        const json = {
          summary: "scripted",
          hypotheses: [
            {
              title: "Längerer Zeit-Backstop über dem Limit",
              marketObservation: "Test",
              rationale: "Test",
              family: "REGIME_LONG",
              parentKey: "ROOT:CRYPTO_REGIME_LONG_V1",
              changes: [{ parameter: "maxHoldHours", value: "1200" }],
              expectedEffect: "Test",
              falsificationCriterion: "Test"
            }
          ]
        };
        const usage = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        return { servedModel: request.model, text: JSON.stringify(json), json, usage, usageByModel: [{ model: request.model, usage }], stopReason: "end_turn", requestId: null, attempts: 1 };
      }
    };
    const exposures = await db!.evolutionDataExposure.count({ where: { windowKey: "VALIDATION", purpose: "SELECTION" } });
    const outcome = await runResearchCycle({ ...deps(), provider: scripted, gates: exhausted }, { trigger: "MANUAL" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    assert.equal(outcome.candidates.length, 0);
    const hypothesis = await db!.evolutionHypothesis.findFirstOrThrow({ where: { title: "Längerer Zeit-Backstop über dem Limit" } });
    assert.equal(hypothesis.outcome, "LINEAGE_BUDGET_EXHAUSTED");
    assert.equal(await db!.evolutionDataExposure.count({ where: { windowKey: "VALIDATION", purpose: "SELECTION" } }), exposures, "no validation data was used");
  });

  it("refuses a hypothesis whose genome was already evaluated as a neighbour variant", async () => {
    const neighbour = await db!.evolutionBacktest.findFirstOrThrow({ where: { role: "NEIGHBOUR" }, include: { candidate: true } });
    const parent = neighbour.candidate!;
    const parentGenome = parent.genomeJson as unknown as CandidateGenome;
    const neighbourGenome = (neighbour.configJson as unknown as { subject: { genome: CandidateGenome } }).subject.genome;
    const changes = diffGenomes(parentGenome, neighbourGenome).map((diff) => ({ parameter: diff.parameter, value: String(diff.to) }));
    const scripted: ResearchAiProvider = {
      name: "mock",
      billable: false,
      async complete(request: AiRequest) {
        if (request.task !== "HYPOTHESIS_GENERATION") return new MockResearchProvider().complete(request);
        const json = {
          summary: "scripted",
          hypotheses: [
            {
              title: "Nachbarvariante erneut einreichen",
              marketObservation: "Test",
              rationale: "Test",
              family: parentGenome.family,
              parentKey: parent.candidateKey,
              changes,
              expectedEffect: "Test",
              falsificationCriterion: "Test"
            }
          ]
        };
        const usage = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        return { servedModel: request.model, text: JSON.stringify(json), json, usage, usageByModel: [{ model: request.model, usage }], stopReason: "end_turn", requestId: null, attempts: 1 };
      }
    };
    const outcome = await runResearchCycle({ ...deps(), provider: scripted }, { trigger: "MANUAL" });
    assert.equal(outcome.status, "COMPLETED", outcome.reason ?? "");
    assert.equal(outcome.candidates.length, 0);
    const hypothesis = await db!.evolutionHypothesis.findFirstOrThrow({ where: { title: "Nachbarvariante erneut einreichen" } });
    assert.equal(hypothesis.outcome, "DUPLICATE");
    assert.match(hypothesis.outcomeReasons.join(" "), /Nachbarvariante/);
  });

  it("stops before backtesting when a billable provider has no budget left", async () => {
    const billable: ResearchAiProvider = { name: "fake-billable", billable: true, complete: async () => Promise.reject(new Error("must not be called")) };
    const runs = await db!.evolutionRun.count();
    const outcome = await runResearchCycle({ ...deps(), provider: billable, config: testConfig({ monthlyBudgetUsd: 0.01, runBudgetUsd: 0.01 }) }, { trigger: "MANUAL" });
    assert.equal(outcome.status, "SKIPPED");
    assert.equal(await db!.evolutionRun.count(), runs);
    const state = await db!.evolutionAgentState.findFirstOrThrow();
    assert.equal(state.status, "PAUSED_BUDGET");
    assert.ok(HYPOTHESIS_RESPONSE_SCHEMA.required.length > 0);
  });
});
