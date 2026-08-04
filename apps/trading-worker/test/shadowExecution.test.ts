import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createShadowOrderForCandidate,
  ShadowOrderOutcome
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

import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

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
    data: {
      id: "risk-limit-set-1",
      key: "SHADOW_V1",
      version: 1,
      status: "ACTIVE",
      scope: "PORTFOLIO",
      minRewardRisk: "2.000000000000"
    }
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
      candidateKey: "candidate-1",
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
          executionProfile: {
            id: executionProfile.id,
            specificationHash: executionProfile.specificationHash
          }
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
    // gross R-multiple no longer survives real spread/slippage/fees (net CRV
    // ~1.91, below the 2.0 minimum) — ADR 0009.
    const { database, tables, candidate, candleC1 } = seedWorld({
      takeProfitPrice: "25350.000000000000"
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
      takeProfitPrice: "25350.000000000000"
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

describe("position monitor — forced MANUAL_RISK_CLOSE after a post-fill CRV shortfall", () => {
  it("closes the position at the next candle's close when no harder stop/TP fires first", async () => {
    const { database, tables, candidate, candleC1 } = seedWorld({
      takeProfitPrice: "25350.000000000000"
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
    // profit (25350), so the ordinary exit resolution finds nothing.
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
