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
 *      `@signalpilot/performance-intelligence/shadow` is the one exception and
 *      is not a widening of this rule: it is the pure metric engine — no
 *      Prisma, no clock, no `process.env`, no I/O, no write — and importing it
 *      is what keeps every performance figure defined in exactly ONE place.
 *      Re-deriving those definitions here instead would be the actual hazard
 *      the "no invented metric" rule exists to prevent. The worker, which owns
 *      *persistence* of the same engine's output, is still never imported.
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

import {
  AssetType,
  BotRunStatus,
  PortfolioStatus,
  RiskAssessmentStatus,
  ShadowPositionStatus,
  StrategyPerformanceWindow,
  TradeCandidateStatus,
  TradingAlertOutboxStatus,
  prisma
} from "@signalpilot/database";
import {
  MetricNullReason,
  ShadowPerformanceSegment,
  computeShadowPerformance,
  type ClosedShadowTradeInput,
  type NullableMetric,
  type PortfolioEquityPointInput,
  type ShadowPerformanceMetrics
} from "@signalpilot/performance-intelligence/shadow";
import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";
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
  | "portfolio"
  | "portfolioSnapshot"
  | "riskAssessment"
  | "strategyPerformance"
  | "tradingSession"
  | "riskEvent"
  | "tradingAlertOutbox"
  // Phase T3a market read. Three additions, all read-only projections and all
  // named here rather than reached through `prisma` directly — the point of
  // this type is that widening the module's data surface is a visible edit.
  | "marketRegimeSnapshot"
  | "asset"
  | "candle"
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

/** The calendar date in `timeZone` at `now`, as `[year, month, day]` (month 1-12). */
function localCalendarParts(now: Date, timeZone: string): [number, number, number] {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year, month, day] = formatted.split("-").map(Number);
  return [year, month, day];
}

/**
 * The UTC instant at which a given local calendar date started in `timeZone`.
 *
 * Same two-pass reasoning as `startOfDayUtc`, generalised so a week or month
 * boundary can be expressed as "midnight of *this* local date" rather than
 * only "midnight of today".
 */
function startOfLocalDateUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string
): Date {
  const midnightUtc = Date.UTC(year, month - 1, day);
  let instant = midnightUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = midnightUtc - zoneOffsetMs(new Date(instant), timeZone);
  }
  return new Date(instant);
}

/** ISO weekday (Mon=1 … Sun=7) of the current local date in `timeZone`. */
function localIsoWeekday(now: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
  // Unrecognised weekday would silently shift the whole week window, so it is
  // surfaced as a failure rather than defaulted to Monday.
  if (index < 0) throw new Error(`Unrecognised weekday '${name}' for ${timeZone}`);
  return index + 1;
}

/**
 * Performance windows Nexus may ask for.
 *
 * `today`, `this_week` and `this_month` are *exact Europe/Berlin calendar*
 * windows. They are deliberately NOT served from the persisted
 * `StrategyPerformance` snapshots: `DAILY` there is `startOfUtcDay(asOf)`
 * (see the trading worker's `resolveWindowBounds`), i.e. a **UTC** day, which
 * in Europe/Berlin begins at 01:00 or 02:00 local — presenting it as "heute"
 * would be a silent two-hour lie about which trades are counted, and there is
 * no persisted weekly or monthly snapshot at all.
 *
 * `rolling_30d` and `all_time` are the persisted snapshots, and keep exactly
 * the meaning the engine gave them. `rolling_30d` is "the last 30 days", never
 * "this week" and never "this month".
 */
export type PerformanceWindow =
  | "today"
  | "this_week"
  | "this_month"
  | "rolling_30d"
  | "all_time";

export const PERFORMANCE_WINDOWS: readonly PerformanceWindow[] = [
  "today",
  "this_week",
  "this_month",
  "rolling_30d",
  "all_time"
];

export interface ResolvedPerformanceWindow {
  readonly window: PerformanceWindow;
  /** How the figures for this window are obtained. */
  readonly source: "computed_from_source" | "persisted_snapshot";
  /** Calendar semantics, so a reader never has to infer them from the name. */
  readonly kind: "calendar_day" | "calendar_week" | "calendar_month" | "rolling_30d" | "all_time";
  readonly from: Date | null;
  readonly to: Date | null;
  readonly timeZone: string | null;
  /** The persisted snapshot window backing this read, when there is one. */
  readonly snapshotWindow: StrategyPerformanceWindow | null;
}

/**
 * Resolves one requested window into concrete bounds.
 *
 * The calendar windows are computed from the same source rows the engine
 * consumes, so an exact Europe/Berlin boundary is a real, derivable answer
 * rather than a re-labelled approximation.
 */
export function resolvePerformanceWindow(
  window: PerformanceWindow,
  now: Date
): ResolvedPerformanceWindow {
  if (window === "rolling_30d" || window === "all_time") {
    return {
      window,
      source: "persisted_snapshot",
      kind: window === "rolling_30d" ? "rolling_30d" : "all_time",
      from: null,
      to: null,
      timeZone: null,
      snapshotWindow:
        window === "rolling_30d"
          ? StrategyPerformanceWindow.ROLLING_30D
          : StrategyPerformanceWindow.ALL_TIME
    };
  }

  const [year, month, day] = localCalendarParts(now, USER_TIME_ZONE);
  if (window === "today") {
    return {
      window,
      source: "computed_from_source",
      kind: "calendar_day",
      from: startOfDayUtc(now, USER_TIME_ZONE),
      to: now,
      timeZone: USER_TIME_ZONE,
      snapshotWindow: null
    };
  }
  if (window === "this_week") {
    // ISO week: Monday 00:00 Europe/Berlin. Derived by stepping back whole
    // local days, so a DST switch inside the week cannot shift the boundary.
    const weekday = localIsoWeekday(now, USER_TIME_ZONE);
    const midnightToday = Date.UTC(year, month - 1, day);
    const mondayUtcDate = new Date(midnightToday - (weekday - 1) * 86_400_000);
    return {
      window,
      source: "computed_from_source",
      kind: "calendar_week",
      from: startOfLocalDateUtc(
        mondayUtcDate.getUTCFullYear(),
        mondayUtcDate.getUTCMonth() + 1,
        mondayUtcDate.getUTCDate(),
        USER_TIME_ZONE
      ),
      to: now,
      timeZone: USER_TIME_ZONE,
      snapshotWindow: null
    };
  }
  return {
    window,
    source: "computed_from_source",
    kind: "calendar_month",
    from: startOfLocalDateUtc(year, month, 1, USER_TIME_ZONE),
    to: now,
    timeZone: USER_TIME_ZONE,
    snapshotWindow: null
  };
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

/** Every documented reason a metric may legitimately be absent. */
const KNOWN_METRIC_NULL_REASONS: ReadonlySet<string> = new Set<string>(
  Object.values(MetricNullReason)
);

/**
 * Contract value for "this metric is absent, and the engine's documented reason
 * could not be recovered". Distinct from every real reason and, crucially,
 * distinct from `0` — a metric that is unavailable must never reach Nexus as a
 * number it could report as a result.
 */
const UNKNOWN_METRIC_REASON = "UNKNOWN";

/** A metric as Nexus receives it: a value, or an explicit reason it is absent. */
interface ProjectedMetric {
  readonly value: string | null;
  readonly reason: string | null;
}

function projectEngineMetric(metric: NullableMetric): ProjectedMetric {
  if (metric.value !== null) return { value: decimalOrNull(metric.value), reason: null };
  const reason = typeof metric.reason === "string" ? metric.reason : "";
  return {
    value: null,
    reason: KNOWN_METRIC_NULL_REASONS.has(reason) ? reason : UNKNOWN_METRIC_REASON
  };
}

/** Integer counts, guarded so a corrupt row cannot emit `NaN` or a float. */
function countOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * One metric out of a persisted snapshot.
 *
 * `metricsJson` is the source of truth by contract ("the typed columns are a
 * query-friendly projection of it, never a separate source of truth"), and for
 * the nullable-in-engine metrics it is the *only* faithful source: columns like
 * `profitFactor`, `averageR`, `maxDrawdownPct`, `expectancy` and
 * `averageHoldMinutes` are `@default(0)` and NOT nullable, so a stored `0`
 * cannot be distinguished from an uncomputable metric at the column level. Reporting
 * that `0` would turn an unknown into a result, which is exactly what
 * `0 !== UNKNOWN` forbids — so when `metricsJson` cannot answer, this returns
 * `UNKNOWN` rather than the column.
 */
function projectPersistedMetric(name: string, metricsJson: unknown): ProjectedMetric {
  if (metricsJson === null || typeof metricsJson !== "object" || Array.isArray(metricsJson)) {
    return { value: null, reason: UNKNOWN_METRIC_REASON };
  }
  const entry = (metricsJson as Record<string, unknown>)[name];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { value: null, reason: UNKNOWN_METRIC_REASON };
  }
  const record = entry as Record<string, unknown>;
  if (record.value !== null && record.value !== undefined) {
    const value = decimalOrNull(record.value);
    if (value !== null) return { value, reason: null };
  }
  const reason = typeof record.reason === "string" ? record.reason : "";
  return {
    value: null,
    reason: KNOWN_METRIC_NULL_REASONS.has(reason) ? reason : UNKNOWN_METRIC_REASON
  };
}

/**
 * The metrics Nexus is allowed to see, listed one by one.
 *
 * Every name here is a real `ShadowPerformanceMetrics` field with a definition
 * SignalPilot actually carries. Nothing is derived, re-expressed or renamed
 * into a friendlier financial term on the way out.
 */
const NULLABLE_METRIC_NAMES = [
  "winRatePct",
  "averageWin",
  "averageLoss",
  "profitFactor",
  "expectancy",
  "averageR",
  "cumulativeR",
  "maxDrawdownAmount",
  "maxDrawdownPct",
  "recoveryFactor",
  "averageHoldMinutes",
  "exposurePct",
  "averageMaePct",
  "averageMfePct",
  "sharpeRatio",
  "sortinoRatio",
  "riskRejectionRatePct"
] as const;

const DECIMAL_METRIC_NAMES = [
  "grossPnl",
  "netPnl",
  "fees",
  "simulatedExecutionCost",
  "grossProfit",
  "grossLoss",
  "exposureMinutes"
] as const;

const COUNT_METRIC_NAMES = [
  "closedTrades",
  "wins",
  "losses",
  "breakeven",
  "tradesWithPlannedRisk",
  "maxWinStreak",
  "maxLossStreak",
  "returnObservations",
  "tradesWithPriceExtremes",
  "assessedCandidates",
  "riskRejectedCandidates",
  "invalidCandidates",
  "expiredCandidates"
] as const;

/** Allowlist projection of a freshly computed engine result. */
function projectComputedMetrics(metrics: ShadowPerformanceMetrics): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of COUNT_METRIC_NAMES) {
    out[name] = countOrNull((metrics as unknown as Record<string, unknown>)[name]);
  }
  for (const name of DECIMAL_METRIC_NAMES) {
    out[name] = decimalOrNull((metrics as unknown as Record<string, unknown>)[name]);
  }
  for (const name of NULLABLE_METRIC_NAMES) {
    const metric = (metrics as unknown as Record<string, NullableMetric | undefined>)[name];
    out[name] =
      metric === undefined
        ? { value: null, reason: UNKNOWN_METRIC_REASON }
        : projectEngineMetric(metric);
  }
  return out;
}

/** Allowlist projection of a persisted `StrategyPerformance` row. */
function projectPersistedMetrics(row: Record<string, unknown>): Record<string, unknown> {
  const metricsJson = row.metricsJson;
  const out: Record<string, unknown> = {};
  // Counts and money sums are non-nullable in the engine too, so the typed
  // column carries no ambiguity and is used directly.
  for (const name of COUNT_METRIC_NAMES) {
    out[name] = countOrNull(row[name]);
  }
  for (const name of DECIMAL_METRIC_NAMES) {
    out[name] = decimalOrNull(row[name]);
  }
  for (const name of NULLABLE_METRIC_NAMES) {
    out[name] = projectPersistedMetric(name, metricsJson);
  }
  return out;
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

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2C.2c deep reads: performance and issues.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Hard ceiling on the trades one computed window may aggregate.
   *
   * Deliberately NOT a `take` that silently truncates: a partial aggregate
   * presented as "the performance of this week" is a wrong number, not a short
   * list, and no `returned`/`total` pair can repair it. Past the ceiling the
   * window is reported as unavailable instead.
   */
  const MAX_PERFORMANCE_TRADES = 2_000;
  const MAX_EQUITY_POINTS = 400;

  const CLOSED_POSITION_STATUSES = [
    ShadowPositionStatus.CLOSED,
    ShadowPositionStatus.STOPPED_OUT,
    ShadowPositionStatus.INVALIDATED
  ];

  /** The one ACTIVE portfolio shadow trading runs against, or null. */
  const activePortfolio = async (): Promise<{
    id: string;
    startingCash: unknown;
  } | null> => {
    const rows = await database.portfolio.findMany({
      where: { status: PortfolioStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
      take: 1,
      select: { id: true, startingCash: true }
    });
    return rows[0] ?? null;
  };

  server.get(
    "/performance",
    { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;
      if (rejectUnknownParameters(query, ["window"], reply, id)) return;

      const rawWindow = query.window === undefined ? "today" : String(query.window);
      if (!PERFORMANCE_WINDOWS.includes(rawWindow as PerformanceWindow)) {
        return reply
          .code(400)
          .send(
            errorBody(
              "invalid_filter",
              `window must be one of ${PERFORMANCE_WINDOWS.join(", ")}.`,
              id
            )
          );
      }

      const observedAt = new Date();
      const resolved = resolvePerformanceWindow(rawWindow as PerformanceWindow, observedAt);

      // Constant across every branch below, so "no data" and "no metric" are
      // never mistaken for "no simulation".
      const windowView = {
        requested: resolved.window,
        kind: resolved.kind,
        source: resolved.source,
        timeZone: resolved.timeZone,
        from: resolved.from?.toISOString() ?? null,
        to: resolved.to?.toISOString() ?? null,
        snapshotWindow: resolved.snapshotWindow
      };
      const unavailable = (reasonCode: string, sourceUpdatedAt: string | null = null) =>
        reply.code(200).send(
          envelope(id, observedAt, sourceUpdatedAt, {
            ...deploymentFlags(),
            simulated: true,
            window: windowView,
            availability: "unavailable",
            unavailableReasonCode: reasonCode,
            metrics: null
          })
        );

      try {
        const portfolio = await activePortfolio();
        if (portfolio === null) return await unavailable("NO_ACTIVE_PORTFOLIO");

        if (resolved.source === "persisted_snapshot") {
          const rows = await database.strategyPerformance.findMany({
            where: {
              portfolioId: portfolio.id,
              window: resolved.snapshotWindow as never,
              segmentType: ShadowPerformanceSegment.OVERALL as never,
              segmentKey: "ALL"
            },
            orderBy: [{ asOf: "desc" }, { createdAt: "desc" }],
            take: 1
          });
          const row = rows[0] as Record<string, unknown> | undefined;
          if (row === undefined) return await unavailable("NO_SNAPSHOT");

          const asOf = isoOrNull(row.asOf);
          server.log.info(
            { requestId: id, route: "/integrations/nexus/v1/performance", window: rawWindow, source: "persisted_snapshot" },
            "Nexus read API performance served"
          );
          return reply.code(200).send(
            envelope(id, observedAt, asOf, {
              ...deploymentFlags(),
              simulated: true,
              window: {
                ...windowView,
                // The snapshot's own bounds, so the caller sees the period the
                // stored numbers actually cover rather than the request's.
                from: isoOrNull(row.from),
                to: isoOrNull(row.to),
                asOf
              },
              availability: "available",
              unavailableReasonCode: null,
              engineVersion: sanitiseText(row.engineVersion, 40),
              dataThroughAt: isoOrNull(row.dataThroughAt),
              computedAt: isoOrNull(row.computedAt),
              metrics: projectPersistedMetrics(row)
            })
          );
        }

        // ── computed calendar window ──────────────────────────────────────
        const from = resolved.from as Date;
        const to = resolved.to as Date;

        const tradeCount = await database.shadowPosition.count({
          where: {
            portfolioId: portfolio.id,
            status: { in: CLOSED_POSITION_STATUSES as never },
            closedAt: { gte: from, lte: to }
          }
        });
        if (tradeCount > MAX_PERFORMANCE_TRADES) {
          return await unavailable("WINDOW_TOO_LARGE");
        }

        const positions = await database.shadowPosition.findMany({
          where: {
            portfolioId: portfolio.id,
            status: { in: CLOSED_POSITION_STATUSES as never },
            closedAt: { gte: from, lte: to }
          },
          orderBy: { closedAt: "asc" },
          take: MAX_PERFORMANCE_TRADES,
          select: {
            id: true,
            portfolioId: true,
            strategyVersionId: true,
            assetId: true,
            direction: true,
            openedAt: true,
            closedAt: true,
            initialQuantity: true,
            averageEntryPrice: true,
            realizedPnl: true,
            feesPaid: true,
            asset: { select: { symbol: true } },
            entryOrder: { select: { tradeCandidateId: true } },
            fills: {
              orderBy: { occurredAt: "asc" },
              select: { quantity: true, slippageAmount: true, triggerType: true }
            }
          }
        });

        const candidateIds = positions
          .map((position) => position.entryOrder?.tradeCandidateId)
          .filter((value): value is string => typeof value === "string" && value.length > 0);
        const assessments =
          candidateIds.length === 0
            ? []
            : await database.riskAssessment.findMany({
                where: {
                  tradeCandidateId: { in: candidateIds },
                  status: RiskAssessmentStatus.PASS
                },
                orderBy: { assessedAt: "desc" },
                select: { tradeCandidateId: true, riskAmount: true }
              });
        const riskAmountByCandidate = new Map<string, string>();
        for (const assessment of assessments) {
          if (!riskAmountByCandidate.has(assessment.tradeCandidateId)) {
            riskAmountByCandidate.set(
              assessment.tradeCandidateId,
              String(assessment.riskAmount ?? "0")
            );
          }
        }

        // MAE/MFE need per-trade candle scans, which a synchronous Nexus read
        // must not do. They are reported as absent with the engine's own
        // reason rather than approximated.
        const trades: ClosedShadowTradeInput[] = positions.map((position) => {
          // Σ (per-unit adverse deviation × quantity), in decimal arithmetic.
          // A simulated cost must not round-trip through IEEE-754 any more than
          // a P/L must.
          let executionCost = DecimalValue.ZERO;
          for (const fill of position.fills) {
            try {
              executionCost = executionCost.add(
                DecimalValue.fromString(String(fill.slippageAmount ?? "0")).mul(
                  DecimalValue.fromString(String(fill.quantity ?? "0")),
                  RoundingMode.HALF_UP
                )
              );
            } catch {
              // A malformed stored decimal is skipped rather than guessed.
            }
          }
          const exitFills = position.fills.filter((fill) => fill.triggerType !== "ENTRY");
          const candidateId = position.entryOrder?.tradeCandidateId ?? null;
          return {
            positionId: position.id,
            portfolioId: position.portfolioId,
            strategyVersionId: position.strategyVersionId,
            assetId: position.assetId,
            symbol: position.asset?.symbol ?? null,
            direction: position.direction as "LONG" | "SHORT",
            marketRegime: null,
            exitReason:
              exitFills.length === 0 ? null : String(exitFills[exitFills.length - 1].triggerType),
            openedAt: position.openedAt?.toISOString() ?? null,
            closedAt: position.closedAt?.toISOString() ?? null,
            initialQuantity: String(position.initialQuantity ?? "0"),
            averageEntryPrice: String(position.averageEntryPrice ?? "0"),
            netPnl: String(position.realizedPnl ?? "0"),
            fees: String(position.feesPaid ?? "0"),
            simulatedExecutionCost: executionCost.toString(),
            plannedRiskAmount:
              candidateId === null ? null : (riskAmountByCandidate.get(candidateId) ?? null),
            maxAdversePrice: null,
            maxFavorablePrice: null
          };
        });

        const snapshots = await database.portfolioSnapshot.findMany({
          where: { portfolioId: portfolio.id, asOf: { gte: from, lte: to } },
          orderBy: { asOf: "asc" },
          take: MAX_EQUITY_POINTS,
          select: { asOf: true, tradingDateUtc: true, equity: true }
        });
        const dailyEquity = new Map<string, PortfolioEquityPointInput>();
        for (const snapshot of snapshots) {
          const day = snapshot.tradingDateUtc.toISOString().slice(0, 10);
          dailyEquity.set(day, {
            asOf: snapshot.asOf.toISOString(),
            tradingDateUtc: day,
            equity: String(snapshot.equity ?? "0")
          });
        }
        const equityCurve = [...dailyEquity.values()].sort((left, right) =>
          left.tradingDateUtc.localeCompare(right.tradingDateUtc)
        );

        const [assessedCandidates, riskRejectedCandidates, invalidCandidates, expiredCandidates] =
          await Promise.all([
            database.riskAssessment.count({
              where: { portfolioId: portfolio.id, assessedAt: { gte: from, lte: to } }
            }),
            database.riskAssessment.count({
              where: {
                portfolioId: portfolio.id,
                status: RiskAssessmentStatus.FAIL,
                assessedAt: { gte: from, lte: to }
              }
            }),
            database.tradeCandidate.count({
              where: {
                portfolioId: portfolio.id,
                status: TradeCandidateStatus.INVALID,
                decisionTime: { gte: from, lte: to }
              }
            }),
            database.tradeCandidate.count({
              where: {
                portfolioId: portfolio.id,
                status: TradeCandidateStatus.EXPIRED,
                decisionTime: { gte: from, lte: to }
              }
            })
          ]);

        const report = computeShadowPerformance({
          portfolioId: portfolio.id,
          window: { from: from.toISOString(), to: to.toISOString(), asOf: to.toISOString() },
          equityBase: String(portfolio.startingCash ?? "0"),
          trades,
          equityCurve,
          riskFunnel: {
            assessedCandidates,
            riskRejectedCandidates,
            invalidCandidates,
            expiredCandidates
          },
          sourceThroughPositionEventId: null,
          dataThroughAt: null
        });

        const overall = report.segments.find(
          (segment) =>
            segment.segmentType === ShadowPerformanceSegment.OVERALL && segment.segmentKey === "ALL"
        );
        if (overall === undefined) return await unavailable("NO_OVERALL_SEGMENT");

        const newestClose = trades
          .map((trade) => trade.closedAt)
          .filter((value): value is string => value !== null)
          .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

        server.log.info(
          {
            requestId: id,
            route: "/integrations/nexus/v1/performance",
            window: rawWindow,
            source: "computed_from_source",
            trades: trades.length
          },
          "Nexus read API performance served"
        );
        return reply.code(200).send(
          envelope(id, observedAt, newestClose, {
            ...deploymentFlags(),
            simulated: true,
            window: { ...windowView, asOf: to.toISOString() },
            availability: "available",
            unavailableReasonCode: null,
            engineVersion: sanitiseText(report.engineVersion, 40),
            dataThroughAt: newestClose,
            computedAt: observedAt.toISOString(),
            metrics: projectComputedMetrics(overall.metrics)
          })
        );
      } catch {
        server.log.warn(
          { requestId: id, reasonCode: "performance_read_failed" },
          "Nexus read API could not read performance"
        );
        return reply
          .code(503)
          .send(errorBody("source_unavailable", "The performance read is not available.", id));
      }
    }
  );

  /**
   * Structured SignalPilot problems.
   *
   * Every issue below originates from a *typed* column — a status enum, a
   * boolean, a persisted reason code — never from a log line. `BotLog.message`,
   * `BotRun.metadataJson`, `RiskEvent.payloadJson`, `RiskEvent.resolutionNote`,
   * `TradingAlertOutbox.lastError`/`payloadJson` and `TradingSession.killNote`
   * are all deliberately NOT read: they are free text or unbounded internal
   * state, and a problem that exists only as a log line is not yet a structured
   * issue. `description` is composed server-side from the structured fields
   * alone, so a reason code and a human sentence never get confused for one
   * another and no stored text can carry framing into a model context.
   *
   * An empty list therefore means "nothing from the sources listed in
   * `checkedSources`" — never "the whole system is healthy". `checkedSources`
   * ships on every response so that distinction survives into Nexus.
   */
  const ISSUE_SOURCES = [
    "trading_session",
    "portfolio",
    "worker_runs",
    "risk_events",
    "alert_outbox",
    "strategy_rejections",
    "order_rejections"
  ] as const;

  interface IssueView {
    readonly severity: "error" | "warning" | "info";
    readonly blocking: boolean;
    /**
     * Whether this problem belongs to one bot or to the deployment.
     *
     * Only the strategy/candidate sources carry a bot identity; session,
     * portfolio, worker, risk, alerting and order-rejection problems are
     * system-wide. Without this distinction a bot-scoped read still returns
     * system-wide rows, and "Warum läuft dieser Bot nicht?" gets answered with
     * an unrelated failed job — which is exactly what the live run produced.
     */
    readonly scope: "bot" | "system";
    readonly domain: string;
    readonly component: string;
    readonly reasonCode: string | null;
    readonly description: string;
    readonly at: string | null;
    readonly botId: string | null;
    readonly botName: string | null;
    readonly symbol: string | null;
  }

  server.get(
    "/issues",
    { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;
      if (rejectUnknownParameters(query, ["limit", "botId"], reply, id)) return;

      const limit = boundedLimit(query.limit);
      if (limit === null) {
        return reply
          .code(400)
          .send(errorBody("invalid_filter", `limit must be an integer 1..${MAX_LIMIT}.`, id));
      }
      // An opaque handle previously handed out by `/bots`. Validated as an
      // identifier, never interpolated into anything but an equality filter.
      const rawBotId = query.botId === undefined ? null : String(query.botId);
      if (rawBotId !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(rawBotId)) {
        return reply.code(400).send(errorBody("invalid_filter", "botId is malformed.", id));
      }

      const observedAt = new Date();
      const since = new Date(observedAt.getTime() - config.windowHours * 3_600_000);

      try {
        // The focused bot's own current state, read in *this* request.
        //
        // Without it a bot-scoped answer has an identity but no state, and a
        // model asked "why is it not running?" fills the gap by inventing one
        // ("it is deactivated") — the 2C.2c L2 failure. `enabled` here is the
        // assignment flag and nothing else; it is deliberately not widened
        // into "running", "trading", "healthy" or "eligible", which are
        // separate facts this endpoint does not establish.
        const subjectRows =
          rawBotId === null
            ? []
            : await database.strategyAssignment.findMany({
                where: { id: rawBotId },
                take: 1,
                select: {
                  id: true,
                  enabled: true,
                  timeframe: true,
                  assignmentConfigJson: true,
                  asset: { select: { symbol: true } },
                  strategy: { select: { key: true, name: true } }
                }
              });
        const subjectRow = subjectRows[0];
        const subjectConfig = (subjectRow?.assignmentConfigJson ?? null) as Record<
          string,
          unknown
        > | null;
        const subject =
          subjectRow === undefined
            ? null
            : {
                kind: "bot" as const,
                id: subjectRow.id,
                label:
                  sanitiseText(subjectRow.strategy?.name) ??
                  sanitiseText(subjectRow.strategy?.key),
                symbol: sanitiseText(subjectRow.asset?.symbol, 16),
                timeframe: sanitiseText(subjectRow.timeframe, 8),
                direction: sanitiseText(subjectConfig?.direction, 8),
                enabled: subjectRow.enabled === true,
                // Spelled out so the flag cannot be read as more than it is.
                enabledMeaning: "strategy_assignment_enabled_flag_only"
              };

        const [sessions, portfolios, failedRuns, riskEvents, deadAlerts, rejectedCandidates, rejectedOrders] =
          await Promise.all([
            database.tradingSession.findMany({
              where: { status: { notIn: ["CLOSED"] as never } },
              orderBy: { updatedAt: "desc" },
              take: 5,
              select: {
                status: true,
                mode: true,
                killSwitchEngaged: true,
                killReasonCode: true,
                reconciledAt: true,
                heartbeatAt: true,
                updatedAt: true
              }
            }),
            database.portfolio.findMany({
              where: { status: { not: PortfolioStatus.ACTIVE } },
              orderBy: { updatedAt: "desc" },
              take: 5,
              select: { key: true, status: true, updatedAt: true }
            }),
            database.botRun.findMany({
              where: { status: BotRunStatus.FAILED, startedAt: { gte: since } },
              orderBy: { startedAt: "desc" },
              take: limit,
              select: { jobName: true, startedAt: true }
            }),
            database.riskEvent.findMany({
              where: { createdAt: { gte: since }, acknowledgedAt: null },
              orderBy: { createdAt: "desc" },
              take: limit,
              select: { type: true, severity: true, reasonCode: true, createdAt: true }
            }),
            database.tradingAlertOutbox.findMany({
              where: {
                status: { in: [TradingAlertOutboxStatus.DEAD] as never },
                createdAt: { gte: since }
              },
              orderBy: { createdAt: "desc" },
              take: limit,
              select: { eventType: true, severity: true, reasonCode: true, createdAt: true }
            }),
            database.tradeCandidate.findMany({
              where: {
                decisionTime: { gte: since },
                ...(rawBotId === null ? {} : { strategyAssignmentId: rawBotId })
              },
              orderBy: { decisionTime: "desc" },
              take: limit,
              select: {
                status: true,
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
              where: { createdAt: { gte: since }, rejectionReasonCode: { not: null } },
              orderBy: { createdAt: "desc" },
              take: limit,
              select: {
                status: true,
                rejectionReasonCode: true,
                createdAt: true,
                asset: { select: { symbol: true } }
              }
            })
          ]);

        const issues: IssueView[] = [];

        for (const session of sessions) {
          const status = sanitiseText(session.status, 24);
          const mode = sanitiseText(session.mode, 16);
          if (session.killSwitchEngaged === true) {
            issues.push({
              severity: "error",
              blocking: true,
              scope: "system" as const,
              domain: "trading_session",
              component: "kill_switch",
              reasonCode: sanitiseText(session.killReasonCode, 48),
              description: "The trading kill switch is engaged; no shadow entries are taken.",
              at: isoOrNull(session.updatedAt),
              botId: null,
              botName: null,
              symbol: null
            });
          }
          if (status !== null && status !== "SHADOW_ACTIVE" && status !== "LIVE_ACTIVE") {
            issues.push({
              severity: "warning",
              blocking: true,
              scope: "system" as const,
              domain: "trading_session",
              component: "session_status",
              reasonCode: `SESSION_${status}`,
              description: `The ${mode ?? "trading"} session is in status ${status}, so it is not actively trading.`,
              at: isoOrNull(session.updatedAt),
              botId: null,
              botName: null,
              symbol: null
            });
          }
          if (session.reconciledAt === null) {
            issues.push({
              severity: "warning",
              blocking: true,
              scope: "system" as const,
              domain: "trading_session",
              component: "reconcile",
              reasonCode: "NEVER_RECONCILED",
              description: "The session has no successful reconcile on record.",
              at: isoOrNull(session.updatedAt),
              botId: null,
              botName: null,
              symbol: null
            });
          }
        }

        for (const portfolio of portfolios) {
          const status = sanitiseText(portfolio.status, 24);
          issues.push({
            severity: "warning",
            blocking: true,
            scope: "system" as const,
            domain: "portfolio",
            component: "portfolio_status",
            reasonCode: `PORTFOLIO_${status ?? "UNKNOWN"}`,
            description: `Portfolio ${sanitiseText(portfolio.key, 32) ?? "(unnamed)"} is in status ${status ?? "UNKNOWN"} rather than ACTIVE.`,
            at: isoOrNull(portfolio.updatedAt),
            botId: null,
            botName: null,
            symbol: null
          });
        }

        for (const run of failedRuns) {
          const job = sanitiseJobName(run.jobName);
          issues.push({
            severity: "error",
            blocking: false,
            scope: "system" as const,
            domain: "worker",
            component: "job_run",
            reasonCode: "JOB_RUN_FAILED",
            // The job name only. `metadataJson` is not read: it is unbounded
            // internal state and may carry anything the job put there.
            description: `Scheduled job ${job ?? "(unnamed)"} finished in status FAILED.`,
            at: isoOrNull(run.startedAt),
            botId: null,
            botName: null,
            symbol: null
          });
        }

        for (const event of riskEvents) {
          const severity = sanitiseText(event.severity, 16);
          issues.push({
            severity: severity === "CRITICAL" || severity === "HIGH" ? "error" : "warning",
            blocking: severity === "CRITICAL",
            scope: "system" as const,
            domain: "risk",
            component: sanitiseText(event.type, 48) ?? "risk_event",
            reasonCode: sanitiseText(event.reasonCode, 48),
            description: `An unacknowledged ${severity ?? "risk"} risk event is on record.`,
            at: isoOrNull(event.createdAt),
            botId: null,
            botName: null,
            symbol: null
          });
        }

        for (const alert of deadAlerts) {
          issues.push({
            severity: "error",
            blocking: false,
            scope: "system" as const,
            domain: "alerting",
            component: sanitiseText(alert.eventType, 48) ?? "alert",
            reasonCode: sanitiseText(alert.reasonCode, 48),
            // `lastError` is deliberately not read — it is a raw error string.
            description: "A safety alert exhausted every delivery attempt and was dead-lettered.",
            at: isoOrNull(alert.createdAt),
            botId: null,
            botName: null,
            symbol: null
          });
        }

        for (const candidate of rejectedCandidates) {
          const reasonCode =
            sanitiseText(candidate.decision?.reasonCode, 48) ??
            sanitiseText(candidate.invalidReasonCode, 48);
          if (reasonCode === null) continue;
          issues.push({
            // A strategy declining to trade is the strategy working, not a
            // fault: it is reported as information and never as an error, so
            // "the filter refused" can never be read as "the bot is broken".
            severity: "info",
            blocking: false,
            scope: "bot" as const,
            domain: "strategy_rejection",
            component: sanitiseText(candidate.status, 24) ?? "candidate",
            reasonCode,
            description: `The strategy did not produce a tradable candidate; the persisted decision reason is ${reasonCode}.`,
            at: isoOrNull(candidate.decisionTime),
            botId: candidate.strategyAssignment?.id ?? null,
            botName:
              sanitiseText(candidate.strategyAssignment?.strategy?.name) ??
              sanitiseText(candidate.strategyAssignment?.strategy?.key),
            symbol: sanitiseText(candidate.asset?.symbol, 16)
          });
        }

        for (const order of rejectedOrders) {
          issues.push({
            severity: "warning",
            blocking: false,
            scope: "system" as const,
            domain: "execution",
            component: sanitiseText(order.status, 24) ?? "shadow_order",
            reasonCode: sanitiseText(order.rejectionReasonCode, 48),
            description: "A simulated order was rejected before execution.",
            at: isoOrNull(order.createdAt),
            botId: null,
            botName: null,
            symbol: sanitiseText(order.asset?.symbol, 16)
          });
        }

        const severityRank = { error: 0, warning: 1, info: 2 } as const;
        issues.sort((a, b) => {
          if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
          if (severityRank[a.severity] !== severityRank[b.severity]) {
            return severityRank[a.severity] - severityRank[b.severity];
          }
          return (b.at ?? "") < (a.at ?? "") ? -1 : 1;
        });
        const shown = issues.slice(0, limit);
        const newest = issues
          .map((issue) => issue.at)
          .filter((value): value is string => value !== null)
          .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

        // Two lists rather than one flag on a shared list. A system-wide
        // problem is not this bot's cause unless a structured relation says
        // so, and nothing here establishes such a relation — so the two never
        // arrive in the same array.
        const botSpecificIssues = issues.filter(
          (issue) => issue.scope === "bot" && (rawBotId === null || issue.botId === rawBotId)
        );
        const systemIssues = issues.filter((issue) => issue.scope === "system");

        server.log.info(
          {
            requestId: id,
            route: "/integrations/nexus/v1/issues",
            returned: shown.length,
            total: issues.length
          },
          "Nexus read API issues served"
        );
        return reply.code(200).send(
          envelope(id, observedAt, newest, {
            ...deploymentFlags(),
            windowHours: config.windowHours,
            // Which sources were actually consulted. An empty `issues` list is
            // only ever a statement about these.
            checkedSources: ISSUE_SOURCES,
            coverage: "structured_sources_only",
            botId: rawBotId,
            // The focused bot's state, actually read in this request. `null`
            // with `subjectResolved: false` when the handle matches no
            // assignment — an unknown bot is not a bot in an unknown state.
            subject,
            subjectResolved: rawBotId === null ? null : subject !== null,
            returned: shown.length,
            total: issues.length,
            blockingCount: issues.filter((issue) => issue.blocking).length,
            // Split out so a bot-scoped read can never present a system-wide
            // failure as this bot's reason.
            botSpecificCount: botSpecificIssues.length,
            systemWideCount: systemIssues.length,
            botSpecificIssueCount: botSpecificIssues.length,
            systemIssueCount: systemIssues.length,
            botSpecificIssues: botSpecificIssues.slice(0, limit),
            systemIssues: systemIssues.slice(0, limit),
            bySeverity: {
              error: issues.filter((issue) => issue.severity === "error").length,
              warning: issues.filter((issue) => issue.severity === "warning").length,
              info: issues.filter((issue) => issue.severity === "info").length
            },
            issues: shown
          })
        );
      } catch {
        server.log.warn(
          { requestId: id, reasonCode: "issues_read_failed" },
          "Nexus read API could not read issues"
        );
        return reply
          .code(503)
          .send(errorBody("source_unavailable", "The issue read is not available.", id));
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Phase T3a: market. The one read that answers "how does the market look
  // right now" rather than "what is our system doing".
  //
  // Deliberately a *projection*, not an analysis. Every field below is either
  // a column of the newest `MarketRegimeSnapshot` — produced by the existing
  // `calculate:market-regime` job, which owns the definition — or the close of
  // the newest stored candle for one symbol. Nothing is computed here: no
  // percentage change, no trend word, no "bullish", no aggregate across
  // symbols. Re-deriving a regime in a read endpoint would give the same
  // question two sources of truth, which is exactly what the performance read
  // avoids by importing the metric engine instead of restating it.
  //
  // `reportJson` is *not* exposed. It is unbounded internal state and would
  // reach a model context as free text.
  // ─────────────────────────────────────────────────────────────────────────

  //: How many symbols may be reported. Server-decided; the caller has no say,
  //: so this endpoint takes no parameters at all.
  const MARKET_SYMBOL_LIMIT = 8;
  //: The timeframe whose newest candle is quoted. One timeframe, fixed here,
  //: so "the last close" cannot silently mean different things per symbol.
  const MARKET_TIMEFRAME = "1h";
  //: Length of that timeframe. A candle closing at T is the newest *completed*
  //: one until the next closes at T+1h, so its age has to be measured from
  //: when a successor could exist — not from its own close. Compared against
  //: the bare `staleAfterSeconds` (one hour) every quote flipped to VERALTET
  //: within minutes of the hour turning, and the first acceptance run reported
  //: eight current prices as stale.
  const MARKET_TIMEFRAME_MS = 3_600_000;

  server.get(
    "/market",
    { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = requestId(request);
      const query = (request.query ?? {}) as Record<string, unknown>;
      if (rejectUnknownParameters(query, [], reply, id)) return;

      const observedAt = new Date();

      try {
        const [snapshot, assets] = await Promise.all([
          database.marketRegimeSnapshot.findFirst({
            orderBy: { generatedAt: "desc" },
            select: {
              generatedAt: true,
              equityRegime: true,
              cryptoRegime: true,
              overallRegime: true,
              riskMode: true,
              confidence: true,
              summary: true,
              riskNote: true
            }
          }),
          database.asset.findMany({
            where: { assetType: AssetType.CRYPTO, isActive: true },
            orderBy: { symbol: "asc" },
            take: MARKET_SYMBOL_LIMIT,
            select: { id: true, symbol: true }
          })
        ]);

        // One bounded lookup per symbol. `take: 1` on an indexed
        // (assetId, timeframe, openTime) ordering — no history is transferred
        // and no series is returned, because a series is an analysis and this
        // endpoint does not do analysis.
        const quotes = await Promise.all(
          assets.map(async (asset: { id: string; symbol: string }) => {
            const candle = await database.candle.findFirst({
              where: { assetId: asset.id, timeframe: MARKET_TIMEFRAME },
              orderBy: { openTime: "desc" },
              select: { close: true, closeTime: true }
            });
            const lastCloseAt = candle === null ? null : isoOrNull(candle.closeTime);
            return {
              symbol: sanitiseText(asset.symbol, 16),
              timeframe: MARKET_TIMEFRAME,
              // `null` where no candle is stored. An absent price is absent,
              // never zero and never carried over from another symbol.
              lastClose: candle === null ? null : decimalOrNull(candle.close),
              lastCloseAt,
              // Per symbol, against the same threshold as the envelope. A
              // delisted pair keeps its last stored close for ever, and one
              // dead symbol must neither be presented as current nor drag the
              // eight live ones into "stale" with it — which is exactly what a
              // single envelope-wide oldest-wins rule did on the first run
              // (MATICUSDT, last candle 2024-09-10).
              stale:
                lastCloseAt === null ||
                observedAt.getTime() - new Date(lastCloseAt).getTime() >
                  MARKET_TIMEFRAME_MS + config.staleAfterSeconds * 1000
            };
          })
        );

        const regime =
          snapshot === null
            ? null
            : {
                generatedAt: isoOrNull(snapshot.generatedAt),
                equityRegime: sanitiseText(snapshot.equityRegime, 24),
                cryptoRegime: sanitiseText(snapshot.cryptoRegime, 24),
                overallRegime: sanitiseText(snapshot.overallRegime, 24),
                riskMode: sanitiseText(snapshot.riskMode, 24),
                // 0-100 as the job writes it. Not rescaled, not rounded into a
                // word like "hoch" — that mapping is a judgement this endpoint
                // does not own.
                confidence: Number.isFinite(snapshot.confidence) ? snapshot.confidence : null,
                summary: sanitiseText(snapshot.summary, MAX_TEXT_LENGTH),
                riskNote: sanitiseText(snapshot.riskNote, MAX_TEXT_LENGTH)
              };

        // The envelope timestamp is the regime snapshot's, because the regime
        // *is* this endpoint's market statement; the quotes are supporting
        // detail and each carries its own age above. Falling back to the
        // newest quote keeps the envelope meaningful when no snapshot exists
        // at all.
        const quoteTimestamps = quotes
          .map((quote: { lastCloseAt: string | null }) => quote.lastCloseAt)
          .filter((value: string | null): value is string => value !== null);
        const newestQuoteAt =
          quoteTimestamps.length === 0
            ? null
            : quoteTimestamps.reduce((newest: string, value: string) =>
                value > newest ? value : newest
              );
        const sourceUpdatedAt = regime?.generatedAt ?? newestQuoteAt;

        server.log.info(
          {
            requestId: id,
            route: "/integrations/nexus/v1/market",
            regimeAvailable: regime !== null,
            symbols: quotes.length
          },
          "Nexus read API market served"
        );

        return reply.code(200).send(
          envelope(id, observedAt, sourceUpdatedAt, {
            ...deploymentFlags(),
            // What this read consulted, so an empty answer is a statement
            // about exactly these and nothing wider.
            checkedSources: ["market_regime_snapshot", "candle"],
            coverage: "latest_regime_snapshot_and_last_stored_close",
            regimeAvailable: regime !== null,
            regime,
            quoteTimeframe: MARKET_TIMEFRAME,
            returned: quotes.length,
            // Counted server-side so a reader never has to derive "how much of
            // this is current" from the rows.
            freshQuoteCount: quotes.filter((quote: { stale: boolean }) => !quote.stale).length,
            staleQuoteCount: quotes.filter((quote: { stale: boolean }) => quote.stale).length,
            quotes
          })
        );
      } catch {
        server.log.warn(
          { requestId: id, reasonCode: "market_read_failed" },
          "Nexus read API could not read market state"
        );
        return reply
          .code(503)
          .send(errorBody("source_unavailable", "The market read is not available.", id));
      }
    }
  );
}
