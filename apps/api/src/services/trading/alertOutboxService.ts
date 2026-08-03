/**
 * Operator view of the trading alert outbox (P8, "6. API und Dashboard":
 * "Alert-Outbox-Status für Operatoren").
 *
 * Read-only. An operator can see what was recorded, what was delivered, what
 * failed and what died — but this service offers no way to edit, resend or
 * delete an entry, because a hand-edited alert trail is not evidence.
 *
 * The payload never leaves this service raw: `payloadJson` was already
 * sanitised at enqueue time (`apps/trading-worker`'s `alertOutbox.ts`), and
 * only the counted/scalar fields are projected here.
 */

import {
  prisma,
  type PrismaClient,
  type RiskSeverity,
  type TradingAlertEventType,
  type TradingAlertOutboxStatus
} from "@signalpilot/database";

export interface ListAlertOutboxFilters {
  readonly status?: TradingAlertOutboxStatus;
  readonly eventType?: TradingAlertEventType;
  readonly severity?: RiskSeverity;
  readonly portfolioId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listAlertOutbox(database: PrismaClient = prisma, filters: ListAlertOutboxFilters) {
  return database.tradingAlertOutbox.findMany({
    where: {
      status: filters.status,
      eventType: filters.eventType,
      severity: filters.severity,
      portfolioId: filters.portfolioId,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { createdAt: "desc" },
    skip: filters.offset,
    take: filters.limit,
    include: {
      attempts: { orderBy: { attempt: "desc" }, take: 5 }
    }
  });
}

/** Aggregate health of the outbox — what an operator checks first. */
export async function getAlertOutboxSummary(database: PrismaClient = prisma) {
  const byStatus = await database.tradingAlertOutbox.groupBy({
    by: ["status"],
    _count: { _all: true }
  });
  const bySeverity = await database.tradingAlertOutbox.groupBy({
    by: ["severity"],
    _count: { _all: true }
  });
  const oldestPending = await database.tradingAlertOutbox.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, eventType: true }
  });
  const lastSent = await database.tradingAlertOutbox.findFirst({
    where: { status: "SENT" },
    orderBy: { sentAt: "desc" },
    select: { id: true, sentAt: true, eventType: true }
  });

  const counts: Record<string, number> = {};
  for (const row of byStatus) counts[row.status] = row._count._all;

  const severityCounts: Record<string, number> = {};
  for (const row of bySeverity) severityCounts[row.severity] = row._count._all;

  return {
    asOf: new Date().toISOString(),
    byStatus: counts,
    bySeverity: severityCounts,
    pending: counts.PENDING ?? 0,
    processing: counts.PROCESSING ?? 0,
    sent: counts.SENT ?? 0,
    failed: counts.FAILED ?? 0,
    dead: counts.DEAD ?? 0,
    oldestPending: oldestPending
      ? { id: oldestPending.id, eventType: oldestPending.eventType, createdAt: oldestPending.createdAt.toISOString() }
      : null,
    lastSent: lastSent
      ? { id: lastSent.id, eventType: lastSent.eventType, sentAt: lastSent.sentAt?.toISOString() ?? null }
      : null
  };
}
