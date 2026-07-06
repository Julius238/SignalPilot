import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BotRunStatus, WatchlistPriority } from "@signalpilot/database";

import { quickEquityRadar, resolveQuickEquityRadarSettings } from "../src/jobs/quickEquityRadar.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

type FakeCandle = {
  openTime: Date;
  closeTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

function buildCandleSeries(lastCloseTime: Date): FakeCandle[] {
  const candles: FakeCandle[] = [];
  const dayMs = 24 * 3_600_000;

  for (let index = 0; index < 24; index += 1) {
    const close = 100 + Math.sin(index) * 0.4;
    const openTime = new Date(lastCloseTime.getTime() - (25 - index) * dayMs);
    candles.push({
      openTime,
      closeTime: new Date(openTime.getTime() + dayMs),
      open: close.toFixed(4),
      high: (close * 1.01).toFixed(4),
      low: (close * 0.99).toFixed(4),
      close: close.toFixed(4),
      volume: "100"
    });
  }

  candles.push({
    openTime: new Date(lastCloseTime.getTime() - dayMs),
    closeTime: lastCloseTime,
    open: "100.5",
    high: "101.4",
    low: "100.2",
    close: "101.0",
    volume: "250"
  });

  return candles;
}

function createDatabaseState(candles: FakeCandle[]) {
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
  const botLogs: Array<{ data: { message: string; level: string } }> = [];
  const radarEvents: Array<{ data: { symbol: string; assetType: string; eventType: string; shortMessage: string } }> = [];
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
          return { id: "bot-run-1" };
        }
      },
      botLog: {
        create: async (operation: { data: { message: string; level: string } }) => {
          botLogs.push(operation);
        }
      },
      asset: {
        findMany: async () => [
          {
            id: "asset-aapl",
            symbol: "AAPL",
            assetType: "STOCK",
            watchlistItem: { priority: WatchlistPriority.HIGH, alertEnabled: true }
          }
        ]
      },
      candle: {
        // Job fragt absteigend sortiert an und dreht selbst um
        findMany: async () => [...candles].reverse()
      },
      radarEvent: {
        findFirst: async () => null,
        create: async (operation: {
          data: { symbol: string; assetType: string; eventType: string; shortMessage: string };
        }) => {
          radarEvents.push(operation);
          return {
            id: `radar-event-${radarEvents.length}`,
            symbol: operation.data.symbol,
            assetType: operation.data.assetType,
            eventType: operation.data.eventType,
            severity: "WATCH",
            timeframe: "1d",
            shortMessage: operation.data.shortMessage,
            score: null,
            movePercent: null,
            relativeVolume: null,
            rangePercent: null,
            metadataJson: null,
            createdAt: new Date()
          };
        }
      },
      alert: {
        create: async (operation: { data: { payloadJson: unknown } }) => {
          alerts.push(operation);
          return { id: `alert-${alerts.length}` };
        },
        update: async () => ({})
      }
    }
  };
}

describe("resolveQuickEquityRadarSettings", () => {
  it("uses conservative disabled defaults", () => {
    const settings = resolveQuickEquityRadarSettings({});

    assert.equal(settings.enabled, false);
    assert.equal(settings.timeframe, "1d");
    assert.equal(settings.minMovePercent, 2);
    assert.equal(settings.minRelativeVolume, 1.8);
    assert.equal(settings.maxDataAgeHours, 96);
    assert.equal(settings.alertsEnabled, false);
    assert.equal(settings.alertCooldownMinutes, 240);
    assert.equal(settings.patternsEnabled, true);
  });
});

describe("quickEquityRadar", () => {
  it("skips work when disabled", async () => {
    process.env.EQUITY_RADAR_ENABLED = "false";
    const state = createDatabaseState([]);

    const summary = await quickEquityRadar(state.database as never);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.enabled, false);
    assert.equal(state.radarEvents.length, 0);
    assert.ok(state.botLogs.some((log) => log.data.message === "Equity Markt-Radar deaktiviert"));
  });

  it("persists metric and pattern events from database candles", async () => {
    process.env.EQUITY_RADAR_ENABLED = "true";
    const now = new Date("2026-07-06T12:00:00.000Z");
    const state = createDatabaseState(buildCandleSeries(new Date("2026-07-06T00:00:00.000Z")));

    const summary = await quickEquityRadar(state.database as never, { now });

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.checkedAssetCount, 1);
    assert.equal(summary.staleDataCount, 0);
    assert.ok(summary.patternObservationCount >= 1);
    assert.ok(summary.persistedRadarEventCount >= 2);
    const eventTypes = state.radarEvents.map((event) => event.data.eventType);
    assert.ok(eventTypes.includes("VOLUME_SPIKE"));
    assert.ok(eventTypes.includes("BREAKOUT_PROXIMITY"));
    for (const event of state.radarEvents) {
      assert.equal(event.data.assetType, "STOCK");
      assert.doesNotMatch(event.data.shortMessage, /kauf|verkauf|long|short|entry|exit/i);
    }
  });

  it("skips assets with stale candle data instead of evaluating them", async () => {
    process.env.EQUITY_RADAR_ENABLED = "true";
    const now = new Date("2026-07-06T12:00:00.000Z");
    // Letzter Datenstand 10 Tage alt → deutlich über maxDataAgeHours (96h)
    const state = createDatabaseState(buildCandleSeries(new Date("2026-06-26T00:00:00.000Z")));

    const summary = await quickEquityRadar(state.database as never, { now });

    assert.equal(summary.staleDataCount, 1);
    assert.equal(summary.checkedAssetCount, 0);
    assert.equal(state.radarEvents.length, 0);
    assert.ok(
      state.botLogs.some((log) => log.data.message === "Equity Markt-Radar Datenstand veraltet")
    );
  });
});
