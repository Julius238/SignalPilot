/**
 * Fail-closed configuration gate for the Nexus read-only integration API
 * (`/integrations/nexus/v1/*`).
 *
 * Contract: `docs/integrations/signalpilot-integration-contract.md` in the Nexus
 * repository — "SignalPilot stellt eine eigene Service Identity `nexus` bereit
 * […] Auth muss fail closed sein. `API_AUTH_ENABLED=false` darf diese Routen
 * nicht öffnen."
 *
 * Design decisions, deliberately narrow for this first integration step:
 *
 * 1. The route group is registered **only** when it is explicitly enabled *and*
 *    a well-formed, correctly scoped token digest is configured. An
 *    unconfigured or malformed deployment leaves the routes unregistered — a
 *    404, never an open door.
 * 2. Only the SHA-256 **digest** of the service token lives in the environment.
 *    SignalPilot never stores or logs the token itself.
 * 3. The service token may not be derived from `AUTH_SESSION_SECRET`. The admin
 *    browser session and the Nexus service identity must be separable, and
 *    reusing one as the other would make revocation impossible.
 * 4. Every flag is parsed with the existing strict, fail-closed boolean parser
 *    rather than a second, possibly diverging copy.
 * 5. The service identity carries an explicit scope (`nexus:read`, currently
 *    the only value this route accepts) and an optional expiry. A second,
 *    time-bounded "previous" token may be configured during rotation so that
 *    SignalPilot and Nexus never need a synchronised, simultaneous restart —
 *    SignalPilot accepts both until the previous token's window ends.
 *
 * This module touches neither the database nor any trading state. It only
 * reports whether the read API may be served, and with which bounds.
 */

import { createHash } from "node:crypto";

import { parseStrictBoolean } from "@signalpilot/trading-worker/lib/tradingSafety";

/** Hex-encoded SHA-256 digest: exactly 64 lowercase hex characters. */
const TOKEN_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** The only scope this route accepts. Not configurable. */
export const NEXUS_READ_REQUIRED_SCOPE = "nexus:read";

export interface NexusServiceToken {
  /** SHA-256 digest of the accepted service token, hex encoded. */
  readonly digest: string;
  /** Must equal {@link NEXUS_READ_REQUIRED_SCOPE}. */
  readonly scope: string;
  /** Optional validity window end. `null` means the token does not expire. */
  readonly expiresAt: Date | null;
}

export interface NexusReadConfig {
  readonly enabled: boolean;
  readonly currentToken: NexusServiceToken;
  /**
   * A still-valid predecessor token, present only during a rotation window.
   * Both `currentToken` and `previousToken` are accepted until the previous
   * token's `expiresAt` passes — no restart is required at that point, the
   * expiry is enforced per request.
   */
  readonly previousToken: NexusServiceToken | null;
  /** Lookback window for worker and market-event freshness reads, in hours. */
  readonly windowHours: number;
  /** Age above which the reported status counts as stale, in seconds. */
  readonly staleAfterSeconds: number;
  /** Requests per minute permitted on the Nexus routes. */
  readonly rateLimitMax: number;
}

export type ResolveNexusReadConfigResult =
  | { readonly ok: true; readonly config: NexusReadConfig }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };

const DISABLED: NexusReadConfig = {
  enabled: false,
  currentToken: { digest: "", scope: "", expiresAt: null },
  previousToken: null,
  windowHours: 24,
  staleAfterSeconds: 3600,
  rateLimitMax: 60
};

function parseBoundedInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      message: `${name} must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}.`
    };
  }
  return { ok: true, value: parsed };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseTokenDigest(
  varName: string,
  raw: string | undefined,
  reasonCode: string
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reasonCode: string; readonly message: string } {
  const value = (raw ?? "").trim().toLowerCase();
  if (!TOKEN_DIGEST_PATTERN.test(value)) {
    return {
      ok: false,
      reasonCode,
      message: `${varName} must be the hex-encoded SHA-256 digest of the Nexus service token (64 hex characters).`
    };
  }
  return { ok: true, value };
}

function parseScope(
  varName: string,
  raw: string | undefined,
  reasonCode: string
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reasonCode: string; readonly message: string } {
  const value = (raw ?? "").trim();
  if (value !== NEXUS_READ_REQUIRED_SCOPE) {
    return {
      ok: false,
      reasonCode,
      message: `${varName} must be exactly "${NEXUS_READ_REQUIRED_SCOPE}", got ${JSON.stringify(raw ?? "")}.`
    };
  }
  return { ok: true, value };
}

function parseIsoDate(
  varName: string,
  raw: string | undefined,
  reasonCode: string
): { readonly ok: true; readonly value: Date | null } | { readonly ok: false; readonly reasonCode: string; readonly message: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      reasonCode,
      message: `${varName} must be a valid ISO-8601 timestamp, got ${JSON.stringify(raw)}.`
    };
  }
  return { ok: true, value: parsed };
}

/** The Nexus service identity must not be the admin session secret in
 * disguise: they have different lifetimes, different blast radius and must be
 * revocable independently. */
function rejectsSessionSecretReuse(
  digest: string,
  sessionSecret: string | undefined,
  reasonCode: string
): { readonly ok: false; readonly reasonCode: string; readonly message: string } | null {
  if (sessionSecret && sha256Hex(sessionSecret) === digest) {
    return {
      ok: false,
      reasonCode,
      message: "The Nexus service token must not be the value of AUTH_SESSION_SECRET."
    };
  }
  return null;
}

export function resolveNexusReadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ResolveNexusReadConfigResult {
  const enabled = parseStrictBoolean("NEXUS_READ_API_ENABLED", env.NEXUS_READ_API_ENABLED, false);
  if (!enabled.ok) return { ok: false, reasonCode: "CONFIG_INVALID", message: enabled.message };
  if (!enabled.value) return { ok: true, config: DISABLED };

  const sessionSecret = env.AUTH_SESSION_SECRET;

  const currentDigest = parseTokenDigest("NEXUS_READ_TOKEN_SHA256", env.NEXUS_READ_TOKEN_SHA256, "TOKEN_DIGEST_INVALID");
  if (!currentDigest.ok) return currentDigest;

  const currentReuse = rejectsSessionSecretReuse(currentDigest.value, sessionSecret, "TOKEN_REUSES_SESSION_SECRET");
  if (currentReuse) return currentReuse;

  const currentScope = parseScope("NEXUS_READ_TOKEN_SCOPE", env.NEXUS_READ_TOKEN_SCOPE, "TOKEN_SCOPE_INVALID");
  if (!currentScope.ok) return currentScope;

  const currentExpiresAt = parseIsoDate(
    "NEXUS_READ_TOKEN_EXPIRES_AT",
    env.NEXUS_READ_TOKEN_EXPIRES_AT,
    "TOKEN_EXPIRES_AT_INVALID"
  );
  if (!currentExpiresAt.ok) return currentExpiresAt;
  if (currentExpiresAt.value !== null && currentExpiresAt.value.getTime() <= Date.now()) {
    return {
      ok: false,
      reasonCode: "TOKEN_ALREADY_EXPIRED",
      message: "NEXUS_READ_TOKEN_EXPIRES_AT is in the past. Issue a new current token instead of starting with an expired one."
    };
  }

  const currentToken: NexusServiceToken = {
    digest: currentDigest.value,
    scope: currentScope.value,
    expiresAt: currentExpiresAt.value
  };

  // The previous-token slot only exists during a rotation window. It is
  // opt-in per deployment: absent PREVIOUS_SHA256 means no rotation is in
  // progress and the field is simply omitted.
  let previousToken: NexusServiceToken | null = null;
  const rawPreviousDigest = (env.NEXUS_READ_TOKEN_PREVIOUS_SHA256 ?? "").trim();
  if (rawPreviousDigest !== "") {
    const previousDigest = parseTokenDigest(
      "NEXUS_READ_TOKEN_PREVIOUS_SHA256",
      rawPreviousDigest,
      "PREVIOUS_TOKEN_DIGEST_INVALID"
    );
    if (!previousDigest.ok) return previousDigest;

    const previousReuse = rejectsSessionSecretReuse(
      previousDigest.value,
      sessionSecret,
      "PREVIOUS_TOKEN_REUSES_SESSION_SECRET"
    );
    if (previousReuse) return previousReuse;

    const previousScope = parseScope(
      "NEXUS_READ_TOKEN_PREVIOUS_SCOPE",
      env.NEXUS_READ_TOKEN_PREVIOUS_SCOPE,
      "PREVIOUS_TOKEN_SCOPE_INVALID"
    );
    if (!previousScope.ok) return previousScope;

    // A previous token without an expiry is not a rotation window, it is a
    // second permanent token — refuse it rather than silently doubling the
    // set of forever-valid credentials.
    const rawPreviousExpiresAt = (env.NEXUS_READ_TOKEN_PREVIOUS_EXPIRES_AT ?? "").trim();
    if (rawPreviousExpiresAt === "") {
      return {
        ok: false,
        reasonCode: "PREVIOUS_TOKEN_EXPIRES_AT_REQUIRED",
        message: "NEXUS_READ_TOKEN_PREVIOUS_EXPIRES_AT is required whenever a previous token is configured."
      };
    }
    const previousExpiresAt = parseIsoDate(
      "NEXUS_READ_TOKEN_PREVIOUS_EXPIRES_AT",
      rawPreviousExpiresAt,
      "PREVIOUS_TOKEN_EXPIRES_AT_INVALID"
    );
    if (!previousExpiresAt.ok) return previousExpiresAt;
    if (previousExpiresAt.value === null || previousExpiresAt.value.getTime() <= Date.now()) {
      return {
        ok: false,
        reasonCode: "PREVIOUS_TOKEN_ALREADY_EXPIRED",
        message: "NEXUS_READ_TOKEN_PREVIOUS_EXPIRES_AT must be in the future. Remove the previous-token variables instead of keeping an expired rotation window configured."
      };
    }

    previousToken = {
      digest: previousDigest.value,
      scope: previousScope.value,
      expiresAt: previousExpiresAt.value
    };
  }

  const windowHours = parseBoundedInteger(
    "NEXUS_READ_WINDOW_HOURS",
    env.NEXUS_READ_WINDOW_HOURS,
    24,
    1,
    168
  );
  if (!windowHours.ok)
    return { ok: false, reasonCode: "CONFIG_INVALID", message: windowHours.message };

  const staleAfterSeconds = parseBoundedInteger(
    "NEXUS_READ_STALE_AFTER_SECONDS",
    env.NEXUS_READ_STALE_AFTER_SECONDS,
    3600,
    30,
    86_400
  );
  if (!staleAfterSeconds.ok)
    return { ok: false, reasonCode: "CONFIG_INVALID", message: staleAfterSeconds.message };

  const rateLimitMax = parseBoundedInteger(
    "NEXUS_READ_RATE_LIMIT_MAX",
    env.NEXUS_READ_RATE_LIMIT_MAX,
    60,
    1,
    600
  );
  if (!rateLimitMax.ok)
    return { ok: false, reasonCode: "CONFIG_INVALID", message: rateLimitMax.message };

  return {
    ok: true,
    config: {
      enabled: true,
      currentToken,
      previousToken,
      windowHours: windowHours.value,
      staleAfterSeconds: staleAfterSeconds.value,
      rateLimitMax: rateLimitMax.value
    }
  };
}
