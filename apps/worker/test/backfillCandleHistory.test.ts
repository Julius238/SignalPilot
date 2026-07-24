import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { backfillCandleHistory } from "../src/jobs/backfillCandleHistory.js";

describe("backfillCandleHistory", () => {
  const savedDelay = process.env.MARKET_DATA_REQUEST_DELAY_MS;

  afterEach(() => {
    if (savedDelay === undefined) delete process.env.MARKET_DATA_REQUEST_DELAY_MS;
    else process.env.MARKET_DATA_REQUEST_DELAY_MS = savedDelay;
  });

  it("resumes an interrupted Binance series and skips it after completion", async () => {
    process.env.MARKET_DATA_REQUEST_DELAY_MS = "0";
    const now = new Date("2026-07-24T12:00:00.000Z");
    const rangeStart = new Date("2020-07-01T00:00:00.000Z");
    const rangeEnd = new Date("2026-07-24T12:00:00.000Z");
    const resumeCursor = new Date("2026-07-10T00:00:00.000Z");
    const states = new Map<string, {
      backfillStart: Date;
      backfillEnd: Date;
      backfillCursor: Date;
      backfillStatus: string;
    }>([
      ["1h", {
        backfillStart: rangeStart,
        backfillEnd: rangeEnd,
        backfillCursor: resumeCursor,
        backfillStatus: "FAILED"
      }],
      ["4h", completedState()],
      ["1d", completedState()]
    ]);
    const requestedStarts: number[] = [];
    let candleUpserts = 0;
    const database = {
      botRun: {
        create: async () => ({ id: "backfill-run" }),
        update: async () => ({})
      },
      botLog: { create: async () => ({}) },
      asset: {
        findMany: async () => [
          { id: "asset-btc", symbol: "BTCUSDT", assetType: AssetType.CRYPTO }
        ]
      },
      candle: {
        upsert: async () => {
          candleUpserts += 1;
        },
        findMany: async () => []
      },
      candleDataQuality: {
        findUnique: async (operation: {
          where: { assetId_provider_timeframe: { timeframe: string } };
        }) => states.get(operation.where.assetId_provider_timeframe.timeframe) ?? null,
        upsert: async (operation: {
          where: { assetId_provider_timeframe: { timeframe: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const timeframe = operation.where.assetId_provider_timeframe.timeframe;
          const previous = states.get(timeframe);
          states.set(timeframe, {
            backfillStart: (operation.update.backfillStart as Date) ?? previous?.backfillStart ?? rangeStart,
            backfillEnd: (operation.update.backfillEnd as Date) ?? previous?.backfillEnd ?? rangeEnd,
            backfillCursor: (operation.update.backfillCursor as Date) ?? previous?.backfillCursor ?? rangeEnd,
            backfillStatus: (operation.update.backfillStatus as string) ?? previous?.backfillStatus ?? "SUCCESS"
          });
          return {};
        }
      }
    };
    const binance = {
      fetchKlines: async (_symbol: string, _timeframe: string, request: { startTime?: Date }) => {
        requestedStarts.push(request.startTime!.getTime());
        return [{
          symbol: "BTCUSDT",
          timeframe: "1h" as const,
          openTime: resumeCursor,
          closeTime: new Date(resumeCursor.getTime() + 60 * 60 * 1000),
          open: "1",
          high: "2",
          low: "0.5",
          close: "1.5",
          volume: "10",
          source: "BINANCE" as const
        }];
      }
    };

    const first = await backfillCandleHistory(database as never, { binance, now });
    const second = await backfillCandleHistory(database as never, { binance, now });

    assert.equal(first.status, BotRunStatus.SUCCESS);
    assert.equal(first.resumedSeriesCount, 1);
    assert.deepEqual(requestedStarts, [resumeCursor.getTime()]);
    assert.equal(candleUpserts, 1);
    assert.equal(second.savedCandleCount, 0);
  });
});

function completedState() {
  return {
    backfillStart: new Date("2020-01-01T00:00:00.000Z"),
    backfillEnd: new Date("2026-07-24T12:00:00.000Z"),
    backfillCursor: new Date("2026-07-24T12:00:00.000Z"),
    backfillStatus: "SUCCESS"
  };
}
