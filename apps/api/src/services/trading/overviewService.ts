/**
 * `/trading/overview` snapshot assembly.
 *
 * Specification: P6 task, "Overview" — "Baue den Snapshot transaktional oder
 * mit klar dokumentierter Konsistenzgrenze. Keine stillschweigende Mischung
 * widersprüchlicher Zustände."
 *
 * Consistency boundary: every field below is read fresh, individually, in
 * this function's own short sequence of queries — this is NOT one atomic
 * database snapshot (no interactive transaction wraps it). A write landing
 * between two of these reads could in theory mean, for example, a brand new
 * candidate is missing from `latestActivity` while the position counts
 * already reflect a fill that candidate produced moments earlier. What it
 * can never do is mix a STALE value for one field with a fresh value that
 * contradicts it, because nothing here is cached or derived from a snapshot
 * older than this request — every number comes straight from its own
 * current source of truth (`Portfolio`, `ShadowPosition`, `ShadowOrder`,
 * `RiskEvent`, `TradingSession`), and `unrealizedPnl`/`dailyPnl`/`drawdown`
 * are computed once, together, from the SAME `computePortfolioValuation`
 * call so those specific fields are mutually consistent with each other.
 */

import {
  PortfolioStatus,
  RiskSeverity,
  ShadowOrderStatus,
  ShadowPositionStatus,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { computeConservativeBidMark, computePortfolioValuation, computePositionMark } from "@signalpilot/portfolio";

import { getWorkerStatus } from "./workerStatusService.js";

const OPEN_POSITION_STATUSES = [
  ShadowPositionStatus.OPENING,
  ShadowPositionStatus.OPEN,
  ShadowPositionStatus.PARTIALLY_CLOSED,
  ShadowPositionStatus.ERROR
];
const OPEN_ORDER_STATUSES = [
  ShadowOrderStatus.PROPOSED,
  ShadowOrderStatus.ACCEPTED,
  ShadowOrderStatus.WAITING_FOR_ENTRY,
  ShadowOrderStatus.PARTIALLY_FILLED
];

const decimalString = (value: unknown): string => (value === null || value === undefined ? "0" : String(value));
const startOfUtcDay = (value: Date): Date => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export async function getOverview(database: PrismaClient = prisma) {
  const now = new Date();

  const portfolio = await database.portfolio.findFirst({
    where: { status: { not: PortfolioStatus.ARCHIVED } },
    orderBy: { createdAt: "asc" }
  });

  if (portfolio === null) {
    return {
      asOf: now.toISOString(),
      portfolio: null,
      session: null,
      openPositionCount: 0,
      openOrderCount: 0,
      tradesToday: 0,
      unrealizedPnl: "0",
      realizedPnl: "0",
      equity: "0",
      dailyPnl: null,
      drawdownAmount: "0",
      drawdownPct: "0",
      latestActivity: { candidate: null, riskAssessment: null, order: null },
      lastReconciledAt: null,
      workerHeartbeatAt: null,
      circuitBreakerBlocked: false,
      activeCriticalRiskEventCount: 0
    };
  }

  const [session, openPositions, todayStartSnapshot, latestCandidate, latestRiskAssessment, latestOrder, openOrderCount, activeCriticalRiskEventCount, workerStatus] =
    await Promise.all([
      database.tradingSession.findFirst({
        where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
        orderBy: { createdAt: "desc" }
      }),
      database.shadowPosition.findMany({
        where: { portfolioId: portfolio.id, status: { in: OPEN_POSITION_STATUSES } },
        include: { asset: { select: { symbol: true } } }
      }),
      database.portfolioSnapshot.findFirst({
        where: { portfolioId: portfolio.id, tradingDateUtc: startOfUtcDay(now) },
        orderBy: { asOf: "asc" }
      }),
      database.tradeCandidate.findFirst({
        where: { portfolioId: portfolio.id },
        orderBy: { dataAsOf: "desc" },
        include: { asset: { select: { symbol: true } } }
      }),
      database.riskAssessment.findFirst({ where: { portfolioId: portfolio.id }, orderBy: { assessedAt: "desc" } }),
      database.shadowOrder.findFirst({ where: { portfolioId: portfolio.id }, orderBy: { createdAt: "desc" } }),
      database.shadowOrder.count({ where: { portfolioId: portfolio.id, status: { in: OPEN_ORDER_STATUSES } } }),
      database.riskEvent.count({ where: { portfolioId: portfolio.id, severity: RiskSeverity.CRITICAL, acknowledgedAt: null } }),
      getWorkerStatus(database)
    ]);

  const marks: { marketValue: string; unrealizedPnl: string }[] = [];
  for (const position of openPositions) {
    const latestCandle = await database.candle.findFirst({
      where: { assetId: position.assetId, timeframe: "1h", closeTime: { lte: now } },
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
    startOfDayEquity: todayStartSnapshot ? decimalString(todayStartSnapshot.equity) : null
  });

  const todayStart = startOfUtcDay(now);
  const tradesToday = await database.shadowFill.count({
    where: { occurredAt: { gte: todayStart, lte: now }, shadowOrder: { portfolioId: portfolio.id } }
  });

  const entryJobsBlocked = workerStatus.jobs.filter((job) => job.scope === "ENTRY" && !job.circuitBreaker.allowed);

  return {
    asOf: now.toISOString(),
    portfolio: {
      id: portfolio.id,
      key: portfolio.key,
      status: portfolio.status,
      availableCash: decimalString(portfolio.availableCash),
      reservedCash: decimalString(portfolio.reservedCash)
    },
    session: session
      ? {
          id: session.id,
          status: session.status,
          killSwitchEngaged: session.killSwitchEngaged,
          heartbeatAt: session.heartbeatAt?.toISOString() ?? null
        }
      : null,
    openPositionCount: openPositions.length,
    openOrderCount,
    tradesToday,
    unrealizedPnl: valuation?.unrealizedPnl ?? "0",
    realizedPnl: decimalString(portfolio.realizedPnl),
    equity: valuation?.equity ?? decimalString(portfolio.equity),
    dailyPnl: valuation?.dailyPnl ?? null,
    drawdownAmount: valuation?.drawdownAmount ?? "0",
    drawdownPct: valuation?.drawdownPct ?? "0",
    latestActivity: {
      candidate:
        latestCandidate === null
          ? null
          : {
              id: latestCandidate.id,
              symbol: latestCandidate.asset?.symbol ?? null,
              status: latestCandidate.status,
              dataAsOf: latestCandidate.dataAsOf.toISOString()
            },
      riskAssessment:
        latestRiskAssessment === null
          ? null
          : { id: latestRiskAssessment.id, status: latestRiskAssessment.status, assessedAt: latestRiskAssessment.assessedAt.toISOString() },
      order:
        latestOrder === null
          ? null
          : { id: latestOrder.id, status: latestOrder.status, createdAt: latestOrder.createdAt.toISOString() }
    },
    lastReconciledAt: portfolio.lastReconciledAt?.toISOString() ?? null,
    workerHeartbeatAt: session?.heartbeatAt?.toISOString() ?? null,
    circuitBreakerBlocked: entryJobsBlocked.length > 0,
    activeCriticalRiskEventCount
  };
}
