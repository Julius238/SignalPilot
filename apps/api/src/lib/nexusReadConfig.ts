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
 *    a well-formed token digest is configured. An unconfigured or malformed
 *    deployment leaves the routes unregistered — a 404, never an open door.
 * 2. Only the SHA-256 **digest** of the service token lives in the environment.
 *    SignalPilot never stores or logs the token itself.
 * 3. The service token may not be derived from `AUTH_SESSION_SECRET`. The admin
 *    browser session and the Nexus service identity must be separable, and
 *    reusing one as the other would make revocation impossible.
 * 4. Every flag is parsed with the existing strict, fail-closed boolean parser
 *    rather than a second, possibly diverging copy.
 *
 * This module touches neither the database nor any trading state. It only
 * reports whether the read API may be served, and with which bounds.
 */

import { createHash } from "node:crypto";

import { parseStrictBoolean } from "@signalpilot/trading-worker/lib/tradingSafety";

/** Hex-encoded SHA-256 digest: exactly 64 lowercase hex characters. */
const TOKEN_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export interface NexusReadConfig {
  readonly enabled: boolean;
  /** SHA-256 digest of the accepted service token, hex encoded. */
  readonly tokenDigest: string;
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
  tokenDigest: "",
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

export function resolveNexusReadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ResolveNexusReadConfigResult {
  const enabled = parseStrictBoolean("NEXUS_READ_API_ENABLED", env.NEXUS_READ_API_ENABLED, false);
  if (!enabled.ok) return { ok: false, reasonCode: "CONFIG_INVALID", message: enabled.message };
  if (!enabled.value) return { ok: true, config: DISABLED };

  const rawDigest = (env.NEXUS_READ_TOKEN_SHA256 ?? "").trim().toLowerCase();
  if (!TOKEN_DIGEST_PATTERN.test(rawDigest)) {
    return {
      ok: false,
      reasonCode: "TOKEN_DIGEST_INVALID",
      message:
        "NEXUS_READ_TOKEN_SHA256 must be the hex-encoded SHA-256 digest of the Nexus service token (64 hex characters)."
    };
  }

  // The Nexus service identity must not be the admin session secret in
  // disguise: they have different lifetimes, different blast radius and must be
  // revocable independently.
  const sessionSecret = env.AUTH_SESSION_SECRET;
  if (sessionSecret && sha256Hex(sessionSecret) === rawDigest) {
    return {
      ok: false,
      reasonCode: "TOKEN_REUSES_SESSION_SECRET",
      message: "The Nexus service token must not be the value of AUTH_SESSION_SECRET."
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
      tokenDigest: rawDigest,
      windowHours: windowHours.value,
      staleAfterSeconds: staleAfterSeconds.value,
      rateLimitMax: rateLimitMax.value
    }
  };
}
