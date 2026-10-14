import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FredSeriesAdapter, parseFredSeriesCsv } from "../src/fred.js";

const CSV = ["observation_date,SP500", "2024-01-02,4742.83", "2024-01-03,", "2024-01-04,.", "2024-01-05,4697.24", ""].join("\n");

describe("parseFredSeriesCsv", () => {
  it("turns daily observations into close-only candles and skips empty days", () => {
    const candles = parseFredSeriesCsv("SPY", "SP500", CSV);
    assert.equal(candles.length, 2);
    assert.deepEqual(candles[0], {
      symbol: "SPY",
      timeframe: "1d",
      openTime: new Date("2024-01-02T00:00:00.000Z"),
      closeTime: new Date("2024-01-02T21:00:00.000Z"),
      open: "4742.83",
      high: "4742.83",
      low: "4742.83",
      close: "4742.83",
      volume: "0",
      source: "FRED"
    });
    assert.equal(candles[1].close, "4697.24");
  });

  it("only treats a value as known after the US session close", () => {
    const [candle] = parseFredSeriesCsv("SPY", "SP500", CSV);
    // 16:00 New York is 21:00 UTC in winter; a value is never known earlier.
    assert.equal(candle.closeTime.getUTCHours(), 21);
  });

  it("refuses a CSV for a different series", () => {
    assert.throws(() => parseFredSeriesCsv("QQQ", "NASDAQ100", CSV), /Unexpected FRED CSV header/);
  });
});

describe("FredSeriesAdapter", () => {
  it("requests the public CSV download and filters by start date", async () => {
    let requested = "";
    const adapter = new FredSeriesAdapter({
      fetchClient: async (input) => {
        requested = String(input);
        return new Response(CSV, { status: 200 });
      }
    });
    const candles = await adapter.fetchDailyCloses("SPY", "SP500", new Date("2024-01-05T00:00:00.000Z"));
    assert.equal(requested, "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500");
    assert.deepEqual(
      candles.map((candle) => candle.close),
      ["4697.24"]
    );
  });

  it("classifies an HTTP failure as a provider error", async () => {
    const adapter = new FredSeriesAdapter({ fetchClient: async () => new Response("nope", { status: 404 }) });
    await assert.rejects(() => adapter.fetchDailyCloses("SPY", "SP500"), /FRED series request failed/);
  });
});
