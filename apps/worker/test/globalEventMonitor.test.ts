import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";
import type { FinnhubGeneralNewsFetchResult, NormalizedGeneralNewsItem } from "@signalpilot/market-data";

import {
  globalEventMonitor,
  resolveGlobalEventMonitorSettings
} from "../src/jobs/globalEventMonitor.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function newsItem(overrides: Partial<NormalizedGeneralNewsItem> = {}): NormalizedGeneralNewsItem {
  return {
    externalId: "9001",
    source: "Reuters",
    headline: "Fed signals possible rate cut after inflation report",
    summary: "Federal Reserve officials discussed easing policy.",
    url: "https://news.example/fed",
    publishedAt: new Date("2026-07-06T08:00:00.000Z"),
    category: "general",
    rawJson: {},
    ...overrides
  };
}

function createAdapter(result: FinnhubGeneralNewsFetchResult, options: { apiKey?: boolean } = {}) {
  const calls: string[] = [];

  return {
    calls,
    adapter: {
      assertApiKey: () => {
        if (options.apiKey === false) {
          throw new Error("FINNHUB_API_KEY environment variable is not set.");
        }
      },
      fetchGeneralNews: async (category = "general") => {
        calls.push(category);
        return result;
      }
    }
  };
}

function createDatabaseState(existingDedupKeys: string[] = [], recentAlertEventTypes: string[] = []) {
  const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
  const botLogs: Array<{ data: { message: string; level: string } }> = [];
  const marketEvents: Array<{ data: Record<string, unknown> }> = [];
  const marketEventUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const alerts: Array<{ data: { payloadJson: unknown } }> = [];

  return {
    botRunUpdates,
    botLogs,
    marketEvents,
    marketEventUpdates,
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
        create: async (operation: { data: { message: string; level: string } }) => {
          botLogs.push(operation);
        }
      },
      marketEvent: {
        findUnique: async (operation: { where: { dedupKey: string } }) =>
          existingDedupKeys.includes(operation.where.dedupKey) ? { id: "existing-1" } : null,
        findFirst: async (operation: { where: { eventType: string } }) =>
          recentAlertEventTypes.includes(operation.where.eventType) ? { id: "recent-1" } : null,
        create: async (operation: { data: Record<string, unknown> }) => {
          marketEvents.push(operation);
          return {
            id: `market-event-${marketEvents.length}`,
            dedupKey: operation.data.dedupKey,
            eventType: operation.data.eventType,
            severity: operation.data.severity,
            confidence: operation.data.confidence,
            title: operation.data.title,
            summary: operation.data.summary ?? null,
            region: operation.data.region ?? null,
            source: operation.data.source,
            sourceUrl: operation.data.sourceUrl ?? null,
            publishedAt: operation.data.publishedAt ?? null,
            detectedAt: new Date("2026-07-06T08:05:00.000Z"),
            reasoning: operation.data.reasoning ?? null,
            affectedAssetClasses: operation.data.affectedAssetClasses ?? [],
            affectedSectors: operation.data.affectedSectors ?? [],
            affectedSymbols: operation.data.affectedSymbols ?? [],
            positiveImpact: operation.data.positiveImpact ?? [],
            negativeImpact: operation.data.negativeImpact ?? []
          };
        },
        update: async (operation: { where: { id: string }; data: Record<string, unknown> }) => {
          marketEventUpdates.push(operation);
          return { id: operation.where.id };
        }
      },
      marketRegimeSnapshot: {
        findFirst: async () => ({ riskMode: "NORMAL" })
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

describe("resolveGlobalEventMonitorSettings", () => {
  it("uses conservative disabled defaults", () => {
    const settings = resolveGlobalEventMonitorSettings({});

    assert.equal(settings.enabled, false);
    assert.deepEqual(settings.categories, ["general"]);
    assert.equal(settings.maxEventsPerRun, 25);
    assert.equal(settings.alertsEnabled, false);
    assert.equal(settings.minAlertSeverity, "IMPORTANT");
    assert.equal(settings.alertCooldownMinutes, 120);
    assert.equal(settings.maxAlertsPerRun, 3);
  });

  it("parses categories and rejects unsupported values", () => {
    const settings = resolveGlobalEventMonitorSettings({
      GLOBAL_EVENT_MONITOR_ENABLED: "true",
      GLOBAL_EVENT_MONITOR_CATEGORIES: "general, crypto, invalid",
      MIN_EVENT_ALERT_SEVERITY: "WATCH"
    });

    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.categories, ["general", "crypto"]);
    assert.equal(settings.minAlertSeverity, "WATCH");
  });
});

describe("globalEventMonitor", () => {
  it("skips work when disabled and records the run", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "false";
    const state = createDatabaseState();
    const { adapter, calls } = createAdapter({ kind: "no_news" });

    const summary = await globalEventMonitor(state.database as never, adapter as never);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.enabled, false);
    assert.equal(calls.length, 0);
    assert.equal(state.marketEvents.length, 0);
    assert.ok(state.botLogs.some((log) => log.data.message === "Global Event Monitor deaktiviert"));
  });

  it("persists classified events and skips duplicates and noise", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "true";
    const { adapter } = createAdapter({
      kind: "ok",
      items: [
        newsItem({ externalId: "9001" }),
        newsItem({
          externalId: "9002",
          headline: "Oil surges as OPEC announces surprise production cut",
          summary: "Crude prices jumped sharply."
        }),
        newsItem({
          externalId: "9003",
          headline: "Local sports team wins championship",
          summary: "Fans celebrate."
        })
      ]
    });
    const state = createDatabaseState(["finnhub-general:9001"]);

    const summary = await globalEventMonitor(state.database as never, adapter as never);

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.fetchedNewsCount, 3);
    assert.equal(summary.classifiedCandidateCount, 2);
    assert.equal(summary.duplicateEventCount, 1);
    assert.equal(summary.newEventCount, 1);
    assert.equal(state.marketEvents.length, 1);
    assert.equal(state.marketEvents[0].data.eventType, "ENERGY_COMMODITY");
    assert.ok(
      state.botLogs.some((log) => log.data.message === "Global Event Monitor Ereignis erkannt")
    );
  });

  it("sends alerts only for severities at or above the minimum", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "true";
    process.env.GLOBAL_EVENT_ALERTS_ENABLED = "true";
    process.env.MIN_EVENT_ALERT_SEVERITY = "IMPORTANT";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";

    const { adapter } = createAdapter({
      kind: "ok",
      items: [
        // IMPORTANT+: Konflikt mit Dringlichkeits-Keywords
        newsItem({
          externalId: "9101",
          headline: "Breaking: invasion escalates as missile attack hits major port",
          summary: "Military escalation raises fears of wider war."
        }),
        // INFO: einzelner schwacher Treffer
        newsItem({
          externalId: "9102",
          headline: "Analysts discuss inflation outlook for next year",
          summary: null
        })
      ]
    });
    const state = createDatabaseState();
    const payloads: unknown[] = [];

    const summary = await globalEventMonitor(state.database as never, adapter as never, {
      fetchClient: (async (_url: string, init?: RequestInit) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }) as never
    });

    assert.equal(summary.newEventCount, 2);
    assert.equal(summary.sentAlertCount, 1);
    assert.equal(summary.skippedAlertCount, 1);
    assert.equal(payloads.length, 1);

    const payload = payloads[0] as {
      type: string;
      alertType: string;
      severity: string;
      telegramText: string;
    };
    assert.equal(payload.type, "market_event");
    assert.equal(payload.alertType, "geopolitical_event");
    assert.equal(payload.severity, "CRITICAL");
    assert.match(payload.telegramText, /Keine Handlungsempfehlung/);
    // alertSentAt wurde gesetzt
    assert.equal(state.marketEventUpdates.length, 1);
    assert.ok(state.marketEventUpdates[0].data.alertSentAt instanceof Date);
  });

  it("stores impact assessments and includes them in the alert payload", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "true";
    process.env.GLOBAL_EVENT_ALERTS_ENABLED = "true";
    process.env.MIN_EVENT_ALERT_SEVERITY = "IMPORTANT";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";

    const { adapter } = createAdapter({
      kind: "ok",
      items: [
        newsItem({
          externalId: "9301",
          headline: "Breaking: oil surges as war escalates after attack on tankers",
          summary: "Crude jumps on supply disruption fears; military escalation deepens crisis."
        })
      ]
    });
    const state = createDatabaseState();
    const payloads: unknown[] = [];

    const summary = await globalEventMonitor(state.database as never, adapter as never, {
      fetchClient: (async (_url: string, init?: RequestInit) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }) as never
    });

    assert.equal(summary.newEventCount, 1);
    assert.equal(summary.impactAssessedCount, 1);
    assert.equal(summary.sentAlertCount, 1);

    // Impact-Listen wurden persistiert
    const stored = state.marketEvents[0].data;
    assert.ok(Array.isArray(stored.positiveImpact) && (stored.positiveImpact as string[]).length > 0);
    assert.ok(Array.isArray(stored.negativeImpact) && (stored.negativeImpact as string[]).length > 0);
    assert.match(String(stored.reasoning), /Regelbasierte Impact-Zuordnung/);

    // ... und stehen im Telegram-Payload
    const payload = payloads[0] as {
      potentiallyPositive: string[];
      potentiallyNegative: string[];
      telegramText: string;
    };
    assert.ok(payload.potentiallyPositive.length > 0);
    assert.ok(payload.potentiallyNegative.length > 0);
    assert.match(payload.telegramText, /Potenziell positiv:/);
    assert.match(payload.telegramText, /Potenziell negativ:/);
    assert.match(payload.telegramText, /Keine Handlungsempfehlung/);
  });

  it("suppresses alerts during the per-eventType cooldown", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "true";
    process.env.GLOBAL_EVENT_ALERTS_ENABLED = "true";
    process.env.MIN_EVENT_ALERT_SEVERITY = "IMPORTANT";
    process.env.N8N_WEBHOOK_SIGNAL_URL = "https://n8n.example.test/webhook";

    const { adapter } = createAdapter({
      kind: "ok",
      items: [
        newsItem({
          externalId: "9201",
          headline: "Breaking: invasion escalates as missile attack hits major port",
          summary: "Military escalation raises fears of wider war."
        })
      ]
    });
    const state = createDatabaseState([], ["CONFLICT"]);
    let fetchCalls = 0;

    const summary = await globalEventMonitor(state.database as never, adapter as never, {
      fetchClient: (async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      }) as never
    });

    assert.equal(summary.newEventCount, 1);
    assert.equal(summary.sentAlertCount, 0);
    assert.equal(summary.skippedAlertCount, 1);
    assert.equal(fetchCalls, 0);
    assert.ok(
      state.botLogs.some(
        (log) => log.data.message === "Global Event Monitor Alert im Cooldown übersprungen"
      )
    );
  });

  it("marks the summary and BotRun failed when the provider is rate limited", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "true";
    const { adapter } = createAdapter({ kind: "rate_limit" });
    const state = createDatabaseState();

    const summary = await globalEventMonitor(state.database as never, adapter as never);

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.rateLimited, true);
    assert.equal(summary.newEventCount, 0);
  });

  it("fails loudly when the API key is missing", async () => {
    process.env.GLOBAL_EVENT_MONITOR_ENABLED = "true";
    const { adapter } = createAdapter({ kind: "no_news" }, { apiKey: false });
    const state = createDatabaseState();

    await assert.rejects(
      () => globalEventMonitor(state.database as never, adapter as never),
      /FINNHUB_API_KEY/
    );
    assert.equal(state.botRunUpdates.at(-1)?.data.status, BotRunStatus.FAILED);
    assert.ok(
      state.botLogs.some((log) => log.data.message === "Global Event Monitor fehlgeschlagen")
    );
  });
});
