import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";
import type { FinnhubMarketDataAdapter } from "@signalpilot/market-data";

import { fetchEquityCandles } from "../src/jobs/fetchEquityCandles.js";

const mockCandle = {
  symbol: "AAPL",
  timeframe: "1h" as const,
  openTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
  closeTime: new Date(Date.now() - 60 * 60 * 1000),
  open: "180.5",
  high: "181.0",
  low: "179.8",
  close: "180.9",
  volume: "1000000",
  source: "FINNHUB" as const
};

function makeMockDatabase(assets: { id: string; symbol: string; assetType: string }[] = []) {
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
  const botLogs: Array<{ data: { message: string } }> = [];

  const db = {
    botRun: {
      create: async (operation: { data: { status?: BotRunStatus } }) => ({
        id: "botrun-equity-1",
        ...operation.data
      }),
      update: async (operation: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
        botRunUpdates.push(operation);
        return { id: "botrun-equity-1", ...operation.data };
      }
    },
    botLog: {
      create: async (operation: { data: { message: string } }) => {
        botLogs.push(operation);
      }
    },
    asset: {
      findMany: async () => assets
    },
    candle: {
      findFirst: async () => null,
      findMany: async () => [],
      upsert: async () => {}
    },
    candleDataQuality: {
      upsert: async () => ({})
    }
  };

  return { db, botRunUpdates, botLogs };
}

function makeMockAdapter(
  result:
    | { kind: "ok"; candles: typeof mockCandle[] }
    | { kind: "no_data" }
    | { kind: "rate_limit" }
    | { kind: "invalid_api_key"; statusCode: number }
    | { kind: "entitlement"; statusCode: number }
    | { kind: "unsupported_symbol"; statusCode: number }
    | { kind: "temporary_error"; statusCode: number | null }
    | { kind: "permanent_error"; statusCode: number } = {
    kind: "ok",
    candles: [mockCandle]
  }
): FinnhubMarketDataAdapter {
  return {
    fetchStockCandles: async () => result,
    assertApiKey: () => {}
  } as unknown as FinnhubMarketDataAdapter;
}

describe("fetchEquityCandles", () => {
  const originalKey = process.env.FINNHUB_API_KEY;
  const originalDelay = process.env.MARKET_DATA_REQUEST_DELAY_MS;
  const originalRetryAttempts = process.env.PROVIDER_RETRY_MAX_ATTEMPTS;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.FINNHUB_API_KEY;
    } else {
      process.env.FINNHUB_API_KEY = originalKey;
    }

    if (originalDelay === undefined) {
      delete process.env.MARKET_DATA_REQUEST_DELAY_MS;
    } else {
      process.env.MARKET_DATA_REQUEST_DELAY_MS = originalDelay;
    }
    if (originalRetryAttempts === undefined) {
      delete process.env.PROVIDER_RETRY_MAX_ATTEMPTS;
    } else {
      process.env.PROVIDER_RETRY_MAX_ATTEMPTS = originalRetryAttempts;
    }
  });

  it("returns FAILED cleanly when FINNHUB_API_KEY is missing", async () => {
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    delete process.env.FINNHUB_API_KEY;

    const { db, botRunUpdates, botLogs } = makeMockDatabase();
    const summary = await fetchEquityCandles(db as never);

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.assetCount, 0);
    assert.ok(botLogs.some((log) => log.data.message.includes("FINNHUB_API_KEY")));
    assert.equal(botRunUpdates.length, 0);
  });

  it("returns a summary with savedCandleCount when assets are fetched successfully", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";

    const assets = [
      { id: "asset-1", symbol: "AAPL", assetType: "STOCK" },
      { id: "asset-2", symbol: "SPY", assetType: "ETF" }
    ];
    const { db, botRunUpdates } = makeMockDatabase(assets);
    const adapter = makeMockAdapter({ kind: "ok", candles: [mockCandle] });

    const summary = await fetchEquityCandles(db as never, adapter);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.assetCount, 2);
    assert.equal(summary.timeframeCount, 2);
    assert.equal(summary.savedCandleCount, 4);
    assert.equal(summary.noDataCount, 0);
    assert.equal(summary.errorCount, 0);
    assert.equal(summary.rateLimitCount, 0);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.SUCCESS);
  });

  it("counts no_data results without failing the job", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: "STOCK" }];
    const { db } = makeMockDatabase(assets);
    const adapter = makeMockAdapter({ kind: "no_data" });

    const summary = await fetchEquityCandles(db as never, adapter);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.noDataCount, 2);
    assert.equal(summary.savedCandleCount, 0);
  });

  it("marks FAILED and counts rate limit hits", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: "STOCK" }];
    const { db } = makeMockDatabase(assets);
    const adapter = makeMockAdapter({ kind: "rate_limit" });

    const summary = await fetchEquityCandles(db as never, adapter);

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.rateLimitCount, 2);
  });

  it("marks FAILED and counts forbidden hits for HTTP 403", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: "STOCK" }];
    const { db, botLogs } = makeMockDatabase(assets);
    const adapter = makeMockAdapter({ kind: "entitlement", statusCode: 403 });

    const summary = await fetchEquityCandles(db as never, adapter);

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.forbiddenCount, 2);
    assert.equal(summary.errorCount, 0);
    assert.ok(botLogs.some((log) => log.data.message.includes("provider failure")));
  });

  it("writes summary fields to the final BotRun metadata", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: "STOCK" }];
    const { db, botRunUpdates } = makeMockDatabase(assets);
    const adapter = makeMockAdapter({ kind: "ok", candles: [mockCandle] });

    await fetchEquityCandles(db as never, adapter);

    const lastUpdate = botRunUpdates.at(-1);
    const meta = lastUpdate?.data.metadataJson as Record<string, unknown>;
    assert.ok("savedCandleCount" in meta);
    assert.ok("noDataCount" in meta);
    assert.ok("errorCount" in meta);
    assert.ok("rateLimitCount" in meta);
    assert.ok("assetCount" in meta);
  });
});
