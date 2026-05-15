import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssetType, BotRunStatus } from "@signalpilot/database";

import { analyzeCryptoSignals } from "../src/jobs/analyzeCryptoSignals.js";

describe("analyzeCryptoSignals", () => {
  it("creates SignalOutput with telegramText from the output composer", async () => {
    const createdSignals: Array<{ data: { output: { create: { telegramText: string; dashboardJson: unknown } } } }> = [];
    const botLogs: Array<{ data: { message: string; metadataJson?: unknown } }> = [];
    const candles = createCandles(250);
    const database = {
      botRun: {
        create: async () => ({
          id: "bot-run-1"
        }),
        update: async () => ({
          id: "bot-run-1",
          status: BotRunStatus.SUCCESS
        })
      },
      botLog: {
        create: async (operation: { data: { message: string; metadataJson?: unknown } }) => {
          botLogs.push(operation);
        }
      },
      asset: {
        findMany: async () => [
          {
            id: "asset-1",
            symbol: "BTCUSDT",
            assetType: AssetType.CRYPTO,
            isActive: true
          }
        ]
      },
      candle: {
        findMany: async () => [...candles].reverse()
      },
      signal: {
        create: async (operation: {
          data: { output: { create: { telegramText: string; dashboardJson: unknown } } };
        }) => {
          createdSignals.push(operation);
          return {
            id: `signal-${createdSignals.length}`
          };
        }
      }
    };

    await analyzeCryptoSignals(database as never);

    assert.equal(createdSignals.length, 3);

    for (const signal of createdSignals) {
      const output = signal.data.output.create;
      assert.ok(output.telegramText.length > 0);
      assert.match(output.telegramText, /News\/X\/Event:/);
      assert.match(output.telegramText, /Nächster Trigger:/);
      assert.ok(output.dashboardJson);
    }

    assert.ok(
      botLogs.some((log) => {
        const metadata = log.data.metadataJson;
        return (
          log.data.message === "Saved crypto technical signal" &&
          typeof metadata === "object" &&
          metadata !== null &&
          "shortConclusion" in metadata &&
          "nextTrigger" in metadata
        );
      })
    );
  });
});

function createCandles(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;

    return {
      high: String(close + 2),
      low: String(close - 2),
      close: String(close),
      volume: String(1000 + index)
    };
  });
}
