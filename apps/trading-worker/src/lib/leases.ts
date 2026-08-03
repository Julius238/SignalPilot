/**
 * PostgreSQL-backed job leases: owner, expiry and heartbeat on
 * `TradingJobCursor`.
 *
 * Specification:
 *   docs/trading/02-shadow-trading-target-architecture.md, "Jobs und
 *     Zeitmodell" — "Aktive Arbeit wird zusätzlich per Claim (claimedBy,
 *     claimedAt, claimExpiresAt) ... übernommen; abgelaufene Claims dürfen
 *     nach Reconciliation erneut verarbeitet werden."
 *   P5 task: "Schutz muss prozessübergreifend in PostgreSQL funktionieren;
 *     keine reine In-Memory-Sperre; Lease mit Ablaufzeit, Owner und
 *     Heartbeat; verwaiste Jobs sicher wiederaufnehmbar."
 *
 * No new model: `TradingJobCursor` already carries every field a lease
 * needs. A scheduler-level lease uses `scopeKey = "GLOBAL"` (one lease per
 * job across the whole deployment); the per-candle/per-position claim
 * fields the P1–P4 jobs already use for their own idempotency are a
 * different, narrower concern and are untouched by this module.
 *
 * The acquire step is a single atomic `UPDATE ... WHERE` (or, for a brand
 * new job key, an `INSERT` that loses a race to a unique-constraint
 * violation and retries as an update) — Postgres's own row-level locking
 * makes "only one caller wins" true without an application-level mutex or a
 * session-scoped advisory lock that a connection-pooled Prisma client
 * cannot safely hold across awaits.
 */

import type { PrismaClient } from "@signalpilot/database";

export const LeaseReasonCode = {
  ACQUIRED: "LEASE_ACQUIRED",
  HELD_BY_OTHER: "LEASE_HELD_BY_OTHER",
  LOST: "LEASE_LOST",
  RELEASED: "LEASE_RELEASED",
  NOT_OWNED: "LEASE_NOT_OWNED"
} as const;
export type LeaseReasonCode = (typeof LeaseReasonCode)[keyof typeof LeaseReasonCode];

/** One lease per job across the deployment — P5 runs a single trading worker. */
export const GLOBAL_LEASE_SCOPE = "GLOBAL";

export interface LeaseIdentity {
  readonly jobKey: string;
  readonly scopeKey: string;
  readonly ownerId: string;
}

export interface AcquireLeaseInput extends LeaseIdentity {
  readonly leaseDurationMs: number;
  readonly now: Date;
}

export type AcquireLeaseResult =
  | { readonly acquired: true; readonly version: number }
  | {
      readonly acquired: false;
      readonly reasonCode: LeaseReasonCode;
      readonly heldBy: string | null;
      readonly expiresAt: Date | null;
    };

/**
 * Acquire a lease if it is unclaimed or its previous claim has expired.
 * Never overwrites a still-valid claim held by a different owner —
 * "verwaiste Jobs sicher wiederaufnehmbar" applies only once a lease has
 * actually expired.
 */
export async function acquireLease(
  database: PrismaClient,
  input: AcquireLeaseInput
): Promise<AcquireLeaseResult> {
  const expiresAt = new Date(input.now.getTime() + input.leaseDurationMs);

  const existing = await database.tradingJobCursor.findUnique({
    where: { jobKey_scopeKey: { jobKey: input.jobKey, scopeKey: input.scopeKey } }
  });

  if (existing === null) {
    try {
      const created = await database.tradingJobCursor.create({
        data: {
          jobKey: input.jobKey,
          scopeKey: input.scopeKey,
          claimedBy: input.ownerId,
          claimedAt: input.now,
          claimExpiresAt: expiresAt
        }
      });
      return { acquired: true, version: created.version };
    } catch {
      // Lost the create race to a concurrent owner; fall through and try the
      // atomic update path below against the row that now exists.
    }
  }

  const updated = await database.tradingJobCursor.updateMany({
    where: {
      jobKey: input.jobKey,
      scopeKey: input.scopeKey,
      OR: [{ claimedBy: null }, { claimExpiresAt: { lt: input.now } }]
    },
    data: {
      claimedBy: input.ownerId,
      claimedAt: input.now,
      claimExpiresAt: expiresAt,
      version: { increment: 1 }
    }
  });

  if (updated.count === 1) {
    const row = await database.tradingJobCursor.findUnique({
      where: { jobKey_scopeKey: { jobKey: input.jobKey, scopeKey: input.scopeKey } }
    });
    return { acquired: true, version: row?.version ?? 0 };
  }

  const current = await database.tradingJobCursor.findUnique({
    where: { jobKey_scopeKey: { jobKey: input.jobKey, scopeKey: input.scopeKey } }
  });
  return {
    acquired: false,
    reasonCode: LeaseReasonCode.HELD_BY_OTHER,
    heldBy: current?.claimedBy ?? null,
    expiresAt: current?.claimExpiresAt ?? null
  };
}

export interface HeartbeatLeaseInput extends LeaseIdentity {
  readonly expectedVersion: number;
  readonly leaseDurationMs: number;
  readonly now: Date;
}

export type HeartbeatLeaseResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly reasonCode: LeaseReasonCode };

/**
 * Extend a lease this owner still holds. Only ever touches a row matching
 * both `claimedBy` and the expected `version`, so a heartbeat can never
 * extend a lease it does not currently own — including one it owned a
 * moment ago but that has since expired and been taken over by another
 * worker (docs/trading P5: "Heartbeat verlängert nur die eigene Lease").
 */
export async function heartbeatLease(
  database: PrismaClient,
  input: HeartbeatLeaseInput
): Promise<HeartbeatLeaseResult> {
  const updated = await database.tradingJobCursor.updateMany({
    where: {
      jobKey: input.jobKey,
      scopeKey: input.scopeKey,
      claimedBy: input.ownerId,
      version: input.expectedVersion
    },
    data: {
      claimExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
      version: { increment: 1 }
    }
  });
  if (updated.count === 0) {
    return { ok: false, reasonCode: LeaseReasonCode.LOST };
  }
  return { ok: true, version: input.expectedVersion + 1 };
}

export type ReleaseLeaseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: LeaseReasonCode };

/** Release a lease this owner still holds. A lost/expired lease is a no-op, not an error. */
export async function releaseLease(
  database: PrismaClient,
  identity: LeaseIdentity
): Promise<ReleaseLeaseResult> {
  const updated = await database.tradingJobCursor.updateMany({
    where: { jobKey: identity.jobKey, scopeKey: identity.scopeKey, claimedBy: identity.ownerId },
    data: { claimedBy: null, claimedAt: null, claimExpiresAt: null, version: { increment: 1 } }
  });
  return updated.count === 0
    ? { ok: false, reasonCode: LeaseReasonCode.NOT_OWNED }
    : { ok: true };
}

export interface JobLeaseContext {
  /** True once a heartbeat has detected the lease was lost to another owner. */
  isLeaseLost(): boolean;
}

export interface WithJobLeaseOptions {
  readonly jobKey: string;
  readonly scopeKey?: string;
  readonly ownerId: string;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly now?: () => Date;
}

export type WithJobLeaseResult<T> =
  | { readonly ran: true; readonly result: T }
  | { readonly ran: false; readonly reasonCode: LeaseReasonCode; readonly heldBy: string | null };

/**
 * Acquire a lease, run `fn` with a heartbeat renewing it in the background,
 * and always release or let it expire cleanly — never leaves a stale claim
 * behind on a normal return. If a heartbeat ever fails (lease lost to
 * another owner, most likely after this process stalled past its own lease
 * duration), `context.isLeaseLost()` flips to `true` so a job that processes
 * a list of independent items can stop claiming new work without aborting
 * mid-item.
 */
export async function withJobLease<T>(
  database: PrismaClient,
  options: WithJobLeaseOptions,
  fn: (context: JobLeaseContext) => Promise<T>
): Promise<WithJobLeaseResult<T>> {
  const scopeKey = options.scopeKey ?? GLOBAL_LEASE_SCOPE;
  const now = options.now ?? (() => new Date());

  const acquired = await acquireLease(database, {
    jobKey: options.jobKey,
    scopeKey,
    ownerId: options.ownerId,
    leaseDurationMs: options.leaseDurationMs,
    now: now()
  });
  if (!acquired.acquired) {
    return { ran: false, reasonCode: acquired.reasonCode, heldBy: acquired.heldBy };
  }

  let version = acquired.version;
  let leaseLost = false;

  const heartbeat = setInterval(() => {
    void heartbeatLease(database, {
      jobKey: options.jobKey,
      scopeKey,
      ownerId: options.ownerId,
      expectedVersion: version,
      leaseDurationMs: options.leaseDurationMs,
      now: now()
    }).then((result) => {
      if (result.ok) version = result.version;
      else leaseLost = true;
    });
  }, options.heartbeatIntervalMs);

  try {
    const result = await fn({ isLeaseLost: () => leaseLost });
    return { ran: true, result };
  } finally {
    clearInterval(heartbeat);
    if (!leaseLost) {
      await releaseLease(database, { jobKey: options.jobKey, scopeKey, ownerId: options.ownerId });
    }
  }
}
