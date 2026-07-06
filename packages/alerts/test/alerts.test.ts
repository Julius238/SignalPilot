import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AlertStatus } from "@signalpilot/database";

import {
  buildMarketEventAlertPayload,
  buildRadarEventPayload,
  researchAlertDisclaimer,
  sendMarketEventAlertToN8n,
  sendSignalAlertToN8n
} from "../src/index.js";

describe("sendSignalAlertToN8n", () => {
  it("stores a failed alert and bot log when webhook URL is missing", async () => {
    const database = createFakeDatabase();

    const result = await sendSignalAlertToN8n(createInput(), {
      database: database as never,
      webhookUrl: "",
      retryDelayMs: 0
    });

    assert.equal(result.status, AlertStatus.FAILED);
    assert.equal(result.error, "missing N8N_WEBHOOK_SIGNAL_URL");
    assert.equal(database.alertCreates.length, 1);
    assert.equal(database.alertUpdates[0].data.status, AlertStatus.FAILED);
    assert.equal(database.alertUpdates[0].data.error, "missing N8N_WEBHOOK_SIGNAL_URL");
    assert.equal(database.botLogCreates[0].data.level, "error");
  });

  it("posts payload to n8n and marks alert sent", async () => {
    const database = createFakeDatabase();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchClient = async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        init
      });

      return new Response("ok", {
        status: 200
      });
    };

    const result = await sendSignalAlertToN8n(createInput(), {
      database: database as never,
      fetchClient: fetchClient as never,
      webhookUrl: "https://n8n.example/webhook/signal",
      retryDelayMs: 0
    });

    assert.equal(result.status, AlertStatus.SENT);
    assert.equal(result.attempts, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://n8n.example/webhook/signal");
    assert.equal(requests[0].init?.method, "POST");
    assert.deepEqual(requests[0].init?.headers, {
      "Content-Type": "application/json"
    });

    const payload = JSON.parse(String(requests[0].init?.body));
    assert.equal(payload.signalId, "signal-1");
    assert.equal(payload.telegramText, "Telegram text");
    assert.equal(payload.alignment, "BULLISH_ALIGNED");
    assert.equal(payload.alignmentScore, 78);
    assert.deepEqual(payload.multiTimeframeSummary, {
      alignment: "BULLISH_ALIGNED",
      alignmentScore: 78,
      nextFocus: "Als naechstes 4h beobachten."
    });
    assert.equal(payload.dashboardUrl, "https://dashboard.example/signals/signal-1");
    assert.equal(database.alertUpdates[0].data.status, AlertStatus.SENT);
    assert.ok(database.alertUpdates[0].data.sentAt instanceof Date);
    assert.equal(database.botLogCreates[0].data.level, "info");
  });

  it("retries HTTP errors and marks alert failed after max attempts", async () => {
    const database = createFakeDatabase();
    let attempts = 0;
    const fetchClient = async () => {
      attempts += 1;

      return new Response("fail", {
        status: 500
      });
    };

    const result = await sendSignalAlertToN8n(createInput(), {
      database: database as never,
      fetchClient: fetchClient as never,
      webhookUrl: "https://n8n.example/webhook/signal",
      retryDelayMs: 0
    });

    assert.equal(attempts, 3);
    assert.equal(result.status, AlertStatus.FAILED);
    assert.match(result.error ?? "", /HTTP 500/);
    assert.equal(database.alertUpdates[0].data.status, AlertStatus.FAILED);
    assert.match(database.alertUpdates[0].data.error, /HTTP 500/);
    assert.equal(database.botLogCreates[0].data.level, "error");
  });
});

describe("sendMarketEventAlertToN8n", () => {
  it("posts the market event payload and marks the alert sent", async () => {
    const database = createFakeDatabase();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchClient = async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response("ok", { status: 200 });
    };

    const result = await sendMarketEventAlertToN8n(
      {
        marketEvent: {
          id: "event-1",
          alertType: "macro_event",
          severity: "IMPORTANT",
          title: "US-Inflationsdaten über Erwartung",
          summary: "CPI stieg stärker als erwartet.",
          confidence: 0.5,
          sourceName: "Finnhub Market News"
        },
        dashboardUrl: "https://dashboard.example/dashboard"
      },
      {
        database: database as never,
        fetchClient: fetchClient as never,
        webhookUrl: "https://n8n.example/webhook/signal",
        retryDelayMs: 0
      }
    );

    assert.equal(result.status, AlertStatus.SENT);
    assert.equal(requests.length, 1);

    const payload = JSON.parse(String(requests[0].init?.body));
    assert.equal(payload.type, "market_event");
    assert.equal(payload.marketEventId, "event-1");
    assert.equal(payload.alertType, "macro_event");
    assert.match(payload.telegramText, /Keine Handlungsempfehlung/);
    assert.equal(database.alertUpdates[0].data.status, AlertStatus.SENT);
    assert.equal(database.botLogCreates[0].data.level, "info");
  });

  it("stores a failed alert when the webhook URL is missing", async () => {
    const database = createFakeDatabase();

    const result = await sendMarketEventAlertToN8n(
      {
        marketEvent: {
          id: "event-2",
          alertType: "geopolitical_event",
          severity: "CRITICAL",
          title: "Eskalation",
          summary: "Test."
        }
      },
      {
        database: database as never,
        webhookUrl: "",
        retryDelayMs: 0
      }
    );

    assert.equal(result.status, AlertStatus.FAILED);
    assert.equal(result.error, "missing N8N_WEBHOOK_SIGNAL_URL");
    assert.equal(database.alertUpdates[0].data.status, AlertStatus.FAILED);
  });
});

describe("buildRadarEventPayload", () => {
  it("builds an enriched research payload without trading language", () => {
    const payload = buildRadarEventPayload({
      radarEvent: {
        id: "radar-1",
        symbol: "BTCUSDT",
        assetType: "CRYPTO",
        eventType: "MOVEMENT_SPIKE",
        severity: "IMPORTANT",
        timeframe: "1h",
        shortMessage: "BTCUSDT: auffällige Bewegung von 3.4% im 1h Markt-Radar.",
        score: 70,
        movePercent: 3.4,
        relativeVolume: 2.5,
        rangePercent: 4.1,
        createdAt: new Date("2026-07-01T10:00:00.000Z")
      },
      dashboardUrl: "https://dashboard.example/dashboard"
    });

    assert.equal(payload.type, "radar_event");
    assert.equal(payload.alertType, "crypto_radar");
    assert.equal(payload.title, "BTCUSDT · Auffällige Bewegung (1h)");
    assert.equal(payload.whatHappened, payload.shortMessage);
    assert.match(payload.whyRelevant, /Bewegung \+3\.4%/);
    assert.match(payload.whyRelevant, /Volumen 2\.5x/);
    assert.equal(payload.confidence, 0.7);
    assert.equal(payload.sourceName, "SignalPilot Quick Radar (Binance Marktdaten)");
    assert.deepEqual(payload.potentiallyPositive, []);
    assert.deepEqual(payload.potentiallyNegative, []);
    assert.equal(payload.disclaimer, researchAlertDisclaimer);
    assert.match(payload.telegramText, /Priorität: Wichtig/);
    assert.match(payload.telegramText, /Confidence: 70%/);
    assert.match(payload.telegramText, /Keine Handlungsempfehlung/);
    assert.match(payload.telegramText, /Dashboard: https:\/\/dashboard\.example\/dashboard/);
    assert.doesNotMatch(payload.telegramText, /kauf|verkauf|long|short|entry|exit/i);
    // Bestehende n8n-Felder bleiben erhalten
    assert.equal(payload.context.wording, "Beobachtung, keine Handlungsempfehlung");
    assert.equal(payload.context.movePercent, 3.4);
  });

  it("maps equity asset types to the equity radar alert type", () => {
    const payload = buildRadarEventPayload({
      radarEvent: {
        id: "radar-2",
        symbol: "AAPL",
        assetType: "STOCK",
        eventType: "VOLUME_SPIKE",
        severity: "WATCH",
        timeframe: "1d",
        shortMessage: "AAPL: Volumenanstieg auf 3x im 1d Markt-Radar.",
        score: null,
        relativeVolume: 3,
        createdAt: "2026-07-01T10:00:00.000Z"
      }
    });

    assert.equal(payload.alertType, "equity_radar");
    assert.equal(payload.confidence, null);
    assert.equal(payload.sourceName, "SignalPilot Quick Radar (Finnhub Marktdaten)");
    assert.doesNotMatch(payload.telegramText, /Confidence:/);
    assert.doesNotMatch(payload.telegramText, /Dashboard:/);
  });
});

describe("buildMarketEventAlertPayload", () => {
  it("builds the market event payload with impact lists and disclaimer", () => {
    const payload = buildMarketEventAlertPayload(
      {
        id: "event-1",
        alertType: "geopolitical_event",
        severity: "CRITICAL",
        title: "Eskalation im Nahen Osten",
        summary: "Neue Sanktionen gegen Öl-Exporte angekündigt.",
        reasoning: "Öl-Angebot könnte kurzfristig sinken, Energiepreise könnten steigen.",
        region: "Naher Osten",
        affectedAssetClasses: ["Rohstoffe", "Aktien"],
        affectedSectors: ["Energie", "Airlines"],
        affectedSymbols: ["XOM", "USO"],
        positiveImpact: ["Energieaktien", "Öl-Produzenten", "Gold"],
        negativeImpact: ["Airlines", "Logistik"],
        confidence: 0.6,
        timeframe: "kurzfristig",
        sourceName: "Finnhub Market News",
        sourceUrl: "https://news.example/article",
        publishedAt: new Date("2026-07-01T08:00:00.000Z"),
        detectedAt: "2026-07-01T08:15:00.000Z"
      },
      "https://dashboard.example/dashboard"
    );

    assert.equal(payload.type, "market_event");
    assert.equal(payload.alertType, "geopolitical_event");
    assert.equal(payload.severity, "CRITICAL");
    assert.deepEqual(payload.potentiallyPositive, ["Energieaktien", "Öl-Produzenten", "Gold"]);
    assert.deepEqual(payload.potentiallyNegative, ["Airlines", "Logistik"]);
    assert.equal(payload.confidence, 0.6);
    assert.equal(payload.publishedAt, "2026-07-01T08:00:00.000Z");
    assert.equal(payload.detectedAt, "2026-07-01T08:15:00.000Z");
    assert.match(payload.telegramText, /Priorität: Hochrelevant · Region: Naher Osten/);
    assert.match(payload.telegramText, /Potenziell positiv: Energieaktien, Öl-Produzenten, Gold/);
    assert.match(payload.telegramText, /Potenziell negativ: Airlines, Logistik/);
    assert.match(payload.telegramText, /Quelle: Finnhub Market News \(https:\/\/news\.example\/article\)/);
    assert.match(payload.telegramText, /Keine Handlungsempfehlung/);
    assert.equal(payload.disclaimer, researchAlertDisclaimer);
  });

  it("omits empty sections and clamps confidence", () => {
    const payload = buildMarketEventAlertPayload({
      id: "event-2",
      alertType: "macro_event",
      severity: "WATCH",
      title: "US-Inflationsdaten",
      summary: "CPI-Daten leicht über Erwartung.",
      confidence: 1.7
    });

    assert.equal(payload.confidence, 1);
    assert.equal(payload.whyRelevant, null);
    assert.equal(payload.region, null);
    assert.deepEqual(payload.affectedAssetClasses, []);
    assert.doesNotMatch(payload.telegramText, /Potenziell positiv/);
    assert.doesNotMatch(payload.telegramText, /Region:/);
    assert.doesNotMatch(payload.telegramText, /Quelle:/);
  });
});

function createInput() {
  return {
    signal: {
      id: "signal-1",
      symbol: "BTCUSDT",
      asset: {
        assetType: "CRYPTO"
      },
      timeframe: "4h",
      status: "WATCH",
      direction: "BULLISH",
      signalType: "MOMENTUM_ALERT",
      score: 72.4,
      riskLevel: "MEDIUM",
      createdAt: new Date("2026-05-15T10:00:00.000Z")
    },
    signalOutput: {
      shortConclusion: "BTCUSDT is watchable.",
      telegramText: "Telegram text",
      dashboardJson: {
        ok: true,
        multiTimeframeSummary: {
          alignment: "BULLISH_ALIGNED",
          alignmentScore: 78,
          nextFocus: "Als naechstes 4h beobachten."
        }
      }
    },
    dashboardUrl: "https://dashboard.example/signals/signal-1"
  };
}

function createFakeDatabase() {
  const alertCreates: unknown[] = [];
  const alertUpdates: Array<{ data: { status: AlertStatus; error?: string; sentAt?: Date } }> = [];
  const botLogCreates: Array<{ data: { level: string } }> = [];

  return {
    alertCreates,
    alertUpdates,
    botLogCreates,
    alert: {
      create: async (operation: unknown) => {
        alertCreates.push(operation);

        return {
          id: "alert-1"
        };
      },
      update: async (operation: { data: { status: AlertStatus; error?: string; sentAt?: Date } }) => {
        alertUpdates.push(operation);

        return {
          id: "alert-1"
        };
      }
    },
    botLog: {
      create: async (operation: { data: { level: string } }) => {
        botLogCreates.push(operation);

        return {
          id: "bot-log-1"
        };
      }
    }
  };
}
