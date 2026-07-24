import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { fetchEquityNews } from "../src/jobs/fetchEquityNews.js";

const mockNewsPayload = [
  {
    category: "company news",
    datetime: 1710000000,
    headline: "Apple beats earnings expectations",
    id: 1,
    image: "https://example.com/img.jpg",
    related: "AAPL",
    source: "Reuters",
    summary: "Apple Inc. reported strong Q1 results.",
    url: "https://reuters.com/apple-earnings"
  }
];

function makeMockDatabase(options: {
  assets?: { id: string; symbol: string; assetType: string }[];
  newsItemFindUnique?: () => Promise<null | { id: string }>;
  newsItemFindFirst?: () => Promise<null | { id: string; category: string | null }>;
} = {}) {
  const assets = options.assets ?? [];
  const newsItemFindUnique = options.newsItemFindUnique ?? (async () => null);
  const newsItemFindFirst = options.newsItemFindFirst ?? (async () => null);
  const createdNewsItems: unknown[] = [];
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];

  const db = {
    botRun: {
      create: async (op: { data: { status?: BotRunStatus } }) => ({
        id: "botrun-news-1",
        ...op.data
      }),
      update: async (op: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
        botRunUpdates.push(op);
        return { id: "botrun-news-1", ...op.data };
      }
    },
    botLog: { create: async () => ({}) },
    asset: { findMany: async () => assets },
    newsItem: {
      findUnique: newsItemFindUnique,
      findFirst: newsItemFindFirst,
      update: async () => ({ id: "news-existing" }),
      create: async (op: unknown) => {
        createdNewsItems.push(op);
        return { id: "news-1" };
      }
    }
  };

  return { db, createdNewsItems, botRunUpdates };
}

describe("fetchEquityNews", () => {
  const savedKey = process.env.FINNHUB_API_KEY;
  const savedDelay = process.env.MARKET_DATA_REQUEST_DELAY_MS;
  const savedFetch = globalThis.fetch;
  const savedRetryAttempts = process.env.PROVIDER_RETRY_MAX_ATTEMPTS;

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.FINNHUB_API_KEY;
    } else {
      process.env.FINNHUB_API_KEY = savedKey;
    }

    if (savedDelay === undefined) {
      delete process.env.MARKET_DATA_REQUEST_DELAY_MS;
    } else {
      process.env.MARKET_DATA_REQUEST_DELAY_MS = savedDelay;
    }

    globalThis.fetch = savedFetch;
    if (savedRetryAttempts === undefined) {
      delete process.env.PROVIDER_RETRY_MAX_ATTEMPTS;
    } else {
      process.env.PROVIDER_RETRY_MAX_ATTEMPTS = savedRetryAttempts;
    }
  });

  it("returns FAILED cleanly when FINNHUB_API_KEY is missing", async () => {
    delete process.env.FINNHUB_API_KEY;
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";

    const { db } = makeMockDatabase();
    const summary = await fetchEquityNews(db as never);

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.assetCount, 0);
  });

  it("saves news items and counts correctly", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";
    globalThis.fetch = async () =>
      ({ ok: true, status: 200, json: async () => mockNewsPayload }) as Response;

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }];
    const { db, createdNewsItems, botRunUpdates } = makeMockDatabase({ assets });

    const summary = await fetchEquityNews(db as never);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.fetchedNewsCount, 1);
    assert.equal(summary.savedNewsCount, 1);
    assert.equal(summary.duplicateCount, 0);
    assert.equal(createdNewsItems.length, 1);
    assert.ok((botRunUpdates.at(-1)?.data.metadataJson as Record<string, unknown>)?.savedNewsCount === 1);
  });

  it("counts duplicates when url already exists", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    globalThis.fetch = async () =>
      ({ ok: true, status: 200, json: async () => mockNewsPayload }) as Response;

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }];
    const { db } = makeMockDatabase({
      assets,
      newsItemFindFirst: async () => ({ id: "existing-news-1", category: "company news" })
    });

    const summary = await fetchEquityNews(db as never);

    assert.equal(summary.savedNewsCount, 0);
    assert.equal(summary.duplicateCount, 1);
  });

  it("counts noNewsCount when Finnhub returns empty array", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";
    globalThis.fetch = async () =>
      ({ ok: true, status: 200, json: async () => [] }) as Response;

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }];
    const { db } = makeMockDatabase({ assets });

    const summary = await fetchEquityNews(db as never);

    assert.equal(summary.noNewsCount, 1);
    assert.equal(summary.savedNewsCount, 0);
  });

  it("counts rateLimitCount and marks FAILED on HTTP 429", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";
    globalThis.fetch = async () =>
      ({ ok: false, status: 429, json: async () => ({}) }) as Response;

    const assets = [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }];
    const { db } = makeMockDatabase({ assets });

    const summary = await fetchEquityNews(db as never);

    assert.equal(summary.rateLimitCount, 1);
    assert.equal(summary.status, BotRunStatus.FAILED);
  });

  it("creates asset-scoped links for every normalized related symbol", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    process.env.PROVIDER_RETRY_MAX_ATTEMPTS = "1";
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => [{ ...mockNewsPayload[0], related: "AAPL, MSFT" }]
      }) as Response;

    const assets = [
      { id: "asset-aapl", symbol: "AAPL", assetType: AssetType.STOCK },
      { id: "asset-msft", symbol: "MSFT", assetType: AssetType.STOCK }
    ];
    const { db, createdNewsItems } = makeMockDatabase({ assets });

    await fetchEquityNews(db as never);

    const created = createdNewsItems.map(
      (operation) => (operation as { data: Record<string, unknown> }).data
    );
    assert.deepEqual(
      [...new Set(created.map((item) => item.symbol))].sort(),
      ["AAPL", "MSFT"]
    );
    assert.ok(created.every((item) => item.transportProvider === "FINNHUB"));
    assert.ok(created.every((item) => (item.relevanceScore as number) >= 0 && (item.relevanceScore as number) <= 100));
  });
});
