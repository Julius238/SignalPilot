import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RISK_LIMIT_SET_SPECIFICATION_HASH } from "@signalpilot/risk-engine";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  TIMEFRAME_INTERVAL_MS,
  type StrategyTimeframe
} from "@signalpilot/strategy-engine";

import {
  CheckOutcome,
  EligibilityStatus,
  buildEligibilityReport
} from "../src/lib/shadowEligibility.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");

const SHADOW_ENV = {
  ENABLE_LIVE_TRADING: "false",
  TRADING_MODE: "SHADOW",
  TRADING_SHADOW_ENABLED: "true",
  TRADING_CODE_VERSION: "sha-test",
  TRADING_ALERT_OUTBOX_ENABLED: "true"
} as const;

/** Every precondition satisfied — the only state that may report READY. */
function seedReady() {
  const { database, tables } = createFakeExecutionDatabase();

  const portfolio = tables.get("portfolio")!.create({
    data: {
      key: "SHADOW_V1",
      name: "pf",
      status: "ACTIVE",
      startingCash: "10000",
      availableCash: "10000",
      reservedCash: "0",
      realizedPnl: "0",
      feesPaid: "0",
      equity: "10000",
      highWaterMark: "10000",
      ledgerSequence: 2,
      lastReconciledAt: new Date(ASOF.getTime() - 60_000)
    }
  });
  tables.get("portfolioLedgerEntry")!.create({
    data: { entryKey: "l1", portfolioId: portfolio.id, sequence: 1 }
  });
  tables.get("portfolioLedgerEntry")!.create({
    data: { entryKey: "l2", portfolioId: portfolio.id, sequence: 2 }
  });
  tables.get("portfolioSnapshot")!.create({
    data: {
      portfolioId: portfolio.id,
      asOf: ASOF,
      tradingDateUtc: new Date("2026-08-10T00:00:00.000Z")
    }
  });

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

  const asset = tables.get("asset")!.create({
    data: {
      id: "asset-btc",
      symbol: "BTCUSDT",
      assetType: "CRYPTO",
      createdAt: new Date("2026-01-01")
    }
  });
  const strategy = tables.get("strategy")!.create({
    data: { id: "strat-1", key: CRYPTO_MTF_BREAKOUT_V1_KEY, status: "ACTIVE" }
  });
  const strategyVersion = tables.get("strategyVersion")!.create({
    data: {
      strategyId: strategy.id,
      version: 1,
      status: "ACTIVE",
      engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
      codeVersion: "sha-test",
      specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
      parametersJson: CRYPTO_MTF_BREAKOUT_V1_PARAMETERS
    }
  });
  tables.get("strategyAssignment")!.create({
    data: {
      portfolioId: portfolio.id,
      assetId: asset.id,
      strategyId: strategy.id,
      strategyVersionId: strategyVersion.id,
      timeframe: "1h",
      enabled: true,
      assignmentConfigJson: { direction: "LONG" }
    }
  });
  tables.get("instrumentExecutionProfile")!.create({
    data: {
      assetId: asset.id,
      version: 1,
      status: "ACTIVE",
      tickSize: "0.01",
      stepSize: "0.00001",
      minQuantity: "0.00001",
      minNotional: "10",
      maxParticipationRate: "0.01",
      feeBps: 10,
      fullSpreadBps: 10,
      slippageBps: 10,
      source: "MANUAL_CONSERVATIVE_V1",
      sourceObservedAt: new Date(ASOF.getTime() - 60_000),
      specificationHash: "a".repeat(64)
    }
  });
  tables.get("riskLimitSet")!.create({
    data: {
      key: "SHADOW_V1",
      version: 1,
      status: "ACTIVE",
      specificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH
    }
  });

  const timeframes: readonly StrategyTimeframe[] = ["1h", "4h", "1d"];
  for (const timeframe of timeframes) {
    const candleCount = timeframe === "1h" ? 500 : 220;
    const interval = TIMEFRAME_INTERVAL_MS[timeframe];
    const latestOpen = ASOF.getTime() - interval;
    for (let index = 0; index < candleCount; index += 1) {
      const openTime = new Date(
        latestOpen - (candleCount - 1 - index) * interval
      );
      tables.get("candle")!.create({
        data: {
          assetId: asset.id,
          timeframe,
          openTime,
          closeTime: new Date(openTime.getTime() + interval - 1),
          source: "BINANCE"
        }
      });
    }
    tables.get("candleDataQuality")!.create({
      data: {
        assetId: asset.id,
        provider: "BINANCE",
        timeframe,
        candleCount,
        gapCount: 0,
        missingCandleCount: 0,
        providerErrorCount: 0,
        entitlementErrorCount: 0,
        noDataCount: 0,
        lastErrorKind: null,
        lastAuditAt: new Date(ASOF.getTime() - 60_000),
        updatedAt: new Date(ASOF.getTime() - 60_000)
      }
    });
    tables.get("signal")!.create({
      data: {
        assetId: asset.id,
        symbol: "BTCUSDT",
        timeframe,
        createdAt: new Date(ASOF.getTime() - 60_000)
      }
    });
  }
  tables.get("marketRegimeSnapshot")!.create({
    data: {
      generatedAt: new Date(ASOF.getTime() - 60_000),
      cryptoRegime: "RISK_ON",
      riskMode: "NORMAL",
      confidence: 75
    }
  });

  return { database, tables, portfolio, session, strategyVersion };
}

function check(
  report: Awaited<ReturnType<typeof buildEligibilityReport>>,
  code: string
) {
  const found = report.checks.find((entry) => entry.code === code);
  assert.ok(found, `expected check ${code}`);
  return found;
}

describe("buildEligibilityReport", () => {
  it("reports READY when every precondition holds", async () => {
    const { database } = seedReady();
    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });

    assert.equal(
      report.status,
      EligibilityStatus.READY,
      JSON.stringify(report.blockingFailures)
    );
    assert.deepEqual(report.blockingFailures, []);
    assert.equal(report.reportVersion, "shadow-eligibility-v3");
  });

  it("validates a pinned synthetic SHORT assignment and all Short gates", async () => {
    const { database, tables, portfolio } = seedReady();
    const asset = tables
      .get("asset")!
      .rows.find((row) => row.id === "asset-btc")!;
    const strategy = tables.get("strategy")!.create({
      data: { key: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY, status: "ACTIVE" }
    });
    const strategyVersion = tables.get("strategyVersion")!.create({
      data: {
        strategyId: strategy.id,
        version: 1,
        status: "ACTIVE",
        engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
        codeVersion: "sha-test",
        specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
        parametersJson: CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS
      }
    });
    const assignment = tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        strategyId: strategy.id,
        strategyVersionId: strategyVersion.id,
        timeframe: "1h",
        enabled: true,
        assignmentConfigJson: {
          direction: "SHORT",
          syntheticShadowShort: true,
          leverageAllowed: false,
          marginAllowed: false,
          futuresAllowed: false
        }
      }
    });
    const shortEnv = {
      ...SHADOW_ENV,
      TRADING_STRATEGY_V1_ENABLED: "true",
      TRADING_STRATEGY_SHORT_V1_ENABLED: "true",
      TRADING_SHADOW_SHORT_ENABLED: "true"
    } as const;

    const ready = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: shortEnv
    });
    assert.equal(
      ready.status,
      EligibilityStatus.READY,
      JSON.stringify(ready.blockingFailures)
    );
    assert.equal(check(ready, "SHADOW_SHORT_FLAGS").outcome, CheckOutcome.PASS);

    tables.get("strategyAssignment")!.update({
      where: { id: assignment.id },
      data: {
        assignmentConfigJson: {
          direction: "SHORT",
          syntheticShadowShort: true,
          leverageAllowed: false,
          marginAllowed: true,
          futuresAllowed: false
        }
      }
    });
    const contradictory = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: shortEnv
    });
    assert.ok(
      contradictory.blockingFailures.includes("ACTIVE_STRATEGY_VERSION")
    );
  });

  it("never writes anything — the report cannot activate a thing", async () => {
    const { database, tables } = seedReady();
    const before = new Map(
      [...tables.entries()].map(
        ([name, table]) => [name, JSON.stringify(table.rows)] as const
      )
    );

    await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });

    for (const [name, snapshot] of before) {
      assert.equal(
        JSON.stringify(tables.get(name)!.rows),
        snapshot,
        `${name} was modified by the report`
      );
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
    tables
      .get("tradingSession")!
      .update({ where: { id: session.id }, data: { status: "ERROR_LOCKED" } });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
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

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.equal(report.status, EligibilityStatus.NOT_READY);
    assert.ok(report.blockingFailures.includes("NO_CRITICAL_RISK_EVENTS"));
  });

  it("blocks on a ledger that does not match its sequence", async () => {
    const { database, tables, portfolio } = seedReady();
    tables
      .get("portfolio")!
      .update({ where: { id: portfolio.id }, data: { ledgerSequence: 99 } });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.equal(report.status, EligibilityStatus.NOT_READY);
    assert.ok(report.blockingFailures.includes("PORTFOLIO_CONSISTENT"));
  });

  it("blocks on stale reconciliation", async () => {
    const { database, tables, portfolio } = seedReady();
    tables.get("portfolio")!.update({
      where: { id: portfolio.id },
      data: { lastReconciledAt: null }
    });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("RECONCILIATION_FRESH"));
  });

  it("blocks without an active risk limit set", async () => {
    const { database, tables } = seedReady();
    tables.get("riskLimitSet")!.deleteMany({ where: {} });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("ACTIVE_RISK_LIMIT_SET"));
  });

  it("blocks when an assigned asset has no active execution profile", async () => {
    const { database, tables } = seedReady();
    tables.get("instrumentExecutionProfile")!.deleteMany({ where: {} });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("EXECUTION_PROFILE"));
  });

  it("blocks when the active strategy version hash is not the pinned specification", async () => {
    const { database, tables, strategyVersion } = seedReady();
    tables.get("strategyVersion")!.update({
      where: { id: strategyVersion.id },
      data: { specificationHash: "b".repeat(64) }
    });
    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("ACTIVE_STRATEGY_VERSION"));
  });

  it("blocks when another portfolio has any enabled assignment", async () => {
    const { database, tables } = seedReady();
    const current = tables.get("strategyAssignment")!.rows[0]!;
    tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: "other-portfolio",
        assetId: current.assetId,
        strategyId: current.strategyId,
        strategyVersionId: current.strategyVersionId,
        timeframe: "1h",
        enabled: true
      }
    });
    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("BTC_ONLY_ASSIGNMENT"));
  });

  it("blocks on a thin candle history", async () => {
    const { database, tables } = seedReady();
    tables.get("candle")!.deleteMany({ where: {} });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("DATA_HISTORY"));
  });

  it("blocks on an open position without a live exit plan", async () => {
    const { database, tables, portfolio } = seedReady();
    tables.get("shadowPosition")!.create({
      data: {
        positionKey: "p-unsafe",
        portfolioId: portfolio.id,
        assetId: "asset-btc",
        direction: "LONG",
        reservedCollateral: "0",
        status: "OPEN",
        activeExitPlanVersion: null
      }
    });

    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(report.blockingFailures.includes("POSITIONS_HAVE_EXITS"));
  });

  it("blocks on a dead-lettered alert and when the outbox is disabled", async () => {
    const { database, tables } = seedReady();
    tables
      .get("tradingAlertOutbox")!
      .create({ data: { idempotencyKey: "k", status: "DEAD" } });

    const withDead = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.ok(withDead.blockingFailures.includes("ALERT_OUTBOX_HEALTHY"));

    const disabled = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: { ...SHADOW_ENV, TRADING_ALERT_OUTBOX_ENABLED: "false" }
    });
    assert.ok(disabled.blockingFailures.includes("ALERT_OUTBOX_ENABLED"));
  });

  it("reports the kill switch as a warning, never as a blocker", async () => {
    const { database } = seedReady();
    const report = await buildEligibilityReport(database as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });

    const killSwitch = check(report, "KILL_SWITCH_STATE");
    assert.equal(killSwitch.outcome, CheckOutcome.WARN);
    assert.equal(killSwitch.blocking, false);
    assert.ok(report.warnings.includes("KILL_SWITCH_STATE"));
    assert.equal(
      report.status,
      EligibilityStatus.READY,
      "a closed kill switch is the safe state, not a defect"
    );
  });

  it("returns ERROR — not NOT_READY — when the facts cannot be established", async () => {
    const broken = {
      portfolio: {
        count: () => Promise.reject(new Error("connection refused"))
      }
    };

    const report = await buildEligibilityReport(broken as never, {
      asOf: ASOF,
      env: SHADOW_ENV
    });
    assert.equal(report.status, EligibilityStatus.ERROR);
    assert.deepEqual(report.blockingFailures, ["REPORT_FAILED"]);
    assert.match(report.checks[0].reason, /connection refused/);
  });
});
