/**
 * Full ledger replay and cross-aggregate invariant check for one portfolio.
 *
 * Specification:
 *   docs/trading/06-risk-engine-specification.md, "Portfolio-Konsistenz und Toleranz"
 *   docs/trading/02-shadow-trading-target-architecture.md, "Wiederaufnahme nach
 *     Prozessabbruch"
 *   docs/trading/decisions/0004-postgresql-workflow-ledger-and-atomic-audit.md
 *
 * A mismatch never gets "corrected" by writing the cache from the replay —
 * it locks the session and raises a critical `RiskEvent`, and only an
 * explicit, reviewed admin correction (out of P4 scope, ADR 0004) can resolve
 * it. `lastReconciledAt` is written only on a fully clean pass.
 */

import {
  PortfolioStatus,
  RiskEventType,
  RiskSeverity,
  ShadowOrderStatus,
  ShadowPositionStatus,
  TradingActorType,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import {
  checkPortfolioInvariants,
  replayLedger,
  type LedgerEntryDraftV1,
  PortfolioReasonCode,
  type PositionMarkResultV1
} from "@signalpilot/portfolio";
import {
  DecimalValue,
  ENTRY_SIDE,
  EXIT_SIDE,
  RoundingMode,
  TradeDirection,
  buildAuditEventKey,
  buildOpenEntryOrderScopeKey,
  buildOpenPositionScopeKey,
  buildRiskEventKey,
  grossPnl
} from "@signalpilot/trading-domain";

import { asJson, decimalString } from "./shadowPortfolioIo.js";
import { loadShadowPortfolioValuation } from "./shadowPortfolioValuation.js";

export const SHADOW_RECONCILE_JOB_KEY = "trading:shadow-reconcile-portfolio";

const EXPOSURE_POSITION_STATUSES = [
  ShadowPositionStatus.OPENING,
  ShadowPositionStatus.OPEN,
  ShadowPositionStatus.PARTIALLY_CLOSED,
  ShadowPositionStatus.ERROR
];
const RESERVING_ORDER_STATUSES = [
  ShadowOrderStatus.ACCEPTED,
  ShadowOrderStatus.WAITING_FOR_ENTRY,
  ShadowOrderStatus.PARTIALLY_FILLED
];

export interface ReconcilePortfolioInput {
  readonly portfolioId: string;
  readonly asOf: Date;
  readonly codeVersion: string;
  readonly correlationId: string;
}

export interface ReconcilePortfolioResult {
  readonly consistent: boolean;
  readonly violations: readonly PortfolioReasonCode[];
  readonly reconciledAt: string | null;
}

export async function reconcilePortfolio(
  database: PrismaClient,
  input: ReconcilePortfolioInput
): Promise<ReconcilePortfolioResult> {
  const portfolio = await database.portfolio.findUnique({
    where: { id: input.portfolioId }
  });
  if (portfolio === null) {
    throw new Error(`Portfolio ${input.portfolioId} not found.`);
  }

  const [ledgerRows, orderIds, allPositions, reservingOrders] =
    await Promise.all([
      database.portfolioLedgerEntry.findMany({
        where: { portfolioId: portfolio.id },
        orderBy: { sequence: "asc" }
      }),
      database.shadowOrder.findMany({
        where: { portfolioId: portfolio.id },
        select: { id: true }
      }),
      database.shadowPosition.findMany({
        where: { portfolioId: portfolio.id },
        include: {
          entryOrder: {
            include: {
              tradeCandidate: true,
              tradeDecision: { include: { riskAssessment: true } }
            }
          },
          strategyVersion: true,
          strategyAssignment: true,
          fills: { orderBy: { occurredAt: "asc" } }
        }
      }),
      database.shadowOrder.findMany({
        where: {
          portfolioId: portfolio.id,
          purpose: "ENTRY",
          status: { in: RESERVING_ORDER_STATUSES }
        },
        select: {
          id: true,
          assetId: true,
          direction: true,
          purpose: true,
          shadowPositionId: true,
          openEntryScopeKey: true,
          reservedQuoteAmount: true
        }
      })
    ]);
  const openPositions = allPositions.filter((position) =>
    EXPOSURE_POSITION_STATUSES.includes(position.status as never)
  );
  // Fills are scoped to this portfolio's orders rather than through a
  // relation filter, so the check works against a plain foreign-key index.
  const fillIds = await database.shadowFill.findMany({
    where: { shadowOrderId: { in: orderIds.map((row) => row.id) } },
    select: { id: true }
  });

  const draftEntries: LedgerEntryDraftV1[] = ledgerRows.map((row) => ({
    entryKey: row.entryKey,
    sequence: row.sequence,
    type: row.type,
    availableCashDelta: decimalString(row.availableCashDelta),
    reservedCashDelta: decimalString(row.reservedCashDelta),
    realizedPnlDelta: decimalString(row.realizedPnlDelta),
    feeDelta: decimalString(row.feeDelta),
    shadowOrderId: row.shadowOrderId,
    shadowFillId: row.shadowFillId,
    shadowPositionId: row.shadowPositionId,
    correctionOfId: row.correctionOfId,
    balanceAfterJson: {},
    occurredAt: row.occurredAt.toISOString()
  }));

  const replay = replayLedger(draftEntries, {
    shadowOrderIds: new Set(orderIds.map((row) => row.id)),
    shadowFillIds: new Set(fillIds.map((row) => row.id)),
    shadowPositionIds: new Set(allPositions.map((row) => row.id))
  });

  const marks: PositionMarkResultV1[] = [];
  const directionalViolations = new Set<PortfolioReasonCode>();
  try {
    const loadedValuation = await loadShadowPortfolioValuation(database, {
      portfolioId: portfolio.id,
      asOf: input.asOf,
      availableCash: decimalString(portfolio.availableCash),
      reservedCash: decimalString(portfolio.reservedCash),
      realizedPnl: decimalString(portfolio.realizedPnl),
      feesPaid: decimalString(portfolio.feesPaid),
      highWaterMark: decimalString(portfolio.highWaterMark),
      startOfDayEquity: null
    });
    marks.push(...loadedValuation.marks);
  } catch {
    directionalViolations.add(PortfolioReasonCode.INVALID_AMOUNT);
  }
  // `checkPortfolioInvariants` historically calls this value `marketValue`.
  // For SHORT the collateral is already inside reserved cash, so only the
  // unrealized PnL contributes to equity; LONG still contributes market value.
  const equityContribution = DecimalValue.sum(
    marks.map((mark) => DecimalValue.fromString(mark.equityContribution))
  ).toString();

  const duplicateAssetScopeCount = (() => {
    const counts = new Map<string, number>();
    for (const position of openPositions)
      counts.set(position.assetId, (counts.get(position.assetId) ?? 0) + 1);
    return [...counts.values()].filter((count) => count > 1).length;
  })();

  const activeOrdersByAsset = new Map<string, typeof reservingOrders>();
  for (const order of reservingOrders) {
    const entries = activeOrdersByAsset.get(order.assetId) ?? [];
    activeOrdersByAsset.set(order.assetId, [...entries, order]);
    if (
      order.openEntryScopeKey !==
      buildOpenEntryOrderScopeKey({
        portfolioId: portfolio.id,
        assetId: order.assetId,
        purpose: order.purpose
      })
    ) {
      directionalViolations.add(
        PortfolioReasonCode.DUPLICATE_ENTRY_ORDER_SCOPE
      );
    }
  }
  if ([...activeOrdersByAsset.values()].some((orders) => orders.length > 1)) {
    directionalViolations.add(PortfolioReasonCode.DUPLICATE_ENTRY_ORDER_SCOPE);
  }

  for (const position of allPositions) {
    const assignmentConfig = position.strategyAssignment.assignmentConfigJson;
    const assignmentDirection =
      typeof assignmentConfig === "object" &&
      assignmentConfig !== null &&
      !Array.isArray(assignmentConfig)
        ? (assignmentConfig as Record<string, unknown>).direction
        : null;
    const strategyParameters = position.strategyVersion.parametersJson;
    const strategyDirection =
      typeof strategyParameters === "object" &&
      strategyParameters !== null &&
      !Array.isArray(strategyParameters)
        ? (strategyParameters as Record<string, unknown>).direction
        : null;
    const entryFills = position.fills.filter(
      (fill) => fill.triggerType === "ENTRY"
    );
    const exitFills = position.fills.filter(
      (fill) => fill.triggerType !== "ENTRY"
    );
    if (
      (position.direction !== TradeDirection.LONG &&
        position.direction !== TradeDirection.SHORT) ||
      position.entryOrder.direction !== position.direction ||
      position.entryOrder.tradeCandidate?.direction !== position.direction ||
      strategyDirection !== position.direction ||
      assignmentDirection !== position.direction ||
      entryFills.some((fill) => fill.side !== ENTRY_SIDE[position.direction]) ||
      exitFills.some((fill) => fill.side !== EXIT_SIDE[position.direction])
    ) {
      directionalViolations.add(PortfolioReasonCode.DIRECTION_MISMATCH);
    }

    const isOpen = EXPOSURE_POSITION_STATUSES.includes(
      position.status as never
    );
    const collateral = DecimalValue.fromString(
      decimalString(position.reservedCollateral)
    );
    if (
      (position.direction === TradeDirection.LONG && !collateral.isZero()) ||
      (!isOpen && !collateral.isZero()) ||
      (position.direction === TradeDirection.SHORT &&
        isOpen &&
        !collateral.isPositive())
    ) {
      directionalViolations.add(PortfolioReasonCode.COLLATERAL_MISMATCH);
    }

    if (position.direction === TradeDirection.SHORT && isOpen) {
      const sizingJson =
        position.entryOrder.tradeDecision?.riskAssessment?.inputsJson;
      const sizing =
        typeof sizingJson === "object" &&
        sizingJson !== null &&
        !Array.isArray(sizingJson)
          ? (sizingJson as Record<string, unknown>).sizing
          : null;
      const sizingRecord =
        typeof sizing === "object" && sizing !== null && !Array.isArray(sizing)
          ? (sizing as Record<string, unknown>)
          : null;
      const approvedQuantity = sizingRecord?.approvedQuantity;
      const reservedQuoteAmount = sizingRecord?.reservedQuoteAmount;
      if (
        typeof approvedQuantity !== "string" ||
        typeof reservedQuoteAmount !== "string" ||
        !DecimalValue.isDecimalString(approvedQuantity) ||
        !DecimalValue.isDecimalString(reservedQuoteAmount)
      ) {
        directionalViolations.add(PortfolioReasonCode.COLLATERAL_MISMATCH);
      } else {
        const approved = DecimalValue.fromString(approvedQuantity);
        const initial = DecimalValue.fromString(
          decimalString(position.initialQuantity)
        );
        const open = DecimalValue.fromString(
          decimalString(position.openQuantity)
        );
        const entryFees = DecimalValue.sum(
          entryFills.map((fill) =>
            DecimalValue.fromString(decimalString(fill.feeAmount))
          )
        );
        const initialCollateral = approved.isPositive()
          ? DecimalValue.fromString(reservedQuoteAmount)
              .mul(initial, RoundingMode.CEIL)
              .div(approved, RoundingMode.CEIL)
              .sub(entryFees)
          : DecimalValue.ZERO;
        const expectedCollateral = initial.isPositive()
          ? initialCollateral
              .mul(open, RoundingMode.FLOOR)
              .div(initial, RoundingMode.FLOOR)
          : DecimalValue.ZERO;
        if (
          collateral
            .sub(expectedCollateral)
            .abs()
            .gt(DecimalValue.fromString("0.00000001"))
        ) {
          directionalViolations.add(PortfolioReasonCode.COLLATERAL_MISMATCH);
        }
      }
    }

    const averageEntry = DecimalValue.fromString(
      decimalString(position.averageEntryPrice)
    );
    const entryFees = DecimalValue.sum(
      entryFills.map((fill) =>
        DecimalValue.fromString(decimalString(fill.feeAmount))
      )
    );
    const exitFees = DecimalValue.sum(
      exitFills.map((fill) =>
        DecimalValue.fromString(decimalString(fill.feeAmount))
      )
    );
    const grossRealized = DecimalValue.sum(
      exitFills.map((fill) =>
        grossPnl(
          position.direction,
          averageEntry,
          DecimalValue.fromString(decimalString(fill.fillPrice)),
          DecimalValue.fromString(decimalString(fill.quantity)),
          RoundingMode.FLOOR
        )
      )
    );
    const initialQuantity = DecimalValue.fromString(
      decimalString(position.initialQuantity)
    );
    const closedQuantity = DecimalValue.fromString(
      decimalString(position.closedQuantity)
    );
    const allocatedEntryFees = initialQuantity.isPositive()
      ? closedQuantity.gte(initialQuantity)
        ? entryFees
        : entryFees
            .mul(closedQuantity, RoundingMode.CEIL)
            .div(initialQuantity, RoundingMode.CEIL)
      : DecimalValue.ZERO;
    const expectedRealized = grossRealized
      .sub(allocatedEntryFees)
      .sub(exitFees);
    if (
      expectedRealized
        .sub(DecimalValue.fromString(decimalString(position.realizedPnl)))
        .abs()
        .gt(DecimalValue.fromString("0.00000001"))
    ) {
      directionalViolations.add(PortfolioReasonCode.PNL_SIGN_MISMATCH);
    }

    if (isOpen) {
      if (
        position.openScopeKey !==
        buildOpenPositionScopeKey({
          portfolioId: portfolio.id,
          assetId: position.assetId
        })
      ) {
        directionalViolations.add(
          PortfolioReasonCode.DUPLICATE_ASSET_POSITION_SCOPE
        );
      }
      const conflictingOrders = activeOrdersByAsset.get(position.assetId) ?? [];
      if (
        conflictingOrders.some(
          (order) =>
            order.shadowPositionId !== position.id &&
            order.direction !== position.direction
        )
      ) {
        directionalViolations.add(PortfolioReasonCode.OPPOSING_ACTIVE_SCOPE);
      }
    }
  }

  const report = checkPortfolioInvariants({
    cache: {
      availableCash: decimalString(portfolio.availableCash),
      reservedCash: decimalString(portfolio.reservedCash),
      realizedPnl: decimalString(portfolio.realizedPnl),
      feesPaid: decimalString(portfolio.feesPaid),
      ledgerSequence: portfolio.ledgerSequence
    },
    cacheEquity: decimalString(portfolio.equity),
    replayed: replay.state,
    openReservations: [
      ...reservingOrders.map((order) => ({
        shadowOrderId: order.id,
        reservedQuoteAmount: decimalString(order.reservedQuoteAmount)
      })),
      ...openPositions
        .filter((position) => position.direction === TradeDirection.SHORT)
        .map((position) => ({
          shadowOrderId: position.entryOrderId,
          reservedQuoteAmount: decimalString(position.reservedCollateral)
        }))
    ],
    marketValue: equityContribution,
    orphanReferenceCount: replay.orphanReferenceCount,
    sequenceGapCount: replay.sequenceGapCount,
    duplicateAssetScopeCount,
    toleranceUnscaled: "0.00000001"
  });
  const violations = Object.freeze([
    ...new Set([...report.violations, ...directionalViolations])
  ]);
  const consistent = violations.length === 0;

  const session = await database.tradingSession.findFirst({
    where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" }
  });

  if (!consistent) {
    await database.$transaction(async (tx) => {
      for (const violation of violations) {
        const eventKey = buildRiskEventKey({
          type: RiskEventType.RECONCILIATION_FINDING,
          aggregateType: "Portfolio",
          aggregateId: portfolio.id,
          inputHash: violation
        });
        await tx.riskEvent.upsert({
          where: { eventKey },
          update: {},
          create: {
            eventKey,
            type: RiskEventType.RECONCILIATION_FINDING,
            severity: RiskSeverity.CRITICAL,
            reasonCode: violation,
            portfolioId: portfolio.id,
            tradingSessionId: session?.id ?? null,
            payloadJson: asJson({
              jobKey: SHADOW_RECONCILE_JOB_KEY,
              violation
            }),
            inputHash: violation
          }
        });
      }
      if (session !== null) {
        await tx.tradingSession.updateMany({
          where: {
            id: session.id,
            status: { not: TradingSessionStatus.ERROR_LOCKED }
          },
          data: {
            status: TradingSessionStatus.ERROR_LOCKED,
            killSwitchEngaged: true,
            killReasonCode: violations[0],
            version: { increment: 1 }
          }
        });
      }
      await tx.portfolio.updateMany({
        where: {
          id: portfolio.id,
          status: { not: PortfolioStatus.ERROR_LOCKED }
        },
        data: {
          status: PortfolioStatus.ERROR_LOCKED,
          version: { increment: 1 }
        }
      });
      await tx.tradingAuditEvent.create({
        data: {
          eventKey: buildAuditEventKey({
            eventType: "SHADOW_RECONCILE_MISMATCH",
            aggregateType: "Portfolio",
            aggregateId: portfolio.id,
            idempotencyKey: `${input.correlationId}-mismatch`
          }),
          eventType: "SHADOW_RECONCILE_MISMATCH",
          aggregateType: "Portfolio",
          aggregateId: portfolio.id,
          actorType: TradingActorType.SYSTEM,
          actorId: SHADOW_RECONCILE_JOB_KEY,
          correlationId: input.correlationId,
          causationId: input.correlationId,
          idempotencyKey: `${input.correlationId}|mismatch`,
          reasonCode: violations[0] ?? "PORTFOLIO_INCONSISTENT",
          afterState: asJson({ violations }),
          codeVersion: input.codeVersion,
          occurredAt: input.asOf
        }
      });
    });
    return { consistent: false, violations, reconciledAt: null };
  }

  await database.$transaction(async (tx) => {
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: { lastReconciledAt: input.asOf, version: { increment: 1 } }
    });
    if (updated.count === 0)
      throw new Error(
        `Portfolio ${portfolio.id} version conflict during reconciliation.`
      );
    if (session !== null) {
      await tx.tradingSession.updateMany({
        where: { id: session.id },
        data: {
          reconciledAt: input.asOf,
          heartbeatAt: input.asOf,
          version: { increment: 1 }
        }
      });
    }
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SHADOW_RECONCILE_SUCCESS",
          aggregateType: "Portfolio",
          aggregateId: portfolio.id,
          idempotencyKey: `${input.correlationId}-success`
        }),
        eventType: "SHADOW_RECONCILE_SUCCESS",
        aggregateType: "Portfolio",
        aggregateId: portfolio.id,
        actorType: TradingActorType.SYSTEM,
        actorId: SHADOW_RECONCILE_JOB_KEY,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        idempotencyKey: `${input.correlationId}-success`,
        reasonCode: "PORTFOLIO_CONSISTENT",
        afterState: asJson({
          ledgerSequence: replay.state.ledgerSequence,
          entryCount: replay.entryCount
        }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });
  });

  return {
    consistent: true,
    violations: [],
    reconciledAt: input.asOf.toISOString()
  };
}
