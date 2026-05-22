import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyStrategyFilter,
  buildDefaultStrategyConfigs,
  rankStrategyResults,
  summarizeStrategyComparison
} from "../src/index.js";

describe("strategy lab", () => {
  it("builds default strategy configs", () => {
    const configs = buildDefaultStrategyConfigs();
    assert.equal(configs.length, 7);
    assert.ok(configs.some((config) => config.name === "Baseline 50" && config.configJson.useSignalRules === false));
  });

  it("filters by minScore and statuses", () => {
    assert.equal(applyStrategyFilter(candidate({ score: 64 }), { minScoreToRecord: 65 }), false);
    assert.equal(applyStrategyFilter(candidate({ score: 70, status: "WATCH" }), { minScoreToRecord: 65 }), true);
    assert.equal(applyStrategyFilter(candidate({ status: "WAIT" }), { includeStatuses: ["WATCH"] }), false);
    assert.equal(applyStrategyFilter(candidate({ status: "WAIT" }), { excludeStatuses: ["WAIT"] }), false);
  });

  it("uses original score when signal rules are disabled and adjusted score when enabled", () => {
    const item = candidate({ score: 70, originalScore: 45, adjustedScore: 75 });
    assert.equal(applyStrategyFilter(item, { useSignalRules: false, minScoreToRecord: 50 }), false);
    assert.equal(applyStrategyFilter(item, { useSignalRules: true, minScoreToRecord: 50 }), true);
  });

  it("filters market regime conflicts", () => {
    assert.equal(
      applyStrategyFilter(candidate({ marketRegimeContext: { isAlignedWithRegime: false, riskMode: "HIGH_RISK" } }), {
        requireMarketRegimeAlignment: true
      }),
      false
    );
    assert.equal(
      applyStrategyFilter(candidate({ marketRegimeContext: { isAlignedWithRegime: true, riskMode: "NORMAL" } }), {
        requireMarketRegimeAlignment: true,
        allowedRiskModes: ["NORMAL"]
      }),
      true
    );
  });

  it("ranks by winRate with sample warning and summarizes best strategy", () => {
    const ranked = rankStrategyResults([
      { strategyName: "Small Sample", totalSignals: 5, evaluatedCount: 5, winRate: 90, avgReturnAfter1d: 1 },
      { strategyName: "Stable", totalSignals: 100, evaluatedCount: 100, winRate: 60, avgReturnAfter1d: 2 }
    ]);
    const summary = summarizeStrategyComparison(ranked);

    assert.equal(ranked[0].strategyName, "Small Sample");
    assert.equal(ranked[0].warnings.length, 1);
    assert.equal(summary.bestStrategy, "Small Sample");
    assert.equal(summary.totalStrategies, 2);
  });
});

function candidate(overrides: Partial<Parameters<typeof applyStrategyFilter>[0]> = {}) {
  return {
    score: 70,
    status: "WATCH",
    signalType: "TREND_ALERT",
    ...overrides
  };
}
