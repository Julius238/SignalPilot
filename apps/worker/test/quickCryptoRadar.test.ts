import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BotRunStatus, WatchlistPriority } from "@signalpilot/database";
import type { NormalizedCandle } from "@signalpilot/market-data";

import {
  evaluateRadarCandles,
  quickCryptoRadar,
  resolveQuickCryptoRadarSettings
} from "../src/jobs/quickCryptoRadar.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("quickCryptoRadar", () => {
  it("uses conservative disabled defaults", () => {
    const settings = resolveQuickCryptoRadarSettings({});

    assert.equal(settings.enabled, false);
    assert.equal(settings.maxAssets, 10);
    assert.equal(settings.timeframe, "1h");
    assert.equal(settings.minMovePercent, 2.5);
    assert.equal(settings.minRelativeVolume, 2);
    assert.equal(settings.minRangePercent, 3);
    assert.equal(settings.alertsEnabled, false);
    assert.equal(settings.alertCooldownMinutes, 60);
    assert.equal(settings.minAlertSeverity, "IMPORTANT");
  });

  it("detects auffällige Bewegung, Volumenanstieg, and erhöhte Volatilität", () => {
    const settings = resolveQuickCryptoRadarSettings({
      QUICK_RADAR_ENABLED: "true",
      QUICK_RADAR_MIN_MOVE_PERCENT: "2",
      QUICK_RADAR_MIN_RELATIVE_VOLUME: "2",
      QUICK_RADAR_MIN_RANGE_PERCENT: "3"
    });

    const observation = evaluateRadarCandles(
      {
        id: "asset-1",
        symbol: "BTCUSDT",
        watchlistItem: { priority: WatchlistPriority.HIGH, alertEnabled: true }
      },
      settings,
      [
        candle({ close: "100", volume: "100", openTime: new Date(1) }),
        candle({ open: "100", high: "106", low: "99", close: "104", volume: "260", openTime: new Date(2) })
      ]
    );

    assert.ok(observation);
    assert.equal(observation.movementPercent, 4);
    assert.equal(observation.relativeVolume, 2.6);
    assert.equal(observation.rangePercent, 7);
    assert.deepEqual(observation.observations, [
      "auffällige Bewegung",
      "Volumenanstieg",
      "erhöhte Volatilität"
    ]);
  });

  it("returns null when there are not enough candles", () => {
    const settings = resolveQuickCryptoRadarSettings({ QUICK_RADAR_ENABLED: "true" });

    const observation = evaluateRadarCandles(
      { id: "asset-1", symbol: "BTCUSDT", watchlistItem: null },
      settings,
      [candle({ close: "100", volume: "100", openTime: new Date(1) })]
    );

    assert.equal(observation, null);
  });

  it("does not crash when selected assets have no data", async () => {
    process.env.QUICK_RADAR_ENABLED = "true";

    const state = createDatabaseState([
      {
        id: "asset-1",
        symbol: "BTCUSDT",
        watchlistItem: { priority: WatchlistPriority.HIGH, alertEnabled: true }
      }
    ]);
    const adapter = {
      fetchKlines: async () => []
    };

    const summary = await quickCryptoRadar(state.database as never, adapter);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.checkedAssetCount, 0);
    assert.equal(summary.missingDataCount, 1);
    assert.equal(summary.radarEventCount, 0);
    assert.equal(summary.persistedRadarEventCount, 0);
    assert.equal(state.botRunUpdates.at(-1)?.data.status, BotRunStatus.SUCCESS);
  });

  it("writes RadarEvent rows, BotRun metadata, and BotLogs for radar observations", async () => {
    process.env.QUICK_RADAR_ENABLED = "true";
    process.env.QUICK_RADAR_MIN_MOVE_PERCENT = "2";
    process.env.QUICK_RADAR_MIN_RELATIVE_VOLUME = "2";
    process.env.QUICK_RADAR_MIN_RANGE_PERCENT = "3";

    const state = createDatabaseState([
      {
        id: "asset-1",
        symbol: "BTCUSDT",
        watchlistItem: { priority: WatchlistPriority.HIGH, alertEnabled: true }
      }
    ]);
    const adapter = {
      fetchKlines: async () => [
        candle({ close: "100", volume: "100", openTime: new Date(1) }),
        candle({ open: "100", high: "106", low: "99", close: "104", volume: "260", openTime: new Date(2) })
      ]
    };

    const summary = await quickCryptoRadar(state.database as never, adapter);
    const metadata = state.botRunUpdates.at(-1)?.data.metadataJson as Record<string, unknown>;

    assert.equal(summary.radarEventCount, 3);
    assert.equal(summary.persistedRadarEventCount, 3);
    assert.equal(metadata.checkedAssetCount, 1);
    assert.equal(metadata.radarEventCount, 3);
    assert.equal(metadata.persistedRadarEventCount, 3);
    assert.equal(state.radarEvents.length, 3);
    assert.equal(state.alerts.length, 0);
    assert.ok(state.botLogs.some((log) => log.data.message === "Quick Crypto Markt-Radar Beobachtung"));
  });

  it("sends no radar alerts when QUICK_RADAR_ALERTS_ENABLED is false", async () => {
    process.env.QUICK_RADAR_ENABLED = "true";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";

    const state = createDatabaseState([
      {
        id: "asset-1",
        symbol: "BTCUSDT",
        watchlistItem: { priority: WatchlistPriority.HIGH, alertEnabled: true }
      }
    ]);
    const adapter = {
      fetchKlines: async () => [
        candle({ close: "100", volume: "100", openTime: new Date(1) }),
        candle({ open: "100", high: "106", low: "99", close: "104", volume: "260", openTime: new Date(2) })
      ]
    };
    let fetchCallCount = 0;

    const summary = await quickCryptoRadar(state.database as never, adapter, {
      fetchClient: async () => {
        fetchCallCount += 1;
        return new Response(null, { status: 200 });
      }
    });

    assert.equal(summary.persistedRadarEventCount, 3);
    assert.equal(summary.sentRadarAlertCount, 0);
    assert.equal(fetchCallCount, 0);
    assert.equal(state.alerts.length, 0);
  });

  it("sends radar alerts through n8n only for matching severity", async () => {
    process.env.QUICK_RADAR_ENABLED = "true";
    process.env.QUICK_RADAR_ALERTS_ENABLED = "true";
    process.env.QUICK_RADAR_MIN_ALERT_SEVERITY = "IMPORTANT";
    process.env.QUICK_RADAR_MIN_MOVE_PERCENT = "2";
    process.env.QUICK_RADAR_MIN_RELATIVE_VOLUME = "2";
    process.env.QUICK_RADAR_MIN_RANGE_PERCENT = "3";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";

    const state = createDatabaseState([
      {
        id: "asset-1",
        symbol: "BTCUSDT",
        watchlistItem: { priority: WatchlistPriority.HIGH, alertEnabled: true }
      }
    ]);
    const adapter = {
      fetchKlines: async () => [
        candle({ close: "100", volume: "100", openTime: new Date(1) }),
        candle({ open: "100", high: "106", low: "99", close: "104", volume: "260", openTime: new Date(2) })
      ]
    };
    const payloads: unknown[] = [];

    const summary = await quickCryptoRadar(state.database as never, adapter, {
      fetchClient: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }
    });

    assert.equal(summary.persistedRadarEventCount, 3);
    assert.equal(summary.sentRadarAlertCount, 2);
    assert.equal(summary.skippedRadarAlertCount, 1);
    assert.equal(state.alerts.length, 2);
    assert.equal(payloads.length, 2);
    assert.deepEqual(
      payloads.map((payload) => (payload as { type: string }).type),
      ["radar_event", "radar_event"]
    );
  });
});

function createDatabaseState(assets: unknown[]) {
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
  const botLogs: Array<{ data: { message: string; metadataJson?: unknown } }> = [];
  const radarEvents: Array<{ data: { symbol: string; eventType: string; severity?: string; shortMessage: string } }> = [];
  const alerts: Array<{ data: { payloadJson: unknown } }> = [];

  return {
    botRunUpdates,
    botLogs,
    radarEvents,
    alerts,
    database: {
      botRun: {
        create: async () => ({ id: "bot-run-1" }),
        update: async (operation: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
          botRunUpdates.push(operation);
          return { id: "bot-run-1", ...operation.data };
        }
      },
      botLog: {
        create: async (operation: { data: { message: string; metadataJson?: unknown } }) => {
          botLogs.push(operation);
        }
      },
      radarEvent: {
        findFirst: async () => null,
        create: async (operation: { data: { symbol: string; eventType: string; severity?: string; shortMessage: string } }) => {
          radarEvents.push(operation);
          return {
            id: `radar-event-${radarEvents.length}`,
            symbol: operation.data.symbol,
            eventType: operation.data.eventType,
            severity: operation.data.severity ?? "WATCH",
            timeframe: "1h",
            shortMessage: operation.data.shortMessage,
            score: null,
            movePercent: null,
            relativeVolume: null,
            rangePercent: null,
            metadataJson: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z")
          };
        }
      },
      alert: {
        create: async (operation: { data: { payloadJson: unknown } }) => {
          alerts.push(operation);
          return { id: `alert-${alerts.length}` };
        },
        update: async () => ({})
      },
      asset: {
        findMany: async () => assets
      }
    }
  };
}

function candle(overrides: Partial<NormalizedCandle>): NormalizedCandle {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    openTime: new Date(overrides.openTime ?? 0),
    closeTime: new Date(overrides.closeTime ?? overrides.openTime ?? 0),
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "100",
    source: "BINANCE",
    ...overrides
  };
}
