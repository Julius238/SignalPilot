import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateSyntheticSeries, runShadowReplay, type ReplayConfig, type ReplayMarketData } from "@signalpilot/shadow-replay";
import { CRYPTO_REGIME_LONG_V1_KEY, CRYPTO_TREND_CORE_LONG_V1_KEY } from "@signalpilot/strategy-engine";

import {
  EVOLUTION_ROOTS,
  FAMILY_SPECS,
  applyChanges,
  diffGenomes,
  distanceFromRoot,
  evolutionExecutionProfile,
  genomeHash,
  genomeReplayPlan,
  minimumStopDistanceForNet2R,
  neighbourGenomes,
  normalizeDecimal,
  rootByKey,
  rootReplayPlan,
  validateGenome
} from "../src/index.js";

const champion = rootByKey(`ROOT:${CRYPTO_TREND_CORE_LONG_V1_KEY}`)!;
const challenger = rootByKey(`ROOT:${CRYPTO_REGIME_LONG_V1_KEY}`)!;

describe("genome space", () => {
  it("roots are complete, valid genomes of the frozen champion and challenger", () => {
    assert.equal(EVOLUTION_ROOTS.length, 2);
    for (const root of EVOLUTION_ROOTS) {
      assert.deepEqual(validateGenome(root.genome), [], root.key);
      assert.deepEqual(Object.keys(root.genome.parameters).sort(), FAMILY_SPECS[root.genome.family].parameters.map((p) => p.name).sort());
    }
    assert.equal(champion.role, "CHAMPION");
    assert.equal(champion.genome.parameters.takeProfitRMultiple, "3");
    assert.equal(champion.genome.parameters.stopDistanceCapPct, "0.06");
    assert.equal(challenger.genome.parameters.takeProfitRMultiple, "4");
    assert.equal(challenger.genome.parameters.maxHoldHours, 720);
  });

  it("normalises decimals so equal values hash equally", () => {
    assert.equal(normalizeDecimal("0.0100"), "0.01");
    assert.equal(normalizeDecimal("3.000"), "3");
    assert.equal(normalizeDecimal(0.0175), "0.0175");
    const a = applyChanges(champion.genome, [{ parameter: "stopAtrMultiple", value: "2.00" }]);
    const b = applyChanges(champion.genome, [{ parameter: "stopAtrMultiple", value: "2" }]);
    assert.deepEqual(a.issues, []);
    assert.equal(genomeHash(a.genome), genomeHash(b.genome));
    assert.notEqual(genomeHash(a.genome), genomeHash(champion.genome));
  });

  it("applies valid changes and reports the diff against the parent", () => {
    const { genome, issues, applied } = applyChanges(champion.genome, [
      { parameter: "regimeMinimumConfidence", value: "70" },
      { parameter: "maxHoldHours", value: "120" }
    ]);
    assert.deepEqual(issues, []);
    assert.deepEqual(applied, [
      { parameter: "regimeMinimumConfidence", value: "70" },
      { parameter: "maxHoldHours", value: "120" }
    ]);
    assert.deepEqual(diffGenomes(champion.genome, genome), [
      { parameter: "maxHoldHours", from: 72, to: 120 },
      { parameter: "regimeMinimumConfidence", from: 60, to: 70 }
    ]);
    assert.equal(distanceFromRoot(genome), 2);
  });

  for (const [label, change, code] of [
    ["unknown parameter (costs are not part of the space)", { parameter: "feeBps", value: "1" }, "UNSUPPORTED_PARAMETER"],
    ["parameter of the other family", { parameter: "stopAtrMultiple1d", value: "2" }, "UNSUPPORTED_PARAMETER"],
    ["out of range", { parameter: "breakoutLookback", value: "500" }, "OUT_OF_RANGE"],
    ["off grid", { parameter: "stopAtrMultiple", value: "1.3" }, "OFF_GRID"],
    ["not a decimal", { parameter: "takeProfitRMultiple", value: "3e0" }, "INVALID_VALUE"],
    ["no effective change", { parameter: "takeProfitRMultiple", value: "3" }, "NO_EFFECTIVE_CHANGE"]
  ] as const) {
    it(`refuses ${label}`, () => {
      const { issues } = applyChanges(champion.genome, [change]);
      assert.ok(issues.some((issue) => issue.code === code), JSON.stringify(issues));
    });
  }

  it("refuses inconsistent bounds", () => {
    const rsi = applyChanges(champion.genome, [
      { parameter: "rsiMinimum", value: "60" },
      { parameter: "rsiMaximum", value: "65" }
    ]);
    assert.ok(rsi.issues.some((issue) => issue.code === "INCONSISTENT_BOUNDS" && issue.parameter === "rsiMinimum"));
    const stop = applyChanges(champion.genome, [
      { parameter: "stopDistanceFloorPct", value: "0.04" },
      { parameter: "stopDistanceCapPct", value: "0.03" }
    ]);
    assert.ok(stop.issues.some((issue) => issue.code === "INCONSISTENT_BOUNDS" && issue.parameter === "stopDistanceFloorPct"));
  });

  it("knows the stop distance the net 2R rule needs after realistic costs", () => {
    // 28 bp round trip: 2.5R gross needs ≥ 1.68 %, 3R ≥ 0.84 %; at ≤ 2R it is impossible.
    assert.ok(Math.abs(minimumStopDistanceForNet2R(2.5) - 0.0168) < 1e-12);
    assert.ok(Math.abs(minimumStopDistanceForNet2R(3) - 0.0084) < 1e-12);
    assert.equal(minimumStopDistanceForNet2R(2), Number.POSITIVE_INFINITY);
    // The grid itself keeps every cap above the requirement (cap ≥ 2 %, target ≥ 2.5R).
    const breakout = FAMILY_SPECS.BREAKOUT_LONG.parameters;
    const capMin = breakout.find((p) => p.name === "stopDistanceCapPct")!.min!;
    const tpMin = breakout.find((p) => p.name === "takeProfitRMultiple")!.min!;
    assert.ok(capMin >= minimumStopDistanceForNet2R(tpMin));
  });

  it("builds one-step neighbours on the grid, never the genome itself", () => {
    const neighbours = neighbourGenomes(champion.genome, ["breakoutLookback", "stopAtrMultiple"], 4);
    assert.equal(neighbours.length, 4);
    const lookbacks = neighbours.map((genome) => genome.parameters.breakoutLookback).filter((value) => value !== 20);
    assert.deepEqual(lookbacks.sort(), [15, 25]);
    for (const neighbour of neighbours) {
      assert.deepEqual(validateGenome(neighbour), []);
      assert.equal(diffGenomes(champion.genome, neighbour).length, 1);
    }
    assert.equal(new Set(neighbours.map(genomeHash)).size, 4);
  });

  it("compiles genomes into research identities of registered evaluators only", () => {
    assert.equal(genomeReplayPlan(champion.genome).strategyKey, "CRYPTO_MTF_BREAKOUT_LONG_V1");
    assert.equal(genomeReplayPlan(challenger.genome).strategyKey, CRYPTO_REGIME_LONG_V1_KEY);
    assert.equal(genomeReplayPlan(challenger.genome).hooks.regimeExit?.enabled, true);
    assert.equal(rootReplayPlan(champion).strategyKey, CRYPTO_TREND_CORE_LONG_V1_KEY);
    assert.deepEqual(rootReplayPlan(champion).hooks, {});
    assert.throws(() => genomeReplayPlan({ family: "BREAKOUT_LONG", parameters: { feeBps: 0 } }), /Invalid genome/);
  });
});

// Synthetic market: proves mechanics only, never real performance.
const START = Date.UTC(2023, 0, 1);
function syntheticMarket(days: number): ReplayMarketData {
  return {
    origin: "SYNTHETIC",
    synthetic: true,
    series: [
      generateSyntheticSeries({ symbol: "BTCUSDT", startMs: START, hours: days * 24, startPrice: 30000, seed: 3, baseVolume: 900 }),
      generateSyntheticSeries({ symbol: "ETHUSDT", startMs: START, hours: days * 24, startPrice: 1800, seed: 5, baseVolume: 9000 })
    ]
  };
}

function config(strategyKey: string): ReplayConfig {
  return {
    symbol: "BTCUSDT",
    strategyKey,
    mode: "SIGNAL_EDGE",
    regimePolicy: "CRYPTO_NATIVE_V1",
    startingCash: "10000",
    executionProfile: evolutionExecutionProfile("BTCUSDT"),
    codeVersion: "test"
  };
}

const tradeShape = (trades: readonly { openedAt: string; closedAt: string; exitReason: string; netPnl: string; quantity: string }[]) =>
  trades.map((trade) => [trade.openedAt, trade.closedAt, trade.exitReason, trade.netPnl, trade.quantity]);

describe("root equivalence (technical test of the research path)", () => {
  const data = syntheticMarket(420);

  it("the champion root as research genome trades exactly like the registered champion", () => {
    const registered = runShadowReplay(data, config(CRYPTO_TREND_CORE_LONG_V1_KEY));
    const plan = genomeReplayPlan(champion.genome);
    const research = runShadowReplay(data, config(plan.strategyKey), plan.hooks);
    assert.ok(registered.trades.length >= 10, "the synthetic market must produce enough champion trades to compare");
    assert.equal(research.funnel.candidates, registered.funnel.candidates);
    assert.deepEqual(tradeShape(research.trades), tradeShape(registered.trades));
  });

  it("the challenger root as research genome trades exactly like the registered challenger", () => {
    const registered = runShadowReplay(data, config(CRYPTO_REGIME_LONG_V1_KEY));
    const plan = genomeReplayPlan(challenger.genome);
    const research = runShadowReplay(data, config(plan.strategyKey), plan.hooks);
    assert.ok(registered.trades.length > 0, "the synthetic market should open the regime gate at least once");
    assert.deepEqual(tradeShape(research.trades), tradeShape(registered.trades));
  });

  it("a changed genome changes the decisions", () => {
    const { genome } = applyChanges(challenger.genome, [{ parameter: "exitOnRegimeGateClosed", value: "false" }]);
    const plan = genomeReplayPlan(genome);
    const base = runShadowReplay(data, config(CRYPTO_REGIME_LONG_V1_KEY));
    const changed = runShadowReplay(data, config(plan.strategyKey), plan.hooks);
    assert.ok(changed.trades.every((trade) => trade.exitReason !== "INVALIDATION"));
    assert.notDeepEqual(tradeShape(changed.trades), tradeShape(base.trades));
  });
});
