import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDataQualityReport } from "../src/index.js";

describe("data quality", () => {
  it("detects missing candles", () => {
    const report = buildDataQualityReport({
      ...baseInput(),
      assets: [
        {
          id: "asset-1",
          symbol: "BTCUSDT",
          assetType: "CRYPTO",
          isActive: true,
          candleCountsByTimeframe: { "1h": 10, "4h": 250, "1d": 250 },
          recentSignalCount: 1
        }
      ]
    });

    assert.equal(report.assetCoverage[0].hasMinimumCandlesByTimeframe["1h"], false);
    assert.equal(report.candleCoverage.assetsBelowMinimumByTimeframe["1h"], 1);
    assert.ok(report.warnings.some((warning) => warning.includes("1h")));
  });

  it("detects a high skipped evaluation rate", () => {
    const report = buildDataQualityReport({
      ...baseInput(),
      totalEvaluations: 10,
      skippedEvaluationCount: 7,
      skippedByReason: {
        "WAIT signal below evaluation threshold.": 7
      }
    });

    assert.equal(report.evaluationCoverage.skippedRate, 70);
    assert.ok(report.warnings.includes("Many Paper Evaluations are skipped."));
  });

  it("keeps qualityScore between 0 and 100", () => {
    const report = buildDataQualityReport(baseInput());

    assert.equal(report.assetCoverage[0].qualityScore >= 0, true);
    assert.equal(report.assetCoverage[0].qualityScore <= 100, true);
  });

  it("does not flag STOCK assets for missing 4h candles", () => {
    const report = buildDataQualityReport({
      ...baseInput(),
      assets: [
        {
          id: "asset-2",
          symbol: "AAPL",
          assetType: "STOCK",
          isActive: true,
          candleCountsByTimeframe: { "1h": 250, "4h": 0, "1d": 250 }
        }
      ]
    });

    assert.equal(report.assetCoverage[0].hasMinimumCandlesByTimeframe["4h"], true);
    assert.equal(report.candleCoverage.assetsBelowMinimumByTimeframe["4h"], 0);
    assert.ok(!report.warnings.some((w) => w.includes("4h")));
  });

  it("does not flag ETF assets for missing 4h candles", () => {
    const report = buildDataQualityReport({
      ...baseInput(),
      assets: [
        {
          id: "asset-3",
          symbol: "SPY",
          assetType: "ETF",
          isActive: true,
          candleCountsByTimeframe: { "1h": 250, "4h": 0, "1d": 250 }
        }
      ]
    });

    assert.equal(report.assetCoverage[0].hasMinimumCandlesByTimeframe["4h"], true);
    assert.equal(report.candleCoverage.assetsBelowMinimumByTimeframe["4h"], 0);
    assert.ok(!report.warnings.some((w) => w.includes("4h")));
  });

  it("flags STOCK assets for missing 1h candle coverage", () => {
    const report = buildDataQualityReport({
      ...baseInput(),
      assets: [
        {
          id: "asset-2",
          symbol: "MSFT",
          assetType: "STOCK",
          isActive: true,
          candleCountsByTimeframe: { "1h": 10, "4h": 0, "1d": 250 }
        }
      ]
    });

    assert.equal(report.assetCoverage[0].hasMinimumCandlesByTimeframe["1h"], false);
    assert.equal(report.assetCoverage[0].hasMinimumCandlesByTimeframe["4h"], true);
    assert.equal(report.candleCoverage.assetsBelowMinimumByTimeframe["1h"], 1);
    assert.ok(report.warnings.some((w) => w.includes("1h")));
    assert.ok(!report.warnings.some((w) => w.includes("4h")));
  });
});

function baseInput() {
  return {
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    totalSignals: 4,
    signalsLast24h: 2,
    signalsWithoutEvaluation: 1,
    totalEvaluations: 3,
    openEvaluationCount: 1,
    evaluatedEvaluationCount: 1,
    skippedEvaluationCount: 1,
    skippedByReason: {},
    alertStateCount: 1,
    successfulAlertCount: 1,
    alertCount: 2,
    assets: [
      {
        id: "asset-1",
        symbol: "BTCUSDT",
        assetType: "CRYPTO",
        isActive: true,
        candleCountsByTimeframe: { "1h": 250, "4h": 250, "1d": 250 },
        latestCandleByTimeframe: {
          "1h": new Date("2026-01-01T00:00:00.000Z")
        },
        latestSignalByTimeframe: {
          "1h": new Date("2026-01-01T00:00:00.000Z")
        },
        signalCount: 4,
        recentSignalCount: 2,
        evaluationCount: 3,
        skippedEvaluationCount: 1,
        alertCount: 2,
        successfulAlertCount: 1,
        alertStateCount: 1
      }
    ]
  };
}
