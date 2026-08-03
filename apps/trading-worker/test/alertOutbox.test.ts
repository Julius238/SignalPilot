import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MAX_ATTEMPTS,
  backoffMsForAttempt,
  enqueueTradingAlert,
  sanitisePayload
} from "../src/lib/alertOutbox.js";
import { dispatchPendingAlerts, type AlertTransport } from "../src/lib/alertDispatcher.js";
import { collectTradingAlerts } from "../src/lib/alertCollector.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");

function seed() {
  const { database, tables } = createFakeExecutionDatabase();
  const portfolio = tables.get("portfolio")!.create({
    data: { key: "pf", name: "pf", status: "ACTIVE", ledgerSequence: 0 }
  });
  return { database, tables, portfolio };
}

const okTransport: AlertTransport = async () => ({ alertId: "alert-1", ok: true });
const failingTransport: AlertTransport = async () => ({ alertId: null, ok: false, error: "n8n unreachable" });
const throwingTransport: AlertTransport = async () => {
  throw new Error("socket hang up");
};

describe("sanitisePayload", () => {
  it("drops every key that looks like a secret", () => {
    const output = sanitisePayload({
      portfolioId: "pf-1",
      TELEGRAM_BOT_TOKEN: "abc",
      n8nWebhookUrl: "https://hooks.example/x",
      dbPassword: "hunter2",
      apiKey: "k",
      nested: { authorizationHeader: "Bearer x", assetId: "btc" }
    }) as Record<string, unknown>;

    assert.equal(output.portfolioId, "pf-1");
    assert.ok(!("TELEGRAM_BOT_TOKEN" in output));
    assert.ok(!("n8nWebhookUrl" in output));
    assert.ok(!("dbPassword" in output));
    assert.ok(!("apiKey" in output));
    const nested = output.nested as Record<string, unknown>;
    assert.equal(nested.assetId, "btc");
    assert.ok(!("authorizationHeader" in nested));
  });

  it("never lets a thrown Error carry its stack into a payload", () => {
    const output = sanitisePayload({ error: new Error("boom") }) as Record<string, unknown>;
    assert.equal(typeof output.error, "string");
    assert.ok(!String(output.error).includes("at "), "no stack frames survive");
  });

  it("bounds strings, arrays and depth", () => {
    const output = sanitisePayload({
      long: "x".repeat(1000),
      many: Array.from({ length: 100 }, (_value, index) => index),
      deep: { a: { b: { c: { d: { e: "too deep" } } } } }
    }) as Record<string, unknown>;

    assert.ok(String(output.long).length <= 513);
    assert.equal((output.many as unknown[]).length, 20);
    const deep = output.deep as Record<string, Record<string, Record<string, unknown>>>;
    assert.equal(deep.a.b.c, null);
  });
});

describe("enqueueTradingAlert", () => {
  it("records one entry and deduplicates the identical condition", async () => {
    const { database, tables, portfolio } = seed();

    const first = await enqueueTradingAlert(database as never, {
      eventType: "SESSION_ERROR_LOCKED",
      aggregateType: "TradingSession",
      aggregateId: "session-1",
      occurrence: "v3",
      reasonCode: "LEDGER_MISMATCH",
      portfolioId: portfolio.id,
      payload: { status: "ERROR_LOCKED" },
      asOf: ASOF
    });
    const second = await enqueueTradingAlert(database as never, {
      eventType: "SESSION_ERROR_LOCKED",
      aggregateType: "TradingSession",
      aggregateId: "session-1",
      occurrence: "v3",
      reasonCode: "LEDGER_MISMATCH",
      portfolioId: portfolio.id,
      payload: { status: "ERROR_LOCKED" },
      asOf: new Date(ASOF.getTime() + 60_000)
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.outboxId, second.outboxId);
    assert.equal(tables.get("tradingAlertOutbox")!.rows.length, 1);
  });

  it("treats a new occurrence of the same aggregate as a new alert", async () => {
    const { database, tables } = seed();
    const base = {
      eventType: "SESSION_ERROR_LOCKED" as const,
      aggregateType: "TradingSession",
      aggregateId: "session-1",
      reasonCode: "LEDGER_MISMATCH",
      payload: {},
      asOf: ASOF
    };

    await enqueueTradingAlert(database as never, { ...base, occurrence: "v3" });
    await enqueueTradingAlert(database as never, { ...base, occurrence: "v7" });

    assert.equal(tables.get("tradingAlertOutbox")!.rows.length, 2);
  });

  it("starts PENDING with a bounded attempt budget", async () => {
    const { database, tables } = seed();
    await enqueueTradingAlert(database as never, {
      eventType: "KILL_SWITCH_ENGAGED",
      aggregateType: "TradingSession",
      aggregateId: "s1",
      occurrence: "x",
      reasonCode: "MANUAL",
      payload: {},
      asOf: ASOF
    });

    const row = tables.get("tradingAlertOutbox")!.rows[0];
    assert.equal(row.status, "PENDING");
    assert.equal(row.attemptCount, 0);
    assert.equal(row.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  });
});

describe("dispatchPendingAlerts", () => {
  async function enqueueOne(database: unknown, overrides: Record<string, unknown> = {}) {
    return enqueueTradingAlert(database as never, {
      eventType: "CRITICAL_RISK_EVENT",
      aggregateType: "RiskEvent",
      aggregateId: "risk-1",
      occurrence: "key-1",
      reasonCode: "R_TEST",
      payload: {},
      asOf: ASOF,
      ...overrides
    });
  }

  it("marks a delivered alert SENT and logs the attempt", async () => {
    const { database, tables } = seed();
    await enqueueOne(database);

    const summary = await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-1",
      transport: okTransport
    });

    assert.deepEqual(summary, { claimed: 1, sent: 1, failed: 0, deadLettered: 0 });
    const row = tables.get("tradingAlertOutbox")!.rows[0];
    assert.equal(row.status, "SENT");
    assert.equal(row.alertId, "alert-1");
    assert.equal(row.attemptCount, 1);

    const attempts = tables.get("tradingAlertOutboxAttempt")!.rows;
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, "SENT");
    assert.equal(attempts[0].error, null);
  });

  it("retries a failure with a bounded backoff instead of looping", async () => {
    const { database, tables } = seed();
    await enqueueOne(database);

    const summary = await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-1",
      transport: failingTransport
    });

    assert.equal(summary.failed, 1);
    assert.equal(summary.deadLettered, 0);
    const row = tables.get("tradingAlertOutbox")!.rows[0];
    assert.equal(row.status, "FAILED");
    assert.equal(row.lastError, "n8n unreachable");
    assert.equal(
      (row.nextAttemptAt as Date).getTime(),
      ASOF.getTime() + backoffMsForAttempt(1),
      "the next attempt is scheduled, not immediate"
    );

    // Nothing is due yet, so a second dispatch at the same instant does nothing.
    const immediate = await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-1",
      transport: failingTransport
    });
    assert.equal(immediate.claimed, 0);
  });

  it("dead-letters after the attempt budget and never picks the entry up again", async () => {
    const { database, tables } = seed();
    await enqueueOne(database, { maxAttempts: 2 });

    let now = ASOF;
    for (let round = 0; round < 2; round += 1) {
      await dispatchPendingAlerts(database as never, {
        asOf: now,
        ownerId: "worker-1",
        transport: failingTransport
      });
      now = new Date(now.getTime() + 24 * 3_600_000);
    }

    const row = tables.get("tradingAlertOutbox")!.rows[0];
    assert.equal(row.status, "DEAD");
    assert.equal(row.attemptCount, 2);
    assert.ok(row.deadLetteredAt !== null);

    const afterDeath = await dispatchPendingAlerts(database as never, {
      asOf: new Date(now.getTime() + 365 * 24 * 3_600_000),
      ownerId: "worker-1",
      transport: okTransport
    });
    assert.equal(afterDeath.claimed, 0, "a DEAD entry is terminal");
    assert.equal(tables.get("tradingAlertOutbox")!.rows[0].status, "DEAD");
  });

  it("records a thrown transport error without leaking its stack, and does not throw", async () => {
    const { database, tables } = seed();
    await enqueueOne(database);

    const summary = await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-1",
      transport: throwingTransport
    });

    assert.equal(summary.failed, 1);
    const row = tables.get("tradingAlertOutbox")!.rows[0];
    assert.equal(row.lastError, "socket hang up");
    assert.ok(!String(row.lastError).includes("at "), "no stack frames are stored");
  });

  it("releases an expired claim so a crashed dispatcher cannot strand an alert", async () => {
    const { database, tables } = seed();
    await enqueueOne(database);
    const table = tables.get("tradingAlertOutbox")!;

    // Simulate a dispatcher that claimed the entry and then died.
    table.update({
      where: { id: table.rows[0].id },
      data: {
        status: "PROCESSING",
        claimedBy: "dead-worker",
        claimExpiresAt: new Date(ASOF.getTime() - 1_000)
      }
    });

    await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-2",
      transport: okTransport
    });

    // Released to FAILED with nextAttemptAt = now, then delivered on the next pass.
    const afterRelease = await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-2",
      transport: okTransport
    });
    assert.equal(afterRelease.sent, 1);
    assert.equal(table.rows[0].status, "SENT");
  });
});

describe("collectTradingAlerts", () => {
  it("derives alerts from persisted state and is idempotent across runs", async () => {
    const { database, tables, portfolio } = seed();

    tables.get("riskEvent")!.create({
      data: {
        eventKey: "risk-event-key-1",
        type: "PORTFOLIO_INCONSISTENCY",
        severity: "CRITICAL",
        reasonCode: "LEDGER_MISMATCH",
        portfolioId: portfolio.id,
        acknowledgedAt: null,
        createdAt: ASOF
      }
    });
    tables.get("tradingSession")!.create({
      data: {
        sessionKey: "s-1",
        portfolioId: portfolio.id,
        status: "ERROR_LOCKED",
        killSwitchEngaged: true,
        killedAt: ASOF,
        killReasonCode: "RECONCILE_FAILED",
        version: 4,
        createdAt: ASOF
      }
    });

    const first = await collectTradingAlerts(database as never, { asOf: ASOF });
    assert.ok(first.enqueued >= 3, "risk event, ERROR_LOCKED and kill switch each alert");
    assert.equal(first.deduplicated, 0);

    const second = await collectTradingAlerts(database as never, {
      asOf: new Date(ASOF.getTime() + 60_000)
    });
    assert.equal(second.enqueued, 0, "unchanged state enqueues nothing");
    assert.equal(second.deduplicated, first.inspected);
  });

  it("maps the daily loss limit to its own event type", async () => {
    const { database, tables, portfolio } = seed();
    tables.get("riskEvent")!.create({
      data: {
        eventKey: "risk-daily-loss",
        type: "DAILY_LOSS_LIMIT",
        severity: "CRITICAL",
        reasonCode: "R_DAILY_LOSS",
        portfolioId: portfolio.id,
        acknowledgedAt: null,
        createdAt: ASOF
      }
    });

    const summary = await collectTradingAlerts(database as never, { asOf: ASOF });
    assert.equal(summary.byEventType.DAILY_LOSS_LIMIT_REACHED, 1);
  });

  it("alerts on an open position without an active exit plan", async () => {
    const { database, tables, portfolio } = seed();
    tables.get("shadowPosition")!.create({
      data: {
        positionKey: "pos-1",
        portfolioId: portfolio.id,
        assetId: "asset-1",
        status: "OPEN",
        activeExitPlanVersion: null,
        openQuantity: "1",
        version: 2,
        openedAt: ASOF
      }
    });

    const summary = await collectTradingAlerts(database as never, { asOf: ASOF });
    assert.equal(summary.byEventType.POSITION_WITHOUT_SAFE_EXIT, 1);
  });

  it("never acknowledges, closes or otherwise mutates the source rows", async () => {
    const { database, tables, portfolio } = seed();
    const riskEvent = tables.get("riskEvent")!.create({
      data: {
        eventKey: "risk-untouched",
        type: "SIMULATION_ERROR",
        severity: "CRITICAL",
        reasonCode: "SIM_FAIL",
        portfolioId: portfolio.id,
        acknowledgedAt: null,
        createdAt: ASOF
      }
    });
    const before = JSON.stringify(riskEvent);

    await collectTradingAlerts(database as never, { asOf: ASOF });

    assert.equal(JSON.stringify(tables.get("riskEvent")!.rows[0]), before);
  });
});

describe("alert delivery never blocks trading", () => {
  it("keeps the job successful-by-contract and touches no trading table when delivery throws", async () => {
    const { database, tables, portfolio } = seed();

    // A position that is being monitored, and a critical risk event that will
    // produce an alert whose delivery then fails hard.
    const position = tables.get("shadowPosition")!.create({
      data: {
        positionKey: "pos-live",
        portfolioId: portfolio.id,
        assetId: "asset-1",
        status: "OPEN",
        activeExitPlanVersion: 1,
        openQuantity: "1",
        version: 1,
        openedAt: ASOF
      }
    });
    tables.get("riskEvent")!.create({
      data: {
        eventKey: "risk-blocking",
        type: "SIMULATION_ERROR",
        severity: "CRITICAL",
        reasonCode: "SIM_FAIL",
        portfolioId: portfolio.id,
        acknowledgedAt: null,
        createdAt: ASOF
      }
    });

    const watched = ["shadowPosition", "shadowOrder", "shadowFill", "riskEvent", "portfolio"] as const;
    const before = new Map(watched.map((name) => [name, JSON.stringify(tables.get(name)!.rows)] as const));

    await collectTradingAlerts(database as never, { asOf: ASOF });
    // The transport throws on every entry; the dispatcher must absorb it.
    const summary = await dispatchPendingAlerts(database as never, {
      asOf: ASOF,
      ownerId: "worker-1",
      transport: throwingTransport
    });

    assert.ok(summary.failed > 0, "the failure is recorded");
    for (const [name, snapshot] of before) {
      assert.equal(
        JSON.stringify(tables.get(name)!.rows),
        snapshot,
        `${name} must be untouched by an alerting failure`
      );
    }
    // The position is still open and still monitorable — alerting changed nothing.
    assert.equal(tables.get("shadowPosition")!.rows[0].status, "OPEN");
    assert.equal(tables.get("shadowPosition")!.rows[0].id, position.id);
  });
});
