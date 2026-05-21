import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSignalRegimeContext,
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
