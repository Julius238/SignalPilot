/**
 * Segmented shadow-performance reads (P8, "6. API und Dashboard").
 *
 * Serves what `StrategyPerformance` actually holds after a performance
 * refresh: one row per segment, with the engine version, the code version, the
 * data cut and the computation timestamp attached to every response so the
 * caller can always tell *which* calculation it is looking at.
 *
 * The service never computes a metric. A number the refresh job did not
 * persist is not invented here — it is simply absent, and the `metricsJson`
 * of the same row says why.
 */

import {
  prisma,
  type PrismaClient,
  type StrategyPerformanceSegment,
  type StrategyPerformanceWindow
} from "@signalpilot/database";

export interface ListPerformanceSegmentFilters {
  readonly portfolioId?: string;
  readonly window?: StrategyPerformanceWindow;
  readonly segmentType?: StrategyPerformanceSegment;
  readonly segmentKey?: string;
  readonly strategyVersionId?: string;
  readonly engineVersion?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Latest snapshot per segment for one portfolio and window.
 *
 * "Latest" means the newest `asOf`; older rows are history and are never
 * overwritten, so a plain descending order plus a first-seen filter gives the
 * current picture without hiding the audit trail.
 */
export async function listPerformanceSegments(
  database: PrismaClient = prisma,
  filters: ListPerformanceSegmentFilters
) {
  return database.strategyPerformance.findMany({
    where: {
      portfolioId: filters.portfolioId,
      window: filters.window,
      segmentType: filters.segmentType,
      segmentKey: filters.segmentKey,
      strategyVersionId: filters.strategyVersionId,
      engineVersion: filters.engineVersion,
      asOf: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: [{ asOf: "desc" }, { segmentType: "asc" }, { segmentKey: "asc" }],
    skip: filters.offset,
    take: filters.limit
  });
}

/**
 * The single newest computation run for one portfolio and window: its
 * provenance plus every segment that belongs to exactly that run.
 *
 * Rows are grouped by `inputHash` rather than by `asOf` alone, so a response
 * can never mix segments from two different data cuts — which is the whole
 * point of persisting the hash.
 */
export async function getLatestPerformanceRun(
  database: PrismaClient = prisma,
  options: { readonly portfolioId: string; readonly window: StrategyPerformanceWindow }
) {
  const newest = await database.strategyPerformance.findFirst({
    where: { portfolioId: options.portfolioId, window: options.window },
    orderBy: [{ asOf: "desc" }, { createdAt: "desc" }]
  });
  if (newest === null) return null;

  const segments = await database.strategyPerformance.findMany({
    where: {
      portfolioId: options.portfolioId,
      window: options.window,
      asOf: newest.asOf,
      inputHash: newest.inputHash,
      engineVersion: newest.engineVersion
    },
    orderBy: [{ segmentType: "asc" }, { segmentKey: "asc" }]
  });

  return { newest, segments };
}

/** Distinct engine versions present for a portfolio — the recomputation history. */
export async function listPerformanceEngineVersions(
  database: PrismaClient = prisma,
  options: { readonly portfolioId: string }
) {
  const rows = await database.strategyPerformance.groupBy({
    by: ["engineVersion"],
    where: { portfolioId: options.portfolioId },
    _max: { asOf: true },
    _count: { _all: true }
  });
  return rows
    .map((row) => ({
      engineVersion: row.engineVersion,
      snapshots: row._count._all,
      latestAsOf: row._max.asOf?.toISOString() ?? null
    }))
    .sort((left, right) => (right.latestAsOf ?? "").localeCompare(left.latestAsOf ?? ""));
}
