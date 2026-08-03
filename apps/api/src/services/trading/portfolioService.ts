import { PortfolioStatus, prisma, type PrismaClient } from "@signalpilot/database";

/**
 * Shadow v1 has exactly one non-archived portfolio (docs/trading/03) — the
 * same assumption `apps/trading-worker`'s scheduler and workflow guard make.
 */
export async function getPrimaryPortfolio(database: PrismaClient = prisma) {
  return database.portfolio.findFirst({
    where: { status: { not: PortfolioStatus.ARCHIVED } },
    orderBy: { createdAt: "asc" }
  });
}

export interface ListSnapshotsFilters {
  readonly portfolioId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listSnapshots(database: PrismaClient, filters: ListSnapshotsFilters) {
  const portfolio = filters.portfolioId ? null : await getPrimaryPortfolio(database);
  const portfolioId = filters.portfolioId ?? portfolio?.id;
  if (portfolioId === undefined) return [];

  return database.portfolioSnapshot.findMany({
    where: {
      portfolioId,
      asOf: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { asOf: "desc" },
    skip: filters.offset,
    take: filters.limit
  });
}
