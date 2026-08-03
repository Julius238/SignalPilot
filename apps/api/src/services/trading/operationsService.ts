/**
 * Orchestration behind every `/trading/operations/*` route: idempotency
 * replay, the caller's expected entity version, then the actual P4/P5
 * operation. Kept out of the route handlers entirely (P6 task: "Verwende
 * die vorhandenen P4/P5 Services. Geschäftslogik nicht in den Route
 * Handlern duplizieren.").
 *
 * `run-job`'s allowlist is intentionally a fixed, exhaustive map from a
 * literal job name to one of `apps/trading-worker`'s existing `run*`
 * functions — never a free-form command or shell argument (P6 task,
 * "run-job darf nur eine feste Allowlist ... unterstützen").
 */

import {
  TradingBuildCapability,
  TradingMode,
  buildAuditEventKey,
  type TradingCapabilityContext
} from "@signalpilot/trading-domain";
import { TradingActorType, prisma, type PrismaClient } from "@signalpilot/database";
import {
  activatePortfolio,
  activateSession,
  engageKillSwitch,
  pauseSession,
  releaseKillSwitch,
  unlockSessionToStopped
} from "@signalpilot/trading-worker/lib/shadowSessionOps";
import { requestManualRiskClose } from "@signalpilot/trading-worker/lib/manualRiskClose";
import { checkShadowBaseAllowed } from "@signalpilot/trading-worker/lib/tradingSafety";
import { runShadowAssessRisk } from "@signalpilot/trading-worker/jobs/shadowAssessRisk";
import { runShadowCreateOrders } from "@signalpilot/trading-worker/jobs/shadowCreateOrders";
import { runShadowGenerateCandidates } from "@signalpilot/trading-worker/jobs/shadowGenerateCandidates";
import { runShadowMonitorPositions } from "@signalpilot/trading-worker/jobs/shadowMonitorPositions";
import { runShadowProcessFills } from "@signalpilot/trading-worker/jobs/shadowProcessFills";
import { runShadowReconcilePortfolio } from "@signalpilot/trading-worker/jobs/shadowReconcilePortfolio";
import { runShadowStartTradingDay } from "@signalpilot/trading-worker/jobs/shadowStartTradingDay";
import { runShadowAlertOutbox } from "@signalpilot/trading-worker/jobs/shadowAlertOutbox";
import { runShadowPerformanceRefresh } from "@signalpilot/trading-worker/jobs/shadowPerformanceRefresh";
import { runShadowRetention } from "@signalpilot/trading-worker/jobs/shadowRetention";

import { findIdempotentReplay } from "./idempotency.js";

export type OperationOutcome<T> =
  | { readonly kind: "replayed"; readonly result: T }
  | { readonly kind: "executed"; readonly result: T }
  | { readonly kind: "not_found"; readonly message: string }
  | {
      readonly kind: "version_conflict";
      readonly currentVersion: number;
      readonly expectedVersion: number;
      readonly entityId: string;
    }
  | { readonly kind: "guard_failed"; readonly reasonCode: string; readonly message: string };

function capabilityFromEnv(): TradingCapabilityContext | null {
  const base = checkShadowBaseAllowed(process.env);
  if (!base.allowed) return null;
  return {
    buildCapability: TradingBuildCapability.SHADOW_ONLY,
    tradingMode: base.flags.tradingMode as (typeof TradingMode)[keyof typeof TradingMode],
    enableLiveTrading: base.flags.enableLiveTrading,
    shadowMasterFlagEnabled: base.flags.shadowEnabled
  };
}

export interface ActivatePortfolioOperationInput {
  readonly portfolioId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly expectedVersion: number;
  readonly asOf: Date;
}

export async function activatePortfolioOperation(
  database: PrismaClient,
  input: ActivatePortfolioOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "Portfolio", input.idempotencyKey, input.portfolioId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const portfolio = await database.portfolio.findUnique({ where: { id: input.portfolioId } });
  if (portfolio === null) return { kind: "not_found", message: `No Portfolio ${input.portfolioId}.` };
  if (portfolio.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: portfolio.version,
      expectedVersion: input.expectedVersion,
      entityId: input.portfolioId
    };
  }

  const result = await activatePortfolio(database, {
    portfolioId: input.portfolioId,
    actorId: input.actorId,
    asOf: input.asOf,
    idempotencyKey: input.idempotencyKey
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result: result.result };
}

export interface SessionOperationInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly expectedVersion: number;
  readonly asOf: Date;
}

export async function releaseKillSwitchOperation(
  database: PrismaClient,
  input: SessionOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "TradingSession", input.idempotencyKey, input.sessionId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) return { kind: "not_found", message: `No TradingSession ${input.sessionId}.` };
  if (session.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: session.version,
      expectedVersion: input.expectedVersion,
      entityId: input.sessionId
    };
  }

  const result = await releaseKillSwitch(database, {
    sessionId: input.sessionId,
    actorId: input.actorId,
    asOf: input.asOf,
    idempotencyKey: input.idempotencyKey
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result: result.result };
}

export async function activateSessionOperation(
  database: PrismaClient,
  input: SessionOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "TradingSession", input.idempotencyKey, input.sessionId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) return { kind: "not_found", message: `No TradingSession ${input.sessionId}.` };
  if (session.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: session.version,
      expectedVersion: input.expectedVersion,
      entityId: input.sessionId
    };
  }

  const capability = capabilityFromEnv();
  if (capability === null) {
    return { kind: "guard_failed", reasonCode: "CONFIG_INVALID", message: "Shadow-only base configuration is not satisfied." };
  }

  const result = await activateSession(database, {
    sessionId: input.sessionId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    capability,
    asOf: input.asOf
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result: result.result };
}

export async function pauseSessionOperation(
  database: PrismaClient,
  input: SessionOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "TradingSession", input.idempotencyKey, input.sessionId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) return { kind: "not_found", message: `No TradingSession ${input.sessionId}.` };
  if (session.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: session.version,
      expectedVersion: input.expectedVersion,
      entityId: input.sessionId
    };
  }

  const result = await pauseSession(database, {
    sessionId: input.sessionId,
    actorId: input.actorId,
    asOf: input.asOf,
    idempotencyKey: input.idempotencyKey
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result: result.result };
}

export interface EngageKillSwitchOperationInput extends SessionOperationInput {
  readonly reasonCode: string;
}

export async function engageKillSwitchOperation(
  database: PrismaClient,
  input: EngageKillSwitchOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "TradingSession", input.idempotencyKey, input.sessionId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) return { kind: "not_found", message: `No TradingSession ${input.sessionId}.` };
  if (session.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: session.version,
      expectedVersion: input.expectedVersion,
      entityId: input.sessionId
    };
  }

  const result = await engageKillSwitch(database, {
    sessionId: input.sessionId,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
    asOf: input.asOf,
    idempotencyKey: input.idempotencyKey
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result: result.result };
}

export interface UnlockSessionOperationInput extends SessionOperationInput {
  readonly confirmCauseResolved: boolean;
}

export async function unlockSessionOperation(
  database: PrismaClient,
  input: UnlockSessionOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "TradingSession", input.idempotencyKey, input.sessionId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const session = await database.tradingSession.findUnique({ where: { id: input.sessionId } });
  if (session === null) return { kind: "not_found", message: `No TradingSession ${input.sessionId}.` };
  if (session.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: session.version,
      expectedVersion: input.expectedVersion,
      entityId: input.sessionId
    };
  }

  const result = await unlockSessionToStopped(database, {
    sessionId: input.sessionId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    confirmCauseResolved: input.confirmCauseResolved,
    asOf: input.asOf
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result: result.result };
}

export interface ManualRiskCloseOperationInput {
  readonly shadowPositionId: string;
  readonly actorId: string;
  readonly reasonNote: string;
  readonly idempotencyKey: string;
  readonly expectedVersion: number;
  readonly asOf: Date;
}

export async function manualRiskCloseOperation(
  database: PrismaClient,
  input: ManualRiskCloseOperationInput
): Promise<OperationOutcome<unknown>> {
  const replay = await findIdempotentReplay(database, "ShadowPosition", input.idempotencyKey, input.shadowPositionId);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const position = await database.shadowPosition.findUnique({ where: { id: input.shadowPositionId } });
  if (position === null) return { kind: "not_found", message: `No ShadowPosition ${input.shadowPositionId}.` };
  if (position.version !== input.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: position.version,
      expectedVersion: input.expectedVersion,
      entityId: input.shadowPositionId
    };
  }

  const result = await requestManualRiskClose(database, {
    shadowPositionId: input.shadowPositionId,
    actorId: input.actorId,
    reasonNote: input.reasonNote,
    idempotencyKey: input.idempotencyKey,
    asOf: input.asOf
  });
  if (!result.ok) return { kind: "guard_failed", reasonCode: result.reasonCode, message: result.message };
  return { kind: "executed", result };
}

export const RUN_JOB_ALLOWLIST = [
  "shadow-start-trading-day",
  "shadow-generate-candidates",
  "shadow-assess-risk",
  "shadow-create-orders",
  "shadow-process-fills",
  "shadow-monitor-positions",
  "shadow-reconcile-portfolio",
  // P8 jobs. Each still enforces its own feature flag internally, so being on
  // the allowlist does not make it runnable — it only makes it triggerable.
  // `shadow-retention` is reachable in DRY-RUN form only: the operations API
  // never passes `apply`, so this route cannot delete a row (P8, "8.
  // Retention": "Keine produktive Löschung ohne klaren Dry-Run und eigene
  // Aktivierung" — applying stays a deliberate CLI action).
  "shadow-performance-refresh",
  "shadow-alert-outbox",
  "shadow-retention"
] as const;
export type AllowlistedJobName = (typeof RUN_JOB_ALLOWLIST)[number];

const JOB_RUNNERS: Readonly<Record<AllowlistedJobName, (database: PrismaClient, options: { asOf: Date }) => Promise<unknown>>> =
  {
    "shadow-start-trading-day": runShadowStartTradingDay,
    "shadow-generate-candidates": runShadowGenerateCandidates,
    "shadow-assess-risk": runShadowAssessRisk,
    "shadow-create-orders": runShadowCreateOrders,
    "shadow-process-fills": runShadowProcessFills,
    "shadow-monitor-positions": runShadowMonitorPositions,
    "shadow-reconcile-portfolio": runShadowReconcilePortfolio,
    "shadow-performance-refresh": runShadowPerformanceRefresh,
    "shadow-alert-outbox": runShadowAlertOutbox,
    "shadow-retention": (database, options) => runShadowRetention(database, { ...options, apply: false })
  };

export function isAllowlistedJobName(value: string): value is AllowlistedJobName {
  return (RUN_JOB_ALLOWLIST as readonly string[]).includes(value);
}

export interface RunJobOperationInput {
  readonly jobName: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly asOf: Date;
}

/**
 * Triggers one allowlisted job immediately (database = prisma, options =
 * `{ asOf }`, matching exactly how `apps/trading-worker`'s own scheduler
 * calls it) and records a `TradingAuditEvent` for the manual trigger itself.
 * The job's own `BotRun`/`BotLog` bookkeeping is untouched — this only adds
 * an operator-attributable audit trail on top.
 */
export async function runJobOperation(
  database: PrismaClient,
  input: RunJobOperationInput
): Promise<OperationOutcome<unknown>> {
  if (!isAllowlistedJobName(input.jobName)) {
    return {
      kind: "guard_failed",
      reasonCode: "JOB_NOT_ALLOWLISTED",
      message: `${input.jobName} is not one of: ${RUN_JOB_ALLOWLIST.join(", ")}.`
    };
  }

  const replay = await findIdempotentReplay(database, "ManualJobRun", input.idempotencyKey, input.jobName);
  if (replay !== null) return { kind: "replayed", result: replay.afterState };

  const runner = JOB_RUNNERS[input.jobName];
  const summary = await runner(database, { asOf: input.asOf });

  await database.tradingAuditEvent.create({
    data: {
      eventKey: buildAuditEventKey({
        eventType: "MANUAL_JOB_RUN_TRIGGERED",
        aggregateType: "ManualJobRun",
        aggregateId: input.jobName,
        idempotencyKey: input.idempotencyKey
      }),
      eventType: "MANUAL_JOB_RUN_TRIGGERED",
      aggregateType: "ManualJobRun",
      aggregateId: input.jobName,
      actorType: TradingActorType.ADMIN,
      actorId: input.actorId,
      correlationId: input.idempotencyKey,
      causationId: input.idempotencyKey,
      idempotencyKey: input.idempotencyKey,
      reasonCode: "MANUAL_JOB_RUN_TRIGGERED",
      afterState: summary as never,
      occurredAt: input.asOf
    }
  });

  return { kind: "executed", result: summary };
}

export { prisma };
