import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AlertStatus, BotRunStatus } from "@signalpilot/database";

import { radarSummary, resolveRadarSummarySettings } from "../src/jobs/radarSummary.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("radarSummary", () => {
  it("uses disabled defaults", () => {
    const settings = resolveRadarSummarySettings({});

    assert.equal(settings.enabled, false);
    assert.equal(settings.minEventCount, 1);
    assert.equal(settings.webhookEnabled, false);
  });

  it("does not send a message when disabled", async () => {
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    const state = createDatabaseState({ events: [createRadarEvent()] });
    let fetchCallCount = 0;

    const summary = await radarSummary(state.database as never, {
      fetchClient: async () => {
        fetchCallCount += 1;
        return new Response(null, { status: 200 });
      }
    });

    assert.equal(summary.enabled, false);
    assert.equal(summary.webhookSent, false);
    assert.equal(summary.skippedReason, "RADAR_SUMMARY_DISABLED");
    assert.equal(fetchCallCount, 0);
    assert.equal(state.alerts.length, 0);
  });

  it("does not send when the minimum event count is not reached", async () => {
    process.env.RADAR_SUMMARY_ENABLED = "true";
    process.env.RADAR_SUMMARY_WEBHOOK_ENABLED = "true";
    process.env.RADAR_SUMMARY_MIN_EVENT_COUNT = "2";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    const state = createDatabaseState({ events: [createRadarEvent()] });

    const summary = await radarSummary(state.database as never);

    assert.equal(summary.radarEventCount, 1);
    assert.equal(summary.webhookSent, false);
    assert.equal(summary.skippedReason, "MIN_EVENT_COUNT_NOT_REACHED");
    assert.equal(state.alerts.length, 0);
  });

  it("sends a compact radar summary through n8n when enabled", async () => {
    process.env.RADAR_SUMMARY_ENABLED = "true";
    process.env.RADAR_SUMMARY_WEBHOOK_ENABLED = "true";
    process.env.RADAR_SUMMARY_MIN_EVENT_COUNT = "1";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";
    const state = createDatabaseState({
      events: [
        createRadarEvent({ eventType: "MOVEMENT_SPIKE", symbol: "BTCUSDT", movePercent: 4.2 }),
        createRadarEvent({ eventType: "VOLUME_SPIKE", symbol: "ETHUSDT", relativeVolume: 2.8 }),
        createRadarEvent({ eventType: "VOLATILITY_SPIKE", symbol: "SOLUSDT", rangePercent: 5.1 })
      ]
    });
    const payloads: unknown[] = [];

    const summary = await radarSummary(state.database as never, {
      fetchClient: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }
    });

    assert.equal(summary.webhookSent, true);
    assert.equal(summary.checkedAssetCount, 8);
    assert.equal(summary.notableAssetCount, 3);
    assert.equal(state.alerts.length, 1);
    assert.equal(payloads.length, 1);
    assert.equal((payloads[0] as { type: string }).type, "radar_summary");
    assert.match(summary.summaryText, /Keine Handlungsempfehlung/);
  });
});

function createDatabaseState({ events }: { events: ReturnType<typeof createRadarEvent>[] }) {
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
  const botLogs: Array<{ data: { message: string; metadataJson?: unknown } }> = [];
  const alerts: Array<{ data: { payloadJson: unknown } }> = [];

  return {
    botRunUpdates,
    botLogs,
    alerts,
    database: {
      botRun: {
        create: async () => ({ id: "bot-run-radar-summary" }),
        update: async (operation: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
          botRunUpdates.push(operation);
          return { id: "bot-run-radar-summary", ...operation.data };
        },
        findFirst: async (operation: { where?: { jobName?: string } }) => {
          if (operation.where?.jobName === "quickCryptoRadar") {
            return {
              id: "bot-run-quick-radar",
              jobName: "quickCryptoRadar",
              status: BotRunStatus.SUCCESS,
              startedAt: new Date("2026-01-01T00:30:00.000Z"),
              metadataJson: { checkedAssetCount: 8 }
            };
          }

          return null;
        }
      },
      radarEvent: {
        findMany: async () => events
      },
      marketRegimeSnapshot: {
        findFirst: async () => ({
          generatedAt: new Date("2026-01-01T00:00:00.000Z"),
          overallRegime: "MIXED",
          cryptoRegime: "NEUTRAL",
          riskMode: "NORMAL",
          confidence: 0.62,
          summary: "Gemischtes Marktumfeld.",
          riskNote: "Kontext beachten."
        })
      },
      alert: {
        create: async (operation: { data: { payloadJson: unknown } }) => {
          alerts.push(operation);
          return { id: `alert-${alerts.length}` };
        },
        update: async () => ({ status: AlertStatus.SENT })
      },
      botLog: {
        create: async (operation: { data: { message: string; metadataJson?: unknown } }) => {
          botLogs.push(operation);
        }
      }
    }
  };
}

function createRadarEvent(overrides: Partial<{
  symbol: string;
  eventType: string;
  severity: string;
  timeframe: string;
  movePercent: number | null;
  relativeVolume: number | null;
  rangePercent: number | null;
  shortMessage: string;
  createdAt: Date;
}> = {}) {
  return {
    symbol: "BTCUSDT",
    eventType: "MOVEMENT_SPIKE",
    severity: "IMPORTANT",
    timeframe: "1h",
    movePercent: 3.1,
    relativeVolume: null,
    rangePercent: null,
    shortMessage: "BTCUSDT: auffällige Bewegung im Markt-Radar.",
    createdAt: new Date("2026-01-01T00:45:00.000Z"),
    ...overrides
  };
}
