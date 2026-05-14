import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saveCandles } from "../src/candles.js";
import type { NormalizedCandle } from "../src/types.js";

describe("saveCandles", () => {
  it("upserts candles by asset, timeframe, and openTime", async () => {
    const operations: unknown[] = [];
    const database = {
      candle: {
        upsert: async (operation: unknown) => {
          operations.push(operation);
        }
      }
    };
    const candle: NormalizedCandle = {
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: new Date("2026-01-01T00:00:00.000Z"),
      closeTime: new Date("2026-01-01T00:59:59.999Z"),
      open: "100.00",
      high: "110.00",
      low: "90.00",
      close: "105.00",
      volume: "10.00",
      source: "BINANCE"
    };

    await saveCandles("asset-1", [candle], database as never);
    await saveCandles("asset-1", [candle], database as never);

    assert.equal(operations.length, 2);
    assert.deepEqual(
      operations.map((operation) => (operation as { where: unknown }).where),
      [
        {
          assetId_timeframe_openTime: {
            assetId: "asset-1",
            timeframe: "1h",
            openTime: candle.openTime
          }
        },
        {
          assetId_timeframe_openTime: {
            assetId: "asset-1",
            timeframe: "1h",
            openTime: candle.openTime
          }
        }
      ]
    );
  });
});
