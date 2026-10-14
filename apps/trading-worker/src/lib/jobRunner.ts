/**
 * Scheduler-level wrapper around one P1–P4 job function: lease, circuit
 * breaker, the entry-workflow guard, and a last-resort `BotRun`/`BotLog` for
 * an error that escapes the job's own handling.
 *
 * Specification: P5 task, "Scheduler" and "Circuit Breaker" — "keine
 * überlappenden Läufe ... Lease mit Ablaufzeit, Owner und Heartbeat ... ein
 * Fehler in einem Job darf Positionsüberwachung und Reconciliation nicht
 * dauerhaft stoppen ... Jobdauer, Ergebnis, Fehlerklasse und Cursor
 * dokumentieren."
 *
 * Every job function this wraps (`runShadowGenerateCandidates`, ...) already
 * creates and finishes its own `BotRun` for the work it actually attempts, so
 * this module's only additional bookkeeping duty is the case none of them
 * cover: a `BotRun` never got created at all because the process died before
 * reaching it, or a call threw past the job's own try/catch (an uncaught
 * database error). That escape hatch is what `CircuitBreakerTripReason.DATABASE_ERROR`
 * (`lib/circuitBreaker.ts`) relies on being visible as a `FAILED` `BotRun`.
 *
 * Skips (lease held by another owner, circuit breaker open, entry-workflow
 * guard blocked) are deliberately NOT recorded as a `BotRun` — a skip did no
 * work and is not a job failure; recording it as one would let the breaker's
 * own `CONSECUTIVE_JOB_FAILURES` signal trip itself from its own skips.
 */

import { randomUUID } from "node:crypto";

import { BotRunStatus, Prisma, type PrismaClient } from "@signalpilot/database";

import {
  CircuitBreakerScope,
  SCHEDULED_JOB_RUN_NAMES,
  evaluateCircuitBreaker,
  type CircuitBreakerThresholds
} from "./circuitBreaker.js";
import { withJobLease } from "./leases.js";
import { resolveEntryWorkflowGuard } from "./workflowGuards.js";

export const ScheduledJobSkipReason = {
  LEASE_HELD_BY_OTHER: "SCHEDULED_JOB_LEASE_HELD_BY_OTHER",
  CIRCUIT_BREAKER_OPEN: "SCHEDULED_JOB_CIRCUIT_BREAKER_OPEN",
  ENTRY_WORKFLOW_BLOCKED: "SCHEDULED_JOB_ENTRY_WORKFLOW_BLOCKED"
} as const;
export type ScheduledJobSkipReason =
  (typeof ScheduledJobSkipReason)[keyof typeof ScheduledJobSkipReason];

/** What the runner hands to the job it starts. */
export interface ScheduledJobContext {
  /**
   * ENTRY jobs with the entry-workflow check: the portfolios that passed it.
   * The job works only on these, so a blocked portfolio pauses its own entry
   * pipeline without blocking another's. `undefined` for every other job.
   */
  readonly entryPortfolioIds?: readonly string[];
}

export interface RunScheduledJobOptions<T> {
  readonly database: PrismaClient;
  readonly jobKey: string;
  readonly ownerId: string;
  readonly scope: CircuitBreakerScope;
  readonly asOf: Date;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly circuitBreakerThresholds?: CircuitBreakerThresholds;
  /** Only ENTRY-scope jobs consult the entry-workflow guard. */
  readonly checkEntryWorkflow?: boolean;
  readonly run: (context: ScheduledJobContext) => Promise<T>;
}

export type RunScheduledJobResult<T> =
  | { readonly ran: true; readonly result: T }
  | { readonly ran: false; readonly reasonCode: ScheduledJobSkipReason; readonly message: string };

/**
 * Portfolios for the circuit breaker's `RiskEvent`-based signals: every
 * non-archived one (champion and challenger), each counted on its own. None
 * yet simply disables those signals for this call — the underlying job will
 * find nothing to do either way.
 */
async function resolvePortfolioIdsForBreaker(database: PrismaClient): Promise<readonly string[]> {
  const portfolios = await database.portfolio.findMany({
    where: { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  return portfolios.map((portfolio) => portfolio.id);
}

export async function runScheduledJob<T>(options: RunScheduledJobOptions<T>): Promise<RunScheduledJobResult<T>> {
  const { database, jobKey, ownerId, scope, asOf } = options;

  const portfolioIds = await resolvePortfolioIdsForBreaker(database);
  const breaker = await evaluateCircuitBreaker(database, {
    jobKey,
    portfolioId: portfolioIds,
    scope,
    asOf,
    thresholds: options.circuitBreakerThresholds
  });
  if (!breaker.allowed) {
    return {
      ran: false,
      reasonCode: ScheduledJobSkipReason.CIRCUIT_BREAKER_OPEN,
      message: `Circuit breaker ${breaker.state} for ${jobKey}: ${breaker.reasonCode ?? "unknown"} (cooldown until ${breaker.cooldownUntil ?? "unknown"}).`
    };
  }

  let context: ScheduledJobContext = {};
  if (options.checkEntryWorkflow === true) {
    const guard = await resolveEntryWorkflowGuard(database, asOf);
    if (!guard.allowed) {
      return {
        ran: false,
        reasonCode: ScheduledJobSkipReason.ENTRY_WORKFLOW_BLOCKED,
        message: `Entry workflow guard blocked ${jobKey}: ${guard.reasonCode} — ${guard.message}`
      };
    }
    context = { entryPortfolioIds: guard.allowedPortfolioIds };
  }

  const leased = await withJobLease(
    database,
    {
      jobKey,
      ownerId,
      leaseDurationMs: options.leaseDurationMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      now: () => asOf
    },
    async () => {
      const attemptStartedAt = new Date();
      try {
        return await options.run(context);
      } catch (error) {
        await recordUncaughtJobError(database, jobKey, error, attemptStartedAt);
        throw error;
      }
    }
  );

  if (!leased.ran) {
    return {
      ran: false,
      reasonCode: ScheduledJobSkipReason.LEASE_HELD_BY_OTHER,
      message: `Lease for ${jobKey} is held by ${leased.heldBy ?? "unknown"}.`
    };
  }

  return { ran: true, result: leased.result };
}

async function recordUncaughtJobError(
  database: PrismaClient,
  jobKey: string,
  error: unknown,
  attemptStartedAt: Date
): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown scheduled job error";
  const correlationId = randomUUID();
  // The job function's own BotRun of this attempt never reached its finish
  // step; left RUNNING it would show a job "still running" forever.
  await database.botRun.updateMany({
    where: {
      jobName: { in: [jobKey, ...(SCHEDULED_JOB_RUN_NAMES[jobKey] ?? [])] },
      status: BotRunStatus.RUNNING,
      startedAt: { gte: attemptStartedAt }
    },
    data: { status: BotRunStatus.FAILED, finishedAt: new Date() }
  });
  const botRun = await database.botRun.create({
    data: {
      jobName: jobKey,
      status: BotRunStatus.FAILED,
      startedAt: new Date(),
      finishedAt: new Date(),
      metadataJson: {
        correlationId,
        errorClass: "DATABASE_ERROR",
        uncaught: true
      } as Prisma.InputJsonObject
    }
  });
  await database.botLog.create({
    data: {
      level: "error",
      service: "trading-worker",
      message: `${jobKey} threw past its own error handling`,
      metadataJson: { botRunId: botRun.id, correlationId, error: message } as Prisma.InputJsonObject
    }
  });
}
