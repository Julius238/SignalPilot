import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateATR,
  calculateAverageVolume,
  calculatePeriodHigh,
  calculateRSI,
  calculateSMA
} from "@signalpilot/indicators";
import { DecimalValue } from "@signalpilot/trading-domain";

import {
  averageTrueRange,
  priorAverageVolume,
  priorPeriodHigh,
  relativeStrengthIndex,
  relativeVolume,
  simpleMovingAverage,
  type PinnedCandle
} from "../src/indicators-v1.js";

import { BTC_1H_SHAPE, buildCandles } from "./support/build-snapshot.js";

/** Largest tolerated difference against the float implementation. */
const EPSILON = 1e-6;

function toPinned(candle: { high: string; low: string; close: string; volume: string; open: string }): PinnedCandle {
  return {
    open: DecimalValue.fromString(candle.open),
    high: DecimalValue.fromString(candle.high),
    low: DecimalValue.fromString(candle.low),
    close: DecimalValue.fromString(candle.close),
    volume: DecimalValue.fromString(candle.volume)
  };
}

const rawCandles = buildCandles("1h", BTC_1H_SHAPE, { idPrefix: "btc" });
const pinned = rawCandles.map(toPinned);
const closes = pinned.map((candle) => candle.close);

describe("indicators-v1 pinned against @signalpilot/indicators", () => {
  it("matches SMA for 20, 50 and 200", () => {
    for (const period of [20, 50, 200]) {
      const expected = calculateSMA(
        rawCandles.map((candle) => candle.close),
        period
      );
      const actual = simpleMovingAverage(closes, period);
      assert.notEqual(expected, null);
      assert.notEqual(actual, null);
      assert.ok(Math.abs(Number(actual!.toString()) - expected!) < EPSILON, `SMA${period}`);
    }
  });

  it("matches RSI(14)", () => {
    const expected = calculateRSI(
      rawCandles.map((candle) => candle.close),
      14
    );
    const actual = relativeStrengthIndex(closes, 14);
    assert.ok(Math.abs(Number(actual!.toString()) - expected!) < EPSILON);
  });

  it("matches ATR(14)", () => {
    const expected = calculateATR(rawCandles, 14);
    const actual = averageTrueRange(pinned, 14);
    assert.ok(Math.abs(Number(actual!.toString()) - expected!) < EPSILON);
  });

  it("uses the window before the anchor for the 20-candle high and volume", () => {
    const withoutAnchor = rawCandles.slice(0, -1);

    const expectedHigh = calculatePeriodHigh(withoutAnchor, 20);
    assert.equal(priorPeriodHigh(pinned, 20)!.toCompactString(), String(expectedHigh));

    const expectedVolume = calculateAverageVolume(withoutAnchor, 20);
    assert.ok(Math.abs(Number(priorAverageVolume(pinned, 20)!.toString()) - expectedVolume!) < EPSILON);
  });

  it("excludes the anchor candle from the 20-candle reference high", () => {
    // docs/trading/05: "`C0` selbst darf nicht im Vergleichsfenster liegen".
    const withHugeAnchorHigh = [...pinned];
    const anchor = withHugeAnchorHigh[withHugeAnchorHigh.length - 1];
    withHugeAnchorHigh[withHugeAnchorHigh.length - 1] = {
      ...anchor,
      high: DecimalValue.fromString("999999.000000000000")
    };

    assert.equal(
      priorPeriodHigh(withHugeAnchorHigh, 20)!.toString(),
      priorPeriodHigh(pinned, 20)!.toString()
    );
  });

  it("excludes the anchor candle from the average volume window", () => {
    const withHugeAnchorVolume = [...pinned];
    const anchor = withHugeAnchorVolume[withHugeAnchorVolume.length - 1];
    withHugeAnchorVolume[withHugeAnchorVolume.length - 1] = {
      ...anchor,
      volume: DecimalValue.fromString("100000.000000000000")
    };

    assert.equal(
      priorAverageVolume(withHugeAnchorVolume, 20)!.toString(),
      priorAverageVolume(pinned, 20)!.toString()
    );
  });
});

describe("indicators-v1 edge behaviour", () => {
  it("returns null below the required history", () => {
    assert.equal(simpleMovingAverage(closes.slice(-19), 20), null);
    assert.equal(relativeStrengthIndex(closes.slice(-14), 14), null);
    assert.equal(averageTrueRange(pinned.slice(-14), 14), null);
    assert.equal(priorPeriodHigh(pinned.slice(-20), 20), null);
  });

  it("returns 50 for a flat series and 100 without losses", () => {
    const flat = Array.from({ length: 15 }, () => DecimalValue.fromString("100.000000000000"));
    assert.equal(relativeStrengthIndex(flat, 14)!.toCompactString(), "50");

    const rising = Array.from({ length: 15 }, (_, index) =>
      DecimalValue.fromSafeInteger(100 + index)
    );
    assert.equal(relativeStrengthIndex(rising, 14)!.toCompactString(), "100");
  });

  it("refuses relative volume against a zero average", () => {
    assert.equal(relativeVolume(DecimalValue.fromSafeInteger(10), DecimalValue.ZERO), null);
    assert.equal(relativeVolume(DecimalValue.fromSafeInteger(10), null), null);
  });

  it("never returns a JavaScript number", () => {
    const sma = simpleMovingAverage(closes, 20);
    assert.ok(sma instanceof DecimalValue);
    assert.equal(typeof sma!.toString(), "string");
  });
});
