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
 * P5 closes the one deliberate P4 simplification this file used to
 * document: the entry fill's realised price, real fees, spread and slippage
 * are now re-checked against the minimum net reward/risk immediately after
 * the fill, in the same transaction (docs/trading/05, "Candidate-Preisplan";
 * ADR 0009). A shortfall never silently opens a normal position — it stops
 * the order from pursuing any unfilled remainder, releases that remainder's
 * reserve, and flags the position for a forced, risk-reducing close instead
 * of the ordinary stop/take-profit/time exit (see `shadowPositionMonitor.ts`
 * for how that flag is honoured). The already-filled quantity still gets its
 * mandatory `ExitPlan` — it is never left unprotected or hidden.
 */

import {
  PortfolioStatus,
  Prisma,
  RiskEventType,
  RiskSeverity,
  ShadowFillTriggerType,
  ShadowOrderStatus,
  ShadowPositionEventType,
  ShadowPositionStatus,
  TradeDirection,
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
import { computePostFillNetRewardRisk } from "@signalpilot/risk-engine";
import {
  DecimalValue,
  ENTRY_SIDE,
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
import { loadShadowPortfolioValuation } from "./shadowPortfolioValuation.js";

export const SHADOW_FILL_JOB_KEY = "trading:shadow-process-fills";

/**
 * Local reason code, in the same spirit as `ShadowOrderReasonCode` (P4): a
 * post-fill business decision specific to this job, not a domain-wide
 * transition guard, so it does not belong in the frozen
 * `@signalpilot/trading-domain` catalogue.
 */
export const ShadowFillReasonCode = {
  POST_FILL_NET_CRV_BELOW_MINIMUM: "POST_FILL_NET_CRV_BELOW_MINIMUM"
} as const;
export type ShadowFillReasonCode =
  (typeof ShadowFillReasonCode)[keyof typeof ShadowFillReasonCode];

export const ShadowFillOutcome = {
  FILLED: "FILLED",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  /** Filled, but the post-fill net-CRV recheck fell short — see `ShadowFillReasonCode`. */
  FILLED_CRV_SHORTFALL: "FILLED_CRV_SHORTFALL",
  WAITING: "WAITING",
  EXPIRED: "EXPIRED",
  ENTRY_GAP_EXPIRED: "ENTRY_GAP_EXPIRED",
  ALREADY_PROCESSED: "ALREADY_PROCESSED",
  ERROR_LOCKED: "ERROR_LOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE"
} as const;
export type ShadowFillOutcome =
  (typeof ShadowFillOutcome)[keyof typeof ShadowFillOutcome];

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
  const precision = order.precisionSnapshotJson as Record<
    string,
    unknown
  > | null;
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
        where: {
          id: args.tradingSessionId,
          status: { not: TradingSessionStatus.ERROR_LOCKED }
        },
        data: {
          status: TradingSessionStatus.ERROR_LOCKED,
          killSwitchEngaged: true,
          killReasonCode: args.reasonCode,
          version: { increment: 1 }
        }
      });
    }
    await tx.portfolio.updateMany({
      where: {
        id: args.portfolioId,
        status: { not: PortfolioStatus.ERROR_LOCKED }
      },
      data: { status: PortfolioStatus.ERROR_LOCKED, version: { increment: 1 } }
    });
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
    return {
      outcome: ShadowFillOutcome.NOT_APPLICABLE,
      shadowFillId: null,
      shadowPositionId: null
    };
  }
  if (
    order.status !== ShadowOrderStatus.WAITING_FOR_ENTRY &&
    order.status !== ShadowOrderStatus.PARTIALLY_FILLED
  ) {
    return {
      outcome: ShadowFillOutcome.NOT_APPLICABLE,
      shadowFillId: null,
      shadowPositionId: null
    };
  }

  const candle = await database.candle.findUnique({
    where: { id: input.candleId }
  });
  if (candle === null || candle.closeTime.getTime() > input.asOf.getTime()) {
    return {
      outcome: ShadowFillOutcome.WAITING,
      shadowFillId: null,
      shadowPositionId: null,
      message: "Candle not closed yet."
    };
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
    return {
      outcome: ShadowFillOutcome.ALREADY_PROCESSED,
      shadowFillId: null,
      shadowPositionId: null
    };
  }

  const candidate = order.tradeCandidate;
  if (
    (order.direction !== TradeDirection.LONG &&
      order.direction !== TradeDirection.SHORT) ||
    candidate === null ||
    candidate.direction !== order.direction ||
    order.side !== ENTRY_SIDE[order.direction]
  ) {
    await engageErrorLock(database, {
      tradingSessionId: order.tradingSessionId,
      portfolioId: order.portfolioId,
      reasonCode: "SIMULATION_DIRECTION_MISMATCH",
      aggregateType: "ShadowOrder",
      aggregateId: order.id,
      inputHash: order.id,
      jobKey: SHADOW_FILL_JOB_KEY
    });
    return {
      outcome: ShadowFillOutcome.ERROR_LOCKED,
      shadowFillId: null,
      shadowPositionId: null
    };
  }
  const isFirstCandleForOrder = order.lastProcessedCandleId === null;

  if (
    isFirstCandleForOrder &&
    (candidate.plannedEntryMaximum !== null ||
      candidate.plannedEntryMinimum !== null)
  ) {
    const gap = checkEntryGap({
      direction: order.direction,
      candleOpen: decimalString(candle.open),
      ...(candidate.plannedEntryMaximum === null
        ? {}
        : {
            plannedEntryMaximum: decimalString(candidate.plannedEntryMaximum)
          }),
      ...(candidate.plannedEntryMinimum === null
        ? {}
        : { plannedEntryMinimum: decimalString(candidate.plannedEntryMinimum) })
    });
    if (gap.gapTooLarge) {
      await expireOrderAndReleaseReserve(
        database,
        order,
        candle.id,
        gap.reasonCode,
        input
      );
      return {
        outcome: ShadowFillOutcome.ENTRY_GAP_EXPIRED,
        shadowFillId: null,
        shadowPositionId: null
      };
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
    return {
      outcome: ShadowFillOutcome.ERROR_LOCKED,
      shadowFillId: null,
      shadowPositionId: null
    };
  }

  const fill = computeMarketFill({
    side: ENTRY_SIDE[order.direction] as MarketSide,
    referencePrice: decimalString(candle.open),
    requestedQuantity: decimalString(order.remainingQuantity),
    candle: toCandleSnapshot(candle),
    executionProfile: profileSnapshot,
    reservedQuoteAmount: decimalString(order.reservedQuoteAmount)
  });

  if (!fill.fillable) {
    if (
      fill.reasonCode === "SIMULATION_RESERVE_EXCEEDED" ||
      fill.reasonCode.startsWith("SIMULATION_INVALID")
    ) {
      await engageErrorLock(database, {
        tradingSessionId: order.tradingSessionId,
        portfolioId: order.portfolioId,
        reasonCode: fill.reasonCode,
        aggregateType: "ShadowOrder",
        aggregateId: order.id,
        inputHash: order.id,
        jobKey: SHADOW_FILL_JOB_KEY
      });
      return {
        outcome: ShadowFillOutcome.ERROR_LOCKED,
        shadowFillId: null,
        shadowPositionId: null
      };
    }

    // No fill this candle — mark the cursor and expire after the second
    // eligible candle if nothing has filled at all yet.
    const isSecondCandle = !isFirstCandleForOrder;
    if (isSecondCandle) {
      await expireOrderAndReleaseReserve(
        database,
        order,
        candle.id,
        fill.reasonCode,
        input
      );
      return {
        outcome: ShadowFillOutcome.EXPIRED,
        shadowFillId: null,
        shadowPositionId: null
      };
    }
    await database.shadowOrder.update({
      where: { id: order.id },
      data: { lastProcessedCandleId: candle.id, version: { increment: 1 } }
    });
    return {
      outcome: ShadowFillOutcome.WAITING,
      shadowFillId: null,
      shadowPositionId: null
    };
  }

  const portfolio = order.portfolio;
  if (portfolio === null) {
    return {
      outcome: ShadowFillOutcome.NOT_APPLICABLE,
      shadowFillId: null,
      shadowPositionId: null
    };
  }

  const remainingBefore = DecimalValue.fromString(
    decimalString(order.remainingQuantity)
  );
  const fillQuantity = DecimalValue.fromString(fill.fillQuantity);
  const isFinalFillForOrder = fillQuantity.gte(remainingBefore);
  const reservedBefore = DecimalValue.fromString(
    decimalString(order.reservedQuoteAmount)
  );
  // Proportional share of the remaining reserve tied to this fill, rounded up
  // so the reserve released to the fill never under-covers its actual cost;
  // the final fill takes whatever remains instead of leaving a residue.
  const reservedForFill = isFinalFillForOrder
    ? reservedBefore
    : reservedBefore
        .mul(fillQuantity, RoundingMode.CEIL)
        .div(remainingBefore, RoundingMode.CEIL);
  const collateralForFill =
    order.direction === TradeDirection.SHORT
      ? reservedForFill.sub(DecimalValue.fromString(fill.feeAmount))
      : DecimalValue.ZERO;
  if (collateralForFill.isNegative()) {
    await engageErrorLock(database, {
      tradingSessionId: order.tradingSessionId,
      portfolioId: order.portfolioId,
      reasonCode: "SIMULATION_COLLATERAL_UNDERFUNDED",
      aggregateType: "ShadowOrder",
      aggregateId: order.id,
      inputHash: order.id,
      jobKey: SHADOW_FILL_JOB_KEY
    });
    return {
      outcome: ShadowFillOutcome.ERROR_LOCKED,
      shadowFillId: null,
      shadowPositionId: null
    };
  }

  const existingFillCount = await database.shadowFill.count({
    where: { shadowOrderId: order.id }
  });
  const nextFillSequence = existingFillCount + 1;

  // Read fresh, not cached from anywhere earlier — the recheck below must
  // use the currently active limit set, never a value baked into the order
  // at approval time (docs/trading/06: limits are immutable from ACTIVE, but
  // an order's own snapshot is not the source of truth for this check).
  const activeRiskLimitSet = await database.riskLimitSet.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { version: "desc" }
  });

  let positionId: string | null = null;

  const result = await database.$transaction(async (tx) => {
    let position =
      order.shadowPositionId === null
        ? null
        : await tx.shadowPosition.findUnique({
            where: { id: order.shadowPositionId }
          });

    if (position === null) {
      if (
        candidate === null ||
        candidate.stopPrice === null ||
        candidate.takeProfitPrice === null
      ) {
        throw new Error(
          `ShadowOrder ${order.id} has no candidate price plan to open a position from.`
        );
      }
      const maxHoldHours = candidate.maxHoldHours ?? 72;
      const maxHoldUntil = new Date(
        candle.closeTime.getTime() + maxHoldHours * 60 * 60 * 1000
      );
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
          direction: order.direction,
          status: ShadowPositionStatus.OPENING,
          openScopeKey: buildOpenPositionScopeKey({
            portfolioId: order.portfolioId,
            assetId: order.assetId
          }),
          initialQuantity: "0",
          openQuantity: "0",
          averageEntryPrice: "0",
          reservedCollateral: "0",
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
          activePositionKey: buildActiveExitPlanScopeKey({
            shadowPositionId: created.id
          })
        }
      });
      position = await tx.shadowPosition.findUnique({
        where: { id: created.id }
      });
    }
    if (position === null)
      throw new Error("Position lookup failed immediately after creation.");
    positionId = position.id;

    const fillKey = buildFillKey({
      shadowOrderId: order.id,
      sourceCandleId: candle.id,
      sequence: nextFillSequence
    });
    const createdFill = await tx.shadowFill.create({
      data: {
        fillKey,
        shadowOrderId: order.id,
        shadowPositionId: position.id,
        assetId: order.assetId,
        sourceCandleId: candle.id,
        sequence: nextFillSequence,
        side: ENTRY_SIDE[order.direction],
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
        direction: order.direction,
        initialQuantity: decimalString(position.initialQuantity),
        openQuantity: decimalString(position.openQuantity),
        closedQuantity: decimalString(position.closedQuantity),
        averageEntryPrice: decimalString(position.averageEntryPrice),
        averageExitPrice:
          position.averageExitPrice === null
            ? null
            : decimalString(position.averageExitPrice),
        grossEntryNotional: decimalString(position.grossEntryNotional),
        grossExitNotional: decimalString(position.grossExitNotional),
        realizedPnl: decimalString(position.realizedPnl),
        feesPaid: decimalString(position.feesPaid),
        allocatedEntryFees: "0.000000000000",
        reservedCollateral: decimalString(position.reservedCollateral)
      },
      {
        quantity: fill.fillQuantity,
        fillPrice: fill.fillPrice,
        notional: fill.notional,
        feeAmount: fill.feeAmount,
        collateralAmount: collateralForFill.toString()
      }
    );
    if (!positionUpdate.ok || positionUpdate.position === null) {
      throw new Error(
        `Entry fill could not be applied to position ${position.id}: ${positionUpdate.reasonCode}`
      );
    }

    // ── Post-fill net-CRV recheck (docs/trading/05; ADR 0009) ──────────────
    // Uses the position's real weighted-average entry price and real fee —
    // never the pre-fill worst-case projection — against the same conservative
    // stop-exit cost model the pre-trade sizing used. Unreadable inputs or a
    // missing active limit set fail closed (never treated as a pass).
    const openQuantityAfterFill = DecimalValue.fromString(
      positionUpdate.position.openQuantity
    );
    const actualEntryFeePerUnit = openQuantityAfterFill.isPositive()
      ? DecimalValue.fromString(positionUpdate.position.feesPaid).div(
          openQuantityAfterFill,
          RoundingMode.CEIL
        )
      : DecimalValue.ZERO;
    const minRewardRisk =
      activeRiskLimitSet === null
        ? null
        : decimalString(activeRiskLimitSet.minRewardRisk);
    const recheck =
      candidate === null ||
      candidate.stopPrice === null ||
      candidate.takeProfitPrice === null
        ? null
        : computePostFillNetRewardRisk({
            direction: order.direction,
            actualAverageEntryPrice: DecimalValue.fromString(
              positionUpdate.position.averageEntryPrice
            ),
            actualEntryFeePerUnit,
            stopPrice: DecimalValue.fromString(
              decimalString(candidate.stopPrice)
            ),
            takeProfitPrice: DecimalValue.fromString(
              decimalString(candidate.takeProfitPrice)
            ),
            tickSize: DecimalValue.fromString(profileSnapshot.tickSize),
            feeBps: profileSnapshot.feeBps,
            fullSpreadBps: profileSnapshot.fullSpreadBps,
            slippageBps: profileSnapshot.slippageBps
          });
    const netCrvOk =
      recheck !== null &&
      recheck.computable &&
      minRewardRisk !== null &&
      DecimalValue.fromString(recheck.netRewardRisk).gte(
        DecimalValue.fromString(minRewardRisk)
      );

    let newOrderStatus: ShadowOrderStatus = isFinalFillForOrder
      ? ShadowOrderStatus.FILLED
      : ShadowOrderStatus.PARTIALLY_FILLED;
    const newRemaining = remainingBefore.sub(fillQuantity);
    let newReservedOnOrder = reservedBefore.sub(reservedForFill);
    let orderCancelReasonCode: string | null = null;

    // A shortfall never opens a "normal" position: it never grows this
    // order's exposure further. Any unfilled remainder stops pursuing more
    // fills right now — the filled quantity keeps its ExitPlan and is flagged
    // below for a forced, risk-reducing close instead of the ordinary exit.
    if (!netCrvOk && !isFinalFillForOrder) {
      newOrderStatus = ShadowOrderStatus.CANCELLED;
      orderCancelReasonCode =
        ShadowFillReasonCode.POST_FILL_NET_CRV_BELOW_MINIMUM;
    }
    const newPositionStatus =
      newOrderStatus === ShadowOrderStatus.FILLED ||
      newOrderStatus === ShadowOrderStatus.CANCELLED
        ? ShadowPositionStatus.OPEN
        : ShadowPositionStatus.OPENING;

    await tx.shadowOrder.update({
      where: { id: order.id },
      data: {
        status: newOrderStatus,
        filledQuantity: DecimalValue.fromString(
          decimalString(order.filledQuantity)
        )
          .add(fillQuantity)
          .toString(),
        remainingQuantity: newRemaining.toString(),
        reservedQuoteAmount: newReservedOnOrder.toString(),
        shadowPositionId: position.id,
        lastProcessedCandleId: candle.id,
        cancelReasonCode: orderCancelReasonCode ?? undefined,
        openEntryScopeKey:
          newOrderStatus === ShadowOrderStatus.FILLED ||
          newOrderStatus === ShadowOrderStatus.CANCELLED
            ? null
            : undefined,
        version: { increment: 1 }
      }
    });

    await tx.shadowPosition.update({
      where: { id: position.id },
      data: {
        initialQuantity: positionUpdate.position.initialQuantity,
        openQuantity: positionUpdate.position.openQuantity,
        averageEntryPrice: positionUpdate.position.averageEntryPrice,
        grossEntryNotional: positionUpdate.position.grossEntryNotional,
        reservedCollateral: positionUpdate.position.reservedCollateral,
        feesPaid: positionUpdate.position.feesPaid,
        status: newPositionStatus,
        openedAt:
          position.openedAt ??
          (newPositionStatus === ShadowPositionStatus.OPEN
            ? candle.closeTime
            : null),
        lastProcessedCandleId: candle.id,
        version: { increment: 1 }
      }
    });

    const eventSequence =
      (await tx.shadowPositionEvent.count({
        where: { shadowPositionId: position.id }
      })) + 1;
    await tx.shadowPositionEvent.create({
      data: {
        eventKey: buildPositionEventKey({
          shadowPositionId: position.id,
          sequence: eventSequence
        }),
        shadowPositionId: position.id,
        sequence: eventSequence,
        type:
          newPositionStatus === ShadowPositionStatus.OPEN
            ? ShadowPositionEventType.OPENED
            : ShadowPositionEventType.OPENING,
        sourceOrderId: order.id,
        sourceFillId: createdFill.id,
        sourceCandleId: candle.id,
        quantity: fill.fillQuantity,
        price: fill.fillPrice,
        payloadJson: asJson({
          jobKey: SHADOW_FILL_JOB_KEY,
          direction: order.direction,
          collateralAdded: collateralForFill.toString()
        }),
        occurredAt: candle.closeTime
      }
    });

    if (!netCrvOk) {
      const markSequence = eventSequence + 1;
      await tx.shadowPositionEvent.create({
        data: {
          eventKey: buildPositionEventKey({
            shadowPositionId: position.id,
            sequence: markSequence
          }),
          shadowPositionId: position.id,
          sequence: markSequence,
          type: ShadowPositionEventType.MARKED,
          sourceOrderId: order.id,
          sourceFillId: createdFill.id,
          sourceCandleId: candle.id,
          payloadJson: asJson({
            jobKey: SHADOW_FILL_JOB_KEY,
            reasonCode: ShadowFillReasonCode.POST_FILL_NET_CRV_BELOW_MINIMUM,
            recheck,
            minRewardRisk
          }),
          occurredAt: candle.closeTime
        }
      });

      const fillKeyHash = buildPayloadHash(fillKey);
      const forcedExitEventKey = buildRiskEventKey({
        type: RiskEventType.RISK_RULE_BLOCK,
        aggregateType: "ShadowPosition",
        aggregateId: position.id,
        inputHash: fillKeyHash
      });
      await tx.riskEvent.upsert({
        where: { eventKey: forcedExitEventKey },
        update: {},
        create: {
          eventKey: forcedExitEventKey,
          type: RiskEventType.RISK_RULE_BLOCK,
          severity: RiskSeverity.CRITICAL,
          reasonCode: ShadowFillReasonCode.POST_FILL_NET_CRV_BELOW_MINIMUM,
          portfolioId: portfolio.id,
          shadowOrderId: order.id,
          shadowPositionId: position.id,
          payloadJson: asJson({
            jobKey: SHADOW_FILL_JOB_KEY,
            recheck,
            minRewardRisk
          }),
          inputHash: fillKeyHash
        }
      });
    }

    const ledger = applyEntryFillLedger({
      direction: order.direction,
      state: toPortfolioState(portfolio),
      notionalEntryKey: `${fillKey}|${order.direction === TradeDirection.LONG ? "BUY" : "SELL"}_NOTIONAL`,
      feeEntryKey: `${fillKey}|FEE`,
      reservedForFill: reservedForFill.toString(),
      fill: {
        quantity: fill.fillQuantity,
        fillPrice: fill.fillPrice,
        notional: fill.notional,
        feeAmount: fill.feeAmount,
        collateralAmount: collateralForFill.toString()
      },
      shadowOrderId: order.id,
      shadowFillId: createdFill.id,
      shadowPositionId: position.id,
      occurredAt: candle.closeTime.toISOString()
    });
    if (!ledger.ok || ledger.nextState === null) {
      throw new Error(
        `Entry fill ledger booking failed for order ${order.id}: ${ledger.reasonCode}`
      );
    }
    const ledgerEntries = [...ledger.entries];
    let finalState = ledger.nextState;

    // Release whatever remained reserved for the now-cancelled remainder —
    // the reserve must never simply vanish from the books.
    if (
      newOrderStatus === ShadowOrderStatus.CANCELLED &&
      newReservedOnOrder.isPositive()
    ) {
      const release = computeReleaseReservation({
        state: finalState,
        entryKey: `${fillKey}-post-fill-crv-release`,
        releaseAmount: newReservedOnOrder.toString(),
        shadowOrderId: order.id,
        occurredAt: candle.closeTime.toISOString()
      });
      if (!release.ok || release.nextState === null) {
        throw new Error(
          `Post-fill CRV reserve release failed for order ${order.id}: ${release.reasonCode}`
        );
      }
      ledgerEntries.push(...release.entries);
      finalState = release.nextState;
      newReservedOnOrder = DecimalValue.ZERO;
      await tx.shadowOrder.update({
        where: { id: order.id },
        data: { reservedQuoteAmount: "0", openEntryScopeKey: null }
      });
    }

    for (const entry of ledgerEntries) {
      await tx.portfolioLedgerEntry.create({
        data: ledgerEntryCreateData(entry, portfolio.id)
      });
    }
    const markedPortfolio = await loadShadowPortfolioValuation(tx, {
      portfolioId: portfolio.id,
      asOf: input.asOf,
      availableCash: finalState.availableCash,
      reservedCash: finalState.reservedCash,
      realizedPnl: finalState.realizedPnl,
      feesPaid: finalState.feesPaid,
      highWaterMark: decimalString(portfolio.highWaterMark),
      startOfDayEquity: null
    });
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: {
        availableCash: finalState.availableCash,
        reservedCash: finalState.reservedCash,
        feesPaid: finalState.feesPaid,
        equity: markedPortfolio.valuation.equity,
        ledgerSequence: finalState.ledgerSequence,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) {
      throw new Error(
        `Portfolio ${portfolio.id} version conflict while booking an entry fill.`
      );
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
        reasonCode: netCrvOk
          ? "SIMULATION_FILLED"
          : ShadowFillReasonCode.POST_FILL_NET_CRV_BELOW_MINIMUM,
        tradingSessionId: order.tradingSessionId,
        afterState: asJson({
          fill,
          direction: order.direction,
          syntheticShadowShort: order.direction === TradeDirection.SHORT,
          reservedCollateral: positionUpdate.position.reservedCollateral,
          orderStatus: newOrderStatus,
          positionStatus: newPositionStatus,
          postFillCrvRecheck: recheck,
          postFillCrvOk: netCrvOk,
          minRewardRisk
        }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });

    return { fillId: createdFill.id, orderStatus: newOrderStatus, netCrvOk };
  });

  return {
    outcome: !result.netCrvOk
      ? ShadowFillOutcome.FILLED_CRV_SHORTFALL
      : result.orderStatus === ShadowOrderStatus.FILLED
        ? ShadowFillOutcome.FILLED
        : ShadowFillOutcome.PARTIALLY_FILLED,
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
      data: {
        status: ShadowOrderStatus.EXPIRED,
        openEntryScopeKey: null,
        lastProcessedCandleId: candleId,
        cancelReasonCode: reasonCode,
        version: { increment: 1 }
      }
    });
    return;
  }

  await database.$transaction(async (tx) => {
    const portfolio = await tx.portfolio.findUnique({
      where: { id: order.portfolioId }
    });
    if (portfolio === null)
      throw new Error(
        `Portfolio ${order.portfolioId} not found while releasing a reserve.`
      );

    const release = computeReleaseReservation({
      state: toPortfolioState(portfolio),
      entryKey: `${order.id}|expiry-release`,
      releaseAmount,
      shadowOrderId: order.id,
      occurredAt: input.asOf.toISOString()
    });
    if (!release.ok || release.nextState === null) {
      throw new Error(
        `Reserve release failed for order ${order.id}: ${release.reasonCode}`
      );
    }

    await tx.portfolioLedgerEntry.create({
      data: ledgerEntryCreateData(release.entries[0], portfolio.id)
    });
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: {
        availableCash: release.nextState.availableCash,
        reservedCash: release.nextState.reservedCash,
        ledgerSequence: release.nextState.ledgerSequence,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0)
      throw new Error(
        `Portfolio ${portfolio.id} version conflict while releasing a reserve.`
      );

    await tx.shadowOrder.update({
      where: { id: order.id },
      data: {
        status: ShadowOrderStatus.EXPIRED,
        openEntryScopeKey: null,
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
