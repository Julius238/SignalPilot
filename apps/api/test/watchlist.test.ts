import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify from "fastify";
import {
  AssetType,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  PaperExpectedMoveDirection,
  Prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType,
  WatchlistPriority
} from "@signalpilot/database";

import {
  registerDashboardRoutes,
  setDashboardDatabaseForTests
} from "../src/routes/dashboard.js";

describe("watchlist routes", () => {
  const originalAlertMode = process.env.ALERT_MODE;
  const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN;
  const originalEnableLiveTrading = process.env.ENABLE_LIVE_TRADING;
  const originalWebhookUrl = process.env.N8N_WEBHOOK_SIGNAL_URL;

  afterEach(() => {
    restoreEnv("ALERT_MODE", originalAlertMode);
    restoreEnv("DASHBOARD_ORIGIN", originalDashboardOrigin);
    restoreEnv("ENABLE_LIVE_TRADING", originalEnableLiveTrading);
    restoreEnv("N8N_WEBHOOK_SIGNAL_URL", originalWebhookUrl);
  });

  it("creates a watchlist item and returns asset data", async () => {
    const server = await createServer();

    const response = await server.inject({
      method: "POST",
      url: "/watchlist",
      payload: {
        symbol: "BTCUSDT",
        priority: "HIGH",
        notes: "Core crypto setup",
        alertEnabled: true
      }
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.symbol, "BTCUSDT");
    assert.equal(body.priority, "HIGH");
    assert.equal(body.asset.assetType, "CRYPTO");
    assert.equal(body.latestSignal.status, "WATCH");

    const listResponse = await server.inject("/watchlist");
    assert.equal(listResponse.statusCode, 200);
    const listBody = listResponse.json();
    assert.equal(listBody.length, 1);
    assert.equal(listBody[0].asset.symbol, "BTCUSDT");

    await server.close();
  });

  it("returns 409 for duplicate POST", async () => {
    const server = await createServer();

    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/watchlist",
          payload: { symbol: "BTCUSDT" }
        })
      ).statusCode,
      201
    );

    const duplicate = await server.inject({
      method: "POST",
      url: "/watchlist",
      payload: { symbol: "BTCUSDT" }
    });

    assert.equal(duplicate.statusCode, 409);

    await server.close();
  });

  it("patches priority, notes and alertEnabled", async () => {
    const { server, state } = await createServerWithState();
    state.watchlistItems.push(createWatchlistItem());

    const response = await server.inject({
      method: "PATCH",
      url: "/watchlist/watchlist-1",
      payload: {
        priority: "LOW",
        notes: "Lower conviction",
        alertEnabled: false
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.priority, "LOW");
    assert.equal(body.notes, "Lower conviction");
    assert.equal(body.alertEnabled, false);

    await server.close();
  });

  it("deletes a watchlist item", async () => {
    const { server, state } = await createServerWithState();
    state.watchlistItems.push(createWatchlistItem());

    const response = await server.inject({
      method: "DELETE",
      url: "/watchlist/watchlist-1"
    });

    assert.equal(response.statusCode, 204);
    assert.equal(state.watchlistItems.length, 0);

    await server.close();
  });

  it("passes watchlistOnly into scanner filters", async () => {
    const { server, state } = await createServerWithState();

    const response = await server.inject("/scanner?watchlistOnly=true");

    assert.equal(response.statusCode, 200);
    assert.ok(
      state.signalFindManyWhere.some((where) => JSON.stringify(where).includes("watchlistItem"))
    );

    await server.close();
  });

  it("returns only safe public config", async () => {
    process.env.ALERT_MODE = "HIGH_PRIORITY_ONLY";
    process.env.DASHBOARD_ORIGIN = "http://localhost:3000";
    process.env.ENABLE_LIVE_TRADING = "false";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://secret.example.test/webhook";

    const server = await createServer();
    const response = await server.inject("/config/public");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      alertMode: "HIGH_PRIORITY_ONLY",
      alertCooldownMinutes: 240,
      alertScoreImprovementThreshold: 8,
      dashboardOrigin: "http://localhost:3000",
      liveTradingEnabled: false,
      paperTradingOnly: true
    });
    assert.equal(JSON.stringify(body).includes("secret"), false);
    assert.equal("N8N_WEBHOOK_SIGNAL_URL" in body, false);

    await server.close();
  });

  it("returns alert states ordered by lastSentAt", async () => {
    const { server, state } = await createServerWithState();
    state.alertStates.push(createAlertState({ symbol: "ETHUSDT", lastSentAt: new Date("2026-01-01T00:00:00.000Z") }));
    state.alertStates.push(createAlertState({ symbol: "BTCUSDT", lastSentAt: new Date("2026-01-02T00:00:00.000Z") }));

    const response = await server.inject("/alerts/states?limit=100");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.length, 2);
    assert.equal(body[0].symbol, "BTCUSDT");
    assert.equal(body[1].symbol, "ETHUSDT");

    await server.close();
  });

  it("returns paper evaluation stats", async () => {
    const { server, state } = await createServerWithState();
    state.paperEvaluations.push(
      createPaperEvaluation({
        outcome: PaperEvaluationOutcome.POSITIVE,
        returnAfter1d: 1.2
      }),
      createPaperEvaluation({
        id: "paper-evaluation-2",
        evaluationStatus: PaperEvaluationStatus.EVALUATED,
        outcome: PaperEvaluationOutcome.NEGATIVE,
        returnAfter1d: -0.8
      })
    );

    const response = await server.inject("/paper/stats");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.totalEvaluations, 2);
    assert.equal(body.evaluatedCount, 2);
    assert.equal(body.positiveCount, 1);
    assert.equal(body.negativeCount, 1);
    assert.equal(body.winRate, 50);
    assert.equal(body.groupedBySignalStatus.WATCH, 2);
    assert.equal(body.byEvaluationKind.DIRECTIONAL_BULLISH, 2);
    assert.deepEqual(body.skippedByReason, {});
    assert.equal(body.observationStats.total, 0);

    await server.close();
  });

  it("returns an empty performance report", async () => {
    const server = await createServer();
    const response = await server.inject("/performance/report");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.totalEvaluations, 0);
    assert.equal(body.evaluatedCount, 0);
    assert.equal(body.overallWinRate, 0);
    assert.ok(body.warnings.includes("Keine Paper Evaluations vorhanden."));

    await server.close();
  });

  it("returns a performance report with test data", async () => {
    const { server, state } = await createServerWithState();
    state.paperEvaluations.push(
      createPaperEvaluation({
        signalType: SignalType.BREAKOUT_ALERT,
        outcome: PaperEvaluationOutcome.POSITIVE,
        returnAfter1d: 1.2
      }),
      createPaperEvaluation({
        id: "paper-evaluation-2",
        signalType: SignalType.VOLUME_SPIKE,
        outcome: PaperEvaluationOutcome.NEGATIVE,
        returnAfter1d: -1
      }),
      createPaperEvaluation({
        id: "paper-evaluation-3",
        signalType: SignalType.BREAKOUT_ALERT,
        outcome: PaperEvaluationOutcome.TARGET_REACHED,
        returnAfter1d: 2
      })
    );

    const response = await server.inject("/performance/report");
    const bucketsResponse = await server.inject("/performance/buckets?groupBy=signalType");
    const kindBucketsResponse = await server.inject("/performance/buckets?groupBy=evaluationKind");

    assert.equal(response.statusCode, 200);
    assert.equal(bucketsResponse.statusCode, 200);
    assert.equal(kindBucketsResponse.statusCode, 200);
    const body = response.json();
    assert.equal(body.totalEvaluations, 3);
    assert.equal(Math.round(body.overallWinRate * 10) / 10, 66.7);
    assert.equal(body.bestSignalTypes[0].key, SignalType.BREAKOUT_ALERT);
    assert.equal(body.groupedByEvaluationKind[0].key, PaperEvaluationKind.DIRECTIONAL_BULLISH);
    assert.equal(bucketsResponse.json()[0].key, SignalType.BREAKOUT_ALERT);
    assert.equal(kindBucketsResponse.json()[0].key, PaperEvaluationKind.DIRECTIONAL_BULLISH);

    await server.close();
  });

  it("returns data quality report and asset coverage", async () => {
    const { server, state } = await createServerWithState();
    state.paperEvaluations.push(
      createPaperEvaluation({
        evaluationStatus: PaperEvaluationStatus.SKIPPED,
        evaluationKind: PaperEvaluationKind.SKIPPED,
        skipReason: "WAIT signal below evaluation threshold.",
        outcome: null
      })
    );

    const reportResponse = await server.inject("/data-quality/report?assetType=CRYPTO");
    const assetsResponse = await server.inject("/data-quality/assets?assetType=CRYPTO&limit=100");

    assert.equal(reportResponse.statusCode, 200);
    assert.equal(assetsResponse.statusCode, 200);
    const report = reportResponse.json();
    assert.equal(report.assetCoverage[0].symbol, "BTCUSDT");
    assert.equal(report.candleCoverage.assetsBelowMinimumByTimeframe["1h"], 1);
    assert.equal(report.evaluationCoverage.skippedByReason["WAIT signal below evaluation threshold."], 1);
    assert.equal(assetsResponse.json()[0].qualityScore >= 0, true);

    await server.close();
  });

  it("returns latest market regime snapshot", async () => {
    const { server } = await createServerWithState();

    const response = await server.inject("/market-regime/latest");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.id, "market-regime-1");
    assert.equal(body.report.overallRegime, "NEUTRAL");

    await server.close();
  });
});

async function createServer() {
  const { server } = await createServerWithState();
  return server;
}

async function createServerWithState() {
  const state = {
    assets: [createAsset()],
    watchlistItems: [] as ReturnType<typeof createWatchlistItem>[],
    alertStates: [] as ReturnType<typeof createAlertState>[],
    paperEvaluations: [] as ReturnType<typeof createPaperEvaluation>[],
    marketRegimeSnapshots: [createMarketRegimeSnapshot()],
    signalFindManyWhere: [] as unknown[]
  };
  const server = Fastify({ logger: false });

  setDashboardDatabaseForTests(createDatabase(state) as never);
  await registerDashboardRoutes(server);

  return { server, state };
}

function createDatabase(state: {
  assets: ReturnType<typeof createAsset>[];
  watchlistItems: ReturnType<typeof createWatchlistItem>[];
  alertStates: ReturnType<typeof createAlertState>[];
  paperEvaluations: ReturnType<typeof createPaperEvaluation>[];
  marketRegimeSnapshots: ReturnType<typeof createMarketRegimeSnapshot>[];
  signalFindManyWhere: unknown[];
}) {
  return {
    asset: {
      findMany: async () => state.assets,
      findFirst: async ({ where }: { where: { symbol?: string } }) =>
        state.assets.find((asset) => asset.symbol === where.symbol) ?? null
    },
    watchlistItem: {
      findMany: async () =>
        state.watchlistItems.map((item) => ({
          ...item,
          asset: state.assets.find((asset) => asset.id === item.assetId) ?? state.assets[0]
        })),
      create: async ({ data }: { data: { assetId: string; symbol: string; priority: WatchlistPriority; notes?: string | null; alertEnabled: boolean } }) => {
        if (state.watchlistItems.some((item) => item.assetId === data.assetId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test"
          });
        }

        const item = createWatchlistItem({
          symbol: data.symbol,
          priority: data.priority,
          notes: data.notes ?? null,
          alertEnabled: data.alertEnabled
        });
        state.watchlistItems.push(item);

        return {
          ...item,
          asset: state.assets[0]
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: { priority?: WatchlistPriority; notes?: string | null; alertEnabled?: boolean } }) => {
        const item = state.watchlistItems.find((candidate) => candidate.id === where.id);

        if (!item) {
          throw new Prisma.PrismaClientKnownRequestError("Record not found", {
            code: "P2025",
            clientVersion: "test"
          });
        }

        Object.assign(item, data, { updatedAt: new Date("2026-01-02T00:00:00.000Z") });
        return {
          ...item,
          asset: state.assets[0]
        };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = state.watchlistItems.findIndex((item) => item.id === where.id);

        if (index === -1) {
          throw new Prisma.PrismaClientKnownRequestError("Record not found", {
            code: "P2025",
            clientVersion: "test"
          });
        }

        state.watchlistItems.splice(index, 1);
      }
    },
    signal: {
      findFirst: async () => createSignal(),
      findMany: async ({ where }: { where: unknown }) => {
        state.signalFindManyWhere.push(where);
        return [];
      },
      groupBy: async () => [],
      count: async ({ where }: { where?: unknown } = {}) =>
        JSON.stringify(where ?? {}).includes("paperEvaluation") ? 0 : 1
    },
    candle: {
      groupBy: async () => [],
      findMany: async () => []
    },
    alert: {
      count: async () => 0,
      findMany: async () => []
    },
    event: {
      findMany: async () => []
    },
    alertState: {
      findMany: async ({ where, take }: { where: { symbol?: string; status?: SignalStatus }; take: number }) =>
        state.alertStates
          .filter((alertState) => !where.symbol || alertState.symbol === where.symbol)
          .filter((alertState) => !where.status || alertState.status === where.status)
          .sort((left, right) => right.lastSentAt.getTime() - left.lastSentAt.getTime())
          .slice(0, take)
    },
    paperSignalEvaluation: {
      findMany: async () => state.paperEvaluations,
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.paperEvaluations.find((evaluation) => evaluation.id === where.id) ?? null,
      count: async () => state.paperEvaluations.length,
      groupBy: async ({ by }: { by: string[] }) => {
        if (by.includes("assetId") && by.includes("evaluationStatus")) {
          return state.paperEvaluations.map((evaluation) => ({
            assetId: evaluation.assetId,
            evaluationStatus: evaluation.evaluationStatus,
            _count: { _all: 1 }
          }));
        }

        if (by.includes("skipReason")) {
          return Object.entries(
            state.paperEvaluations
              .filter((evaluation) => evaluation.evaluationStatus === PaperEvaluationStatus.SKIPPED)
              .reduce<Record<string, number>>((groups, evaluation) => {
                const key = evaluation.skipReason ?? "Unspecified";
                groups[key] = (groups[key] ?? 0) + 1;
                return groups;
              }, {})
          ).map(([skipReason, count]) => ({
            skipReason,
            _count: { _all: count }
          }));
        }

        return [];
      }
    },
    botRun: {
      findFirst: async () => null
    },
    marketRegimeSnapshot: {
      findFirst: async () => state.marketRegimeSnapshots[0] ?? null,
      findMany: async ({ take }: { take: number }) => state.marketRegimeSnapshots.slice(0, take)
    }
  };
}

function createMarketRegimeSnapshot() {
  const report = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    equityRegime: "UNKNOWN",
    cryptoRegime: "RISK_ON",
    overallRegime: "NEUTRAL",
    riskMode: "NORMAL",
    confidence: 70,
    benchmarkSummaries: [],
    summary: "Crypto RISK_ON, Equity UNKNOWN.",
    riskNote: "Market Regime als Kontext nutzen.",
    recommendations: ["Regime als Kontext nutzen."]
  };

  return {
    id: "market-regime-1",
    generatedAt: new Date(report.generatedAt),
    equityRegime: report.equityRegime,
    cryptoRegime: report.cryptoRegime,
    overallRegime: report.overallRegime,
    riskMode: report.riskMode,
    confidence: report.confidence,
    summary: report.summary,
    riskNote: report.riskNote,
    reportJson: report,
    createdAt: new Date(report.generatedAt)
  };
}

function createAsset() {
  return {
    id: "asset-1",
    symbol: "BTCUSDT",
    name: "Bitcoin / Tether",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "BTC",
    quoteCurrency: "USDT",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createWatchlistItem(overrides: Partial<ReturnType<typeof createBaseWatchlistItem>> = {}) {
  return {
    ...createBaseWatchlistItem(),
    ...overrides
  };
}

function createBaseWatchlistItem() {
  return {
    id: "watchlist-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    priority: WatchlistPriority.MEDIUM,
    notes: null as string | null,
    alertEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createSignal() {
  return {
    id: "signal-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    timeframe: "1d",
    signalType: SignalType.TREND_ALERT,
    status: SignalStatus.WATCH,
    direction: SignalDirection.BULLISH,
    score: 72,
    riskLevel: RiskLevel.MEDIUM,
    riskScore: 30,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    output: {
      id: "output-1",
      signalId: "signal-1",
      shortConclusion: "Constructive setup",
      counterArgument: "Invalidation below support",
      nextTrigger: "Breakout confirmation",
      telegramText: "BTCUSDT watch",
      dashboardJson: {},
      technicalJson: {},
      intelligenceJson: {},
      marketConfirmationJson: {},
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    }
  };
}

function createAlertState(overrides: Partial<ReturnType<typeof createBaseAlertState>> = {}) {
  return {
    ...createBaseAlertState(),
    ...overrides
  };
}

function createPaperEvaluation(overrides: Partial<ReturnType<typeof createBasePaperEvaluation>> = {}) {
  return {
    ...createBasePaperEvaluation(),
    ...overrides
  };
}

function createBasePaperEvaluation() {
  return {
    id: "paper-evaluation-1",
    signalId: "signal-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    direction: SignalDirection.BULLISH,
    status: SignalStatus.WATCH,
    signalType: SignalType.TREND_ALERT,
    score: 72,
    riskLevel: RiskLevel.MEDIUM,
    entryPrice: { toString: () => "100" },
    invalidationPrice: { toString: () => "98" },
    targetPrice: { toString: () => "104" },
    evaluationKind: PaperEvaluationKind.DIRECTIONAL_BULLISH,
    expectedMoveDirection: PaperExpectedMoveDirection.UP,
    evaluationStatus: PaperEvaluationStatus.EVALUATED,
    skipReason: null,
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    evaluatedAt: new Date("2026-01-02T00:00:00.000Z"),
    priceAfter1h: { toString: () => "100.5" },
    priceAfter4h: { toString: () => "101" },
    priceAfter1d: { toString: () => "101.2" },
    priceAfter3d: null,
    returnAfter1h: 0.5,
    returnAfter4h: 1,
    returnAfter1d: 1.2,
    returnAfter3d: null,
    maxFavorableMove: 2,
    maxAdverseMove: 0.5,
    outcome: PaperEvaluationOutcome.POSITIVE,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createBaseAlertState() {
  return {
    id: "alert-state-1",
    symbol: "BTCUSDT",
    assetId: "asset-1",
    timeframe: "1h",
    signalType: SignalType.TREND_ALERT,
    status: SignalStatus.WATCH,
    direction: SignalDirection.BULLISH,
    lastSignalId: "signal-1",
    lastAlertId: "alert-1",
    lastScore: 72,
    lastRiskLevel: RiskLevel.MEDIUM,
    lastAlignment: "MIXED",
    lastAlignmentScore: 60,
    lastSentAt: new Date("2026-01-01T00:00:00.000Z"),
    sendCount: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
