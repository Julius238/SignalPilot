/**
 * Deterministic, stateless circuit breaker for scheduled trading jobs.
 *
 * Specification: P5 task, "Circuit Breaker" — "wiederholte Jobfehler,
 * veraltete Marktdaten, wiederholte Hash-/Versionskonflikte, Ledger- oder
 * Portfolioabweichungen, fehlgeschlagene Positionsüberwachung, unerwartete
 * Joblaufzeiten, Datenbankfehler mit unsicherem Zustand ... Automatisches
 * Zurücksetzen eines Kill Switch oder ERROR_LOCKED ist verboten."
 *
 * Deliberately has no dedicated state table: every signal it trips on is
 * already durable (`BotRun` outcomes/durations, `RiskEvent` occurrences), so
 * the breaker's state is *derived* fresh on every evaluation rather than
 * cached in a mutable row that could itself drift from reality after a
 * crash. This is the same "replay, never trust a cache blindly" principle
 * P1–P4 apply to the portfolio ledger.
 *
 * The breaker only ever decides whether the *next attempt* of a job may
 * start. It never mutates `TradingSession`, a kill switch or an
 * `ERROR_LOCKED` state — those remain exclusively the reconciliation and
 * risk-engine paths' responsibility (docs/trading/04). A tripped breaker on
 * an entry-side job (candidates/risk/orders/fills) blocks that job's next
 * attempt; a tripped breaker never blocks the monitoring or reconciliation
 * jobs (docs/trading P5, workflow section: "Positionsüberwachung,
 * Reconciliation ... müssen in blockierten Zuständen weiterlaufen können") —
 * callers achieve that simply by giving those two jobs the `MONITORING`
 * scope, which never inspects the entry-blocking signals below.
 */

import { BotRunStatus, RiskEventType, RiskSeverity, type PrismaClient } from "@signalpilot/database";

export const CIRCUIT_BREAKER_POLICY_VERSION = "circuit-breaker-v1/1.0.0";

export const CircuitBreakerScope = {
  /** Candidate/risk/order/fill jobs — may create new exposure. */
  ENTRY: "ENTRY",
  /** Position monitoring and reconciliation — must keep running regardless. */
  MONITORING: "MONITORING"
} as const;
export type CircuitBreakerScope = (typeof CircuitBreakerScope)[keyof typeof CircuitBreakerScope];

export const CircuitBreakerState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN"
} as const;
export type CircuitBreakerState = (typeof CircuitBreakerState)[keyof typeof CircuitBreakerState];

export const CircuitBreakerTripReason = {
  CONSECUTIVE_JOB_FAILURES: "CIRCUIT_BREAKER_CONSECUTIVE_JOB_FAILURES",
  UNEXPECTED_JOB_DURATION: "CIRCUIT_BREAKER_UNEXPECTED_JOB_DURATION",
  DATA_STALE: "CIRCUIT_BREAKER_DATA_STALE",
  IDEMPOTENCY_OR_VERSION_CONFLICT: "CIRCUIT_BREAKER_IDEMPOTENCY_OR_VERSION_CONFLICT",
  PORTFOLIO_OR_LEDGER_DEVIATION: "CIRCUIT_BREAKER_PORTFOLIO_OR_LEDGER_DEVIATION",
  DATABASE_ERROR: "CIRCUIT_BREAKER_DATABASE_ERROR"
} as const;
export type CircuitBreakerTripReason =
  (typeof CircuitBreakerTripReason)[keyof typeof CircuitBreakerTripReason];

export interface CircuitBreakerThresholds {
  /** How many of the most recent runs of this job to inspect. */
  readonly lookbackRuns: number;
  /** Consecutive FAILED runs (most recent first) that trip the breaker. */
  readonly consecutiveJobFailures: number;
  /** A single run at/above this duration counts as an unexpected-duration trip. */
  readonly maxJobDurationMs: number;
  /** Unacknowledged CRITICAL `DATA_STALE` events within the lookback window that trip entry jobs. */
  readonly staleDataEventThreshold: number;
  /** Unacknowledged CRITICAL idempotency/version-conflict events that trip entry jobs. */
  readonly conflictEventThreshold: number;
  /** Unacknowledged CRITICAL ledger/portfolio-inconsistency events that trip entry jobs. */
  readonly portfolioDeviationEventThreshold: number;
  /** How far back to look for `RiskEvent` signals. */
  readonly riskEventLookbackMs: number;
  /** How long a trip blocks the next attempt before allowing one probe run. */
  readonly cooldownMs: number;
}

/**
 * Deliberately conservative defaults: a single unresolved ledger/portfolio
 * or stale-data finding already blocks new exposure at the reconciliation
 * layer, so the breaker's own threshold for those is 1 — it exists to stop
 * the *scheduler* from repeatedly attempting entry-side work while that
 * finding is unresolved, not to add a second, looser tolerance.
 */
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLDS: CircuitBreakerThresholds = Object.freeze({
  lookbackRuns: 20,
  consecutiveJobFailures: 3,
  maxJobDurationMs: 5 * 60 * 1000,
  staleDataEventThreshold: 1,
  conflictEventThreshold: 1,
  portfolioDeviationEventThreshold: 1,
  riskEventLookbackMs: 24 * 60 * 60 * 1000,
  cooldownMs: 15 * 60 * 1000
});

const ENTRY_TRIP_EVENT_TYPES: Readonly<Record<RiskEventType, CircuitBreakerTripReason>> = Object.freeze({
  [RiskEventType.DATA_STALE]: CircuitBreakerTripReason.DATA_STALE,
  [RiskEventType.IDEMPOTENCY_OR_VERSION_CONFLICT]: CircuitBreakerTripReason.IDEMPOTENCY_OR_VERSION_CONFLICT,
  [RiskEventType.RECONCILIATION_FINDING]: CircuitBreakerTripReason.PORTFOLIO_OR_LEDGER_DEVIATION,
  [RiskEventType.PORTFOLIO_INCONSISTENCY]: CircuitBreakerTripReason.PORTFOLIO_OR_LEDGER_DEVIATION
} as Partial<Record<RiskEventType, CircuitBreakerTripReason>> as Record<RiskEventType, CircuitBreakerTripReason>);

const THRESHOLD_FOR_TRIP_REASON: Readonly<Partial<Record<CircuitBreakerTripReason, keyof CircuitBreakerThresholds>>> =
  Object.freeze({
    [CircuitBreakerTripReason.DATA_STALE]: "staleDataEventThreshold",
    [CircuitBreakerTripReason.IDEMPOTENCY_OR_VERSION_CONFLICT]: "conflictEventThreshold",
    [CircuitBreakerTripReason.PORTFOLIO_OR_LEDGER_DEVIATION]: "portfolioDeviationEventThreshold"
  });

export interface EvaluateCircuitBreakerInput {
  readonly jobKey: string;
  readonly portfolioId: string;
  readonly scope: CircuitBreakerScope;
  readonly asOf: Date;
  readonly thresholds?: CircuitBreakerThresholds;
}

export interface CircuitBreakerResult {
  readonly state: CircuitBreakerState;
  readonly allowed: boolean;
  readonly reasonCode: CircuitBreakerTripReason | null;
  readonly trippedAt: string | null;
  readonly cooldownUntil: string | null;
  readonly policyVersion: string;
}

function closed(): CircuitBreakerResult {
  return {
    state: CircuitBreakerState.CLOSED,
    allowed: true,
    reasonCode: null,
    trippedAt: null,
    cooldownUntil: null,
    policyVersion: CIRCUIT_BREAKER_POLICY_VERSION
  };
}

function fromTrip(
  reasonCode: CircuitBreakerTripReason,
  trippedAt: Date,
  cooldownMs: number,
  asOf: Date
): CircuitBreakerResult {
  const cooldownUntil = new Date(trippedAt.getTime() + cooldownMs);
  const stillCooling = asOf.getTime() < cooldownUntil.getTime();
  return {
    state: stillCooling ? CircuitBreakerState.OPEN : CircuitBreakerState.HALF_OPEN,
    allowed: !stillCooling,
    reasonCode,
    trippedAt: trippedAt.toISOString(),
    cooldownUntil: cooldownUntil.toISOString(),
    policyVersion: CIRCUIT_BREAKER_POLICY_VERSION
  };
}

/**
 * Evaluate whether `jobKey`'s next scheduled attempt may run. Never throws
 * on its own account for a "normal" tripped state — a caller that cannot
 * even reach the database for this check should treat that as its own
 * database-error signal and fail closed (skip the run), which is exactly
 * what happens if this function's promise rejects.
 */
export async function evaluateCircuitBreaker(
  database: PrismaClient,
  input: EvaluateCircuitBreakerInput
): Promise<CircuitBreakerResult> {
  const thresholds = input.thresholds ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLDS;

  const recentRuns = await database.botRun.findMany({
    where: { jobName: input.jobKey },
    orderBy: { startedAt: "desc" },
    take: thresholds.lookbackRuns
  });

  let consecutiveFailures = 0;
  for (const run of recentRuns) {
    if (run.status === BotRunStatus.FAILED) consecutiveFailures += 1;
    else break;
  }
  if (consecutiveFailures >= thresholds.consecutiveJobFailures) {
    const trippedAt = recentRuns[0]?.finishedAt ?? recentRuns[0]?.startedAt ?? input.asOf;
    return fromTrip(CircuitBreakerTripReason.CONSECUTIVE_JOB_FAILURES, trippedAt, thresholds.cooldownMs, input.asOf);
  }

  const longRun = recentRuns.find(
    (run) => run.finishedAt !== null && run.finishedAt.getTime() - run.startedAt.getTime() >= thresholds.maxJobDurationMs
  );
  if (longRun !== undefined) {
    return fromTrip(
      CircuitBreakerTripReason.UNEXPECTED_JOB_DURATION,
      longRun.finishedAt ?? longRun.startedAt,
      thresholds.cooldownMs,
      input.asOf
    );
  }

  if (input.scope === CircuitBreakerScope.ENTRY) {
    const since = new Date(input.asOf.getTime() - thresholds.riskEventLookbackMs);
    const events = await database.riskEvent.findMany({
      where: {
        portfolioId: input.portfolioId,
        severity: RiskSeverity.CRITICAL,
        acknowledgedAt: null,
        createdAt: { gte: since, lte: input.asOf },
        type: { in: Object.keys(ENTRY_TRIP_EVENT_TYPES) as RiskEventType[] }
      },
      orderBy: { createdAt: "desc" }
    });

    const counts = new Map<CircuitBreakerTripReason, { count: number; latest: Date }>();
    for (const event of events) {
      const reason = ENTRY_TRIP_EVENT_TYPES[event.type];
      if (reason === undefined) continue;
      const existing = counts.get(reason);
      if (existing === undefined) counts.set(reason, { count: 1, latest: event.createdAt });
      else existing.count += 1;
    }

    for (const [reason, info] of counts) {
      const thresholdKey = THRESHOLD_FOR_TRIP_REASON[reason];
      const threshold = thresholdKey === undefined ? Number.POSITIVE_INFINITY : thresholds[thresholdKey];
      if (info.count >= threshold) {
        return fromTrip(reason, info.latest, thresholds.cooldownMs, input.asOf);
      }
    }
  }

  return closed();
}

/**
 * `CircuitBreakerTripReason.DATABASE_ERROR` has no signal of its own here on
 * purpose: a database error with an uncertain outcome (mid-transaction
 * failure, connection loss) makes the enclosing job throw, the job runner
 * (`lib/jobRunner.ts`) records that as a `FAILED` `BotRun` with
 * `errorClass: "DATABASE_ERROR"`, and the very next evaluation already sees
 * it through the ordinary `CONSECUTIVE_JOB_FAILURES` signal above. A second,
 * parallel bookkeeping path for the same fact would only risk drifting from
 * the `BotRun` history that is the actual source of truth.
 */
