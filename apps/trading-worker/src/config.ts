/**
 * `apps/trading-worker` process-level configuration.
 *
 * Specification: P5 task, "Konfiguration" — "Der Worker darf nur starten,
 * wenn mindestens gilt: TRADING_MODE=SHADOW, TRADING_SHADOW_ENABLED=true,
 * TRADING_WORKER_ENABLED=true, ENABLE_LIVE_TRADING=false. Einzelne Jobs
 * benötigen zusätzlich ihr eigenes Flag."
 *
 * This module owns exactly one extra layer on top of the P1–P4 gates already
 * in `lib/tradingSafety.ts`: whether the *scheduler* may even attempt each
 * job on its timer. It never loosens or replaces those gates — every
 * scheduled job still calls its own P4 job function, which re-checks its own
 * flag (`TRADING_STRATEGY_V1_ENABLED`, `TRADING_SHADOW_EXECUTION_ENABLED`,
 * ...) independently. Two independent "yes" answers are required before any
 * scheduled job runs at all, matching ADR 0006's "Aktivierung benötigt alle
 * Schichten gleichzeitig".
 *
 * Every value is parsed with the exact same fail-closed strict-boolean
 * parser the P1–P4 gates use (`tradingSafety.parseStrictBoolean`) — an
 * unrecognised value is a configuration error, never a silent default.
 */

import { hostname } from "node:os";

import {
  checkShadowBaseAllowed,
  parseStrictBoolean,
  type EnvSource,
  type TradingFlagSnapshot
} from "./lib/tradingSafety.js";

export interface SchedulerJobFlags {
  readonly dayStartJobEnabled: boolean;
  readonly candidateJobEnabled: boolean;
  readonly riskJobEnabled: boolean;
  readonly orderJobEnabled: boolean;
  readonly fillJobEnabled: boolean;
  readonly positionMonitorJobEnabled: boolean;
  readonly reconciliationJobEnabled: boolean;
}

export interface TradingWorkerConfig {
  readonly masterFlags: TradingFlagSnapshot;
  readonly schedulerEnabled: boolean;
  readonly jobFlags: SchedulerJobFlags;
  /** Stable identity for this process's leases (`lib/leases.ts`). */
  readonly ownerId: string;
}

export type ResolveTradingWorkerConfigResult =
  | { readonly ok: true; readonly config: TradingWorkerConfig }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };

const FLAG_DEFINITIONS = [
  ["TRADING_WORKER_ENABLED", "workerEnabled"],
  ["TRADING_SCHEDULER_ENABLED", "schedulerEnabled"],
  ["TRADING_DAY_START_JOB_ENABLED", "dayStartJobEnabled"],
  ["TRADING_CANDIDATE_JOB_ENABLED", "candidateJobEnabled"],
  ["TRADING_RISK_JOB_ENABLED", "riskJobEnabled"],
  ["TRADING_ORDER_JOB_ENABLED", "orderJobEnabled"],
  ["TRADING_FILL_JOB_ENABLED", "fillJobEnabled"],
  ["TRADING_POSITION_MONITOR_JOB_ENABLED", "positionMonitorJobEnabled"],
  ["TRADING_RECONCILIATION_JOB_ENABLED", "reconciliationJobEnabled"]
] as const;

/**
 * Resolve the full P5 configuration. Fails closed (`ok: false`) whenever any
 * flag is unset-but-required, malformed, or the shared P1–P4 base gate
 * itself refuses (unknown `TRADING_MODE`, `ENABLE_LIVE_TRADING=true`, the
 * shadow master flag off, or `TRADING_WORKER_ENABLED` itself off — the
 * worker's own safe default). The caller decides what "not ok" means for the
 * process (`index.ts`: idle and keep the container alive, never a silent
 * enable).
 */
export function resolveTradingWorkerConfig(env: EnvSource = process.env): ResolveTradingWorkerConfigResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) {
    return { ok: false, reasonCode: base.reasonCode, message: base.message };
  }

  const parsedFlags: Record<string, boolean> = {};
  for (const [envName, key] of FLAG_DEFINITIONS) {
    const parsed = parseStrictBoolean(envName, env[envName], false);
    if (!parsed.ok) {
      return { ok: false, reasonCode: "CONFIG_INVALID", message: parsed.message };
    }
    parsedFlags[key] = parsed.value;
  }

  if (!parsedFlags.workerEnabled) {
    return {
      ok: false,
      reasonCode: "TRADING_WORKER_DISABLED",
      message: "TRADING_WORKER_ENABLED is not true — this is the safe default."
    };
  }

  const ownerId = env.TRADING_WORKER_OWNER_ID?.trim() || `trading-worker:${hostname()}:${process.pid}`;

  return {
    ok: true,
    config: {
      masterFlags: base.flags,
      schedulerEnabled: parsedFlags.schedulerEnabled,
      jobFlags: {
        dayStartJobEnabled: parsedFlags.dayStartJobEnabled,
        candidateJobEnabled: parsedFlags.candidateJobEnabled,
        riskJobEnabled: parsedFlags.riskJobEnabled,
        orderJobEnabled: parsedFlags.orderJobEnabled,
        fillJobEnabled: parsedFlags.fillJobEnabled,
        positionMonitorJobEnabled: parsedFlags.positionMonitorJobEnabled,
        reconciliationJobEnabled: parsedFlags.reconciliationJobEnabled
      },
      ownerId
    }
  };
}
