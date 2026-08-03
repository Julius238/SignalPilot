/**
 * Delivery side of the trading alert outbox (P8, "4. Alert-Outbox").
 *
 * Reuses the existing n8n/Telegram infrastructure — `@signalpilot/alerts`'
 * `sendMarketEventAlertToN8n`, the same webhook, the same `Alert` row, the
 * same `BotLog` trail — rather than opening a second delivery channel. A
 * trading alert is a `risk_warning`/`urgent_event` in that package's existing
 * research-alert taxonomy.
 *
 * The state machine is deliberately small and terminating:
 *
 *   PENDING ──claim──▶ PROCESSING ──ok──▶ SENT
 *                          │
 *                          └──fail──▶ FAILED (nextAttemptAt = now + backoff)
 *                                        │
 *                                        └── attempts exhausted ──▶ DEAD
 *
 * `DEAD` is never picked up again. A claim carries an expiry, so a dispatcher
 * that dies mid-attempt releases its entry instead of stranding it.
 */

import { Prisma, TradingAlertOutboxStatus, type PrismaClient } from "@signalpilot/database";
import { sendMarketEventAlertToN8n, type ResearchAlertSeverity } from "@signalpilot/alerts";

import { backoffMsForAttempt } from "./alertOutbox.js";

export const DEFAULT_CLAIM_DURATION_MS = 120_000;
export const DEFAULT_BATCH_SIZE = 20;

/** Delivery transport. Injectable so tests never reach the network. */
export type AlertTransport = (input: {
  readonly id: string;
  readonly eventType: string;
  readonly severity: ResearchAlertSeverity;
  readonly reasonCode: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payloadJson: Prisma.JsonValue;
  readonly occurredAt: Date;
}) => Promise<{ readonly alertId: string | null; readonly ok: boolean; readonly error?: string }>;

/** `RiskSeverity` → the research-alert severity the n8n payload expects. */
function toResearchSeverity(severity: string): ResearchAlertSeverity {
  return severity === "CRITICAL" ? "CRITICAL" : "IMPORTANT";
}

/**
 * Flatten the already-sanitised payload into a short `key=value` line for the
 * alert body. The n8n market-event schema has no free-form JSON field, and
 * inventing one would mean a second, unreviewed path for internal state to
 * escape — so only scalars at the top level are rendered, truncated.
 */
function renderPayloadSummary(payload: Prisma.JsonValue): string {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || typeof value === "object") continue;
    parts.push(`${key}=${String(value)}`);
    if (parts.length >= 8) break;
  }
  return parts.join(", ").slice(0, 400);
}

/**
 * Default transport: the existing n8n webhook dispatcher. The payload was
 * sanitised at enqueue time; this only maps it onto the alert package's own
 * market-event schema — no new fields, no raw JSON passthrough.
 */
export function createN8nTransport(database: PrismaClient): AlertTransport {
  return async (input) => {
    const result = await sendMarketEventAlertToN8n(
      {
        marketEvent: {
          id: input.id,
          alertType: input.severity === "CRITICAL" ? "urgent_event" : "risk_warning",
          severity: input.severity,
          title: `Shadow Trading: ${input.eventType}`,
          summary: `${input.reasonCode} (${input.aggregateType} ${input.aggregateId})`,
          reasoning: renderPayloadSummary(input.payloadJson) || null,
          sourceName: "SignalPilot Shadow Trading",
          detectedAt: input.occurredAt
        }
      },
      { database }
    );
    return {
      alertId: result.alertId,
      ok: result.status === "SENT",
      error: result.error
    };
  };
}

export interface DispatchPendingAlertsOptions {
  readonly asOf: Date;
  readonly ownerId: string;
  readonly transport: AlertTransport;
  readonly batchSize?: number;
  readonly claimDurationMs?: number;
}

export interface DispatchPendingAlertsSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly deadLettered: number;
}

/**
 * Claim one entry with an optimistic `updateMany` guarded by its `version`.
 * Two dispatchers racing for the same row: exactly one sees `count === 1`.
 *
 * `attempt` is passed in rather than derived from `entry` here, so the number
 * this attempt is logged under is fixed before any write happens and cannot
 * shift underneath the caller.
 */
async function claim(
  database: PrismaClient,
  entry: { id: string; version: number },
  attempt: number,
  ownerId: string,
  asOf: Date,
  claimDurationMs: number
): Promise<boolean> {
  const claimed = await database.tradingAlertOutbox.updateMany({
    where: {
      id: entry.id,
      version: entry.version,
      status: { in: [TradingAlertOutboxStatus.PENDING, TradingAlertOutboxStatus.FAILED] }
    },
    data: {
      status: TradingAlertOutboxStatus.PROCESSING,
      claimedBy: ownerId,
      claimedAt: asOf,
      claimExpiresAt: new Date(asOf.getTime() + claimDurationMs),
      attemptCount: attempt,
      lastAttemptAt: asOf,
      version: entry.version + 1
    }
  });
  return claimed.count === 1;
}

/**
 * Deliver every due alert. Returns a summary and never throws for a delivery
 * failure — a failing transport marks the entry, it does not fail the job.
 */
export async function dispatchPendingAlerts(
  database: PrismaClient,
  options: DispatchPendingAlertsOptions
): Promise<DispatchPendingAlertsSummary> {
  const asOf = options.asOf;
  const claimDurationMs = options.claimDurationMs ?? DEFAULT_CLAIM_DURATION_MS;

  const due = await database.tradingAlertOutbox.findMany({
    where: {
      status: { in: [TradingAlertOutboxStatus.PENDING, TradingAlertOutboxStatus.FAILED] },
      nextAttemptAt: { lte: asOf }
    },
    orderBy: [{ severity: "desc" }, { nextAttemptAt: "asc" }],
    take: options.batchSize ?? DEFAULT_BATCH_SIZE
  });

  // A PROCESSING entry whose claim expired is retried by whoever finds it —
  // otherwise a dispatcher crash would strand the alert forever.
  const expired = await database.tradingAlertOutbox.findMany({
    where: {
      status: TradingAlertOutboxStatus.PROCESSING,
      claimExpiresAt: { lt: asOf }
    },
    take: options.batchSize ?? DEFAULT_BATCH_SIZE
  });
  for (const entry of expired) {
    await database.tradingAlertOutbox.updateMany({
      where: { id: entry.id, version: entry.version, status: TradingAlertOutboxStatus.PROCESSING },
      data: {
        status: TradingAlertOutboxStatus.FAILED,
        lastError: "Claim expired before the attempt finished.",
        nextAttemptAt: asOf,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        version: entry.version + 1
      }
    });
  }

  let claimedCount = 0;
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const entry of due) {
    // Snapshot everything the attempt bookkeeping needs before the claim
    // mutates the row, so the attempt number, the previous alert id and the
    // previous timestamps are all read from the pre-claim state.
    const attempt = entry.attemptCount + 1;
    const previousAlertId = entry.alertId;
    const previousSentAt = entry.sentAt;
    const previousDeadLetteredAt = entry.deadLetteredAt;
    const previousNextAttemptAt = entry.nextAttemptAt;

    const won = await claim(database, entry, attempt, options.ownerId, asOf, claimDurationMs);
    if (!won) continue;
    claimedCount += 1;

    const startedAt = new Date();
    let error: string | null = null;
    let alertId: string | null = null;

    try {
      const result = await options.transport({
        id: entry.id,
        eventType: entry.eventType,
        severity: toResearchSeverity(entry.severity),
        reasonCode: entry.reasonCode,
        aggregateType: entry.aggregateType,
        aggregateId: entry.aggregateId,
        payloadJson: entry.payloadJson,
        occurredAt: entry.createdAt
      });
      alertId = result.alertId;
      if (!result.ok) error = result.error ?? "Alert transport reported a failure.";
    } catch (transportError) {
      // Only the message, never the stack or the thrown object — the attempt
      // log must not become a second leak path for internal state.
      error = transportError instanceof Error ? transportError.message : "Unknown alert transport error";
    }

    const finishedAt = new Date();
    const exhausted = error !== null && attempt >= entry.maxAttempts;
    const nextStatus =
      error === null
        ? TradingAlertOutboxStatus.SENT
        : exhausted
          ? TradingAlertOutboxStatus.DEAD
          : TradingAlertOutboxStatus.FAILED;

    await database.$transaction(async (tx) => {
      await tx.tradingAlertOutboxAttempt.create({
        data: {
          outboxId: entry.id,
          attempt,
          status: nextStatus,
          error: error === null ? null : error.slice(0, 512),
          startedAt,
          finishedAt
        }
      });
      await tx.tradingAlertOutbox.update({
        where: { id: entry.id },
        data: {
          status: nextStatus,
          lastError: error === null ? null : error.slice(0, 512),
          alertId: alertId ?? previousAlertId,
          sentAt: error === null ? finishedAt : previousSentAt,
          deadLetteredAt: nextStatus === TradingAlertOutboxStatus.DEAD ? finishedAt : previousDeadLetteredAt,
          // A DEAD or SENT entry is never due again; the far-future date is
          // belt-and-braces on top of the status filter.
          nextAttemptAt:
            nextStatus === TradingAlertOutboxStatus.FAILED
              ? new Date(asOf.getTime() + backoffMsForAttempt(attempt))
              : previousNextAttemptAt,
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
          version: { increment: 1 }
        }
      });
    });

    if (nextStatus === TradingAlertOutboxStatus.SENT) sent += 1;
    else if (nextStatus === TradingAlertOutboxStatus.DEAD) deadLettered += 1;
    else failed += 1;
  }

  return { claimed: claimedCount, sent, failed, deadLettered };
}
