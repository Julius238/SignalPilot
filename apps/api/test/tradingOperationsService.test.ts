import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activatePortfolioOperation,
  isAllowlistedJobName,
  manualRiskCloseOperation,
  pauseSessionOperation,
  runJobOperation,
  RUN_JOB_ALLOWLIST,
  setAssignmentOperation
} from "../src/services/trading/operationsService.js";
import { createFakeTradingDatabase } from "./support/tradingFixtures.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

describe("activatePortfolioOperation", () => {
  it("executes once, then replays idempotently on a repeated call with the same key", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables
      .get("portfolio")!
      .create({
        data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" }
      });

    const first = await activatePortfolioOperation(database as never, {
      portfolioId: portfolio.id,
      actorId: "admin",
      idempotencyKey: "op-key-1",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(first.kind, "executed");

    const second = await activatePortfolioOperation(database as never, {
      portfolioId: portfolio.id,
      actorId: "admin",
      idempotencyKey: "op-key-1",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(second.kind, "replayed");

    const auditEvents = tables
      .get("tradingAuditEvent")!
      .rows.filter((row) => row.aggregateId === portfolio.id);
    assert.equal(
      auditEvents.length,
      1,
      "a replay must never create a second audit event"
    );
  });

  it("reports a version conflict when expectedVersion is stale", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables
      .get("portfolio")!
      .create({
        data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" }
      });

    const result = await activatePortfolioOperation(database as never, {
      portfolioId: portfolio.id,
      actorId: "admin",
      idempotencyKey: "op-key-2",
      expectedVersion: 99,
      asOf: NOW
    });
    assert.equal(result.kind, "version_conflict");
    if (result.kind !== "version_conflict") return;
    assert.equal(result.currentVersion, 0);
  });

  it("reports not_found for an unknown portfolio", async () => {
    const { database } = createFakeTradingDatabase();
    const result = await activatePortfolioOperation(database as never, {
      portfolioId: "does-not-exist",
      actorId: "admin",
      idempotencyKey: "op-key-3",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(result.kind, "not_found");
  });
});

describe("setAssignmentOperation", () => {
  it("enables and disables one pinned SHORT assignment only with the exact versioned confirmation", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" }
    });
    const asset = tables.get("asset")!.create({ data: { symbol: "BTCUSDT" } });
    const strategy = tables.get("strategy")!.create({
      data: {
        key: "CRYPTO_MTF_BREAKDOWN_SHORT_V1",
        name: "Short v1",
        status: "ACTIVE"
      }
    });
    const strategyVersion = tables.get("strategyVersion")!.create({
      data: {
        strategyId: strategy.id,
        version: 1,
        status: "ACTIVE",
        parametersJson: { direction: "SHORT" }
      }
    });
    const assignment = tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        strategyId: strategy.id,
        strategyVersionId: strategyVersion.id,
        enabled: false,
        assignmentConfigJson: { direction: "SHORT" }
      }
    });

    const badConfirmation = await setAssignmentOperation(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: true,
      confirmation: "ENABLE_BTCUSDT_SHORT",
      idempotencyKey: "short-enable-bad-confirmation",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(badConfirmation.kind, "guard_failed");

    const enabled = await setAssignmentOperation(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: true,
      confirmation: "ENABLE_BTCUSDT_SHORT_CRYPTO_MTF_BREAKDOWN_SHORT_V1_V0",
      idempotencyKey: "short-enable-1",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(enabled.kind, "executed");
    assert.equal(assignment.enabled, true);
    assert.equal(assignment.version, 1);

    const replay = await setAssignmentOperation(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: true,
      confirmation: "ENABLE_BTCUSDT_SHORT_CRYPTO_MTF_BREAKDOWN_SHORT_V1_V0",
      idempotencyKey: "short-enable-1",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(replay.kind, "replayed");

    const disabled = await setAssignmentOperation(database as never, {
      assignmentId: assignment.id as string,
      actorId: "admin",
      enabled: false,
      confirmation: "DISABLE_BTCUSDT_SHORT_CRYPTO_MTF_BREAKDOWN_SHORT_V1_V1",
      idempotencyKey: "short-disable-1",
      expectedVersion: 1,
      asOf: new Date("2026-06-01T12:01:00.000Z")
    });
    assert.equal(disabled.kind, "executed");
    assert.equal(assignment.enabled, false);
    assert.equal(assignment.version, 2);
  });
});

describe("pauseSessionOperation", () => {
  it("refuses to pause a session that is not SHADOW_ACTIVE (guard_failed, not a silent no-op)", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables
      .get("portfolio")!
      .create({
        data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" }
      });
    const session = tables.get("tradingSession")!.create({
      data: {
        portfolioId: portfolio.id,
        sessionKey: "S1",
        status: "STOPPED",
        killSwitchEngaged: true
      }
    });

    const result = await pauseSessionOperation(database as never, {
      sessionId: session.id,
      actorId: "admin",
      idempotencyKey: "op-key-4",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(result.kind, "guard_failed");
  });
});

describe("manualRiskCloseOperation", () => {
  it("checks the position's version before filing the request", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables
      .get("portfolio")!
      .create({
        data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" }
      });
    const position = tables.get("shadowPosition")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: "asset-1",
        status: "OPEN",
        openQuantity: "1",
        initialQuantity: "1"
      }
    });

    const stale = await manualRiskCloseOperation(database as never, {
      shadowPositionId: position.id,
      actorId: "admin",
      reasonNote: "test",
      idempotencyKey: "op-key-5",
      expectedVersion: 5,
      asOf: NOW
    });
    assert.equal(stale.kind, "version_conflict");

    const executed = await manualRiskCloseOperation(database as never, {
      shadowPositionId: position.id,
      actorId: "admin",
      reasonNote: "test",
      idempotencyKey: "op-key-6",
      expectedVersion: 0,
      asOf: NOW
    });
    assert.equal(executed.kind, "executed");

    // The position itself must be untouched — only a RiskEvent was filed.
    const stillOpen = tables
      .get("shadowPosition")!
      .rows.find((row) => row.id === position.id);
    assert.equal(stillOpen?.status, "OPEN");
    assert.equal(stillOpen?.openQuantity, "1");
  });
});

describe("runJobOperation / run-job allowlist", () => {
  it("rejects anything outside the fixed allowlist, including a shell-injection-shaped value", async () => {
    const { database } = createFakeTradingDatabase();
    for (const malicious of [
      "; rm -rf /",
      "$(whoami)",
      "shadow-generate-candidates; echo pwned",
      "not-a-job"
    ]) {
      assert.equal(isAllowlistedJobName(malicious), false);
      const result = await runJobOperation(database as never, {
        jobName: malicious,
        actorId: "admin",
        idempotencyKey: `op-key-${malicious}`,
        asOf: NOW
      });
      assert.equal(result.kind, "guard_failed");
      if (result.kind === "guard_failed")
        assert.equal(result.reasonCode, "JOB_NOT_ALLOWLISTED");
    }
  });

  it("exposes exactly the seven P5 trading jobs plus the three P8 jobs, and nothing else", () => {
    assert.deepEqual(
      [...RUN_JOB_ALLOWLIST].sort(),
      [
        // P5 — the trading workflow itself.
        "shadow-assess-risk",
        "shadow-create-orders",
        "shadow-generate-candidates",
        "shadow-monitor-positions",
        "shadow-process-fills",
        "shadow-reconcile-portfolio",
        "shadow-start-trading-day",
        // P8 — reporting and operations. Each still enforces its own feature
        // flag internally; being allowlisted only makes a job triggerable.
        "shadow-alert-outbox",
        "shadow-performance-refresh",
        "shadow-retention"
      ].sort()
    );
  });

  it("keeps shadow-retention a dry run — the operations API never passes `apply`", async () => {
    const { database } = createFakeTradingDatabase();
    const outcome = await runJobOperation(database as never, {
      jobName: "shadow-retention",
      actorId: "admin",
      idempotencyKey: "retention-dry-run",
      asOf: new Date("2026-08-10T12:00:00.000Z")
    });

    assert.equal(outcome.kind, "executed");
    if (outcome.kind !== "executed") return;
    const summary = outcome.result as {
      result: { applied: boolean } | null;
      blocked: boolean;
    };
    // Blocked by the retention feature flag in this environment; either way,
    // nothing may report itself as an applied deletion.
    assert.notEqual(summary.result?.applied, true);
  });
});
