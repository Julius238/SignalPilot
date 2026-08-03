/**
 * `apps/trading-worker` scheduler: registers the seven shadow trading jobs
 * on safe UTC cron intervals, each wrapped in `lib/jobRunner.ts` (lease +
 * circuit breaker + entry-workflow guard).
 *
 * Specification: P5 task, "Scheduler" and "Workflow und Reihenfolge".
 *
 * Disabled by default at two independent layers: `TRADING_SCHEDULER_ENABLED`
 * gates the whole scheduler, and each job additionally needs its own
 * `TRADING_*_JOB_ENABLED` flag — on top of the P1–P4 flags the job functions
 * themselves still check. `startTradingWorkerScheduler` never runs unless
 * `resolveTradingWorkerConfig` already returned `ok: true` (checked by
 * `index.ts`), so this module assumes a valid config was handed to it.
 *
 * All seven `cron.schedule` calls pin `{ timezone: "UTC" }` explicitly —
 * UTC is the binding time base regardless of the host container's local
 * timezone (P5 task: "UTC als verbindliche Zeitbasis").
 */

import { prisma, type PrismaClient } from "@signalpilot/database";
import cron, { type ScheduledTask } from "node-cron";
import pino from "pino";

import type { TradingWorkerConfig } from "./config.js";
import { CircuitBreakerScope } from "./lib/circuitBreaker.js";
import { ScheduledJobSkipReason, runScheduledJob } from "./lib/jobRunner.js";
import { enqueueCircuitBreakerAlert } from "./lib/alertCollector.js";
import { checkTradingAlertOutboxAllowed } from "./lib/tradingSafety.js";
import { runShadowAssessRisk } from "./jobs/shadowAssessRisk.js";
import { runShadowCreateOrders } from "./jobs/shadowCreateOrders.js";
import { runShadowGenerateCandidates } from "./jobs/shadowGenerateCandidates.js";
import { runShadowMonitorPositions } from "./jobs/shadowMonitorPositions.js";
import { runShadowProcessFills } from "./jobs/shadowProcessFills.js";
import { runShadowReconcilePortfolio } from "./jobs/shadowReconcilePortfolio.js";
import { runShadowStartTradingDay } from "./jobs/shadowStartTradingDay.js";

const logger = pino({ name: "trading-worker-scheduler" });

const LEASE_DURATION_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

interface ScheduledJobDefinition {
  readonly jobKey: string;
  readonly cronExpression: string;
  readonly scope: CircuitBreakerScope;
  readonly checkEntryWorkflow: boolean;
  readonly enabled: (config: TradingWorkerConfig) => boolean;
  readonly run: (database: PrismaClient, asOf: Date) => Promise<unknown>;
}

/**
 * Ordering intent (never enforced by cron ordering itself, only by each
 * job's own data-state preconditions — see `docs/trading/02`, "Datenfluss
 * v1"): day-start before new candidates; candidates before risk; risk
 * approval before orders; orders before fills; fills before positions exist
 * for the monitor to advance; reconciliation runs independently and often
 * enough to keep `lastReconciledAt` inside the entry-workflow guard's
 * freshness ceiling.
 */
const JOB_DEFINITIONS: readonly ScheduledJobDefinition[] = [
  {
    jobKey: "trading:day-start",
    cronExpression: "5 0 * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.dayStartJobEnabled,
    run: (database, asOf) => runShadowStartTradingDay(database, { asOf })
  },
  {
    jobKey: "trading:candidate-scan",
    cronExpression: "5 * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.candidateJobEnabled,
    run: (database, asOf) => runShadowGenerateCandidates(database, { asOf })
  },
  {
    jobKey: "trading:risk-decide",
    cronExpression: "* * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.riskJobEnabled,
    run: (database, asOf) => runShadowAssessRisk(database, { asOf })
  },
  {
    jobKey: "trading:order-create",
    cronExpression: "* * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.orderJobEnabled,
    run: (database, asOf) => runShadowCreateOrders(database, { asOf })
  },
  {
    jobKey: "trading:simulate-fill",
    cronExpression: "*/2 * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.fillJobEnabled,
    run: (database, asOf) => runShadowProcessFills(database, { asOf })
  },
  {
    jobKey: "trading:monitor-positions",
    cronExpression: "*/2 * * * *",
    scope: CircuitBreakerScope.MONITORING,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.positionMonitorJobEnabled,
    run: (database, asOf) => runShadowMonitorPositions(database, { asOf })
  },
  {
    jobKey: "trading:reconcile",
    cronExpression: "*/5 * * * *",
    scope: CircuitBreakerScope.MONITORING,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.reconciliationJobEnabled,
    run: (database, asOf) => runShadowReconcilePortfolio(database, { asOf })
  }
];

/**
 * Record an open-breaker alert without letting alerting affect scheduling.
 * Gated by `TRADING_ALERT_OUTBOX_ENABLED`, and any failure is logged and
 * swallowed — a broken outbox must never make the scheduler's skip path throw.
 */
async function recordCircuitBreakerAlert(
  database: PrismaClient,
  definition: ScheduledJobDefinition,
  message: string,
  asOf: Date
): Promise<void> {
  if (!checkTradingAlertOutboxAllowed().allowed) return;
  try {
    const portfolio = await database.portfolio.findFirst({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });
    // The cooldown timestamp inside the skip message is what makes one open
    // window one alert instead of one per tick.
    const cooldownUntil = /cooldown until ([^)]+)\)/.exec(message)?.[1] ?? null;
    await enqueueCircuitBreakerAlert(
      database,
      {
        jobKey: definition.jobKey,
        scope: definition.scope,
        reasonCode: "CIRCUIT_BREAKER_OPEN",
        cooldownUntil: cooldownUntil === "unknown" ? null : cooldownUntil,
        portfolioId: portfolio?.id ?? null
      },
      asOf
    );
  } catch (error) {
    logger.warn({ jobKey: definition.jobKey, error }, "could not record circuit breaker alert");
  }
}

async function runOneScheduledJob(
  database: PrismaClient,
  ownerId: string,
  definition: ScheduledJobDefinition
): Promise<void> {
  const asOf = new Date();
  try {
    const outcome = await runScheduledJob({
      database,
      jobKey: definition.jobKey,
      ownerId,
      scope: definition.scope,
      asOf,
      leaseDurationMs: LEASE_DURATION_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      checkEntryWorkflow: definition.checkEntryWorkflow,
      run: () => definition.run(database, asOf)
    });
    if (!outcome.ran) {
      logger.info({ jobKey: definition.jobKey, reasonCode: outcome.reasonCode, message: outcome.message }, "scheduled job skipped");
      // An open breaker is the one P8 alert trigger with no durable row of its
      // own for the collector to derive from, so it is recorded here. The
      // enqueue is a fire-and-forget insert into the outbox: it cannot fail
      // this tick, and it cannot delay the next one.
      if (outcome.reasonCode === ScheduledJobSkipReason.CIRCUIT_BREAKER_OPEN) {
        await recordCircuitBreakerAlert(database, definition, outcome.message, asOf);
      }
      return;
    }
    logger.info({ jobKey: definition.jobKey, result: outcome.result }, "scheduled job finished");
  } catch (error) {
    logger.error({ jobKey: definition.jobKey, error }, "scheduled job threw");
  }
}

export function startTradingWorkerScheduler(
  config: TradingWorkerConfig,
  database: PrismaClient = prisma
): readonly ScheduledTask[] {
  const tasks: ScheduledTask[] = [];

  for (const definition of JOB_DEFINITIONS) {
    if (!definition.enabled(config)) {
      logger.info({ jobKey: definition.jobKey }, "scheduled job disabled by its own flag, not registered");
      continue;
    }
    if (!cron.validate(definition.cronExpression)) {
      throw new Error(`Invalid cron expression for ${definition.jobKey}: ${definition.cronExpression}`);
    }
    const task = cron.schedule(
      definition.cronExpression,
      () => {
        void runOneScheduledJob(database, config.ownerId, definition);
      },
      { timezone: "UTC" }
    );
    tasks.push(task);
    logger.info({ jobKey: definition.jobKey, cronExpression: definition.cronExpression }, "scheduled job registered");
  }

  return tasks;
}
