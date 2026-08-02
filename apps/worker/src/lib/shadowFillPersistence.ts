/**
 * Atomic entry-fill processing for one `ShadowOrder` against one new, closed
 * candle.
 *
 * Specification:
 *   docs/trading/07-shadow-execution-model.md (the model in full)
 *   docs/trading/02-shadow-trading-target-architecture.md, "Transaktionsgrenzen" 4
 *     — ShadowFill + Orderstatus + Position/PositionEvent + Cash-/Reserve-
 *       Ledger + Audit is one transaction.
 *   docs/trading/04-state-machines.md, "Shadow Order", "Shadow Position",
 *     "ExitPlan".
 *
 * A candle is processed at most once per order (`lastProcessedCandleId` plus
 * the fill's own unique `fillKey`), so a retry after a crash either finds
 * nothing to do or reproduces the same fill it already committed
 * (docs/trading/07, "Fehlerbehandlung").
 *
 * Deliberate P4 simplification, documented rather than hidden: the reward/risk
 * re-check docs/trading/05 mentions for the *actual* fill price is not
 * re-run here — the risk engine already worst-cased the entry price when it
 * sized the order, and re-evaluating risk after a fill is left to a later
 * package. See the P4 completion report for the full list.
 */

import {
  Prisma,
  RiskEventType,
  RiskSeverity,
  ShadowFillTriggerType,
  ShadowOrderStatus,
  ShadowPositionEventType,
  ShadowPositionStatus,
  TradingActorType,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import {
  checkEntryGap,
  computeMarketFill,
  MarketSide,
  type CandleSnapshotV1,
  type ExecutionProfileSnapshotV1
} from "@signalpilot/trading-simulation";
import {
  applyEntryFillLedger,
  applyEntryFillToPosition,
  computeReleaseReservation
} from "@signalpilot/portfolio";
import {
  DecimalValue,
  RoundingMode,
  buildActiveExitPlanScopeKey,
  buildAuditEventKey,
  buildFillKey,
  buildOpenPositionScopeKey,
  buildPayloadHash,
  buildPositionEventKey,
  buildPositionKey,
  buildRiskEventKey,
  buildSpecificationHash
} from "@signalpilot/trading-domain";

import {
  asJson,
  decimalString,
  ledgerEntryCreateData,
  portfolioState as toPortfolioState
} from "./shadowPortfolioIo.js";

export const SHADOW_FILL_JOB_KEY = "trading:shadow-process-fills";

export const ShadowFillOutcome = {
  FILLED: "FILLED",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  WAITING: "WAITING",
  EXPIRED: "EXPIRED",
  ENTRY_GAP_EXPIRED: "ENTRY_GAP_EXPIRED",
  ALREADY_PROCESSED: "ALREADY_PROCESSED",
  ERROR_LOCKED: "ERROR_LOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE"
} as const;
export type ShadowFillOutcome = (typeof ShadowFillOutcome)[keyof typeof ShadowFillOutcome];

export interface ProcessEntryFillInput {
  readonly shadowOrderId: string;
  readonly candleId: string;
  readonly asOf: Date;
  readonly codeVersion: string;
  readonly correlationId: string;
}

export interface ProcessEntryFillResult {
  readonly outcome: ShadowFillOutcome;
  readonly shadowFillId: string | null;
  readonly shadowPositionId: string | null;
  readonly message?: string;
}

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

function executionProfileSnapshotFromOrder(order: {
  readonly precisionSnapshotJson: Prisma.JsonValue;
  readonly costModelSnapshotJson: Prisma.JsonValue;
  readonly executionProfileId: string;
}): ExecutionProfileSnapshotV1 | null {
  const precision = order.precisionSnapshotJson as Record<string, unknown> | null;
  const cost = order.costModelSnapshotJson as Record<string, unknown> | null;
  if (precision === null || cost === null) return null;
  const tickSize = precision.tickSize;
  const stepSize = precision.stepSize;
  const minQuantity = precision.minQuantity;
  const minNotional = precision.minNotional;
  const maxQuantity = precision.maxQuantity;
  const feeBps = cost.feeBps;
  const fullSpreadBps = cost.fullSpreadBps;
  const slippageBps = cost.slippageBps;
  const maxParticipationRate = cost.maxParticipationRate;
  const specificationHash = cost.executionProfileSpecificationHash;
  if (
    typeof tickSize !== "string" ||
    typeof stepSize !== "string" ||
    typeof minQuantity !== "string" ||
    typeof minNotional !== "string" ||
    typeof feeBps !== "number" ||
    typeof fullSpreadBps !== "number" ||
    typeof slippageBps !== "number" ||
    typeof maxParticipationRate !== "string" ||
    typeof specificationHash !== "string"
  ) {
    return null;
  }
  return {
    id: order.executionProfileId,
    tickSize,
    stepSize,
    minQuantity,
    minNotional,
    maxQuantity: typeof maxQuantity === "string" ? maxQuantity : null,
    feeBps,
    fullSpreadBps,
    slippageBps,
    maxParticipationRate,
    specificationHash
  };
}

async function engageErrorLock(
  database: PrismaClient,
  args: {
    readonly tradingSessionId: string | null;
    readonly portfolioId: string;
    readonly reasonCode: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly inputHash: string;
    readonly jobKey: string;
  }
): Promise<void> {
  const eventKey = buildRiskEventKey({
    type: RiskEventType.SIMULATION_ERROR,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    inputHash: args.inputHash
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
        tradingSessionId: args.tradingSessionId,
        payloadJson: asJson({ jobKey: args.jobKey }),
        inputHash: args.inputHash
      }
    });
    if (args.tradingSessionId !== null) {
      await tx.tradingSession.updateMany({
        where: { id: args.tradingSessionId, status: { not: TradingSessionStatus.ERROR_LOCKED } },
        data: {
          status: TradingSessionStatus.ERROR_LOCKED,
          killSwitchEngaged: true,
          killReasonCode: args.reasonCode,
          version: { increment: 1 }
        }
      });
    }
  });
}

/**
 * Attempt to fill (or expire) one entry order against one new closed candle.
 * The caller supplies the next unprocessed candle in ascending `openTime`
 * order — this function never queries "the latest candle" itself, so a
 * replay with the same candle id is safe and a look-ahead is impossible.
 */
export async function processEntryOrderFillForCandle(
  database: PrismaClient,
  input: ProcessEntryFillInput
): Promise<ProcessEntryFillResult> {
  const order = await database.shadowOrder.findUnique({
    where: { id: input.shadowOrderId },
    include: { tradeCandidate: true, portfolio: true, tradingSession: true }
  });
  if (order === null || order.purpose !== "ENTRY") {
    return { outcome: ShadowFillOutcome.NOT_APPLICABLE, shadowFillId: null, shadowPositionId: null };
  }
  if (order.status !== ShadowOrderStatus.WAITING_FOR_ENTRY && order.status !== ShadowOrderStatus.PARTIALLY_FILLED) {
    return { outcome: ShadowFillOutcome.NOT_APPLICABLE, shadowFillId: null, shadowPositionId: null };
  }

  const candle = await database.candle.findUnique({ where: { id: input.candleId } });
  if (candle === null || candle.closeTime.getTime() > input.asOf.getTime()) {
    return { outcome: ShadowFillOutcome.WAITING, shadowFillId: null, shadowPositionId: null, message: "Candle not closed yet." };
  }

  const existingFillForCandle = await database.shadowFill.findFirst({
    where: { shadowOrderId: order.id, sourceCandleId: candle.id }
  });
  if (existingFillForCandle !== null) {
    return {
      outcome: ShadowFillOutcome.ALREADY_PROCESSED,
      shadowFillId: existingFillForCandle.id,
      shadowPositionId: existingFillForCandle.shadowPositionId
    };
  }
  if (order.lastProcessedCandleId === candle.id) {
    return { outcome: ShadowFillOutcome.ALREADY_PROCESSED, shadowFillId: null, shadowPositionId: null };
  }

  const candidate = order.tradeCandidate;
  const isFirstCandleForOrder = order.lastProcessedCandleId === null;

  if (isFirstCandleForOrder && candidate !== null && candidate.plannedEntryMaximum !== null) {
    const gap = checkEntryGap({
      candleOpen: decimalString(candle.open),
      plannedEntryMaximum: decimalString(candidate.plannedEntryMaximum)
    });
    if (gap.gapTooLarge) {
      await expireOrderAndReleaseReserve(database, order, candle.id, gap.reasonCode, input);
      return { outcome: ShadowFillOutcome.ENTRY_GAP_EXPIRED, shadowFillId: null, shadowPositionId: null };
    }
  }

  const profileSnapshot = executionProfileSnapshotFromOrder(order);
  if (profileSnapshot === null) {
    await engageErrorLock(database, {
      tradingSessionId: order.tradingSessionId,
      portfolioId: order.portfolioId,
      reasonCode: "SIMULATION_INVALID_EXECUTION_PROFILE",
      aggregateType: "ShadowOrder",
      aggregateId: order.id,
      inputHash: order.id,
      jobKey: SHADOW_FILL_JOB_KEY
    });
    return { outcome: ShadowFillOutcome.ERROR_LOCKED, shadowFillId: null, shadowPositionId: null };
  }

  const fill = computeMarketFill({
    side: MarketSide.BUY,
    referencePrice: decimalString(candle.open),
    requestedQuantity: decimalString(order.remainingQuantity),
    candle: toCandleSnapshot(candle),
    executionProfile: profileSnapshot,
    reservedQuoteAmount: decimalString(order.reservedQuoteAmount)
  });

  if (!fill.fillable) {
    if (fill.reasonCode === "SIMULATION_RESERVE_EXCEEDED" || fill.reasonCode.startsWith("SIMULATION_INVALID")) {
      await engageErrorLock(database, {
        tradingSessionId: order.tradingSessionId,
        portfolioId: order.portfolioId,
        reasonCode: fill.reasonCode,
        aggregateType: "ShadowOrder",
        aggregateId: order.id,
        inputHash: order.id,
        jobKey: SHADOW_FILL_JOB_KEY
      });
      return { outcome: ShadowFillOutcome.ERROR_LOCKED, shadowFillId: null, shadowPositionId: null };
    }

    // No fill this candle — mark the cursor and expire after the second
    // eligible candle if nothing has filled at all yet.
    const isSecondCandle = !isFirstCandleForOrder;
    if (isSecondCandle) {
      await expireOrderAndReleaseReserve(database, order, candle.id, fill.reasonCode, input);
      return { outcome: ShadowFillOutcome.EXPIRED, shadowFillId: null, shadowPositionId: null };
    }
    await database.shadowOrder.update({
      where: { id: order.id },
      data: { lastProcessedCandleId: candle.id, version: { increment: 1 } }
    });
    return { outcome: ShadowFillOutcome.WAITING, shadowFillId: null, shadowPositionId: null };
  }

  const portfolio = order.portfolio;
  if (portfolio === null) {
    return { outcome: ShadowFillOutcome.NOT_APPLICABLE, shadowFillId: null, shadowPositionId: null };
  }

  const remainingBefore = DecimalValue.fromString(decimalString(order.remainingQuantity));
  const fillQuantity = DecimalValue.fromString(fill.fillQuantity);
  const isFinalFillForOrder = fillQuantity.gte(remainingBefore);
  const reservedBefore = DecimalValue.fromString(decimalString(order.reservedQuoteAmount));
  // Proportional share of the remaining reserve tied to this fill, rounded up
  // so the reserve released to the fill never under-covers its actual cost;
  // the final fill takes whatever remains instead of leaving a residue.
  const reservedForFill = isFinalFillForOrder
    ? reservedBefore
    : reservedBefore.mul(fillQuantity, RoundingMode.CEIL).div(remainingBefore, RoundingMode.CEIL);

  const existingFillCount = await database.shadowFill.count({ where: { shadowOrderId: order.id } });
  const nextFillSequence = existingFillCount + 1;

  let positionId: string | null = null;

  const result = await database.$transaction(async (tx) => {
    let position = order.shadowPositionId === null
      ? null
      : await tx.shadowPosition.findUnique({ where: { id: order.shadowPositionId } });

    if (position === null) {
      if (candidate === null || candidate.stopPrice === null || candidate.takeProfitPrice === null) {
        throw new Error(`ShadowOrder ${order.id} has no candidate price plan to open a position from.`);
      }
      const maxHoldHours = candidate.maxHoldHours ?? 72;
      const maxHoldUntil = new Date(candle.closeTime.getTime() + maxHoldHours * 60 * 60 * 1000);
      const specification = {
        stopPrice: decimalString(candidate.stopPrice),
        takeProfitPrice: decimalString(candidate.takeProfitPrice),
        maxHoldUntil: maxHoldUntil.toISOString(),
        intrabarConflictPolicy: "STOP_FIRST"
      };
      const positionKey = buildPositionKey({
        portfolioId: order.portfolioId,
        assetId: order.assetId,
        entryOrderId: order.id
      });
      const created = await tx.shadowPosition.create({
        data: {
          positionKey,
          portfolioId: order.portfolioId,
          assetId: order.assetId,
          strategyVersionId: candidate.strategyVersionId,
          strategyAssignmentId: candidate.strategyAssignmentId,
          entryOrderId: order.id,
          status: ShadowPositionStatus.OPENING,
          openScopeKey: buildOpenPositionScopeKey({ portfolioId: order.portfolioId, assetId: order.assetId }),
          initialQuantity: "0",
          openQuantity: "0",
          averageEntryPrice: "0",
          stopPrice: candidate.stopPrice,
          takeProfitPrice: candidate.takeProfitPrice,
          maxHoldUntil,
          activeExitPlanVersion: 1
        },
        select: { id: true }
      });
      await tx.exitPlan.create({
        data: {
          shadowPositionId: created.id,
          version: 1,
          status: "ACTIVE",
          stopPrice: candidate.stopPrice,
          takeProfitPrice: candidate.takeProfitPrice,
          maxHoldUntil,
          intrabarConflictPolicy: "STOP_FIRST",
          specificationJson: asJson(specification),
          specificationHash: buildSpecificationHash(specification),
          activePositionKey: buildActiveExitPlanScopeKey({ shadowPositionId: created.id })
        }
      });
      position = await tx.shadowPosition.findUnique({ where: { id: created.id } });
    }
    if (position === null) throw new Error("Position lookup failed immediately after creation.");
    positionId = position.id;

    const fillKey = buildFillKey({ shadowOrderId: order.id, sourceCandleId: candle.id, sequence: nextFillSequence });
    const createdFill = await tx.shadowFill.create({
      data: {
        fillKey,
        shadowOrderId: order.id,
        shadowPositionId: position.id,
        assetId: order.assetId,
        sourceCandleId: candle.id,
        sequence: nextFillSequence,
        side: "BUY",
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
        triggerType: ShadowFillTriggerType.ENTRY,
        simulationVersion: "market-fill-v1/1.0.0",
        assumptionsJson: asJson(fill.assumptions),
        inputHash: buildSpecificationHash(fill.assumptions),
        occurredAt: candle.closeTime
      },
      select: { id: true }
    });

    const positionUpdate = applyEntryFillToPosition(
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
      { quantity: fill.fillQuantity, fillPrice: fill.fillPrice, notional: fill.notional, feeAmount: fill.feeAmount }
    );
    if (!positionUpdate.ok || positionUpdate.position === null) {
      throw new Error(`Entry fill could not be applied to position ${position.id}: ${positionUpdate.reasonCode}`);
    }

    const newOrderStatus = isFinalFillForOrder ? ShadowOrderStatus.FILLED : ShadowOrderStatus.PARTIALLY_FILLED;
    const newRemaining = remainingBefore.sub(fillQuantity);
    const newReservedOnOrder = reservedBefore.sub(reservedForFill);

    await tx.shadowOrder.update({
      where: { id: order.id },
      data: {
        status: newOrderStatus,
        filledQuantity: DecimalValue.fromString(decimalString(order.filledQuantity)).add(fillQuantity).toString(),
        remainingQuantity: newRemaining.toString(),
        reservedQuoteAmount: newReservedOnOrder.toString(),
        shadowPositionId: position.id,
        lastProcessedCandleId: candle.id,
        version: { increment: 1 }
      }
    });

    const newPositionStatus = newOrderStatus === ShadowOrderStatus.FILLED ? ShadowPositionStatus.OPEN : ShadowPositionStatus.OPENING;
    await tx.shadowPosition.update({
      where: { id: position.id },
      data: {
        initialQuantity: positionUpdate.position.initialQuantity,
        openQuantity: positionUpdate.position.openQuantity,
        averageEntryPrice: positionUpdate.position.averageEntryPrice,
        grossEntryNotional: positionUpdate.position.grossEntryNotional,
        feesPaid: positionUpdate.position.feesPaid,
        status: newPositionStatus,
        openedAt: position.openedAt ?? (newPositionStatus === ShadowPositionStatus.OPEN ? candle.closeTime : null),
        lastProcessedCandleId: candle.id,
        version: { increment: 1 }
      }
    });

    const eventSequence = (await tx.shadowPositionEvent.count({ where: { shadowPositionId: position.id } })) + 1;
    await tx.shadowPositionEvent.create({
      data: {
        eventKey: buildPositionEventKey({ shadowPositionId: position.id, sequence: eventSequence }),
        shadowPositionId: position.id,
        sequence: eventSequence,
        type: newPositionStatus === ShadowPositionStatus.OPEN ? ShadowPositionEventType.OPENED : ShadowPositionEventType.OPENING,
        sourceOrderId: order.id,
        sourceFillId: createdFill.id,
        sourceCandleId: candle.id,
        quantity: fill.fillQuantity,
        price: fill.fillPrice,
        payloadJson: asJson({ jobKey: SHADOW_FILL_JOB_KEY }),
        occurredAt: candle.closeTime
      }
    });

    const ledger = applyEntryFillLedger({
      state: toPortfolioState(portfolio),
      notionalEntryKey: `${fillKey}|BUY_NOTIONAL`,
      feeEntryKey: `${fillKey}|FEE`,
      reservedForFill: reservedForFill.toString(),
      fill: { quantity: fill.fillQuantity, fillPrice: fill.fillPrice, notional: fill.notional, feeAmount: fill.feeAmount },
      shadowOrderId: order.id,
      shadowFillId: createdFill.id,
      shadowPositionId: position.id,
      occurredAt: candle.closeTime.toISOString()
    });
    if (!ledger.ok || ledger.nextState === null) {
      throw new Error(`Entry fill ledger booking failed for order ${order.id}: ${ledger.reasonCode}`);
    }
    for (const entry of ledger.entries) {
      await tx.portfolioLedgerEntry.create({ data: ledgerEntryCreateData(entry, portfolio.id) });
    }
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: {
        availableCash: ledger.nextState.availableCash,
        reservedCash: ledger.nextState.reservedCash,
        feesPaid: ledger.nextState.feesPaid,
        ledgerSequence: ledger.nextState.ledgerSequence,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) {
      throw new Error(`Portfolio ${portfolio.id} version conflict while booking an entry fill.`);
    }

    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SHADOW_ENTRY_FILL",
          aggregateType: "ShadowFill",
          aggregateId: createdFill.id,
          idempotencyKey: buildPayloadHash(fillKey)
        }),
        eventType: "SHADOW_ENTRY_FILL",
        aggregateType: "ShadowFill",
        aggregateId: createdFill.id,
        actorType: TradingActorType.SYSTEM,
        actorId: SHADOW_FILL_JOB_KEY,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        idempotencyKey: buildPayloadHash(fillKey),
        reasonCode: "SIMULATION_FILLED",
        tradingSessionId: order.tradingSessionId,
        afterState: asJson({ fill, orderStatus: newOrderStatus, positionStatus: newPositionStatus }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });

    return { fillId: createdFill.id, orderStatus: newOrderStatus };
  });

  return {
    outcome: result.orderStatus === ShadowOrderStatus.FILLED ? ShadowFillOutcome.FILLED : ShadowFillOutcome.PARTIALLY_FILLED,
    shadowFillId: result.fillId,
    shadowPositionId: positionId
  };
}

/**
 * Release whatever remains reserved and mark the order terminal. Used both
 * for the entry-gap refusal (immediate) and the two-candle expiry. A partial
 * fill already booked stays booked — only the unfilled remainder's reserve is
 * released (docs/trading/04: "Bereits gefüllte Position bleibt bestehen").
 */
async function expireOrderAndReleaseReserve(
  database: PrismaClient,
  order: {
    readonly id: string;
    readonly portfolioId: string;
    readonly reservedQuoteAmount: unknown;
    readonly remainingQuantity: unknown;
  },
  candleId: string,
  reasonCode: string,
  input: ProcessEntryFillInput
): Promise<void> {
  const releaseAmount = decimalString(order.reservedQuoteAmount);
  if (DecimalValue.fromString(releaseAmount).isZero()) {
    await database.shadowOrder.update({
      where: { id: order.id },
      data: { status: ShadowOrderStatus.EXPIRED, lastProcessedCandleId: candleId, cancelReasonCode: reasonCode, version: { increment: 1 } }
    });
    return;
  }

  await database.$transaction(async (tx) => {
    const portfolio = await tx.portfolio.findUnique({ where: { id: order.portfolioId } });
    if (portfolio === null) throw new Error(`Portfolio ${order.portfolioId} not found while releasing a reserve.`);

    const release = computeReleaseReservation({
      state: toPortfolioState(portfolio),
      entryKey: `${order.id}|expiry-release`,
      releaseAmount,
      shadowOrderId: order.id,
      occurredAt: input.asOf.toISOString()
    });
    if (!release.ok || release.nextState === null) {
      throw new Error(`Reserve release failed for order ${order.id}: ${release.reasonCode}`);
    }

    await tx.portfolioLedgerEntry.create({ data: ledgerEntryCreateData(release.entries[0], portfolio.id) });
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: {
        availableCash: release.nextState.availableCash,
        reservedCash: release.nextState.reservedCash,
        ledgerSequence: release.nextState.ledgerSequence,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) throw new Error(`Portfolio ${portfolio.id} version conflict while releasing a reserve.`);

    await tx.shadowOrder.update({
      where: { id: order.id },
      data: {
        status: ShadowOrderStatus.EXPIRED,
        reservedQuoteAmount: "0",
        lastProcessedCandleId: candleId,
        cancelReasonCode: reasonCode,
        version: { increment: 1 }
      }
    });

    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SHADOW_ENTRY_ORDER_EXPIRED",
          aggregateType: "ShadowOrder",
          aggregateId: order.id,
          idempotencyKey: `${order.id}-${candleId}`
        }),
        eventType: "SHADOW_ENTRY_ORDER_EXPIRED",
        aggregateType: "ShadowOrder",
        aggregateId: order.id,
        actorType: TradingActorType.SYSTEM,
        actorId: SHADOW_FILL_JOB_KEY,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        idempotencyKey: `${order.id}-${candleId}`,
        reasonCode,
        afterState: asJson({ releasedAmount: releaseAmount }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });
  });
}
