import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPerformanceBucket,
  buildPerformanceBuckets,
  buildPerformanceReport,
  type PaperEvaluationLike
} from "../src/index.js";

describe("performance intelligence", () => {
  it("calculates winRate from evaluated records only", () => {
    const bucket = buildPerformanceBucket("TREND_ALERT", "TREND_ALERT", [
      evaluation({ outcome: "POSITIVE" }),
      evaluation({ outcome: "NEGATIVE" }),
      evaluation({ evaluationStatus: "SKIPPED", outcome: null })
    ]);

    assert.equal(bucket.total, 3);
    assert.equal(bucket.evaluatedCount, 2);
    assert.equal(bucket.skippedCount, 1);
    assert.equal(bucket.winRate, 50);
  });

  it("counts TARGET_REACHED as win and INVALIDATED as loss", () => {
    const bucket = buildPerformanceBucket("BREAKOUT_ALERT", "BREAKOUT_ALERT", [
      evaluation({ outcome: "TARGET_REACHED" }),
      evaluation({ outcome: "INVALIDATED" }),
      evaluation({ outcome: "NEUTRAL" })
    ]);

    assert.equal(bucket.targetReachedCount, 1);
    assert.equal(bucket.invalidatedCount, 1);
    assert.equal(bucket.neutralCount, 1);
    assert.equal(Math.round(bucket.winRate * 10) / 10, 33.3);
  });

  it("sets confidence levels from evaluated count", () => {
    assert.equal(makeBucket(9).confidenceLevel, "LOW");
    assert.equal(makeBucket(10).confidenceLevel, "MEDIUM");
    assert.equal(makeBucket(30).confidenceLevel, "HIGH");
  });

  it("groups score buckets correctly", () => {
    const buckets = buildPerformanceBuckets(
      [
        evaluation({ score: 49 }),
        evaluation({ score: 50 }),
        evaluation({ score: 65 }),
        evaluation({ score: 80 })
      ],
      "scoreBucket"
    );

    assert.deepEqual(
      buckets.map((bucket) => bucket.key),
      ["0-49", "50-64", "65-79", "80-100"]
    );
  });

  it("sorts report best and worst buckets", () => {
    const report = buildPerformanceReport([
      ...Array.from({ length: 12 }, () =>
        evaluation({ signalType: "BREAKOUT_ALERT", outcome: "POSITIVE", returnAfter1d: 1.2 })
      ),
      ...Array.from({ length: 12 }, () =>
        evaluation({ signalType: "VOLUME_SPIKE", outcome: "NEGATIVE", returnAfter1d: -1 })
      )
    ]);

    assert.equal(report.bestSignalTypes[0]?.key, "BREAKOUT_ALERT");
    assert.equal(report.worstSignalTypes[0]?.key, "VOLUME_SPIKE");
  });
});

function makeBucket(count: number) {
  return buildPerformanceBucket(
    "test",
    "test",
    Array.from({ length: count }, () => evaluation())
  );
}

function evaluation(overrides: Partial<PaperEvaluationLike> = {}): PaperEvaluationLike {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    status: "WATCH",
    signalType: "TREND_ALERT",
    score: 72,
    riskLevel: "MEDIUM",
    evaluationStatus: "EVALUATED",
    outcome: "POSITIVE",
    returnAfter1h: 0.2,
    returnAfter4h: 0.4,
    returnAfter1d: 0.8,
    returnAfter3d: 1.1,
    maxFavorableMove: 1.5,
    maxAdverseMove: 0.5,
    ...overrides
  };
}
