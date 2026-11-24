import type { PrismaClient } from "@signalpilot/database";
import {
  buildPerformanceReportFromAggregate,
  type PerformanceIntelligenceReport
} from "@signalpilot/performance-intelligence";
import {
  loadPaperPerformanceAggregate,
  type PaperAggregateDatabase
} from "@signalpilot/performance-intelligence/paper-aggregate";

/**
 * Performance report over all paper evaluations for the signal rules. The
 * database aggregates; the evaluations are never loaded into this process.
 *
 * Returns null when there are no evaluations, and for a database double
 * without an evaluation table (unit tests).
 */
export async function loadPerformanceReport(
  database: PrismaClient
): Promise<PerformanceIntelligenceReport | null> {
  if (!database.paperSignalEvaluation) return null;

  const aggregate = await loadPaperPerformanceAggregate(database as unknown as PaperAggregateDatabase);
  if (aggregate.overall.total === 0) return null;

  return buildPerformanceReportFromAggregate(aggregate);
}
