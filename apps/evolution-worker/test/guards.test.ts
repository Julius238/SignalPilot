import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import { AiProviderError, EVOLUTION_DATA_SPLIT_V1, HYPOTHESIS_RESPONSE_SCHEMA, MockResearchProvider, type AiRequest, type ResearchAiProvider } from "@signalpilot/evolution";

import { budgetStatus, callResearchAi } from "../src/ai/budgetedAi.js";
import { runAiSmoke } from "../src/ai/smoke.js";
import { decideCandidate } from "../src/cli.js";
import { EvolutionConfigError, describeConfig, loadEvolutionConfig } from "../src/config.js";
import { decodeSnapshot, loadEvolutionMarket, snapshotFileName } from "../src/market/snapshots.js";
import { acquireRunLease, ensureAgentState, releaseExpiredBudgetPause, releaseRunLease, setAgentStatus } from "../src/persistence/agentState.js";
import { recordAuditEvent, verifyEvolutionAuditChain } from "../src/persistence/audit.js";
import { DB_SKIP_REASON, resetEvolutionTables, silentLog, testDatabase } from "./support.js";

describe("configuration", () => {
  it("defaults to the mock provider, 20 USD a month, 1 USD a run, idle", () => {
    const config = loadEvolutionConfig({});
    assert.equal(config.provider, "mock");
    assert.equal(config.enabled, false);
    assert.equal(config.monthlyBudgetUsd, 20);
    assert.equal(config.runBudgetUsd, 1);
    assert.deepEqual(config.models, { STANDARD: "claude-haiku-5-5", ADVANCED: "claude-opus-5-5" });
    assert.equal(config.backtestConcurrency, 1);
    assert.equal(config.gatesVersion, "v3", "new candidates are decided by the pre-registered gates v3");
    assert.equal(loadEvolutionConfig({ EVOLUTION_GATES_VERSION: "v1" }).gatesVersion, "v1");
    assert.equal(loadEvolutionConfig({ EVOLUTION_GATES_VERSION: "v2" }).gatesVersion, "v2");
  });

  it("fails closed", () => {
    for (const env of [
      { EVOLUTION_AI_PROVIDER: "anthropic" },
      { EVOLUTION_AI_PROVIDER: "openai" },
      { EVOLUTION_AI_MODEL_ADVANCED: "claude-unpriced-9" },
      { EVOLUTION_AI_MONTHLY_BUDGET_USD: "abc" },
      { EVOLUTION_AI_RUN_BUDGET_USD: "30" },
      { EVOLUTION_MAX_CONCURRENT_RUNS: "2" },
      { EVOLUTION_ENABLED: "yes" },
      { EVOLUTION_GATES_VERSION: "v4" }
    ]) {
      assert.throws(() => loadEvolutionConfig(env), EvolutionConfigError, JSON.stringify(env));
    }
    assert.throws(() => loadEvolutionConfig({ EVOLUTION_CODE_GENERATION_ENABLED: "true" }), /disabled/);
  });

  it("never describes the key or the database URL", () => {
    const config = loadEvolutionConfig({ EVOLUTION_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-secret", DATABASE_URL: "postgresql://u:pw@h/db" });
    const text = JSON.stringify(describeConfig(config));
    assert.ok(!text.includes("sk-ant-secret") && !text.includes("pw@h"));
    assert.ok(text.includes('"anthropicApiKeyConfigured":true'));
  });
});

describe("snapshot loader", () => {
  const csv = (rows: [number, number][]) => gzipSync(["openTime,closeTime,open,high,low,close,volume", ...rows.map(([open, close]) => `${open},${close},1,2,0.5,1.5,10`), ""].join("\n"));

  it("drops every candle after the forward cut-off and fingerprints only what remains", async () => {
    const cutoff = Date.parse(EVOLUTION_DATA_SPLIT_V1.forwardFrom) - 1;
    const decoded = decodeSnapshot(csv([[cutoff - 7_200_000, cutoff - 3_600_001], [cutoff - 3_600_000, cutoff], [cutoff + 1, cutoff + 3_600_000]]), cutoff);
    assert.equal(decoded.candles.length, 2);
    assert.equal(decoded.dropped, 1);

    const dir = mkdtempSync(join(tmpdir(), "evo-snap-"));
    const write = (extra: boolean) => {
      for (const symbol of EVOLUTION_DATA_SPLIT_V1.symbols)
        for (const timeframe of ["1h", "4h", "1d"] as const) {
          const rows: [number, number][] = [[cutoff - 7_200_000, cutoff - 3_600_001]];
          if (extra) rows.push([cutoff + 1, cutoff + 3_600_000]);
          writeFileSync(join(dir, snapshotFileName(symbol, timeframe)), csv(rows));
        }
    };
    write(false);
    const before = await loadEvolutionMarket(dir, EVOLUTION_DATA_SPLIT_V1);
    write(true);
    const afterRefresh = await loadEvolutionMarket(dir, EVOLUTION_DATA_SPLIT_V1);
    assert.equal(afterRefresh.fingerprint, before.fingerprint, "newer forward data never changes the research data");
    assert.ok(afterRefresh.files.every((file) => file.droppedAfterCutoff === 1));
    assert.ok(afterRefresh.market.series.every((series) => Object.values(series.candles).every((candles) => candles!.every((candle) => candle.closeTime < Date.parse(EVOLUTION_DATA_SPLIT_V1.forwardFrom)))));
  });
});

describe("isolation from the trading path", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const pkg = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as { dependencies?: Record<string, string> };
  const sources = (dir: string): string[] =>
    readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
      // Code only: comments may name what the code must not do.
      .map((text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));

  it("the trading worker neither depends on nor imports the evolution engine", () => {
    const deps = Object.keys(pkg("apps/trading-worker/package.json").dependencies ?? {});
    assert.ok(!deps.some((name) => name.includes("evolution")), deps.join(","));
    assert.ok(sources("apps/trading-worker/src").every((text) => !/@signalpilot\/evolution|evolution-worker/.test(text)));
  });

  it("the evolution worker depends on no app, no exchange, alert or trading-worker code", () => {
    const deps = Object.keys(pkg("apps/evolution-worker/package.json").dependencies ?? {});
    for (const forbidden of ["@signalpilot/trading-worker", "@signalpilot/api", "@signalpilot/alerts", "@signalpilot/market-data", "@signalpilot/worker"]) {
      assert.ok(!deps.includes(forbidden), forbidden);
    }
    assert.ok(sources("apps/evolution-worker/src").every((text) => !/shadowPortfolio|tradingSession|shadowOrder|arenaParticipant\.(create|update)/.test(text)));
  });

  it("the pure evolution package has no database, network or environment access", () => {
    const deps = Object.keys(pkg("packages/evolution/package.json").dependencies ?? {});
    assert.deepEqual(deps.sort(), ["@signalpilot/shadow-replay", "@signalpilot/strategy-engine", "@signalpilot/trading-domain"]);
    assert.ok(sources("packages/evolution/src").every((text) => !/process\.env|from "node:(fs|http|https|net)"|fetch\(|@prisma/.test(text)));
  });
});

const db = testDatabase();

describe("budget, lease and audit against PostgreSQL", { skip: db === null ? DB_SKIP_REASON : false }, () => {
  before(async () => resetEvolutionTables(db!));
  after(async () => {
    await resetEvolutionTables(db!);
    await db!.$disconnect();
  });

  const billableProvider = (outputTokens: number): ResearchAiProvider & { calls: number } => {
    const provider = {
      name: "fake-billable",
      billable: true,
      calls: 0,
      async complete(request: AiRequest) {
        provider.calls += 1;
        const usage = { inputTokens: 10_000, outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        return { servedModel: request.model, text: "{}", json: {}, usage, usageByModel: [{ model: request.model, usage }], stopReason: "end_turn", requestId: "req", attempts: 1 };
      }
    };
    return provider;
  };
  const request = (maxOutputTokens: number): AiRequest => ({ task: "RESULT_REVIEW", tier: "STANDARD", model: "claude-opus-5-5", system: "s", prompt: "p", jsonSchema: HYPOTHESIS_RESPONSE_SCHEMA, maxOutputTokens, effort: "low" });

  it("records actual cost, blocks the call that would overshoot and pauses the agent until next month", async () => {
    const now = new Date("2026-10-20T10:00:00.000Z");
    const provider = billableProvider(4000);
    const deps = { db: db!, provider, config: { monthlyBudgetUsd: 0.5, runBudgetUsd: 0.5 }, now: () => now, log: silentLog };
    await setAgentStatus(db!, { status: "ACTIVE", reason: "test", actor: "test", actorType: "OPERATOR", now });
    const first = await callResearchAi(deps, { runId: null, request: request(4000) });
    assert.equal(first.ok, true);
    // 10 000 × $4 + 4 000 × $20 per million = $0.12.
    assert.equal(first.ok && first.costUsd, 0.12);
    const second = await callResearchAi(deps, { runId: null, request: request(20_000) });
    assert.equal(second.ok, false);
    assert.equal(!second.ok && second.decision.reason, "MONTHLY_BUDGET_EXHAUSTED");
    assert.equal(provider.calls, 1, "a blocked call never reaches the provider");
    const state = await ensureAgentState(db!);
    assert.equal(state.status, "PAUSED_BUDGET");
    assert.equal(state.pausedUntil?.toISOString(), "2026-11-01T00:00:00.000Z");
    const status = await budgetStatus(db!, { monthlyBudgetUsd: 0.5 }, now);
    assert.equal(status.spentUsd, 0.12);
    const calls = await db!.evolutionAiCall.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(calls.map((call) => call.status), ["SUCCEEDED", "BLOCKED_BUDGET"]);
    assert.equal(await releaseExpiredBudgetPause(db!, new Date("2026-10-31T23:00:00.000Z")), false);
    assert.equal(await releaseExpiredBudgetPause(db!, new Date("2026-11-01T00:00:01.000Z")), true);
    assert.equal((await ensureAgentState(db!)).status, "ACTIVE");
  });

  it("mock calls are recorded at list price but never count against the budget", async () => {
    const now = new Date("2026-12-02T10:00:00.000Z");
    const provider = { ...billableProvider(1000), billable: false, name: "mock" };
    const result = await callResearchAi({ db: db!, provider, config: { monthlyBudgetUsd: 0.01, runBudgetUsd: 0.01 }, now: () => now, log: silentLog }, { runId: null, request: request(1000) });
    assert.equal(result.ok, true);
    assert.equal((await budgetStatus(db!, { monthlyBudgetUsd: 0.01 }, now)).spentUsd, 0);
  });

  it("records a failed call with the tokens it used, then rethrows", async () => {
    const now = new Date("2026-12-03T10:00:00.000Z");
    const usage = { inputTokens: 500, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    const failing: ResearchAiProvider = {
      name: "fake-billable",
      billable: true,
      async complete() {
        throw new AiProviderError("REFUSAL", "declined", { usageByModel: [{ model: "claude-opus-5-5", usage }] });
      }
    };
    await assert.rejects(callResearchAi({ db: db!, provider: failing, config: { monthlyBudgetUsd: 5, runBudgetUsd: 1 }, now: () => now, log: silentLog }, { runId: null, request: request(1000) }), /declined/);
    const call = await db!.evolutionAiCall.findFirstOrThrow({ where: { status: "REFUSED" } });
    assert.equal(Number(call.costUsd), (500 * 4 + 100 * 20) / 1_000_000);
  });

  it("books a billable call without reported usage (timeout) at its worst case, never as free", async () => {
    const now = new Date("2027-01-04T10:00:00.000Z");
    const timingOut: ResearchAiProvider = {
      name: "fake-billable",
      billable: true,
      async complete() {
        throw new AiProviderError("TIMEOUT", "request timed out");
      }
    };
    await assert.rejects(callResearchAi({ db: db!, provider: timingOut, config: { monthlyBudgetUsd: 5, runBudgetUsd: 1 }, now: () => now, log: silentLog }, { runId: null, request: request(1000) }), /timed out/);
    const call = await db!.evolutionAiCall.findFirstOrThrow({ where: { errorKind: "TIMEOUT" } });
    assert.equal(Number(call.costUsd), Number(call.worstCaseUsd));
    assert.ok(Number(call.costUsd) > 0);
    assert.match(call.errorMessage!, /unbestätigt/);
    assert.equal((await budgetStatus(db!, { monthlyBudgetUsd: 5 }, now)).spentUsd, Number(call.worstCaseUsd));
  });

  it("the connection smoke test makes one tiny, recorded call per tier", async () => {
    const now = new Date("2027-02-05T10:00:00.000Z");
    const before = await db!.evolutionAiCall.count({ where: { task: "RESULT_REVIEW", budgetMonth: "2027-02" } });
    const results = await runAiSmoke({
      db: db!,
      provider: new MockResearchProvider(),
      config: { models: { STANDARD: "claude-haiku-5-5", ADVANCED: "claude-opus-5-5" }, monthlyBudgetUsd: 2, runBudgetUsd: 1 },
      now: () => now,
      log: silentLog
    });
    assert.deepEqual(results.map((entry) => [entry.tier, entry.model, entry.ok]), [["STANDARD", "claude-haiku-5-5", true], ["ADVANCED", "claude-opus-5-5", true]]);
    assert.equal(await db!.evolutionAiCall.count({ where: { task: "RESULT_REVIEW", budgetMonth: "2027-02" } }), before + 2);
  });

  it("allows only one research run at a time; an expired lease can be taken over", async () => {
    const now = new Date("2026-10-20T10:00:00.000Z");
    assert.equal(await acquireRunLease(db!, "a", now, 60_000), true);
    assert.equal(await acquireRunLease(db!, "b", now, 60_000), false);
    assert.equal(await acquireRunLease(db!, "b", new Date(now.getTime() + 61_000), 60_000), true);
    await releaseRunLease(db!, "b");
    const parallel = await Promise.all(["x", "y", "z", "w"].map((owner) => acquireRunLease(db!, owner, now, 60_000)));
    assert.equal(parallel.filter(Boolean).length, 1);
  });

  it("keeps a verifiable hash chain and detects tampering", async () => {
    await recordAuditEvent(db!, { eventKey: "test:1", eventType: "TEST", aggregateType: "T", aggregateId: "1", actorType: "SYSTEM", payload: { value: 0.1 + 0.2 }, occurredAt: new Date() });
    assert.equal((await verifyEvolutionAuditChain(db!)).ok, true);
    const event = await db!.evolutionAuditEvent.findUniqueOrThrow({ where: { eventKey: "test:1" } });
    await db!.evolutionAuditEvent.update({ where: { id: event.id }, data: { payloadJson: { value: 1 } } });
    const broken = await verifyEvolutionAuditChain(db!);
    assert.equal(broken.ok, false);
    assert.equal(broken.brokenAt, event.sequence);
    await db!.evolutionAuditEvent.deleteMany();
  });

  it("an operator decision is possible only on a proposed candidate and is audited", async () => {
    const run = await db!.evolutionRun.create({
      data: { runKey: "EVO-RUN-T", trigger: "MANUAL", status: "COMPLETED", providerName: "mock", billable: false, engineVersion: "t", codeVersion: "t", splitKey: "s", splitHash: "h", dataManifestJson: {}, startedAt: new Date() }
    });
    const base = { family: "BREAKOUT_LONG", generation: 1, parentKey: "ROOT:CRYPTO_TREND_CORE_LONG_V1", rootStrategyKey: "CRYPTO_TREND_CORE_LONG_V1", runId: run.id, genomeJson: {}, changesJson: [], statusReasons: [], windowsSeen: [] };
    await db!.evolutionCandidate.create({ data: { ...base, candidateKey: "EVO-BRK-0901", sequence: 901, genomeHash: "g1", status: "PROPOSED" } });
    await db!.evolutionCandidate.create({ data: { ...base, candidateKey: "EVO-BRK-0902", sequence: 902, genomeHash: "g2", status: "REJECTED" } });
    const now = new Date();
    assert.equal(await decideCandidate(db!, { candidateKey: "EVO-BRK-0901", decision: "APPROVE", actor: "julius", note: "Forward-Test vorbereiten", now }), "APPROVED_FOR_FORWARD_TEST");
    await assert.rejects(decideCandidate(db!, { candidateKey: "EVO-BRK-0901", decision: "REJECT", actor: "julius", note: null, now }), /Nur vorgeschlagene/);
    await assert.rejects(decideCandidate(db!, { candidateKey: "EVO-BRK-0902", decision: "APPROVE", actor: "julius", note: null, now }), /Nur vorgeschlagene/);
    const approved = await db!.evolutionCandidate.findUniqueOrThrow({ where: { candidateKey: "EVO-BRK-0901" } });
    assert.equal(approved.decidedBy, "julius");
    assert.ok(await db!.evolutionAuditEvent.findFirst({ where: { eventType: "CANDIDATE_APPROVED_FOR_FORWARD_TEST", actorId: "julius" } }));
  });
});
