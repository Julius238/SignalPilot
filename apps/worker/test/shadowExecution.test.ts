import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createShadowOrderForCandidate, ShadowOrderOutcome } from "../src/lib/shadowOrderPersistence.js";
import { processEntryOrderFillForCandle, ShadowFillOutcome } from "../src/lib/shadowFillPersistence.js";
import { monitorPositionForCandle, ShadowMonitorOutcome } from "../src/lib/shadowPositionMonitor.js";
import { reconcilePortfolio } from "../src/lib/shadowReconciliation.js";
import { startTradingDay } from "../src/lib/shadowTradingDay.js";

import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const CODE_VERSION = "test-code-version";
const CORRELATION_ID = "correlation-1";

function seedWorld() {
  const { database, tables } = createFakeExecutionDatabase();

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

  const assetId = "asset-btc";
  const executionProfile = tables.get("instrumentExecutionProfile")!.create({
    data: {
      assetId,
      version: 1,
      status: "ACTIVE",
      tickSize: "0.010000000000",
      stepSize: "0.000010000000",
      minQuantity: "0.000010000000",
      minNotional: "10.000000000000",
      maxQuantity: null,
      feeBps: 10,
      fullSpreadBps: 10,
      slippageBps: 10,
      maxParticipationRate: "0.500000000000",
      source: "MANUAL_CONSERVATIVE_V1",
      sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
      specificationHash: "profile-hash-1"
    }
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
  const stopPrice = "23600.000000000000";
  const takeProfitPrice = "25350.000000000000";

  const candidate = tables.get("tradeCandidate")!.create({
    data: {
      candidateKey: "candidate-1",
      strategyAssignmentId: "assignment-1",
      strategyVersionId: "strategy-version-1",
      portfolioId: portfolio.id,
      assetId,
      anchorCandleId: "candle-c0",
      anchorSignalId: null,
      direction: "LONG",
      entryType: "MARKET",
      status: "APPROVED_FOR_SHADOW",
      referenceEntryPrice,
      stopPrice,
      takeProfitPrice,
      minimumRewardRisk: "2.000000000000",
      stopDistance: "500.000000000000",
      stopDistancePct: "0.020000000000",
      plannedRewardRisk: "2.500000000000",
      plannedEntryMinimum: stopPrice,
      plannedEntryMaximum: "24350.000000000000",
      maximumEntryGapDistance: "250.000000000000",
      validFrom: new Date("2026-08-02T09:00:00.000Z"),
      earliestFillAt: new Date("2026-08-02T09:00:00.000Z"),
      maxHoldHours: 72,
      strategyEngineVersion: "crypto-mtf-breakout-v1/1.0.0",
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
        snapshot: { executionProfile: { id: executionProfile.id, specificationHash: executionProfile.specificationHash } },
        sizing: {
          approvedQuantity: "0.100000000000",
          // Comfortably covers 0.1 * worst-case buy fill + fee at the 10bp/10bp
          // spread/slippage/fee profile below (real fill notional ≈ 2414.6 + ≈2.4 fee).
          reservedQuoteAmount: "2450.000000000000",
          worstEntryPrice: "24160.000000000000"
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
      correlationId: CORRELATION_ID
    });

    assert.equal(result.outcome, ShadowOrderOutcome.CREATED);
    assert.equal(tables.get("shadowOrder")!.rows.length, 1);
    const order = tables.get("shadowOrder")!.rows[0];
    assert.equal(order.reservedQuoteAmount, "2450.000000000000");
    assert.equal(order.status, "WAITING_FOR_ENTRY");

    const updatedPortfolio = tables.get("portfolio")!.rows.find((row) => row.id === portfolio.id)!;
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
      correlationId: CORRELATION_ID
    });
    const second = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(second.outcome, ShadowOrderOutcome.IDEMPOTENT_REPLAY);
    assert.equal(tables.get("shadowOrder")!.rows.length, 1);
    assert.equal(tables.get("portfolioLedgerEntry")!.rows.length, 2);
  });

  it("blocks when the session is not SHADOW_ACTIVE", async () => {
    const { database, tables, session, candidate } = seedWorld();
    tables.get("tradingSession")!.update({ where: { id: session.id }, data: { status: "PAUSED" } });

    const result = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(result.outcome, ShadowOrderOutcome.BLOCKED);
    assert.equal(tables.get("shadowOrder")!.rows.length, 0);
    // Only the seeded INITIAL_CASH entry — no RESERVE was ever written.
    assert.equal(tables.get("portfolioLedgerEntry")!.rows.length, 1);
  });

  it("blocks when the kill switch is engaged even if the status still reads SHADOW_ACTIVE", async () => {
    const { database, tables, session, candidate } = seedWorld();
    tables.get("tradingSession")!.update({ where: { id: session.id }, data: { killSwitchEngaged: true } });

    const result = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
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
      correlationId: CORRELATION_ID
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

    const order = tables.get("shadowOrder")!.rows.find((row) => row.id === orderResult.shadowOrderId)!;
    assert.equal(order.status, "FILLED");
    assert.equal(order.remainingQuantity, "0.000000000000");

    // Ledger stays balanced: available + reserved == starting cash - (fee already paid).
    const updatedPortfolio = tables.get("portfolio")!.rows.find((row) => row.id === portfolio.id)!;
    const available = Number.parseFloat(String(updatedPortfolio.availableCash));
    const reserved = Number.parseFloat(String(updatedPortfolio.reservedCash));
    assert.equal(reserved, 0);
    // Most of the reserve became the position's cost (not reflected in
    // availableCash); only the small unused excess plus fee refund/charge
    // moves availableCash near where it was right after the reservation.
    assert.ok(available > 7500 && available < 7600, `unexpected availableCash ${available}`);
  });
});

describe("position monitor — stop and take-profit in the same candle resolve stop-first", () => {
  it("closes the position as STOPPED_OUT and books a negative net P&L when both thresholds are in range", async () => {
    const { database, tables, portfolio, candidate, candleC1 } = seedWorld();
    const orderResult = await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
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

    const closedPosition = tables.get("shadowPosition")!.rows.find((row) => row.id === position.id)!;
    assert.equal(closedPosition.status, "STOPPED_OUT");
    assert.equal(closedPosition.openQuantity, "0.000000000000");
    assert.ok(Number.parseFloat(String(closedPosition.realizedPnl)) < 0, "a stop-out must realize a net loss");

    const exitFill = tables.get("shadowFill")!.rows.find((row) => row.triggerType === "STOP");
    assert.ok(exitFill !== undefined);
    // Sell fill priced below the stop's own reference (adverse spread/slippage).
    assert.ok(Number.parseFloat(String(exitFill!.fillPrice)) < 23600);

    const updatedPortfolio = tables.get("portfolio")!.rows.find((row) => row.id === portfolio.id)!;
    assert.equal(updatedPortfolio.reservedCash, "0.000000000000");
  });
});

describe("reconciliation — consistent portfolio succeeds, an induced mismatch locks the session", () => {
  it("marks lastReconciledAt on a clean replay", async () => {
    const { database, tables, portfolio, candidate } = seedWorld();
    await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    const result = await reconcilePortfolio(database as never, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T09:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });
    assert.equal(result.consistent, true);
    const updatedPortfolio = tables.get("portfolio")!.rows.find((row) => row.id === portfolio.id)!;
    assert.ok(updatedPortfolio.lastReconciledAt !== null);
  });

  it("locks the session and raises a critical RiskEvent when the cache diverges from the ledger", async () => {
    const { database, tables, portfolio, session, candidate } = seedWorld();
    await createShadowOrderForCandidate(database as never, {
      tradeCandidateId: candidate.id,
      asOf: new Date("2026-08-02T09:00:05.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    // Corrupt the cache: availableCash no longer matches what the ledger replay implies.
    tables.get("portfolio")!.update({ where: { id: portfolio.id }, data: { availableCash: "9000.000000000000" } });

    const result = await reconcilePortfolio(database as never, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T09:05:00.000Z"),
      codeVersion: CODE_VERSION,
      correlationId: CORRELATION_ID
    });

    assert.equal(result.consistent, false);
    assert.ok(result.violations.includes("PORTFOLIO_CACHE_MISMATCH_LEDGER_REPLAY" as never));

    const updatedSession = tables.get("tradingSession")!.rows.find((row) => row.id === session.id)!;
    assert.equal(updatedSession.status, "ERROR_LOCKED");
    assert.equal(updatedSession.killSwitchEngaged, true);

    const criticalEvents = tables.get("riskEvent")!.rows.filter((row) => row.severity === "CRITICAL");
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
