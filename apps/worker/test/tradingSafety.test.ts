import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TradingBuildCapability, TradingReasonCode } from "@signalpilot/trading-domain";

import {
  ShadowJobReasonCode,
  TRADING_BUILD_CAPABILITY,
  checkShadowBootstrapAllowed,
  checkShadowExecutionJobAllowed,
  checkShadowPositionMonitorJobAllowed,
  checkShadowReconciliationJobAllowed,
  checkShadowRiskJobAllowed,
  checkShadowStrategyJobAllowed
} from "../src/lib/tradingSafety.js";

const ENABLED = {
  ENABLE_LIVE_TRADING: "false",
  TRADING_MODE: "SHADOW",
  TRADING_SHADOW_ENABLED: "true",
  TRADING_STRATEGY_V1_ENABLED: "true"
} as const;

describe("checkShadowStrategyJobAllowed", () => {
  it("allows the job only when all four conditions hold", () => {
    const result = checkShadowStrategyJobAllowed(ENABLED);
    assert.equal(result.allowed, true);
    if (!result.allowed) return;
    assert.deepEqual(result.flags, {
      buildCapability: TradingBuildCapability.SHADOW_ONLY,
      enableLiveTrading: false,
      tradingMode: "SHADOW",
      shadowEnabled: true,
      strategyV1Enabled: true,
      riskV1Enabled: false,
      bootstrapEnabled: false,
      executionEnabled: false,
      positionMonitorEnabled: false,
      reconciliationEnabled: false
    });
  });

  it("blocks on an empty environment — every flag defaults to off", () => {
    const result = checkShadowStrategyJobAllowed({});
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, TradingReasonCode.MODE_NOT_SHADOW);
  });

  it("blocks when live trading is enabled", () => {
    const result = checkShadowStrategyJobAllowed({ ...ENABLED, ENABLE_LIVE_TRADING: "true" });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, TradingReasonCode.LIVE_TRADING_FORBIDDEN);
  });

  it("blocks when the mode is DISABLED", () => {
    const result = checkShadowStrategyJobAllowed({ ...ENABLED, TRADING_MODE: "DISABLED" });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, TradingReasonCode.MODE_NOT_SHADOW);
  });

  it("blocks when the shadow master flag is off", () => {
    const result = checkShadowStrategyJobAllowed({ ...ENABLED, TRADING_SHADOW_ENABLED: "false" });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, TradingReasonCode.SHADOW_MASTER_FLAG_DISABLED);
  });

  it("blocks when the strategy v1 job flag is off", () => {
    const result = checkShadowStrategyJobAllowed({ ...ENABLED, TRADING_STRATEGY_V1_ENABLED: "false" });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, ShadowJobReasonCode.STRATEGY_V1_DISABLED);
  });

  it("treats an unknown mode as a configuration error, not as SHADOW", () => {
    for (const mode of ["LIVE", "DEMO", "shadow-ish", "1"]) {
      const result = checkShadowStrategyJobAllowed({ ...ENABLED, TRADING_MODE: mode });
      assert.equal(result.allowed, false, mode);
      if (result.allowed) return;
      assert.equal(result.reasonCode, TradingReasonCode.CONFIG_INVALID, mode);
    }
  });

  it("treats an unknown boolean as a configuration error, never as true", () => {
    for (const name of [
      "ENABLE_LIVE_TRADING",
      "TRADING_SHADOW_ENABLED",
      "TRADING_STRATEGY_V1_ENABLED"
    ]) {
      const result = checkShadowStrategyJobAllowed({ ...ENABLED, [name]: "yes" });
      assert.equal(result.allowed, false, name);
      if (result.allowed) return;
      assert.equal(result.reasonCode, TradingReasonCode.CONFIG_INVALID, name);
    }
  });

  it("accepts an absent ENABLE_LIVE_TRADING as the safe default false", () => {
    const { ENABLE_LIVE_TRADING, ...withoutLiveFlag } = ENABLED;
    void ENABLE_LIVE_TRADING;
    assert.equal(checkShadowStrategyJobAllowed(withoutLiveFlag).allowed, true);
  });

  it("reports a shadow-only build capability", () => {
    assert.equal(TRADING_BUILD_CAPABILITY, TradingBuildCapability.SHADOW_ONLY);
  });
});

describe("checkShadowRiskJobAllowed", () => {
  const RISK_ENABLED = { ...ENABLED, TRADING_RISK_V1_ENABLED: "true" } as const;

  it("allows the risk job only with its own flag on top of the shared gate", () => {
    assert.equal(checkShadowRiskJobAllowed(RISK_ENABLED).allowed, true);
  });

  it("blocks when only the risk flag is missing", () => {
    const result = checkShadowRiskJobAllowed(ENABLED);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, ShadowJobReasonCode.RISK_V1_DISABLED);
  });

  it("blocks on the shared gate before its own flag is considered", () => {
    const result = checkShadowRiskJobAllowed({ ...RISK_ENABLED, TRADING_MODE: "DISABLED" });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, TradingReasonCode.MODE_NOT_SHADOW);
  });

  it("does not let the strategy flag stand in for the risk flag", () => {
    assert.equal(checkShadowStrategyJobAllowed(RISK_ENABLED).allowed, true);
    assert.equal(
      checkShadowRiskJobAllowed({ ...ENABLED, TRADING_STRATEGY_V1_ENABLED: "true" }).allowed,
      false
    );
  });
});

describe("checkShadowBootstrapAllowed", () => {
  it("requires its own flag", () => {
    const blocked = checkShadowBootstrapAllowed(ENABLED);
    assert.equal(blocked.allowed, false);
    if (blocked.allowed) return;
    assert.equal(blocked.reasonCode, ShadowJobReasonCode.BOOTSTRAP_DISABLED);

    assert.equal(
      checkShadowBootstrapAllowed({ ...ENABLED, TRADING_BOOTSTRAP_ENABLED: "true" }).allowed,
      true
    );
  });

  it("treats an unknown bootstrap flag value as a configuration error", () => {
    const result = checkShadowBootstrapAllowed({ ...ENABLED, TRADING_BOOTSTRAP_ENABLED: "1" });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, TradingReasonCode.CONFIG_INVALID);
  });
});

describe("checkShadowExecutionJobAllowed", () => {
  it("requires its own flag on top of the shared gate", () => {
    assert.equal(checkShadowExecutionJobAllowed(ENABLED).allowed, false);
    assert.equal(
      checkShadowExecutionJobAllowed({ ...ENABLED, TRADING_SHADOW_EXECUTION_ENABLED: "true" }).allowed,
      true
    );
  });

  it("reports its own reason code when only the execution flag is missing", () => {
    const result = checkShadowExecutionJobAllowed(ENABLED);
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reasonCode, ShadowJobReasonCode.EXECUTION_DISABLED);
  });
});

describe("checkShadowPositionMonitorJobAllowed", () => {
  it("requires its own flag, independent of the execution flag", () => {
    assert.equal(checkShadowPositionMonitorJobAllowed(ENABLED).allowed, false);
    assert.equal(
      checkShadowPositionMonitorJobAllowed({
        ...ENABLED,
        TRADING_SHADOW_EXECUTION_ENABLED: "true"
      }).allowed,
      false,
      "the execution flag must not stand in for the position-monitor flag"
    );
    assert.equal(
      checkShadowPositionMonitorJobAllowed({
        ...ENABLED,
        TRADING_SHADOW_POSITION_MONITOR_ENABLED: "true"
      }).allowed,
      true
    );
  });
});

describe("checkShadowReconciliationJobAllowed", () => {
  it("requires its own flag", () => {
    assert.equal(checkShadowReconciliationJobAllowed(ENABLED).allowed, false);
    assert.equal(
      checkShadowReconciliationJobAllowed({
        ...ENABLED,
        TRADING_SHADOW_RECONCILIATION_ENABLED: "true"
      }).allowed,
      true
    );
  });
});
