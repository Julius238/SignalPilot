/**
 * Transactional alert outbox for safety- and operations-relevant shadow
 * trading events (P8, "4. Alert-Outbox").
 *
 * Two hard boundaries shape this module:
 *
 *   1. **An alert must never influence trading.** Nothing here is ever awaited
 *      on a path that opens, monitors or closes a position. `enqueue` only
 *      inserts a row; `dispatchPendingAlerts` runs from its own job. A
 *      Telegram/n8n outage therefore cannot delay a risk-reducing exit
 *      (P8: "Telegram-Ausfall darf Trading-Überwachung und risikoreduzierende
 *      Exits nicht blockieren").
 *
 *   2. **An alert must never leak internal state.** `sanitisePayload` is an
 *      allowlist: only the fields a payload builder explicitly puts in reach
 *      the row, and a final redaction pass drops anything whose key looks like
 *      a secret. Raw aggregates, `process.env` and error objects never go in
 *      whole.
 *
 * Deduplication is by `TradingAlertOutbox.idempotencyKey`, derived from the
 * triggering aggregate's own stable key (a `RiskEvent.eventKey`, a session id
 * plus version, a UTC trading day). Observing the same condition twice
 * therefore produces exactly one alert, without a time window or a cache.
 */

import { Prisma, RiskSeverity, TradingAlertEventType, TradingAlertOutboxStatus } from "@signalpilot/database";
import type { PrismaClient } from "@signalpilot/database";
import { buildPayloadHash, buildTradingAlertIdempotencyKey } from "@signalpilot/trading-domain";

/** Prisma client or an interactive-transaction client — both accept writes. */
export type AlertOutboxClient = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Backoff schedule in milliseconds, indexed by the attempt that just failed.
 * Bounded and finite: after `DEFAULT_MAX_ATTEMPTS` the entry becomes `DEAD`
 * and is never picked up again (P8: "Retry mit begrenztem Backoff ... keine
 * Endlosschleifen").
 */
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000, // 1 min
  300_000, // 5 min
  900_000, // 15 min
  3_600_000 // 1 h
];

/** Severity of each catalogued event. Only WARNING and CRITICAL exist here. */
export const ALERT_SEVERITY: Readonly<Record<TradingAlertEventType, RiskSeverity>> = {
  [TradingAlertEventType.SESSION_ERROR_LOCKED]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.KILL_SWITCH_ENGAGED]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.RECONCILIATION_FAILED]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.CRITICAL_RISK_EVENT]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.POSITION_WITHOUT_SAFE_EXIT]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.PORTFOLIO_LEDGER_CONFLICT]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.DAILY_LOSS_LIMIT_REACHED]: RiskSeverity.CRITICAL,
  [TradingAlertEventType.CIRCUIT_BREAKER_OPEN]: RiskSeverity.WARNING,
  [TradingAlertEventType.WORKER_HEARTBEAT_STALE]: RiskSeverity.WARNING,
  [TradingAlertEventType.POSITION_MONITOR_STALE]: RiskSeverity.WARNING
};

/**
 * Key fragments that must never appear in an outbox payload, regardless of
 * which builder produced it. Matched case-insensitively as a substring, so
 * `n8nWebhookUrl`, `TELEGRAM_BOT_TOKEN` and `dbPassword` are all caught.
 */
const REDACTED_KEY_FRAGMENTS: readonly string[] = [
  "secret",
  "token",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "credential",
  "authorization",
  "cookie",
  "webhook",
  "connectionstring",
  "database_url",
  "databaseurl",
  "privatekey",
  "private_key"
];

const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 20;
const MAX_DEPTH = 4;

function isRedactedKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return REDACTED_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Reduce an arbitrary value to JSON that is safe to hand to an external
 * webhook: primitives only, bounded depth, bounded length, redacted keys
 * removed. Anything the allowlist cannot represent is dropped rather than
 * stringified, so no `Error.stack`, no Prisma model instance and no
 * environment object survives.
 */
export function sanitisePayload(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (value === null || value === undefined) return null as unknown as Prisma.InputJsonValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null as unknown as Prisma.InputJsonValue;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (depth >= MAX_DEPTH) return null as unknown as Prisma.InputJsonValue;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitisePayload(entry, depth + 1));
  }
  if (typeof value === "object") {
    // Prisma Decimal and similar value objects expose a safe toString().
    const candidate = value as { toString?: () => string };
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null && typeof candidate.toString === "function") {
      const text = candidate.toString();
      return text === "[object Object]" ? (null as unknown as Prisma.InputJsonValue) : text;
    }

    const output: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isRedactedKey(key)) continue;
      output[key] = sanitisePayload(entry, depth + 1);
    }
    return output;
  }
  // Functions and symbols never reach a payload.
  return null as unknown as Prisma.InputJsonValue;
}

export interface EnqueueTradingAlertInput {
  readonly eventType: TradingAlertEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /**
   * What makes a *repeat* of the same condition a new alert — a new
   * `RiskEvent.eventKey`, a session version, a UTC trading day. Never the
   * observation timestamp, which would defeat deduplication entirely.
   */
  readonly occurrence: string;
  readonly reasonCode: string;
  readonly portfolioId?: string | null;
  readonly tradingSessionId?: string | null;
  readonly payload: Record<string, unknown>;
  readonly asOf: Date;
  readonly maxAttempts?: number;
}

export interface EnqueueTradingAlertResult {
  readonly idempotencyKey: string;
  /** False when an entry for this key already existed — the alert is not repeated. */
  readonly created: boolean;
  readonly outboxId: string;
}

/**
 * Record one alert. Safe to call inside an interactive transaction: pass the
 * transaction client and the outbox row commits atomically with the event that
 * caused it (P8: "Event und Outbox-Eintrag atomar speichern").
 *
 * Never throws on a duplicate — a concurrent writer that won the unique index
 * is the correct outcome, not an error the caller has to handle.
 */
export async function enqueueTradingAlert(
  client: AlertOutboxClient,
  input: EnqueueTradingAlertInput
): Promise<EnqueueTradingAlertResult> {
  const idempotencyKey = buildTradingAlertIdempotencyKey({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurrence: input.occurrence
  });
  const payloadJson = sanitisePayload({
    eventType: input.eventType,
    reasonCode: input.reasonCode,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    observedAt: input.asOf.toISOString(),
    ...input.payload
  });

  const existing = await client.tradingAlertOutbox.findUnique({ where: { idempotencyKey } });
  if (existing !== null) {
    return { idempotencyKey, created: false, outboxId: existing.id };
  }

  try {
    const created = await client.tradingAlertOutbox.create({
      data: {
        idempotencyKey,
        eventType: input.eventType,
        severity: ALERT_SEVERITY[input.eventType],
        status: TradingAlertOutboxStatus.PENDING,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        portfolioId: input.portfolioId ?? null,
        tradingSessionId: input.tradingSessionId ?? null,
        reasonCode: input.reasonCode,
        payloadJson,
        payloadHash: buildPayloadHash(payloadJson),
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: input.asOf
      }
    });
    return { idempotencyKey, created: true, outboxId: created.id };
  } catch (error) {
    // A concurrent enqueue of the identical condition won the unique index.
    // That is exactly the deduplication this outbox promises.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await client.tradingAlertOutbox.findUnique({ where: { idempotencyKey } });
      if (winner !== null) return { idempotencyKey, created: false, outboxId: winner.id };
    }
    throw error;
  }
}

/** Delay before the next attempt after `attemptCount` failures. */
export function backoffMsForAttempt(attemptCount: number): number {
  const index = Math.max(0, attemptCount - 1);
  return RETRY_BACKOFF_MS[Math.min(index, RETRY_BACKOFF_MS.length - 1)];
}
