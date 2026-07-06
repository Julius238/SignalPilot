import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateRSI, type IndicatorCandle } from "@signalpilot/indicators";

import { evaluateChartPatterns } from "../src/lib/chartPatterns.js";

function candle(close: number, volume = 100): IndicatorCandle {
  return {
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume
  };
}

// Flache Serie um 100, letzte Kerze nahe am 20-Perioden-Hoch
function seriesNearHigh(lastVolume = 100): IndicatorCandle[] {
  const candles: IndicatorCandle[] = [];
  for (let index = 0; index < 24; index += 1) {
    candles.push(candle(100 + Math.sin(index) * 0.4));
  }
  // Hoch der Serie liegt bei ~101.4 (high = close * 1.01) — Schluss nahe darunter
  candles.push({ high: 101.4, low: 100.2, close: 101.0, volume: lastVolume });
  return candles;
}

describe("evaluateChartPatterns", () => {
  it("detects SR proximity near the period high without volume confirmation", () => {
    const observations = evaluateChartPatterns("BTCUSDT", "1h", seriesNearHigh(100));

    const sr = observations.find((entry) => entry.patternType === "SR_PROXIMITY");
    assert.ok(sr, "expected SR_PROXIMITY observation");
    assert.equal(sr.direction, "UP");
    assert.equal(sr.severity, "INFO");
    assert.match(sr.shortMessage, /Nähe Widerstandsbereich/);
    assert.doesNotMatch(sr.shortMessage, /kauf|verkauf|long|short|entry|exit/i);
  });

  it("upgrades to breakout proximity when volume confirms", () => {
    const observations = evaluateChartPatterns("BTCUSDT", "1h", seriesNearHigh(250));

    const breakout = observations.find((entry) => entry.patternType === "BREAKOUT_PROXIMITY");
    assert.ok(breakout, "expected BREAKOUT_PROXIMITY observation");
    assert.equal(breakout.direction, "UP");
    assert.match(breakout.shortMessage, /möglicher Ausbruchsbereich oberhalb/);
    assert.ok(breakout.score > 0);
    assert.ok(!observations.some((entry) => entry.patternType === "SR_PROXIMITY"));
  });

  it("detects a bullish momentum shift when the RSI crosses the midline", () => {
    // 20 fallende Kerzen drücken den RSI unter 50, danach kräftige Erholung.
    const closes = [
      110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91,
      94, 97, 100, 103
    ];
    const candles = closes.map((close) => candle(close));

    // Vorbedingung absichern, damit der Test bei Serienänderungen laut scheitert:
    const previousRsi = calculateRSI(closes.slice(0, -1), 14);
    const currentRsi = calculateRSI(closes, 14);
    assert.ok(previousRsi !== null && previousRsi < 50, `previous RSI must be < 50, got ${previousRsi}`);
    assert.ok(currentRsi !== null && currentRsi >= 53, `current RSI must be >= 53, got ${currentRsi}`);

    const observations = evaluateChartPatterns("ETHUSDT", "1h", candles);
    const momentum = observations.find((entry) => entry.patternType === "MOMENTUM_SHIFT");

    assert.ok(momentum, "expected MOMENTUM_SHIFT observation");
    assert.equal(momentum.direction, "UP");
    assert.match(momentum.shortMessage, /Momentum-Wechsel aufwärts/);
  });

  it("emits a confluence event when enough factors align", () => {
    const observations = evaluateChartPatterns(
      "BTCUSDT",
      "1h",
      seriesNearHigh(250),
      {},
      ["auffällige Bewegung", "Volumenanstieg"]
    );

    const confluence = observations.find((entry) => entry.patternType === "CONFLUENCE");
    assert.ok(confluence, "expected CONFLUENCE observation");
    assert.ok(["IMPORTANT", "CRITICAL"].includes(confluence.severity));
    assert.match(confluence.shortMessage, /mehrere Faktoren gleichzeitig auffällig/);
    assert.match(confluence.shortMessage, /auffällige Bewegung/);
  });

  it("stays silent without enough factors and returns nothing for flat mid-range series", () => {
    // Serie, deren Schluss weit von beiden Extremen entfernt liegt
    const candles: IndicatorCandle[] = [];
    for (let index = 0; index < 24; index += 1) {
      candles.push(candle(100 + (index % 2 === 0 ? 5 : -5)));
    }
    candles.push(candle(100));

    const observations = evaluateChartPatterns("BTCUSDT", "1h", candles);

    assert.ok(!observations.some((entry) => entry.patternType === "SR_PROXIMITY"));
    assert.ok(!observations.some((entry) => entry.patternType === "BREAKOUT_PROXIMITY"));
    assert.ok(!observations.some((entry) => entry.patternType === "CONFLUENCE"));
  });

  it("returns no observations for insufficient data", () => {
    const observations = evaluateChartPatterns("BTCUSDT", "1h", [candle(100), candle(101)]);
    assert.deepEqual(observations, []);
  });
});
