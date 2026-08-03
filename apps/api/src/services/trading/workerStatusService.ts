/**
 * Worker/scheduler status, built entirely from persisted state — never from
 * `apps/api`'s own environment variables, which would describe this
 * process, not the separate `apps/trading-worker` process actually running
 * the schedule (docs/trading P6, "Worker- und Jobstatus").
 *
 * Reuses `evaluateCircuitBreaker` from `@signalpilot/trading-worker` (the
 * exact same deterministic, DB-derived evaluation the scheduler itself
 * consults) rather than a second implementation.
 */

import { prisma, type PrismaClient } from "@signalpilot/database";
import { CircuitBreakerScope, evaluateCircuitBreaker } from "@signalpilot/trading-worker/lib/circuitBreaker";

import { getPrimaryPortfolio } from "./portfolioService.js";

/**
 * Must stay in sync with `apps/trading-worker/src/scheduler.ts`'s
 * `JOB_DEFINITIONS` — duplicated here as plain schedule data (not business
 * logic) purely so "next scheduled run" can be estimated without importing
 * the scheduler module itself (which would register cron jobs as a
 * side-effect of import).
 */
const JOB_SCHEDULE: readonly { readonly jobKey: string; readonly cronExpression: string; readonly scope: CircuitBreakerScope }[] =
  [
    { jobKey: "trading:day-start", cronExpression: "5 0 * * *", scope: CircuitBreakerScope.ENTRY },
    { jobKey: "trading:candidate-scan", cronExpression: "5 * * * *", scope: CircuitBreakerScope.ENTRY },
    { jobKey: "trading:risk-decide", cronExpression: "* * * * *", scope: CircuitBreakerScope.ENTRY },
    { jobKey: "trading:order-create", cronExpression: "* * * * *", scope: CircuitBreakerScope.ENTRY },
    { jobKey: "trading:simulate-fill", cronExpression: "*/2 * * * *", scope: CircuitBreakerScope.ENTRY },
    { jobKey: "trading:monitor-positions", cronExpression: "*/2 * * * *", scope: CircuitBreakerScope.MONITORING },
    { jobKey: "trading:reconcile", cronExpression: "*/5 * * * *", scope: CircuitBreakerScope.MONITORING }
  ];

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }
  const fixed = Number(field);
  return Number.isFinite(fixed) && value === fixed;
}

/** Only supports the minute/hour-only patterns P5 actually uses; returns null for anything else. */
function nextFireTimeUtc(cronExpression: string, after: Date): string | null {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return null;

  const candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let i = 0; i <= 24 * 60; i += 1) {
    if (matchesCronField(hourField, candidate.getUTCHours()) && matchesCronField(minuteField, candidate.getUTCMinutes())) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

export async function getWorkerStatus(database: PrismaClient = prisma) {
  const now = new Date();
  const portfolio = await getPrimaryPortfolio(database);
  const session = portfolio
    ? await database.tradingSession.findFirst({
        where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
        orderBy: { createdAt: "desc" }
      })
    : null;

  const jobs = await Promise.all(
    JOB_SCHEDULE.map(async (job) => {
      const [lastRuns, cursor, breaker] = await Promise.all([
        database.botRun.findMany({ where: { jobName: job.jobKey }, orderBy: { startedAt: "desc" }, take: 5 }),
        database.tradingJobCursor.findUnique({ where: { jobKey_scopeKey: { jobKey: job.jobKey, scopeKey: "GLOBAL" } } }),
        evaluateCircuitBreaker(database, {
          jobKey: job.jobKey,
          portfolioId: portfolio?.id ?? "",
          scope: job.scope,
          asOf: now
        })
      ]);

      const lastRun = lastRuns[0] ?? null;
      const lastSuccess = lastRuns.find((run) => run.status === "SUCCESS") ?? null;
      const lastFailure = lastRuns.find((run) => run.status === "FAILED") ?? null;

      return {
        jobKey: job.jobKey,
        cronExpression: job.cronExpression,
        scope: job.scope,
        nextScheduledRunAt: nextFireTimeUtc(job.cronExpression, now),
        lastRun: lastRun
          ? {
              status: lastRun.status,
              startedAt: lastRun.startedAt.toISOString(),
              finishedAt: lastRun.finishedAt?.toISOString() ?? null,
              durationMs: lastRun.finishedAt ? lastRun.finishedAt.getTime() - lastRun.startedAt.getTime() : null
            }
          : null,
        lastSuccessAt: lastSuccess?.finishedAt?.toISOString() ?? lastSuccess?.startedAt.toISOString() ?? null,
        lastFailureAt: lastFailure?.finishedAt?.toISOString() ?? lastFailure?.startedAt.toISOString() ?? null,
        lease:
          cursor === null
            ? null
            : {
                claimedBy: cursor.claimedBy,
                claimedAt: cursor.claimedAt?.toISOString() ?? null,
                claimExpiresAt: cursor.claimExpiresAt?.toISOString() ?? null,
                active: cursor.claimedBy !== null && (cursor.claimExpiresAt?.getTime() ?? 0) > now.getTime()
              },
        circuitBreaker: {
          state: breaker.state,
          allowed: breaker.allowed,
          reasonCode: breaker.reasonCode,
          cooldownUntil: breaker.cooldownUntil,
          policyVersion: breaker.policyVersion
        }
      };
    })
  );

  return {
    asOf: now.toISOString(),
    portfolioId: portfolio?.id ?? null,
    session: session
      ? {
          id: session.id,
          status: session.status,
          killSwitchEngaged: session.killSwitchEngaged,
          heartbeatAt: session.heartbeatAt?.toISOString() ?? null,
          reconciledAt: session.reconciledAt?.toISOString() ?? null
        }
      : null,
    jobs
  };
}
