import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IndicatorSnapshot } from "@signalpilot/shared";

import { scoreSignal } from "../src/index.js";

const baseSnapshot: IndicatorSnapshot = {
  sma20: 100,
  sma50: 95,
  sma200: 90,
  ema20: 101,
  rsi14: 62,
  atr14: 3,
  averageVolume20: 1000,
  relativeVolume: 1.2,
  periodHigh20: 110,
  periodLow20: 90,
  lastClose: 104,
  lastVolume: 1200,
  candleCount: 250
};

const asset = {
  symbol: "BTCUSDT",
  assetType: "crypto" as const
};

describe("scoreSignal", () => {
  it("scores a bullish trend-momentum setup", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "4h",
      indicators: {
        ...baseSnapshot,
        lastClose: 109,
        periodHigh20: 110,
        relativeVolume: 1.8
      }
    });

    assert.equal(decision.direction, "BULLISH");
    assert.equal(decision.status, "WATCH");
    assert.equal(decision.signalType, "BREAKOUT_ALERT");
    assert.ok(decision.score >= 65);
    assert.ok(decision.reasons.some((reason) => reason.includes("sma20")));
    assert.ok(decision.nextTrigger.includes("sma20") || decision.nextTrigger.includes("20-period high"));
  });

  it("identifies a volume spike", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "1h",
      indicators: {
        ...baseSnapshot,
        lastClose: 106,
        periodHigh20: 112,
        relativeVolume: 2.4
      }
    });

    assert.equal(decision.signalType, "VOLUME_SPIKE");
    assert.equal(decision.volumeScore, 92);
    assert.ok(decision.riskScore >= 45);
    assert.ok(decision.reasons.some((reason) => reason.includes("Relative volume is above 2.0")));
  });

  it("keeps an overheated setup risk-aware", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "1h",
      indicators: {
        ...baseSnapshot,
        lastClose: 120,
        sma20: 110,
        sma50: 100,
        sma200: 90,
        periodHigh20: 121,
        periodLow20: 80,
        relativeVolume: 2.6,
        rsi14: 82,
        atr14: 11
      }
    });

    assert.equal(decision.riskLevel, "HIGH");
    assert.equal(decision.status, "WATCH");
    assert.ok(decision.riskScore >= 70);
    assert.ok(decision.counterArguments.some((argument) => argument.includes("overheated")));
  });

  it("scores a bearish weak setup as avoid", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "1d",
      indicators: {
        ...baseSnapshot,
        lastClose: 82,
        sma20: 90,
        sma50: 95,
        sma200: 100,
        periodHigh20: 110,
        periodLow20: 80,
        relativeVolume: 0.6,
        rsi14: 35
      }
    });

    assert.equal(decision.direction, "BEARISH");
    assert.equal(decision.status, "AVOID");
    assert.equal(decision.signalType, "NO_SIGNAL");
    assert.ok(decision.score < 40);
  });

  it("handles too few or missing indicators", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "1h",
      indicators: {
        sma20: null,
        sma50: null,
        sma200: null,
        ema20: null,
        rsi14: null,
        atr14: null,
        averageVolume20: null,
        relativeVolume: null,
        periodHigh20: null,
        periodLow20: null,
        lastClose: null,
        lastVolume: null,
        candleCount: 3
      }
    });

    assert.equal(decision.direction, "NEUTRAL");
    assert.equal(decision.status, "WAIT");
    assert.equal(decision.signalType, "NO_SIGNAL");
    assert.equal(decision.score, 50);
    assert.ok(decision.counterArguments.length >= 4);
  });

  it("detects a mixed setup", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "4h",
      indicators: {
        ...baseSnapshot,
        lastClose: 109,
        sma20: 100,
        sma50: 95,
        sma200: 90,
        periodHigh20: 110,
        periodLow20: 90,
        relativeVolume: 0.55,
        rsi14: 63
      }
    });

    assert.equal(decision.direction, "MIXED");
    assert.equal(decision.signalType, "MOMENTUM_ALERT");
    assert.ok(decision.counterArguments.some((argument) => argument.includes("Low participation")));
  });

  it("returns no edge for an unclear neutral setup", () => {
    const decision = scoreSignal({
      asset,
      timeframe: "1d",
      indicators: {
        ...baseSnapshot,
        lastClose: 100,
        sma20: 101,
        sma50: 99,
        sma200: 98,
        periodHigh20: 120,
        periodLow20: 80,
        relativeVolume: 0.6,
        rsi14: 38,
        atr14: 2
      }
    });

    assert.equal(decision.direction, "NEUTRAL");
    assert.equal(decision.status, "NO_EDGE");
    assert.equal(decision.signalType, "NO_SIGNAL");
    assert.ok(decision.score >= 40 && decision.score < 50);
  });
});
