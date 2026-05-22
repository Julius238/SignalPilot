import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IndicatorSnapshot, SignalDecision } from "@signalpilot/shared";

import {
  evaluateBacktestSignals,
  generateBacktestSignals,
  summarizeBacktestRun,
  type BacktestCandle
} from "../src/index.js";

describe("backtesting", () => {
  it("does not generate signals without enough warmup candles", () => {
    const signals = generateBacktestSignals({
      assets: [asset()],
      candles: candles(10),
      config: baseConfig({ minCandlesBeforeSignal: 20 }),
      scoreSignalFn: () => decision({ score: 90 })
    });

    assert.equal(signals.length, 0);
  });

  it("does not use future candles for indicator snapshots", () => {
    const seenCounts: number[] = [];
    const generated = generateBacktestSignals({
      assets: [asset()],
      candles: candles(6),
      config: baseConfig({ minCandlesBeforeSignal: 3, maxSignalsPerAssetTimeframe: 2 }),
      scoreSignalFn: ({ indicators }) => {
        seenCounts.push((indicators as IndicatorSnapshot).candleCount);
        return decision({ score: 70 });
      }
    });

    assert.deepEqual(seenCounts, [3, 4]);
    assert.equal(generated[0].context.indicatorSnapshot.candleCount, 3);
    assert.equal(generated[0].context.generatedWithoutLookahead, true);
  });

  it("respects maxSignalsPerAssetTimeframe and minScoreToRecord", () => {
    const filtered = generateBacktestSignals({
      assets: [asset()],
      candles: candles(8),
      config: baseConfig({ minCandlesBeforeSignal: 3, minScoreToRecord: 80 }),
      scoreSignalFn: () => decision({ score: 60, status: "WAIT", signalType: "NO_SIGNAL" })
    });
    const limited = generateBacktestSignals({
      assets: [asset()],
      candles: candles(8),
      config: baseConfig({ minCandlesBeforeSignal: 3, maxSignalsPerAssetTimeframe: 2 }),
      scoreSignalFn: () => decision({ score: 90 })
    });

    assert.equal(filtered.length, 0);
    assert.equal(limited.length, 2);
  });

  it("evaluates bullish outcomes as positive when price rises", () => {
    const [signal] = generateBacktestSignals({
      assets: [asset()],
      candles: candles(6, 100),
      config: baseConfig({ minCandlesBeforeSignal: 3, maxSignalsPerAssetTimeframe: 1, useSignalRules: false }),
      scoreSignalFn: () => decision({ score: 90, direction: "BULLISH" })
    });
    const evaluated = evaluateBacktestSignals({
      signals: [signal],
      candles: [
        ...candles(6, 100),
        candle(6, 106),
        candle(7, 107),
        candle(24, 108)
      ],
      to: new Date("2026-01-03T00:00:00.000Z")
    });

    assert.equal(evaluated[0].outcome, "TARGET_REACHED");
    assert.equal(evaluated[0].outcomeStatus, "EVALUATED");
    assert.equal(evaluated[0].maxFavorableMove! > 0, true);
  });

  it("evaluates bearish or AVOID outcomes as correct warning when price falls", () => {
    const [signal] = generateBacktestSignals({
      assets: [asset()],
      candles: candles(3, 100),
      config: baseConfig({ minCandlesBeforeSignal: 3, maxSignalsPerAssetTimeframe: 1, useSignalRules: false }),
      scoreSignalFn: () => decision({ score: 90, direction: "BEARISH", status: "AVOID" })
    });
    const evaluated = evaluateBacktestSignals({
      signals: [signal],
      candles: [...candles(3, 100), candle(3, 96), candle(24, 95)],
      to: new Date("2026-01-03T00:00:00.000Z")
    });

    assert.equal(evaluated[0].outcome, "TARGET_REACHED");
  });

  it("summarizes winRate and groups correctly", () => {
    const summary = summarizeBacktestRun({
      signals: [
        evaluatedSignal({ symbol: "BTCUSDT", timeframe: "1h", signalType: "TREND_ALERT", status: "WATCH", outcome: "POSITIVE", returnAfter1d: 2 }),
        evaluatedSignal({ symbol: "ETHUSDT", timeframe: "4h", signalType: "VOLUME_SPIKE", status: "WAIT", outcome: "NEGATIVE", returnAfter1d: -1 })
      ]
    });

    assert.equal(summary.totalSignals, 2);
    assert.equal(summary.evaluatedCount, 2);
    assert.equal(summary.winRate, 50);
    assert.equal(summary.groupedBySymbol.length, 2);
    assert.equal(summary.groupedByTimeframe[0].totalSignals, 1);
    assert.equal(summary.groupedBySignalType.length, 2);
  });
});

function baseConfig(overrides: Partial<Parameters<typeof generateBacktestSignals>[0]["config"]> = {}) {
  return {
    symbols: ["BTCUSDT"],
    assetType: "CRYPTO" as const,
    timeframes: ["1h"],
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-03T00:00:00.000Z"),
    useSignalRules: false,
    ...overrides
  };
}

function asset() {
  return { id: "asset-1", symbol: "BTCUSDT", assetType: "CRYPTO" as const };
}

function candles(count: number, startPrice = 100): BacktestCandle[] {
  return Array.from({ length: count }, (_, index) => candle(index, startPrice + index));
}

function candle(index: number, close: number): BacktestCandle {
  const openTime = new Date(Date.UTC(2026, 0, 1, index));
  const closeTime = new Date(Date.UTC(2026, 0, 1, index + 1));
  return {
    assetId: "asset-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    openTime,
    closeTime,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000
  };
}

function decision(overrides: Partial<SignalDecision> = {}): SignalDecision {
  return {
    symbol: "BTCUSDT",
    assetType: "crypto",
    timeframe: "1h",
    signalType: "TREND_ALERT",
    status: "WATCH",
    direction: "BULLISH",
    score: 80,
    riskLevel: "LOW",
    trendScore: 80,
    momentumScore: 80,
    volumeScore: 80,
    volatilityScore: 50,
    rsiScore: 60,
    newsScore: 50,
    socialScore: 50,
    eventScore: 50,
    riskScore: 20,
    reasons: [],
    counterArguments: [],
    nextTrigger: "More historical confirmation",
    ...overrides
  };
}

function evaluatedSignal(overrides: Partial<ReturnType<typeof evaluateBacktestSignals>[number]> = {}) {
  return {
    assetId: "asset-1",
    symbol: "BTCUSDT",
    assetType: "CRYPTO" as const,
    timeframe: "1h",
    signalTime: new Date("2026-01-01T00:00:00.000Z"),
    signalType: "TREND_ALERT" as const,
    status: "WATCH" as const,
    direction: "BULLISH" as const,
    riskLevel: "LOW" as const,
    score: 80,
    entryPrice: 100,
    outcome: "POSITIVE" as const,
    outcomeStatus: "EVALUATED" as const,
    returnAfter1d: 1,
    context: {
      decision: decision(),
      indicatorSnapshot: { candleCount: 220 } as IndicatorSnapshot,
      generatedWithoutLookahead: true as const
    },
    ...overrides
  };
}
