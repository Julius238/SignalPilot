import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssetType, BacktestRunStatus, BotRunStatus, StrategyComparisonStatus } from "@signalpilot/database";

import { runStrategyComparison } from "../src/jobs/runStrategyComparison.js";

describe("runStrategyComparison", () => {
  it("creates a ComparisonRun and Results", async () => {
    const state = {
      comparisonStatus: StrategyComparisonStatus.RUNNING,
      resultCount: 0,
      botRunStatus: BotRunStatus.RUNNING,
      backtestSummary: null as Record<string, unknown> | null
    };
    const database = createDatabase(state);

    const summary = await runStrategyComparison(database as never, {
      name: "Strategy Worker Test",
      symbols: ["BTCUSDT"],
      assetType: AssetType.CRYPTO,
      timeframes: ["1h"],
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-01-03T00:00:00.000Z"),
      strategyConfigNames: ["Baseline 50"],
      maxSignalsPerAssetTimeframe: 2
    });

    assert.equal(summary.status, StrategyComparisonStatus.SUCCESS);
    assert.equal(state.comparisonStatus, StrategyComparisonStatus.SUCCESS);
    assert.equal(state.botRunStatus, BotRunStatus.SUCCESS);
    assert.equal(state.resultCount, 1);
  });
});

function createDatabase(state: {
  comparisonStatus: StrategyComparisonStatus;
  resultCount: number;
  botRunStatus: BotRunStatus;
  backtestSummary: Record<string, unknown> | null;
}) {
  const strategyConfigs: Array<{ id: string; name: string; description: string | null; isDefault: boolean; configJson: Record<string, unknown> }> = [];

  return {
    botRun: {
      create: async () => ({ id: `botrun-${Math.random()}` }),
      update: async ({ data }: { data: { status: BotRunStatus } }) => {
        state.botRunStatus = data.status;
      }
    },
    botLog: { create: async () => ({ id: "botlog-1" }) },
    strategyConfig: {
      findFirst: async ({ where }: { where: { name: string } }) =>
        strategyConfigs.find((config) => config.name === where.name) ?? null,
      create: async ({ data }: { data: { name: string; description?: string | null; isDefault: boolean; configJson: Record<string, unknown> } }) => {
        const config = { id: `strategy-${strategyConfigs.length + 1}`, description: null, ...data };
        strategyConfigs.push(config);
        return config;
      },
      update: async ({ where, data }: { where: { id: string }; data: { description?: string | null; isDefault: boolean; configJson: Record<string, unknown> } }) => {
        const config = strategyConfigs.find((item) => item.id === where.id);
        if (config) Object.assign(config, data);
        return config;
      },
      findMany: async ({ where }: { where: { name?: { in: string[] }; isDefault?: boolean } }) =>
        strategyConfigs
          .filter((config) => !where.name || where.name.in.includes(config.name))
          .filter((config) => where.isDefault === undefined || config.isDefault === where.isDefault)
    },
    strategyComparisonRun: {
      create: async () => ({ id: "comparison-1", name: "Strategy Worker Test" }),
      update: async ({ data }: { data: { status: StrategyComparisonStatus } }) => {
        state.comparisonStatus = data.status;
      }
    },
    strategyBacktestResult: {
      create: async () => {
        state.resultCount += 1;
        return { id: `result-${state.resultCount}` };
      },
      update: async () => ({ id: "result-1" })
    },
    backtestRun: {
      create: async () => ({ id: "backtest-1" }),
      update: async ({ data }: { data: { status: BacktestRunStatus; summaryJson?: Record<string, unknown> } }) => {
        state.backtestSummary = data.summaryJson ?? null;
      },
      findUnique: async () => ({ id: "backtest-1", summaryJson: state.backtestSummary })
    },
    backtestSignal: {
      createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length })
    },
    asset: {
      findMany: async () => [{ id: "asset-1", symbol: "BTCUSDT", assetType: AssetType.CRYPTO }]
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
