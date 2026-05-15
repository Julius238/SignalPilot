import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AlertStatus } from "@signalpilot/database";

import { sendSignalAlertToN8n } from "../src/index.js";

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
        ok: true
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
