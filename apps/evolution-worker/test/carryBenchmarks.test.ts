import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EVOLUTION_ROOTS, type CompactTrade, type PortfolioMemberSummary, type PortfolioSummary } from "@signalpilot/evolution";

import {
  carryBenchmarkCsv,
  carryBenchmarkRows,
  carryBenchmarkWindows,
  CARRY_STUDY_MONTHS,
  memberMonthlyBinding,
  memberMonthlyReturns,
  runCarryBenchmarkComparisons,
  type CarryBenchmarkRun
} from "../src/research/carryBenchmarks.js";
import { SYNTHETIC_SPLIT, syntheticMarket } from "./support.js";

const champion = EVOLUTION_ROOTS.find((root) => root.role === "CHAMPION")!;
const challenger = EVOLUTION_ROOTS.find((root) => root.role === "CHALLENGER")!;

function trade(openedAt: string, closedAt: string, notional: number): CompactTrade {
  return {
    symbol: "BTCUSDT", anchorAt: openedAt, openedAt, closedAt, exitReason: "TEST", entryPrice: notional, quantity: 1, plannedRisk: 0,
    grossPnl: 0, fees: 0, spreadCost: 0, slippageCost: 0, netPnl: 0, rMultiple: null, holdHours: 0, marketRegime: null
  };
}

function member(key: string, dailyEquity: { day: string; equity: number }[], trades: CompactTrade[] = []): PortfolioMemberSummary {
  return {
    key, strategyKey: key, researchIdentity: null, startingCash: 20_000, finalEquity: dailyEquity.at(-1)!.equity, trades, dailyEquity,
    funnel: { cycles: 0, candidates: 0, riskApproved: 0, riskRejected: 0, entriesFilled: 0 },
    groupRejected: 0, groupRejections: {}, invariantViolations: 0, killSwitchEngagements: 0, outputHash: "x"
  };
}

function baseline(members: PortfolioMemberSummary[]): PortfolioSummary {
  return { comparison: "BASELINE", members } as unknown as PortfolioSummary;
}

describe("funding carry benchmarks (comparison A, read-only)", () => {
  it("measures the first month from the slot's starting cash", () => {
    const window = { key: "W", from: "2024-01-01T00:00:00.000Z", to: "2024-02-29T23:59:59.999Z" };
    const returns = memberMonthlyReturns(member("M", [{ day: "2024-01-01", equity: 20_100 }, { day: "2024-01-31", equity: 20_200 }, { day: "2024-02-29", equity: 19_998 }]), window);
    assert.deepEqual([...returns.entries()], [["2024-01", 20_200 / 20_000 - 1], ["2024-02", 19_998 / 20_200 - 1]]);
  });

  it("weights the entry notional by the hours a position was open in each month", () => {
    const window = { key: "W", from: "2024-01-01T00:00:00.000Z", to: "2024-02-29T23:59:59.999Z" };
    // 2 000 USDT open for the last 24 h of January and the first 24 h of February.
    const binding = memberMonthlyBinding(member("M", [{ day: "2024-02-29", equity: 20_000 }], [trade("2024-01-31T00:00:00.000Z", "2024-02-02T00:00:00.000Z", 2_000)]), window);
    assert.ok(Math.abs(binding.get("2024-01")! - (2_000 * 24) / (31 * 24 * 20_000)) < 1e-15);
    assert.ok(Math.abs(binding.get("2024-02")! - (2_000 * 24) / (29 * 24 * 20_000)) < 1e-15);
  });

  it("stitches the windows to the study months and refuses gaps or other comparisons", () => {
    const first = { key: "DISCOVERY_VALIDATION", from: "2023-11-01T00:00:00.000Z", to: "2023-12-31T23:59:59.999Z" };
    const second = { key: "HOLDOUT", from: "2024-01-01T00:00:00.000Z", to: "2024-01-31T23:59:59.999Z" };
    const curve = (days: string[], equity: number) => days.map((day) => ({ day, equity }));
    const runs: CarryBenchmarkRun[] = [
      { window: first, summary: baseline([member(champion.key, curve(["2023-11-30", "2023-12-31"], 20_200)), member(challenger.key, curve(["2023-11-30", "2023-12-31"], 20_400))]) },
      { window: second, summary: baseline([member(champion.key, curve(["2024-01-31"], 19_800)), member(challenger.key, curve(["2024-01-31"], 20_600))]) }
    ];
    const rows = carryBenchmarkRows(runs, ["2023-12", "2024-01"]);
    assert.deepEqual(rows.map((row) => [row.month, row.champion, row.challenger]), [["2023-12", 0, 0], ["2024-01", 19_800 / 20_000 - 1, 20_600 / 20_000 - 1]]);
    assert.equal(carryBenchmarkCsv(rows).split("\n")[0], "month,champion,challenger,champion_binding,challenger_binding");
    assert.throws(() => carryBenchmarkRows(runs, ["2024-02"]), /No benchmark value for 2024-02/);
    assert.throws(() => carryBenchmarkRows([{ ...runs[0]!, summary: { ...runs[0]!.summary, comparison: "WITH_CANDIDATE" } }], ["2023-12"]), /Only comparison A/);
  });

  it("covers the 81 study months with the windows of evolution-split-v1", () => {
    assert.equal(CARRY_STUDY_MONTHS.length, 81);
    const [inSample, holdout] = carryBenchmarkWindows();
    assert.ok(inSample!.from <= "2020-01-01" && inSample!.to.startsWith("2023-12-31"));
    assert.ok(holdout!.from.startsWith("2024-01-01") && holdout!.to >= "2026-09-30");
  });

  // Synthetic candles: the test proves the wiring through the unchanged portfolio replay, not any strategy.
  it("runs comparison A on a synthetic market and yields finite returns and bindings", { timeout: 600_000 }, () => {
    const { market } = syntheticMarket();
    const runs = runCarryBenchmarkComparisons(market, "test", carryBenchmarkWindows(SYNTHETIC_SPLIT));
    assert.deepEqual(runs.map((run) => run.summary.comparison), ["BASELINE", "BASELINE"]);
    const rows = carryBenchmarkRows(runs, ["2023-10", "2023-11"]);
    for (const row of rows) {
      for (const value of [row.champion, row.challenger]) assert.ok(Number.isFinite(value) && Math.abs(value) < 0.5);
      for (const value of [row.championBinding, row.challengerBinding]) assert.ok(value >= 0 && value <= 1);
    }
    const challengerRun = runs[0]!.summary.members.find((entry) => entry.key === challenger.key)!;
    const october = challengerRun.dailyEquity.filter((point) => point.day <= "2023-10-31").at(-1)!.equity;
    assert.ok(Math.abs(rows[0]!.challenger - (october / challengerRun.startingCash - 1)) < 1e-12);
  });
});
