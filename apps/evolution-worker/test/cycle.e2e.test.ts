/**
 * End-to-end: mock AI → hypotheses → executable candidates → technical tests
 * → backtests (the unchanged shadow replay) → gates → persisted results and
 * reports, against real PostgreSQL. The market is synthetic and the split
 * compressed; the test proves the machinery, never real performance.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HYPOTHESIS_RESPONSE_SCHEMA, MockResearchProvider, assertContextLeakFree, extractResearchContext, type AiRequest, type ResearchAiProvider } from "@signalpilot/evolution";

import { InProcessBacktestRunner } from "../src/backtest/pool.js";
import { runResearchCycle, type CycleDeps } from "../src/cycle/researchCycle.js";
import { setAgentStatus } from "../src/persistence/agentState.js";
import { verifyEvolutionAuditChain } from "../src/persistence/audit.js";
import { DB_SKIP_REASON, PERMISSIVE_GATES, SYNTHETIC_SPLIT, resetEvolutionTables, silentLog, syntheticMarket, testConfig, testDatabase } from "./support.js";

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
    assert.ok(!prompts.join("\n").includes("2023-12"), "no holdout date ever reaches the AI");

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
