import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { fetchEquityEvents } from "../src/jobs/fetchEquityEvents.js";

const mockEarningsPayload = {
  earningsCalendar: [
    {
      date: "2026-06-15",
      epsActual: null,
      epsEstimate: 1.42,
      hour: "amc",
      quarter: 2,
      revenueActual: null,
      revenueEstimate: 95000000000,
      symbol: "AAPL",
      year: 2026
    }
  ]
};

function makeMockDatabase(options: {
  assets?: { id: string; symbol: string; assetType: string }[];
  eventFindFirst?: () => Promise<null | { id: string }>;
} = {}) {
  const assets = options.assets ?? [];
  const eventFindFirst = options.eventFindFirst ?? (async () => null);
  const createdEvents: unknown[] = [];
  const updatedEvents: unknown[] = [];
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];

  const db = {
    botRun: {
      create: async (op: { data: { status?: BotRunStatus } }) => ({
        id: "botrun-events-1",
        ...op.data
      }),
      update: async (op: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
        botRunUpdates.push(op);
        return { id: "botrun-events-1", ...op.data };
      }
    },
    botLog: { create: async () => ({}) },
    asset: { findMany: async () => assets },
    event: {
      findFirst: eventFindFirst,
      create: async (op: unknown) => {
        createdEvents.push(op);
        return { id: "event-1" };
      },
      update: async (op: unknown) => {
        updatedEvents.push(op);
        return { id: "event-1" };
      }
    }
  };

  return { db, createdEvents, updatedEvents, botRunUpdates };
}

describe("fetchEquityEvents", () => {
  const savedKey = process.env.FINNHUB_API_KEY;
  const savedDelay = process.env.MARKET_DATA_REQUEST_DELAY_MS;
  const savedFetch = globalThis.fetch;

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
  });

  it("returns FAILED when FINNHUB_API_KEY is missing", async () => {
    delete process.env.FINNHUB_API_KEY;

    const { db } = makeMockDatabase();
    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.assetCount, 0);
  });

  it("counts noEventCount for empty earningsCalendar", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ earningsCalendar: [] })
      }) as Response;

    const { db, botRunUpdates } = makeMockDatabase({
      assets: [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }]
    });

    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.noEventCount, 1);
    assert.equal(summary.savedEventCount, 0);
    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.ok(botRunUpdates.length > 0);
  });

  it("counts rateLimitCount for HTTP 429", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    globalThis.fetch = async () =>
      ({ ok: false, status: 429 }) as Response;

    const { db } = makeMockDatabase({
      assets: [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }]
    });

    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.rateLimitCount, 1);
    assert.equal(summary.savedEventCount, 0);
  });

  it("counts forbiddenCount for HTTP 403", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    globalThis.fetch = async () =>
      ({ ok: false, status: 403, text: async () => "Forbidden" }) as unknown as Response;

    const { db } = makeMockDatabase({
      assets: [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }]
    });

    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.forbiddenCount, 1);
    assert.equal(summary.savedEventCount, 0);
  });

  it("saves events and counts savedEventCount", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => mockEarningsPayload
      }) as Response;

    const { db, createdEvents } = makeMockDatabase({
      assets: [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }]
    });

    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.savedEventCount, 1);
    assert.equal(summary.fetchedEventCount, 1);
    assert.equal(summary.duplicateCount, 0);
    assert.equal(createdEvents.length, 1);
  });

  it("saves idempotently — updates existing event instead of creating duplicate", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => mockEarningsPayload
      }) as Response;

    const existingEvent = { id: "event-existing" };
    const { db, createdEvents, updatedEvents } = makeMockDatabase({
      assets: [{ id: "asset-1", symbol: "AAPL", assetType: AssetType.STOCK }],
      eventFindFirst: async () => existingEvent
    });

    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.duplicateCount, 1);
    assert.equal(summary.savedEventCount, 0);
    assert.equal(createdEvents.length, 0);
    assert.equal(updatedEvents.length, 1);
  });

  it("skips ETF assets", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";

    const { db, createdEvents } = makeMockDatabase({
      assets: []
    });

    const summary = await fetchEquityEvents(db as never);

    assert.equal(summary.assetCount, 0);
    assert.equal(createdEvents.length, 0);
  });
});
