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
  computeConservativeBidMark,
  computePositionMark,
  replayLedger,
  type LedgerEntryDraftV1,
  type PortfolioReasonCode
} from "@signalpilot/portfolio";
import { DecimalValue, buildAuditEventKey, buildRiskEventKey } from "@signalpilot/trading-domain";

import { asJson, decimalString } from "./shadowPortfolioIo.js";

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
  const portfolio = await database.portfolio.findUnique({ where: { id: input.portfolioId } });
  if (portfolio === null) {
    throw new Error(`Portfolio ${input.portfolioId} not found.`);
  }

  const [ledgerRows, orderIds, positionIds, reservingOrders, openPositions] = await Promise.all([
    database.portfolioLedgerEntry.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { sequence: "asc" }
    }),
    database.shadowOrder.findMany({ where: { portfolioId: portfolio.id }, select: { id: true } }),
    database.shadowPosition.findMany({ where: { portfolioId: portfolio.id }, select: { id: true } }),
    database.shadowOrder.findMany({
      where: { portfolioId: portfolio.id, status: { in: RESERVING_ORDER_STATUSES } },
      select: { id: true, reservedQuoteAmount: true }
    }),
    database.shadowPosition.findMany({
      where: { portfolioId: portfolio.id, status: { in: EXPOSURE_POSITION_STATUSES } }
    })
  ]);
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
    shadowPositionIds: new Set(positionIds.map((row) => row.id))
  });

  const marks: { marketValue: string; unrealizedPnl: string }[] = [];
  for (const position of openPositions) {
    const latestCandle = await database.candle.findFirst({
      where: { assetId: position.assetId, timeframe: "1h", closeTime: { lte: input.asOf } },
      orderBy: { closeTime: "desc" }
    });
    const profile = await database.instrumentExecutionProfile.findFirst({
      where: { assetId: position.assetId, status: "ACTIVE" },
      orderBy: { version: "desc" }
    });
    if (latestCandle === null || profile === null) continue;
    const bidMark = computeConservativeBidMark(decimalString(latestCandle.close), profile.fullSpreadBps, decimalString(profile.tickSize));
    if (bidMark === null) continue;
    const mark = computePositionMark({
      openQuantity: decimalString(position.openQuantity),
      averageEntryPrice: decimalString(position.averageEntryPrice),
      conservativeBidMark: bidMark,
      estimatedExitFeeRate: (profile.feeBps / 10_000).toFixed(12)
    });
    if (mark !== null) marks.push(mark);
  }
  const marketValue = DecimalValue.sum(marks.map((mark) => DecimalValue.fromString(mark.marketValue))).toString();

  const duplicateAssetScopeCount = (() => {
    const counts = new Map<string, number>();
    for (const position of openPositions) counts.set(position.assetId, (counts.get(position.assetId) ?? 0) + 1);
    return [...counts.values()].filter((count) => count > 1).length;
  })();

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
    openReservations: reservingOrders.map((order) => ({
      shadowOrderId: order.id,
      reservedQuoteAmount: decimalString(order.reservedQuoteAmount)
    })),
    marketValue,
    orphanReferenceCount: replay.orphanReferenceCount,
    sequenceGapCount: replay.sequenceGapCount,
    duplicateAssetScopeCount,
    toleranceUnscaled: "0.00000001"
  });

  const session = await database.tradingSession.findFirst({
    where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" }
  });

  if (!report.consistent) {
    await database.$transaction(async (tx) => {
      for (const violation of report.violations) {
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
            payloadJson: asJson({ jobKey: SHADOW_RECONCILE_JOB_KEY, violation }),
            inputHash: violation
          }
        });
      }
      if (session !== null) {
        await tx.tradingSession.updateMany({
          where: { id: session.id, status: { not: TradingSessionStatus.ERROR_LOCKED } },
          data: {
            status: TradingSessionStatus.ERROR_LOCKED,
            killSwitchEngaged: true,
            killReasonCode: report.violations[0],
            version: { increment: 1 }
          }
        });
      }
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
          reasonCode: report.violations[0] ?? "PORTFOLIO_INCONSISTENT",
          afterState: asJson({ violations: report.violations }),
          codeVersion: input.codeVersion,
          occurredAt: input.asOf
        }
      });
    });
    return { consistent: false, violations: report.violations, reconciledAt: null };
  }

  await database.$transaction(async (tx) => {
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: { lastReconciledAt: input.asOf, version: { increment: 1 } }
    });
    if (updated.count === 0) throw new Error(`Portfolio ${portfolio.id} version conflict during reconciliation.`);
    if (session !== null) {
      await tx.tradingSession.updateMany({
        where: { id: session.id },
        data: { reconciledAt: input.asOf, heartbeatAt: input.asOf, version: { increment: 1 } }
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
        afterState: asJson({ ledgerSequence: replay.state.ledgerSequence, entryCount: replay.entryCount }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });
  });

  return { consistent: true, violations: [], reconciledAt: input.asOf.toISOString() };
}
