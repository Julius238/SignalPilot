/**
 * The report is now built from sums and counts. These tests hold it against a
 * frozen copy of the former implementation: same numbers to the last bit, same
 * order of buckets and keys (compared as JSON text).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateEvaluations,
  buildPerformanceBuckets,
  buildPerformanceBucketsFromAggregate,
  buildPerformanceReport,
  buildPerformanceReportFromAggregate,
  type PaperEvaluationLike,
  type PerformanceGroupBy
} from "../src/index.js";
import * as legacy from "./support/legacy-performance-report.js";

const generatedAt = new Date("2026-11-24T00:00:00.000Z");
const groupBys: PerformanceGroupBy[] = [
  "signalType",
  "timeframe",
  "symbol",
  "status",
  "riskLevel",
  "evaluationKind",
  "scoreBucket"
];

/** Deterministic generator (mulberry32), so a failure is reproducible. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEvaluations(seed: number, count: number): PaperEvaluationLike[] {
  const random = rng(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
  const metric = () => {
    const roll = random();
    if (roll < 0.1) return null;
    if (roll < 0.12) return -0;
    // Wildly different magnitudes make any change of the summation order visible.
    return (random() - 0.5) * 10 ** Math.floor(random() * 14 - 7);
  };
  return Array.from({ length: count }, () => ({
    symbol: `S${Math.floor(random() * 14)}`,
    timeframe: pick(["1h", "4h", "1d"]),
    status: pick(["WATCH", "ACTIVE", "EXPIRED", "INVALIDATED"]),
    signalType: pick(["TREND_ALERT", "BREAKOUT_ALERT", "VOLUME_SPIKE", "RISK_WARNING", "A", "B", "C"]),
    score: pick([0, 49.999, 50, 64.999, 65, 79.999, 80, 100, random() * 100]),
    riskLevel: pick(["LOW", "MEDIUM", "HIGH"]),
    evaluationKind: pick(["DIRECTIONAL_BULLISH", "OBSERVATION", "RISK_WARNING", "SKIPPED"]),
    skipReason: pick([null, "Unspecified", "no direction", "low score"]),
    evaluationStatus: pick(["EVALUATED", "EVALUATED", "SKIPPED", "OPEN", "EXPIRED"]),
    outcome: pick([null, "POSITIVE", "NEGATIVE", "NEUTRAL", "TARGET_REACHED", "INVALIDATED"]),
    returnAfter1h: metric(),
    returnAfter4h: metric(),
    returnAfter1d: metric(),
    returnAfter3d: metric(),
    maxFavorableMove: metric(),
    maxAdverseMove: metric()
  }));
}

const text = (value: unknown) => JSON.stringify(value);

describe("report from aggregates equals the former implementation", () => {
  for (const [seed, count] of [
    [1, 0],
    [2, 1],
    [3, 9],
    [4, 40],
    [5, 700],
    [6, 5000]
  ] as const) {
    for (const includeSkipped of [true, false]) {
      for (const minEvaluated of [0, 30]) {
        it(`seed ${seed}, ${count} rows, includeSkipped ${includeSkipped}, minEvaluated ${minEvaluated}`, () => {
          const evaluations = randomEvaluations(seed, count);
          const options = { generatedAt, includeSkipped, minEvaluated };
          const expected = legacy.buildPerformanceReport(evaluations, options);

          assert.equal(text(buildPerformanceReport(evaluations, options)), text(expected));

          const active = includeSkipped
            ? evaluations
            : evaluations.filter((evaluation) => evaluation.evaluationStatus !== "SKIPPED");
          const aggregate = aggregateEvaluations(active);
          assert.equal(
            text(buildPerformanceReportFromAggregate(aggregate, { generatedAt, minEvaluated })),
            text(expected)
          );
          for (const groupBy of groupBys) {
            const buckets = text(legacy.buildPerformanceBuckets(active, groupBy, 41.5));
            assert.equal(text(buildPerformanceBuckets(active, groupBy, 41.5)), buckets);
            assert.equal(text(buildPerformanceBucketsFromAggregate(aggregate, groupBy, 41.5)), buckets);
          }
        });
      }
    }
  }

  it("keeps the order of first appearance for tied buckets", () => {
    const evaluations = ["zeta", "alpha", "mid"].map(
      (symbol): PaperEvaluationLike => ({
        symbol,
        timeframe: "1h",
        status: "WATCH",
        signalType: "TREND_ALERT",
        score: 70,
        riskLevel: "LOW",
        evaluationKind: "OBSERVATION",
        evaluationStatus: "OPEN"
      })
    );

    assert.deepEqual(
      buildPerformanceReport(evaluations).bestAssets.map((bucket) => bucket.key),
      ["zeta", "alpha", "mid"]
    );
  });
});
