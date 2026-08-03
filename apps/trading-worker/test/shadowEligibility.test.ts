import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CheckOutcome, EligibilityStatus, buildEligibilityReport } from "../src/lib/shadowEligibility.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");

const SHADOW_ENV = {
  ENABLE_LIVE_TRADING: "false",
  TRADING_MODE: "SHADOW",
  TRADING_SHADOW_ENABLED: "true",
  TRADING_ALERT_OUTBOX_ENABLED: "true"
} as const;

/** Every precondition satisfied — the only state that may report READY. */
function seedReady() {
  const { database, tables } = createFakeExecutionDatabase();

  const portfolio = tables.get("portfolio")!.create({
    data: {
      key: "pf",
      name: "pf",
      status: "ACTIVE",
      ledgerSequence: 2,
      lastReconciledAt: new Date(ASOF.getTime() - 60_000)
    }
  });
  tables.get("portfolioLedgerEntry")!.create({ data: { entryKey: "l1", portfolioId: portfolio.id, sequence: 1 } });
  tables.get("portfolioLedgerEntry")!.create({ data: { entryKey: "l2", portfolioId: portfolio.id, sequence: 2 } });
  tables.get("portfolioSnapshot")!.create({ data: { portfolioId: portfolio.id, asOf: ASOF } });

  const session = tables.get("tradingSession")!.create({
    data: {
      sessionKey: "s1",
      portfolioId: portfolio.id,
      status: "STOPPED",
      killSwitchEngaged: true,
      heartbeatAt: new Date(ASOF.getTime() - 60_000),
      version: 0
    }
  });

  const strategyVersion = tables.get("strategyVersion")!.create({
    data: { strategyId: "strat-1", version: 1, status: "ACTIVE" }
  });
  tables.get("strategyAssignment")!.create({
    data: {
      portfolioId: portfolio.id,
      assetId: "asset-btc",
      strategyId: "strat-1",
      strategyVersionId: strategyVersion.id,
      timeframe: "1h",
      enabled: true
    }
  });
  tables.get("instrumentExecutionProfile")!.create({
    data: { assetId: "asset-btc", version: 1, status: "ACTIVE" }
  });
  tables.get("riskLimitSet")!.create({ data: { key: "limits", version: 1, status: "ACTIVE" } });

  for (let index = 0; index < 600; index += 1) {
    tables.get("candle")!.create({
      data: { assetId: "asset-btc", timeframe: "1h", openTime: new Date(index), closeTime: new Date(index + 1) }
    });
  }

  return { database, tables, portfolio, session, strategyVersion };
}

function check(report: Awaited<ReturnType<typeof buildEligibilityReport>>, code: string) {
  const found = report.checks.find((entry) => entry.code === code);
  assert.ok(found, `expected check ${code}`);
  return found;
}

describe("buildEligibilityReport", () => {
  it("reports READY when every precondition holds", async () => {
    const { database } = seedReady();
    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });

    assert.equal(report.status, EligibilityStatus.READY, JSON.stringify(report.blockingFailures));
    assert.deepEqual(report.blockingFailures, []);
    assert.equal(report.reportVersion, "shadow-eligibility-v1");
  });

  it("never writes anything — the report cannot activate a thing", async () => {
    const { database, tables } = seedReady();
    const before = new Map(
      [...tables.entries()].map(([name, table]) => [name, JSON.stringify(table.rows)] as const)
    );

    await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });

    for (const [name, snapshot] of before) {
      assert.equal(JSON.stringify(tables.get(name)!.rows), snapshot, `${name} was modified by the report`);
    }
  });

  it("blocks when live trading is configured", async () => {
    const { database } = seedReady();
    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: { ...SHADOW_ENV, ENABLE_LIVE_TRADING: "true" }
    });

    assert.equal(report.status, EligibilityStatus.NOT_READY);
    assert.ok(report.blockingFailures.includes("SHADOW_ONLY_CAPABILITY"));
  });

  it("blocks on an ERROR_LOCKED session", async () => {
    const { database, tables, session } = seedReady();
    tables.get("tradingSession")!.update({ where: { id: session.id }, data: { status: "ERROR_LOCKED" } });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.equal(report.status, EligibilityStatus.NOT_READY);
    assert.ok(report.blockingFailures.includes("SESSION_NOT_ERROR_LOCKED"));
  });

  it("blocks on an unacknowledged critical risk event", async () => {
    const { database, tables, portfolio } = seedReady();
    tables.get("riskEvent")!.create({
      data: {
        eventKey: "re-crit",
        portfolioId: portfolio.id,
        severity: "CRITICAL",
        type: "SIMULATION_ERROR",
        acknowledgedAt: null
      }
    });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.equal(report.status, EligibilityStatus.NOT_READY);
    assert.ok(report.blockingFailures.includes("NO_CRITICAL_RISK_EVENTS"));
  });

  it("blocks on a ledger that does not match its sequence", async () => {
    const { database, tables, portfolio } = seedReady();
    tables.get("portfolio")!.update({ where: { id: portfolio.id }, data: { ledgerSequence: 99 } });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.equal(report.status, EligibilityStatus.NOT_READY);
    assert.ok(report.blockingFailures.includes("PORTFOLIO_CONSISTENT"));
  });

  it("blocks on stale reconciliation", async () => {
    const { database, tables, portfolio } = seedReady();
    tables.get("portfolio")!.update({ where: { id: portfolio.id }, data: { lastReconciledAt: null } });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.ok(report.blockingFailures.includes("RECONCILIATION_FRESH"));
  });

  it("blocks without an active risk limit set", async () => {
    const { database, tables } = seedReady();
    tables.get("riskLimitSet")!.deleteMany({ where: {} });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.ok(report.blockingFailures.includes("ACTIVE_RISK_LIMIT_SET"));
  });

  it("blocks when an assigned asset has no active execution profile", async () => {
    const { database, tables } = seedReady();
    tables.get("instrumentExecutionProfile")!.deleteMany({ where: {} });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.ok(report.blockingFailures.includes("EXECUTION_PROFILES"));
  });

  it("blocks on a thin candle history", async () => {
    const { database, tables } = seedReady();
    tables.get("candle")!.deleteMany({ where: {} });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.ok(report.blockingFailures.includes("DATA_HISTORY"));
  });

  it("blocks on an open position without a live exit plan", async () => {
    const { database, tables, portfolio } = seedReady();
    tables.get("shadowPosition")!.create({
      data: {
        positionKey: "p-unsafe",
        portfolioId: portfolio.id,
        assetId: "asset-btc",
        status: "OPEN",
        activeExitPlanVersion: null
      }
    });

    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.ok(report.blockingFailures.includes("POSITIONS_HAVE_EXITS"));
  });

  it("blocks on a dead-lettered alert and when the outbox is disabled", async () => {
    const { database, tables } = seedReady();
    tables.get("tradingAlertOutbox")!.create({ data: { idempotencyKey: "k", status: "DEAD" } });

    const withDead = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.ok(withDead.blockingFailures.includes("ALERT_OUTBOX_HEALTHY"));

    const disabled = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: { ...SHADOW_ENV, TRADING_ALERT_OUTBOX_ENABLED: "false" }
    });
    assert.ok(disabled.blockingFailures.includes("ALERT_OUTBOX_ENABLED"));
  });

  it("reports the kill switch as a warning, never as a blocker", async () => {
    const { database } = seedReady();
    const report = await buildEligibilityReport(database as never, { asOf: ASOF, env: SHADOW_ENV });

    const killSwitch = check(report, "KILL_SWITCH_STATE");
    assert.equal(killSwitch.outcome, CheckOutcome.WARN);
    assert.equal(killSwitch.blocking, false);
    assert.ok(report.warnings.includes("KILL_SWITCH_STATE"));
    assert.equal(report.status, EligibilityStatus.READY, "a closed kill switch is the safe state, not a defect");
  });

  it("returns ERROR — not NOT_READY — when the facts cannot be established", async () => {
    const broken = {
      portfolio: {
        count: () => Promise.reject(new Error("connection refused"))
      }
    };

    const report = await buildEligibilityReport(broken as never, { asOf: ASOF, env: SHADOW_ENV });
    assert.equal(report.status, EligibilityStatus.ERROR);
    assert.deepEqual(report.blockingFailures, ["REPORT_FAILED"]);
    assert.match(report.checks[0].reason, /connection refused/);
  });
});
