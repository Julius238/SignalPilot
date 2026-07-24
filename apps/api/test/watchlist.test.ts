import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify from "fastify";
import {
  AssetType,
  BacktestOutcome,
  BacktestOutcomeStatus,
  BacktestRunStatus,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  PaperExpectedMoveDirection,
  Prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType,
  StrategyComparisonStatus,
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
  const originalApiAuthEnabled = process.env.API_AUTH_ENABLED;
  const originalDevLoginEnabled = process.env.DEV_LOGIN_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;
  const originalVercelEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    restoreEnv("ALERT_MODE", originalAlertMode);
    restoreEnv("DASHBOARD_ORIGIN", originalDashboardOrigin);
    restoreEnv("ENABLE_LIVE_TRADING", originalEnableLiveTrading);
    restoreEnv("N8N_WEBHOOK_SIGNAL_URL", originalWebhookUrl);
    restoreEnv("API_AUTH_ENABLED", originalApiAuthEnabled);
    restoreEnv("DEV_LOGIN_ENABLED", originalDevLoginEnabled);
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("APP_ENV", originalAppEnv);
    restoreEnv("VERCEL_ENV", originalVercelEnv);
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
    process.env.API_AUTH_ENABLED = "true";
    process.env.DEV_LOGIN_ENABLED = "true";
    process.env.NODE_ENV = "development";
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;

    const server = await createServer();
    const response = await server.inject("/config/public");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      alertMode: "HIGH_PRIORITY_ONLY",
      alertCooldownMinutes: 240,
      alertScoreImprovementThreshold: 8,
      dashboardOrigin: "http://localhost:3000",
      authEnabled: false,
      devLoginEnabled: false,
      environment: "development",
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

  it("returns a signal rule application for a signal", async () => {
    const { server } = await createServerWithState();

    const response = await server.inject("/signals/signal-1/rule-application");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.signalId, "signal-1");
    assert.equal(body.symbol, "BTCUSDT");
    assert.equal(body.originalScore, 72);
    assert.equal(body.adjustedScore, 67);
    assert.equal(body.adjustments[0].category, "MARKET_REGIME");
    assert.equal(body.warnings[0], "Signal läuft gegen das Marktumfeld.");

    await server.close();
  });

  it("returns rule applications and summary metrics", async () => {
    const { server } = await createServerWithState();

    const listResponse = await server.inject("/rules/applications?category=MARKET_REGIME");
    const summaryResponse = await server.inject("/rules/summary");

    assert.equal(listResponse.statusCode, 200);
    assert.equal(summaryResponse.statusCode, 200);
    assert.equal(listResponse.json().length, 1);
    const summary = summaryResponse.json();
    assert.equal(summary.totalApplications, 1);
    assert.equal(summary.avgDelta, -5);
    assert.equal(summary.negativeAdjustmentCount, 1);
    assert.equal(summary.groupedByCategory[0].key, "MARKET_REGIME");

    await server.close();
  });

  it("returns backtest runs and summary", async () => {
    const { server } = await createServerWithState();

    const runsResponse = await server.inject("/backtests");
    const summaryResponse = await server.inject("/backtests/backtest-1/summary");

    assert.equal(runsResponse.statusCode, 200);
    assert.equal(summaryResponse.statusCode, 200);
    assert.equal(runsResponse.json()[0].id, "backtest-1");
    assert.equal(summaryResponse.json().totalSignals, 2);
    assert.equal(summaryResponse.json().winRate, 50);

    await server.close();
  });

  it("returns backtest signals", async () => {
    const { server } = await createServerWithState();

    const response = await server.inject("/backtests/backtest-1/signals?symbol=BTCUSDT");

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.length, 2);
    assert.equal(body[0].symbol, "BTCUSDT");
    assert.equal(body[0].outcomeStatus, "EVALUATED");

    await server.close();
  });

  it("returns strategy configs, comparisons and summary", async () => {
    const { server } = await createServerWithState();

    const configsResponse = await server.inject("/strategy/configs");
    const comparisonsResponse = await server.inject("/strategy/comparisons");
    const summaryResponse = await server.inject("/strategy/comparisons/comparison-1/summary");

    assert.equal(configsResponse.statusCode, 200);
    assert.equal(comparisonsResponse.statusCode, 200);
    assert.equal(summaryResponse.statusCode, 200);
    assert.equal(configsResponse.json()[0].name, "Baseline 50");
    assert.equal(comparisonsResponse.json()[0].bestStrategy, "Baseline 50");
    assert.equal(summaryResponse.json().bestWinRate, 50);

    await server.close();
  });
});

async function createServer() {
  const { server } = await createServerWithState();
  return server;
}

async function createServerWithState() {
  process.env.API_AUTH_ENABLED = "false";

  const state = {
    assets: [createAsset()],
    watchlistItems: [] as ReturnType<typeof createWatchlistItem>[],
    alertStates: [] as ReturnType<typeof createAlertState>[],
    paperEvaluations: [] as ReturnType<typeof createPaperEvaluation>[],
    marketRegimeSnapshots: [createMarketRegimeSnapshot()],
    signalRuleApplications: [createSignalRuleApplication()],
    backtestRuns: [createBacktestRun()],
    backtestSignals: createBacktestSignals(),
    strategyConfigs: [createStrategyConfig()],
    strategyComparisonRuns: [createStrategyComparisonRun()],
    strategyBacktestResults: [createStrategyBacktestResult()],
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
  signalRuleApplications: ReturnType<typeof createSignalRuleApplication>[];
  backtestRuns: ReturnType<typeof createBacktestRun>[];
  backtestSignals: ReturnType<typeof createBacktestSignals>;
  strategyConfigs: ReturnType<typeof createStrategyConfig>[];
  strategyComparisonRuns: ReturnType<typeof createStrategyComparisonRun>[];
  strategyBacktestResults: ReturnType<typeof createStrategyBacktestResult>[];
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
      findFirst: async () => null,
      findMany: async () => []
    },
    candleDataQuality: {
      findMany: async () => []
    },
    newsItem: {
      count: async () => 0,
      findFirst: async () => null
    },
    marketRegimeSnapshot: {
      findFirst: async () => state.marketRegimeSnapshots[0] ?? null,
      findMany: async ({ take }: { take: number }) => state.marketRegimeSnapshots.slice(0, take)
    },
    signalRuleApplication: {
      findUnique: async ({ where }: { where: { signalId: string } }) => {
        const application = state.signalRuleApplications.find((candidate) => candidate.signalId === where.signalId);
        return application ? withSignalSelect(application) : null;
      },
      findMany: async ({ where, take }: { where?: { adjustedStatus?: SignalStatus; signal?: { symbol: string } }; take: number }) =>
        state.signalRuleApplications
          .filter((application) => !where?.adjustedStatus || application.adjustedStatus === where.adjustedStatus)
          .filter((application) => !where?.signal?.symbol || application.signal.symbol === where.signal.symbol)
          .slice(0, take)
          .map(withSignalSelect)
    },
    backtestRun: {
      findMany: async ({ where, take }: { where?: { status?: BacktestRunStatus }; take: number }) =>
        state.backtestRuns
          .filter((run) => !where?.status || run.status === where.status)
          .slice(0, take)
          .map(withBacktestCount),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const run = state.backtestRuns.find((candidate) => candidate.id === where.id);
        return run ? withBacktestCount(run) : null;
      },
      findFirst: async () => state.backtestRuns[0] ?? null
    },
    backtestSignal: {
      findMany: async ({ where, take }: { where: { backtestRunId?: string; symbol?: string; timeframe?: string; outcome?: BacktestOutcome; status?: SignalStatus; signalType?: SignalType }; take?: number }) =>
        state.backtestSignals
          .filter((signal) => !where.backtestRunId || signal.backtestRunId === where.backtestRunId)
          .filter((signal) => !where.symbol || signal.symbol === where.symbol)
          .filter((signal) => !where.timeframe || signal.timeframe === where.timeframe)
          .filter((signal) => !where.outcome || signal.outcome === where.outcome)
          .filter((signal) => !where.status || signal.status === where.status)
          .filter((signal) => !where.signalType || signal.signalType === where.signalType)
          .slice(0, take ?? state.backtestSignals.length)
    },
    strategyConfig: {
      findMany: async () => state.strategyConfigs
    },
    strategyComparisonRun: {
      findMany: async ({ where, take }: { where?: { status?: StrategyComparisonStatus }; take: number }) =>
        state.strategyComparisonRuns
          .filter((run) => !where?.status || run.status === where.status)
          .slice(0, take)
          .map((run) => ({ ...run, results: state.strategyBacktestResults.map(withStrategyIncludes) })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const run = state.strategyComparisonRuns.find((candidate) => candidate.id === where.id);
        return run ? { ...run, results: state.strategyBacktestResults.map(withStrategyIncludes) } : null;
      }
    },
    strategyBacktestResult: {
      findMany: async ({ where }: { where: { comparisonRunId: string } }) =>
        state.strategyBacktestResults
          .filter((result) => result.comparisonRunId === where.comparisonRunId)
          .map(withStrategyAndBacktestIncludes)
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

function createSignalRuleApplication() {
  const adjustments = [
    {
      id: "market-regime-risk-off",
      reason: "Bullish Signal im RISK_OFF Umfeld",
      category: "MARKET_REGIME",
      scoreDelta: -5,
      confidence: "HIGH",
      explanation: "Das Marktumfeld ist gegenläufig, daher wird das Signal niedriger priorisiert."
    }
  ];

  return {
    id: "rule-application-1",
    signalId: "signal-1",
    originalScore: 72,
    adjustedScore: 67,
    originalStatus: SignalStatus.WATCH,
    adjustedStatus: SignalStatus.WATCH,
    finalRiskLevel: RiskLevel.MEDIUM,
    adjustmentsJson: adjustments,
    warningsJson: ["Signal läuft gegen das Marktumfeld."],
    summary: "1 regelbasierte Anpassung, Gesamtdelta -5.",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    signal: {
      symbol: "BTCUSDT",
      timeframe: "1d"
    }
  };
}

function withSignalSelect(application: ReturnType<typeof createSignalRuleApplication>) {
  return application;
}

function createBacktestRun() {
  const summary = {
    totalSignals: 2,
    evaluatedCount: 2,
    positiveCount: 1,
    negativeCount: 1,
    neutralCount: 0,
    targetReachedCount: 0,
    invalidatedCount: 0,
    winRate: 50,
    avgReturnAfter1h: 0.2,
    avgReturnAfter4h: 0.5,
    avgReturnAfter1d: 0.4,
    avgReturnAfter3d: 0,
    groupedBySymbol: [{ key: "BTCUSDT", totalSignals: 2, evaluatedCount: 2, winRate: 50, avgReturnAfter1d: 0.4 }],
    groupedByTimeframe: [{ key: "1h", totalSignals: 2, evaluatedCount: 2, winRate: 50, avgReturnAfter1d: 0.4 }],
    groupedBySignalType: [{ key: "TREND_ALERT", totalSignals: 2, evaluatedCount: 2, winRate: 50, avgReturnAfter1d: 0.4 }],
    groupedByStatus: [{ key: "WATCH", totalSignals: 2, evaluatedCount: 2, winRate: 50, avgReturnAfter1d: 0.4 }],
    groupedByScoreBucket: [{ key: "65-79", totalSignals: 2, evaluatedCount: 2, winRate: 50, avgReturnAfter1d: 0.4 }],
    warnings: []
  };

  return {
    id: "backtest-1",
    name: "Crypto Backtest",
    assetType: AssetType.CRYPTO,
    symbols: ["BTCUSDT"],
    timeframes: ["1h"],
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-03T00:00:00.000Z"),
    status: BacktestRunStatus.SUCCESS,
    configJson: {},
    summaryJson: summary,
    startedAt: new Date("2026-01-03T00:00:00.000Z"),
    finishedAt: new Date("2026-01-03T00:01:00.000Z"),
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:01:00.000Z")
  };
}

function withBacktestCount(run: ReturnType<typeof createBacktestRun>) {
  return {
    ...run,
    _count: { signals: 2 }
  };
}

function createBacktestSignals() {
  return [
    createBacktestSignal({ outcome: BacktestOutcome.POSITIVE, returnAfter1d: 1.2 }),
    createBacktestSignal({ id: "backtest-signal-2", outcome: BacktestOutcome.NEGATIVE, returnAfter1d: -0.4 })
  ];
}

function createBacktestSignal(overrides: Partial<ReturnType<typeof createBaseBacktestSignal>> = {}) {
  return {
    ...createBaseBacktestSignal(),
    ...overrides
  };
}

function createBaseBacktestSignal() {
  return {
    id: "backtest-signal-1",
    backtestRunId: "backtest-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    assetType: AssetType.CRYPTO,
    timeframe: "1h",
    signalTime: new Date("2026-01-01T01:00:00.000Z"),
    signalType: SignalType.TREND_ALERT,
    status: SignalStatus.WATCH,
    direction: SignalDirection.BULLISH,
    riskLevel: RiskLevel.MEDIUM,
    score: 72,
    originalScore: 70,
    adjustedScore: 72,
    entryPrice: { toString: () => "100" },
    targetPrice: { toString: () => "104" },
    invalidationPrice: { toString: () => "98" },
    outcome: BacktestOutcome.POSITIVE,
    outcomeStatus: BacktestOutcomeStatus.EVALUATED,
    evaluatedAt: new Date("2026-01-02T01:00:00.000Z"),
    returnAfter1h: 0.2,
    returnAfter4h: 0.5,
    returnAfter1d: 1.2,
    returnAfter3d: null,
    maxFavorableMove: 2,
    maxAdverseMove: 0.5,
    contextJson: {},
    createdAt: new Date("2026-01-03T00:00:00.000Z")
  };
}

function createStrategyConfig() {
  return {
    id: "strategy-1",
    name: "Baseline 50",
    description: "Base scoring threshold 50",
    isDefault: true,
    configJson: { useSignalRules: false, minScoreToRecord: 50 },
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z")
  };
}

function createStrategyComparisonRun() {
  return {
    id: "comparison-1",
    name: "Strategy Comparison",
    status: StrategyComparisonStatus.SUCCESS,
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-03T00:00:00.000Z"),
    symbols: ["BTCUSDT"],
    assetType: AssetType.CRYPTO,
    timeframes: ["1h"],
    configJson: {},
    summaryJson: {
      totalStrategies: 1,
      bestStrategy: "Baseline 50",
      bestStrategyId: "strategy-1",
      bestWinRate: 50,
      highestAvgReturnStrategy: "Baseline 50",
      highestAvgReturnAfter1d: 0.4,
      warnings: [],
      rankedResults: []
    },
    startedAt: new Date("2026-01-03T00:00:00.000Z"),
    finishedAt: new Date("2026-01-03T00:01:00.000Z"),
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:01:00.000Z")
  };
}

function createStrategyBacktestResult() {
  return {
    id: "strategy-result-1",
    comparisonRunId: "comparison-1",
    strategyConfigId: "strategy-1",
    backtestRunId: "backtest-1",
    totalSignals: 2,
    evaluatedCount: 2,
    winRate: 50,
    avgReturnAfter1d: 0.4,
    targetReachedCount: 0,
    invalidatedCount: 0,
    positiveCount: 1,
    negativeCount: 1,
    neutralCount: 0,
    summaryJson: createBacktestRun().summaryJson,
    rank: 1,
    createdAt: new Date("2026-01-03T00:01:00.000Z")
  };
}

function withStrategyIncludes(result: ReturnType<typeof createStrategyBacktestResult>) {
  return {
    ...result,
    strategyConfig: createStrategyConfig()
  };
}

function withStrategyAndBacktestIncludes(result: ReturnType<typeof createStrategyBacktestResult>) {
  return {
    ...withStrategyIncludes(result),
    backtestRun: createBacktestRun()
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
