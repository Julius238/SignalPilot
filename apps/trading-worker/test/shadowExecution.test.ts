import assert from "node:assert/strict";
import { CRYPTO_NATIVE_REGIME_SOURCE, REGIME_EXIT_POLICY } from "@signalpilot/strategy-engine";
import { describe, it } from "node:test";

import {
  createShadowOrderForCandidate,
  ShadowOrderOutcome,
  ShadowOrderReasonCode
} from "../src/lib/shadowOrderPersistence.js";
import {
  processEntryOrderFillForCandle,
  ShadowFillOutcome
} from "../src/lib/shadowFillPersistence.js";
import {
  monitorPositionForCandle,
  ShadowMonitorOutcome
} from "../src/lib/shadowPositionMonitor.js";
import { reconcilePortfolio } from "../src/lib/shadowReconciliation.js";
import { startTradingDay } from "../src/lib/shadowTradingDay.js";
import { requestManualRiskClose } from "../src/lib/manualRiskClose.js";
import { runShadowProcessFills } from "../src/jobs/shadowProcessFills.js";
import { runShadowMonitorPositions } from "../src/jobs/shadowMonitorPositions.js";
import { EXECUTION_PROFILE_INTEGRITY_VIOLATION } from "../src/lib/executionProfileIntegrity.js";
import { loadShadowPortfolioValuation } from "../src/lib/shadowPortfolioValuation.js";

import { buildCandidateKey } from "@signalpilot/trading-domain";

import { Prisma } from "@signalpilot/database";

import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";
import {
  approvedExecutionProfileRow,
  approvedRiskSnapshotProfile
} from "./support/executionProfileRows.js";
import { pinnedRiskLimitSetRow } from "./support/riskLimitSetRows.js";

const CODE_VERSION = "test-code-version";
const CORRELATION_ID = "correlation-1";
const SAFE_LONG_CAPABILITY = Object.freeze({
  strategyV1Enabled: true,
  strategyLongV1Enabled: true,
  strategyShortV1Enabled: false,
  shadowShortEnabled: false,
  shadowOnlyBuild: true,
  enableLiveTrading: false,
  exchangeExecutionEnabled: false,
  marginTradingEnabled: false,
  futuresTradingEnabled: false
});
const SAFE_SHORT_CAPABILITY = Object.freeze({
  ...SAFE_LONG_CAPABILITY,
  strategyLongV1Enabled: false,
  strategyShortV1Enabled: true,
  shadowShortEnabled: true
});

function seedWorld(
  overrides: {
    readonly takeProfitPrice?: string;
    readonly direction?: "LONG" | "SHORT";
  } = {}
) {
  const { database, tables } = createFakeExecutionDatabase();
  const direction = overrides.direction ?? "LONG";

  const portfolio = tables.get("portfolio")!.create({
    data: {
      key: "SHADOW_V1",
      name: "Shadow Portfolio",
      baseCurrency: "USDT",
      status: "ACTIVE",
      startingCash: "10000.000000000000",
      availableCash: "10000.000000000000",
      reservedCash: "0.000000000000",
      realizedPnl: "0.000000000000",
      feesPaid: "0.000000000000",
      equity: "10000.000000000000",
      highWaterMark: "10000.000000000000",
      ledgerSequence: 1,
      lastReconciledAt: new Date("2026-08-02T00:00:00.000Z")
    }
  });

  tables.get("portfolioLedgerEntry")!.create({
    data: {
      entryKey: "ledger-entry.v1|initial-cash",
      portfolioId: portfolio.id,
      sequence: 1,
      type: "INITIAL_CASH",
      availableCashDelta: "10000.000000000000",
      reservedCashDelta: "0.000000000000",
      realizedPnlDelta: "0.000000000000",
      feeDelta: "0.000000000000",
      shadowOrderId: null,
      shadowFillId: null,
      shadowPositionId: null,
      correctionOfId: null,
      balanceAfterJson: {},
      occurredAt: new Date("2026-08-01T00:00:00.000Z")
    }
  });

  const session = tables.get("tradingSession")!.create({
    data: {
      sessionKey: "session-1",
      portfolioId: portfolio.id,
      mode: "SHADOW",
      status: "SHADOW_ACTIVE",
      killSwitchEngaged: false,
      reconciledAt: new Date("2026-08-02T00:00:00.000Z"),
      heartbeatAt: new Date("2026-08-02T00:00:00.000Z")
    }
  });

  // Pinned P3 limit set (docs/trading/06) — the post-fill CRV recheck reads
  // its own active RiskLimitSet.minRewardRisk fresh rather than trusting
  // anything cached on the candidate/assessment.
  tables.get("riskLimitSet")!.create({
    data: pinnedRiskLimitSetRow({ id: "risk-limit-set-1" })
  });

  const assetId = "asset-btc";
  tables.get("asset")!.create({ data: { id: assetId, symbol: "BTCUSDT" } });
  const strategy = tables.get("strategy")!.create({
    data: {
      id: "strategy-1",
      key:
        direction === "LONG"
          ? "CRYPTO_MTF_BREAKOUT_LONG_V1"
          : "CRYPTO_MTF_BREAKDOWN_SHORT_V1",
      status: "ACTIVE"
    }
  });
  tables.get("strategyVersion")!.create({
    data: {
      id: "strategy-version-1",
      strategyId: strategy.id,
      version: 1,
      status: "ACTIVE",
      parametersJson: { direction }
    }
  });
  tables.get("strategyAssignment")!.create({
    data: {
      id: "assignment-1",
      strategyId: strategy.id,
      strategyVersionId: "strategy-version-1",
      portfolioId: portfolio.id,
      assetId,
      enabled: true,
      assignmentConfigJson: { direction }
    }
  });
  const executionProfile = tables.get("instrumentExecutionProfile")!.create({
    data: approvedExecutionProfileRow("BTCUSDT", { assetId })
  });

  // Anchor candle C0 (not used for fill), and C1 which serves both as the
  // entry-fill candle and — with a wide range — the stop-first exit candle.
  tables.get("candle")!.create({
    data: {
      id: "candle-c0",
      assetId,
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: new Date("2026-08-02T08:00:00.000Z"),
      closeTime: new Date("2026-08-02T08:59:59.999Z"),
      open: "24000",
      high: "24150",
      low: "23950",
      close: "24100",
      volume: "1000",
      source: "BINANCE"
    }
  });
  const candleC1 = tables.get("candle")!.create({
    data: {
      id: "candle-c1",
      assetId,
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: new Date("2026-08-02T09:00:00.000Z"),
      closeTime: new Date("2026-08-02T09:59:59.999Z"),
      open: "24110",
      high: "25400",
      low: "23500",
      close: "24800",
      volume: "1000",
      source: "BINANCE"
    }
  });

  const referenceEntryPrice = "24100.000000000000";
  const stopPrice =
    direction === "LONG" ? "23600.000000000000" : "24600.000000000000";
  // Default clears the fee-inclusive post-fill net-CRV recheck at the actual
  // fill price with comfortable margin; tests that need to exercise the
  // same-candle stop/TP conflict or the CRV-shortfall path override this.
  const takeProfitPrice =
    overrides.takeProfitPrice ??
    (direction === "LONG" ? "25600.000000000000" : "22700.000000000000");

  const candidate = tables.get("tradeCandidate")!.create({
    data: {
      // A real composite key, exactly as the strategy engine builds it: it
      // contains "|" and must never be used as a single idempotency key part.
      candidateKey: buildCandidateKey({
        strategyAssignmentId: "assignment-1",
        strategyVersionId: "strategy-version-1",
        assetId,
        anchorCandleId: "candle-c0"
      }),
      strategyAssignmentId: "assignment-1",
      strategyVersionId: "strategy-version-1",
      portfolioId: portfolio.id,
      assetId,
      anchorCandleId: "candle-c0",
      anchorSignalId: null,
      direction,
      entryType: "MARKET",
      status: "APPROVED_FOR_SHADOW",
      referenceEntryPrice,
      stopPrice,
      takeProfitPrice,
      minimumRewardRisk: "2.000000000000",
      stopDistance: "500.000000000000",
      stopDistancePct: "0.020000000000",
      plannedRewardRisk: "2.500000000000",
      plannedEntryMinimum:
        direction === "LONG" ? stopPrice : "23850.000000000000",
      plannedEntryMaximum:
        direction === "LONG" ? "24350.000000000000" : stopPrice,
      maximumEntryGapDistance: "250.000000000000",
      validFrom: new Date("2026-08-02T09:00:00.000Z"),
      earliestFillAt: new Date("2026-08-02T09:00:00.000Z"),
      maxHoldHours: 72,
      strategyEngineVersion:
        direction === "LONG"
          ? "crypto-mtf-breakout-v1/1.0.0"
          : "crypto-mtf-breakdown-short-v1/1.0.0",
      strategySpecificationHash: "strategy-hash-1",
      strategyOutputHash: "strategy-output-1",
      dataAsOf: new Date("2026-08-02T08:59:59.999Z"),
      decisionTime: new Date("2026-08-02T08:59:59.999Z"),
      expiresAt: new Date("2026-08-02T10:59:59.999Z"),
      inputSnapshotJson: {},
      inputHash: "input-hash-1",
      strategyReasonCodes: []
    }
  });

  const riskAssessment = tables.get("riskAssessment")!.create({
    data: {
      tradeCandidateId: candidate.id,
      portfolioId: portfolio.id,
      riskLimitSetId: "risk-limit-set-1",
      assessmentKey: "assessment-1",
      status: "PASS",
      ruleSetVersion: "risk-rules-v1/1.0.0",
      equity: "10000.000000000000",
      availableCash: "10000.000000000000",
      reservedCash: "0.000000000000",
      dailyPnl: "0.000000000000",
      openPositionCount: 0,
      newTradesToday: 0,
      consecutiveLosses: 0,
      grossExposure: "0.000000000000",
      assetExposure: "0.000000000000",
      correlatedExposure: "0.000000000000",
      requestedQuantity: "0.100000000000",
      approvedQuantity: "0.100000000000",
      riskAmount: "25.000000000000",
      tradingDateUtc: new Date("2026-08-02T00:00:00.000Z"),
      portfolioSnapshotAsOf: new Date("2026-08-02T00:00:00.000Z"),
      marketDataAsOf: new Date("2026-08-02T08:59:59.999Z"),
      inputsJson: {
        snapshot: {
          executionProfile: approvedRiskSnapshotProfile(executionProfile)
        },
        sizing: {
          approvedQuantity: "0.100000000000",
          // Comfortably covers 0.1 * worst-case buy fill + fee at the 10bp/10bp
          // spread/slippage/fee profile below (real fill notional ≈ 2414.6 + ≈2.4 fee).
          reservedQuoteAmount:
            direction === "LONG" ? "2450.000000000000" : "2500.000000000000",
          worstEntryPrice:
            direction === "LONG" ? "24160.000000000000" : "24050.000000000000"
        }
      },
      inputHash: "risk-input-hash-1",
      outputHash: "risk-output-hash-1",
      assessedAt: new Date("2026-08-02T08:59:59.999Z")
    }
  });

  tables.get("tradeDecision")!.create({
    data: {
      tradeCandidateId: candidate.id,
      riskAssessmentId: riskAssessment.id,
      decisionKey: "decision-1",
      outcome: "APPROVE_SHADOW",
      reasonCode: "RISK_APPROVED",
      inputHash: "decision-input-1",
      outputHash: "decision-output-1",
      decidedAt: new Date("2026-08-02T08:59:59.999Z")
    }
  });

  return { database, tables, portfolio, session, candidate, candleC1, assetId };
}

describe("shadow order creation — one approval, one order, one reservation", () => {
  it("creates exactly one ShadowOrder and reserves the risk-approved amount", async () => {
    const { database, tables, portfolio, candidate } = seedWorld();

    const result = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    assert.equal(result.outcome, ShadowOrderOutcome.CREATED);
    assert.equal(tables.get("shadowOrder")!.rows.length, 1);
    const order = tables.get("shadowOrder")!.rows[0];
    assert.equal(order.reservedQuoteAmount, "2450.000000000000");
    assert.equal(order.status, "WAITING_FOR_ENTRY");

    const updatedPortfolio = tables
      .get("portfolio")!
      .rows.find((row) => row.id === portfolio.id)!;
    assert.equal(updatedPortfolio.availableCash, "7550.000000000000");
    assert.equal(updatedPortfolio.reservedCash, "2450.000000000000");

    const ledgerEntries = tables.get("portfolioLedgerEntry")!.rows;
    // Seeded INITIAL_CASH entry plus the new RESERVE entry from this call.
    assert.equal(ledgerEntries.length, 2);
    assert.equal(ledgerEntries[1].type, "RESERVE");
  });

  it("is idempotent: a second call for the same candidate creates nothing new", async () => {
    const { database, tables, candidate } = seedWorld();
    await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    const second = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    assert.equal(second.outcome, ShadowOrderOutcome.IDEMPOTENT_REPLAY);
    assert.equal(tables.get("shadowOrder")!.rows.length, 1);
    assert.equal(tables.get("portfolioLedgerEntry")!.rows.length, 2);
  });

  it("blocks when the session is not SHADOW_ACTIVE", async () => {
    const { database, tables, session, candidate } = seedWorld();
    tables
      .get("tradingSession")!
      .update({ where: { id: session.id }, data: { status: "PAUSED" } });

    const result = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    assert.equal(result.outcome, ShadowOrderOutcome.BLOCKED);
    assert.equal(tables.get("shadowOrder")!.rows.length, 0);
    // Only the seeded INITIAL_CASH entry — no RESERVE was ever written.
    assert.equal(tables.get("portfolioLedgerEntry")!.rows.length, 1);
  });

  it("blocks when the kill switch is engaged even if the status still reads SHADOW_ACTIVE", async () => {
    const { database, tables, session, candidate } = seedWorld();
    tables
      .get("tradingSession")!
      .update({ where: { id: session.id }, data: { killSwitchEngaged: true } });

    const result = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    assert.equal(result.outcome, ShadowOrderOutcome.BLOCKED);
    assert.equal(tables.get("shadowOrder")!.rows.length, 0);
  });
});

describe("entry fill — spread, slippage, fee and ledger/portfolio consistency", () => {
  it("fills the full quantity on the first eligible candle and opens the position", async () => {
    const { database, tables, portfolio, candidate, candleC1 } = seedWorld();
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    const fillResult = await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(fillResult.outcome, ShadowFillOutcome.FILLED);
    assert.equal(tables.get("shadowFill")!.rows.length, 1);
    const fill = tables.get("shadowFill")!.rows[0];
    // BUY fill above the candle open (adverse spread + slippage).
    assert.ok(Number.parseFloat(String(fill.fillPrice)) > 24110);
    assert.ok(Number.parseFloat(String(fill.feeAmount)) > 0);

    const position = tables.get("shadowPosition")!.rows[0];
    assert.equal(position.status, "OPEN");
    assert.equal(position.openQuantity, "0.100000000000");

    const order = tables
      .get("shadowOrder")!
      .rows.find((row) => row.id === orderResult.shadowOrderId)!;
    assert.equal(order.status, "FILLED");
    assert.equal(order.remainingQuantity, "0.000000000000");

    // Ledger stays balanced: available + reserved == starting cash - (fee already paid).
    const updatedPortfolio = tables
      .get("portfolio")!
      .rows.find((row) => row.id === portfolio.id)!;
    const available = Number.parseFloat(String(updatedPortfolio.availableCash));
    const reserved = Number.parseFloat(String(updatedPortfolio.reservedCash));
    assert.equal(reserved, 0);
    // Most of the reserve became the position's cost (not reflected in
    // availableCash); only the small unused excess plus fee refund/charge
    // moves availableCash near where it was right after the reservation.
    assert.ok(
      available > 7500 && available < 7600,
      `unexpected availableCash ${available}`
    );
  });

  it("never opens a normal position when the post-fill net-CRV recheck falls short", async () => {
    // Same fill economics as above, but a tighter take-profit target whose
    // gross R-multiple no longer survives the approved profile's spread,
    // slippage and fees (net CRV below the 2.0 minimum) — ADR 0009.
    const { database, tables, candidate, candleC1 } = seedWorld({
      takeProfitPrice: "25150.000000000000"
    });
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    const fillResult = await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(fillResult.outcome, ShadowFillOutcome.FILLED_CRV_SHORTFALL);

    // The fill itself and its ExitPlan still exist — it is never hidden.
    assert.equal(tables.get("shadowFill")!.rows.length, 1);
    const position = tables.get("shadowPosition")!.rows[0];
    assert.equal(position.status, "OPEN");
    assert.equal(position.openQuantity, "0.100000000000");
    assert.equal(tables.get("exitPlan")!.rows.length, 1);

    // A full fill has no remainder to cancel, but the shortfall is durably
    // flagged for a forced, risk-reducing close instead of a normal hold.
    const order = tables
      .get("shadowOrder")!
      .rows.find((row) => row.id === orderResult.shadowOrderId)!;
    assert.equal(order.status, "FILLED");

    const forcedExitEvents = tables
      .get("riskEvent")!
      .rows.filter(
        (row) =>
          row.shadowPositionId === position.id && row.severity === "CRITICAL"
      );
    assert.equal(forcedExitEvents.length, 1);
    assert.ok(
      forcedExitEvents[0].acknowledgedAt == null,
      "the forced-exit finding must start unacknowledged"
    );
    assert.equal(
      forcedExitEvents[0].reasonCode,
      "POST_FILL_NET_CRV_BELOW_MINIMUM"
    );

    const markedEvents = tables
      .get("shadowPositionEvent")!
      .rows.filter(
        (row) => row.shadowPositionId === position.id && row.type === "MARKED"
      );
    assert.equal(markedEvents.length, 1);
  });

  it("cancels the unfilled remainder and releases its reserve on a partial fill that falls short", async () => {
    // A thin candle caps the fill at 1 % of its own volume, leaving most of
    // the order unfilled; the shortfall must not keep chasing more exposure.
    const { database, tables, portfolio, candidate, candleC1 } = seedWorld({
      takeProfitPrice: "25150.000000000000"
    });
    tables
      .get("candle")!
      .update({ where: { id: candleC1.id }, data: { volume: "0.1" } });

    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    const reservedAtAcceptance = Number.parseFloat(
      String(
        tables
          .get("shadowOrder")!
          .rows.find((row) => row.id === orderResult.shadowOrderId)!
          .reservedQuoteAmount
      )
    );

    const fillResult = await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(fillResult.outcome, ShadowFillOutcome.FILLED_CRV_SHORTFALL);
    const order = tables
      .get("shadowOrder")!
      .rows.find((row) => row.id === orderResult.shadowOrderId)!;
    assert.equal(order.status, "CANCELLED");
    assert.equal(order.cancelReasonCode, "POST_FILL_NET_CRV_BELOW_MINIMUM");
    assert.ok(
      Number.parseFloat(String(order.filledQuantity)) > 0,
      "the partial fill itself must still stand"
    );
    assert.equal(Number.parseFloat(String(order.reservedQuoteAmount)), 0);

    // The unfilled remainder's reserve came back to availableCash — nothing
    // simply vanished from the books.
    const updatedPortfolio = tables
      .get("portfolio")!
      .rows.find((row) => row.id === portfolio.id)!;
    const releaseEntries = tables
      .get("portfolioLedgerEntry")!
      .rows.filter(
        (row) => row.type === "RELEASE" && row.shadowOrderId === order.id
      );
    assert.equal(releaseEntries.length, 1);
    assert.ok(
      Number.parseFloat(String(updatedPortfolio.availableCash)) >
        10000 - reservedAtAcceptance
    );
  });
});

describe("entry fill — post-fill recheck against a deviating risk limit set (ADR 0021)", () => {
  const fillWithTamperedLimitSet = async (override: Record<string, unknown>) => {
    const { database, tables, portfolio, session, candidate, candleC1 } = seedWorld();
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id as string,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    // The row changes between approval and fill; the stored hash stays v1.
    Object.assign(tables.get("riskLimitSet")!.rows[0]!, override);
    const fillResult = await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id as string,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    return { tables, portfolio, session, fillResult };
  };

  for (const [label, override, field] of [
    ["a lowered minimum reward/risk", { minRewardRisk: new Prisma.Decimal("1") }, "minRewardRisk"],
    ["a raised risk per trade", { maxRiskPerTradePct: new Prisma.Decimal("0.01") }, "maxRiskPerTradePct"],
    ["a foreign scope", { scope: "STRATEGY" }, "scope"]
  ] as const) {
    it(`fails closed and locks on ${label} although the hash still matches`, async () => {
      const { tables, portfolio, session, fillResult } =
        await fillWithTamperedLimitSet(override);

      // The fill is booked and never hidden, but treated as a shortfall.
      assert.equal(fillResult.outcome, ShadowFillOutcome.FILLED_CRV_SHORTFALL);
      assert.equal(tables.get("shadowFill")!.rows.length, 1);
      const position = tables.get("shadowPosition")!.rows[0]!;
      const marked = tables
        .get("shadowPositionEvent")!
        .rows.filter((row) => row.shadowPositionId === position.id && row.type === "MARKED");
      assert.equal(marked.length, 1);

      const events = tables.get("riskEvent")!.rows;
      const forcedExit = events.find((row) => row.type === "RISK_RULE_BLOCK")!;
      assert.equal(forcedExit.severity, "CRITICAL");
      assert.equal(forcedExit.reasonCode, "POST_FILL_RISK_LIMIT_SET_INVALID");
      assert.deepEqual(
        (forcedExit.payloadJson as { riskLimitSetDeviations: string[] }).riskLimitSetDeviations,
        [field]
      );
      const lockEvent = events.find((row) => row.type === "SIMULATION_ERROR")!;
      assert.equal(lockEvent.severity, "CRITICAL");
      assert.equal(lockEvent.reasonCode, "POST_FILL_RISK_LIMIT_SET_INVALID");

      const lockedSession = tables.get("tradingSession")!.rows.find((row) => row.id === session.id)!;
      assert.equal(lockedSession.status, "ERROR_LOCKED");
      assert.equal(lockedSession.killSwitchEngaged, true);
      const lockedPortfolio = tables.get("portfolio")!.rows.find((row) => row.id === portfolio.id)!;
      assert.equal(lockedPortfolio.status, "ERROR_LOCKED");
    });
  }

  it("leaves an ordinary fill with the pinned set untouched: no lock, no deviation payload", async () => {
    const { tables, portfolio, session, fillResult } = await fillWithTamperedLimitSet({});
    assert.equal(fillResult.outcome, ShadowFillOutcome.FILLED);
    assert.equal(tables.get("riskEvent")!.rows.length, 0);
    assert.equal(
      tables.get("tradingSession")!.rows.find((row) => row.id === session.id)!.status,
      "SHADOW_ACTIVE"
    );
    assert.equal(
      tables.get("portfolio")!.rows.find((row) => row.id === portfolio.id)!.status,
      "ACTIVE"
    );
  });
});

describe("fill job — only the portfolios the scheduler cleared", () => {
  it("leaves an order untouched while its own portfolio is not entry-ready", async () => {
    const { database, tables, portfolio, candidate } = seedWorld();
    await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    const options = {
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      env: {
        ENABLE_LIVE_TRADING: "false",
        TRADING_MODE: "SHADOW",
        TRADING_SHADOW_ENABLED: "true",
        TRADING_STRATEGY_V1_ENABLED: "true",
        TRADING_STRATEGY_LONG_V1_ENABLED: "true",
        TRADING_SHADOW_EXECUTION_ENABLED: "true"
      }
    };

    const blocked = await runShadowProcessFills(database as never, { ...options, portfolioIds: ["portfolio-challenger"] });
    assert.equal(blocked.scanned, 0);
    assert.equal(tables.get("shadowFill")!.rows.length, 0);

    const cleared = await runShadowProcessFills(database as never, { ...options, portfolioIds: [portfolio.id] });
    assert.equal(cleared.scanned, 1);
    assert.equal(tables.get("shadowFill")!.rows.length, 1);
  });
});

describe("position monitor — forced MANUAL_RISK_CLOSE after a post-fill CRV shortfall", () => {
  it("closes the position at the next candle's close when no harder stop/TP fires first", async () => {
    const { database, tables, candidate, candleC1 } = seedWorld({
      takeProfitPrice: "25150.000000000000"
    });
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    const fillResult = await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(fillResult.outcome, ShadowFillOutcome.FILLED_CRV_SHORTFALL);
    const position = tables.get("shadowPosition")!.rows[0];

    // A quiet follow-up candle: nowhere near the stop (23600) or the take
    // profit (25150), so the ordinary exit resolution finds nothing.
    const candleC2 = tables.get("candle")!.create({
      data: {
        id: "candle-c2-quiet",
        assetId: candidate.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: new Date("2026-08-02T10:00:00.000Z"),
        closeTime: new Date("2026-08-02T10:59:59.999Z"),
        open: "24150",
        high: "24250",
        low: "24050",
        close: "24180",
        volume: "1000",
        source: "BINANCE"
      }
    });

    const monitorResult = await monitorPositionForCandle(database as never, {
      shadowPositionId: position.id,
      candleId: candleC2.id,
      asOf: new Date("2026-08-02T11:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(monitorResult.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    const closedPosition = tables
      .get("shadowPosition")!
      .rows.find((row) => row.id === position.id)!;
    assert.equal(closedPosition.status, "CLOSED");
    assert.equal(closedPosition.openQuantity, "0.000000000000");

    const exitFill = tables
      .get("shadowFill")!
      .rows.find((row) => row.triggerType === "MANUAL_RISK_CLOSE");
    assert.ok(exitFill !== undefined);
    // Priced at C2's close, not its open — the request arose only after C1's
    // open had already been used for the entry fill.
    assert.equal(Number.parseFloat(String(exitFill!.referencePrice)), 24180);
  });
});

describe("position monitor — exit on a closed regime gate (CRYPTO_REGIME_LONG_V1)", () => {
  const nativeReport = (cryptoRegime: string) => ({
    equityRegime: "UNKNOWN",
    cryptoRegime,
    overallRegime: cryptoRegime,
    riskMode: cryptoRegime === "RISK_ON" ? "AGGRESSIVE" : "DEFENSIVE",
    confidence: 90
  });

  async function openWithPolicy(parametersJson: Record<string, unknown>, cryptoRegime: string) {
    const world = seedWorld();
    const { database, tables, candidate, candleC1 } = world;
    tables.get("strategyVersion")!.rows[0].parametersJson = parametersJson;
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    // The regime generated during the quiet candle below, before its close.
    tables.get("marketRegimeSnapshot")!.create({
      data: {
        id: `regime-${cryptoRegime}`,
        generatedAt: new Date("2026-08-02T10:00:21.000Z"),
        equityRegime: "UNKNOWN",
        cryptoRegime: "MIXED",
        overallRegime: "MIXED",
        riskMode: "DEFENSIVE",
        confidence: 18,
        reportJson: { cryptoNative: nativeReport(cryptoRegime) }
      }
    });
    const quiet = tables.get("candle")!.create({
      data: {
        id: "candle-c2-quiet",
        assetId: candidate.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: new Date("2026-08-02T10:00:00.000Z"),
        closeTime: new Date("2026-08-02T10:59:59.999Z"),
        open: "24150",
        high: "24250",
        low: "24050",
        close: "24180",
        volume: "1000",
        source: "BINANCE"
      }
    });
    const position = tables.get("shadowPosition")!.rows[0];
    const result = await monitorPositionForCandle(database as never, {
      shadowPositionId: position.id,
      candleId: quiet.id,
      asOf: new Date("2026-08-02T11:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    return { result, tables, position };
  }

  const regimeLongParameters = {
    direction: "LONG",
    exitPolicy: REGIME_EXIT_POLICY,
    regimeSource: CRYPTO_NATIVE_REGIME_SOURCE,
    maxRegimeAgeMs: 26 * 60 * 60 * 1000
  };

  it("keeps the position while the crypto-native gate is open", async () => {
    const { result } = await openWithPolicy(regimeLongParameters, "RISK_ON");
    assert.equal(result.outcome, ShadowMonitorOutcome.NO_TRIGGER);
  });

  it("closes it at the candle's close as INVALIDATED once the gate is shut", async () => {
    const { result, tables, position } = await openWithPolicy(regimeLongParameters, "MIXED");
    assert.equal(result.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    const closed = tables.get("shadowPosition")!.rows.find((row) => row.id === position.id)!;
    assert.equal(closed.status, "INVALIDATED");
    const exitFill = tables.get("shadowFill")!.rows.find((row) => row.triggerType === "INVALIDATION");
    assert.ok(exitFill !== undefined);
    assert.equal(Number.parseFloat(String(exitFill!.referencePrice)), 24180);
  });

  it("never touches a version without the exit policy, whatever the regime", async () => {
    const { result } = await openWithPolicy({ direction: "LONG", regimeSource: CRYPTO_NATIVE_REGIME_SOURCE }, "MIXED");
    assert.equal(result.outcome, ShadowMonitorOutcome.NO_TRIGGER);
  });
});

describe("position monitor — stop and take-profit in the same candle resolve stop-first", () => {
  it("closes the position as STOPPED_OUT and books a negative net P&L when both thresholds are in range", async () => {
    // TP pinned to the tighter value so candle C2's high (25400) still
    // reaches it — this test needs both stop and TP reachable in one candle,
    // not a comfortable post-fill CRV margin.
    const { database, tables, portfolio, candidate, candleC1 } = seedWorld({
      takeProfitPrice: "25350.000000000000"
    });
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });
    await processEntryOrderFillForCandle(database as never, {
      shadowOrderId: orderResult.shadowOrderId!,
      candleId: candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    const position = tables.get("shadowPosition")!.rows[0];

    // C2: low breaches the stop (23600) AND high breaches the take profit
    // (25350) in the same candle -> STOP_FIRST is mandatory.
    const candleC2 = tables.get("candle")!.create({
      data: {
        id: "candle-c2",
        assetId: candidate.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: new Date("2026-08-02T10:00:00.000Z"),
        closeTime: new Date("2026-08-02T10:59:59.999Z"),
        open: "24500",
        high: "25400",
        low: "23500",
        close: "24800",
        volume: "1000",
        source: "BINANCE"
      }
    });

    const monitorResult = await monitorPositionForCandle(database as never, {
      shadowPositionId: position.id,
      candleId: candleC2.id,
      asOf: new Date("2026-08-02T11:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(monitorResult.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);

    const closedPosition = tables
      .get("shadowPosition")!
      .rows.find((row) => row.id === position.id)!;
    assert.equal(closedPosition.status, "STOPPED_OUT");
    assert.equal(closedPosition.openQuantity, "0.000000000000");
    assert.ok(
      Number.parseFloat(String(closedPosition.realizedPnl)) < 0,
      "a stop-out must realize a net loss"
    );

    const exitFill = tables
      .get("shadowFill")!
      .rows.find((row) => row.triggerType === "STOP");
    assert.ok(exitFill !== undefined);
    // Sell fill priced below the stop's own reference (adverse spread/slippage).
    assert.ok(Number.parseFloat(String(exitFill!.fillPrice)) < 23600);

    const updatedPortfolio = tables
      .get("portfolio")!
      .rows.find((row) => row.id === portfolio.id)!;
    assert.equal(updatedPortfolio.reservedCash, "0.000000000000");
  });
});

describe("synthetic SHORT worker lifecycle", () => {
  async function openShort(options: { partial?: boolean } = {}) {
    const world = seedWorld({ direction: "SHORT" });
    if (options.partial) {
      world.tables
        .get("candle")!
        .update({ where: { id: world.candleC1.id }, data: { volume: "0.1" } });
    }
    const order = await createShadowOrderForCandidate(world.database as never, {
      tradeCandidateId: world.candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_SHORT_CAPABILITY
    });
    assert.equal(order.outcome, ShadowOrderOutcome.CREATED);
    const fill = await processEntryOrderFillForCandle(world.database as never, {
      shadowOrderId: order.shadowOrderId!,
      candleId: world.candleC1.id,
      asOf: new Date("2026-08-02T10:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    return { ...world, order, fill };
  }

  function addCandle(
    tables: ReturnType<typeof createFakeExecutionDatabase>["tables"],
    input: {
      id: string;
      openTime: string;
      open: string;
      high: string;
      low: string;
      close: string;
    }
  ) {
    const openTime = new Date(input.openTime);
    return tables.get("candle")!.create({
      data: {
        id: input.id,
        assetId: "asset-btc",
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime,
        closeTime: new Date(openTime.getTime() + 3_599_999),
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        volume: "1000",
        source: "BINANCE"
      }
    });
  }

  it("uses SELL entry fills, retains unleveraged collateral and completes a partial fill", async () => {
    const world = await openShort({ partial: true });
    assert.equal(world.fill.outcome, ShadowFillOutcome.PARTIALLY_FILLED);
    const firstFill = world.tables.get("shadowFill")!.rows[0];
    assert.equal(firstFill.side, "SELL");
    assert.ok(Number(firstFill.fillPrice) < Number(firstFill.referencePrice));

    const partialPosition = world.tables.get("shadowPosition")!.rows[0];
    assert.equal(partialPosition.direction, "SHORT");
    assert.ok(Number(partialPosition.reservedCollateral) > 0);
    assert.ok(Number(world.tables.get("portfolio")!.rows[0].reservedCash) > 0);

    const fillCountBeforeReplay = world.tables.get("shadowFill")!.rows.length;
    const ledgerCountBeforeReplay = world.tables.get("portfolioLedgerEntry")!
      .rows.length;
    const replay = await processEntryOrderFillForCandle(
      world.database as never,
      {
        shadowOrderId: world.order.shadowOrderId!,
        candleId: world.candleC1.id,
        asOf: new Date("2026-08-02T10:00:01.000Z"),
        codeVersion: CODE_VERSION,
        correlationId: `${CORRELATION_ID}-replay`
      }
    );
    assert.equal(replay.outcome, ShadowFillOutcome.ALREADY_PROCESSED);
    assert.equal(
      world.tables.get("shadowFill")!.rows.length,
      fillCountBeforeReplay
    );
    assert.equal(
      world.tables.get("portfolioLedgerEntry")!.rows.length,
      ledgerCountBeforeReplay
    );

    const next = addCandle(world.tables, {
      id: "short-entry-c2",
      openTime: "2026-08-02T10:00:00.000Z",
      open: "24100",
      high: "24300",
      low: "24000",
      close: "24200"
    });
    const completed = await processEntryOrderFillForCandle(
      world.database as never,
      {
        shadowOrderId: world.order.shadowOrderId!,
        candleId: next.id,
        asOf: new Date("2026-08-02T11:00:00.000Z"),
        codeVersion: CODE_VERSION,
        correlationId: CORRELATION_ID
      }
    );
    assert.equal(completed.outcome, ShadowFillOutcome.FILLED);
    assert.equal(world.tables.get("shadowFill")!.rows.length, 2);
    assert.ok(
      world.tables.get("shadowFill")!.rows.every((row) => row.side === "SELL")
    );
    assert.equal(world.tables.get("shadowPosition")!.rows.length, 1);
    assert.equal(world.tables.get("shadowOrder")!.rows[0].status, "FILLED");
  });

  it("resolves SHORT stop, TP, time exit and an intrabar conflict conservatively", async () => {
    const cases = [
      {
        name: "stop",
        id: "short-stop",
        openTime: "2026-08-02T10:00:00.000Z",
        open: "24200",
        high: "24700",
        low: "23900",
        close: "24300",
        trigger: "STOP",
        pnl: "loss"
      },
      {
        name: "tp",
        id: "short-tp",
        openTime: "2026-08-02T10:00:00.000Z",
        open: "23900",
        high: "24200",
        low: "22600",
        close: "23000",
        trigger: "TAKE_PROFIT",
        pnl: "win"
      },
      {
        name: "conflict",
        id: "short-conflict",
        openTime: "2026-08-02T10:00:00.000Z",
        open: "24200",
        high: "24700",
        low: "22600",
        close: "23500",
        trigger: "STOP",
        pnl: "loss"
      },
      {
        name: "time",
        id: "short-time",
        openTime: "2026-08-05T09:00:00.000Z",
        open: "24000",
        high: "24200",
        low: "23900",
        close: "24050",
        trigger: "TIME_EXIT",
        pnl: "loss"
      }
    ] as const;

    for (const testCase of cases) {
      const world = await openShort();
      assert.equal(world.fill.outcome, ShadowFillOutcome.FILLED, testCase.name);
      const position = world.tables.get("shadowPosition")!.rows[0];
      const candle = addCandle(world.tables, testCase);
      const result = await monitorPositionForCandle(world.database as never, {
        shadowPositionId: position.id as string,
        candleId: candle.id as string,
        asOf: new Date((candle.closeTime as Date).getTime() + 1),
        codeVersion: CODE_VERSION,
        correlationId: `${CORRELATION_ID}-${testCase.name}`
      });
      assert.equal(
        result.outcome,
        ShadowMonitorOutcome.TRIGGERED_CLOSED,
        testCase.name
      );
      const exitFill = world.tables
        .get("shadowFill")!
        .rows.find((row) => row.triggerType !== "ENTRY")!;
      assert.equal(exitFill.triggerType, testCase.trigger, testCase.name);
      assert.equal(exitFill.side, "BUY", testCase.name);
      const closed = world.tables.get("shadowPosition")!.rows[0];
      assert.equal(Number(closed.reservedCollateral), 0, testCase.name);
      assert.equal(
        Number(world.tables.get("portfolio")!.rows[0].reservedCash),
        0,
        testCase.name
      );
      assert.equal(
        testCase.pnl === "win"
          ? Number(closed.realizedPnl) > 0
          : Number(closed.realizedPnl) < 0,
        true,
        testCase.name
      );
    }
  });

  it("executes a requested manual SHORT risk close and reconciles its ledger", async () => {
    const world = await openShort();
    assert.equal(world.fill.outcome, ShadowFillOutcome.FILLED);
    const position = world.tables.get("shadowPosition")!.rows[0];
    const request = await requestManualRiskClose(world.database as never, {
      shadowPositionId: position.id as string,
      actorId: "operator",
      reasonNote: "risk drill",
      idempotencyKey: "manual-short-close-1",
      asOf: new Date("2026-08-02T10:05:00.000Z")
    });
    assert.equal(request.ok, true);
    const candle = addCandle(world.tables, {
      id: "short-manual",
      openTime: "2026-08-02T10:00:00.000Z",
      open: "23800",
      high: "24200",
      low: "23700",
      close: "23850"
    });
    await monitorPositionForCandle(world.database as never, {
      shadowPositionId: position.id as string,
      candleId: candle.id as string,
      asOf: new Date("2026-08-02T11:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    const exitFill = world.tables
      .get("shadowFill")!
      .rows.find((row) => row.triggerType === "MANUAL_RISK_CLOSE");
    assert.equal(exitFill?.side, "BUY");
    const reconciliation = await reconcilePortfolio(world.database as never, {
      portfolioId: world.portfolio.id as string,
      asOf: new Date("2026-08-02T11:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: "short-reconcile"
    });
    assert.equal(
      reconciliation.consistent,
      true,
      JSON.stringify(reconciliation.violations)
    );
  });

  it("detects contradictory direction and missing SHORT collateral and fail-closes the session", async () => {
    const world = await openShort();
    assert.equal(world.fill.outcome, ShadowFillOutcome.FILLED);
    const position = world.tables.get("shadowPosition")!.rows[0];
    world.tables.get("strategyAssignment")!.update({
      where: { id: position.strategyAssignmentId },
      data: { assignmentConfigJson: { direction: "LONG" } }
    });
    world.tables.get("shadowPosition")!.update({
      where: { id: position.id },
      data: { reservedCollateral: "0.000000000000" }
    });

    const reconciliation = await reconcilePortfolio(world.database as never, {
      portfolioId: world.portfolio.id as string,
      asOf: new Date("2026-08-02T10:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: "short-reconcile-direction-collateral"
    });

    assert.equal(reconciliation.consistent, false);
    assert.ok(
      reconciliation.violations.includes(
        "PORTFOLIO_DIRECTION_MISMATCH" as never
      )
    );
    assert.ok(
      reconciliation.violations.includes(
        "PORTFOLIO_COLLATERAL_MISMATCH" as never
      )
    );
    const session = world.tables.get("tradingSession")!.rows[0];
    assert.equal(session.status, "ERROR_LOCKED");
    assert.equal(session.killSwitchEngaged, true);
  });

  it("detects a corrupted SHORT realized-PnL sign during replay", async () => {
    const world = await openShort();
    const position = world.tables.get("shadowPosition")!.rows[0];
    const candle = addCandle(world.tables, {
      id: "short-pnl-reconcile",
      openTime: "2026-08-02T10:00:00.000Z",
      open: "23900",
      high: "24200",
      low: "22600",
      close: "23000"
    });
    await monitorPositionForCandle(world.database as never, {
      shadowPositionId: position.id as string,
      candleId: candle.id as string,
      asOf: new Date("2026-08-02T11:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: "short-pnl-close"
    });
    world.tables.get("shadowPosition")!.update({
      where: { id: position.id },
      data: { realizedPnl: "-100.000000000000" }
    });

    const reconciliation = await reconcilePortfolio(world.database as never, {
      portfolioId: world.portfolio.id as string,
      asOf: new Date("2026-08-02T11:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: "short-reconcile-pnl"
    });
    assert.equal(reconciliation.consistent, false);
    assert.ok(
      reconciliation.violations.includes("PORTFOLIO_PNL_SIGN_MISMATCH" as never)
    );
  });
});

describe("reconciliation — consistent portfolio succeeds, an induced mismatch locks the session", () => {
  it("marks lastReconciledAt on a clean replay", async () => {
    const { database, tables, portfolio, candidate } = seedWorld();
    await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    const result = await reconcilePortfolio(database as never, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T09:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(result.consistent, true);
    const updatedPortfolio = tables
      .get("portfolio")!
      .rows.find((row) => row.id === portfolio.id)!;
    assert.ok(updatedPortfolio.lastReconciledAt !== null);
  });

  it("locks the session and raises a critical RiskEvent when the cache diverges from the ledger", async () => {
    const { database, tables, portfolio, session, candidate } = seedWorld();
    await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: SAFE_LONG_CAPABILITY
    });

    // Corrupt the cache: availableCash no longer matches what the ledger replay implies.
    tables
      .get("portfolio")!
      .update({
        where: { id: portfolio.id },
        data: { availableCash: "9000.000000000000" }
      });

    const result = await reconcilePortfolio(database as never, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T09:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(result.consistent, false);
    assert.ok(
      result.violations.includes(
        "PORTFOLIO_CACHE_MISMATCH_LEDGER_REPLAY" as never
      )
    );

    const updatedSession = tables
      .get("tradingSession")!
      .rows.find((row) => row.id === session.id)!;
    assert.equal(updatedSession.status, "ERROR_LOCKED");
    assert.equal(updatedSession.killSwitchEngaged, true);

    const criticalEvents = tables
      .get("riskEvent")!
      .rows.filter((row) => row.severity === "CRITICAL");
    assert.ok(criticalEvents.length > 0);
  });
});

describe("start-of-day rollover — idempotent", () => {
  it("creates one snapshot per UTC day and no-ops on a second call", async () => {
    const { database, tables, portfolio } = seedWorld();

    const first = await startTradingDay(database as never, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T00:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(first.outcome, "CREATED");
    assert.equal(tables.get("portfolioSnapshot")!.rows.length, 1);

    const second = await startTradingDay(database as never, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T08:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(second.outcome, "ALREADY_STARTED");
    assert.equal(tables.get("portfolioSnapshot")!.rows.length, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Execution profile integrity (ADR 0023, option W). Every manipulation keeps
// the approved row's id and hash text unless the hash is the manipulation.
// ───────────────────────────────────────────────────────────────────────────

type World = ReturnType<typeof seedWorld>;

const PROFILE_MANIPULATIONS: ReadonlyArray<
  readonly [string, Record<string, unknown>, string]
> = [
  ["fee 0 bp", { feeBps: 0 }, "feeBps"],
  ["spread 0 bp", { fullSpreadBps: 0 }, "fullSpreadBps"],
  ["slippage 0 bp", { slippageBps: 0 }, "slippageBps"],
  ["a stricter fee", { feeBps: 25 }, "feeBps"],
  ["another tick size", { tickSize: new Prisma.Decimal("0.000000000001") }, "tickSize"],
  ["another step size", { stepSize: new Prisma.Decimal("0.001") }, "stepSize"],
  ["another minimum notional", { minNotional: new Prisma.Decimal("0.000000000001") }, "minNotional"],
  ["another participation rate", { maxParticipationRate: new Prisma.Decimal("1") }, "maxParticipationRate"],
  ["a foreign hash text", { specificationHash: "f".repeat(64) }, "specificationHash"],
  ["another version", { version: 99 }, "version"],
  ["another source", { source: "MANUAL_CONSERVATIVE_V1" }, "source"]
];

const profileRow = (world: World) =>
  world.tables.get("instrumentExecutionProfile")!.rows[0]!;
const tamperProfile = (world: World, override: Record<string, unknown>) =>
  Object.assign(profileRow(world), override);
const addIntruderProfile = (world: World, override: Record<string, unknown> = {}) =>
  world.tables.get("instrumentExecutionProfile")!.create({
    data: approvedExecutionProfileRow("BTCUSDT", {
      assetId: world.assetId,
      version: 7,
      feeBps: 0,
      ...override
    })
  });

const createOrder = (world: World) =>
  createShadowOrderForCandidate(world.database as never, {
    tradeCandidateId: world.candidate.id as string,
    asOf: new Date("2026-08-02T09:00:05.000Z"),
    codeVersion: CODE_VERSION,
    correlationId: CORRELATION_ID,
    capability: SAFE_LONG_CAPABILITY
  });
const fillEntry = (world: World, shadowOrderId: string, candleId = world.candleC1.id as string) =>
  processEntryOrderFillForCandle(world.database as never, {
    shadowOrderId,
    candleId,
    asOf: new Date("2026-08-02T12:00:00.000Z"),
    codeVersion: CODE_VERSION,
    correlationId: CORRELATION_ID
  });
/** A candle whose low (23500) breaches the stop (23600): a stop-first exit. */
const addStopCandle = (world: World) =>
  world.tables.get("candle")!.create({
    data: {
      id: "candle-c2-stop",
      assetId: world.assetId,
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: new Date("2026-08-02T10:00:00.000Z"),
      closeTime: new Date("2026-08-02T10:59:59.999Z"),
      open: "24000",
      high: "24100",
      low: "23500",
      close: "23700",
      volume: "1000",
      source: "BINANCE"
    }
  });
const monitor = (world: World, positionId: string, candleId: string) =>
  monitorPositionForCandle(world.database as never, {
    shadowPositionId: positionId,
    candleId,
    asOf: new Date("2026-08-02T11:00:00.000Z"),
    codeVersion: CODE_VERSION,
    correlationId: CORRELATION_ID
  });

const integrityEvents = (world: World) =>
  world.tables
    .get("riskEvent")!
    .rows.filter((row) => row.reasonCode === EXECUTION_PROFILE_INTEGRITY_VIOLATION);

/** New entries are stopped: session and portfolio locked, one CRITICAL finding with the fields. */
const assertEntriesLocked = (world: World, fields: readonly string[], label: string) => {
  const session = world.tables.get("tradingSession")!.rows[0]!;
  assert.equal(session.status, "ERROR_LOCKED", label);
  assert.equal(session.killSwitchEngaged, true, label);
  assert.equal(session.killReasonCode, EXECUTION_PROFILE_INTEGRITY_VIOLATION, label);
  assert.equal(world.tables.get("portfolio")!.rows[0]!.status, "ERROR_LOCKED", label);
  const events = integrityEvents(world);
  assert.equal(events.length, 1, label);
  assert.equal(events[0]!.severity, "CRITICAL", label);
  assert.equal(events[0]!.type, "CONFIGURATION_INVALID", label);
  assert.deepEqual((events[0]!.payloadJson as { deviations: string[] }).deviations, [...fields], label);
  assert.equal(
    world.tables.get("tradingAuditEvent")!.rows.filter((row) => row.eventType === "SESSION_ERROR_LOCKED").length,
    1,
    label
  );
};

/** An open LONG position entered with the approved profile. */
const openApprovedPosition = async (world: World) => {
  const order = await createOrder(world);
  assert.equal(order.outcome, ShadowOrderOutcome.CREATED);
  const fill = await fillEntry(world, order.shadowOrderId!);
  assert.equal(fill.outcome, ShadowFillOutcome.FILLED);
  return world.tables.get("shadowPosition")!.rows[0]!;
};

describe("execution profile integrity — order creation (ADR 0023)", () => {
  for (const [label, override, field] of PROFILE_MANIPULATIONS) {
    it(`refuses ${label} after approval: no order, no reserve, entries locked`, async () => {
      const world = seedWorld();
      tamperProfile(world, override);
      const result = await createOrder(world);
      assert.equal(result.outcome, ShadowOrderOutcome.BLOCKED, label);
      assert.equal(result.reasonCode, ShadowOrderReasonCode.EXECUTION_PROFILE_INVALID, label);
      assert.equal(world.tables.get("shadowOrder")!.rows.length, 0, label);
      const portfolio = world.tables.get("portfolio")!.rows[0]!;
      assert.equal(portfolio.reservedCash, "0.000000000000", label);
      assert.equal(portfolio.availableCash, "10000.000000000000", label);
      assertEntriesLocked(world, [field], label);
    });
  }

  it("refuses a second ACTIVE row, even one that only copies the approved values", async () => {
    const world = seedWorld();
    addIntruderProfile(world, { feeBps: 10 });
    const result = await createOrder(world);
    assert.equal(result.reasonCode, ShadowOrderReasonCode.EXECUTION_PROFILE_INVALID);
    assertEntriesLocked(world, ["version", "activeProfileCount"], "second ACTIVE row");
  });

  it("refuses an approval that was priced with other values than the approved profile", async () => {
    const world = seedWorld();
    const assessment = world.tables.get("riskAssessment")!.rows[0]!;
    const inputs = assessment.inputsJson as { snapshot: { executionProfile: Record<string, unknown> } };
    inputs.snapshot.executionProfile = { ...inputs.snapshot.executionProfile, feeBps: 0, slippageBps: 0 };
    const result = await createOrder(world);
    assert.equal(result.reasonCode, ShadowOrderReasonCode.EXECUTION_PROFILE_INVALID);
    assert.equal(world.tables.get("shadowOrder")!.rows.length, 0);
    assertEntriesLocked(world, ["feeBps", "slippageBps"], "assessed values");
  });

  it("treats a version switch to another approved row as a change, not as tampering", async () => {
    const world = seedWorld();
    // Calibration retired the row the approval used and activated a new one
    // with the approved values: the order is refused as before, nothing locks.
    tamperProfile(world, { status: "RETIRED", activeAssetKey: null });
    world.tables.get("instrumentExecutionProfile")!.create({
      data: approvedExecutionProfileRow("BTCUSDT", { assetId: world.assetId })
    });
    const result = await createOrder(world);
    assert.equal(result.reasonCode, ShadowOrderReasonCode.EXECUTION_PROFILE_CHANGED);
    assert.equal(world.tables.get("portfolio")!.rows[0]!.status, "ACTIVE");
    assert.equal(world.tables.get("tradingSession")!.rows[0]!.status, "SHADOW_ACTIVE");
    assert.equal(integrityEvents(world).length, 0);
  });

  it("copies the approved profile into the order snapshot unchanged", async () => {
    const world = seedWorld();
    const result = await createOrder(world);
    assert.equal(result.outcome, ShadowOrderOutcome.CREATED);
    const order = world.tables.get("shadowOrder")!.rows[0]!;
    assert.deepEqual(order.costModelSnapshotJson, {
      feeBps: 10,
      fullSpreadBps: 2,
      slippageBps: 3,
      maxParticipationRate: "0.010000000000",
      executionProfileId: profileRow(world).id,
      executionProfileSpecificationHash:
        "0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13"
    });
    assert.equal(integrityEvents(world).length, 0);
  });
});

describe("execution profile integrity — entry fill and post-fill recheck (ADR 0023)", () => {
  const assertNoNewExposure = (world: World, shadowOrderId: string, label: string) => {
    const order = world.tables.get("shadowOrder")!.rows.find((row) => row.id === shadowOrderId)!;
    assert.equal(order.status, "EXPIRED", label);
    assert.equal(order.cancelReasonCode, EXECUTION_PROFILE_INTEGRITY_VIOLATION, label);
    assert.equal(order.reservedQuoteAmount, "0", label);
    assert.equal(world.tables.get("shadowFill")!.rows.length, 0, label);
    assert.equal(world.tables.get("shadowPosition")!.rows.length, 0, label);
    const portfolio = world.tables.get("portfolio")!.rows[0]!;
    assert.equal(Number(portfolio.reservedCash), 0, label);
    assert.equal(Number(portfolio.availableCash), 10000, label);
  };

  for (const [label, snapshotField, value, field] of [
    ["a fee of 0 in the order's cost snapshot", "costModelSnapshotJson", { feeBps: 0 }, "orderSnapshot.feeBps"],
    ["no slippage in the order's cost snapshot", "costModelSnapshotJson", { slippageBps: 0 }, "orderSnapshot.slippageBps"],
    ["a foreign hash in the order's cost snapshot", "costModelSnapshotJson", { executionProfileSpecificationHash: "f".repeat(64) }, "orderSnapshot.symbol"],
    ["another tick size in the order's precision snapshot", "precisionSnapshotJson", { tickSize: "0.000000000001" }, "orderSnapshot.tickSize"],
    ["another step size in the order's precision snapshot", "precisionSnapshotJson", { stepSize: "0.001000000000" }, "orderSnapshot.stepSize"]
  ] as const) {
    it(`cancels the order on ${label} and opens nothing`, async () => {
      const world = seedWorld();
      const order = await createOrder(world);
      const row = world.tables.get("shadowOrder")!.rows[0]!;
      row[snapshotField] = { ...(row[snapshotField] as Record<string, unknown>), ...value };
      const fill = await fillEntry(world, order.shadowOrderId!);
      assert.equal(fill.outcome, ShadowFillOutcome.ERROR_LOCKED, label);
      assertNoNewExposure(world, order.shadowOrderId!, label);
      assertEntriesLocked(world, [field], label);
    });
  }

  it("cancels the order when the active row deviates after the order was accepted", async () => {
    const world = seedWorld();
    const order = await createOrder(world);
    tamperProfile(world, { fullSpreadBps: 0 });
    const fill = await fillEntry(world, order.shadowOrderId!);
    assert.equal(fill.outcome, ShadowFillOutcome.ERROR_LOCKED);
    assertNoNewExposure(world, order.shadowOrderId!, "active row");
    assertEntriesLocked(world, ["activeProfile.fullSpreadBps"], "active row");
  });

  it("cancels the order when a second ACTIVE row appears after the order was accepted", async () => {
    const world = seedWorld();
    const order = await createOrder(world);
    addIntruderProfile(world);
    const fill = await fillEntry(world, order.shadowOrderId!);
    assert.equal(fill.outcome, ShadowFillOutcome.ERROR_LOCKED);
    assertNoNewExposure(world, order.shadowOrderId!, "second ACTIVE row");
    assertEntriesLocked(
      world,
      ["activeProfile.version", "activeProfile.feeBps", "activeProfile.activeProfileCount"],
      "second ACTIVE row"
    );
  });

  it("never lets a cost-free snapshot turn a post-fill shortfall into a normal position", async () => {
    // With the approved profile this take profit falls short of net 2R after
    // the fill (ADR 0009); priced without costs it would not.
    const control = seedWorld({ takeProfitPrice: "25150.000000000000" });
    const controlOrder = await createOrder(control);
    assert.equal((await fillEntry(control, controlOrder.shadowOrderId!)).outcome, ShadowFillOutcome.FILLED_CRV_SHORTFALL);

    const world = seedWorld({ takeProfitPrice: "25150.000000000000" });
    const order = await createOrder(world);
    const row = world.tables.get("shadowOrder")!.rows[0]!;
    row.costModelSnapshotJson = {
      ...(row.costModelSnapshotJson as Record<string, unknown>),
      feeBps: 0,
      fullSpreadBps: 0,
      slippageBps: 0
    };
    const fill = await fillEntry(world, order.shadowOrderId!);
    assert.equal(fill.outcome, ShadowFillOutcome.ERROR_LOCKED);
    assert.equal(world.tables.get("shadowPosition")!.rows.length, 0);
  });

  it("keeps a booked partial fill and its position, and only cancels the unfilled remainder", async () => {
    const world = seedWorld();
    // A thin first candle: only part of the order fills.
    world.tables.get("candle")!.update({ where: { id: world.candleC1.id }, data: { volume: "0.1" } });
    const order = await createOrder(world);
    const first = await fillEntry(world, order.shadowOrderId!);
    assert.equal(first.outcome, ShadowFillOutcome.PARTIALLY_FILLED);
    const position = world.tables.get("shadowPosition")!.rows[0]!;
    const openQuantity = position.openQuantity;

    tamperProfile(world, { feeBps: 0 });
    const next = world.tables.get("candle")!.create({
      data: {
        id: "candle-c2-thin",
        assetId: world.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: new Date("2026-08-02T10:00:00.000Z"),
        closeTime: new Date("2026-08-02T10:59:59.999Z"),
        open: "24120",
        high: "24200",
        low: "24050",
        close: "24150",
        volume: "1000",
        source: "BINANCE"
      }
    });
    const second = await fillEntry(world, order.shadowOrderId!, next.id as string);
    assert.equal(second.outcome, ShadowFillOutcome.ERROR_LOCKED);
    const orderRow = world.tables.get("shadowOrder")!.rows.find((row) => row.id === order.shadowOrderId)!;
    assert.equal(orderRow.status, "CANCELLED");
    assert.equal(orderRow.cancelReasonCode, EXECUTION_PROFILE_INTEGRITY_VIOLATION);
    assert.equal(orderRow.reservedQuoteAmount, "0");
    assert.equal(world.tables.get("shadowFill")!.rows.length, 1, "the booked fill stays");
    // Not stranded in OPENING, which the monitor never looks at: the position
    // stands as it is and is managed under its exit plan.
    const kept = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(kept.status, "OPEN");
    assert.equal(kept.openQuantity, openQuantity);
    assert.ok(kept.openedAt instanceof Date);
    assert.equal(Number(world.tables.get("portfolio")!.rows[0]!.reservedCash), 0);
    assertEntriesLocked(world, ["activeProfile.feeBps"], "partial fill");

    const stop = world.tables.get("candle")!.create({
      data: {
        id: "candle-c3-stop",
        assetId: world.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: new Date("2026-08-02T11:00:00.000Z"),
        closeTime: new Date("2026-08-02T11:59:59.999Z"),
        open: "24000",
        high: "24100",
        low: "23500",
        close: "23700",
        volume: "1000",
        source: "BINANCE"
      }
    });
    const exit = await monitorPositionForCandle(world.database as never, {
      shadowPositionId: kept.id as string,
      candleId: stop.id as string,
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(exit.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    assert.equal(world.tables.get("shadowPosition")!.rows[0]!.status, "STOPPED_OUT");
  });
});

describe("execution profile integrity — exit and valuation stay risk-reducing (ADR 0023)", () => {
  it("closes an open position with the approved profile although the row deviates, and locks only new entries", async () => {
    const control = seedWorld();
    const controlPosition = await openApprovedPosition(control);
    const controlCandle = addStopCandle(control);
    assert.equal((await monitor(control, controlPosition.id as string, controlCandle.id as string)).outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    const controlExit = control.tables.get("shadowFill")!.rows.find((row) => row.triggerType === "STOP")!;

    for (const [label, override, field] of PROFILE_MANIPULATIONS) {
      const world = seedWorld();
      const position = await openApprovedPosition(world);
      tamperProfile(world, override);
      const candle = addStopCandle(world);
      const result = await monitor(world, position.id as string, candle.id as string);
      assert.equal(result.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED, label);
      const closed = world.tables.get("shadowPosition")!.rows[0]!;
      assert.equal(closed.status, "STOPPED_OUT", label);
      assert.equal(closed.openQuantity, "0.000000000000", label);
      const exitFill = world.tables.get("shadowFill")!.rows.find((row) => row.triggerType === "STOP")!;
      assert.equal(exitFill.fillPrice, controlExit.fillPrice, `${label}: priced like the approved profile`);
      assert.equal(exitFill.feeAmount, controlExit.feeAmount, `${label}: charged like the approved profile`);
      assert.equal(closed.realizedPnl, control.tables.get("shadowPosition")!.rows[0]!.realizedPnl, label);
      const exitOrder = world.tables.get("shadowOrder")!.rows.find((row) => row.purpose === "EXIT")!;
      const cost = exitOrder.costModelSnapshotJson as Record<string, unknown>;
      assert.equal(cost.feeBps, 10, label);
      assert.equal(cost.fullSpreadBps, 2, label);
      assert.equal(cost.slippageBps, 3, label);
      assert.equal(cost.approvedProfileSubstituted, true, label);
      assert.deepEqual(cost.executionProfileDeviations, [field], label);
      assertEntriesLocked(world, [field], label);
    }
  });

  it("still closes when the portfolio is already locked and a second ACTIVE row exists", async () => {
    const world = seedWorld();
    const position = await openApprovedPosition(world);
    const session = world.tables.get("tradingSession")!.rows[0]!;
    Object.assign(session, { status: "ERROR_LOCKED", killSwitchEngaged: true, killReasonCode: "EARLIER_FINDING" });
    Object.assign(world.tables.get("portfolio")!.rows[0]!, { status: "ERROR_LOCKED" });
    addIntruderProfile(world);
    const candle = addStopCandle(world);
    const result = await monitor(world, position.id as string, candle.id as string);
    assert.equal(result.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    assert.equal(world.tables.get("shadowPosition")!.rows[0]!.status, "STOPPED_OUT");
    const exitOrder = world.tables.get("shadowOrder")!.rows.find((row) => row.purpose === "EXIT")!;
    assert.equal((exitOrder.costModelSnapshotJson as Record<string, unknown>).feeBps, 10);
    // The earlier lock reason stays; the finding is still recorded.
    assert.equal(session.killReasonCode, "EARLIER_FINDING");
    assert.equal(integrityEvents(world).length, 1);
  });

  it("lets an operator force a risk-reducing close under the lock, priced with the approved profile", async () => {
    const world = seedWorld();
    const position = await openApprovedPosition(world);
    tamperProfile(world, { feeBps: 0, slippageBps: 0 });
    const request = await requestManualRiskClose(world.database as never, {
      shadowPositionId: position.id as string,
      actorId: "operator",
      reasonNote: "deviating execution profile",
      idempotencyKey: "manual-close-profile-1",
      asOf: new Date("2026-08-02T10:05:00.000Z")
    });
    assert.equal(request.ok, true);
    const quiet = world.tables.get("candle")!.create({
      data: {
        id: "candle-c2-quiet-profile",
        assetId: world.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: new Date("2026-08-02T10:00:00.000Z"),
        closeTime: new Date("2026-08-02T10:59:59.999Z"),
        open: "24150",
        high: "24250",
        low: "24050",
        close: "24180",
        volume: "1000",
        source: "BINANCE"
      }
    });
    const result = await monitor(world, position.id as string, quiet.id as string);
    assert.equal(result.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    assert.equal(world.tables.get("shadowPosition")!.rows[0]!.status, "CLOSED");
    const exitFill = world.tables.get("shadowFill")!.rows.find((row) => row.triggerType === "MANUAL_RISK_CLOSE")!;
    assert.ok(Number(exitFill.feeAmount) > 0, "the approved fee is charged");
    assert.ok(Number(exitFill.fillPrice) < 24180, "the approved spread and slippage are charged");
  });

  it("values an open position with the approved profile, never with a deviating row, and never fails on it", async () => {
    const world = seedWorld();
    await openApprovedPosition(world);
    const portfolio = world.tables.get("portfolio")!.rows[0]!;
    const value = () =>
      loadShadowPortfolioValuation(world.database as never, {
        portfolioId: portfolio.id as string,
        asOf: new Date("2026-08-02T11:00:00.000Z"),
        availableCash: String(portfolio.availableCash),
        reservedCash: String(portfolio.reservedCash),
        realizedPnl: String(portfolio.realizedPnl),
        feesPaid: String(portfolio.feesPaid),
        highWaterMark: String(portfolio.highWaterMark),
        startOfDayEquity: null
      });
    // Which row a mark cites may change; what it is priced with may not.
    const priced = async () => {
      const { valuation, marks } = await value();
      return {
        valuation,
        marks: marks.map((mark) => ({ ...mark, executionProfileId: "ignored" }))
      };
    };
    const approved = await priced();
    tamperProfile(world, { feeBps: 0, fullSpreadBps: 0, tickSize: new Prisma.Decimal("0.000000000001") });
    assert.deepEqual(await priced(), approved);
    addIntruderProfile(world);
    assert.deepEqual(await priced(), approved);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Entry expiry after a partial fill (ADR 0024, option K): the filled quantity
// is opened with the expiry, never stranded in OPENING outside the monitor.
// ───────────────────────────────────────────────────────────────────────────

describe("entry expiry after a partial fill opens the position (ADR 0024)", () => {
  const MONITOR_ENV = {
    ENABLE_LIVE_TRADING: "false",
    TRADING_MODE: "SHADOW",
    TRADING_SHADOW_ENABLED: "true",
    TRADING_STRATEGY_V1_ENABLED: "true",
    TRADING_STRATEGY_LONG_V1_ENABLED: "true",
    TRADING_SHADOW_EXECUTION_ENABLED: "true",
    TRADING_SHADOW_POSITION_MONITOR_ENABLED: "true"
  };

  const addCandleAt = (
    world: World,
    id: string,
    openTime: string,
    prices: { open: string; high: string; low: string; close: string; volume: string }
  ) => {
    const start = new Date(openTime);
    return world.tables.get("candle")!.create({
      data: {
        id,
        assetId: world.assetId,
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: start,
        closeTime: new Date(start.getTime() + 3_599_999),
        source: "BINANCE",
        ...prices
      }
    });
  };

  /** Prisma returns `null` for an unset column; the fake leaves it out. */
  const asStored = (world: World, shadowOrderId: string) => {
    const row = world.tables.get("shadowOrder")!.rows.find((candidate) => candidate.id === shadowOrderId)!;
    row.lastProcessedCandleId ??= null;
  };

  /** C1 fills part of the order at `c1Volume`; C2 cannot fill the rest. */
  const partialThenExpire = async (options: {
    readonly direction?: "LONG" | "SHORT";
    readonly c1Volume: string;
    readonly c2: { open: string; high: string; low: string; close: string; volume: string };
  }) => {
    const world = seedWorld({ direction: options.direction ?? "LONG" });
    world.tables.get("candle")!.update({ where: { id: world.candleC1.id }, data: { volume: options.c1Volume } });
    const order = await createShadowOrderForCandidate(world.database as never, {
      tradeCandidateId: world.candidate.id as string,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID,
      capability: options.direction === "SHORT" ? SAFE_SHORT_CAPABILITY : SAFE_LONG_CAPABILITY
    });
    assert.equal(order.outcome, ShadowOrderOutcome.CREATED);
    asStored(world, order.shadowOrderId!);
    const first = await fillEntry(world, order.shadowOrderId!);
    assert.equal(first.outcome, ShadowFillOutcome.PARTIALLY_FILLED);
    const afterFirst = {
      order: { ...world.tables.get("shadowOrder")!.rows[0]! },
      position: { ...world.tables.get("shadowPosition")!.rows[0]! }
    };
    assert.equal(afterFirst.position.status, "OPENING");
    const c2 = addCandleAt(world, "candle-c2-expiry", "2026-08-02T10:00:00.000Z", options.c2);
    const second = await fillEntry(world, order.shadowOrderId!, c2.id as string);
    return { world, orderId: order.shadowOrderId!, afterFirst, c2, second };
  };

  /** C2 with almost no volume: 1 % of it rounds to zero BTC. */
  const THIN_C2 = { open: "24120", high: "24200", low: "24050", close: "24150", volume: "0.0005" };

  const positionEvents = (world: World, positionId: unknown) =>
    world.tables
      .get("shadowPositionEvent")!
      .rows.filter((row) => row.shadowPositionId === positionId)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence));

  it("opens the position with the expiry: order EXPIRED, reserve released, one OPENED event", async () => {
    const { world, orderId, afterFirst, c2, second } = await partialThenExpire({ c1Volume: "0.1", c2: THIN_C2 });
    assert.equal(second.outcome, ShadowFillOutcome.EXPIRED);

    const order = world.tables.get("shadowOrder")!.rows.find((row) => row.id === orderId)!;
    assert.equal(order.status, "EXPIRED");
    assert.equal(order.cancelReasonCode, "SIMULATION_NO_LIQUIDITY");
    assert.equal(order.reservedQuoteAmount, "0");
    assert.equal(order.openEntryScopeKey, null);
    assert.equal(order.filledQuantity, afterFirst.order.filledQuantity, "the booked fill stays");
    assert.equal(order.lastProcessedCandleId, c2.id);

    const position = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(position.status, "OPEN");
    assert.equal(position.openQuantity, afterFirst.position.openQuantity);
    const entryFill = world.tables.get("shadowFill")!.rows[0]!;
    assert.deepEqual(position.openedAt, entryFill.occurredAt, "opened at the first entry fill");
    assert.equal(position.lastProcessedCandleId, world.candleC1.id, "the monitor starts at the expiry candle");

    const events = positionEvents(world, position.id);
    assert.deepEqual(events.map((row) => row.type), ["OPENING", "OPENED"]);
    assert.equal(events[1]!.sourceOrderId, orderId);
    assert.equal(events[1]!.sourceCandleId, c2.id);
    assert.deepEqual(events[1]!.payloadJson, {
      jobKey: "trading:shadow-process-fills",
      reasonCode: "SIMULATION_NO_LIQUIDITY",
      expiredRemainder: afterFirst.order.remainingQuantity
    });

    const portfolio = world.tables.get("portfolio")!.rows[0]!;
    assert.equal(Number(portfolio.reservedCash), 0);
    assert.equal(
      world.tables.get("portfolioLedgerEntry")!.rows.filter((row) => row.type === "RELEASE" && row.shadowOrderId === orderId).length,
      1
    );
    assert.equal(
      world.tables.get("tradingAuditEvent")!.rows.filter((row) => row.eventType === "SHADOW_ENTRY_ORDER_EXPIRED").length,
      1
    );
    // A correction, not a finding: nothing locks.
    assert.equal(world.tables.get("riskEvent")!.rows.length, 0);
    assert.equal(world.tables.get("tradingSession")!.rows[0]!.status, "SHADOW_ACTIVE");
    assert.equal(portfolio.status, "ACTIVE");
  });

  it("catches a stop inside the expiry candle itself when 99.97 % filled and the rest is below the minimum notional", async () => {
    // C1 fills 0.09997 of 0.1 BTC; the 0.00003 BTC rest (≈ 0.72 USDT) can
    // never fill. C2 has normal volume but trades through the stop (23600).
    const { world, second, c2 } = await partialThenExpire({
      c1Volume: "9.997",
      c2: { open: "24000", high: "24100", low: "23500", close: "23700", volume: "1000" }
    });
    assert.equal(second.outcome, ShadowFillOutcome.EXPIRED);
    const order = world.tables.get("shadowOrder")!.rows[0]!;
    assert.equal(order.cancelReasonCode, "SIMULATION_BELOW_MIN_NOTIONAL");
    assert.equal(order.filledQuantity, "0.099970000000");
    const position = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(position.status, "OPEN");

    const exit = await monitor(world, position.id as string, c2.id as string);
    assert.equal(exit.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    const closed = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(closed.status, "STOPPED_OUT");
    assert.equal(closed.openQuantity, "0.000000000000");
    assert.equal(world.tables.get("shadowFill")!.rows.filter((row) => row.triggerType === "STOP").length, 1);
  });

  it("is picked up by the monitor job, which works through the expiry candle and later candles", async () => {
    const { world } = await partialThenExpire({ c1Volume: "0.1", c2: THIN_C2 });
    addCandleAt(world, "candle-c3-quiet", "2026-08-02T11:00:00.000Z", {
      open: "24150", high: "24250", low: "24050", close: "24180", volume: "1000"
    });
    addCandleAt(world, "candle-c4-tp", "2026-08-02T12:00:00.000Z", {
      open: "24200", high: "25700", low: "24150", close: "25500", volume: "1000"
    });
    const summary = await runShadowMonitorPositions(world.database as never, {
      asOf: new Date("2026-08-02T13:00:00.000Z"),
      env: MONITOR_ENV,
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(summary.blocked, false, String(summary.blockReasonCode));
    assert.equal(summary.scanned, 1);
    assert.deepEqual(summary.outcomes, {
      [ShadowMonitorOutcome.NO_TRIGGER]: 2,
      [ShadowMonitorOutcome.TRIGGERED_CLOSED]: 1
    });
    const closed = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.openQuantity, "0.000000000000");
    assert.ok(Number(closed.realizedPnl) > 0);
    assert.equal(world.tables.get("shadowFill")!.rows.filter((row) => row.triggerType === "TAKE_PROFIT").length, 1);
  });

  it("applies the time exit and accepts a manual risk close after the expiry", async () => {
    const timed = await partialThenExpire({ c1Volume: "0.1", c2: THIN_C2 });
    const timedPosition = timed.world.tables.get("shadowPosition")!.rows[0]!;
    // maxHoldUntil = C1 close + 72 h.
    const late = addCandleAt(timed.world, "candle-after-max-hold", "2026-08-05T10:00:00.000Z", {
      open: "24100", high: "24200", low: "24000", close: "24150", volume: "1000"
    });
    const timeExit = await monitorPositionForCandle(timed.world.database as never, {
      shadowPositionId: timedPosition.id as string,
      candleId: late.id as string,
      asOf: new Date("2026-08-05T11:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(timeExit.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    assert.equal(timed.world.tables.get("shadowPosition")!.rows[0]!.status, "CLOSED");
    assert.equal(timed.world.tables.get("shadowFill")!.rows.filter((row) => row.triggerType === "TIME_EXIT").length, 1);

    const manual = await partialThenExpire({ c1Volume: "0.1", c2: THIN_C2 });
    const manualPosition = manual.world.tables.get("shadowPosition")!.rows[0]!;
    const request = await requestManualRiskClose(manual.world.database as never, {
      shadowPositionId: manualPosition.id as string,
      actorId: "operator",
      reasonNote: "partial entry expired",
      idempotencyKey: "manual-close-after-expiry-1",
      asOf: new Date("2026-08-02T11:05:00.000Z")
    });
    assert.equal(request.ok, true, JSON.stringify(request));
    const quiet = addCandleAt(manual.world, "candle-c3-quiet", "2026-08-02T11:00:00.000Z", {
      open: "24150", high: "24250", low: "24050", close: "24180", volume: "1000"
    });
    // The thin expiry candle triggers the requested close but cannot fill it;
    // the next candle fills the exit order.
    const onExpiryCandle = await monitor(manual.world, manualPosition.id as string, manual.c2.id as string);
    assert.equal(onExpiryCandle.outcome, ShadowMonitorOutcome.WAITING_FOR_LIQUIDITY);
    const onQuiet = await monitorPositionForCandle(manual.world.database as never, {
      shadowPositionId: manualPosition.id as string,
      candleId: quiet.id as string,
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(onQuiet.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    assert.equal(manual.world.tables.get("shadowPosition")!.rows[0]!.status, "CLOSED");
    assert.equal(
      manual.world.tables.get("shadowFill")!.rows.filter((row) => row.triggerType === "MANUAL_RISK_CLOSE").length,
      1
    );
  });

  it("reconciles cleanly once the monitor has marked the expiry candle", async () => {
    // The equity cache keeps the fill's mark until the monitor marks the next
    // candle, as for every open position (N3, see the hotfix report).
    const { world, c2 } = await partialThenExpire({ c1Volume: "0.1", c2: THIN_C2 });
    const position = world.tables.get("shadowPosition")!.rows[0]!;
    const marked = await monitor(world, position.id as string, c2.id as string);
    assert.equal(marked.outcome, ShadowMonitorOutcome.NO_TRIGGER);
    const reconciled = await reconcilePortfolio(world.database as never, {
      portfolioId: world.portfolio.id as string,
      asOf: new Date("2026-08-02T11:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: "reconcile-after-monitor"
    });
    assert.equal(reconciled.consistent, true, JSON.stringify(reconciled.violations));
    assert.equal(world.tables.get("tradingSession")!.rows[0]!.status, "SHADOW_ACTIVE");
  });

  it("keeps a SHORT's collateral on the position until the exit and frees it afterwards", async () => {
    const { world, second, c2 } = await partialThenExpire({
      direction: "SHORT",
      c1Volume: "0.1",
      c2: { open: "24080", high: "24150", low: "24000", close: "24100", volume: "0.0005" }
    });
    assert.equal(second.outcome, ShadowFillOutcome.EXPIRED);
    const position = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(position.status, "OPEN");
    const collateral = Number(position.reservedCollateral);
    assert.ok(collateral > 0);
    assert.equal(Number(world.tables.get("portfolio")!.rows[0]!.reservedCash), collateral);

    // The expiry candle itself is quiet; C3 trades through the SHORT stop (24600).
    assert.equal((await monitor(world, position.id as string, c2.id as string)).outcome, ShadowMonitorOutcome.NO_TRIGGER);
    const reconciled = await reconcilePortfolio(world.database as never, {
      portfolioId: world.portfolio.id as string,
      asOf: new Date("2026-08-02T11:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: "reconcile-short-after-expiry"
    });
    assert.equal(reconciled.consistent, true, JSON.stringify(reconciled.violations));
    const stop = addCandleAt(world, "candle-c3-short-stop", "2026-08-02T11:00:00.000Z", {
      open: "24200", high: "24700", low: "24150", close: "24650", volume: "1000"
    });
    const exit = await monitorPositionForCandle(world.database as never, {
      shadowPositionId: position.id as string,
      candleId: stop.id as string,
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(exit.outcome, ShadowMonitorOutcome.TRIGGERED_CLOSED);
    const closed = world.tables.get("shadowPosition")!.rows[0]!;
    assert.equal(closed.status, "STOPPED_OUT");
    assert.equal(Number(closed.reservedCollateral), 0);
    assert.equal(Number(world.tables.get("portfolio")!.rows[0]!.reservedCash), 0);
  });

  it("does nothing twice: the expiry candle again finds a terminal order", async () => {
    const { world, orderId, c2 } = await partialThenExpire({ c1Volume: "0.1", c2: THIN_C2 });
    const counts = () => ({
      events: world.tables.get("shadowPositionEvent")!.rows.length,
      ledger: world.tables.get("portfolioLedgerEntry")!.rows.length,
      audit: world.tables.get("tradingAuditEvent")!.rows.length
    });
    const before = counts();
    const again = await fillEntry(world, orderId, c2.id as string);
    assert.equal(again.outcome, ShadowFillOutcome.NOT_APPLICABLE);
    assert.deepEqual(counts(), before);
  });

  it("leaves an expiry without any fill exactly as before: no position, no event", async () => {
    const world = seedWorld();
    world.tables.get("candle")!.update({ where: { id: world.candleC1.id }, data: { volume: "0.0005" } });
    const order = await createOrder(world);
    asStored(world, order.shadowOrderId!);
    assert.equal((await fillEntry(world, order.shadowOrderId!)).outcome, ShadowFillOutcome.WAITING);
    const c2 = addCandleAt(world, "candle-c2-expiry", "2026-08-02T10:00:00.000Z", THIN_C2);
    assert.equal((await fillEntry(world, order.shadowOrderId!, c2.id as string)).outcome, ShadowFillOutcome.EXPIRED);
    const row = world.tables.get("shadowOrder")!.rows[0]!;
    assert.equal(row.status, "EXPIRED");
    assert.equal(row.cancelReasonCode, "SIMULATION_NO_LIQUIDITY");
    assert.equal(row.reservedQuoteAmount, "0");
    assert.equal(world.tables.get("shadowPosition")!.rows.length, 0);
    assert.equal(world.tables.get("shadowPositionEvent")!.rows.length, 0);
    const portfolio = world.tables.get("portfolio")!.rows[0]!;
    assert.equal(Number(portfolio.reservedCash), 0);
    assert.equal(Number(portfolio.availableCash), 10000);
  });

  it("leaves the entry-gap refusal on the first candle exactly as before", async () => {
    const world = seedWorld();
    // Opens far above the planned entry maximum (24350).
    world.tables.get("candle")!.update({ where: { id: world.candleC1.id }, data: { open: "24900" } });
    const order = await createOrder(world);
    asStored(world, order.shadowOrderId!);
    assert.equal((await fillEntry(world, order.shadowOrderId!)).outcome, ShadowFillOutcome.ENTRY_GAP_EXPIRED);
    assert.equal(world.tables.get("shadowOrder")!.rows[0]!.status, "EXPIRED");
    assert.equal(world.tables.get("shadowPosition")!.rows.length, 0);
    assert.equal(world.tables.get("shadowPositionEvent")!.rows.length, 0);
  });
});
