/**
 * `startTradingWorkerScheduler`: registers only the jobs whose own flag is
 * on, and never registers anything when the whole job-flag set is off (the
 * safe default). Every returned task is stopped again immediately so the
 * test process does not keep a live cron timer running past this file.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startTradingWorkerScheduler } from "../src/scheduler.js";
import type { TradingWorkerConfig } from "../src/config.js";

function buildConfig(overrides: Partial<TradingWorkerConfig["jobFlags"]> = {}): TradingWorkerConfig {
  return {
    masterFlags: {
      buildCapability: "SHADOW_ONLY",
      enableLiveTrading: false,
      tradingMode: "SHADOW",
      shadowEnabled: true,
      strategyV1Enabled: true,
      riskV1Enabled: true,
      bootstrapEnabled: true,
      executionEnabled: true,
      positionMonitorEnabled: true,
      reconciliationEnabled: true
    },
    schedulerEnabled: true,
    jobFlags: {
      dayStartJobEnabled: false,
      candidateJobEnabled: false,
      riskJobEnabled: false,
      orderJobEnabled: false,
      fillJobEnabled: false,
      positionMonitorJobEnabled: false,
      reconciliationJobEnabled: false,
      ...overrides
    },
    ownerId: "test-owner"
  };
}

describe("startTradingWorkerScheduler", () => {
  it("registers nothing when every job flag is off", () => {
    const tasks = startTradingWorkerScheduler(buildConfig());
    assert.equal(tasks.length, 0);
    tasks.forEach((task) => task.stop());
  });

  it("registers exactly one task per job flag that is on", () => {
    const tasks = startTradingWorkerScheduler(
      buildConfig({ candidateJobEnabled: true, positionMonitorJobEnabled: true })
    );
    assert.equal(tasks.length, 2);
    tasks.forEach((task) => task.stop());
  });

  it("registers all seven jobs when every job flag is on", () => {
    const tasks = startTradingWorkerScheduler(
      buildConfig({
        dayStartJobEnabled: true,
        candidateJobEnabled: true,
        riskJobEnabled: true,
        orderJobEnabled: true,
        fillJobEnabled: true,
        positionMonitorJobEnabled: true,
        reconciliationJobEnabled: true
      })
    );
    assert.equal(tasks.length, 7);
    tasks.forEach((task) => task.stop());
  });
});
