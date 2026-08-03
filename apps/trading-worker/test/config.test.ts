/**
 * `resolveTradingWorkerConfig`: fail-closed parsing of the P5 scheduler
 * flags on top of the shared P1–P4 shadow-only base gate.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTradingWorkerConfig } from "../src/config.js";

const BASE_VALID_ENV = Object.freeze({
  ENABLE_LIVE_TRADING: "false",
  TRADING_MODE: "SHADOW",
  TRADING_SHADOW_ENABLED: "true",
  TRADING_STRATEGY_V1_ENABLED: "true",
  TRADING_RISK_V1_ENABLED: "true",
  TRADING_BOOTSTRAP_ENABLED: "true",
  TRADING_SHADOW_EXECUTION_ENABLED: "true",
  TRADING_SHADOW_POSITION_MONITOR_ENABLED: "true",
  TRADING_SHADOW_RECONCILIATION_ENABLED: "true"
});

describe("resolveTradingWorkerConfig", () => {
  it("is disabled by default with an empty environment", () => {
    const result = resolveTradingWorkerConfig({});
    assert.equal(result.ok, false);
  });

  it("stays blocked when the base gate is off even if TRADING_WORKER_ENABLED=true", () => {
    const result = resolveTradingWorkerConfig({ TRADING_WORKER_ENABLED: "true" });
    assert.equal(result.ok, false);
  });

  it("refuses TRADING_WORKER_ENABLED=false as the safe default even with everything else on", () => {
    const result = resolveTradingWorkerConfig({ ...BASE_VALID_ENV, TRADING_WORKER_ENABLED: "false" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, "TRADING_WORKER_DISABLED");
  });

  it("fails closed on an unrecognised value for a scheduler job flag", () => {
    const result = resolveTradingWorkerConfig({
      ...BASE_VALID_ENV,
      TRADING_WORKER_ENABLED: "true",
      TRADING_CANDIDATE_JOB_ENABLED: "yes"
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, "CONFIG_INVALID");
  });

  it("resolves every job flag to false by default even once the worker itself is enabled", () => {
    const result = resolveTradingWorkerConfig({ ...BASE_VALID_ENV, TRADING_WORKER_ENABLED: "true" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.schedulerEnabled, false);
    for (const value of Object.values(result.config.jobFlags)) {
      assert.equal(value, false);
    }
  });

  it("turns on exactly the flags that are explicitly set to true", () => {
    const result = resolveTradingWorkerConfig({
      ...BASE_VALID_ENV,
      TRADING_WORKER_ENABLED: "true",
      TRADING_SCHEDULER_ENABLED: "true",
      TRADING_RISK_JOB_ENABLED: "true"
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.schedulerEnabled, true);
    assert.equal(result.config.jobFlags.riskJobEnabled, true);
    assert.equal(result.config.jobFlags.candidateJobEnabled, false);
    assert.equal(result.config.jobFlags.orderJobEnabled, false);
  });

  it("derives a stable, non-empty ownerId even without TRADING_WORKER_OWNER_ID", () => {
    const result = resolveTradingWorkerConfig({ ...BASE_VALID_ENV, TRADING_WORKER_ENABLED: "true" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.config.ownerId.length > 0);
  });

  it("uses an explicit TRADING_WORKER_OWNER_ID when provided", () => {
    const result = resolveTradingWorkerConfig({
      ...BASE_VALID_ENV,
      TRADING_WORKER_ENABLED: "true",
      TRADING_WORKER_OWNER_ID: "custom-owner-1"
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.ownerId, "custom-owner-1");
  });
});
