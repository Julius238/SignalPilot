import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RetentionTarget, runTradingRetention } from "../src/lib/tradingRetention.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
const RECENT = new Date("2026-08-09T00:00:00.000Z");

/**
 * Seeds one old row in every business table retention must never touch, plus
 * old technical rows it may. The business rows are the actual assertion: after
 * an applied run, every one of them must still be there.
 */
function seed() {
  const { database, tables } = createFakeExecutionDatabase();

  const portfolio = tables.get("portfolio")!.create({ data: { key: "pf", name: "pf", status: "ACTIVE" } });

  // ── Business data, all old enough to be caught by any cutoff ────────────
  tables.get("tradeCandidate")!.create({ data: { candidateKey: "c1", createdAt: LONG_AGO, decisionTime: LONG_AGO } });
  tables.get("tradeDecision")!.create({ data: { decisionKey: "d1", createdAt: LONG_AGO } });
  tables.get("riskAssessment")!.create({ data: { assessmentKey: "a1", createdAt: LONG_AGO, assessedAt: LONG_AGO } });
  tables.get("riskEvent")!.create({ data: { eventKey: "re1", createdAt: LONG_AGO, severity: "CRITICAL" } });
  tables.get("shadowOrder")!.create({ data: { orderKey: "o1", createdAt: LONG_AGO } });
  tables.get("shadowFill")!.create({ data: { fillKey: "f1", createdAt: LONG_AGO, occurredAt: LONG_AGO } });
  tables.get("shadowPosition")!.create({ data: { positionKey: "p1", createdAt: LONG_AGO } });
  tables.get("shadowPositionEvent")!.create({ data: { eventKey: "pe1", createdAt: LONG_AGO } });
  tables.get("portfolioLedgerEntry")!.create({ data: { entryKey: "l1", createdAt: LONG_AGO, occurredAt: LONG_AGO } });
  tables.get("portfolioSnapshot")!.create({ data: { portfolioId: portfolio.id, createdAt: LONG_AGO, asOf: LONG_AGO } });
  tables.get("strategyPerformance")!.create({ data: { snapshotKey: "sp1", createdAt: LONG_AGO, asOf: LONG_AGO } });
  tables.get("tradingAuditEvent")!.create({ data: { eventKey: "ae1", createdAt: LONG_AGO, occurredAt: LONG_AGO } });
  tables.get("exitPlan")!.create({ data: { shadowPositionId: "p1", version: 1, createdAt: LONG_AGO } });

  return { database, tables, portfolio };
}

const BUSINESS_TABLES = [
  "tradeCandidate",
  "tradeDecision",
  "riskAssessment",
  "riskEvent",
  "shadowOrder",
  "shadowFill",
  "shadowPosition",
  "shadowPositionEvent",
  "portfolioLedgerEntry",
  "portfolioSnapshot",
  "strategyPerformance",
  "tradingAuditEvent",
  "exitPlan"
] as const;

describe("runTradingRetention — dry run", () => {
  it("counts what it would delete and deletes nothing", async () => {
    const { database, tables } = seed();
    tables.get("botRun")!.create({ data: { jobName: "j", status: "SUCCESS", startedAt: LONG_AGO } });
    tables.get("botLog")!.create({ data: { level: "info", service: "s", message: "m", createdAt: LONG_AGO } });

    const result = await runTradingRetention(database as never, { asOf: ASOF });

    assert.equal(result.applied, false);
    assert.ok(result.totalMatched >= 2, "the preview reports what an applied run would remove");
    assert.equal(result.totalDeleted, 0);
    assert.equal(tables.get("botRun")!.rows.length, 1);
    assert.equal(tables.get("botLog")!.rows.length, 1);
  });

  it("is the default — omitting `apply` never deletes", async () => {
    const { database, tables } = seed();
    tables.get("botRun")!.create({ data: { jobName: "j", status: "SUCCESS", startedAt: LONG_AGO } });

    await runTradingRetention(database as never, { asOf: ASOF, apply: undefined });
    assert.equal(tables.get("botRun")!.rows.length, 1);
  });
});

describe("runTradingRetention — applied", () => {
  it("removes only old successful BotRuns and informational BotLogs", async () => {
    const { database, tables } = seed();
    tables.get("botRun")!.create({ data: { jobName: "old-ok", status: "SUCCESS", startedAt: LONG_AGO } });
    tables.get("botRun")!.create({ data: { jobName: "old-failed", status: "FAILED", startedAt: LONG_AGO } });
    tables.get("botRun")!.create({ data: { jobName: "recent-ok", status: "SUCCESS", startedAt: RECENT } });
    tables.get("botLog")!.create({ data: { level: "info", service: "s", message: "old", createdAt: LONG_AGO } });
    tables.get("botLog")!.create({ data: { level: "error", service: "s", message: "old error", createdAt: LONG_AGO } });
    tables.get("botLog")!.create({ data: { level: "warn", service: "s", message: "old warn", createdAt: LONG_AGO } });

    const result = await runTradingRetention(database as never, { asOf: ASOF, apply: true });

    assert.equal(result.applied, true);
    const remainingRuns = tables.get("botRun")!.rows.map((row) => row.jobName);
    assert.deepEqual(remainingRuns.sort(), ["old-failed", "recent-ok"], "a failure is evidence and is kept");

    const remainingLogs = tables.get("botLog")!.rows.map((row) => row.level);
    assert.deepEqual(remainingLogs.sort(), ["error", "warn"], "warn and error are diagnostic evidence");
  });

  it("removes attempts of delivered alerts but never the outbox entry itself", async () => {
    const { database, tables } = seed();
    const sent = tables.get("tradingAlertOutbox")!.create({
      data: { idempotencyKey: "k-sent", status: "SENT", createdAt: LONG_AGO }
    });
    const dead = tables.get("tradingAlertOutbox")!.create({
      data: { idempotencyKey: "k-dead", status: "DEAD", createdAt: LONG_AGO }
    });
    tables.get("tradingAlertOutboxAttempt")!.create({
      data: { outboxId: sent.id, attempt: 1, status: "SENT", createdAt: LONG_AGO }
    });
    tables.get("tradingAlertOutboxAttempt")!.create({
      data: { outboxId: dead.id, attempt: 1, status: "DEAD", createdAt: LONG_AGO }
    });

    const result = await runTradingRetention(database as never, { asOf: ASOF, apply: true });

    const attemptTarget = result.targets.find((entry) => entry.target === RetentionTarget.SENT_OUTBOX_ATTEMPTS);
    assert.equal(attemptTarget?.deleted, 1);
    assert.equal(tables.get("tradingAlertOutbox")!.rows.length, 2, "no outbox entry is ever deleted");
    const remaining = tables.get("tradingAlertOutboxAttempt")!.rows;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].outboxId, dead.id, "a dead letter keeps its full attempt history");
  });

  it("never deletes a single row of business trading data", async () => {
    const { database, tables } = seed();
    tables.get("botRun")!.create({ data: { jobName: "j", status: "SUCCESS", startedAt: LONG_AGO } });

    await runTradingRetention(database as never, {
      asOf: ASOF,
      apply: true,
      // A policy of zero days would catch literally everything old.
      policy: { successfulBotRunDays: 0, infoBotLogDays: 0, sentOutboxAttemptDays: 0 }
    });

    for (const table of BUSINESS_TABLES) {
      assert.equal(
        tables.get(table)!.rows.length,
        1,
        `${table} must be untouched by retention, even with a zero-day policy`
      );
    }
  });
});
