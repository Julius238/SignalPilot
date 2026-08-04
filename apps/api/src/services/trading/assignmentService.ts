import {
  prisma,
  type PrismaClient,
  type TradeDirection
} from "@signalpilot/database";

export interface ListAssignmentsFilters {
  readonly assetId?: string;
  readonly direction?: TradeDirection;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly offset: number;
}

/** Read-only, bounded projection used by the operations dashboard. */
export async function listStrategyAssignments(
  database: PrismaClient = prisma,
  filters: ListAssignmentsFilters
) {
  const rows = await database.strategyAssignment.findMany({
    where: {
      assetId: filters.assetId,
      enabled: filters.enabled,
      assignmentConfigJson:
        filters.direction === undefined
          ? undefined
          : { path: ["direction"], equals: filters.direction }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: filters.offset,
    take: filters.limit,
    include: {
      asset: { select: { symbol: true } },
      strategy: { select: { key: true, name: true, status: true } },
      strategyVersion: {
        select: {
          id: true,
          version: true,
          status: true,
          engineVersion: true,
          specificationHash: true,
          parametersJson: true
        }
      }
    }
  });

  return rows;
}
