/**
 * Fail-closed configuration gate for the manual shadow trading jobs.
 *
 * Specification:
 *   docs/trading/02-shadow-trading-target-architecture.md, "Feature-Flags und sichere Defaults"
 *   docs/trading/06-risk-engine-specification.md, `R-001-SHADOW-MODE`
 *   docs/trading/decisions/0006-fail-closed-session-and-kill-switch.md
 *
 * Every flag defaults to the blocking value and an unknown value never falls
 * back to a permissive default — it is a configuration error. Four independent
 * conditions must hold at once before the job may run:
 *
 *   ENABLE_LIVE_TRADING=false
 *   TRADING_MODE=SHADOW
 *   TRADING_SHADOW_ENABLED=true
 *   TRADING_STRATEGY_V1_ENABLED=true   (candidate generation)
 *   TRADING_RISK_V1_ENABLED=true       (risk assessment)
 *   TRADING_BOOTSTRAP_ENABLED=true     (one-off operations bootstrap)
 *
 * P4 adds three further independent job flags, each still gated behind the
 * same shadow-only base (docs/trading/10, P4 "Sicherheitsgrenzen"):
 *
 *   TRADING_SHADOW_EXECUTION_ENABLED=true          (order creation and fills)
 *   TRADING_SHADOW_POSITION_MONITOR_ENABLED=true   (stop/TP/time exits)
 *   TRADING_SHADOW_RECONCILIATION_ENABLED=true     (ledger reconciliation, day rollover)
 *
 * This module does not touch the database, does not create a session and does
 * not activate anything. It only reports whether the job may start.
 */

import {
  TradingBuildCapability,
  TradingMode,
  TradingReasonCode,
  checkShadowOnlyCapability,
  type TradingCapabilityContext
} from "@signalpilot/trading-domain";

/**
 * Shadow v1 has no exchange adapter, so the binary reports `SHADOW_ONLY`
 * unconditionally (ADR 0001). The constant exists so the guard has something to
 * compare against and a capability test has something to assert.
 */
export const TRADING_BUILD_CAPABILITY: string = TradingBuildCapability.SHADOW_ONLY;

/**
 * Reason codes owned by the worker gate. The shared domain codes cover build,
 * mode, live-trading and master-flag refusals; only the per-strategy job flag
 * needs a code of its own, and it stays here so the frozen P1 domain package is
 * not extended by a later work package.
 */
export const ShadowJobReasonCode = {
  STRATEGY_V1_DISABLED: "STRATEGY_V1_DISABLED",
  RISK_V1_DISABLED: "RISK_V1_DISABLED",
  BOOTSTRAP_DISABLED: "BOOTSTRAP_DISABLED",
  EXECUTION_DISABLED: "EXECUTION_DISABLED",
  POSITION_MONITOR_DISABLED: "POSITION_MONITOR_DISABLED",
  RECONCILIATION_DISABLED: "RECONCILIATION_DISABLED",
  // Work package 8. Each of the four is independent on purpose: computing
  // performance, recording an alert, delivering it and pruning technical rows
  // are four separate risks and must be switchable separately.
  PERFORMANCE_JOB_DISABLED: "PERFORMANCE_JOB_DISABLED",
  ALERT_OUTBOX_DISABLED: "ALERT_OUTBOX_DISABLED",
  ALERT_DELIVERY_DISABLED: "ALERT_DELIVERY_DISABLED",
  RETENTION_DISABLED: "RETENTION_DISABLED"
} as const;
export type ShadowJobReasonCode = (typeof ShadowJobReasonCode)[keyof typeof ShadowJobReasonCode];

export type TradingGateReasonCode = TradingReasonCode | ShadowJobReasonCode;

export interface TradingFlagSnapshot {
  readonly buildCapability: string;
  readonly enableLiveTrading: boolean;
  readonly tradingMode: string;
  readonly shadowEnabled: boolean;
  readonly strategyV1Enabled: boolean;
  readonly riskV1Enabled: boolean;
  readonly bootstrapEnabled: boolean;
  readonly executionEnabled: boolean;
  readonly positionMonitorEnabled: boolean;
  readonly reconciliationEnabled: boolean;
  readonly performanceJobEnabled: boolean;
  readonly alertOutboxEnabled: boolean;
  readonly alertDeliveryEnabled: boolean;
  readonly retentionEnabled: boolean;
}

export type TradingGateResult =
  | { readonly allowed: true; readonly flags: TradingFlagSnapshot }
  | {
      readonly allowed: false;
      readonly reasonCode: TradingGateReasonCode;
      readonly message: string;
      readonly flags: TradingFlagSnapshot | null;
    };

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Strict boolean: only the literal strings, never a truthiness coercion.
 * Exported so `config.ts` (the P5 scheduler's own flags) parses booleans the
 * exact same fail-closed way instead of a second, possibly diverging copy.
 */
export function parseStrictBoolean(
  name: string,
  raw: string | undefined,
  fallback: boolean
): { readonly ok: true; readonly value: boolean } | { readonly ok: false; readonly message: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return { ok: true, value: true };
  if (normalized === "false") return { ok: true, value: false };
  return { ok: false, message: `${name} must be "true" or "false", got ${JSON.stringify(raw)}.` };
}

function parseTradingMode(
  raw: string | undefined
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: TradingMode.DISABLED };
  const normalized = raw.trim().toUpperCase();
  if (normalized === TradingMode.DISABLED || normalized === TradingMode.SHADOW) {
    return { ok: true, value: normalized };
  }
  return {
    ok: false,
    message: `TRADING_MODE must be DISABLED or SHADOW, got ${JSON.stringify(raw)}.`
  };
}

/**
 * Shared part of the gate: shadow-only build, no live trading, `TRADING_MODE`
 * `SHADOW` and the master flag on. Job-specific flags are checked on top.
 */
export function checkShadowBaseAllowed(env: EnvSource = process.env): TradingGateResult {
  const liveTrading = parseStrictBoolean("ENABLE_LIVE_TRADING", env.ENABLE_LIVE_TRADING, false);
  const shadowEnabled = parseStrictBoolean(
    "TRADING_SHADOW_ENABLED",
    env.TRADING_SHADOW_ENABLED,
    false
  );
  const strategyEnabled = parseStrictBoolean(
    "TRADING_STRATEGY_V1_ENABLED",
    env.TRADING_STRATEGY_V1_ENABLED,
    false
  );
  const riskEnabled = parseStrictBoolean(
    "TRADING_RISK_V1_ENABLED",
    env.TRADING_RISK_V1_ENABLED,
    false
  );
  const bootstrapEnabled = parseStrictBoolean(
    "TRADING_BOOTSTRAP_ENABLED",
    env.TRADING_BOOTSTRAP_ENABLED,
    false
  );
  const executionEnabled = parseStrictBoolean(
    "TRADING_SHADOW_EXECUTION_ENABLED",
    env.TRADING_SHADOW_EXECUTION_ENABLED,
    false
  );
  const positionMonitorEnabled = parseStrictBoolean(
    "TRADING_SHADOW_POSITION_MONITOR_ENABLED",
    env.TRADING_SHADOW_POSITION_MONITOR_ENABLED,
    false
  );
  const reconciliationEnabled = parseStrictBoolean(
    "TRADING_SHADOW_RECONCILIATION_ENABLED",
    env.TRADING_SHADOW_RECONCILIATION_ENABLED,
    false
  );
  const performanceJobEnabled = parseStrictBoolean(
    "TRADING_PERFORMANCE_JOB_ENABLED",
    env.TRADING_PERFORMANCE_JOB_ENABLED,
    false
  );
  const alertOutboxEnabled = parseStrictBoolean(
    "TRADING_ALERT_OUTBOX_ENABLED",
    env.TRADING_ALERT_OUTBOX_ENABLED,
    false
  );
  const alertDeliveryEnabled = parseStrictBoolean(
    "TRADING_ALERT_DELIVERY_ENABLED",
    env.TRADING_ALERT_DELIVERY_ENABLED,
    false
  );
  const retentionEnabled = parseStrictBoolean(
    "TRADING_RETENTION_ENABLED",
    env.TRADING_RETENTION_ENABLED,
    false
  );
  const tradingMode = parseTradingMode(env.TRADING_MODE);

  for (const parsed of [
    liveTrading,
    shadowEnabled,
    strategyEnabled,
    riskEnabled,
    bootstrapEnabled,
    executionEnabled,
    positionMonitorEnabled,
    reconciliationEnabled,
    performanceJobEnabled,
    alertOutboxEnabled,
    alertDeliveryEnabled,
    retentionEnabled,
    tradingMode
  ]) {
    if (!parsed.ok) {
      return {
        allowed: false,
        reasonCode: TradingReasonCode.CONFIG_INVALID,
        message: parsed.message,
        flags: null
      };
    }
  }

  const flags: TradingFlagSnapshot = {
    buildCapability: TRADING_BUILD_CAPABILITY,
    enableLiveTrading: (liveTrading as { value: boolean }).value,
    tradingMode: (tradingMode as { value: string }).value,
    shadowEnabled: (shadowEnabled as { value: boolean }).value,
    strategyV1Enabled: (strategyEnabled as { value: boolean }).value,
    riskV1Enabled: (riskEnabled as { value: boolean }).value,
    bootstrapEnabled: (bootstrapEnabled as { value: boolean }).value,
    executionEnabled: (executionEnabled as { value: boolean }).value,
    positionMonitorEnabled: (positionMonitorEnabled as { value: boolean }).value,
    reconciliationEnabled: (reconciliationEnabled as { value: boolean }).value,
    performanceJobEnabled: (performanceJobEnabled as { value: boolean }).value,
    alertOutboxEnabled: (alertOutboxEnabled as { value: boolean }).value,
    alertDeliveryEnabled: (alertDeliveryEnabled as { value: boolean }).value,
    retentionEnabled: (retentionEnabled as { value: boolean }).value
  };

  const capability: TradingCapabilityContext = {
    buildCapability: flags.buildCapability,
    tradingMode: flags.tradingMode,
    enableLiveTrading: flags.enableLiveTrading,
    shadowMasterFlagEnabled: flags.shadowEnabled
  };

  const capabilityResult = checkShadowOnlyCapability(capability);
  if (!capabilityResult.ok) {
    return {
      allowed: false,
      reasonCode: capabilityResult.reasonCode,
      message: capabilityResult.message,
      flags
    };
  }

  return { allowed: true, flags };
}

/** Gate for `shadowGenerateCandidates` (work package 2). */
export function checkShadowStrategyJobAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.strategyV1Enabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.STRATEGY_V1_DISABLED,
      message: "TRADING_STRATEGY_V1_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/** Gate for `shadowAssessRisk` (work package 3). */
export function checkShadowRiskJobAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.riskV1Enabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.RISK_V1_DISABLED,
      message: "TRADING_RISK_V1_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/**
 * Gate for the one-off operations bootstrap. It creates disabled structures
 * only, but still requires the full shadow configuration plus its own flag so
 * no environment can seed trading rows by accident (ADR 0006).
 */
export function checkShadowBootstrapAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.bootstrapEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.BOOTSTRAP_DISABLED,
      message: "TRADING_BOOTSTRAP_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/** Gate for `shadowCreateOrders` / `shadowProcessFills` (work package 4). */
export function checkShadowExecutionJobAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.executionEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.EXECUTION_DISABLED,
      message: "TRADING_SHADOW_EXECUTION_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/**
 * Gate for `shadowMonitorPositions` (work package 4). Monitoring and
 * risk-reducing exits must keep running even while entries are disabled
 * (docs/trading/04, "Kill-Switch-Auslöser"), so this flag is independent of
 * `executionEnabled` rather than layered on top of it.
 */
export function checkShadowPositionMonitorJobAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.positionMonitorEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.POSITION_MONITOR_DISABLED,
      message: "TRADING_SHADOW_POSITION_MONITOR_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/** Gate for `shadowReconcilePortfolio` / `shadowStartTradingDay` (work package 4). */
export function checkShadowReconciliationJobAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.reconciliationEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.RECONCILIATION_DISABLED,
      message: "TRADING_SHADOW_RECONCILIATION_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

// ───────────────────────────────────────────────────────────────────────────
// Work package 8 gates
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate for `shadowPerformanceRefresh`. The job only reads shadow trading data
 * and writes `StrategyPerformance` — it never touches an order, a position or
 * a risk decision — but it still requires the full shadow-only base so no
 * environment can produce trading projections by accident (ADR 0006).
 */
export function checkShadowPerformanceJobAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.performanceJobEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.PERFORMANCE_JOB_DISABLED,
      message: "TRADING_PERFORMANCE_JOB_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/** Gate for *recording* a trading alert in the outbox. */
export function checkTradingAlertOutboxAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.alertOutboxEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.ALERT_OUTBOX_DISABLED,
      message: "TRADING_ALERT_OUTBOX_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}

/**
 * Gate for *delivering* a recorded alert. Deliberately layered on top of the
 * outbox flag rather than independent of it: delivering what was never
 * recorded is impossible, and recording without delivering is the safe
 * intermediate state an operator wants while validating the alert catalogue.
 */
export function checkTradingAlertDeliveryAllowed(env: EnvSource = process.env): TradingGateResult {
  const outbox = checkTradingAlertOutboxAllowed(env);
  if (!outbox.allowed) return outbox;
  if (!outbox.flags.alertDeliveryEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.ALERT_DELIVERY_DISABLED,
      message: "TRADING_ALERT_DELIVERY_ENABLED is not true.",
      flags: outbox.flags
    };
  }
  return outbox;
}

/**
 * Gate for the retention job. Even with this flag on, the job stays a dry run
 * unless the caller explicitly asks to apply it (P8, "8. Retention": "Keine
 * produktive Löschung ohne klaren Dry-Run und eigene Aktivierung").
 */
export function checkTradingRetentionAllowed(env: EnvSource = process.env): TradingGateResult {
  const base = checkShadowBaseAllowed(env);
  if (!base.allowed) return base;
  if (!base.flags.retentionEnabled) {
    return {
      allowed: false,
      reasonCode: ShadowJobReasonCode.RETENTION_DISABLED,
      message: "TRADING_RETENTION_ENABLED is not true.",
      flags: base.flags
    };
  }
  return base;
}
