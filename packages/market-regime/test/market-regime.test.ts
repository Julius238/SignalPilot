import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CRYPTO_NATIVE_REGIME_VERSION,
  buildSignalRegimeContext,
  calculateCryptoNativeRegimeReport,
  calculateMarketRegimeReport,
  type BenchmarkInput
} from "../src/index.js";

describe("market regime", () => {
  it("detects equity RISK_ON when SPY and QQQ are above SMA50/SMA200 with positive momentum", () => {
    const report = calculateMarketRegimeReport({
      benchmarks: [
        benchmark("SPY", "ETF", uptrend()),
        benchmark("QQQ", "ETF", uptrend()),
        benchmark("IWM", "ETF", uptrend())
      ]
    });

    assert.equal(report.equityRegime, "RISK_ON");
  });

  it("detects equity RISK_OFF when SPY and QQQ are below SMA50 with negative momentum", () => {
    const report = calculateMarketRegimeReport({
      benchmarks: [
        benchmark("SPY", "ETF", downtrend()),
        benchmark("QQQ", "ETF", downtrend()),
        benchmark("IWM", "ETF", downtrend())
      ]
    });

    assert.equal(report.equityRegime, "RISK_OFF");
    assert.equal(report.riskMode, "HIGH_RISK");
  });

  it("detects crypto RISK_ON and RISK_OFF", () => {
    const riskOn = calculateMarketRegimeReport({
      benchmarks: [benchmark("BTCUSDT", "CRYPTO", uptrend()), benchmark("ETHUSDT", "CRYPTO", uptrend())]
    });
    const riskOff = calculateMarketRegimeReport({
      benchmarks: [benchmark("BTCUSDT", "CRYPTO", downtrend()), benchmark("ETHUSDT", "CRYPTO", downtrend())]
    });

    assert.equal(riskOn.cryptoRegime, "RISK_ON");
    assert.equal(riskOff.cryptoRegime, "RISK_OFF");
  });

  it("detects MIXED when benchmarks disagree", () => {
    const report = calculateMarketRegimeReport({
      benchmarks: [
        benchmark("SPY", "ETF", uptrend()),
        benchmark("QQQ", "ETF", downtrend()),
        benchmark("IWM", "ETF", uptrend()),
        benchmark("BTCUSDT", "CRYPTO", uptrend()),
        benchmark("ETHUSDT", "CRYPTO", downtrend())
      ]
    });

    assert.equal(report.equityRegime, "MIXED");
    assert.equal(report.cryptoRegime, "MIXED");
  });

  it("returns UNKNOWN when there is not enough data", () => {
    const report = calculateMarketRegimeReport({
      benchmarks: [benchmark("SPY", "ETF", uptrend().slice(-30)), benchmark("QQQ", "ETF", uptrend().slice(-30))]
    });

    assert.equal(report.equityRegime, "UNKNOWN");
  });

  it("marks bullish watch signals against RISK_OFF as high conflict", () => {
    const report = calculateMarketRegimeReport({
      benchmarks: [benchmark("BTCUSDT", "CRYPTO", downtrend()), benchmark("ETHUSDT", "CRYPTO", downtrend())]
    });

    const context = buildSignalRegimeContext({
      symbol: "SOLUSDT",
      assetType: "CRYPTO",
      signalDirection: "BULLISH",
      signalStatus: "WATCH",
      report
    });

    assert.equal(context.marketRegime, "RISK_OFF");
    assert.equal(context.isAlignedWithRegime, false);
    assert.equal(context.conflictLevel, "HIGH");
  });
});

function benchmark(symbol: string, assetType: string, closes: number[]): BenchmarkInput {
  return {
    symbol,
    assetType,
    timeframe: "1d",
    candles: closes.map((close) => ({ close }))
  };
}

function uptrend() {
  return Array.from({ length: 240 }, (_, index) => 100 + index * 0.4);
}

function downtrend() {
  return Array.from({ length: 240 }, (_, index) => 220 - index * 0.4);
}

/** Long decline, then a sharp rally that clears the 50-day but not the 200-day SMA. */
function bearMarketRally() {
  const decline = Array.from({ length: 200 }, (_, index) => 300 - index);
  const rally = Array.from({ length: 40 }, (_, index) => 100 + index * 1.25);
  return [...decline, ...rally];
}

describe("crypto-native regime", () => {
  const crypto = (btc: number[], eth: number[]) => [
    benchmark("BTCUSDT", "CRYPTO", btc),
    benchmark("ETHUSDT", "CRYPTO", eth)
  ];

  it("is RISK_ON with sufficient confidence from BTC and ETH alone", () => {
    const report = calculateCryptoNativeRegimeReport({ benchmarks: crypto(uptrend(), uptrend()) });
    assert.equal(report.cryptoRegime, "RISK_ON");
    assert.equal(report.overallRegime, "RISK_ON");
    assert.equal(report.equityRegime, "UNKNOWN");
    assert.equal(report.confidence, 90);
    assert.equal(report.riskMode, "AGGRESSIVE");
    assert.match(report.summary, new RegExp(CRYPTO_NATIVE_REGIME_VERSION.replace(/[/.]/g, "\\$&")));
  });

  it("ignores equity benchmarks entirely", () => {
    const withEquityRiskOff = calculateCryptoNativeRegimeReport({
      benchmarks: [...crypto(uptrend(), uptrend()), benchmark("SPY", "ETF", downtrend()), benchmark("QQQ", "ETF", downtrend())]
    });
    const production = calculateMarketRegimeReport({
      benchmarks: [...crypto(uptrend(), uptrend()), benchmark("SPY", "ETF", downtrend()), benchmark("QQQ", "ETF", downtrend())]
    });
    assert.equal(withEquityRiskOff.riskMode, "AGGRESSIVE");
    assert.equal(withEquityRiskOff.benchmarkSummaries.length, 2);
    // The production report vetoes the same crypto picture through the equity regime.
    assert.equal(production.cryptoRegime, "RISK_ON");
    assert.equal(production.riskMode, "HIGH_RISK");
  });

  it("keeps a bear-market rally below the 200-day SMA out of RISK_ON", () => {
    const report = calculateCryptoNativeRegimeReport({ benchmarks: crypto(bearMarketRally(), bearMarketRally()) });
    const production = calculateMarketRegimeReport({ benchmarks: crypto(bearMarketRally(), bearMarketRally()) });
    assert.equal(production.cryptoRegime, "RISK_ON");
    assert.notEqual(report.cryptoRegime, "RISK_ON");
  });

  it("is RISK_OFF with a high-risk mode in a downtrend", () => {
    const report = calculateCryptoNativeRegimeReport({ benchmarks: crypto(downtrend(), downtrend()) });
    assert.equal(report.cryptoRegime, "RISK_OFF");
    assert.equal(report.riskMode, "HIGH_RISK");
  });

  it("is UNKNOWN without enough history", () => {
    const report = calculateCryptoNativeRegimeReport({ benchmarks: crypto(uptrend().slice(0, 100), uptrend()) });
    assert.equal(report.cryptoRegime, "UNKNOWN");
    assert.equal(report.riskMode, "UNKNOWN");
  });
});
