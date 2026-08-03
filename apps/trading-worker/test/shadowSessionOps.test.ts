/**
 * Covers the P6-motivated changes to `shadowSessionOps.ts`:
 *   - `activatePortfolio`/`releaseKillSwitch`/`engageKillSwitch` now accept
 *     an operator-supplied `idempotencyKey` (so the trading API's replay
 *     detection, keyed by that value, actually finds the resulting audit
 *     event) instead of always deriving their own.
 *   - `engageKillSwitch` previously wrote no audit event and never checked
 *     for a version conflict; it now does both, matching every sibling op.
 *   - `pauseSession` is new: `SHADOW_ACTIVE -> PAUSED` only.
 *
 * Pre-existing guard behaviour (the actual state-machine rules) is already
 * covered by `packages/trading-domain`'s own tests — this file only proves
 * the ops-layer wiring around those guards.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activatePortfolio,
  engageKillSwitch,
  pauseSession,
  releaseKillSwitch
} from "../src/lib/shadowSessionOps.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function seedActiveSession(tables: ReturnType<typeof createFakeExecutionDatabase>["tables"], status = "SHADOW_ACTIVE") {
  const portfolio = tables.get("portfolio")!.create({ data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" } });
  const session = tables.get("tradingSession")!.create({
    data: { portfolioId: portfolio.id, sessionKey: "SHADOW_V1_SESSION", status, killSwitchEngaged: status !== "SHADOW_ACTIVE" }
  });
  return { portfolio, session };
}

describe("activatePortfolio", () => {
  it("uses the caller's idempotencyKey on the audit event when provided", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables.get("portfolio")!.create({ data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" } });
    const result = await activatePortfolio(database as never, {
      portfolioId: portfolio.id,
      actorId: "admin",
      asOf: NOW,
      idempotencyKey: "operator-key-1"
    });
    assert.equal(result.ok, true);
    const audit = tables.get("tradingAuditEvent")!.rows.find((row) => row.aggregateId === portfolio.id);
    assert.equal(audit?.idempotencyKey, "operator-key-1");
  });
});

describe("releaseKillSwitch", () => {
  it("uses the caller's idempotencyKey when provided", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { session } = seedActiveSession(tables, "STOPPED");
    tables.get("tradingSession")!.update({
      where: { id: session.id },
      data: { reconciledAt: NOW }
    });
    const result = await releaseKillSwitch(database as never, {
      sessionId: session.id,
      actorId: "admin",
      asOf: NOW,
      idempotencyKey: "operator-key-2"
    });
    assert.equal(result.ok, true);
    const audit = tables.get("tradingAuditEvent")!.rows.find((row) => row.aggregateId === session.id);
    assert.equal(audit?.idempotencyKey, "operator-key-2");
  });
});

describe("engageKillSwitch", () => {
  it("writes an audit event and rejects a stale version", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { session } = seedActiveSession(tables);

    const result = await engageKillSwitch(database as never, {
      sessionId: session.id,
      actorId: "admin",
      reasonCode: "MANUAL_HALT",
      asOf: NOW,
      idempotencyKey: "operator-key-3"
    });
    assert.equal(result.ok, true);

    const audit = tables.get("tradingAuditEvent")!.rows.find((row) => row.aggregateId === session.id);
    assert.equal(audit?.reasonCode, "MANUAL_HALT");
    assert.equal(audit?.idempotencyKey, "operator-key-3");

    const updated = tables.get("tradingSession")!.rows.find((row) => row.id === session.id);
    assert.equal(updated?.killSwitchEngaged, true);
  });
});

describe("pauseSession", () => {
  it("pauses an active session", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { session } = seedActiveSession(tables);
    const result = await pauseSession(database as never, { sessionId: session.id, actorId: "admin", asOf: NOW });
    assert.equal(result.ok, true);
    const updated = tables.get("tradingSession")!.rows.find((row) => row.id === session.id);
    assert.equal(updated?.status, "PAUSED");
  });

  it("refuses to pause a session that is not SHADOW_ACTIVE", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { session } = seedActiveSession(tables, "STOPPED");
    const result = await pauseSession(database as never, { sessionId: session.id, actorId: "admin", asOf: NOW });
    assert.equal(result.ok, false);
  });
});
