import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssetType, BacktestRunStatus, BotRunStatus } from "@signalpilot/database";

import { runBacktest } from "../src/jobs/runBacktest.js";

describe("runBacktest", () => {
  it("creates a BacktestRun SUCCESS", async () => {
    const state = {
      runStatus: BacktestRunStatus.RUNNING,
      signalCreateCount: 0,
      botRunStatus: BotRunStatus.RUNNING
    };
    const database = createDatabase(state);

    const summary = await runBacktest(database as never, {
      name: "Worker Backtest",
      symbols: ["BTCUSDT"],
      assetType: AssetType.CRYPTO,
      timeframes: ["1h"],
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-01-03T00:00:00.000Z"),
      minCandlesBeforeSignal: 20,
      maxSignalsPerAssetTimeframe: 3,
      minScoreToRecord: 0,
      useSignalRules: false
    });

    assert.equal(summary.status, BacktestRunStatus.SUCCESS);
    assert.equal(state.runStatus, BacktestRunStatus.SUCCESS);
    assert.equal(state.botRunStatus, BotRunStatus.SUCCESS);
    assert.equal(state.signalCreateCount > 0, true);
  });
});

function createDatabase(state: { runStatus: BacktestRunStatus; signalCreateCount: number; botRunStatus: BotRunStatus }) {
  return {
    botRun: {
      create: async () => ({ id: "botrun-backtest-1" }),
      update: async ({ data }: { data: { status: BotRunStatus } }) => {
        state.botRunStatus = data.status;
      }
    },
    botLog: {
      create: async () => ({ id: "botlog-1" })
    },
    backtestRun: {
      create: async () => ({ id: "backtest-1" }),
      update: async ({ data }: { data: { status: BacktestRunStatus } }) => {
        state.runStatus = data.status;
      }
    },
    backtestSignal: {
      createMany: async ({ data }: { data: unknown[] }) => {
        state.signalCreateCount += data.length;
        return { count: data.length };
      }
    },
    asset: {
      findMany: async () => [
        {
          id: "asset-1",
          symbol: "BTCUSDT",
          assetType: AssetType.CRYPTO
        }
      ]
    },
    candle: {
      findMany: async () => createCandles(80)
    }
  };
}

function createCandles(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.5;
    return {
      assetId: "asset-1",
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: new Date(Date.UTC(2025, 11, 31, index)),
      closeTime: new Date(Date.UTC(2025, 11, 31, index + 1)),
      open: { toString: () => String(close - 0.2) },
      high: { toString: () => String(close + 1) },
      low: { toString: () => String(close - 1) },
      close: { toString: () => String(close) },
      volume: { toString: () => "1000" }
    };
  });
}
