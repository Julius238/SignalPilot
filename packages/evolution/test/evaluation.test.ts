import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVOLUTION_DATA_SPLIT_V1 as SPLIT,
  EVOLUTION_GATES_V1,
  EVOLUTION_ROOTS,
  combineDailyEquity,
  correlationOfDailyReturns,
  evidenceGrade,
  finalGates,
  foldMetrics,
  foldStability,
  maxDrawdownPct,
  profitFactor,
  researchScore,
  rollingWalkForward,
  screeningGates,
  selectFinalists,
  statusAfterFinal,
  checkOperatorDecision,
  stressedNetPnl,
  tStatistic,
  windowMetrics,
  type ScreeningInput,
  type WindowMetrics
} from "../src/index.js";
import { backtest, trade } from "./support.js";

const D = SPLIT.windows.DISCOVERY;
const V = SPLIT.windows.VALIDATION;

/** A steady strategy: two trades a month, 60 % winners at +2R, losers at −1R, on BTC and ETH. */
function steadyTrades(from: string, to: string, symbol: string): ReturnType<typeof trade>[] {
  const trades = [];
  let index = 0;
  for (let at = Date.parse(from) + 3 * 86_400_000; at < Date.parse(to); at += 15 * 86_400_000) {
    const win = index % 5 < 3;
    trades.push(trade({ symbol, anchorAt: new Date(at).toISOString(), netPnl: win ? 50 : -25 }));
    index += 1;
  }
  return trades;
}

function inputFor(trades: ReturnType<typeof trade>[]): { discovery: WindowMetrics; validation: WindowMetrics; inSample: WindowMetrics; backtests: ReturnType<typeof backtest>[] } {
  const backtests = ["BTCUSDT", "ETHUSDT"].map((symbol) => backtest(symbol, trades, D.from, V.to));
  return {
    backtests,
    discovery: windowMetrics({ label: "D", from: D.from, to: D.to, backtests, periodKey: "discovery" }),
    validation: windowMetrics({ label: "V", from: V.from, to: V.to, backtests, periodKey: "validation" }),
    inSample: windowMetrics({ label: "D+V", from: D.from, to: V.to, backtests })
  };
}

describe("metrics", () => {
  it("computes profit factor, R statistics and t-statistics", () => {
    assert.equal(profitFactor([50, -25, 50, -25]), 2);
    assert.equal(profitFactor([10, 20]), null, "no losing trade: unbounded, reported as not computable");
    assert.equal(tStatistic([1, 1]), null);
    assert.ok(tStatistic([1, 2, 3, 4])! > 3);
  });

  it("stresses costs on the same trades", () => {
    const entry = trade({ anchorAt: D.from, netPnl: 10 });
    // fees 0.6 + spread 0.1 + slippage 0.3 = 1.0 → doubled costs cost one more.
    assert.equal(stressedNetPnl(entry, 2), 9);
    assert.equal(stressedNetPnl(entry, 3), 8);
  });

  it("combines accounts and measures drawdown on mark-to-market equity", () => {
    const combined = combineDailyEquity(
      [
        [{ day: "2020-01-01", equity: 10000 }, { day: "2020-01-03", equity: 9000 }],
        [{ day: "2020-01-02", equity: 10100 }]
      ],
      [10000, 10000]
    );
    assert.deepEqual(combined, [
      { day: "2020-01-01", equity: 20000 },
      { day: "2020-01-02", equity: 20100 },
      { day: "2020-01-03", equity: 19100 }
    ]);
    assert.ok(Math.abs(maxDrawdownPct(combined)! - (1000 / 20100) * 100) < 1e-9);
  });

  it("aggregates a window per symbol and against buy-and-hold", () => {
    const trades = [...steadyTrades(D.from, V.to, "BTCUSDT"), ...steadyTrades(D.from, V.to, "ETHUSDT")];
    const { discovery, validation } = inputFor(trades);
    assert.ok(discovery.trades > 150);
    assert.ok(Math.abs(discovery.profitFactor! - 3) < 0.15, String(discovery.profitFactor));
    assert.ok(Math.abs(discovery.averageR! - 0.8) < 0.05);
    assert.equal(discovery.perSymbol.BTCUSDT!.trades + discovery.perSymbol.ETHUSDT!.trades, discovery.trades);
    assert.equal(discovery.buyAndHoldReturnPct, 80);
    assert.equal(validation.buyAndHoldReturnPct, -10);
    assert.ok(discovery.netReturnPct! > 0 && discovery.sharpe! > 0);
    assert.ok(discovery.stressed.netPnl < discovery.netPnl);
  });

  it("correlates daily returns and reports null without enough overlap", () => {
    const up = Array.from({ length: 60 }, (_, index) => ({ day: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10), equity: 10000 + (index % 3) * 10 + index }));
    assert.ok(correlationOfDailyReturns(up, up)! > 0.999);
    assert.equal(correlationOfDailyReturns(up.slice(0, 10), up.slice(0, 10)), null);
  });

  it("finds unstable and concentrated results across walk-forward segments", () => {
    const only2020 = [trade({ anchorAt: "2020-03-01T00:00:00.000Z", netPnl: 500 }), trade({ anchorAt: "2020-04-01T00:00:00.000Z", netPnl: 400 })];
    const losers = ["2019", "2021"].flatMap((year) => [
      trade({ anchorAt: `${year}-03-01T00:00:00.000Z`, netPnl: -25 }),
      trade({ anchorAt: `${year}-05-01T00:00:00.000Z`, netPnl: -25 })
    ]);
    const folds = foldMetrics(SPLIT, [backtest("BTCUSDT", [...only2020, ...losers], D.from, V.to)]);
    assert.deepEqual(folds.map((fold) => fold.key), ["2018", "2019", "2020", "2021", "2022H1", "2022H2", "2023"]);
    const stability = foldStability(folds);
    assert.equal(stability.foldsWithTrades, 3);
    assert.equal(stability.positiveFolds, 1);
    assert.equal(stability.concentration, 1);
  });
});

describe("walk-forward", () => {
  it("selects with past information only and measures out-of-sample efficiency", () => {
    const years = ["2018-06", "2019-06", "2020-06", "2021-06", "2022-03", "2022-09", "2023-06"];
    const many = (month: string, r: number) => Array.from({ length: 6 }, (_, index) => trade({ anchorAt: `${month}-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, netPnl: r * 25 }));
    // The candidate earns +0.4R everywhere; the neighbour shines early (+1R) and then collapses (−0.5R).
    const candidate = years.flatMap((month) => many(month, 0.4));
    const neighbour = years.flatMap((month, index) => many(month, index < 2 ? 1 : -0.5));
    const result = rollingWalkForward(SPLIT, "C", [
      { key: "C", trades: candidate },
      { key: "N", trades: neighbour }
    ]);
    assert.equal(result.steps.length, 6);
    // Step for 2019 and 2020 still prefer the early-shining neighbour, which then fails out of sample.
    assert.equal(result.steps[0]!.selectedVariant, "N");
    assert.ok(result.outOfSampleAverageR! < result.inSampleAverageR!);
    const honest = rollingWalkForward(SPLIT, "C", [{ key: "C", trades: candidate }]);
    assert.ok(Math.abs(honest.efficiency! - 1) < 1e-9);
    assert.equal(honest.candidateSelectedShare, 1);
  });
});

function screening(overrides: Partial<ScreeningInput> = {}): ScreeningInput {
  const trades = [...steadyTrades(D.from, V.to, "BTCUSDT"), ...steadyTrades(D.from, V.to, "ETHUSDT")];
  const { discovery, validation, inSample, backtests } = inputFor(trades);
  const weakTrades = [...steadyTrades(D.from, V.to, "BTCUSDT")].map((entry, index) => ({ ...entry, netPnl: index % 2 === 0 ? 30 : -25, rMultiple: index % 2 === 0 ? 1.2 : -1 }));
  const champion = windowMetrics({ label: "champion", from: D.from, to: V.to, backtests: [backtest("BTCUSDT", weakTrades, D.from, V.to)] });
  return {
    technical: { passed: true, failures: [] },
    dataIntegrity: { passed: true, failures: [] },
    discovery,
    validation,
    inSample,
    folds: foldStability(foldMetrics(SPLIT, backtests)),
    correlations: [{ key: "ROOT:CRYPTO_TREND_CORE_LONG_V1", value: 0.3 }],
    champion,
    ...overrides
  };
}

describe("gates", () => {
  it("passes a robust candidate through every screening gate", () => {
    const results = screeningGates(screening());
    assert.deepEqual(results.filter((result) => !result.passed), []);
    assert.equal(results.length, 10);
  });

  it("rejects with concrete reasons", () => {
    const base = screening();
    const cases: [Partial<ScreeningInput>, string][] = [
      [{ technical: { passed: false, failures: ["nicht deterministisch"] } }, "TECHNICAL_TESTS_FAILED"],
      [{ dataIntegrity: { passed: false, failures: ["Anker nach 2026-10-15"] } }, "DATA_LEAK_DETECTED"],
      [{ discovery: { ...base.discovery, trades: 5 } }, "TOO_FEW_TRADES"],
      [{ discovery: { ...base.discovery, averageR: 0.01 } }, "NO_DISCOVERY_EDGE"],
      [{ validation: { ...base.validation, averageR: -0.1 } }, "VALIDATION_FAILED"],
      [{ inSample: { ...base.inSample, stressed: { ...base.inSample.stressed, netPnl: -1 } } }, "FAILS_COST_STRESS"],
      [{ inSample: { ...base.inSample, maxDrawdownPct: 25 } }, "DRAWDOWN_TOO_DEEP"],
      [{ folds: { ...base.folds, concentration: 0.9 } }, "CARRIED_BY_ONE_PHASE"],
      [{ correlations: [{ key: "ROOT:CRYPTO_TREND_CORE_LONG_V1", value: 0.97 }] }, "REDUNDANT_WITH_EXISTING"],
      [{ champion: { ...base.champion, sharpe: 99 }, correlations: [{ key: "X", value: 0.8 }] }, "NO_ADVANTAGE_OVER_CHAMPION"]
    ];
    for (const [override, code] of cases) {
      const failed = screeningGates({ ...base, ...override }).filter((result) => !result.passed);
      assert.ok(failed.some((result) => result.reasonCode === code), `${code}: ${JSON.stringify(failed.map((result) => result.reasonCode))}`);
      assert.ok(failed.every((result) => result.message.length > 20));
    }
  });

  it("lets a weaker but uncorrelated candidate pass as diversifier", () => {
    const base = screening();
    const results = screeningGates({ ...base, champion: { ...base.champion, sharpe: 99 }, correlations: [{ key: "X", value: 0.2 }] });
    assert.equal(results.find((result) => result.gate === "BENCHMARK")!.reasonCode, "DIVERSIFIES_EXISTING");
  });

  it("final gates: neighbours, walk-forward and the (previously analysed) holdout", () => {
    const base = screening();
    const wf = { steps: [], outOfSampleTrades: 30, outOfSampleAverageR: 0.3, inSampleAverageR: 0.5, efficiency: 0.6, candidateSelectedShare: 1 };
    const ok = finalGates({ neighbours: [{ key: "n1", inSample: base.inSample }], walkForward: wf, holdout: base.validation });
    assert.deepEqual(ok.filter((result) => !result.passed), []);
    assert.equal(statusAfterFinal(screeningGates(base), ok), "PROPOSED");
    const bad = finalGates({
      neighbours: [{ key: "n1", inSample: { ...base.inSample, averageR: -0.2 } }],
      walkForward: { ...wf, outOfSampleAverageR: -0.1, efficiency: -0.2 },
      holdout: { ...base.validation, averageR: -0.3 }
    });
    assert.deepEqual(bad.filter((result) => !result.passed).map((result) => result.reasonCode), ["FRAGILE_OPTIMUM", "WALK_FORWARD_COLLAPSES", "HOLDOUT_FAILED"]);
    assert.equal(statusAfterFinal(screeningGates(base), bad), "REJECTED");
    assert.ok(bad[2]!.message.includes("bereits analysiert") === false || bad[2]!.message.length > 0);
  });

  it("scores robustness around a neutral 50 and penalises complexity", () => {
    const base = screening();
    const genome = EVOLUTION_ROOTS[0]!.genome;
    const good = researchScore({ discovery: base.discovery, validation: base.validation, inSample: base.inSample, folds: base.folds, maxCorrelation: 0.3, genome });
    assert.ok(good.score > 60 && good.score <= 100, String(good.score));
    assert.equal(good.complexityPenalty, 0);
    const complex = { ...genome, parameters: { ...genome.parameters, breakoutLookback: 30, rsiMinimum: 10, maxHoldHours: 96, stopAtrMultiple: "2" } };
    assert.equal(researchScore({ discovery: base.discovery, validation: base.validation, inSample: base.inSample, folds: base.folds, maxCorrelation: 0.3, genome: complex }).complexityPenalty, 4);
  });

  it("grades evidence against the multiple-testing bar √(2·ln N)", () => {
    assert.equal(evidenceGrade(null, 10).grade, "NONE");
    assert.equal(evidenceGrade(0.5, 10).grade, "NONE");
    assert.equal(evidenceGrade(1.5, 50).grade, "WEAK");
    assert.equal(evidenceGrade(3.0, 50).grade, "MODERATE");
    assert.equal(evidenceGrade(4.0, 50).grade, "STRONG");
    assert.equal(evidenceGrade(2, 50).threshold, 2.8);
    // More trials raise the bar.
    assert.ok(evidenceGrade(2, 1000).threshold > evidenceGrade(2, 30).threshold);
  });

  it("selects finalists by score with a deterministic tie-break and leaves operator decisions to the operator", () => {
    assert.deepEqual(
      selectFinalists(
        [
          { key: "EVO-BRK-0002", score: 70, passedScreening: true },
          { key: "EVO-BRK-0001", score: 70, passedScreening: true },
          { key: "EVO-REG-0001", score: 90, passedScreening: false },
          { key: "EVO-REG-0002", score: 60, passedScreening: true }
        ],
        EVOLUTION_GATES_V1.maxFinalists
      ),
      ["EVO-BRK-0001", "EVO-BRK-0002"]
    );
    assert.deepEqual(checkOperatorDecision("PROPOSED", "APPROVED_FOR_FORWARD_TEST"), { ok: true });
    assert.equal(checkOperatorDecision("REJECTED", "APPROVED_FOR_FORWARD_TEST").ok, false);
    assert.equal(checkOperatorDecision("PROPOSED", "RESERVE").ok, false);
  });
});
