import {
  prisma,
  type PrismaClient,
  type TradeCandidateStatus,
  type TradeDirection
} from "@signalpilot/database";

const assetSelect = { symbol: true } as const;

export interface ListCandidatesFilters {
  readonly assetId?: string;
  readonly direction?: TradeDirection;
  readonly strategyVersionId?: string;
  readonly status?: TradeCandidateStatus;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listCandidates(
  database: PrismaClient = prisma,
  filters: ListCandidatesFilters
) {
  return database.tradeCandidate.findMany({
    where: {
      assetId: filters.assetId,
      direction: filters.direction,
      strategyVersionId: filters.strategyVersionId,
      status: filters.status,
      dataAsOf:
        filters.from || filters.to
          ? { gte: filters.from, lte: filters.to }
          : undefined
    },
    orderBy: { dataAsOf: "desc" },
    skip: filters.offset,
    take: filters.limit,
    include: {
      asset: { select: assetSelect },
      strategyVersion: {
        include: { strategy: { select: { key: true, name: true } } }
      },
      strategyAssignment: { select: { id: true } }
    }
  });
}

export async function getCandidateById(
  database: PrismaClient = prisma,
  id: string
) {
  return database.tradeCandidate.findUnique({
    where: { id },
    include: {
      asset: { select: assetSelect },
      strategyVersion: {
        include: { strategy: { select: { key: true, name: true } } }
      },
      strategyAssignment: { select: { id: true } },
      riskAssessments: {
        orderBy: { assessedAt: "desc" },
        take: 1,
        include: {
          ruleResults: { orderBy: { ruleCode: "asc" } },
          decision: true
        }
      }
    }
  });
}
