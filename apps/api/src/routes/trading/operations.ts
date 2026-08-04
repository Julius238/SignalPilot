/**
 * `/trading/operations/*` — the only routes in this app that can mutate
 * shadow trading state. Registered only when `resolveTradingApiConfig()`
 * reports `operationsEnabled` (see `server.ts`), on top of every route's own
 * `requireTradingOperator` + `requireTradingCsrf` preHandlers and a stricter
 * per-route rate limit than the app's global default.
 *
 * Every route follows the same shape: parse+validate the request, apply the
 * confirmation/idempotency/version guards, delegate to
 * `services/trading/operationsService.ts`, translate its outcome to HTTP,
 * and write both the domain `TradingAuditEvent` (already handled inside the
 * service, reusing the exact P4/P5 ops functions) and this app's generic
 * `AuditLog` access trail (`auth/audit.ts`, same convention every other
 * mutating route in this app already follows).
 */

import { prisma, type PrismaClient } from "@signalpilot/database";
import type { FastifyInstance, FastifyReply } from "fastify";

import { extractRequestContext, logAudit } from "../../auth/audit.js";
import { getSessionPayload } from "../../auth/helpers.js";
import {
  activatePortfolioOperation,
  activateSessionOperation,
  engageKillSwitchOperation,
  manualRiskCloseOperation,
  pauseSessionOperation,
  releaseKillSwitchOperation,
  runJobOperation,
  setAssignmentOperation,
  unlockSessionOperation,
  type OperationOutcome
} from "../../services/trading/operationsService.js";
import { issueTradingCsrfToken, requireTradingCsrf } from "./csrf.js";
import { asBodyRecord, conflict, notFound } from "./http.js";
import {
  requireConfirmation,
  requireExpectedVersion,
  requireIdempotencyKey
} from "./operationGuards.js";
import { requireTradingOperator } from "./operatorAuth.js";

let database: PrismaClient = prisma;

export function setTradingOperationsDatabaseForTests(db: PrismaClient): void {
  database = db;
}

const OPERATIONS_RATE_LIMIT = {
  max: Number(process.env.TRADING_API_OPERATIONS_RATE_LIMIT_MAX ?? 20),
  timeWindow: "1 minute"
} as const;

async function resolveActorId(
  request: Parameters<typeof getSessionPayload>[0]
): Promise<string> {
  const payload = await getSessionPayload(request);
  return payload?.username ?? process.env.ADMIN_USERNAME ?? "admin";
}

function respondToOutcome(
  reply: FastifyReply,
  outcome: OperationOutcome<unknown>,
  notFoundEntity: string
) {
  switch (outcome.kind) {
    case "replayed":
      return reply.code(200).send({ replayed: true, result: outcome.result });
    case "executed":
      return reply.code(200).send({ replayed: false, result: outcome.result });
    case "not_found":
      return notFound(reply, outcome.message || `${notFoundEntity} not found.`);
    case "version_conflict":
      // P8, "5.": "Ergänze strukturierte `currentVersion`-Informationen bei
      // API-409-Konflikten." The prose message stays for humans, but a client
      // must not have to regex it out of a sentence to recover.
      return conflict(
        reply,
        `Current version is ${outcome.currentVersion}. Reload and retry with the current version.`,
        {
          reasonCode: "VERSION_CONFLICT",
          currentVersion: outcome.currentVersion,
          entityType: notFoundEntity,
          entityId: outcome.entityId ?? null,
          expectedVersion: outcome.expectedVersion
        }
      );
    case "guard_failed":
      return reply
        .code(422)
        .send({
          error: "Unprocessable Entity",
          reasonCode: outcome.reasonCode,
          message: outcome.message
        });
    default:
      return reply
        .code(500)
        .send({
          error: "Internal Server Error",
          message: "Unknown operation outcome."
        });
  }
}

export async function registerTradingOperationsRoutes(server: FastifyInstance) {
  server.get(
    "/trading/csrf-token",
    { preHandler: requireTradingOperator },
    async (_request, reply) => {
      const token = issueTradingCsrfToken(reply);
      return { csrfToken: token };
    }
  );

  const preHandler = [requireTradingOperator, requireTradingCsrf];

  server.post(
    "/trading/operations/set-assignment",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const assignmentId =
        typeof body.assignmentId === "string" ? body.assignmentId : undefined;
      const confirmation =
        typeof body.confirm === "string" ? body.confirm : undefined;
      const enabled = body.enabled;
      if (!assignmentId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "assignmentId is required" });
      if (enabled !== true && enabled !== false) {
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "enabled must be a boolean" });
      }
      if (!confirmation)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "confirm is required" });
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await setAssignmentOperation(database, {
        assignmentId,
        actorId,
        enabled,
        confirmation,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: enabled
          ? "trading_enable_assignment"
          : "trading_disable_assignment",
        actor: actorId,
        targetType: "StrategyAssignment",
        targetId: assignmentId,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "StrategyAssignment");
    }
  );

  server.post(
    "/trading/operations/activate-portfolio",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const portfolioId =
        typeof body.portfolioId === "string" ? body.portfolioId : undefined;
      if (!portfolioId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "portfolioId is required" });
      if (!requireConfirmation(body, "ACTIVATE_PORTFOLIO", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await activatePortfolioOperation(database, {
        portfolioId,
        actorId,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_activate_portfolio",
        actor: actorId,
        targetType: "Portfolio",
        targetId: portfolioId,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "Portfolio");
    }
  );

  server.post(
    "/trading/operations/release-kill-switch",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : undefined;
      if (!sessionId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "sessionId is required" });
      if (!requireConfirmation(body, "RELEASE_KILL_SWITCH", reply))
        return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await releaseKillSwitchOperation(database, {
        sessionId,
        actorId,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_release_kill_switch",
        actor: actorId,
        targetType: "TradingSession",
        targetId: sessionId,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "TradingSession");
    }
  );

  server.post(
    "/trading/operations/activate-session",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : undefined;
      if (!sessionId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "sessionId is required" });
      if (!requireConfirmation(body, "ACTIVATE_SESSION", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await activateSessionOperation(database, {
        sessionId,
        actorId,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_activate_session",
        actor: actorId,
        targetType: "TradingSession",
        targetId: sessionId,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "TradingSession");
    }
  );

  server.post(
    "/trading/operations/pause-session",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : undefined;
      if (!sessionId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "sessionId is required" });
      if (!requireConfirmation(body, "PAUSE_SESSION", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await pauseSessionOperation(database, {
        sessionId,
        actorId,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_pause_session",
        actor: actorId,
        targetType: "TradingSession",
        targetId: sessionId,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "TradingSession");
    }
  );

  server.post(
    "/trading/operations/engage-kill-switch",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : undefined;
      const reasonCode =
        typeof body.reasonCode === "string" && body.reasonCode.trim().length > 0
          ? body.reasonCode.trim()
          : undefined;
      if (!sessionId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "sessionId is required" });
      if (!reasonCode)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "reasonCode is required" });
      if (!requireConfirmation(body, "ENGAGE_KILL_SWITCH", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await engageKillSwitchOperation(database, {
        sessionId,
        actorId,
        reasonCode,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_engage_kill_switch",
        actor: actorId,
        targetType: "TradingSession",
        targetId: sessionId,
        metadata: { outcome: outcome.kind, reasonCode },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "TradingSession");
    }
  );

  server.post(
    "/trading/operations/unlock-session",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : undefined;
      if (!sessionId)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "sessionId is required" });
      if (!requireConfirmation(body, "UNLOCK_SESSION", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;
      const confirmCauseResolved = body.confirmCauseResolved === true;
      if (!confirmCauseResolved) {
        return reply
          .code(400)
          .send({
            error: "Bad Request",
            message: "confirmCauseResolved must be true."
          });
      }

      const actorId = await resolveActorId(request);
      const outcome = await unlockSessionOperation(database, {
        sessionId,
        actorId,
        idempotencyKey,
        expectedVersion,
        confirmCauseResolved,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_unlock_session",
        actor: actorId,
        targetType: "TradingSession",
        targetId: sessionId,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "TradingSession");
    }
  );

  server.post(
    "/trading/operations/manual-risk-close",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const shadowPositionId =
        typeof body.shadowPositionId === "string"
          ? body.shadowPositionId
          : undefined;
      const reasonNote =
        typeof body.reasonNote === "string" && body.reasonNote.trim().length > 0
          ? body.reasonNote.trim()
          : undefined;
      if (!shadowPositionId)
        return reply
          .code(400)
          .send({
            error: "Bad Request",
            message: "shadowPositionId is required"
          });
      if (!reasonNote)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "reasonNote is required" });
      if (!requireConfirmation(body, "MANUAL_RISK_CLOSE", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      const expectedVersion = requireExpectedVersion(body, reply);
      if (
        reply.sent ||
        idempotencyKey === undefined ||
        expectedVersion === undefined
      )
        return reply;

      const actorId = await resolveActorId(request);
      const outcome = await manualRiskCloseOperation(database, {
        shadowPositionId,
        actorId,
        reasonNote,
        idempotencyKey,
        expectedVersion,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_manual_risk_close",
        actor: actorId,
        targetType: "ShadowPosition",
        targetId: shadowPositionId,
        metadata: { outcome: outcome.kind, reasonNote },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "ShadowPosition");
    }
  );

  server.post(
    "/trading/operations/run-job",
    { preHandler, config: { rateLimit: OPERATIONS_RATE_LIMIT } },
    async (request, reply) => {
      const body = asBodyRecord(request.body);
      const jobName =
        typeof body.jobName === "string" ? body.jobName : undefined;
      if (!jobName)
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "jobName is required" });
      if (!requireConfirmation(body, "RUN_JOB", reply)) return reply;
      const idempotencyKey = requireIdempotencyKey(body, reply);
      if (reply.sent || idempotencyKey === undefined) return reply;

      const actorId = await resolveActorId(request);
      const outcome = await runJobOperation(database, {
        jobName,
        actorId,
        idempotencyKey,
        asOf: new Date()
      });
      void logAudit({
        action: "trading_run_job",
        actor: actorId,
        targetType: "ManualJobRun",
        targetId: jobName,
        metadata: { outcome: outcome.kind },
        ...extractRequestContext(request)
      });
      return respondToOutcome(reply, outcome, "Job");
    }
  );
}
