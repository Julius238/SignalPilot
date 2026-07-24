import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FinnhubMarketDataAdapter, normalizeFinnhubResponse } from "../src/finnhub.js";

const okPayload = {
  s: "ok",
  t: [1710000000, 1710003600],
  o: [180.5, 182.3],
  h: [181.0, 183.0],
  l: [179.8, 181.5],
  c: [182.3, 182.9],
  v: [12345678.0, 9876543.0]
};

describe("normalizeFinnhubResponse", () => {
  it("maps an ok response to NormalizedCandles", () => {
    const result = normalizeFinnhubResponse("AAPL", "1h", okPayload);

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;

    assert.equal(result.candles.length, 2);
    assert.deepEqual(result.candles[0], {
      symbol: "AAPL",
      timeframe: "1h",
      openTime: new Date(1710000000 * 1000),
      closeTime: new Date((1710000000 + 3600) * 1000),
      open: "180.5",
      high: "181",
      low: "179.8",
      close: "182.3",
      volume: "12345678",
      source: "FINNHUB"
    });
  });

  it("sets closeTime to openTime + 1 day for 1d interval", () => {
    const result = normalizeFinnhubResponse("AAPL", "1d", {
      s: "ok",
      t: [1710000000],
      o: [180.5],
      h: [181.0],
      l: [179.8],
      c: [182.3],
      v: [12345678.0]
    });

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;

    assert.deepEqual(result.candles[0].closeTime, new Date((1710000000 + 86400) * 1000));
  });

  it("returns no_data for s=no_data", () => {
    const result = normalizeFinnhubResponse("AAPL", "1h", { s: "no_data" });
    assert.equal(result.kind, "no_data");
  });

  it("returns no_data for ok status with empty arrays", () => {
    const result = normalizeFinnhubResponse("AAPL", "1h", { s: "ok", t: [], o: [], h: [], l: [], c: [], v: [] });
    assert.equal(result.kind, "no_data");
  });

  it("throws for an invalid response format", () => {
    assert.throws(
      () => normalizeFinnhubResponse("AAPL", "1h", { error: "invalid" }),
      /Invalid Finnhub candle response format/
    );
  });

  it("throws for an unexpected status", () => {
    assert.throws(
      () => normalizeFinnhubResponse("AAPL", "1h", { s: "unknown_status" }),
      /Unexpected Finnhub candle status/
    );
  });
});

describe("FinnhubMarketDataAdapter", () => {
  it("throws when FINNHUB_API_KEY is missing", () => {
    const adapter = new FinnhubMarketDataAdapter({ apiKey: "" });
    assert.throws(() => adapter.assertApiKey(), /FINNHUB_API_KEY/);
  });

  it("returns rate_limit for an HTTP 429 response", async () => {
    const mockFetch = async () =>
      ({
        ok: false,
        status: 429,
        json: async () => ({})
      }) as Response;

    const adapter = new FinnhubMarketDataAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T00:00:00.000Z");
    const result = await adapter.fetchStockCandles("AAPL", "1h", from, to);

    assert.equal(result.kind, "rate_limit");
  });

  it("classifies HTTP 403 as a permanent entitlement error", async () => {
    const mockFetch = async () =>
      ({
        ok: false,
        status: 403,
        text: async () => "Forbidden"
      }) as unknown as Response;

    const adapter = new FinnhubMarketDataAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T00:00:00.000Z");
    const result = await adapter.fetchStockCandles("AAPL", "1h", from, to);

    assert.equal(result.kind, "entitlement");
    if (result.kind !== "entitlement") return;
    assert.equal(result.statusCode, 403);
  });

  it("classifies HTTP 500 as a temporary provider error", async () => {
    const mockFetch = async () =>
      ({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      }) as unknown as Response;

    const adapter = new FinnhubMarketDataAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T00:00:00.000Z");

    const result = await adapter.fetchStockCandles("AAPL", "1h", from, to);
    assert.deepEqual(result, { kind: "temporary_error", statusCode: 500 });
  });

  it("returns ok candles for a successful response", async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => okPayload
      }) as Response;

    const adapter = new FinnhubMarketDataAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T00:00:00.000Z");
    const result = await adapter.fetchStockCandles("AAPL", "1h", from, to);

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.candles.length, 2);
    assert.equal(result.candles[0].source, "FINNHUB");
  });
});
