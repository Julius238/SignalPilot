/**
 * Paper performance aggregated inside PostgreSQL.
 *
 * The report over all paper evaluations used to load every row into the
 * process. With 400 000 rows that needs about 2 GB of heap and killed the data
 * worker. This module asks the database for sums and counts instead: one
 * sequential pass, a few hundred result rows, constant memory.
 *
 * The result must be bit-identical to summing the rows in the process. Float
 * addition depends on the order, so the query pins the order the former
 * `findMany()` without `orderBy` had: one sequential scan from the start of
 * the table (no parallel workers, no synchronized scan, no index or sorted
 * grouping). Hash aggregation keeps the input order inside every group, and
 * `min(ctid)` is the position of a group's first row. The plan switches are
 * `SET LOCAL` (transaction-scoped) and touch no other query.
 *
 * Sums travel as text (shortest exact form): Prisma rounds a double to 16
 * digits, which is harmless for the stored values (Prisma wrote them that way)
 * but would change a sum.
 */

import type {
  MetricSum,
  PerformanceAggregate,
  PerformanceGroupBy,
  PerformanceGroupStats,
  PerformanceStats
} from "./index.js";

/** The part of PrismaClient this module needs; keeps the package free of it. */
export type PaperAggregateDatabase = {
  $transaction: (queries: never[]) => Promise<unknown[]>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => unknown;
};

export type PaperAggregateFilter = {
  symbol?: string;
  timeframe?: string;
  assetType?: string;
  from?: Date;
  to?: Date;
  /** Default true, like `buildPerformanceReport`. */
  includeSkipped?: boolean;
};

/** Overall numbers over every evaluation status, for `/paper/stats`. */
export type PaperOverallTotals = {
  openCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  returnAfter1h: MetricSum;
  returnAfter4h: MetricSum;
  returnAfter1d: MetricSum;
  maxFavorableMove: MetricSum;
  maxAdverseMove: MetricSum;
};

export type PaperPerformanceAggregate = PerformanceAggregate & { allStatuses: PaperOverallTotals };

/** Position in the GROUPING SETS list below; `GROUPING()` is decoded to it. */
const DIMENSIONS = [
  "signalType",
  "timeframe",
  "symbol",
  "status",
  "riskLevel",
  "evaluationKind",
  "scoreBucket"
] as const satisfies readonly PerformanceGroupBy[];

const METRICS = [
  "returnAfter1h",
  "returnAfter4h",
  "returnAfter1d",
  "returnAfter3d",
  "maxFavorableMove",
  "maxAdverseMove"
] as const;

const PLAN_SETTINGS = [
  ["max_parallel_workers_per_gather", "0"],
  ["synchronize_seqscans", "off"],
  ["enable_sort", "off"],
  ["enable_incremental_sort", "off"],
  ["enable_indexscan", "off"],
  ["enable_indexonlyscan", "off"],
  ["enable_bitmapscan", "off"],
  ["jit", "off"],
  ["extra_float_digits", "1"]
] as const;

export const PAPER_AGGREGATE_SETTINGS_SQL = `SELECT ${PLAN_SETTINGS.map(
  ([name, value]) => `set_config('${name}', '${value}', true)`
).join(", ")}`;

const evaluatedMetric = (metric: string) =>
  `(sum("${metric}") FILTER (WHERE evaluated))::text AS "${metric}Sum", ` +
  `count("${metric}") FILTER (WHERE evaluated)::int AS "${metric}Count"`;

const anyStatusMetric = (metric: string) =>
  `sum("${metric}")::text AS "${metric}AllSum", count("${metric}")::int AS "${metric}AllCount"`;

const evaluatedOutcome = (outcome: string, column: string) =>
  `count(*) FILTER (WHERE evaluated AND outcome = '${outcome}')::int AS "${column}"`;

const anyStatusOutcome = (outcome: string, column: string) =>
  `count(*) FILTER (WHERE outcome = '${outcome}')::int AS "${column}"`;

export function buildPaperAggregateSql(filter: PaperAggregateFilter): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (value: unknown) => `$${values.push(value)}`;
  if (filter.symbol !== undefined) conditions.push(`e."symbol" = ${bind(filter.symbol)}`);
  if (filter.timeframe !== undefined) conditions.push(`e."timeframe" = ${bind(filter.timeframe)}`);
  if (filter.from !== undefined) conditions.push(`e."openedAt" >= (${bind(filter.from)}::timestamptz AT TIME ZONE 'UTC')`);
  if (filter.to !== undefined) conditions.push(`e."openedAt" <= (${bind(filter.to)}::timestamptz AT TIME ZONE 'UTC')`);
  if (filter.includeSkipped === false) conditions.push(`e."evaluationStatus" <> 'SKIPPED'`);
  if (filter.assetType !== undefined) {
    // A list of asset ids is a filter inside the one sequential scan. A join
    // would decide the row order by its plan (the former query did: its sums
    // differed between two identical calls). An evaluation always carries the
    // asset of its signal.
    conditions.push(
      `e."assetId" = ANY (ARRAY(SELECT a."id" FROM "Asset" a WHERE a."assetType"::text = ${bind(filter.assetType)}))`
    );
  }
  const sql = `
WITH base AS NOT MATERIALIZED (
  SELECT e.ctid AS tid,
    e."signalType"::text AS d0, e."timeframe" AS d1, e."symbol" AS d2, e."status"::text AS d3,
    e."riskLevel"::text AS d4, e."evaluationKind"::text AS d5,
    CASE WHEN e."score" < 50 THEN '0-49' WHEN e."score" < 65 THEN '50-64'
         WHEN e."score" < 80 THEN '65-79' ELSE '80-100' END AS d6,
    COALESCE(e."skipReason", 'Unspecified') AS d7,
    e."evaluationStatus" = 'EVALUATED' AS evaluated,
    e."evaluationStatus" = 'SKIPPED' AS skipped,
    e."evaluationStatus" = 'OPEN' AS open,
    e."evaluationKind" = 'OBSERVATION' AS observation,
    e."outcome"::text AS outcome,
    ${METRICS.map((metric) => `e."${metric}"`).join(", ")}
  FROM "PaperSignalEvaluation" e
  ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
)
SELECT
  GROUPING(d0, d1, d2, d3, d4, d5, d6, d7)::int AS "grouping",
  COALESCE(d0, d1, d2, d3, d4, d5, d6, d7) AS "key",
  min(tid)::text AS "firstTid",
  min(tid) FILTER (WHERE skipped)::text AS "firstSkippedTid",
  count(*)::int AS "total",
  count(*) FILTER (WHERE evaluated)::int AS "evaluatedCount",
  count(*) FILTER (WHERE skipped)::int AS "skippedCount",
  ${evaluatedOutcome("POSITIVE", "positiveCount")},
  ${evaluatedOutcome("NEGATIVE", "negativeCount")},
  ${evaluatedOutcome("NEUTRAL", "neutralCount")},
  ${evaluatedOutcome("TARGET_REACHED", "targetReachedCount")},
  ${evaluatedOutcome("INVALIDATED", "invalidatedCount")},
  ${METRICS.map(evaluatedMetric).join(",\n  ")},
  count(*) FILTER (WHERE observation)::int AS "observationTotal",
  count(*) FILTER (WHERE observation AND evaluated)::int AS "observationEvaluated",
  count(*) FILTER (WHERE observation AND evaluated AND outcome = 'POSITIVE')::int AS "observationPositive",
  count(*) FILTER (WHERE observation AND evaluated AND outcome = 'NEUTRAL')::int AS "observationNeutral",
  count(*) FILTER (WHERE observation AND evaluated AND outcome = 'NEGATIVE')::int AS "observationNegative",
  (sum(abs("returnAfter1d")) FILTER (WHERE observation AND evaluated))::text AS "observationAbsSum",
  count("returnAfter1d") FILTER (WHERE observation AND evaluated)::int AS "observationAbsCount",
  count(*) FILTER (WHERE open)::int AS "openCount",
  ${anyStatusOutcome("POSITIVE", "positiveAllCount")},
  ${anyStatusOutcome("NEGATIVE", "negativeAllCount")},
  ${anyStatusOutcome("NEUTRAL", "neutralAllCount")},
  ${anyStatusOutcome("TARGET_REACHED", "targetReachedAllCount")},
  ${anyStatusOutcome("INVALIDATED", "invalidatedAllCount")},
  ${["returnAfter1h", "returnAfter4h", "returnAfter1d", "maxFavorableMove", "maxAdverseMove"]
    .map(anyStatusMetric)
    .join(",\n  ")}
FROM base
GROUP BY GROUPING SETS ((), (d0), (d1), (d2), (d3), (d4), (d5), (d6), (d7))`;
  return { sql, values };
}

type AggregateRow = Record<string, number | string | null> & {
  grouping: number;
  key: string | null;
  firstTid: string | null;
  firstSkippedTid: string | null;
};

const ALL_BITS = 0b11111111;
const groupingOf = (position: number) => ALL_BITS ^ (1 << (7 - position));
const SKIP_REASON_POSITION = 7;

export async function loadPaperPerformanceAggregate(
  database: PaperAggregateDatabase,
  filter: PaperAggregateFilter = {}
): Promise<PaperPerformanceAggregate> {
  const { sql, values } = buildPaperAggregateSql(filter);
  const results = await database.$transaction([
    database.$queryRawUnsafe(PAPER_AGGREGATE_SETTINGS_SQL),
    database.$queryRawUnsafe(sql, ...values)
  ] as never[]);
  return toAggregate(results[1] as AggregateRow[]);
}

function toAggregate(rows: AggregateRow[]): PaperPerformanceAggregate {
  const overall = rows.find((row) => row.grouping === ALL_BITS);
  if (overall === undefined) throw new Error("Paper aggregate returned no overall row.");
  const groups = {} as Record<PerformanceGroupBy, PerformanceGroupStats[]>;
  DIMENSIONS.forEach((dimension, position) => {
    groups[dimension] = rows
      .filter((row) => row.grouping === groupingOf(position))
      .sort((left, right) => compareTid(left.firstTid, right.firstTid))
      .map((row) => ({ key: String(row.key), stats: toStats(row) }));
  });

  return {
    overall: toStats(overall),
    groups,
    observation: {
      total: int(overall, "observationTotal"),
      evaluatedCount: int(overall, "observationEvaluated"),
      positiveMovementCount: int(overall, "observationPositive"),
      neutralCount: int(overall, "observationNeutral"),
      negativeCount: int(overall, "observationNegative"),
      absReturnAfter1d: metric(overall, "observationAbsSum", "observationAbsCount")
    },
    skippedByReason: rows
      .filter((row) => row.grouping === groupingOf(SKIP_REASON_POSITION) && int(row, "skippedCount") > 0)
      .sort((left, right) => compareTid(left.firstSkippedTid, right.firstSkippedTid))
      .map((row) => ({ reason: String(row.key), count: int(row, "skippedCount") })),
    allStatuses: {
      openCount: int(overall, "openCount"),
      positiveCount: int(overall, "positiveAllCount"),
      negativeCount: int(overall, "negativeAllCount"),
      neutralCount: int(overall, "neutralAllCount"),
      targetReachedCount: int(overall, "targetReachedAllCount"),
      invalidatedCount: int(overall, "invalidatedAllCount"),
      returnAfter1h: metric(overall, "returnAfter1hAllSum", "returnAfter1hAllCount"),
      returnAfter4h: metric(overall, "returnAfter4hAllSum", "returnAfter4hAllCount"),
      returnAfter1d: metric(overall, "returnAfter1dAllSum", "returnAfter1dAllCount"),
      maxFavorableMove: metric(overall, "maxFavorableMoveAllSum", "maxFavorableMoveAllCount"),
      maxAdverseMove: metric(overall, "maxAdverseMoveAllSum", "maxAdverseMoveAllCount")
    }
  };
}

function toStats(row: AggregateRow): PerformanceStats {
  const metrics = {} as Record<(typeof METRICS)[number], MetricSum>;
  for (const name of METRICS) metrics[name] = metric(row, `${name}Sum`, `${name}Count`);
  return {
    total: int(row, "total"),
    evaluatedCount: int(row, "evaluatedCount"),
    skippedCount: int(row, "skippedCount"),
    positiveCount: int(row, "positiveCount"),
    negativeCount: int(row, "negativeCount"),
    neutralCount: int(row, "neutralCount"),
    targetReachedCount: int(row, "targetReachedCount"),
    invalidatedCount: int(row, "invalidatedCount"),
    ...metrics
  };
}

function int(row: AggregateRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number") throw new Error(`Paper aggregate column ${column} is not a number.`);
  return value;
}

function metric(row: AggregateRow, sumColumn: string, countColumn: string): MetricSum {
  const sum = row[sumColumn];
  // `0 +` normalises a negative zero exactly like a sum that starts at 0.
  return { sum: sum === null || sum === undefined ? 0 : 0 + Number(sum), count: int(row, countColumn) };
}

/** `(block,offset)` of a row. Rows are compared by position in the table. */
function compareTid(left: string | null, right: string | null): number {
  const [leftBlock, leftOffset] = parseTid(left);
  const [rightBlock, rightOffset] = parseTid(right);
  return leftBlock - rightBlock || leftOffset - rightOffset;
}

function parseTid(tid: string | null): [number, number] {
  const match = /^\((\d+),(\d+)\)$/.exec(tid ?? "");
  if (match === null) throw new Error(`Paper aggregate returned an invalid row position: ${String(tid)}.`);
  return [Number(match[1]), Number(match[2])];
}
