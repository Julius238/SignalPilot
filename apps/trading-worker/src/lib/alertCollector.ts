/**
 * Turns persisted shadow trading state into outbox entries (P8, "4.
 * Alert-Outbox", trigger list).
 *
 * Why a collector rather than an `enqueueTradingAlert` call at each of the ten
 * sites that could raise one of these conditions: every trigger in the P8 list
 * already has a durable row behind it — a `RiskEvent`, a `TradingSession`
 * status, a `ShadowPosition` without an active `ExitPlan`, a `BotRun` history.
 * Deriving the alert from that row, inside a transaction, keyed on that row's
 * own stable key, gives exactly-once delivery semantics *and* keeps the
 * hot trading paths free of any alerting code at all — which is what makes
 * "a Telegram outage never blocks a risk-reducing exit" structurally true
 * rather than a matter of ordering. Each individual enqueue is still atomic
 * with the read that observed the condition, because both run in the same
 * `$transaction`.
 *
 * The collector only ever inserts outbox rows. It never acknowledges a risk
 * event, never changes a session, never touches an order or a position.
 */

import {
  PortfolioStatus,
  Prisma,
  RiskEventType,
  RiskSeverity,
  ShadowPositionStatus,
  TradingAlertEventType,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";

import { enqueueTradingAlert, type EnqueueTradingAlertResult } from "./alertOutbox.js";

/** Non-terminal position statuses — these must always have a live exit plan. */
const NON_TERMINAL_POSITION_STATUSES = [
  ShadowPositionStatus.OPENING,
  ShadowPositionStatus.OPEN,
  ShadowPositionStatus.PARTIALLY_CLOSED,
  ShadowPositionStatus.ERROR
];

/** How stale a heartbeat may get before it is worth waking an operator. */
export const DEFAULT_HEARTBEAT_STALE_MS = 15 * 60_000;

/** How long the position monitor may go without a successful run. */
export const DEFAULT_MONITOR_STALE_MS = 20 * 60_000;

export const POSITION_MONITOR_JOB_KEY = "trading:monitor-positions";

/**
 * `RiskEvent.type` → alert event. Types absent from this map still alert as
 * `CRITICAL_RISK_EVENT` when their severity is CRITICAL; the entries here only
 * give the operator a more specific headline for the cases P8 names by name.
 */
const RISK_EVENT_ALERT_TYPE: Partial<Record<RiskEventType, TradingAlertEventType>> = {
  [RiskEventType.DAILY_LOSS_LIMIT]: TradingAlertEventType.DAILY_LOSS_LIMIT_REACHED,
  [RiskEventType.PORTFOLIO_INCONSISTENCY]: TradingAlertEventType.PORTFOLIO_LEDGER_CONFLICT,
  [RiskEventType.IDEMPOTENCY_OR_VERSION_CONFLICT]: TradingAlertEventType.PORTFOLIO_LEDGER_CONFLICT,
  [RiskEventType.RECONCILIATION_FINDING]: TradingAlertEventType.RECONCILIATION_FAILED
};

export interface CollectTradingAlertsOptions {
  readonly asOf: Date;
  readonly heartbeatStaleMs?: number;
  readonly monitorStaleMs?: number;
  /** Bounded scan size — the collector never reads an unbounded table. */
  readonly maxRiskEventsPerRun?: number;
}

export interface CollectTradingAlertsSummary {
  readonly inspected: number;
  readonly enqueued: number;
  readonly deduplicated: number;
  readonly byEventType: Record<string, number>;
}

interface Accumulator {
  inspected: number;
  enqueued: number;
  deduplicated: number;
  readonly byEventType: Record<string, number>;
}

function record(accumulator: Accumulator, eventType: TradingAlertEventType, result: EnqueueTradingAlertResult): void {
  accumulator.inspected += 1;
  if (result.created) {
    accumulator.enqueued += 1;
    accumulator.byEventType[eventType] = (accumulator.byEventType[eventType] ?? 0) + 1;
  } else {
    accumulator.deduplicated += 1;
  }
}

/**
 * Scan for every P8 alert trigger and enqueue what is new. Idempotent: a
 * second run over unchanged state enqueues nothing.
 */
export async function collectTradingAlerts(
  database: PrismaClient,
  options: CollectTradingAlertsOptions
): Promise<CollectTradingAlertsSummary> {
  const asOf = options.asOf;
  const heartbeatStaleMs = options.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
  const monitorStaleMs = options.monitorStaleMs ?? DEFAULT_MONITOR_STALE_MS;
  const maxRiskEvents = options.maxRiskEventsPerRun ?? 200;

  const accumulator: Accumulator = { inspected: 0, enqueued: 0, deduplicated: 0, byEventType: {} };
  const utcDay = asOf.toISOString().slice(0, 10);

  // ── Unacknowledged critical risk events ──────────────────────────────────
  const riskEvents = await database.riskEvent.findMany({
    where: { severity: RiskSeverity.CRITICAL, acknowledgedAt: null },
    orderBy: { createdAt: "desc" },
    take: maxRiskEvents
  });

  for (const riskEvent of riskEvents) {
    const eventType = RISK_EVENT_ALERT_TYPE[riskEvent.type] ?? TradingAlertEventType.CRITICAL_RISK_EVENT;
    const result = await database.$transaction((tx) =>
      enqueueTradingAlert(tx, {
        eventType,
        aggregateType: "RiskEvent",
        aggregateId: riskEvent.id,
        // The risk event's own business key: the identical breach never
        // produces a second RiskEvent, so it never produces a second alert.
        occurrence: riskEvent.eventKey,
        reasonCode: riskEvent.reasonCode,
        portfolioId: riskEvent.portfolioId,
        tradingSessionId: riskEvent.tradingSessionId,
        payload: {
          riskEventType: riskEvent.type,
          severity: riskEvent.severity,
          tradeCandidateId: riskEvent.tradeCandidateId,
          shadowOrderId: riskEvent.shadowOrderId,
          shadowPositionId: riskEvent.shadowPositionId,
          createdAt: riskEvent.createdAt
        },
        asOf
      })
    );
    record(accumulator, eventType, result);
  }

  // ── Session state: ERROR_LOCKED and kill switch ──────────────────────────
  const sessions = await database.tradingSession.findMany({
    where: { status: { not: TradingSessionStatus.CLOSED } },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  for (const session of sessions) {
    if (session.status === TradingSessionStatus.ERROR_LOCKED) {
      const result = await database.$transaction((tx) =>
        enqueueTradingAlert(tx, {
          eventType: TradingAlertEventType.SESSION_ERROR_LOCKED,
          aggregateType: "TradingSession",
          aggregateId: session.id,
          // A later re-lock bumps the version, so a repeat incident alerts
          // again while the same one never does.
          occurrence: `v${session.version}`,
          reasonCode: session.killReasonCode ?? "SESSION_ERROR_LOCKED",
          portfolioId: session.portfolioId,
          tradingSessionId: session.id,
          payload: { status: session.status, killSwitchEngaged: session.killSwitchEngaged },
          asOf
        })
      );
      record(accumulator, TradingAlertEventType.SESSION_ERROR_LOCKED, result);
    }

    const killedAt = session.killedAt ?? null;
    if (session.killSwitchEngaged && killedAt !== null) {
      const result = await database.$transaction((tx) =>
        enqueueTradingAlert(tx, {
          eventType: TradingAlertEventType.KILL_SWITCH_ENGAGED,
          aggregateType: "TradingSession",
          aggregateId: session.id,
          occurrence: killedAt.toISOString(),
          reasonCode: session.killReasonCode ?? "KILL_SWITCH_ENGAGED",
          portfolioId: session.portfolioId,
          tradingSessionId: session.id,
          payload: { status: session.status, killedAt },
          asOf
        })
      );
      record(accumulator, TradingAlertEventType.KILL_SWITCH_ENGAGED, result);
    }

    // ── Stale worker heartbeat ─────────────────────────────────────────────
    const heartbeatAt = session.heartbeatAt ?? null;
    const heartbeatAge = heartbeatAt === null ? null : asOf.getTime() - heartbeatAt.getTime();
    if (
      session.status === TradingSessionStatus.SHADOW_ACTIVE &&
      heartbeatAge !== null &&
      heartbeatAge > heartbeatStaleMs
    ) {
      const result = await database.$transaction((tx) =>
        enqueueTradingAlert(tx, {
          eventType: TradingAlertEventType.WORKER_HEARTBEAT_STALE,
          aggregateType: "TradingSession",
          aggregateId: session.id,
          // One alert per UTC day per session: an outage that lasts hours is
          // one incident, not one alert per collector run.
          occurrence: utcDay,
          reasonCode: "WORKER_HEARTBEAT_STALE",
          portfolioId: session.portfolioId,
          tradingSessionId: session.id,
          payload: {
            heartbeatAt,
            staleForMinutes: Math.floor(heartbeatAge / 60_000),
            thresholdMinutes: Math.floor(heartbeatStaleMs / 60_000)
          },
          asOf
        })
      );
      record(accumulator, TradingAlertEventType.WORKER_HEARTBEAT_STALE, result);
    }
  }

  const portfolios = await database.portfolio.findMany({
    where: { status: { not: PortfolioStatus.ARCHIVED } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, key: true, status: true, lastReconciledAt: true }
  });

  // ── Positions without a live exit plan ───────────────────────────────────
  const unsafePositions = await database.shadowPosition.findMany({
    where: { status: { in: NON_TERMINAL_POSITION_STATUSES }, activeExitPlanVersion: null },
    orderBy: { openedAt: "desc" },
    take: 100,
    select: { id: true, portfolioId: true, assetId: true, status: true, openQuantity: true, version: true }
  });

  for (const position of unsafePositions) {
    const result = await database.$transaction((tx) =>
      enqueueTradingAlert(tx, {
        eventType: TradingAlertEventType.POSITION_WITHOUT_SAFE_EXIT,
        aggregateType: "ShadowPosition",
        aggregateId: position.id,
        occurrence: `v${position.version}`,
        reasonCode: "POSITION_WITHOUT_SAFE_EXIT",
        portfolioId: position.portfolioId,
        payload: {
          assetId: position.assetId,
          status: position.status,
          openQuantity: position.openQuantity
        },
        asOf
      })
    );
    record(accumulator, TradingAlertEventType.POSITION_WITHOUT_SAFE_EXIT, result);
  }

  // ── Position monitor has not succeeded recently ──────────────────────────
  const lastMonitorSuccess = await database.botRun.findFirst({
    where: { jobName: POSITION_MONITOR_JOB_KEY, status: "SUCCESS" },
    orderBy: { startedAt: "desc" }
  });
  const hasOpenPositions = unsafePositions.length > 0 ||
    (await database.shadowPosition.count({ where: { status: { in: NON_TERMINAL_POSITION_STATUSES } } })) > 0;

  if (hasOpenPositions) {
    const lastSuccessAt = (lastMonitorSuccess?.finishedAt ?? lastMonitorSuccess?.startedAt) ?? null;
    const monitorAge = lastSuccessAt === null ? null : asOf.getTime() - lastSuccessAt.getTime();
    if (lastSuccessAt === null || (monitorAge !== null && monitorAge > monitorStaleMs)) {
      const result = await database.$transaction((tx) =>
        enqueueTradingAlert(tx, {
          eventType: TradingAlertEventType.POSITION_MONITOR_STALE,
          aggregateType: "TradingJob",
          aggregateId: POSITION_MONITOR_JOB_KEY,
          occurrence: utcDay,
          reasonCode: "POSITION_MONITOR_STALE",
          portfolioId: portfolios[0]?.id ?? null,
          payload: {
            lastSuccessAt,
            thresholdMinutes: Math.floor(monitorStaleMs / 60_000)
          },
          asOf
        })
      );
      record(accumulator, TradingAlertEventType.POSITION_MONITOR_STALE, result);
    }
  }

  // ── Portfolio locked into ERROR_LOCKED ───────────────────────────────────
  for (const portfolio of portfolios) {
    if (portfolio.status !== PortfolioStatus.ERROR_LOCKED) continue;
    const result = await database.$transaction((tx) =>
      enqueueTradingAlert(tx, {
        eventType: TradingAlertEventType.PORTFOLIO_LEDGER_CONFLICT,
        aggregateType: "Portfolio",
        aggregateId: portfolio.id,
        occurrence: utcDay,
        reasonCode: "PORTFOLIO_ERROR_LOCKED",
        portfolioId: portfolio.id,
        payload: { portfolioKey: portfolio.key, lastReconciledAt: portfolio.lastReconciledAt },
        asOf
      })
    );
    record(accumulator, TradingAlertEventType.PORTFOLIO_LEDGER_CONFLICT, result);
  }

  return {
    inspected: accumulator.inspected,
    enqueued: accumulator.enqueued,
    deduplicated: accumulator.deduplicated,
    byEventType: accumulator.byEventType
  };
}

export interface CircuitBreakerAlertInput {
  readonly jobKey: string;
  readonly scope: string;
  readonly reasonCode: string;
  readonly cooldownUntil: string | null;
  readonly portfolioId: string | null;
}

/**
 * Enqueue a circuit-breaker alert. Called by the scheduler when a job is
 * skipped because its breaker is open — the breaker itself has no persisted
 * row the collector could derive from, so this is the one condition that has
 * to be reported at the site that observes it.
 *
 * Deduplicated per breaker cooldown window, so one open breaker produces one
 * alert, not one per scheduler tick.
 */
export async function enqueueCircuitBreakerAlert(
  database: PrismaClient,
  input: CircuitBreakerAlertInput,
  asOf: Date
): Promise<EnqueueTradingAlertResult> {
  return database.$transaction((tx) =>
    enqueueTradingAlert(tx, {
      eventType: TradingAlertEventType.CIRCUIT_BREAKER_OPEN,
      aggregateType: "TradingJob",
      aggregateId: input.jobKey,
      occurrence: input.cooldownUntil ?? asOf.toISOString().slice(0, 13),
      reasonCode: input.reasonCode,
      portfolioId: input.portfolioId,
      payload: { scope: input.scope, cooldownUntil: input.cooldownUntil },
      asOf
    })
  );
}

export { Prisma };
