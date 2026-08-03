import { prisma, type PrismaClient, type RiskEventType, type RiskSeverity } from "@signalpilot/database";

export interface ListSessionsFilters {
  readonly portfolioId?: string;
  readonly limit: number;
  readonly offset: number;
}

export async function listSessions(database: PrismaClient = prisma, filters: ListSessionsFilters) {
  return database.tradingSession.findMany({
    where: { portfolioId: filters.portfolioId },
    orderBy: { createdAt: "desc" },
    skip: filters.offset,
    take: filters.limit
  });
}

export interface ListRiskEventsFilters {
  readonly portfolioId?: string;
  readonly type?: RiskEventType;
  readonly severity?: RiskSeverity;
  readonly acknowledged?: boolean;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listRiskEvents(database: PrismaClient = prisma, filters: ListRiskEventsFilters) {
  return database.riskEvent.findMany({
    where: {
      portfolioId: filters.portfolioId,
      type: filters.type,
      severity: filters.severity,
      acknowledgedAt: filters.acknowledged === undefined ? undefined : filters.acknowledged ? { not: null } : null,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { createdAt: "desc" },
    skip: filters.offset,
    take: filters.limit
  });
}

export interface ListAuditEventsFilters {
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly eventType?: string;
  readonly tradingSessionId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listAuditEvents(database: PrismaClient = prisma, filters: ListAuditEventsFilters) {
  return database.tradingAuditEvent.findMany({
    where: {
      aggregateType: filters.aggregateType,
      aggregateId: filters.aggregateId,
      eventType: filters.eventType,
      tradingSessionId: filters.tradingSessionId,
      occurredAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { occurredAt: "desc" },
    skip: filters.offset,
    take: filters.limit
  });
}
