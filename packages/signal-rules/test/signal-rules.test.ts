import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applySignalRules, type SignalRulesContext } from "../src/index.js";

describe("applySignalRules", () => {
  it("clamps score to 0-100 and respects max delta", () => {
    const result = applySignalRules({
      ...baseContext(95),
      maxDelta: 5,
      marketRegimeContext: { marketRegime: "RISK_ON", riskMode: "NORMAL" },
      newsContext: { relevanceScore: 90, sentiment: "POSITIVE" }
    });
    assert.equal(result.adjustedScore, 100);
    assert.equal(totalDelta(result.adjustments) <= 5, true);
  });

  it("boosts bullish RISK_ON and penalizes bullish RISK_OFF with warning", () => {
    const riskOn = applySignalRules({ ...baseContext(), marketRegimeContext: { marketRegime: "RISK_ON", riskMode: "NORMAL" } });
    const riskOff = applySignalRules({ ...baseContext(), marketRegimeContext: { marketRegime: "RISK_OFF", riskMode: "HIGH_RISK" } });
    assert.equal(riskOn.adjustedScore > 70, true);
    assert.equal(riskOff.adjustedScore < 70, true);
    assert.equal(riskOff.warnings.includes("Signal läuft gegen das Marktumfeld."), true);
  });

  it("reduces bullish score for high event risk and negative news", () => {
    const result = applySignalRules({
      ...baseContext(),
      newsContext: { relevanceScore: 80, sentiment: "NEGATIVE" },
      eventContext: { eventRiskLevel: "HIGH" }
    });
    assert.equal(result.adjustedScore < 70, true);
    assert.equal(result.warnings.includes("Hohes Event-Risiko."), true);
  });

  it("reduces score for bad data quality", () => {
    const result = applySignalRules({ ...baseContext(), dataQuality: { qualityScore: 40 } });
    assert.equal(result.adjustedScore, 65);
    assert.equal(result.warnings.includes("Datenqualität begrenzt Aussagekraft."), true);
  });

  it("uses performance buckets and warns on insufficient data", () => {
    const positive = applySignalRules({
      ...baseContext(),
      performanceReport: { bestSignalTypes: [bucket("TREND_ALERT", 20, 65)] }
    });
    const negative = applySignalRules({
      ...baseContext(),
      performanceReport: { worstSignalTypes: [bucket("TREND_ALERT", 20, 35)] }
    });
    const insufficient = applySignalRules({
      ...baseContext(),
      performanceReport: { bestSignalTypes: [bucket("TREND_ALERT", 5, 80)] }
    });
    assert.equal(positive.adjustedScore > 70, true);
    assert.equal(negative.adjustedScore < 70, true);
    assert.equal(insufficient.adjustedScore, 70);
    assert.equal(insufficient.warnings.includes("Zu wenig Performance-Daten für belastbare Anpassung."), true);
  });
});

function baseContext(score = 70): SignalRulesContext {
  return {
    asset: { symbol: "BTCUSDT", assetType: "crypto" },
    signalDecision: {
      symbol: "BTCUSDT",
      assetType: "crypto",
      timeframe: "1d",
      signalType: "TREND_ALERT",
      status: "WATCH",
      direction: "BULLISH",
      score,
      riskLevel: "MEDIUM",
      trendScore: 70,
      momentumScore: 70,
      volumeScore: 50,
      volatilityScore: 50,
      rsiScore: 50,
      newsScore: 0,
      socialScore: 0,
      eventScore: 0,
      riskScore: 30,
      reasons: [],
      counterArguments: [],
      nextTrigger: "Mehr Bestätigung abwarten."
    }
  };
}

function bucket(key: string, evaluatedCount: number, winRate: number) {
  return { key, evaluatedCount, winRate, confidenceLevel: "MEDIUM" as const };
}

function totalDelta(adjustments: Array<{ scoreDelta: number }>) {
  return Math.abs(adjustments.reduce((sum, adjustment) => sum + adjustment.scoreDelta, 0));
}
