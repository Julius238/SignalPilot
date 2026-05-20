import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FinnhubEventsAdapter,
  normalizeEarningsCalendarResponse
} from "../src/finnhub-events.js";

const okPayload = {
  earningsCalendar: [
    {
      date: "2026-05-28",
      epsActual: null,
      epsEstimate: 1.42,
      hour: "amc",
      quarter: 2,
      revenueActual: null,
      revenueEstimate: 95000000000,
      symbol: "AAPL",
      year: 2026
    },
    {
      date: "2026-06-10",
      epsActual: 2.1,
      epsEstimate: 1.95,
      hour: "bmo",
      quarter: 2,
      revenueActual: 120000000000,
      revenueEstimate: 110000000000,
      symbol: "MSFT",
      year: 2026
    }
  ]
};

describe("normalizeEarningsCalendarResponse", () => {
  it("maps earningsCalendar array to NormalizedEarningsEvent", () => {
    const result = normalizeEarningsCalendarResponse(okPayload);

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;

    assert.equal(result.items.length, 2);
    const item = result.items[0];
    assert.equal(item.symbol, "AAPL");
    assert.equal(item.eventType, "EARNINGS");
    assert.equal(item.title, "AAPL Earnings");
    assert.equal(item.source, "FINNHUB");
    assert.deepEqual(item.eventDate, new Date("2026-05-28"));
    assert.equal(item.eventTime, "amc");
    assert.equal(item.fiscalQuarter, "2");
    assert.equal(item.fiscalYear, 2026);
    assert.equal(item.epsEstimate, "1.42");
    assert.equal(item.epsActual, null);
    assert.equal(item.revenueEstimate, "95000000000");
    assert.equal(item.revenueActual, null);
  });

  it("returns no_events for empty earningsCalendar", () => {
    const result = normalizeEarningsCalendarResponse({ earningsCalendar: [] });
    assert.equal(result.kind, "no_events");
  });

  it("throws for missing earningsCalendar field", () => {
    assert.throws(
      () => normalizeEarningsCalendarResponse({ data: [] }),
      /missing earningsCalendar array/
    );
  });

  it("throws for non-object payload", () => {
    assert.throws(
      () => normalizeEarningsCalendarResponse(null),
      /Invalid Finnhub earnings calendar response format/
    );
  });

  it("filters out items without symbol or date", () => {
    const result = normalizeEarningsCalendarResponse({
      earningsCalendar: [
        { symbol: "AAPL", date: "2026-05-28", epsEstimate: null, epsActual: null, hour: "", quarter: null, revenueEstimate: null, revenueActual: null, year: null },
        { date: "2026-05-28" },
        { symbol: "MSFT" }
      ]
    });

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].symbol, "AAPL");
  });
});

describe("FinnhubEventsAdapter", () => {
  it("throws when FINNHUB_API_KEY is missing", () => {
    const adapter = new FinnhubEventsAdapter({ apiKey: "" });
    assert.throws(() => adapter.assertApiKey(), /FINNHUB_API_KEY/);
  });

  it("returns rate_limit for HTTP 429", async () => {
    const mockFetch = async () =>
      ({ ok: false, status: 429 }) as Response;

    const adapter = new FinnhubEventsAdapter({ apiKey: "test-key", fetchClient: mockFetch });
    const result = await adapter.fetchEarningsCalendar({ from: "2026-05-01", to: "2026-06-30" });

    assert.equal(result.kind, "rate_limit");
  });

  it("returns forbidden for HTTP 403", async () => {
    const mockFetch = async () =>
      ({ ok: false, status: 403, text: async () => "Forbidden" }) as unknown as Response;

    const adapter = new FinnhubEventsAdapter({ apiKey: "test-key", fetchClient: mockFetch });
    const result = await adapter.fetchEarningsCalendar({ from: "2026-05-01", to: "2026-06-30" });

    assert.equal(result.kind, "forbidden");
    if (result.kind !== "forbidden") return;
    assert.equal(result.statusCode, 403);
  });

  it("throws for other HTTP errors", async () => {
    const mockFetch = async () =>
      ({ ok: false, status: 500, text: async () => "Internal Server Error" }) as unknown as Response;

    const adapter = new FinnhubEventsAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    await assert.rejects(
      () => adapter.fetchEarningsCalendar({ from: "2026-05-01", to: "2026-06-30" }),
      /HTTP 500/
    );
  });

  it("returns ok with items for successful response", async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => okPayload
      }) as Response;

    const adapter = new FinnhubEventsAdapter({ apiKey: "test-key", fetchClient: mockFetch });
    const result = await adapter.fetchEarningsCalendar({
      from: "2026-05-01",
      to: "2026-06-30",
      symbol: "AAPL"
    });

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.items.length, 2);
  });

  it("returns no_events for empty earningsCalendar", async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ earningsCalendar: [] })
      }) as Response;

    const adapter = new FinnhubEventsAdapter({ apiKey: "test-key", fetchClient: mockFetch });
    const result = await adapter.fetchEarningsCalendar({ from: "2026-05-01", to: "2026-06-30" });

    assert.equal(result.kind, "no_events");
  });
});
