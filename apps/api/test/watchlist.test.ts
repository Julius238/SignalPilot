import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify from "fastify";
import {
  AssetType,
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
      dashboardOrigin: "http://localhost:3000",
      liveTradingEnabled: false,
      paperTradingOnly: true
    });
    assert.equal(JSON.stringify(body).includes("secret"), false);
    assert.equal("N8N_WEBHOOK_SIGNAL_URL" in body, false);

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
      count: async () => 0
    },
    candle: {
      groupBy: async () => [],
      findMany: async () => []
    },
    alert: {
      count: async () => 0
    },
    botRun: {
      findFirst: async () => null
    }
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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
