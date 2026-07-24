import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { auditCandleGaps } from "../src/jobs/auditCandleGaps.js";

describe("auditCandleGaps", () => {
  it("targets and repairs a detected Binance gap", async () => {
    const now = new Date("2026-01-01T05:00:00.000Z");
    const candles = new Map<string, Array<{ openTime: Date; closeTime: Date }>>([
      ["1h", [candle(0), candle(1), candle(3), candle(4)]],
      ["4h", []],
      ["1d", []]
    ]);
    const requestedRanges: Array<{ from: Date; to: Date }> = [];
    const database = {
      botRun: {
        create: async () => ({ id: "gap-run" }),
        update: async () => ({})
      },
      botLog: { create: async () => ({}) },
      asset: {
        findMany: async () => [
          { id: "asset-btc", symbol: "BTCUSDT", assetType: AssetType.CRYPTO }
        ]
      },
      candle: {
        findMany: async (operation: { where: { timeframe: string } }) =>
          candles.get(operation.where.timeframe) ?? [],
        upsert: async (operation: {
          create: { timeframe: string; openTime: Date; closeTime: Date };
        }) => {
          const series = candles.get(operation.create.timeframe) ?? [];
          series.push({
            openTime: operation.create.openTime,
            closeTime: operation.create.closeTime
          });
          candles.set(operation.create.timeframe, series);
        }
      },
      candleDataQuality: { upsert: async () => ({}) }
    };
    const binance = {
      fetchKlines: async (
        _symbol: string,
        _timeframe: string,
        request: { startTime: Date; endTime: Date }
      ) => {
        requestedRanges.push({ from: request.startTime, to: request.endTime });
        return [{
          symbol: "BTCUSDT",
          timeframe: "1h" as const,
          openTime: new Date("2026-01-01T02:00:00.000Z"),
          closeTime: new Date("2026-01-01T03:00:00.000Z"),
          open: "1",
          high: "2",
          low: "0.5",
          close: "1.5",
          volume: "10",
          source: "BINANCE" as const
        }];
      }
    };

    const summary = await auditCandleGaps(database as never, { binance, now });

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.gapsDetected, 1);
    assert.equal(summary.gapsRepaired, 1);
    assert.equal(summary.remainingGaps, 0);
    assert.equal(requestedRanges[0].from.toISOString(), "2026-01-01T02:00:00.000Z");
  });
});

function candle(hour: number) {
  const openTime = new Date("2026-01-01T00:00:00.000Z");
  openTime.setUTCHours(hour);
  return {
    openTime,
    closeTime: new Date(openTime.getTime() + 60 * 60 * 1000)
  };
}
