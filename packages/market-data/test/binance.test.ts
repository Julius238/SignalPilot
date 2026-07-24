import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BinanceMarketDataAdapter, normalizeBinanceKlines } from "../src/binance.js";

describe("normalizeBinanceKlines", () => {
  it("normalizes a Binance kline response", () => {
    const candles = normalizeBinanceKlines("BTCUSDT", "1h", [
      [
        1710000000000,
        "68000.10000000",
        "68100.20000000",
        "67900.30000000",
        "68050.40000000",
        "123.45000000",
        1710003599999,
        "8400000.00000000",
        1000,
        "60.00000000",
        "4100000.00000000",
        "0"
      ]
    ]);

    assert.equal(candles.length, 1);
    assert.deepEqual(candles[0], {
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: new Date(1710000000000),
      closeTime: new Date(1710003599999),
      open: "68000.10000000",
      high: "68100.20000000",
      low: "67900.30000000",
      close: "68050.40000000",
      volume: "123.45000000",
      source: "BINANCE"
    });
  });

  it("throws for an invalid response body", () => {
    assert.throws(
      () => normalizeBinanceKlines("BTCUSDT", "1h", { error: "invalid" }),
      /expected an array/
    );
  });

  it("throws for an invalid kline entry", () => {
    assert.throws(() => normalizeBinanceKlines("BTCUSDT", "1h", [[1710000000000]]), /index 0/);
  });
});

describe("Binance paginated history", () => {
  it("uses startTime/endTime and advances the cursor without overlap", async () => {
    const requestedStarts: number[] = [];
    const fetchClient = async (input: string | URL) => {
      const url = new URL(String(input));
      requestedStarts.push(Number(url.searchParams.get("startTime")));
      assert.equal(url.searchParams.get("endTime"), "1710010800000");
      const start = Number(url.searchParams.get("startTime"));
      const timestamps =
        start === 1710000000000
          ? [1710000000000, 1710003600000]
          : [1710007200000];
      return {
        ok: true,
        status: 200,
        json: async () => timestamps.map(kline)
      } as Response;
    };
    const adapter = new BinanceMarketDataAdapter({ fetchClient });
    const pages = [];

    for await (const page of adapter.fetchKlineHistoryPages(
      "BTCUSDT",
      "1h",
      new Date(1710000000000),
      new Date(1710010800000),
      { pageSize: 2 }
    )) {
      pages.push(page);
    }

    assert.deepEqual(requestedStarts, [1710000000000, 1710007200000]);
    assert.deepEqual(pages.map((page) => page.length), [2, 1]);
  });
});

function kline(openTime: number) {
  return [
    openTime,
    "1",
    "2",
    "0.5",
    "1.5",
    "10",
    openTime + 3_599_999,
    "0",
    1,
    "0",
    "0",
    "0"
  ];
}
