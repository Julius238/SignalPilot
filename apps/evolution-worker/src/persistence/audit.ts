/**
 * Append-only, hash-chained audit trail of the research engine.
 *
 * Each event stores the hash of its predecessor; `verifyEvolutionAuditChain`
 * recomputes the chain. Appends are serialised with a transaction-scoped
 * advisory lock, so two writers can never fork the chain.
 */

import { canonicalHash } from "@signalpilot/trading-domain";

import type { EvolutionDb } from "../database.js";

export type EvolutionActorType = "SYSTEM" | "OPERATOR" | "AI";

export interface AuditEventInput {
  readonly eventKey: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly actorType: EvolutionActorType;
  readonly actorId?: string | null;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

type Tx = Parameters<Parameters<EvolutionDb["$transaction"]>[0]>[0];

const AUDIT_LOCK_KEY = 816_020_261; // arbitrary, unique to the evolution audit chain

/**
 * JSON round-trip with floats cut to 15 significant digits, so the hashed
 * payload equals what Postgres JSONB returns later (same rule as the arena's
 * evaluation chain).
 */
const normalise = (value: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value), (_key, entry: unknown) =>
    typeof entry === "number" && Number.isFinite(entry) && !Number.isInteger(entry) ? Number(entry.toPrecision(15)) : entry
  ) as Record<string, unknown>;

export function auditHash(event: {
  sequence: number;
  eventKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorType: string;
  actorId: string | null;
  payload: unknown;
  previousHash: string | null;
  occurredAt: string;
}): string {
  return canonicalHash({ chain: "evolution-audit-v1", ...event });
}

export async function appendAuditEvent(tx: Tx, input: AuditEventInput): Promise<{ id: string; hash: string; sequence: number } | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const existing = await tx.evolutionAuditEvent.findUnique({ where: { eventKey: input.eventKey } });
  if (existing !== null) return null;
  const previous = await tx.evolutionAuditEvent.findFirst({ orderBy: { sequence: "desc" } });
  const sequence = (previous?.sequence ?? 0) + 1;
  const payload = normalise(input.payload);
  const occurredAt = input.occurredAt.toISOString();
  const hash = auditHash({
    sequence,
    eventKey: input.eventKey,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    payload,
    previousHash: previous?.hash ?? null,
    occurredAt
  });
  const row = await tx.evolutionAuditEvent.create({
    data: {
      sequence,
      eventKey: input.eventKey,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      payloadJson: payload as never,
      previousHash: previous?.hash ?? null,
      hash,
      occurredAt: input.occurredAt
    }
  });
  return { id: row.id, hash, sequence };
}

/** Standalone append in its own transaction. */
export function recordAuditEvent(db: EvolutionDb, input: AuditEventInput) {
  return db.$transaction((tx) => appendAuditEvent(tx, input));
}

export async function verifyEvolutionAuditChain(db: EvolutionDb): Promise<{ ok: boolean; events: number; brokenAt: number | null }> {
  const events = await db.evolutionAuditEvent.findMany({ orderBy: { sequence: "asc" } });
  let previousHash: string | null = null;
  for (const event of events) {
    const expected = auditHash({
      sequence: event.sequence,
      eventKey: event.eventKey,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      actorType: event.actorType,
      actorId: event.actorId,
      payload: event.payloadJson,
      previousHash,
      occurredAt: event.occurredAt.toISOString()
    });
    if (event.previousHash !== previousHash || event.hash !== expected) return { ok: false, events: events.length, brokenAt: event.sequence };
    previousHash = event.hash;
  }
  return { ok: true, events: events.length, brokenAt: null };
}
