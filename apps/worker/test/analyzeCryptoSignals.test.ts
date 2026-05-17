import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AlertStatus, AssetType, BotRunStatus, WatchlistPriority } from "@signalpilot/database";

import {
  analyzeCryptoSignals,
  shouldRouteAlertForAsset,
  shouldSendSignalAlert
} from "../src/jobs/analyzeCryptoSignals.js";

describe("analyzeCryptoSignals", () => {
  const originalWebhookUrl = process.env.N8N_WEBHOOK_SIGNAL_URL;
  const originalAlertMode = process.env.ALERT_MODE;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalWebhookUrl === undefined) {
      delete process.env.N8N_WEBHOOK_SIGNAL_URL;
    } else {
      process.env.N8N_WEBHOOK_SIGNAL_URL = originalWebhookUrl;
    }

    if (originalAlertMode === undefined) {
      delete process.env.ALERT_MODE;
    } else {
      process.env.ALERT_MODE = originalAlertMode;
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
        findFirst: async () => null,
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
      assert.match(output.telegramText, /Multi-Timeframe:/);
      assert.match(output.telegramText, /Nächster Trigger:/);
      assert.ok(output.dashboardJson);
      assertDashboardJsonHasMultiTimeframeSummary(output.dashboardJson);
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
          "signalType" in metadata &&
          "alignment" in metadata &&
          "alignmentScore" in metadata
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
    assert.equal(
      shouldSendSignalAlert(
        {
          ...baseDecision,
          signalType: "NO_SIGNAL",
          status: "NO_EDGE",
          score: 45
        },
        "telegram text",
        {
          symbol: "BTCUSDT",
          alignment: "BULLISH_ALIGNED",
          alignmentScore: 72,
          primaryTimeframe: "1d",
          confirmingTimeframes: ["4h"],
          conflictingTimeframes: [],
          strongestSignal: null,
          weakestSignal: null,
          riskLevel: "MEDIUM",
          summary: "Aligned.",
          riskNote: "Risk medium.",
          nextFocus: "Watch 4h."
        }
      ),
      true
    );
    assert.equal(
      shouldSendSignalAlert(
        {
          ...baseDecision,
          signalType: "NO_SIGNAL",
          status: "NO_EDGE",
          riskLevel: "HIGH",
          score: 45
        },
        "telegram text",
        {
          symbol: "BTCUSDT",
          alignment: "CONFLICT",
          alignmentScore: 40,
          primaryTimeframe: "1d",
          confirmingTimeframes: [],
          conflictingTimeframes: ["1h"],
          strongestSignal: null,
          weakestSignal: null,
          riskLevel: "HIGH",
          summary: "Conflict.",
          riskNote: "Risk high.",
          nextFocus: "Watch higher timeframes."
        }
      ),
      true
    );
  });

  it("routes alerts by alert mode and watchlist state", () => {
    const asset = {
      id: "asset-1",
      symbol: "BTCUSDT"
    };
    const enabledMedium = {
      alertEnabled: true,
      priority: WatchlistPriority.MEDIUM
    };
    const disabledHigh = {
      alertEnabled: false,
      priority: WatchlistPriority.HIGH
    };

    assert.deepEqual(shouldRouteAlertForAsset({ asset, alertMode: "ALL_ASSETS" }), {
      shouldRoute: true,
      reason: "ALL_ASSETS"
    });
    assert.deepEqual(
      shouldRouteAlertForAsset({
        asset,
        watchlistItem: disabledHigh,
        alertMode: "ALL_ASSETS"
      }),
      {
        shouldRoute: false,
        reason: "WATCHLIST_DISABLED"
      }
    );
    assert.deepEqual(
      shouldRouteAlertForAsset({
        asset,
        watchlistItem: enabledMedium,
        alertMode: "WATCHLIST_ONLY"
      }),
      {
        shouldRoute: true,
        reason: "WATCHLIST_ONLY_MATCH"
      }
    );
    assert.deepEqual(shouldRouteAlertForAsset({ asset, alertMode: "WATCHLIST_ONLY" }), {
      shouldRoute: false,
      reason: "NOT_ON_WATCHLIST"
    });
    assert.deepEqual(
      shouldRouteAlertForAsset({
        asset,
        watchlistItem: disabledHigh,
        alertMode: "WATCHLIST_ONLY"
      }),
      {
        shouldRoute: false,
        reason: "WATCHLIST_DISABLED"
      }
    );
    assert.deepEqual(
      shouldRouteAlertForAsset({
        asset,
        watchlistItem: {
          alertEnabled: true,
          priority: WatchlistPriority.HIGH
        },
        alertMode: "HIGH_PRIORITY_ONLY"
      }),
      {
        shouldRoute: true,
        reason: "HIGH_PRIORITY_MATCH"
      }
    );
    assert.deepEqual(
      shouldRouteAlertForAsset({
        asset,
        watchlistItem: enabledMedium,
        alertMode: "HIGH_PRIORITY_ONLY"
      }),
      {
        shouldRoute: false,
        reason: "NOT_HIGH_PRIORITY"
      }
    );
    assert.deepEqual(shouldRouteAlertForAsset({ asset, alertMode: "SOMETHING_ELSE" }), {
      shouldRoute: true,
      reason: "INVALID_ALERT_MODE"
    });
  });

  it("increments routeSkippedAlertCount when WATCHLIST_ONLY skips assets outside watchlist", async () => {
    process.env.ALERT_MODE = "WATCHLIST_ONLY";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    globalThis.fetch = async () => new Response("ok", { status: 200 });

    const botRunUpdates: Array<{ data: { metadataJson?: unknown } }> = [];
    const database = createAnalyzeDatabase({
      assetWatchlistItem: null,
      botRunUpdates
    });

    const summary = await analyzeCryptoSignals(database as never);
    const metadata = botRunUpdates.at(-1)?.data.metadataJson as Record<string, unknown>;

    assert.equal(summary.alertMode, "WATCHLIST_ONLY");
    assert.equal(summary.routeSkippedAlertCount, 3);
    assert.equal(summary.notOnWatchlistSkipCount, 3);
    assert.equal(summary.sentAlertCount, 0);
    assert.equal(metadata.routeSkippedAlertCount, 3);
    assert.equal(metadata.notOnWatchlistSkipCount, 3);
  });

  it("sends alerts when HIGH_PRIORITY_ONLY matches HIGH alert-enabled watchlist item", async () => {
    process.env.ALERT_MODE = "HIGH_PRIORITY_ONLY";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    globalThis.fetch = async () => new Response("ok", { status: 200 });

    const alertUpdates: Array<{ data: { status: AlertStatus; sentAt?: Date } }> = [];
    const database = createAnalyzeDatabase({
      assetWatchlistItem: {
        alertEnabled: true,
        priority: WatchlistPriority.HIGH
      },
      alertUpdates
    });

    const summary = await analyzeCryptoSignals(database as never);

    assert.equal(summary.alertMode, "HIGH_PRIORITY_ONLY");
    assert.equal(summary.routeSkippedAlertCount, 0);
    assert.equal(summary.routedAlertCount, 3);
    assert.equal(summary.sentAlertCount, 3);
    assert.equal(alertUpdates.filter((update) => update.data.status === AlertStatus.SENT).length, 3);
  });
});

function assertDashboardJsonHasMultiTimeframeSummary(dashboardJson: unknown) {
  assert.equal(typeof dashboardJson, "object");
  assert.notEqual(dashboardJson, null);
  assert.ok("multiTimeframeSummary" in dashboardJson);

  const summary = (dashboardJson as { multiTimeframeSummary?: unknown }).multiTimeframeSummary;
  assert.equal(typeof summary, "object");
  assert.notEqual(summary, null);
  assert.ok("alignment" in summary);
  assert.ok("alignmentScore" in summary);
}

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

function createAnalyzeDatabase(input: {
  assetWatchlistItem: { alertEnabled: boolean; priority: WatchlistPriority } | null;
  alertUpdates?: Array<{ data: { status: AlertStatus; sentAt?: Date } }>;
  botRunUpdates?: Array<{ data: { metadataJson?: unknown } }>;
}) {
  const candles = createCandles(250);
  const alertUpdates = input.alertUpdates ?? [];
  const botRunUpdates = input.botRunUpdates ?? [];
  const createdSignals: Array<{
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
  }> = [];

  return {
    botRun: {
      create: async () => ({
        id: "bot-run-1"
      }),
      update: async (operation: { data: { metadataJson?: unknown } }) => {
        botRunUpdates.push(operation);
        return {
          id: "bot-run-1",
          status: BotRunStatus.SUCCESS
        };
      }
    },
    botLog: {
      create: async () => undefined
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
          isActive: true,
          watchlistItem: input.assetWatchlistItem
        }
      ]
    },
    candle: {
      findMany: async () => [...candles].reverse()
    },
    signal: {
      findFirst: async () => null,
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
}
