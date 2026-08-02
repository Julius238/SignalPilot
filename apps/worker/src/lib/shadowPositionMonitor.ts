/**
 * Atomic stop/take-profit/time-exit monitoring for one open `ShadowPosition`
 * against one new, closed candle.
 *
 * Specification:
 *   docs/trading/07-shadow-execution-model.md, "Stop, Take Profit und
 *     Intrakerzenkonflikte"
 *   docs/trading/02-shadow-trading-target-architecture.md, "Transaktionsgrenzen" 5
 *     — ShadowFill + Order/Position/Event + Cash/P&L/Fee-Ledger + ExitPlan +
 *       Audit is one transaction.
 *   docs/trading/04-state-machines.md, "Shadow Position", "ExitPlan".
 *
 * Exit fills are risk-reducing and therefore never gated by the trading
 * session's entry capability (docs/trading/04, session capability table): a
 * `STOPPED`, `PAUSED`, `KILLED` or `ERROR_LOCKED` session still lets this run.
 * Only the job-level `TRADING_SHADOW_POSITION_MONITOR_ENABLED` flag can turn
 * monitoring off entirely, and turning it off is itself a fail-closed choice
 * an operator must make deliberately.
 *
 * Once a trigger fires, `resolveCandleExit` is not asked again for that
 * position until the existing exit order is fully filled — the trigger and
 * its reference price are fixed at the candle that produced them
 * (docs/trading/04, ExitPlan: "Ein ausgelöster Plan wird nicht zurück auf
 * aktiv gesetzt").
 */

import {
  ExitPlanStatus,
  RiskEventType,
  RiskSeverity,
  ShadowFillTriggerType,
  ShadowOrderPurpose,
  ShadowOrderSide,
  ShadowOrderStatus,
  ShadowOrderTimeInForce,
  ShadowOrderType,
  ShadowPositionEventType,
  ShadowPositionStatus,
  TradingActorType,
  type PrismaClient
} from "@signalpilot/database";
import { applyExitFillLedger, applyExitFillToPosition } from "@signalpilot/portfolio";
import {
  computeMarketFill,
  resolveCandleExit,
  MarketSide,
  type CandleSnapshotV1,
  type ExecutionProfileSnapshotV1
} from "@signalpilot/trading-simulation";
import {
  DecimalValue,
  buildAuditEventKey,
  buildClientOrderId,
  buildExitOrderKey,
  buildPayloadHash,
  buildFillKey,
  buildOpenPositionScopeKey,
  buildPositionEventKey,
  buildRiskEventKey
} from "@signalpilot/trading-domain";

import {
  asJson,
  decimalString,
  ledgerEntryCreateData,
  portfolioState as toPortfolioState
} from "./shadowPortfolioIo.js";

export const SHADOW_MONITOR_JOB_KEY = "trading:shadow-monitor-positions";

const OPEN_POSITION_STATUSES = [ShadowPositionStatus.OPEN, ShadowPositionStatus.PARTIALLY_CLOSED];
const OPEN_EXIT_ORDER_STATUSES = [
  ShadowOrderStatus.PROPOSED,
  ShadowOrderStatus.ACCEPTED,
  ShadowOrderStatus.WAITING_FOR_ENTRY,
  ShadowOrderStatus.PARTIALLY_FILLED
];

export const ShadowMonitorOutcome = {
  NO_TRIGGER: "NO_TRIGGER",
  TRIGGERED_PARTIAL: "TRIGGERED_PARTIAL",
  TRIGGERED_CLOSED: "TRIGGERED_CLOSED",
  WAITING_FOR_LIQUIDITY: "WAITING_FOR_LIQUIDITY",
  ALREADY_PROCESSED: "ALREADY_PROCESSED",
  ERROR_LOCKED: "ERROR_LOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE"
} as const;
export type ShadowMonitorOutcome = (typeof ShadowMonitorOutcome)[keyof typeof ShadowMonitorOutcome];

export interface MonitorPositionInput {
  readonly shadowPositionId: string;
  readonly candleId: string;
  readonly asOf: Date;
  readonly codeVersion: string;
  readonly correlationId: string;
}

export interface MonitorPositionResult {
  readonly outcome: ShadowMonitorOutcome;
  readonly shadowFillId: string | null;
  readonly message?: string;
}

const FINAL_STATUS_FOR_TRIGGER: Readonly<Record<string, ShadowPositionStatus>> = {
  STOP: ShadowPositionStatus.STOPPED_OUT,
  TAKE_PROFIT: ShadowPositionStatus.CLOSED,
  TIME_EXIT: ShadowPositionStatus.CLOSED
};

function toCandleSnapshot(candle: {
  readonly id: string;
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly open: unknown;
  readonly high: unknown;
  readonly low: unknown;
  readonly close: unknown;
  readonly volume: unknown;
}): CandleSnapshotV1 {
  return {
    id: candle.id,
    openTime: candle.openTime.toISOString(),
    closeTime: candle.closeTime.toISOString(),
    open: decimalString(candle.open),
    high: decimalString(candle.high),
    low: decimalString(candle.low),
    close: decimalString(candle.close),
    volume: decimalString(candle.volume)
  };
}

async function raiseErrorLock(
  database: PrismaClient,
  args: { readonly portfolioId: string; readonly reasonCode: string; readonly aggregateId: string }
): Promise<void> {
  const eventKey = buildRiskEventKey({
    type: RiskEventType.SIMULATION_ERROR,
    aggregateType: "ShadowPosition",
    aggregateId: args.aggregateId,
    inputHash: args.aggregateId
  });
  await database.$transaction(async (tx) => {
    await tx.riskEvent.upsert({
      where: { eventKey },
      update: {},
      create: {
        eventKey,
        type: RiskEventType.SIMULATION_ERROR,
        severity: RiskSeverity.CRITICAL,
        reasonCode: args.reasonCode,
        portfolioId: args.portfolioId,
        shadowPositionId: args.aggregateId,
        payloadJson: asJson({ jobKey: SHADOW_MONITOR_JOB_KEY }),
        inputHash: args.aggregateId
      }
    });
    const session = await tx.tradingSession.findFirst({
      where: { portfolioId: args.portfolioId, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" }
    });
    if (session !== null) {
      await tx.tradingSession.updateMany({
        where: { id: session.id, status: { not: "ERROR_LOCKED" } },
        data: { status: "ERROR_LOCKED", killSwitchEngaged: true, killReasonCode: args.reasonCode, version: { increment: 1 } }
      });
    }
  });
}

/**
 * Resolve and, if triggered, book the stop/take-profit/time exit for one
 * position against one new closed candle. Never invents a fill outside the
 * candle's own OHLC — an unusable candle or exit plan escalates to
 * `ERROR_LOCKED` rather than guessing (docs/trading/07, "Fehlerbehandlung").
 */
export async function monitorPositionForCandle(
  database: PrismaClient,
  input: MonitorPositionInput
): Promise<MonitorPositionResult> {
  const position = await database.shadowPosition.findUnique({
    where: { id: input.shadowPositionId },
    include: { portfolio: true }
  });
  if (position === null || !OPEN_POSITION_STATUSES.includes(position.status as never)) {
    return { outcome: ShadowMonitorOutcome.NOT_APPLICABLE, shadowFillId: null };
  }
  if (position.lastProcessedCandleId === input.candleId) {
    return { outcome: ShadowMonitorOutcome.ALREADY_PROCESSED, shadowFillId: null };
  }

  const candle = await database.candle.findUnique({ where: { id: input.candleId } });
  if (candle === null || candle.closeTime.getTime() > input.asOf.getTime()) {
    return { outcome: ShadowMonitorOutcome.WAITING_FOR_LIQUIDITY, shadowFillId: null, message: "Candle not closed yet." };
  }

  const activePlan = await database.exitPlan.findFirst({
    where: { shadowPositionId: position.id, status: { in: [ExitPlanStatus.ACTIVE, ExitPlanStatus.TRIGGERED] } },
    orderBy: { version: "desc" }
  });
  if (activePlan === null) {
    await raiseErrorLock(database, {
      portfolioId: position.portfolioId,
      reasonCode: "EXIT_INVALID_PLAN",
      aggregateId: position.id
    });
    return { outcome: ShadowMonitorOutcome.ERROR_LOCKED, shadowFillId: null };
  }

  const executionProfile = await resolveExecutionProfile(database, position.assetId);
  if (executionProfile === null) {
    await raiseErrorLock(database, {
      portfolioId: position.portfolioId,
      reasonCode: "SIMULATION_INVALID_EXECUTION_PROFILE",
      aggregateId: position.id
    });
    return { outcome: ShadowMonitorOutcome.ERROR_LOCKED, shadowFillId: null };
  }

  let existingExitOrder = await database.shadowOrder.findFirst({
    where: {
      shadowPositionId: position.id,
      purpose: ShadowOrderPurpose.EXIT,
      status: { in: OPEN_EXIT_ORDER_STATUSES }
    },
    orderBy: { createdAt: "desc" }
  });

  let referencePrice: string;
  let triggerType: string;

  if (existingExitOrder !== null) {
    // Continuing a partially filled exit order: the trigger and its
    // reference price are fixed at the candle that produced them, recorded on
    // the ExitPlan when it moved to TRIGGERED — never re-derived here.
    referencePrice = decimalString(existingExitOrder.referencePrice);
    if (activePlan.triggeredBy === null) {
      await raiseErrorLock(database, {
        portfolioId: position.portfolioId,
        reasonCode: "EXIT_INVALID_PLAN",
        aggregateId: position.id
      });
      return { outcome: ShadowMonitorOutcome.ERROR_LOCKED, shadowFillId: null };
    }
    triggerType = activePlan.triggeredBy;
  } else {
    const resolution = resolveCandleExit({
      stopPrice: decimalString(position.stopPrice),
      takeProfitPrice: decimalString(position.takeProfitPrice),
      maxHoldUntil: position.maxHoldUntil.toISOString(),
      candle: toCandleSnapshot(candle)
    });
    if (!resolution.triggered || resolution.trigger === null || resolution.referencePrice === null) {
      if (resolution.reasonCode === "SIMULATION_INVALID_CANDLE" || resolution.reasonCode === "EXIT_INVALID_PLAN") {
        await raiseErrorLock(database, {
          portfolioId: position.portfolioId,
          reasonCode: resolution.reasonCode,
          aggregateId: position.id
        });
        return { outcome: ShadowMonitorOutcome.ERROR_LOCKED, shadowFillId: null };
      }
      await database.shadowPosition.update({
        where: { id: position.id },
        data: { lastProcessedCandleId: candle.id, lastValuationAt: input.asOf, version: { increment: 1 } }
      });
      return { outcome: ShadowMonitorOutcome.NO_TRIGGER, shadowFillId: null };
    }
    referencePrice = resolution.referencePrice;
    triggerType = resolution.trigger;

    if (activePlan.status === ExitPlanStatus.ACTIVE) {
      await database.exitPlan.update({
        where: { id: activePlan.id },
        data: { status: ExitPlanStatus.TRIGGERED, triggeredBy: triggerType, triggeredAt: candle.closeTime }
      });
    }

    const orderKey = buildExitOrderKey({
      shadowPositionId: position.id,
      exitPlanVersion: activePlan.version,
      sourceCandleId: candle.id,
      triggerType: triggerType as never
    });
    existingExitOrder = await database.shadowOrder.create({
      data: {
        orderKey,
        clientOrderId: buildClientOrderId(orderKey),
        shadowPositionId: position.id,
        portfolioId: position.portfolioId,
        assetId: position.assetId,
        tradingSessionId: (
          await database.tradingSession.findFirst({
            where: { portfolioId: position.portfolioId, status: { not: "CLOSED" } },
            orderBy: { createdAt: "desc" }
          })
        )?.id ?? "",
        executionProfileId: executionProfile.id,
        purpose: ShadowOrderPurpose.EXIT,
        side: ShadowOrderSide.SELL,
        orderType: ShadowOrderType.MARKET,
        timeInForce: ShadowOrderTimeInForce.NEXT_BARS,
        status: ShadowOrderStatus.WAITING_FOR_ENTRY,
        requestedQuantity: decimalString(position.openQuantity),
        filledQuantity: "0",
        remainingQuantity: decimalString(position.openQuantity),
        referencePrice,
        earliestFillAt: candle.closeTime,
        precisionSnapshotJson: asJson({
          tickSize: executionProfile.tickSize,
          stepSize: executionProfile.stepSize,
          minQuantity: executionProfile.minQuantity,
          minNotional: executionProfile.minNotional,
          maxQuantity: executionProfile.maxQuantity
        }),
        costModelSnapshotJson: asJson({
          feeBps: executionProfile.feeBps,
          fullSpreadBps: executionProfile.fullSpreadBps,
          slippageBps: executionProfile.slippageBps,
          maxParticipationRate: executionProfile.maxParticipationRate,
          executionProfileId: executionProfile.id,
          executionProfileSpecificationHash: executionProfile.specificationHash
        })
      }
    });
  }

  if (existingExitOrder.tradingSessionId === "" || existingExitOrder.tradingSessionId === null) {
    await raiseErrorLock(database, {
      portfolioId: position.portfolioId,
      reasonCode: "SESSION_MISSING",
      aggregateId: position.id
    });
    return { outcome: ShadowMonitorOutcome.ERROR_LOCKED, shadowFillId: null };
  }

  const fill = computeMarketFill({
    side: MarketSide.SELL,
    referencePrice,
    requestedQuantity: decimalString(existingExitOrder.remainingQuantity),
    candle: toCandleSnapshot(candle),
    executionProfile,
    openQuantity: decimalString(position.openQuantity)
  });

  if (!fill.fillable) {
    if (fill.reasonCode.startsWith("SIMULATION_INVALID") || fill.reasonCode === "SIMULATION_SELL_EXCEEDS_OPEN_QUANTITY") {
      await raiseErrorLock(database, {
        portfolioId: position.portfolioId,
        reasonCode: fill.reasonCode,
        aggregateId: position.id
      });
      return { outcome: ShadowMonitorOutcome.ERROR_LOCKED, shadowFillId: null };
    }
    await database.shadowPosition.update({
      where: { id: position.id },
      data: { lastProcessedCandleId: candle.id, lastValuationAt: input.asOf, version: { increment: 1 } }
    });
    return { outcome: ShadowMonitorOutcome.WAITING_FOR_LIQUIDITY, shadowFillId: null };
  }

  const entryFeesAggregate = await database.shadowFill.aggregate({
    where: { shadowPositionId: position.id, triggerType: ShadowFillTriggerType.ENTRY },
    _sum: { feeAmount: true }
  });
  const entryFeesPaidTotal = decimalString(entryFeesAggregate._sum.feeAmount ?? "0");

  const existingFillCount = await database.shadowFill.count({ where: { shadowOrderId: existingExitOrder.id } });
  const orderIdForFill = existingExitOrder.id;
  const portfolio = position.portfolio;
  if (portfolio === null) return { outcome: ShadowMonitorOutcome.NOT_APPLICABLE, shadowFillId: null };

  const result = await database.$transaction(async (tx) => {
    const fillKey = buildFillKey({
      shadowOrderId: orderIdForFill,
      sourceCandleId: candle.id,
      sequence: existingFillCount + 1
    });
    const createdFill = await tx.shadowFill.create({
      data: {
        fillKey,
        shadowOrderId: orderIdForFill,
        shadowPositionId: position.id,
        assetId: position.assetId,
        sourceCandleId: candle.id,
        sequence: existingFillCount + 1,
        side: ShadowOrderSide.SELL,
        quantity: fill.fillQuantity,
        referencePrice: fill.referencePrice,
        spreadAmount: fill.fullSpreadAmount,
        slippageAmount: fill.slippageAmount,
        fillPrice: fill.fillPrice,
        notional: fill.notional,
        feeAmount: fill.feeAmount,
        feeAsset: "USDT",
        liquidityAvailable: fill.liquidityCap,
        participationRate: fill.participationRate,
        triggerType: triggerType as never,
        simulationVersion: "market-fill-v1/1.0.0",
        assumptionsJson: asJson(fill.assumptions),
        inputHash: fillKey,
        occurredAt: candle.closeTime
      },
      select: { id: true }
    });

    const positionUpdate = applyExitFillToPosition(
      {
        initialQuantity: decimalString(position.initialQuantity),
        openQuantity: decimalString(position.openQuantity),
        closedQuantity: decimalString(position.closedQuantity),
        averageEntryPrice: decimalString(position.averageEntryPrice),
        averageExitPrice: position.averageExitPrice === null ? null : decimalString(position.averageExitPrice),
        grossEntryNotional: decimalString(position.grossEntryNotional),
        grossExitNotional: decimalString(position.grossExitNotional),
        realizedPnl: decimalString(position.realizedPnl),
        feesPaid: decimalString(position.feesPaid),
        allocatedEntryFees: "0.000000000000"
      },
      { quantity: fill.fillQuantity, fillPrice: fill.fillPrice, notional: fill.notional, feeAmount: fill.feeAmount },
      entryFeesPaidTotal
    );
    if (!positionUpdate.ok || positionUpdate.position === null || positionUpdate.realizedPnlDelta === null) {
      throw new Error(`Exit fill could not be applied to position ${position.id}: ${positionUpdate.reasonCode}`);
    }

    const isFullyClosed = positionUpdate.position.openQuantity === "0.000000000000";
    const newOrderStatus = isFullyClosed ? ShadowOrderStatus.FILLED : ShadowOrderStatus.PARTIALLY_FILLED;
    const finalPositionStatus = isFullyClosed
      ? FINAL_STATUS_FOR_TRIGGER[triggerType] ?? ShadowPositionStatus.CLOSED
      : ShadowPositionStatus.PARTIALLY_CLOSED;

    await tx.shadowOrder.update({
      where: { id: orderIdForFill },
      data: {
        status: newOrderStatus,
        filledQuantity: DecimalValue.fromString(decimalString(existingExitOrder!.filledQuantity))
          .add(DecimalValue.fromString(fill.fillQuantity))
          .toString(),
        remainingQuantity: positionUpdate.position.openQuantity,
        lastProcessedCandleId: candle.id,
        version: { increment: 1 }
      }
    });

    await tx.shadowPosition.update({
      where: { id: position.id },
      data: {
        openQuantity: positionUpdate.position.openQuantity,
        closedQuantity: positionUpdate.position.closedQuantity,
        averageExitPrice: positionUpdate.position.averageExitPrice,
        grossExitNotional: positionUpdate.position.grossExitNotional,
        realizedPnl: positionUpdate.position.realizedPnl,
        feesPaid: positionUpdate.position.feesPaid,
        status: finalPositionStatus,
        openScopeKey: isFullyClosed ? null : buildOpenPositionScopeKey({ portfolioId: position.portfolioId, assetId: position.assetId }),
        closedAt: isFullyClosed ? candle.closeTime : null,
        lastProcessedCandleId: candle.id,
        lastValuationAt: input.asOf,
        version: { increment: 1 }
      }
    });

    if (isFullyClosed) {
      await tx.exitPlan.update({
        where: { id: activePlan.id },
        data: { status: ExitPlanStatus.COMPLETED, activePositionKey: null }
      });
    }

    const eventSequence = (await tx.shadowPositionEvent.count({ where: { shadowPositionId: position.id } })) + 1;
    await tx.shadowPositionEvent.create({
      data: {
        eventKey: buildPositionEventKey({ shadowPositionId: position.id, sequence: eventSequence }),
        shadowPositionId: position.id,
        sequence: eventSequence,
        type: isFullyClosed
          ? finalPositionStatus === ShadowPositionStatus.STOPPED_OUT
            ? ShadowPositionEventType.STOPPED_OUT
            : ShadowPositionEventType.CLOSED
          : ShadowPositionEventType.PARTIAL_CLOSE,
        sourceOrderId: orderIdForFill,
        sourceFillId: createdFill.id,
        sourceCandleId: candle.id,
        quantity: fill.fillQuantity,
        price: fill.fillPrice,
        realizedPnlDelta: positionUpdate.realizedPnlDelta,
        payloadJson: asJson({ jobKey: SHADOW_MONITOR_JOB_KEY, triggerType }),
        occurredAt: candle.closeTime
      }
    });

    const ledger = applyExitFillLedger({
      state: toPortfolioState(portfolio),
      proceedsEntryKey: `${fillKey}|SELL_NOTIONAL`,
      feeEntryKey: `${fillKey}|FEE`,
      pnlEntryKey: `${fillKey}|PNL_ADJUSTMENT`,
      fill: { quantity: fill.fillQuantity, fillPrice: fill.fillPrice, notional: fill.notional, feeAmount: fill.feeAmount },
      realizedPnlDelta: positionUpdate.realizedPnlDelta,
      shadowOrderId: orderIdForFill,
      shadowFillId: createdFill.id,
      shadowPositionId: position.id,
      occurredAt: candle.closeTime.toISOString()
    });
    if (!ledger.ok || ledger.nextState === null) {
      throw new Error(`Exit fill ledger booking failed for position ${position.id}: ${ledger.reasonCode}`);
    }
    for (const entry of ledger.entries) {
      await tx.portfolioLedgerEntry.create({ data: ledgerEntryCreateData(entry, portfolio.id) });
    }
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: {
        availableCash: ledger.nextState.availableCash,
        realizedPnl: ledger.nextState.realizedPnl,
        feesPaid: ledger.nextState.feesPaid,
        ledgerSequence: ledger.nextState.ledgerSequence,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) throw new Error(`Portfolio ${portfolio.id} version conflict while booking an exit fill.`);

    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SHADOW_EXIT_FILL",
          aggregateType: "ShadowFill",
          aggregateId: createdFill.id,
          idempotencyKey: buildPayloadHash(fillKey)
        }),
        eventType: "SHADOW_EXIT_FILL",
        aggregateType: "ShadowFill",
        aggregateId: createdFill.id,
        actorType: TradingActorType.SYSTEM,
        actorId: SHADOW_MONITOR_JOB_KEY,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        idempotencyKey: buildPayloadHash(fillKey),
        reasonCode: triggerType,
        afterState: asJson({ fill, triggerType, isFullyClosed, realizedPnlDelta: positionUpdate.realizedPnlDelta }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });

    return { fillId: createdFill.id, isFullyClosed };
  });

  return {
    outcome: result.isFullyClosed ? ShadowMonitorOutcome.TRIGGERED_CLOSED : ShadowMonitorOutcome.TRIGGERED_PARTIAL,
    shadowFillId: result.fillId
  };
}

async function resolveExecutionProfile(
  database: PrismaClient,
  assetId: string
): Promise<ExecutionProfileSnapshotV1 | null> {
  const active = await database.instrumentExecutionProfile.findFirst({
    where: { assetId, status: "ACTIVE" },
    orderBy: { version: "desc" }
  });
  if (active === null) return null;
  return {
    id: active.id,
    tickSize: decimalString(active.tickSize),
    stepSize: decimalString(active.stepSize),
    minQuantity: decimalString(active.minQuantity),
    minNotional: decimalString(active.minNotional),
    maxQuantity: active.maxQuantity === null ? null : decimalString(active.maxQuantity),
    feeBps: active.feeBps,
    fullSpreadBps: active.fullSpreadBps,
    slippageBps: active.slippageBps,
    maxParticipationRate: decimalString(active.maxParticipationRate),
    specificationHash: active.specificationHash
  };
}
