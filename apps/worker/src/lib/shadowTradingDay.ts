/**
 * Idempotent UTC day rollover: the start-of-day equity snapshot `R-010-DAILY-LOSS`
 * needs.
 *
 * Specification:
 *   docs/trading/06-risk-engine-specification.md, "Tagesverlust und Drawdown"
 *     — `startOfDayEquity` is the last reconciled snapshot at/shortly after
 *       00:00 UTC; missing it blocks new trades.
 *   docs/trading/02-shadow-trading-target-architecture.md, Jobs table,
 *     `trading:portfolio-snapshot`.
 *
 * Idempotent by `(portfolioId, tradingDateUtc)`: a second call on the same
 * UTC day finds the existing snapshot and changes nothing. This job never
 * activates a session — it only ensures the risk engine has a start-of-day
 * reference to compare against.
 */

import { ShadowPositionStatus, TradingActorType, type PrismaClient } from "@signalpilot/database";
import {
  computeConservativeBidMark,
  computePortfolioValuation,
  computePositionMark
} from "@signalpilot/portfolio";
import { DecimalValue, buildAuditEventKey, buildSpecificationHash } from "@signalpilot/trading-domain";

import { asJson, decimalString } from "./shadowPortfolioIo.js";

export const SHADOW_TRADING_DAY_JOB_KEY = "trading:shadow-start-trading-day";

const OPEN_POSITION_STATUSES = [
  ShadowPositionStatus.OPENING,
  ShadowPositionStatus.OPEN,
  ShadowPositionStatus.PARTIALLY_CLOSED,
  ShadowPositionStatus.ERROR
];

export interface StartTradingDayInput {
  readonly portfolioId: string;
  readonly asOf: Date;
  readonly codeVersion: string;
  readonly correlationId: string;
}

export interface StartTradingDayResult {
  readonly outcome: "CREATED" | "ALREADY_STARTED";
  readonly portfolioSnapshotId: string;
  readonly tradingDateUtc: string;
}

const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export async function startTradingDay(
  database: PrismaClient,
  input: StartTradingDayInput
): Promise<StartTradingDayResult> {
  const tradingDateUtc = startOfUtcDay(input.asOf);

  const existing = await database.portfolioSnapshot.findFirst({
    where: { portfolioId: input.portfolioId, tradingDateUtc },
    orderBy: { asOf: "asc" }
  });
  if (existing !== null) {
    return { outcome: "ALREADY_STARTED", portfolioSnapshotId: existing.id, tradingDateUtc: tradingDateUtc.toISOString() };
  }

  const portfolio = await database.portfolio.findUnique({ where: { id: input.portfolioId } });
  if (portfolio === null) throw new Error(`Portfolio ${input.portfolioId} not found.`);

  const openPositions = await database.shadowPosition.findMany({
    where: { portfolioId: portfolio.id, status: { in: OPEN_POSITION_STATUSES } }
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

  const valuation = computePortfolioValuation({
    availableCash: decimalString(portfolio.availableCash),
    reservedCash: decimalString(portfolio.reservedCash),
    realizedPnl: decimalString(portfolio.realizedPnl),
    feesPaid: decimalString(portfolio.feesPaid),
    openPositionMarks: marks,
    highWaterMark: decimalString(portfolio.highWaterMark),
    startOfDayEquity: null
  });
  if (valuation === null) throw new Error(`Portfolio ${portfolio.id} valuation inputs are unreadable.`);

  const grossExposure = DecimalValue.fromString(decimalString(portfolio.reservedCash))
    .add(DecimalValue.fromString(valuation.marketValue))
    .toString();

  const created = await database.$transaction(async (tx) => {
    const snapshot = await tx.portfolioSnapshot.create({
      data: {
        portfolioId: portfolio.id,
        asOf: input.asOf,
        tradingDateUtc,
        sourceLedgerSequence: portfolio.ledgerSequence,
        availableCash: portfolio.availableCash,
        reservedCash: portfolio.reservedCash,
        marketValue: valuation.marketValue,
        equity: valuation.equity,
        realizedPnl: portfolio.realizedPnl,
        unrealizedPnl: valuation.unrealizedPnl,
        feesPaid: portfolio.feesPaid,
        dailyPnl: "0",
        highWaterMark: valuation.highWaterMark,
        drawdownAmount: valuation.drawdownAmount,
        drawdownPct: valuation.drawdownPct,
        grossExposure,
        openPositionCount: openPositions.length,
        valuationJson: asJson({ marks, jobKey: SHADOW_TRADING_DAY_JOB_KEY }),
        inputHash: buildSpecificationHash({
          portfolioId: portfolio.id,
          tradingDateUtc: tradingDateUtc.toISOString(),
          sourceLedgerSequence: portfolio.ledgerSequence
        })
      }
    });

    if (DecimalValue.fromString(valuation.highWaterMark).gt(DecimalValue.fromString(decimalString(portfolio.highWaterMark)))) {
      await tx.portfolio.updateMany({
        where: { id: portfolio.id, version: portfolio.version },
        data: { highWaterMark: valuation.highWaterMark, version: { increment: 1 } }
      });
    }

    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SHADOW_TRADING_DAY_STARTED",
          aggregateType: "Portfolio",
          aggregateId: portfolio.id,
          idempotencyKey: tradingDateUtc.toISOString()
        }),
        eventType: "SHADOW_TRADING_DAY_STARTED",
        aggregateType: "Portfolio",
        aggregateId: portfolio.id,
        actorType: TradingActorType.SYSTEM,
        actorId: SHADOW_TRADING_DAY_JOB_KEY,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        idempotencyKey: tradingDateUtc.toISOString(),
        reasonCode: "SHADOW_TRADING_DAY_STARTED",
        afterState: asJson({ portfolioSnapshotId: snapshot.id, equity: valuation.equity }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });

    return snapshot;
  });

  return { outcome: "CREATED", portfolioSnapshotId: created.id, tradingDateUtc: tradingDateUtc.toISOString() };
}
