import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AlertStatus, AssetType, BotRunStatus } from "@signalpilot/database";

import { analyzeCryptoSignals, shouldSendSignalAlert } from "../src/jobs/analyzeCryptoSignals.js";

describe("analyzeCryptoSignals", () => {
  const originalWebhookUrl = process.env.N8N_WEBHOOK_SIGNAL_URL;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalWebhookUrl === undefined) {
      delete process.env.N8N_WEBHOOK_SIGNAL_URL;
    } else {
      process.env.N8N_WEBHOOK_SIGNAL_URL = originalWebhookUrl;
    }

    globalThis.fetch = originalFetch;
  });

  it("creates SignalOutput with telegramText and sends relevant alerts to n8n", async () => {
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    globalThis.fetch = async () => new Response("ok", { status: 200 });

    const createdSignals: Array<{
      data: { output: { create: { telegramText: string; dashboardJson: unknown } } };
    }> = [];
    const alertUpdates: Array<{ data: { status: AlertStatus; sentAt?: Date } }> = [];
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
      alert: {
        create: async () => ({
          id: `alert-${alertUpdates.length + 1}`
        }),
        update: async (operation: { data: { status: AlertStatus; sentAt?: Date } }) => {
          alertUpdates.push(operation);
          return {
            id: `alert-${alertUpdates.length}`,
            ...operation.data
          };
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
          data: {
            symbol: string;
            timeframe: string;
            status: string;
            direction: string;
            signalType: string;
            score: number;
            riskLevel: string;
            output: { create: { telegramText: string; dashboardJson: unknown } };
          };
        }) => {
          createdSignals.push(operation);
          return {
            id: `signal-${createdSignals.length}`,
            symbol: operation.data.symbol,
            timeframe: operation.data.timeframe,
            status: operation.data.status,
            direction: operation.data.direction,
            signalType: operation.data.signalType,
            score: operation.data.score,
            riskLevel: operation.data.riskLevel,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            asset: {
              assetType: AssetType.CRYPTO
            },
            output: operation.data.output.create
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
      alertUpdates.some((update) => update.data.status === AlertStatus.SENT)
    );
    assert.ok(
      botLogs.some((log) => {
        const metadata = log.data.metadataJson;
        return (
          log.data.message === "Signal alert sent to n8n" &&
          typeof metadata === "object" &&
          metadata !== null &&
          "signalId" in metadata &&
          "signalType" in metadata
        );
      })
    );
  });

  it("does not send alerts for no edge or empty telegram text", () => {
    const baseDecision = {
      symbol: "BTCUSDT",
      assetType: "crypto",
      timeframe: "1h",
      signalType: "NO_SIGNAL",
      status: "NO_EDGE",
      direction: "NEUTRAL",
      score: 45,
      riskLevel: "LOW",
      trendScore: 50,
      momentumScore: 50,
      volumeScore: 50,
      volatilityScore: 50,
      rsiScore: 50,
      newsScore: 50,
      socialScore: 50,
      eventScore: 50,
      riskScore: 25,
      reasons: [],
      counterArguments: [],
      nextTrigger: "Neuer Scan mit klarerem Setup."
    } as const;

    assert.equal(shouldSendSignalAlert(baseDecision, "telegram text"), false);
    assert.equal(
      shouldSendSignalAlert(
        {
          ...baseDecision,
          signalType: "VOLUME_SPIKE",
          status: "WATCH",
          score: 75
        },
        ""
      ),
      false
    );
    assert.equal(
      shouldSendSignalAlert(
        {
          ...baseDecision,
          signalType: "VOLATILITY_SPIKE",
          status: "WAIT",
          score: 55
        },
        "telegram text"
      ),
      true
    );
    assert.equal(
      shouldSendSignalAlert(
        {
          ...baseDecision,
          signalType: "BREAKOUT_ALERT",
          status: "WATCH",
          score: 75
        },
        "telegram text"
      ),
      true
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
      volume: String(index === count - 1 ? 50000 : 1000)
    };
  });
}
