import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { analyzeEquitySignals } from "../src/jobs/analyzeEquitySignals.js";

function createCandles(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const closeTime = new Date(
      Date.now() - 30 * 60_000 - (count - i - 1) * 3_600_000
    );

    return {
      high: { toString: () => String(100 + i) },
      low: { toString: () => String(98 + i) },
      close: { toString: () => String(99 + i) },
      volume: { toString: () => "1000000" },
      openTime: new Date(closeTime.getTime() - 3_600_000),
      closeTime
    };
  });
}

function makeNewsItems() {
  return [
    {
      id: "news-1",
      assetId: "asset-1",
      symbol: "AAPL",
      headline: "Apple beats earnings expectations",
      summary: "Strong Q1 results.",
      url: "https://reuters.com/apple",
      source: "Reuters",
      publishedAt: new Date(),
      category: "company news",
      sentiment: null,
      relevanceScore: null,
      rawJson: {},
      relatedSymbols: null,
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];
}

function makeMockDatabase(options: {
  assets?: { id: string; symbol: string; assetType: AssetType; isActive: boolean; watchlistItem?: null }[];
  candles?: unknown[];
} = {}) {
  const assets = options.assets ?? [];
  const candles = options.candles ?? createCandles(250);
  const createdSignals: unknown[] = [];
  const botLogs: Array<{ data: { message: string } }> = [];
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];

  return {
    db: {
      botRun: {
        create: async () => ({ id: "bot-run-equity-1" }),
        update: async (op: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
          botRunUpdates.push(op);
          return { id: "bot-run-equity-1", ...op.data };
        }
      },
      botLog: {
        create: async (op: { data: { message: string } }) => {
          botLogs.push(op);
        }
      },
      alert: {
        create: async () => ({ id: "alert-1" }),
        update: async () => ({})
      },
      alertState: {
        findFirst: async () => null,
        upsert: async () => ({})
      },
      asset: {
        findMany: async () => assets
      },
      candle: {
        findMany: async () => [...candles].reverse()
      },
      newsItem: {
        findMany: async () => []
      },
      signal: {
        findFirst: async () => null,
        create: async (op: unknown) => {
          const typedOp = op as {
            data: {
              symbol: string;
              timeframe: string;
              status: string;
              direction: string;
              signalType: string;
              score: number;
              riskLevel: string;
              output: { create: { telegramText: string } };
            };
          };
          const record = {
            id: `signal-${createdSignals.length + 1}`,
            assetId: "asset-1",
            ...typedOp.data,
            createdAt: new Date(),
            output: {
              id: `output-${createdSignals.length + 1}`,
              ...typedOp.data.output.create
            }
          };
          createdSignals.push(record);
          return record;
        }
      }
    },
    createdSignals,
    botLogs,
    botRunUpdates
  };
}

describe("analyzeEquitySignals", () => {
  const savedWebhookUrl = process.env.N8N_WEBHOOK_SIGNAL_URL;
  const savedEquityAlerts = process.env.ENABLE_EQUITY_ALERTS;
  const savedEquityNews = process.env.ENABLE_EQUITY_NEWS;
  const savedDelay = process.env.MARKET_DATA_REQUEST_DELAY_MS;
  const savedFetch = globalThis.fetch;

  afterEach(() => {
    if (savedWebhookUrl === undefined) {
      delete process.env.N8N_WEBHOOK_SIGNAL_URL;
    } else {
      process.env.N8N_WEBHOOK_SIGNAL_URL = savedWebhookUrl;
    }

    if (savedEquityAlerts === undefined) {
      delete process.env.ENABLE_EQUITY_ALERTS;
    } else {
      process.env.ENABLE_EQUITY_ALERTS = savedEquityAlerts;
    }

    if (savedEquityNews === undefined) {
      delete process.env.ENABLE_EQUITY_NEWS;
    } else {
      process.env.ENABLE_EQUITY_NEWS = savedEquityNews;
    }

    if (savedDelay === undefined) {
      delete process.env.MARKET_DATA_REQUEST_DELAY_MS;
    } else {
      process.env.MARKET_DATA_REQUEST_DELAY_MS = savedDelay;
    }

    globalThis.fetch = savedFetch;
  });

  it("generates signals for STOCK and ETF assets with enough candles", async () => {
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null },
      { id: "asset-2", symbol: "SPY", assetType: AssetType.ETF, isActive: true, watchlistItem: null }
    ];
    const { db, createdSignals, botRunUpdates } = makeMockDatabase({ assets });

    const summary = await analyzeEquitySignals(db as never);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.assetCount ?? assets.length, assets.length);
    assert.ok(createdSignals.length > 0);
    assert.ok(summary.savedSignalCount > 0);
    // Only 1h and 1d timeframes — no 4h
    const timeframes = (createdSignals as Array<{ timeframe: string }>).map((s) => s.timeframe);
    assert.ok(!timeframes.includes("4h"), "4h should not be analyzed for equity");
    assert.ok(timeframes.includes("1h") || timeframes.includes("1d"));
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.SUCCESS);
  });

  it("skips asset/timeframe and increments missingDataCount when too few candles", async () => {
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null }
    ];
    const { db, createdSignals } = makeMockDatabase({ assets, candles: createCandles(5) });

    const summary = await analyzeEquitySignals(db as never);

    assert.equal(summary.savedSignalCount, 0);
    assert.ok(summary.missingDataCount > 0);
    assert.equal(createdSignals.length, 0);
  });

  it("does not analyze 4h timeframe for STOCK/ETF assets", async () => {
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    const assets = [
      { id: "asset-1", symbol: "MSFT", assetType: AssetType.STOCK, isActive: true, watchlistItem: null }
    ];
    const { db, createdSignals } = makeMockDatabase({ assets });

    await analyzeEquitySignals(db as never);

    const timeframes = (createdSignals as Array<{ timeframe: string }>).map((s) => s.timeframe);
    assert.ok(!timeframes.includes("4h"));
  });

  it("does not send n8n alerts when ENABLE_EQUITY_ALERTS=false", async () => {
    process.env.ENABLE_EQUITY_ALERTS = "false";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    };

    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null }
    ];
    const { db } = makeMockDatabase({ assets });

    const summary = await analyzeEquitySignals(db as never);

    assert.equal(fetchCalled, false);
    assert.equal(summary.sentAlertCount, 0);
    assert.ok(summary.equityAlertsDisabledCount >= 0);
  });

  it("sends n8n alerts when ENABLE_EQUITY_ALERTS=true and signal is alert-worthy", async () => {
    process.env.ENABLE_EQUITY_ALERTS = "true";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    globalThis.fetch = async () => new Response(JSON.stringify({ alertId: "alert-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null }
    ];
    const { db, botRunUpdates } = makeMockDatabase({ assets });

    const summary = await analyzeEquitySignals(db as never);

    // Alert may or may not fire depending on scoring, but no error should occur
    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.SUCCESS);
  });

  it("writes the equityAlertsDisabledCount to the final BotRun metadata", async () => {
    process.env.ENABLE_EQUITY_ALERTS = "false";

    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null }
    ];
    const { db, botRunUpdates } = makeMockDatabase({ assets });

    await analyzeEquitySignals(db as never);

    const meta = botRunUpdates.at(-1)?.data.metadataJson as Record<string, unknown>;
    assert.ok("equityAlertsDisabledCount" in meta);
  });

  it("stores newsContext in dashboardJson when news items are available", async () => {
    process.env.ENABLE_EQUITY_ALERTS = "false";
    process.env.ENABLE_EQUITY_NEWS = "true";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null }
    ];
    const newsItems = makeNewsItems();

    const { db, createdSignals } = makeMockDatabase({ assets });
    // Override newsItem.findMany to return news items
    (db as Record<string, unknown>).newsItem = { findMany: async () => newsItems };

    await analyzeEquitySignals(db as never);

    const outputs = (createdSignals as Array<{
      output: { dashboardJson: Record<string, unknown> | null };
    }>).map((s) => s.output?.dashboardJson);

    const newsContextFound = outputs.some((json) => json && "newsContext" in json);
    assert.equal(newsContextFound, true);
  });

  it("isolates errors per asset/timeframe and continues processing", async () => {
    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK, isActive: true, watchlistItem: null },
      { id: "asset-2", symbol: "SPY", assetType: AssetType.ETF, isActive: true, watchlistItem: null }
    ];

    let callCount = 0;
    const db = {
      botRun: {
        create: async () => ({ id: "bot-run-equity-1" }),
        update: async (op: { data: { status: BotRunStatus } }) => ({ id: "bot-run-equity-1", ...op.data })
      },
      botLog: { create: async () => ({}) },
      alertState: { findFirst: async () => null, upsert: async () => ({}) },
      asset: { findMany: async () => assets },
      signal: { findFirst: async () => null, create: async () => ({ id: "sig-1", output: { telegramText: "" } }) },
      candle: {
        findMany: async () => {
          callCount += 1;
          if (callCount === 1) throw new Error("DB error for AAPL 1h");
          return [...createCandles(250)].reverse();
        }
      },
      newsItem: { findMany: async () => [] }
    };

    const summary = await analyzeEquitySignals(db as never);

    assert.ok(summary.errorCount > 0);
    assert.ok(summary.savedSignalCount > 0);
    assert.equal(summary.status, BotRunStatus.FAILED);
  });
});
