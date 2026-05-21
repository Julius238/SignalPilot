import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { calculateMarketRegime } from "../src/jobs/calculateMarketRegime.js";

describe("calculateMarketRegime", () => {
  it("stores a MarketRegimeSnapshot", async () => {
    const createdSnapshots: unknown[] = [];
    const database = {
      botRun: {
        create: async () => ({ id: "bot-run-1" }),
        update: async ({ data }: { data: { status: BotRunStatus } }) => ({ id: "bot-run-1", ...data })
      },
      botLog: {
        create: async () => ({ id: "bot-log-1" })
      },
      marketRegimeSnapshot: {
        findFirst: async () => null,
        create: async ({ data }: { data: unknown }) => {
          createdSnapshots.push(data);
          return { id: "snapshot-1", ...(data as Record<string, unknown>) };
        }
      },
      asset: {
        findMany: async () => [
          { id: "spy", symbol: "SPY", assetType: AssetType.ETF },
          { id: "qqq", symbol: "QQQ", assetType: AssetType.ETF },
          { id: "iwm", symbol: "IWM", assetType: AssetType.ETF },
          { id: "btc", symbol: "BTCUSDT", assetType: AssetType.CRYPTO },
          { id: "eth", symbol: "ETHUSDT", assetType: AssetType.CRYPTO }
        ]
      },
      candle: {
        findMany: async ({ where }: { where: { assetId: string } }) =>
          uptrendCandles(where.assetId === "btc" || where.assetId === "eth" ? 120 : 100).reverse()
      }
    };

    const summary = await calculateMarketRegime(database as never, { force: true });

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.snapshotId, "snapshot-1");
    assert.equal(createdSnapshots.length, 1);
    assert.equal((createdSnapshots[0] as { overallRegime: string }).overallRegime, "RISK_ON");
  });
});

function uptrendCandles(start: number) {
  return Array.from({ length: 220 }, (_, index) => {
    const close = start + index;
    return {
      close: { toString: () => String(close) },
      high: { toString: () => String(close + 1) },
      low: { toString: () => String(close - 1) }
    };
  });
}
