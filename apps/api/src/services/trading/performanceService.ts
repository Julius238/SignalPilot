import { prisma, type PrismaClient, type StrategyPerformanceWindow } from "@signalpilot/database";

export interface ListPerformanceFilters {
  readonly portfolioId?: string;
  readonly strategyVersionId?: string;
  readonly window?: StrategyPerformanceWindow;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listPerformance(database: PrismaClient = prisma, filters: ListPerformanceFilters) {
  return database.strategyPerformance.findMany({
    where: {
      portfolioId: filters.portfolioId,
      strategyVersionId: filters.strategyVersionId,
      window: filters.window,
      asOf: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { asOf: "desc" },
    skip: filters.offset,
    take: filters.limit
  });
}
