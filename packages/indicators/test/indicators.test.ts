import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildIndicatorSnapshot,
  calculateATR,
  calculateAverageVolume,
  calculateEMA,
  calculatePeriodHigh,
  calculatePeriodLow,
  calculateRelativeVolume,
  calculateRSI,
  calculateSMA,
  type IndicatorCandle
} from "../src/index.js";

const round = (value: number | null, decimals = 4) =>
  value === null ? null : Number(value.toFixed(decimals));

describe("indicator calculations", () => {
  it("calculates SMA", () => {
    assert.equal(calculateSMA([1, 2, 3, 4, 5], 3), 4);
  });

  it("calculates EMA", () => {
    assert.equal(round(calculateEMA([1, 2, 3, 4, 5], 3)), 4);
  });

  it("calculates RSI", () => {
    const closes = [44, 44.15, 43.9, 44.35, 44.8, 45.1, 44.7, 45.4, 45.8, 46.2, 46, 46.5, 46.9, 47.2, 47.8];
    assert.equal(round(calculateRSI(closes, 14)), 84.5455);
  });

  it("calculates ATR", () => {
    assert.equal(round(calculateATR(createCandles(15), 14)), 3);
  });

  it("calculates average volume", () => {
    assert.equal(calculateAverageVolume(createCandles(20), 20), 109.5);
  });

  it("calculates relative volume", () => {
    assert.equal(calculateRelativeVolume(220, 110), 2);
  });

  it("returns null for relative volume division by zero", () => {
    assert.equal(calculateRelativeVolume(220, 0), null);
  });

  it("calculates period high and low", () => {
    const candles = createCandles(20);
    assert.equal(calculatePeriodHigh(candles, 20), 121);
    assert.equal(calculatePeriodLow(candles, 20), 99);
  });

  it("builds an indicator snapshot from sorted candles", () => {
    const snapshot = buildIndicatorSnapshot(createCandles(60));

    assert.equal(snapshot.candleCount, 60);
    assert.equal(snapshot.lastClose, 159.5);
    assert.equal(snapshot.lastVolume, 159);
    assert.equal(snapshot.sma20, 150);
    assert.equal(snapshot.sma50, 135);
    assert.equal(snapshot.sma200, null);
    assert.equal(round(snapshot.ema20), 150);
    assert.equal(snapshot.rsi14, 100);
    assert.equal(snapshot.atr14, 3);
    assert.equal(snapshot.averageVolume20, 149.5);
    assert.equal(round(snapshot.relativeVolume), 1.0635);
    assert.equal(snapshot.periodHigh20, 161);
    assert.equal(snapshot.periodLow20, 139);
  });

  it("handles too few candles", () => {
    const snapshot = buildIndicatorSnapshot(createCandles(3));

    assert.equal(snapshot.candleCount, 3);
    assert.equal(snapshot.sma20, null);
    assert.equal(snapshot.rsi14, null);
    assert.equal(snapshot.atr14, null);
    assert.equal(snapshot.lastClose, 102.5);
    assert.equal(snapshot.lastVolume, 102);
  });

  it("handles empty arrays", () => {
    assert.equal(calculateSMA([], 3), null);
    assert.deepEqual(buildIndicatorSnapshot([]), {
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
      candleCount: 0
    });
  });

  it("rejects invalid and negative values", () => {
    assert.equal(calculateSMA([1, Number.NaN, 3], 3), null);
    assert.equal(calculateEMA([1, Number.POSITIVE_INFINITY, 3], 3), null);
    assert.equal(calculateAverageVolume([{ volume: -1 }], 1), null);
    assert.equal(calculatePeriodHigh([{ high: "not-a-number" }], 1), null);
    assert.deepEqual(buildIndicatorSnapshot([{ high: 1, low: 2, close: 1, volume: 1 }]), {
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
      candleCount: 1
    });
  });
});

function createCandles(count: number): IndicatorCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index + 0.5;

    return {
      high: close + 1.5,
      low: close - 1.5,
      close,
      volume: 100 + index
    };
  });
}
