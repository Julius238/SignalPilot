/**
 * SignalPilot → Nexus read-only integration API, `nexus-signalpilot-read/v1`.
 *
 * This is the *only* surface Nexus is allowed to reach. It exists as its own
 * route group, outside the admin-cookie scope, because:
 *
 *   - `requireAdmin` passes everything through when `API_AUTH_ENABLED=false`,
 *     and that must never open a service-to-service integration;
 *   - the dashboard router mixes reads with watchlist, backtest and strategy
 *     mutations, so "the dashboard API" is not a read-only contract;
 *   - a browser cookie plus CSRF is the wrong primitive for a server-to-server
 *     caller.
 *
 * Hard boundaries, enforced here and asserted by `test/nexusRead.test.ts`:
 *
 *   1. Only `GET` handlers are declared. No POST/PUT/PATCH/DELETE exists in
 *      this module, so no mutation can be routed through it.
 *   2. No generic query, SQL, Prisma or filter passthrough. The caller may send
 *      exactly one parameter, `components`, from a two-value enum. Every field
 *      and every window is decided server-side.
 *   3. No worker, scheduler, backtest or trading-operation import. Trading
 *      state is read from *configuration flags only* and never actuated.
 *   4. No secrets, connection strings, environment dumps, stack traces or raw
 *      log payloads in any response.
 *   5. Every read is bounded: `take: 1` row lookups and a `count` aggregate,
 *      each restricted to a configured lookback window. No table is scanned in
 *      full and no history is transferred.
 *
 * The handler performs no write of any kind — not an audit row, not a
 * "mark as read", not a lazy migration. Access is recorded through the
 * structured request log instead, so that a Nexus read can never mutate
 * SignalPilot data.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";

import { BotRunStatus, prisma } from "@signalpilot/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPublicEnvironment } from "../../auth/config.js";
import {
  NEXUS_READ_REQUIRED_SCOPE,
  type NexusReadConfig,
  type NexusServiceToken,
  sha256Hex
} from "../../lib/nexusReadConfig.js";

export const NEXUS_READ_CONTRACT_VERSION = "nexus-signalpilot-read/v1";
export const NEXUS_READ_SCHEMA_VERSION = "signalpilot-nexus-read-status-1";

/** Longest job name echoed back. `BotRun.jobName` is internal, but bounded anyway. */
const MAX_JOB_NAME_LENGTH = 64;

type NexusReadDatabase = Pick<typeof prisma, "$queryRaw" | "botRun" | "marketEvent">;

let database: NexusReadDatabase = prisma;

export function setNexusReadDatabaseForTests(db: NexusReadDatabase) {
  database = db;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } };
}

function requestId(request: FastifyRequest): string {
  const existing = (request as { nexusRequestId?: string }).nexusRequestId;
  if (existing) return existing;
  const generated = randomUUID();
  (request as { nexusRequestId?: string }).nexusRequestId = generated;
  return generated;
}

/**
 * Constant-time comparison of the presented bearer token against the configured
 * digest. Both sides are fixed-length hex digests, so the comparison itself
 * leaks neither the token nor its length.
 */
function tokenMatches(presented: string, expectedDigest: string): boolean {
  const presentedDigest = Buffer.from(sha256Hex(presented), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  if (presentedDigest.length !== expected.length) return false;
  return timingSafeEqual(presentedDigest, expected);
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export type NexusAuthDecision =
  | { readonly ok: true; readonly tokenId: "current" | "previous" }
  | { readonly ok: false; readonly status: 401 | 403; readonly reasonCode: string };

/**
 * The complete auth decision for one request: token match, expiry and scope,
 * tried against `currentToken` and then `previousToken` (present only during a
 * rotation window). A pure function so every branch — including one that would
 * require deliberately misconfiguring the live router — is unit-testable in
 * isolation.
 *
 * Both "no token" and "wrong token" collapse to the same 401 `unauthenticated`:
 * distinguishing them would tell a prober whether a guessed token was the right
 * shape. An expired token collapses into the same code for the same reason —
 * only the internal log `reasonCode` tells them apart. A scope mismatch is
 * different: it can only ever be reached by someone who already holds a
 * digest-matching token, so a distinct 403 `insufficient_scope` carries no
 * oracle risk and matches the documented error contract.
 */
export function authenticateNexusRequest(
  presentedToken: string | null,
  config: NexusReadConfig,
  now: Date
): NexusAuthDecision {
  if (!presentedToken) return { ok: false, status: 401, reasonCode: "unauthenticated" };

  const evaluate = (
    tokenRecord: NexusServiceToken,
    tokenId: "current" | "previous"
  ): NexusAuthDecision | null => {
    if (!tokenMatches(presentedToken, tokenRecord.digest)) return null;
    if (tokenRecord.expiresAt !== null && now.getTime() > tokenRecord.expiresAt.getTime()) {
      return { ok: false, status: 401, reasonCode: "token_expired" };
    }
    if (tokenRecord.scope !== NEXUS_READ_REQUIRED_SCOPE) {
      return { ok: false, status: 403, reasonCode: "insufficient_scope" };
    }
    return { ok: true, tokenId };
  };

  const currentResult = evaluate(config.currentToken, "current");
  if (currentResult) return currentResult;

  if (config.previousToken) {
    const previousResult = evaluate(config.previousToken, "previous");
    if (previousResult) return previousResult;
  }

  return { ok: false, status: 401, reasonCode: "unauthenticated" };
}

/** `TRADING_MODE`, normalised without importing a trading actuator. */
function readTradingMode(env: NodeJS.ProcessEnv): "SHADOW" | "DISABLED" | "unknown" {
  const raw = env.TRADING_MODE?.trim().toUpperCase();
  if (raw === undefined || raw === "") return "DISABLED";
  if (raw === "SHADOW" || raw === "DISABLED") return raw;
  return "unknown";
}

function sanitiseJobName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters stripped: a job name reaches a Nexus model context as
  // data, and data must not be able to carry framing of its own.
  const cleaned = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_JOB_NAME_LENGTH);
}

function isoOrNull(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

interface BotRunRow {
  readonly jobName?: unknown;
  readonly status?: unknown;
  readonly startedAt?: unknown;
  readonly finishedAt?: unknown;
}

interface WorkerView {
  readonly state: "healthy" | "running" | "failing" | "idle" | "unknown";
  readonly lastRunJob: string | null;
  readonly lastRunStatus: string | null;
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly windowHours: number;
}

function workerState(status: unknown, hasRun: boolean): WorkerView["state"] {
  if (!hasRun) return "idle";
  if (status === BotRunStatus.RUNNING) return "running";
  if (status === BotRunStatus.SUCCESS) return "healthy";
  if (status === BotRunStatus.FAILED) return "failing";
  return "unknown";
}

export async function registerNexusReadRoutes(
  server: FastifyInstance,
  options: { readonly config: NexusReadConfig }
) {
  const { config } = options;

  // Fail closed at registration: this router must never be mounted without a
  // usable, correctly scoped, unexpired service credential, whatever the
  // caller sends. Re-validated here even though `resolveNexusReadConfig`
  // already enforces it, in case a caller constructs a `NexusReadConfig`
  // directly instead of going through the env-driven resolver.
  const tokenIsUsable = (token: NexusServiceToken | null, required: boolean): boolean => {
    if (token === null) return !required;
    return (
      token.digest.length === 64 &&
      token.scope === NEXUS_READ_REQUIRED_SCOPE &&
      (token.expiresAt === null || token.expiresAt.getTime() > Date.now())
    );
  };
  if (
    !config.enabled ||
    !tokenIsUsable(config.currentToken, true) ||
    (config.previousToken !== null && !tokenIsUsable(config.previousToken, false))
  ) {
    throw new Error(
      "Refusing to register the Nexus read API without a valid, correctly scoped, unexpired service token."
    );
  }
  // A previous token without an expiry is not a rotation window, it is a
  // second permanent token — the registration must refuse that too.
  if (config.previousToken !== null && config.previousToken.expiresAt === null) {
    throw new Error("Refusing to register the Nexus read API with a previous token that never expires.");
  }

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = requestId(request);
    reply.header("x-request-id", id);
    // Independent of `API_AUTH_ENABLED` and of the admin cookie by design.
    const token = extractBearer(request.headers.authorization);
    const decision = authenticateNexusRequest(token, config, new Date());
    if (!decision.ok) {
      server.log.warn(
        { requestId: id, route: request.url.split("?")[0], reasonCode: decision.reasonCode },
        "Nexus read API request rejected"
      );
      await reply
        .code(decision.status)
        .header("www-authenticate", "Bearer")
        .send(
          errorBody(
            decision.status === 403 ? "insufficient_scope" : "unauthenticated",
            decision.status === 403
              ? "The presented token does not carry the required scope."
              : "A valid Nexus service token is required.",
            id
          )
        );
    }
  });

  server.get(
    "/status",
    {
      config: {
        rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;

      // Closed parameter set. An unknown parameter is a contract error, not
      // something to ignore silently.
      const unknownParameters = Object.keys(query).filter((key) => key !== "components");
      if (unknownParameters.length > 0) {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", "Unknown query parameter.", id));
      }
      const rawComponents = query.components;
      const components = rawComponents === undefined ? "default" : String(rawComponents);
      if (components !== "default" && components !== "extended") {
        return reply
          .code(400)
          .send(
            errorBody("invalid_filter", "components must be 'default' or 'extended'.", id)
          );
      }

      const observedAt = new Date();
      const since = new Date(observedAt.getTime() - config.windowHours * 3_600_000);

      // --- database reachability -------------------------------------------
      let databaseState: "available" | "unavailable" = "unavailable";
      let databaseLatencyMs: number | null = null;
      try {
        const startedAt = Date.now();
        await database.$queryRaw`SELECT 1`;
        databaseLatencyMs = Date.now() - startedAt;
        databaseState = "available";
      } catch (error) {
        // Reported as a state, never as a stack trace. A status endpoint that
        // 500s when the database is down destroys the very information it
        // exists to deliver.
        server.log.warn(
          { requestId: id, reasonCode: "database_unavailable" },
          "Nexus read API could not reach the database"
        );
        void error;
      }

      // --- bounded reads ----------------------------------------------------
      let worker: WorkerView = {
        state: "unknown",
        lastRunJob: null,
        lastRunStatus: null,
        lastRunAt: null,
        lastSuccessAt: null,
        windowHours: config.windowHours
      };
      let marketEventCount: number | null = null;
      let lastEventAt: string | null = null;

      if (databaseState === "available") {
        try {
          const [latestRuns, latestSuccesses] = await Promise.all([
            database.botRun.findMany({
              where: { startedAt: { gte: since } },
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { jobName: true, status: true, startedAt: true, finishedAt: true }
            }),
            database.botRun.findMany({
              where: { startedAt: { gte: since }, status: BotRunStatus.SUCCESS },
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { startedAt: true, finishedAt: true }
            })
          ]);
          const latest = (latestRuns as BotRunRow[])[0];
          const success = (latestSuccesses as BotRunRow[])[0];
          worker = {
            state: workerState(latest?.status, latest !== undefined),
            lastRunJob: sanitiseJobName(latest?.jobName),
            lastRunStatus: typeof latest?.status === "string" ? latest.status : null,
            lastRunAt: isoOrNull(latest?.startedAt),
            lastSuccessAt: isoOrNull(success?.finishedAt ?? success?.startedAt),
            windowHours: config.windowHours
          };
        } catch {
          server.log.warn(
            { requestId: id, reasonCode: "worker_read_failed" },
            "Nexus read API could not read worker runs"
          );
        }

        try {
          const [count, latestEvents] = await Promise.all([
            database.marketEvent.count({ where: { detectedAt: { gte: since } } }),
            database.marketEvent.findMany({
              where: { detectedAt: { gte: since } },
              orderBy: { detectedAt: "desc" },
              take: 1,
              // Timestamps only. No title, summary, reasoning or source URL:
              // the status contract carries no third-party free text at all.
              select: { detectedAt: true }
            })
          ]);
          marketEventCount = typeof count === "number" ? count : null;
          lastEventAt = isoOrNull((latestEvents as Array<{ detectedAt?: unknown }>)[0]?.detectedAt);
        } catch {
          server.log.warn(
            { requestId: id, reasonCode: "market_event_read_failed" },
            "Nexus read API could not read market events"
          );
        }
      }

      // --- freshness --------------------------------------------------------
      const sourceCandidates = [worker.lastRunAt, lastEventAt].filter(
        (value): value is string => value !== null
      );
      const sourceUpdatedAt =
        sourceCandidates.length > 0
          ? sourceCandidates.reduce((a, b) => (a > b ? a : b))
          : null;
      // Unknown freshness counts as stale: Nexus must never present an
      // unverifiable reading as current.
      const stale =
        sourceUpdatedAt === null ||
        databaseState !== "available" ||
        observedAt.getTime() - new Date(sourceUpdatedAt).getTime() >
          config.staleAfterSeconds * 1000;

      const data: Record<string, unknown> = {
        service: {
          state: "available",
          uptimeSeconds: Math.floor(process.uptime())
        },
        database: {
          state: databaseState,
          latencyMs: databaseLatencyMs
        },
        analysisWorker: worker,
        marketEvents: {
          windowHours: config.windowHours,
          count: marketEventCount,
          lastDetectedAt: lastEventAt
        },
        tradingMode: readTradingMode(process.env),
        liveTradingEnabled: process.env.ENABLE_LIVE_TRADING === "true",
        environment: getPublicEnvironment()
      };

      if (components === "extended") {
        // Redis is deployed but not verified by any runtime connection check in
        // this build, so it may not claim "available" (integration contract,
        // §Status Contract).
        data.redis = { state: "unknown", reason: "not_verified" };
      }

      server.log.info(
        {
          requestId: id,
          route: "/integrations/nexus/v1/status",
          components,
          databaseState,
          stale
        },
        "Nexus read API status served"
      );

      return reply.code(200).send({
        contractVersion: NEXUS_READ_CONTRACT_VERSION,
        requestId: id,
        observedAt: observedAt.toISOString(),
        sourceUpdatedAt,
        stale,
        data,
        provenance: { system: "signalpilot", schemaVersion: NEXUS_READ_SCHEMA_VERSION }
      });
    }
  );
}
