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

/** Longest free-text value echoed back on any deep read (strategy name, symbol, reason code). */
const MAX_TEXT_LENGTH = 80;

/** Hard server-side ceiling per list read. The caller may ask for less, never more. */
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

/**
 * User-facing timezone for "today" (Phase 2C.2b §8). Every stored timestamp is
 * UTC; only the *window boundary* is a local-calendar question, and it is
 * resolved here, once, rather than by each caller.
 */
const USER_TIME_ZONE = "Europe/Berlin";

type NexusReadDatabase = Pick<
  typeof prisma,
  | "$queryRaw"
  | "botRun"
  | "marketEvent"
  | "strategyAssignment"
  | "shadowPosition"
  | "signal"
  | "tradeCandidate"
  | "shadowOrder"
  | "shadowFill"
>;

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

/**
 * Bounded, control-character-free projection of any stored text (strategy name,
 * symbol, reason code). Same reasoning as `sanitiseJobName`: this reaches a
 * Nexus model context as data, and data must not be able to carry framing.
 */
function sanitiseText(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const cleaned = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

/** `Decimal` as a string. Never a float: a P/L must not round-trip through IEEE-754. */
function decimalOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length === 0 || text.length > 40 ? null : text;
}

function boundedLimit(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number(String(raw));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) return null;
  return parsed;
}

/** Offset of `timeZone` from UTC at `at`, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
    .formatToParts(at)
    .filter((part) => part.type !== "literal");
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour % 24,
    value.minute,
    value.second
  );
  return asUtc - at.getTime();
}

/**
 * The UTC instant at which the current calendar day started in `timeZone`.
 *
 * Phase 2C.2a hit the mirror image of this bug from the query side: a UTC
 * column compared against a local `now()` silently reported "no recent runs".
 * Here the direction is reversed — a *local* calendar boundary has to become a
 * UTC instant — and it is resolved in one place so no handler improvises it.
 * Two passes because the offset itself depends on which instant you ask about
 * (a DST switch inside the day would otherwise shift the boundary by an hour).
 */
function startOfDayUtc(now: Date, timeZone: string): Date {
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year, month, day] = localParts.split("-").map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  let instant = midnightUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = midnightUtc - zoneOffsetMs(new Date(instant), timeZone);
  }
  return new Date(instant);
}

export type ActivityWindow = "recent" | "today" | "last_24h";

export interface ResolvedWindow {
  readonly window: ActivityWindow;
  readonly since: Date | null;
  readonly timeZone: string | null;
}

/**
 * `recent` deliberately carries no lower bound: "the last N things that
 * happened" is a count question, not a time question, and forcing a window on
 * it would make a quiet system look empty rather than quiet.
 */
export function resolveWindow(window: ActivityWindow, now: Date): ResolvedWindow {
  if (window === "today") {
    return { window, since: startOfDayUtc(now, USER_TIME_ZONE), timeZone: USER_TIME_ZONE };
  }
  if (window === "last_24h") {
    return { window, since: new Date(now.getTime() - 24 * 3_600_000), timeZone: null };
  }
  return { window, since: null, timeZone: null };
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

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2C.2b deep reads: bots, positions, activity.
  //
  // Same rules as `/status` above and asserted by the same test file: GET
  // only, a closed parameter set, an allowlist projection built field by field
  // (never a Prisma object handed out whole), every list bounded server-side,
  // and no free text that was not sanitised on the way out. Each endpoint is
  // one bounded read so a Nexus tool call is one HTTP request.
  // ─────────────────────────────────────────────────────────────────────────

  const envelope = (
    id: string,
    observedAt: Date,
    sourceUpdatedAt: string | null,
    data: Record<string, unknown>
  ) => ({
    contractVersion: NEXUS_READ_CONTRACT_VERSION,
    requestId: id,
    observedAt: observedAt.toISOString(),
    sourceUpdatedAt,
    // Deliberately different from `/status`, where unknown freshness counts as
    // stale. On a list read `sourceUpdatedAt === null` means the list is
    // *empty*, and an empty list is a definite answer, not an unverifiable
    // one — reporting it as stale would tell Nexus "these numbers may be out
    // of date" about numbers that do not exist. Emptiness is carried by
    // `returned`/`total` instead.
    stale:
      sourceUpdatedAt !== null &&
      observedAt.getTime() - new Date(sourceUpdatedAt).getTime() > config.staleAfterSeconds * 1000,
    data,
    provenance: { system: "signalpilot", schemaVersion: NEXUS_READ_SCHEMA_VERSION }
  });

  /**
   * The raw deployment flags, exactly as `/status` reports them.
   *
   * Deliberately NOT a pre-derived `executionMode`: Nexus derives that itself
   * from these two, and shipping a second, server-computed answer would give
   * the same question two sources of truth — the one place a "SHADOW" label
   * could disagree with a `liveTradingEnabled: true` next to it.
   */
  const deploymentFlags = () => ({
    tradingMode: readTradingMode(process.env),
    liveTradingEnabled: process.env.ENABLE_LIVE_TRADING === "true"
  });

  const rejectUnknownParameters = (
    query: Record<string, unknown>,
    allowed: readonly string[],
    reply: FastifyReply,
    id: string
  ): boolean => {
    const unknown = Object.keys(query).filter((key) => !allowed.includes(key));
    if (unknown.length === 0) return false;
    void reply.code(400).send(errorBody("invalid_filter", "Unknown query parameter.", id));
    return true;
  };

  server.get(
    "/bots",
    { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;
      if (rejectUnknownParameters(query, ["activeOnly", "limit"], reply, id)) return;

      const limit = boundedLimit(query.limit);
      if (limit === null) {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", `limit must be an integer 1..${MAX_LIMIT}.`, id));
      }
      const rawActiveOnly = query.activeOnly === undefined ? "false" : String(query.activeOnly);
      if (rawActiveOnly !== "true" && rawActiveOnly !== "false") {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", "activeOnly must be 'true' or 'false'.", id));
      }
      const activeOnly = rawActiveOnly === "true";
      const observedAt = new Date();

      try {
        const [rows, total] = await Promise.all([
          database.strategyAssignment.findMany({
            where: activeOnly ? { enabled: true } : {},
            orderBy: [{ enabled: "desc" }, { createdAt: "asc" }],
            take: limit,
            select: {
              id: true,
              enabled: true,
              timeframe: true,
              validFrom: true,
              validTo: true,
              updatedAt: true,
              assignmentConfigJson: true,
              asset: { select: { symbol: true } },
              strategy: { select: { key: true, name: true, status: true } },
              strategyVersion: { select: { version: true, status: true } }
            }
          }),
          database.strategyAssignment.count({ where: activeOnly ? { enabled: true } : {} })
        ]);

        const bots = rows.map((row) => {
          const configJson = row.assignmentConfigJson as Record<string, unknown> | null;
          return {
            // Stable handle for a follow-up. Opaque and short; Nexus decides
            // whether it ever reaches a prompt.
            id: row.id,
            name: sanitiseText(row.strategy?.name) ?? sanitiseText(row.strategy?.key),
            strategyKey: sanitiseText(row.strategy?.key),
            strategyStatus: sanitiseText(row.strategy?.status),
            version: typeof row.strategyVersion?.version === "number" ? row.strategyVersion.version : null,
            versionStatus: sanitiseText(row.strategyVersion?.status),
            symbol: sanitiseText(row.asset?.symbol, 16),
            timeframe: sanitiseText(row.timeframe, 8),
            direction: sanitiseText(configJson?.direction, 8),
            enabled: row.enabled === true,
            validFrom: isoOrNull(row.validFrom),
            validTo: isoOrNull(row.validTo),
            updatedAt: isoOrNull(row.updatedAt)
          };
        });

        const newest = bots
          .map((bot) => bot.updatedAt)
          .filter((value): value is string => value !== null)
          .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

        server.log.info({ requestId: id, route: "/integrations/nexus/v1/bots", count: bots.length }, "Nexus read API bots served");
        return reply.code(200).send(
          envelope(id, observedAt, newest, {
            ...deploymentFlags(),
            returned: bots.length,
            total,
            enabledCount: bots.filter((bot) => bot.enabled).length,
            bots
          })
        );
      } catch {
        server.log.warn({ requestId: id, reasonCode: "bots_read_failed" }, "Nexus read API could not read bots");
        return reply.code(503).send(errorBody("source_unavailable", "The bot read is not available.", id));
      }
    }
  );

  server.get(
    "/positions",
    { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;
      if (rejectUnknownParameters(query, ["state", "limit"], reply, id)) return;

      const limit = boundedLimit(query.limit);
      if (limit === null) {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", `limit must be an integer 1..${MAX_LIMIT}.`, id));
      }
      const state = query.state === undefined ? "open" : String(query.state);
      if (state !== "open" && state !== "closed" && state !== "all") {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", "state must be 'open', 'closed' or 'all'.", id));
      }

      const OPEN = ["OPENING", "OPEN", "PARTIALLY_CLOSED", "ERROR"];
      const CLOSED = ["CLOSED", "STOPPED_OUT", "INVALIDATED"];
      const where =
        state === "open"
          ? { status: { in: OPEN } }
          : state === "closed"
            ? { status: { in: CLOSED } }
            : {};
      const observedAt = new Date();

      try {
        const [rows, total] = await Promise.all([
          database.shadowPosition.findMany({
            where: where as never,
            orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
            take: limit,
            select: {
              id: true,
              status: true,
              direction: true,
              openQuantity: true,
              initialQuantity: true,
              averageEntryPrice: true,
              averageExitPrice: true,
              realizedPnl: true,
              feesPaid: true,
              stopPrice: true,
              takeProfitPrice: true,
              openedAt: true,
              closedAt: true,
              maxHoldUntil: true,
              lastValuationAt: true,
              asset: { select: { symbol: true } },
              strategyAssignment: {
                select: { id: true, strategy: { select: { key: true, name: true } } }
              }
            }
          }),
          database.shadowPosition.count({ where: where as never })
        ]);

        const positions = rows.map((row) => ({
          id: row.id,
          symbol: sanitiseText(row.asset?.symbol, 16),
          direction: sanitiseText(row.direction, 8),
          state: sanitiseText(row.status, 24),
          quantity: decimalOrNull(row.openQuantity),
          initialQuantity: decimalOrNull(row.initialQuantity),
          averageEntryPrice: decimalOrNull(row.averageEntryPrice),
          averageExitPrice: decimalOrNull(row.averageExitPrice),
          realizedPnl: decimalOrNull(row.realizedPnl),
          feesPaid: decimalOrNull(row.feesPaid),
          stopPrice: decimalOrNull(row.stopPrice),
          takeProfitPrice: decimalOrNull(row.takeProfitPrice),
          openedAt: isoOrNull(row.openedAt),
          closedAt: isoOrNull(row.closedAt),
          maxHoldUntil: isoOrNull(row.maxHoldUntil),
          lastValuationAt: isoOrNull(row.lastValuationAt),
          botId: row.strategyAssignment?.id ?? null,
          botName:
            sanitiseText(row.strategyAssignment?.strategy?.name) ??
            sanitiseText(row.strategyAssignment?.strategy?.key)
        }));

        const newest = positions
          .map((position) => position.closedAt ?? position.openedAt)
          .filter((value): value is string => value !== null)
          .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

        server.log.info(
          { requestId: id, route: "/integrations/nexus/v1/positions", state, count: positions.length },
          "Nexus read API positions served"
        );
        return reply.code(200).send(
          envelope(id, observedAt, newest, {
            // Never omitted, even when the list is empty. A caller has to be
            // able to separate two different answers: zero simulated
            // positions, versus a deployment that simulates nothing at all.
            ...deploymentFlags(),
            requestedState: state,
            returned: positions.length,
            total,
            positions
          })
        );
      } catch {
        server.log.warn({ requestId: id, reasonCode: "positions_read_failed" }, "Nexus read API could not read positions");
        return reply.code(503).send(errorBody("source_unavailable", "The position read is not available.", id));
      }
    }
  );

  server.get(
    "/activity",
    { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;
      if (rejectUnknownParameters(query, ["window", "limit"], reply, id)) return;

      const limit = boundedLimit(query.limit);
      if (limit === null) {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", `limit must be an integer 1..${MAX_LIMIT}.`, id));
      }
      const rawWindow = query.window === undefined ? "recent" : String(query.window);
      if (rawWindow !== "recent" && rawWindow !== "today" && rawWindow !== "last_24h") {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", "window must be 'recent', 'today' or 'last_24h'.", id));
      }

      const observedAt = new Date();
      const resolved = resolveWindow(rawWindow as ActivityWindow, observedAt);
      const at = resolved.since === null ? undefined : { gte: resolved.since };

      try {
        // Four bounded reads merged into one chronological trail. Each source
        // keeps its own `type`: a signal is not a candidate, a candidate is not
        // an order, an order is not a fill. Collapsing them would be the exact
        // conflation the grounding policy forbids.
        const [signals, candidates, orders, fills] = await Promise.all([
          database.signal.findMany({
            where: at ? { createdAt: at } : {},
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { symbol: true, signalType: true, status: true, direction: true, createdAt: true }
          }),
          database.tradeCandidate.findMany({
            where: at ? { decisionTime: at } : {},
            orderBy: { decisionTime: "desc" },
            take: limit,
            select: {
              status: true,
              direction: true,
              decisionTime: true,
              invalidReasonCode: true,
              asset: { select: { symbol: true } },
              strategyAssignment: {
                select: { id: true, strategy: { select: { key: true, name: true } } }
              },
              decision: { select: { outcome: true, reasonCode: true } }
            }
          }),
          database.shadowOrder.findMany({
            where: at ? { createdAt: at } : {},
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
              status: true,
              side: true,
              direction: true,
              purpose: true,
              createdAt: true,
              rejectionReasonCode: true,
              asset: { select: { symbol: true } }
            }
          }),
          database.shadowFill.findMany({
            where: at ? { occurredAt: at } : {},
            orderBy: { occurredAt: "desc" },
            take: limit,
            select: {
              side: true,
              triggerType: true,
              quantity: true,
              fillPrice: true,
              occurredAt: true,
              asset: { select: { symbol: true } }
            }
          })
        ]);

        const items = [
          ...signals.map((row) => ({
            type: "signal" as const,
            at: isoOrNull(row.createdAt),
            symbol: sanitiseText(row.symbol, 16),
            action: sanitiseText(row.signalType, 24),
            direction: sanitiseText(row.direction, 8),
            state: sanitiseText(row.status, 24),
            botId: null as string | null,
            botName: null as string | null,
            reasonCode: null as string | null
          })),
          ...candidates.map((row) => ({
            type: "candidate" as const,
            at: isoOrNull(row.decisionTime),
            symbol: sanitiseText(row.asset?.symbol, 16),
            action: sanitiseText(row.decision?.outcome, 24),
            direction: sanitiseText(row.direction, 8),
            state: sanitiseText(row.status, 24),
            botId: row.strategyAssignment?.id ?? null,
            botName:
              sanitiseText(row.strategyAssignment?.strategy?.name) ??
              sanitiseText(row.strategyAssignment?.strategy?.key),
            // Only a persisted reason code, never a reconstructed one. Absent
            // stays absent all the way into the Nexus prompt.
            reasonCode:
              sanitiseText(row.decision?.reasonCode, 48) ?? sanitiseText(row.invalidReasonCode, 48)
          })),
          ...orders.map((row) => ({
            type: "order" as const,
            at: isoOrNull(row.createdAt),
            symbol: sanitiseText(row.asset?.symbol, 16),
            action: sanitiseText(row.purpose, 24),
            direction: sanitiseText(row.direction, 8),
            state: sanitiseText(row.status, 24),
            botId: null as string | null,
            botName: null as string | null,
            reasonCode: sanitiseText(row.rejectionReasonCode, 48)
          })),
          ...fills.map((row) => ({
            type: "fill" as const,
            at: isoOrNull(row.occurredAt),
            symbol: sanitiseText(row.asset?.symbol, 16),
            action: sanitiseText(row.triggerType, 24),
            direction: sanitiseText(row.side, 8),
            state: null as string | null,
            botId: null as string | null,
            botName: null as string | null,
            reasonCode: null as string | null
          }))
        ]
          .filter((item) => item.at !== null)
          .sort((a, b) => (a.at! < b.at! ? 1 : a.at! > b.at! ? -1 : 0));

        const shown = items.slice(0, limit);
        // True totals in the window, not counts over the fetched slice. With
        // `limit=5` the slice would report "5 signals" where 99 happened, and
        // a reader has no way to tell a cap from a fact. These four counts are
        // what makes "N weitere nicht dargestellt" honest.
        const [signalTotal, candidateTotal, orderTotal, fillTotal] = await Promise.all([
          database.signal.count({ where: at ? { createdAt: at } : {} }),
          database.tradeCandidate.count({ where: at ? { decisionTime: at } : {} }),
          database.shadowOrder.count({ where: at ? { createdAt: at } : {} }),
          database.shadowFill.count({ where: at ? { occurredAt: at } : {} })
        ]);
        const counts = {
          signal: signalTotal,
          candidate: candidateTotal,
          order: orderTotal,
          fill: fillTotal
        };
        const total = signalTotal + candidateTotal + orderTotal + fillTotal;

        server.log.info(
          { requestId: id, route: "/integrations/nexus/v1/activity", window: rawWindow, count: shown.length },
          "Nexus read API activity served"
        );
        return reply.code(200).send(
          envelope(id, observedAt, shown[0]?.at ?? null, {
            ...deploymentFlags(),
            window: resolved.window,
            windowStart: resolved.since === null ? null : resolved.since.toISOString(),
            windowTimeZone: resolved.timeZone,
            returned: shown.length,
            total,
            // Per source, so a reader can never turn "no candidates" into
            // "no signals" or the other way round.
            matchedByType: counts,
            items: shown
          })
        );
      } catch {
        server.log.warn({ requestId: id, reasonCode: "activity_read_failed" }, "Nexus read API could not read activity");
        return reply.code(503).send(errorBody("source_unavailable", "The activity read is not available.", id));
      }
    }
  );
}
