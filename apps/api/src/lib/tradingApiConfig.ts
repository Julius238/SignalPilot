/**
 * Fail-closed configuration gate for the `/trading` API route group.
 *
 * Specification: P6 task, "Feature Flags" — "Lesende Trading-Routen nur bei
 * aktivierter Trading API. Schreiboperationen benötigen zusätzlich
 * TRADING_MODE=SHADOW, TRADING_SHADOW_ENABLED=true,
 * TRADING_API_OPERATIONS_ENABLED=true, ENABLE_LIVE_TRADING=false. Unbekannte
 * Konfiguration blockiert fail-closed."
 *
 * Reuses `@signalpilot/trading-worker`'s own strict-boolean parser and shared
 * shadow-only base gate rather than a second, possibly diverging copy — the
 * same P1–P5 flags decide whether shadow trading exists at all; this module
 * only adds the two API-specific flags on top.
 *
 * `server.ts` calls `resolveTradingApiConfig` once at startup and registers
 * the read route group only if `readEnabled`, and the operations route group
 * only if `operationsEnabled` — never both by default (P5/P6's shared
 * fail-closed convention: an unset or malformed flag blocks, it never falls
 * back to "on").
 */

import { checkShadowBaseAllowed, parseStrictBoolean } from "@signalpilot/trading-worker/lib/tradingSafety";

export interface TradingApiConfig {
  readonly readEnabled: boolean;
  readonly operationsEnabled: boolean;
}

export type ResolveTradingApiConfigResult =
  | { readonly ok: true; readonly config: TradingApiConfig }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };

export function resolveTradingApiConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ResolveTradingApiConfigResult {
  const apiEnabled = parseStrictBoolean("TRADING_API_ENABLED", env.TRADING_API_ENABLED, false);
  const operationsFlag = parseStrictBoolean(
    "TRADING_API_OPERATIONS_ENABLED",
    env.TRADING_API_OPERATIONS_ENABLED,
    false
  );
  if (!apiEnabled.ok) return { ok: false, reasonCode: "CONFIG_INVALID", message: apiEnabled.message };
  if (!operationsFlag.ok) return { ok: false, reasonCode: "CONFIG_INVALID", message: operationsFlag.message };

  if (!apiEnabled.value) {
    return { ok: true, config: { readEnabled: false, operationsEnabled: false } };
  }

  if (!operationsFlag.value) {
    return { ok: true, config: { readEnabled: true, operationsEnabled: false } };
  }

  // Operations additionally require the full shadow-only base gate: SHADOW
  // mode, the shadow master flag, and never ENABLE_LIVE_TRADING=true.
  const base = checkShadowBaseAllowed(env);
  return { ok: true, config: { readEnabled: true, operationsEnabled: base.allowed } };
}
