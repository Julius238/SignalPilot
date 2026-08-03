/**
 * `resolveEntryWorkflowGuard`: the scheduler-level precondition check for the
 * entry-side jobs (candidate, risk, order, fill).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveEntryWorkflowGuard, EntryWorkflowReasonCode } from "../src/lib/workflowGuards.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function seedActivePortfolio(tables: ReturnType<typeof createFakeExecutionDatabase>["tables"]) {
  const portfolio = tables.get("portfolio")!.create({
    data: { status: "ACTIVE", lastReconciledAt: NOW, key: "SHADOW_V1", name: "Shadow v1" }
  });
  const session = tables.get("tradingSession")!.create({
    data: {
      portfolioId: portfolio.id,
      status: "SHADOW_ACTIVE",
      killSwitchEngaged: false,
      sessionKey: "SHADOW_V1_SESSION"
    }
  });
  return { portfolio, session };
}

describe("resolveEntryWorkflowGuard", () => {
  it("blocks when no non-archived portfolio exists", async () => {
    const { database } = createFakeExecutionDatabase();
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.NO_PORTFOLIO);
  });

  it("blocks when the portfolio is not ACTIVE", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    tables.get("portfolio")!.create({ data: { status: "DRAFT", key: "SHADOW_V1", name: "Shadow v1" } });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.PORTFOLIO_NOT_ACTIVE);
  });

  it("blocks when the active portfolio has no open TradingSession", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    tables.get("portfolio")!.create({ data: { status: "ACTIVE", key: "SHADOW_V1", name: "Shadow v1" } });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.NO_SESSION);
  });

  it("blocks when the session is not SHADOW_ACTIVE", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { status: "ACTIVE", lastReconciledAt: NOW, key: "SHADOW_V1", name: "Shadow v1" }
    });
    tables.get("tradingSession")!.create({
      data: { portfolioId: portfolio.id, status: "STOPPED", killSwitchEngaged: true, sessionKey: "SHADOW_V1_SESSION" }
    });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.SESSION_NOT_ACTIVE);
  });

  it("blocks when the kill switch is engaged", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { status: "ACTIVE", lastReconciledAt: NOW, key: "SHADOW_V1", name: "Shadow v1" }
    });
    tables.get("tradingSession")!.create({
      data: {
        portfolioId: portfolio.id,
        status: "SHADOW_ACTIVE",
        killSwitchEngaged: true,
        sessionKey: "SHADOW_V1_SESSION"
      }
    });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.KILL_SWITCH_ENGAGED);
  });

  it("blocks when reconciliation is stale (older than 5 minutes)", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: {
        status: "ACTIVE",
        lastReconciledAt: new Date(NOW.getTime() - 6 * 60 * 1000),
        key: "SHADOW_V1",
        name: "Shadow v1"
      }
    });
    tables.get("tradingSession")!.create({
      data: {
        portfolioId: portfolio.id,
        status: "SHADOW_ACTIVE",
        killSwitchEngaged: false,
        sessionKey: "SHADOW_V1_SESSION"
      }
    });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.RECONCILIATION_STALE);
  });

  it("blocks when reconciliation has never succeeded", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { status: "ACTIVE", lastReconciledAt: null, key: "SHADOW_V1", name: "Shadow v1" }
    });
    tables.get("tradingSession")!.create({
      data: {
        portfolioId: portfolio.id,
        status: "SHADOW_ACTIVE",
        killSwitchEngaged: false,
        sessionKey: "SHADOW_V1_SESSION"
      }
    });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.RECONCILIATION_STALE);
  });

  it("blocks when today's UTC daily snapshot is missing", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    seedActivePortfolio(tables);
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, EntryWorkflowReasonCode.DAILY_SNAPSHOT_MISSING);
  });

  it("allows entry-side work when every precondition holds", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { portfolio, session } = seedActivePortfolio(tables);
    tables.get("portfolioSnapshot")!.create({
      data: {
        portfolioId: portfolio.id,
        tradingDateUtc: new Date(Date.UTC(2026, 5, 1)),
        asOf: NOW,
        sourceLedgerSequence: 0
      }
    });
    const result = await resolveEntryWorkflowGuard(database as never, NOW);
    assert.equal(result.allowed, true);
    if (!result.allowed) return;
    assert.equal(result.portfolioId, portfolio.id);
    assert.equal(result.sessionId, session.id);
  });
});
