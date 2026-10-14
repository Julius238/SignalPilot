/**
 * `apps/trading-worker` scheduler: registers the seven shadow trading jobs
 * (plus the optional performance refresh and alert outbox)
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
 * All `cron.schedule` calls pin `{ timezone: "UTC" }` explicitly —
 * UTC is the binding time base regardless of the host container's local
 * timezone (P5 task: "UTC als verbindliche Zeitbasis").
 */

import { prisma, type PrismaClient } from "@signalpilot/database";
import cron, { type ScheduledTask } from "node-cron";
import pino from "pino";

import type { TradingWorkerConfig } from "./config.js";
import { CircuitBreakerScope } from "./lib/circuitBreaker.js";
import { ScheduledJobSkipReason, runScheduledJob, type ScheduledJobContext } from "./lib/jobRunner.js";
import { enqueueCircuitBreakerAlert } from "./lib/alertCollector.js";
import { checkTradingAlertOutboxAllowed } from "./lib/tradingSafety.js";
import { runArenaEvaluate } from "./jobs/arenaEvaluate.js";
import { runShadowAssessRisk } from "./jobs/shadowAssessRisk.js";
import { runShadowAlertOutbox } from "./jobs/shadowAlertOutbox.js";
import { runShadowCreateOrders } from "./jobs/shadowCreateOrders.js";
import { runShadowGenerateCandidates } from "./jobs/shadowGenerateCandidates.js";
import { runShadowMonitorPositions } from "./jobs/shadowMonitorPositions.js";
import { runShadowProcessFills } from "./jobs/shadowProcessFills.js";
import { runShadowPerformanceRefresh } from "./jobs/shadowPerformanceRefresh.js";
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
  readonly run: (database: PrismaClient, asOf: Date, context: ScheduledJobContext) => Promise<unknown>;
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
    // Every five minutes with a per-anchor cursor: each (strategy, symbol) is
    // still decided exactly once per closed hourly candle, but a tick lost to
    // a restart, a late data worker or a suspended host is caught up by the
    // next one instead of skipping the whole hour.
    cronExpression: "*/5 * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.candidateJobEnabled,
    run: (database, asOf, { entryPortfolioIds }) =>
      runShadowGenerateCandidates(database, { asOf, portfolioIds: entryPortfolioIds, skipEvaluatedAnchors: true })
  },
  {
    jobKey: "trading:risk-decide",
    cronExpression: "* * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.riskJobEnabled,
    run: (database, asOf, { entryPortfolioIds }) =>
      runShadowAssessRisk(database, { asOf, portfolioIds: entryPortfolioIds })
  },
  {
    jobKey: "trading:order-create",
    cronExpression: "* * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.orderJobEnabled,
    run: (database, asOf, { entryPortfolioIds }) =>
      runShadowCreateOrders(database, { asOf, portfolioIds: entryPortfolioIds })
  },
  {
    jobKey: "trading:simulate-fill",
    cronExpression: "*/2 * * * *",
    scope: CircuitBreakerScope.ENTRY,
    checkEntryWorkflow: true,
    enabled: (config) => config.jobFlags.fillJobEnabled,
    run: (database, asOf, { entryPortfolioIds }) =>
      runShadowProcessFills(database, { asOf, portfolioIds: entryPortfolioIds })
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
    // Every 4 minutes, strictly inside the entry-workflow guard's 5-minute
    // reconciliation ceiling. At "*/5" the entry jobs firing on the same
    // minute saw a reconcile exactly 5 min + a few ms old and were skipped.
    cronExpression: "*/4 * * * *",
    scope: CircuitBreakerScope.MONITORING,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.reconciliationJobEnabled,
    run: (database, asOf) => runShadowReconcilePortfolio(database, { asOf })
  },
  {
    // Reporting only: its own job key (so its own lease and breaker), MONITORING
    // scope and no entry-workflow check — it can neither take an entry-side
    // lease nor block trading. The job still requires its own
    // TRADING_PERFORMANCE_JOB_ENABLED gate on every run.
    jobKey: "trading:performance-refresh",
    cronExpression: "15 * * * *",
    scope: CircuitBreakerScope.MONITORING,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.performanceScheduleEnabled,
    run: (database, asOf) => runShadowPerformanceRefresh(database, { asOf })
  },
  {
    // Alert delivery: collects outbox entries from persisted state and hands
    // due ones to the n8n webhook. It writes no trading table, so like the
    // performance refresh it has its own lease and breaker, MONITORING scope
    // and no entry-workflow check. Collect and dispatch keep their own
    // TRADING_ALERT_OUTBOX_ENABLED / TRADING_ALERT_DELIVERY_ENABLED gates;
    // its BotRun rows already carry this job key.
    jobKey: "trading:alert-outbox",
    cronExpression: "*/2 * * * *",
    scope: CircuitBreakerScope.MONITORING,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.alertScheduleEnabled,
    run: (database, asOf) => runShadowAlertOutbox(database, { asOf })
  },
  {
    // SignalPilot Arena: after the performance refresh (:15) has written the
    // hour's equity point. Writes only arena rows and recommends; it can
    // neither take an entry-side lease nor change any trading state.
    jobKey: "trading:arena-evaluate",
    cronExpression: "20 * * * *",
    scope: CircuitBreakerScope.MONITORING,
    checkEntryWorkflow: false,
    enabled: (config) => config.jobFlags.arenaScheduleEnabled,
    run: (database, asOf) => runArenaEvaluate(database, { asOf })
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
      run: (context) => definition.run(database, asOf, context)
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
