import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeBinanceKlines } from "../src/binance.js";

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
