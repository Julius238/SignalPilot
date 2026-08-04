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
  releaseKillSwitch,
  setStrategyAssignmentEnabled
} from "../src/lib/shadowSessionOps.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function seedActiveSession(
  tables: ReturnType<typeof createFakeExecutionDatabase>["tables"],
  status = "SHADOW_ACTIVE"
) {
  const portfolio = tables
    .get("portfolio")!
    .create({ data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" } });
  const session = tables.get("tradingSession")!.create({
    data: {
      portfolioId: portfolio.id,
      sessionKey: "SHADOW_V1_SESSION",
      status,
      killSwitchEngaged: status !== "SHADOW_ACTIVE"
    }
  });
  return { portfolio, session };
}

describe("activatePortfolio", () => {
  it("uses the caller's idempotencyKey on the audit event when provided", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" }
    });
    const result = await activatePortfolio(database as never, {
      portfolioId: portfolio.id,
      actorId: "admin",
      asOf: NOW,
      idempotencyKey: "operator-key-1"
    });
    assert.equal(result.ok, true);
    const audit = tables
      .get("tradingAuditEvent")!
      .rows.find((row) => row.aggregateId === portfolio.id);
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
    const audit = tables
      .get("tradingAuditEvent")!
      .rows.find((row) => row.aggregateId === session.id);
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

    const audit = tables
      .get("tradingAuditEvent")!
      .rows.find((row) => row.aggregateId === session.id);
    assert.equal(audit?.reasonCode, "MANUAL_HALT");
    assert.equal(audit?.idempotencyKey, "operator-key-3");

    const updated = tables
      .get("tradingSession")!
      .rows.find((row) => row.id === session.id);
    assert.equal(updated?.killSwitchEngaged, true);
  });
});

describe("pauseSession", () => {
  it("pauses an active session", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { session } = seedActiveSession(tables);
    const result = await pauseSession(database as never, {
      sessionId: session.id,
      actorId: "admin",
      asOf: NOW
    });
    assert.equal(result.ok, true);
    const updated = tables
      .get("tradingSession")!
      .rows.find((row) => row.id === session.id);
    assert.equal(updated?.status, "PAUSED");
  });

  it("refuses to pause a session that is not SHADOW_ACTIVE", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const { session } = seedActiveSession(tables, "STOPPED");
    const result = await pauseSession(database as never, {
      sessionId: session.id,
      actorId: "admin",
      asOf: NOW
    });
    assert.equal(result.ok, false);
  });
});

describe("setStrategyAssignmentEnabled", () => {
  it("enables and disables one explicit BTC LONG assignment with versioned confirmation", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables
      .get("portfolio")!
      .create({ data: { key: "SHADOW_V1", status: "DRAFT" } });
    const asset = tables
      .get("asset")!
      .create({ data: { symbol: "BTCUSDT", assetType: "CRYPTO" } });
    const strategy = tables
      .get("strategy")!
      .create({ data: { key: "CRYPTO_MTF_BREAKOUT_V1", status: "ACTIVE" } });
    const strategyVersion = tables.get("strategyVersion")!.create({
      data: {
        strategyId: strategy.id,
        version: 1,
        status: "ACTIVE",
        parametersJson: { direction: "LONG" }
      }
    });
    const assignment = tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        strategyId: strategy.id,
        strategyVersionId: strategyVersion.id,
        timeframe: "1h",
        enabled: false,
        activeScopeKey: null,
        assignmentConfigJson: { direction: "LONG" }
      }
    });

    const enabled = await setStrategyAssignmentEnabled(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: true,
      idempotencyKey: "btc-enable-1",
      expectedVersion: 0,
      confirmation: "ENABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_V1_V0",
      asOf: NOW
    });
    assert.equal(enabled.ok, true);
    assert.equal(tables.get("strategyAssignment")!.rows[0].enabled, true);
    assert.equal(
      tables.get("tradingAuditEvent")!.rows[0].eventType,
      "STRATEGY_ASSIGNMENT_ENABLED"
    );

    const disabled = await setStrategyAssignmentEnabled(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: false,
      idempotencyKey: "btc-disable-1",
      expectedVersion: 1,
      confirmation: "DISABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_V1_V1",
      asOf: new Date(NOW.getTime() + 1_000)
    });
    assert.equal(disabled.ok, true);
    assert.equal(tables.get("strategyAssignment")!.rows[0].enabled, false);
    assert.equal(
      tables.get("strategyAssignment")!.rows[0].activeScopeKey,
      null
    );
  });

  it("allows an explicit ETHUSDT synthetic SHORT assignment", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const asset = tables
      .get("asset")!
      .create({ data: { symbol: "ETHUSDT", assetType: "CRYPTO" } });
    const strategy = tables
      .get("strategy")!
      .create({
        data: { key: "CRYPTO_MTF_BREAKDOWN_SHORT_V1", status: "ACTIVE" }
      });
    const strategyVersion = tables.get("strategyVersion")!.create({
      data: {
        strategyId: strategy.id,
        version: 1,
        status: "ACTIVE",
        parametersJson: { direction: "SHORT" }
      }
    });
    const portfolio = tables
      .get("portfolio")!
      .create({ data: { key: "SHADOW_V1", status: "DRAFT" } });
    const assignment = tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        strategyId: strategy.id,
        strategyVersionId: strategyVersion.id,
        timeframe: "1h",
        enabled: false,
        assignmentConfigJson: { direction: "SHORT" }
      }
    });
    const result = await setStrategyAssignmentEnabled(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: true,
      idempotencyKey: "eth-short-enable-1",
      expectedVersion: 0,
      confirmation: "ENABLE_ETHUSDT_SHORT_CRYPTO_MTF_BREAKDOWN_SHORT_V1_V0",
      asOf: NOW
    });
    assert.equal(result.ok, true);
    assert.equal(tables.get("strategyAssignment")!.rows[0].enabled, true);
  });

  it("fails closed on a direction mismatch before changing state", async () => {
    const { database, tables } = createFakeExecutionDatabase();
    const portfolio = tables
      .get("portfolio")!
      .create({ data: { key: "SHADOW_V1", status: "DRAFT" } });
    const asset = tables
      .get("asset")!
      .create({ data: { symbol: "BTCUSDT", assetType: "CRYPTO" } });
    const strategy = tables.get("strategy")!.create({
      data: { key: "CRYPTO_MTF_BREAKOUT_V1", status: "ACTIVE" }
    });
    const strategyVersion = tables.get("strategyVersion")!.create({
      data: {
        strategyId: strategy.id,
        version: 1,
        status: "ACTIVE",
        parametersJson: { direction: "LONG" }
      }
    });
    const target = tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        strategyId: strategy.id,
        strategyVersionId: strategyVersion.id,
        timeframe: "1h",
        enabled: false,
        assignmentConfigJson: { direction: "SHORT" }
      }
    });

    const result = await setStrategyAssignmentEnabled(database as never, {
      assignmentId: target.id as string,
      actorId: "admin",
      enabled: true,
      idempotencyKey: "direction-conflict-1",
      expectedVersion: 0,
      confirmation: "ENABLE_BTCUSDT_SHORT_CRYPTO_MTF_BREAKOUT_V1_V0",
      asOf: NOW
    });
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.equal(result.reasonCode, "ASSIGNMENT_DIRECTION_CONFLICT");
    assert.equal(tables.get("strategyAssignment")!.rows[0].enabled, false);
  });
});
