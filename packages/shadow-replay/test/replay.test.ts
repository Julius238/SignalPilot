import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateBreakoutScenario, generateSyntheticSeries, runShadowReplay, type ReplayConfig, type ReplayMarketData } from "../src/index.js";
import { forcedCandidates } from "./support/forced-candidates.js";

// Every market in this file is synthetic: the tests prove the replay
// mechanics, never anything about real strategy performance.
const START = Date.UTC(2024, 0, 1);
const DAY = 86_400_000;

function market(days: number): ReplayMarketData {
  return {
    origin: "SYNTHETIC",
    synthetic: true,
    series: [
      generateSyntheticSeries({ symbol: "BTCUSDT", startMs: START, hours: days * 24, startPrice: 40000, seed: 7, baseVolume: 900 }),
      generateSyntheticSeries({ symbol: "ETHUSDT", startMs: START, hours: days * 24, startPrice: 2300, seed: 11, baseVolume: 9000 })
    ]
  };
}

function config(overrides: Partial<ReplayConfig> = {}): ReplayConfig {
  return {
    symbol: "BTCUSDT",
    strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1",
    mode: "SIGNAL_EDGE",
    regimePolicy: "CRYPTO_ONLY",
    startingCash: "10000",
    executionProfile: {
      tickSize: "0.01",
      stepSize: "0.00001",
      minQuantity: "0.00001",
      minNotional: "10",
      maxQuantity: null,
      feeBps: 10,
      fullSpreadBps: 2,
      slippageBps: 3,
      maxParticipationRate: "0.01"
    },
    codeVersion: "test",
    ...overrides
  };
}

const everyThirdMorning = forcedCandidates({
  every: (closeMs) => new Date(closeMs + 1).getUTCHours() === 9 && Math.floor(closeMs / DAY) % 3 === 0,
  stopPct: "0.022"
});

describe("shadow replay", () => {
  const data = market(245);

  it("is deterministic: identical input gives an identical output hash", () => {
    const first = runShadowReplay(data, config(), { evaluate: everyThirdMorning });
    const second = runShadowReplay(data, config(), { evaluate: everyThirdMorning });
    assert.ok(first.funnel.cycles > 0);
    assert.equal(first.outputHash, second.outputHash);
  });

  it("never reads the future: truncating the data does not change earlier strategy inputs", () => {
    const cutMs = START + 236 * DAY;
    const truncated: ReplayMarketData = {
      ...data,
      series: data.series.map((series) => ({
        ...series,
        candles: Object.fromEntries(
          Object.entries(series.candles).map(([timeframe, candles]) => [
            timeframe,
            (candles ?? []).filter((candle) => candle.closeTime < cutMs)
          ])
        )
      }))
    };
    const seen = (input: ReplayMarketData) => {
      const hashes = new Map<string, string>();
      runShadowReplay(input, config(), {
        onEvaluation: (anchorAt, evaluation) => {
          if (Date.parse(anchorAt) < cutMs - DAY) hashes.set(anchorAt, evaluation.inputHash);
        }
      });
      return hashes;
    };
    const full = seen(data);
    const cut = seen(truncated);
    assert.ok(full.size > 100);
    assert.deepEqual([...cut.entries()], [...full.entries()]);
  });

  it("fills, exits and books every trade consistently with the ledger", () => {
    const result = runShadowReplay(data, config(), { evaluate: everyThirdMorning });
    assert.ok(result.trades.length > 0, "expected simulated trades");
    assert.equal(result.invariantViolations, 0);
    for (const trade of result.trades) {
      assert.ok(["STOP", "TAKE_PROFIT", "TIME_EXIT"].includes(trade.exitReason), trade.exitReason);
      assert.equal(Number(trade.netPnl).toFixed(6), (Number(trade.grossPnl) - Number(trade.fees)).toFixed(6));
    }
    const realized = result.trades.reduce((sum, trade) => sum + Number(trade.netPnl), 0);
    assert.ok(Math.abs(Number(result.finalEquity) - (10000 + realized)) < 1e-6 || result.funnel.entriesFilled > result.trades.length);
    assert.ok(result.notes[0].includes("SYNTHETISCHE TESTDATEN"));
  });

  it("SPEC with the bootstrap cost profile (10/10/10 bps) rejects even a 2.2 % stop on the net 2R rule", () => {
    const result = runShadowReplay(
      data,
      config({ mode: "SPEC", executionProfile: { ...config().executionProfile, feeBps: 10, fullSpreadBps: 10, slippageBps: 10 } }),
      { evaluate: everyThirdMorning }
    );
    assert.ok(result.funnel.candidates > 0);
    assert.equal(result.funnel.riskApproved, 0);
    assert.ok((result.funnel.failedRiskRules["R-008-MIN-RR:REWARD_RISK_BELOW_MINIMUM"] ?? 0) > 0);
  });

  it("SPEC with realistic costs lets the risk engine approve, size and fill candidates", () => {
    const result = runShadowReplay(data, config({ mode: "SPEC" }), { evaluate: everyThirdMorning });
    assert.ok(result.funnel.riskApproved > 0);
    assert.ok(result.funnel.entriesFilled > 0);
    assert.equal(result.invariantViolations, 0);
  });

  it("reports near misses and forward returns against the all-hours baseline", () => {
    const result = runShadowReplay(data, config());
    const { nearMiss } = result.metrics;
    assert.equal(nearMiss.baseline.samples, result.funnel.cycles);
    assert.equal(nearMiss.candidates.samples, result.funnel.candidates);
    const nearMissTotal = nearMiss.blockers.reduce((sum, group) => sum + group.samples, 0);
    assert.ok(nearMissTotal <= result.funnel.noCandidate);
    for (const group of nearMiss.blockers) assert.ok(group.samples > 0 && group.blocker.length > 0);
  });

  it("labels training and test periods when a split is configured", () => {
    const split = new Date(START + 235 * DAY).toISOString();
    const result = runShadowReplay(data, config({ trainTestSplitAt: split }), { evaluate: everyThirdMorning });
    assert.ok(result.metrics.training !== null && result.metrics.test !== null);
    assert.equal(result.metrics.training.label, "Training (In-Sample)");
    for (const trade of result.trades) {
      assert.equal(trade.period, Date.parse(trade.anchorAt) >= Date.parse(split) ? "TEST" : "TRAINING");
    }
  });
});

describe("shadow replay — research variants", () => {
  const START_V = Date.UTC(2025, 0, 1);
  const scenario = (symbol: string, startPrice: number, assetType: "CRYPTO" | "ETF", seed: number) =>
    generateBreakoutScenario({
      symbol,
      assetType,
      startMs: START_V,
      startPrice,
      seed,
      events: [{ breakoutAtMs: START_V + 230 * 86_400_000 + 8 * 3_600_000, outcome: "WIN" }]
    });
  const data: ReplayMarketData = {
    origin: "SYNTHETIC",
    synthetic: true,
    series: [
      scenario("BTCUSDT", 60000, "CRYPTO", 1),
      scenario("ETHUSDT", 3000, "CRYPTO", 2),
      scenario("SPY", 560, "ETF", 3),
      scenario("QQQ", 480, "ETF", 4),
      scenario("IWM", 220, "ETF", 5)
    ]
  };
  const base = config({
    mode: "SPEC",
    regimePolicy: "AS_SPECIFIED",
    from: new Date(START_V + 228 * 86_400_000).toISOString()
  });

  it("finds the regular candidate of the textbook scenario and benchmarks it against buy-and-hold", () => {
    const result = runShadowReplay(data, base);
    assert.equal(result.funnel.candidates, 1);
    assert.equal(result.funnel.riskApproved, 1);
    assert.equal(result.trades[0]!.exitReason, "TAKE_PROFIT");
    assert.ok(result.metrics.overall.buyAndHoldReturnPct !== null);
    assert.ok(Number(result.metrics.overall.exposurePct) > 0);
  });

  it("applies a variant's overrides only inside the replay and labels the run", () => {
    const relaxed = runShadowReplay(data, { ...base, variant: "PRICE_ONLY" });
    const baseline = runShadowReplay(data, base);
    assert.ok(relaxed.funnel.candidates >= baseline.funnel.candidates);
    assert.ok(relaxed.notes.some((note) => note.includes("Forschungsvariante PRICE_ONLY")));
    assert.throws(() => runShadowReplay(data, { ...base, variant: "NOT_A_VARIANT" }), /Unknown strategy variant/);
  });
});
