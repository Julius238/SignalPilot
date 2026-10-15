/**
 * The research agent's switch (ACTIVE / PAUSED / PAUSED_BUDGET / DISABLED)
 * and its run lease. The lease is a single atomic UPDATE on the singleton
 * row, so at most one research cycle runs at a time across processes.
 */

import type { EvolutionDb } from "../database.js";
import { recordAuditEvent } from "./audit.js";

export const AGENT_KEY = "EVOLUTION_V1";

export type AgentStatus = "ACTIVE" | "PAUSED" | "PAUSED_BUDGET" | "DISABLED";

export async function ensureAgentState(db: EvolutionDb, actor = "system") {
  const existing = await db.evolutionAgentState.findUnique({ where: { key: AGENT_KEY } });
  if (existing !== null) return existing;
  // A new installation starts PAUSED: research begins only after the operator resumes it.
  return db.evolutionAgentState.upsert({
    where: { key: AGENT_KEY },
    create: { key: AGENT_KEY, status: "PAUSED", statusReason: "Neu angelegt; startet erst nach `resume`.", updatedBy: actor },
    update: {}
  });
}

export async function setAgentStatus(
  db: EvolutionDb,
  input: { status: AgentStatus; reason: string; actor: string; actorType: "SYSTEM" | "OPERATOR"; pausedUntil?: Date | null; now: Date }
) {
  const before = await ensureAgentState(db, input.actor);
  const after = await db.evolutionAgentState.update({
    where: { key: AGENT_KEY },
    data: {
      status: input.status,
      statusReason: input.reason,
      pausedUntil: input.pausedUntil ?? null,
      updatedBy: input.actor,
      version: { increment: 1 }
    }
  });
  await recordAuditEvent(db, {
    eventKey: `agent:${after.version}:${input.status}`,
    eventType: "AGENT_STATUS_CHANGED",
    aggregateType: "EvolutionAgentState",
    aggregateId: AGENT_KEY,
    actorType: input.actorType,
    actorId: input.actor,
    payload: { from: before.status, to: input.status, reason: input.reason, pausedUntil: input.pausedUntil?.toISOString() ?? null },
    occurredAt: input.now
  });
  return after;
}

/** A budget pause ends by itself once its month is over. */
export async function releaseExpiredBudgetPause(db: EvolutionDb, now: Date): Promise<boolean> {
  const state = await ensureAgentState(db);
  if (state.status !== "PAUSED_BUDGET" || state.pausedUntil === null || state.pausedUntil > now) return false;
  await setAgentStatus(db, { status: "ACTIVE", reason: "Neuer Budgetmonat begonnen.", actor: "system", actorType: "SYSTEM", now });
  return true;
}

export async function acquireRunLease(db: EvolutionDb, owner: string, now: Date, leaseMs: number): Promise<boolean> {
  await ensureAgentState(db);
  const expires = new Date(now.getTime() + leaseMs);
  const claimed = await db.$executeRaw`
    UPDATE "EvolutionAgentState"
    SET "leaseOwner" = ${owner}, "leaseExpiresAt" = ${expires}, "updatedAt" = ${now}
    WHERE "key" = ${AGENT_KEY} AND ("leaseOwner" IS NULL OR "leaseExpiresAt" IS NULL OR "leaseExpiresAt" < ${now})`;
  return claimed === 1;
}

export async function releaseRunLease(db: EvolutionDb, owner: string, update: { lastRunAt?: Date; nextRunAt?: Date | null } = {}): Promise<void> {
  await db.evolutionAgentState.updateMany({
    where: { key: AGENT_KEY, leaseOwner: owner },
    data: { leaseOwner: null, leaseExpiresAt: null, ...(update.lastRunAt ? { lastRunAt: update.lastRunAt } : {}), ...(update.nextRunAt !== undefined ? { nextRunAt: update.nextRunAt } : {}) }
  });
}
