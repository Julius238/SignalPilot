import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import cookie from "@fastify/cookie";
import Fastify from "fastify";

import { requireAdmin } from "../src/auth/helpers.js";
import { registerTradingReadRoutes, setTradingReadsDatabaseForTests } from "../src/routes/trading/reads.js";
import { getEvolutionCandidate, getEvolutionOverview } from "../src/services/evolution/evolutionService.js";

const savedAuth = process.env.API_AUTH_ENABLED;
afterEach(() => {
  if (savedAuth === undefined) delete process.env.API_AUTH_ENABLED;
  else process.env.API_AUTH_ENABLED = savedAuth;
});

const missingTable = () => Promise.reject(Object.assign(new Error("The table `public.EvolutionRun` does not exist"), { code: "P2021" }));
const model = (overrides: Record<string, unknown> = {}) => ({
  findUnique: missingTable,
  findFirst: missingTable,
  findMany: missingTable,
  groupBy: missingTable,
  ...overrides
});
const undeployed = {
  evolutionAgentState: model(),
  evolutionRun: model(),
  evolutionHypothesis: model(),
  evolutionCandidate: model(),
  evolutionAiCall: model(),
  evolutionDataExposure: model()
};

const metrics = (averageR: number, sharpe: number, netReturnPct: number, maxDrawdownPct: number) => ({
  trades: 40,
  winRatePct: 45,
  profitFactor: 1.4,
  averageR,
  expectancy: 4,
  netReturnPct,
  maxDrawdownPct,
  sharpe,
  stressed: { averageR: averageR - 0.1, netPnl: 120 }
});

function deployed() {
  const run = {
    runKey: "EVO-RUN-1",
    trigger: "SCHEDULED",
    status: "COMPLETED",
    providerName: "anthropic",
    billable: true,
    startedAt: new Date("2026-10-19T01:15:00.000Z"),
    finishedAt: new Date("2026-10-19T01:45:00.000Z"),
    hypothesesRequested: 4,
    candidatesGenerated: 2,
    candidatesRejected: 1,
    candidatesProposed: 1,
    aiInputTokens: 9000,
    aiOutputTokens: 6000,
    aiCostUsd: "0.156",
    backtestCount: 12,
    backtestMs: 900_000,
    errorMessage: null,
    aiSummary: "Zusammenfassung",
    dataManifestJson: { budget: { monthlyBudgetUsd: 20, perRunBudgetUsd: 1 }, models: { ADVANCED: "claude-opus-5-5" }, split: { key: "evolution-split-v1" } },
    analysisJson: {
      findings: [{ sentence: "Trendphase BULL begünstigt" }],
      benchmarks: { "ROOT:CRYPTO_TREND_CORE_LONG_V1": { label: "Champion", role: "CHAMPION", strategyKey: "CRYPTO_TREND_CORE_LONG_V1", inSample: metrics(0.1, 0.5, 4, 3) } }
    }
  };
  const candidate = (key: string, status: string, parentKey: string, averageR: number) => ({
    candidateKey: key,
    family: "BREAKOUT_LONG",
    generation: parentKey.startsWith("EVO-") ? 2 : 1,
    parentKey,
    rootStrategyKey: "CRYPTO_TREND_CORE_LONG_V1",
    status,
    statusReasons: status === "REJECTED" ? ["VALIDATION_FAILED"] : [],
    researchScore: "61.5",
    evidenceGrade: "WEAK",
    hypothesis: { title: `Hypothese ${key}` },
    changesJson: [{ parameter: "regimeMinimumConfidence", from: 60, to: 70 }],
    windowsSeen: ["DISCOVERY", "VALIDATION"],
    holdoutEvaluated: status === "PROPOSED",
    createdAt: new Date("2026-10-19T01:20:00.000Z"),
    proposedAt: status === "PROPOSED" ? new Date("2026-10-19T01:44:00.000Z") : null,
    decidedAt: null,
    decidedBy: null,
    metricsJson: { inSample: metrics(averageR, 0.8, 6, 2.5), discovery: metrics(averageR, 0.9, 5, 2), validation: metrics(averageR, 0.6, 1, 1.5) },
    gatesJson: [
      { gate: "MIN_TRADES", stage: "SCREENING", passed: true, reasonCode: "ENOUGH_TRADES", message: "ok" },
      { gate: "VALIDATION_EDGE", stage: "SCREENING", passed: status !== "REJECTED", reasonCode: status === "REJECTED" ? "VALIDATION_FAILED" : "VALIDATION_EDGE_AFTER_COSTS", message: "Hält in der Validierung nicht" }
    ],
    genomeJson: { family: "BREAKOUT_LONG", parameters: {} },
    genomeHash: `hash-${key}`,
    technicalJson: null,
    scoreJson: null,
    reportMarkdown: `# Forschungsbericht ${key}`,
    decisionNote: null,
    run: { runKey: "EVO-RUN-1", providerName: "anthropic", billable: true, startedAt: run.startedAt },
    backtests: []
  });
  const candidates = [candidate("EVO-BRK-0002", "PROPOSED", "EVO-BRK-0001", 0.3), candidate("EVO-BRK-0001", "REJECTED", "ROOT:CRYPTO_TREND_CORE_LONG_V1", -0.1)];
  return {
    evolutionAgentState: model({
      findUnique: async () => ({ key: "EVOLUTION_V1", status: "ACTIVE", statusReason: "ok", pausedUntil: null, lastRunAt: run.finishedAt, nextRunAt: new Date("2026-10-26T01:15:00.000Z"), leaseOwner: null, leaseExpiresAt: null })
    }),
    evolutionRun: model({ findMany: async () => [run] }),
    evolutionHypothesis: model({ findMany: async () => [] }),
    evolutionCandidate: model({
      findMany: async () => candidates,
      findUnique: async ({ where }: { where: { candidateKey: string } }) => candidates.find((entry) => entry.candidateKey === where.candidateKey) ?? null
    }),
    evolutionAiCall: model({
      groupBy: async ({ where }: { where?: unknown }) =>
        where === undefined
          ? [{ billable: true, _sum: { costUsd: "1.25", inputTokens: 90_000, outputTokens: 60_000 }, _count: 9 }]
          : [
              { billable: true, _sum: { costUsd: "0.156", inputTokens: 9000, outputTokens: 6000 }, _count: 2 },
              { billable: false, _sum: { costUsd: "0.02", inputTokens: 1000, outputTokens: 500 }, _count: 2 }
            ],
      findFirst: async () => ({ createdAt: run.finishedAt, requestedModel: "claude-opus-5-5", servedModel: "claude-opus-5-5", provider: "anthropic" })
    }),
    evolutionDataExposure: model({ groupBy: async () => [{ windowKey: "HOLDOUT", purpose: "HOLDOUT_CHECK", _count: 2 }] })
  };
}

describe("evolution read model", () => {
  it("reports `available: false` where the evolution migration is absent", async () => {
    const overview = await getEvolutionOverview(undeployed as never);
    assert.equal(overview.available, false);
    assert.deepEqual(await getEvolutionCandidate(undeployed as never, "EVO-BRK-0001"), { available: false });
  });

  it("shapes agent, budget, candidates and the comparison with the champion", async () => {
    const overview = await getEvolutionOverview(deployed() as never, new Date("2026-10-20T00:00:00.000Z"));
    assert.equal(overview.available, true);
    if (!overview.available) return;
    assert.equal(overview.agent.status, "ACTIVE");
    assert.equal(overview.budget.monthlyBudgetUsd, 20);
    assert.equal(overview.budget.spentUsd, 0.156);
    assert.equal(overview.budget.remainingUsd, 20 - 0.156);
    assert.equal(overview.budget.simulatedUsdThisMonth, 0.02);
    assert.equal(overview.budget.totalSpentUsd, 1.25);
    assert.deepEqual(overview.awaitingApproval, ["EVO-BRK-0002"]);
    const proposed = overview.candidates.find((entry) => entry.key === "EVO-BRK-0002")!;
    assert.ok(Math.abs(proposed.versusChampion!.sharpeDelta! - 0.3) < 1e-12);
    assert.ok(Math.abs(proposed.versusChampion!.averageRDelta! - 0.2) < 1e-12);
    const rejected = overview.candidates.find((entry) => entry.key === "EVO-BRK-0001")!;
    assert.deepEqual(rejected.failedGates.map((gate) => gate.reasonCode), ["VALIDATION_FAILED"]);
    assert.equal(overview.exposure.HOLDOUT!.HOLDOUT_CHECK, 2);
    assert.match(overview.notice, /Kein Forward-Ergebnis/);
    assert.deepEqual(overview.runs[0]!.findings, ["Trendphase BULL begünstigt"]);
  });

  it("reads a candidate with its lineage back to the frozen root", async () => {
    const detail = await getEvolutionCandidate(deployed() as never, "EVO-BRK-0002");
    assert.ok(detail !== null && detail.available);
    if (detail === null || !detail.available) return;
    assert.deepEqual(detail.lineage, ["CRYPTO_TREND_CORE_LONG_V1", "EVO-BRK-0001", "EVO-BRK-0002"]);
    assert.equal(detail.reportMarkdown, "# Forschungsbericht EVO-BRK-0002");
  });
});

describe("evolution routes", () => {
  async function server(db: unknown, authEnabled: boolean) {
    process.env.API_AUTH_ENABLED = authEnabled ? "true" : "false";
    const app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        await requireAdmin(request, reply);
      });
      await scope.register(registerTradingReadRoutes);
    });
    setTradingReadsDatabaseForTests(db as never);
    return app;
  }

  it("serves the overview and validates candidate keys", async () => {
    const app = await server(deployed(), false);
    const overview = await app.inject({ method: "GET", url: "/trading/evolution" });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().available, true);
    assert.equal((await app.inject({ method: "GET", url: "/trading/evolution/candidates/EVO-BRK-0002" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/trading/evolution/candidates/EVO-BRK-0404" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/trading/evolution/candidates/robert');DROP" })).statusCode, 400);
    await app.close();
  });

  it("is behind the admin guard like every trading read", async () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.AUTH_SESSION_SECRET = "test-secret-must-be-long-enough-32chars";
    const app = await server(undeployed, true);
    assert.equal((await app.inject({ method: "GET", url: "/trading/evolution" })).statusCode, 401);
    await app.close();
  });
});
