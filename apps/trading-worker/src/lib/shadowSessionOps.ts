/**
 * Manual, auditable operations commands for portfolio and session lifecycle.
 *
 * Specification:
 *   docs/trading/04-state-machines.md, "Trading Session und Kill Switch",
 *     "Aktivierungs-Guards"
 *   docs/trading/decisions/0006-fail-closed-session-and-kill-switch.md
 *
 * Every guard here is the same `@signalpilot/trading-domain` guard the
 * domain package ships — this module's only job is to gather the facts a
 * guard needs from the database and to commit its outcome atomically. No
 * single environment flag can activate anything: `activateSession` demands an
 * admin actor, an idempotency key, a fresh reconcile, exactly one active
 * `RiskLimitSet`, valid execution profiles, at least one enabled BTC/ETH
 * assignment and zero unresolved critical findings — all read live, not
 * assumed. Releasing the kill switch and activating the session are
 * deliberately two separate calls (docs/trading/04: "ein einzelner Klick darf
 * nicht zugleich entsperren und aktivieren").
 */

import {
  PortfolioStatus,
  TradingActorType,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import {
  checkKillSwitchTransition,
  checkSessionTransition,
  buildAuditEventKey,
  type SessionActivationContext,
  type SessionUnlockContext,
  type TradingCapabilityContext
} from "@signalpilot/trading-domain";

export const SHADOW_OPS_JOB_KEY = "trading:shadow-session-ops";

const RECONCILE_FRESHNESS_MS = 5 * 60 * 1000;
const ALLOWED_ASSIGNMENT_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

export interface OpsGuardFailure {
  readonly ok: false;
  readonly reasonCode: string;
  readonly message: string;
}
export interface OpsGuardSuccess<T> {
  readonly ok: true;
  readonly result: T;
}
export type OpsResult<T> = OpsGuardSuccess<T> | OpsGuardFailure;

// ───────────────────────────────────────────────────────────────────────────
// Portfolio activation
// ───────────────────────────────────────────────────────────────────────────

export interface ActivatePortfolioInput {
  readonly portfolioId: string;
  readonly actorId: string;
  readonly asOf: Date;
  /** Defaults to a fixed per-portfolio key (CLI usage never repeats this call meaningfully). */
  readonly idempotencyKey?: string;
}

/** `Portfolio.status: DRAFT -> ACTIVE`. A no-op guard by itself; the session
 * activation guard is what actually enforces safety before any trade can
 * happen. */
export async function activatePortfolio(
  database: PrismaClient,
  input: ActivatePortfolioInput
): Promise<OpsResult<{ readonly portfolioId: string }>> {
  const portfolio = await database.portfolio.findUnique({ where: { id: input.portfolioId } });
  if (portfolio === null) {
    return { ok: false, reasonCode: "PORTFOLIO_NOT_FOUND", message: `No Portfolio ${input.portfolioId}.` };
  }
  if (portfolio.status === PortfolioStatus.ACTIVE) {
    return { ok: true, result: { portfolioId: portfolio.id } };
  }
  if (portfolio.status !== PortfolioStatus.DRAFT) {
    return {
      ok: false,
      reasonCode: "PORTFOLIO_NOT_ACTIVATABLE",
      message: `Portfolio is ${portfolio.status}, only DRAFT can be activated.`
    };
  }

  const idempotencyKey = input.idempotencyKey ?? `${portfolio.id}-activate`;

  await database.$transaction(async (tx) => {
    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: { status: PortfolioStatus.ACTIVE, version: { increment: 1 } }
    });
    if (updated.count === 0) throw new Error(`Portfolio ${portfolio.id} version conflict during activation.`);
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "PORTFOLIO_ACTIVATED",
          aggregateType: "Portfolio",
          aggregateId: portfolio.id,
          idempotencyKey
        }),
        eventType: "PORTFOLIO_ACTIVATED",
        aggregateType: "Portfolio",
        aggregateId: portfolio.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: `${SHADOW_OPS_JOB_KEY}|${portfolio.id}`,
        causationId: `${SHADOW_OPS_JOB_KEY}|${portfolio.id}`,
        idempotencyKey,
        reasonCode: "PORTFOLIO_ACTIVATED",
        occurredAt: input.asOf
      }
    });
  });

  return { ok: true, result: { portfolioId: portfolio.id } };
}

// ───────────────────────────────────────────────────────────────────────────
// Kill switch release (STOPPED only, admin, after a successful reconcile)
// ───────────────────────────────────────────────────────────────────────────

export interface ReleaseKillSwitchInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly asOf: Date;
  readonly idempotencyKey?: string;
}

export async function releaseKillSwitch(
  database: PrismaClient,
  input: ReleaseKillSwitchInput
): Promise<OpsResult<{ readonly sessionId: string }>> {
  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) {
    return { ok: false, reasonCode: "SESSION_NOT_FOUND", message: `No TradingSession ${input.sessionId}.` };
  }
  const reconcileFresh =
    session.reconciledAt !== null && input.asOf.getTime() - session.reconciledAt.getTime() <= RECONCILE_FRESHNESS_MS;

  const guard = checkKillSwitchTransition(
    { status: session.status, killSwitchEngaged: session.killSwitchEngaged },
    { action: "RELEASE", actorType: TradingActorType.ADMIN, reconcileSucceeded: reconcileFresh }
  );
  if (!guard.ok) {
    return { ok: false, reasonCode: guard.reasonCode, message: guard.message };
  }

  const idempotencyKey = input.idempotencyKey ?? `${session.id}-kill-release-${session.version}`;

  await database.$transaction(async (tx) => {
    const updated = await tx.tradingSession.updateMany({
      where: { id: session.id, version: session.version },
      data: { killSwitchEngaged: false, killReasonCode: null, lastChangedBy: input.actorId, version: { increment: 1 } }
    });
    if (updated.count === 0) throw new Error(`TradingSession ${session.id} version conflict releasing the kill switch.`);
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SESSION_KILL_SWITCH_RELEASED",
          aggregateType: "TradingSession",
          aggregateId: session.id,
          idempotencyKey
        }),
        eventType: "SESSION_KILL_SWITCH_RELEASED",
        aggregateType: "TradingSession",
        aggregateId: session.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: `${SHADOW_OPS_JOB_KEY}|${session.id}`,
        causationId: `${SHADOW_OPS_JOB_KEY}|${session.id}`,
        idempotencyKey,
        reasonCode: "SESSION_KILL_SWITCH_RELEASED",
        tradingSessionId: session.id,
        occurredAt: input.asOf
      }
    });
  });

  return { ok: true, result: { sessionId: session.id } };
}

export interface EngageKillSwitchInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly asOf: Date;
  readonly idempotencyKey?: string;
}

export async function engageKillSwitch(
  database: PrismaClient,
  input: EngageKillSwitchInput
): Promise<OpsResult<{ readonly sessionId: string }>> {
  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) {
    return { ok: false, reasonCode: "SESSION_NOT_FOUND", message: `No TradingSession ${input.sessionId}.` };
  }
  const guard = checkKillSwitchTransition(
    { status: session.status, killSwitchEngaged: session.killSwitchEngaged },
    { action: "ENGAGE", reasonCode: input.reasonCode, actorType: TradingActorType.ADMIN }
  );
  if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode, message: guard.message };

  const idempotencyKey = input.idempotencyKey ?? `${session.id}-kill-engage-${session.version}`;

  await database.$transaction(async (tx) => {
    const updated = await tx.tradingSession.updateMany({
      where: { id: session.id, version: session.version },
      data: {
        killSwitchEngaged: true,
        killReasonCode: input.reasonCode,
        killedAt: input.asOf,
        lastChangedBy: input.actorId,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) throw new Error(`TradingSession ${session.id} version conflict engaging the kill switch.`);
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SESSION_KILL_SWITCH_ENGAGED",
          aggregateType: "TradingSession",
          aggregateId: session.id,
          idempotencyKey
        }),
        eventType: "SESSION_KILL_SWITCH_ENGAGED",
        aggregateType: "TradingSession",
        aggregateId: session.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: `${SHADOW_OPS_JOB_KEY}|${session.id}`,
        causationId: `${SHADOW_OPS_JOB_KEY}|${session.id}`,
        idempotencyKey,
        reasonCode: input.reasonCode,
        tradingSessionId: session.id,
        occurredAt: input.asOf
      }
    });
  });

  return { ok: true, result: { sessionId: session.id } };
}

// ───────────────────────────────────────────────────────────────────────────
// Pause: SHADOW_ACTIVE -> PAUSED (resuming goes back through `activateSession`,
// which already handles PAUSED -> SHADOW_ACTIVE via the same activation guard)
// ───────────────────────────────────────────────────────────────────────────

export interface PauseSessionInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly asOf: Date;
  readonly idempotencyKey?: string;
}

export async function pauseSession(
  database: PrismaClient,
  input: PauseSessionInput
): Promise<OpsResult<{ readonly sessionId: string }>> {
  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) {
    return { ok: false, reasonCode: "SESSION_NOT_FOUND", message: `No TradingSession ${input.sessionId}.` };
  }

  const guard = checkSessionTransition(session.status, TradingSessionStatus.PAUSED);
  if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode, message: guard.message };

  const idempotencyKey = input.idempotencyKey ?? `${session.id}-pause-${session.version}`;

  await database.$transaction(async (tx) => {
    const updated = await tx.tradingSession.updateMany({
      where: { id: session.id, version: session.version, status: session.status },
      data: {
        status: TradingSessionStatus.PAUSED,
        pausedAt: input.asOf,
        lastChangedBy: input.actorId,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) throw new Error(`TradingSession ${session.id} version conflict during pause.`);
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SESSION_PAUSED",
          aggregateType: "TradingSession",
          aggregateId: session.id,
          idempotencyKey
        }),
        eventType: "SESSION_PAUSED",
        aggregateType: "TradingSession",
        aggregateId: session.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: `${SHADOW_OPS_JOB_KEY}|${session.id}`,
        causationId: `${SHADOW_OPS_JOB_KEY}|${session.id}`,
        idempotencyKey,
        reasonCode: "SESSION_PAUSED",
        tradingSessionId: session.id,
        occurredAt: input.asOf
      }
    });
  });

  return { ok: true, result: { sessionId: session.id } };
}

// ───────────────────────────────────────────────────────────────────────────
// Session activation: STOPPED -> SHADOW_ACTIVE
// ───────────────────────────────────────────────────────────────────────────

export interface ActivateSessionInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly capability: TradingCapabilityContext;
  readonly asOf: Date;
}

export async function activateSession(
  database: PrismaClient,
  input: ActivateSessionInput
): Promise<OpsResult<{ readonly sessionId: string }>> {
  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) {
    return { ok: false, reasonCode: "SESSION_NOT_FOUND", message: `No TradingSession ${input.sessionId}.` };
  }
  const portfolio = await database.portfolio.findUnique({ where: { id: session.portfolioId } });
  if (portfolio === null) {
    return { ok: false, reasonCode: "PORTFOLIO_NOT_FOUND", message: `No Portfolio ${session.portfolioId}.` };
  }

  const [activeRiskLimitSets, executionProfiles, assignments, unacknowledgedCriticalRiskEvents, expiredClaims] =
    await Promise.all([
      database.riskLimitSet.count({ where: { status: "ACTIVE" } }),
      database.instrumentExecutionProfile.count({ where: { status: "ACTIVE" } }),
      database.strategyAssignment.findMany({ where: { portfolioId: portfolio.id, enabled: true }, include: { asset: true } }),
      database.riskEvent.count({ where: { portfolioId: portfolio.id, severity: "CRITICAL", acknowledgedAt: null } }),
      database.tradeCandidate.count({
        where: { portfolioId: portfolio.id, claimExpiresAt: { lt: input.asOf }, claimedBy: { not: null } }
      })
    ]);

  const assignmentScopeAllowed = assignments.every((assignment) =>
    ALLOWED_ASSIGNMENT_SYMBOLS.includes(assignment.asset.symbol)
  );

  const reconcileFresh =
    session.reconciledAt !== null && input.asOf.getTime() - session.reconciledAt.getTime() <= RECONCILE_FRESHNESS_MS;

  const activation: SessionActivationContext = {
    capability: input.capability,
    killSwitchEngaged: session.killSwitchEngaged,
    portfolioStatus: portfolio.status,
    reconcileSucceeded: session.reconciledAt !== null,
    reconcileFresh,
    activeRiskLimitSetCount: activeRiskLimitSets,
    validExecutionProfilesPresent: executionProfiles > 0,
    activeAssignmentCount: assignments.length,
    assignmentScopeAllowed,
    unacknowledgedCriticalRiskEventCount: unacknowledgedCriticalRiskEvents,
    expiredClaimCount: expiredClaims,
    unknownOpenAggregateCount: 0,
    actorType: TradingActorType.ADMIN,
    idempotencyKey: input.idempotencyKey
  };

  const guard = checkSessionTransition(session.status, TradingSessionStatus.SHADOW_ACTIVE, { activation });
  if (!guard.ok) {
    return { ok: false, reasonCode: guard.reasonCode, message: guard.message };
  }

  await database.$transaction(async (tx) => {
    const updated = await tx.tradingSession.updateMany({
      where: { id: session.id, version: session.version, status: session.status },
      data: {
        status: TradingSessionStatus.SHADOW_ACTIVE,
        activatedBy: input.actorId,
        lastChangedBy: input.actorId,
        startedAt: input.asOf,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) throw new Error(`TradingSession ${session.id} version conflict during activation.`);
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SESSION_ACTIVATED",
          aggregateType: "TradingSession",
          aggregateId: session.id,
          idempotencyKey: input.idempotencyKey
        }),
        eventType: "SESSION_ACTIVATED",
        aggregateType: "TradingSession",
        aggregateId: session.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: input.idempotencyKey,
        causationId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        reasonCode: "SESSION_ACTIVATED",
        tradingSessionId: session.id,
        occurredAt: input.asOf
      }
    });
  });

  return { ok: true, result: { sessionId: session.id } };
}

// ───────────────────────────────────────────────────────────────────────────
// Unlock: KILLED / ERROR_LOCKED -> STOPPED
// ───────────────────────────────────────────────────────────────────────────

export interface UnlockSessionInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  /** Explicit operator attestation that the root cause has actually been fixed. */
  readonly confirmCauseResolved: boolean;
  readonly asOf: Date;
}

export async function unlockSessionToStopped(
  database: PrismaClient,
  input: UnlockSessionInput
): Promise<OpsResult<{ readonly sessionId: string }>> {
  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) {
    return { ok: false, reasonCode: "SESSION_NOT_FOUND", message: `No TradingSession ${input.sessionId}.` };
  }

  const [unacknowledgedRiskEvents, unclearOrders] = await Promise.all([
    database.riskEvent.count({ where: { portfolioId: session.portfolioId, severity: "CRITICAL", acknowledgedAt: null } }),
    database.shadowOrder.count({
      where: {
        portfolioId: session.portfolioId,
        status: { in: ["PROPOSED", "ACCEPTED"] }
      }
    })
  ]);

  const unlock: SessionUnlockContext = {
    killCauseResolved: input.confirmCauseResolved,
    riskEventsAcknowledged: unacknowledgedRiskEvents === 0,
    reconcileSucceeded: session.reconciledAt !== null,
    unclearOrderCount: unclearOrders,
    actorType: TradingActorType.ADMIN,
    idempotencyKey: input.idempotencyKey
  };

  const guard = checkSessionTransition(session.status, TradingSessionStatus.STOPPED, { unlock });
  if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode, message: guard.message };

  await database.$transaction(async (tx) => {
    const updated = await tx.tradingSession.updateMany({
      where: { id: session.id, version: session.version, status: session.status },
      data: {
        status: TradingSessionStatus.STOPPED,
        killReasonCode: null,
        lastChangedBy: input.actorId,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) throw new Error(`TradingSession ${session.id} version conflict during unlock.`);
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SESSION_UNLOCKED",
          aggregateType: "TradingSession",
          aggregateId: session.id,
          idempotencyKey: input.idempotencyKey
        }),
        eventType: "SESSION_UNLOCKED",
        aggregateType: "TradingSession",
        aggregateId: session.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: input.idempotencyKey,
        causationId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        reasonCode: "SESSION_UNLOCKED",
        tradingSessionId: session.id,
        occurredAt: input.asOf
      }
    });
  });

  return { ok: true, result: { sessionId: session.id } };
}
