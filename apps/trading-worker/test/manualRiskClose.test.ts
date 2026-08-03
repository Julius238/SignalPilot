/**
 * `requestManualRiskClose`: records the request as a critical `RiskEvent` +
 * `TradingAuditEvent` only — never touches the position itself. That part is
 * covered by `shadowPositionMonitor.test.ts`'s existing forced-exit tests
 * once the widened `reasonCode` filter picks the event up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestManualRiskClose, MANUAL_RISK_CLOSE_REASON_CODE } from "../src/lib/manualRiskClose.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function seedOpenPosition(tables: ReturnType<typeof createFakeExecutionDatabase>["tables"], status = "OPEN") {
  const portfolio = tables.get("portfolio")!.create({ data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" } });
  tables.get("tradingSession")!.create({
    data: { portfolioId: portfolio.id, sessionKey: "SHADOW_V1_SESSION", status: "SHADOW_ACTIVE", killSwitchEngaged: false }
  });
  const position = tables.get("shadowPosition")!.create({
    data: {
      portfolioId: portfolio.id,
      assetId: "asset-1",
      status,
      openQuantity: "1.000000000000",
      closedQuantity: "0.000000000000",
      initialQuantity: "1.000000000000",
      averageEntryPrice: "100.000000000000",
      grossEntryNotional: "100.000000000000",
      grossExitNotional: "0.000000000000",
      realizedPnl: "0.000000000000",
      feesPaid: "0.000000000000"
    }
  });
  return { portfolio, position };
}

describe("requestManualRiskClose", () => {
  it("fails with POSITION_NOT_FOUND for an unknown position", async () => {
    const { database } = createFakeExecutionDatabase();
    const result = await requestManualRiskClose(database as never, {
      shadowPositionId: "does-not-exist",
      actorId: "admin",
      reasonNote: "test",
      idempotencyKey: "key-1",
      asOf: NOW
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, "POSITION_NOT_FOUND");
  });

  it("fails with POSITION_NOT_OPEN for an already-closed position", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { position } = seedOpenPosition(tables, "CLOSED");
    const result = await requestManualRiskClose(database as never, {
      shadowPositionId: position.id,
      actorId: "admin",
      reasonNote: "test",
      idempotencyKey: "key-2",
      asOf: NOW
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, "POSITION_NOT_OPEN");
  });

  it("creates exactly one critical RiskEvent and one TradingAuditEvent for a fresh request", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { position } = seedOpenPosition(tables);
    const result = await requestManualRiskClose(database as never, {
      shadowPositionId: position.id,
      actorId: "admin",
      reasonNote: "operator judgment call",
      idempotencyKey: "key-3",
      asOf: NOW
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.alreadyRequested, false);

    const riskEvents = tables.get("riskEvent")!.rows.filter((row) => row.shadowPositionId === position.id);
    assert.equal(riskEvents.length, 1);
    assert.equal(riskEvents[0]!.reasonCode, MANUAL_RISK_CLOSE_REASON_CODE);
    assert.equal(riskEvents[0]!.severity, "CRITICAL");
    assert.equal(riskEvents[0]!.acknowledgedAt ?? null, null);

    const auditEvents = tables
      .get("tradingAuditEvent")!
      .rows.filter((row) => row.aggregateId === position.id && row.eventType === "MANUAL_RISK_CLOSE_REQUESTED");
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0]!.actorId, "admin");
  });

  it("replays idempotently: the same idempotency key never creates a second event", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { position } = seedOpenPosition(tables);
    const first = await requestManualRiskClose(database as never, {
      shadowPositionId: position.id,
      actorId: "admin",
      reasonNote: "operator judgment call",
      idempotencyKey: "key-4",
      asOf: NOW
    });
    assert.equal(first.ok, true);

    const second = await requestManualRiskClose(database as never, {
      shadowPositionId: position.id,
      actorId: "admin",
      reasonNote: "operator judgment call",
      idempotencyKey: "key-4",
      asOf: new Date(NOW.getTime() + 1000)
    });
    assert.equal(second.ok, true);
    if (!second.ok || !first.ok) return;
    assert.equal(second.alreadyRequested, true);
    assert.equal(second.riskEventId, first.riskEventId);

    const riskEvents = tables.get("riskEvent")!.rows.filter((row) => row.shadowPositionId === position.id);
    assert.equal(riskEvents.length, 1, "a replay must never create a second RiskEvent");
  });
});
