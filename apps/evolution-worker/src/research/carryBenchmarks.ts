/**
 * Champion and challenger as benchmarks of the funding carry feasibility study
 * (step 1.4 of docs/trading/research/2026-10-16-funding-carry-feasibility-preregistration.md, §7).
 *
 * Read-only: comparison A of the gates-v4 frame (champion, challenger and the
 * reserve slot, `portfolio-replay-v1` with stage 2, 20 000 USDT per slot,
 * BTCUSDT and ETHUSDT) runs unchanged over the windows of
 * `evolution-split-v1` — discovery + validation as one run, like the
 * screening, and the holdout as a second run. Nothing is stored and nothing
 * counts as a trial: both strategies are the frozen roots, and their data is
 * already analysed.
 *
 * Output per month: the simple return of each strategy portfolio and the
 * average share of its slot bound in open positions (entry notional ÷ slot
 * cash, weighted by the hours a position was open in that month).
 */

import {
  EVOLUTION_DATA_SPLIT_V1,
  EVOLUTION_ROOTS,
  monthlyReturns,
  runPortfolioComparison,
  type DailyEquityPoint,
  type EvolutionDataSplit,
  type PortfolioMemberSummary,
  type PortfolioRunSpec,
  type PortfolioSummary
} from "@signalpilot/evolution";
import type { ReplayMarketData } from "@signalpilot/shadow-replay";

const HOUR_MS = 3_600_000;

/** Months of the study's evaluation window (§header table: 2020-01 – 2026-09, 81 months). */
export const CARRY_STUDY_MONTHS: readonly string[] = monthsBetween("2020-01", "2026-09");

export interface CarryBenchmarkWindow {
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

/** Discovery + validation as one run (as the screening runs comparison A), then the holdout. */
export function carryBenchmarkWindows(split: EvolutionDataSplit = EVOLUTION_DATA_SPLIT_V1): readonly CarryBenchmarkWindow[] {
  return [
    { key: "DISCOVERY_VALIDATION", from: split.windows.DISCOVERY.from, to: split.windows.VALIDATION.to },
    { key: "HOLDOUT", from: split.windows.HOLDOUT.from, to: split.windows.HOLDOUT.to }
  ];
}

export interface CarryBenchmarkRow {
  readonly month: string;
  readonly champion: number;
  readonly challenger: number;
  readonly championBinding: number;
  readonly challengerBinding: number;
}

export interface CarryBenchmarkRun {
  readonly window: CarryBenchmarkWindow;
  readonly summary: PortfolioSummary;
}

export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (;;) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    if (key > last) return months;
    months.push(key);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
}

function dayBefore(iso: string): string {
  return new Date(Date.parse(iso.slice(0, 10)) - 24 * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * Monthly simple returns of one strategy portfolio in one window. A point with
 * the slot's starting cash on the day before the window anchors the first
 * month, so the first day's result is not lost (`monthlyReturns` would
 * otherwise measure from the first day's close).
 */
export function memberMonthlyReturns(member: PortfolioMemberSummary, window: CarryBenchmarkWindow): Map<string, number> {
  const curve: DailyEquityPoint[] = [{ day: dayBefore(window.from), equity: member.startingCash }, ...member.dailyEquity];
  return new Map(monthlyReturns(curve, window.from, window.to).map((entry) => [entry.month, entry.value] as const));
}

/** Average share of the slot bound in open positions per month (entry notional, hour-weighted). */
export function memberMonthlyBinding(member: PortfolioMemberSummary, window: CarryBenchmarkWindow): Map<string, number> {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to) + 1;
  const bound = new Map<string, number>();
  for (const trade of member.trades) {
    const notional = trade.entryPrice * trade.quantity;
    let cursor = Math.max(Date.parse(trade.openedAt), from);
    const end = Math.min(Date.parse(trade.closedAt), to);
    while (cursor < end) {
      const date = new Date(cursor);
      const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      const stop = Math.min(end, nextMonth);
      const month = date.toISOString().slice(0, 7);
      bound.set(month, (bound.get(month) ?? 0) + (notional * (stop - cursor)) / HOUR_MS);
      cursor = stop;
    }
  }
  const result = new Map<string, number>();
  for (const month of monthsBetween(window.from.slice(0, 7), window.to.slice(0, 7))) {
    const start = Math.max(Date.parse(`${month}-01T00:00:00.000Z`), from);
    const [year, monthNumber] = month.split("-").map(Number);
    const stop = Math.min(Date.UTC(year!, monthNumber!, 1), to);
    const hours = (stop - start) / HOUR_MS;
    result.set(month, hours > 0 ? (bound.get(month) ?? 0) / (hours * member.startingCash) : 0);
  }
  return result;
}

function memberByRole(summary: PortfolioSummary, role: "CHAMPION" | "CHALLENGER"): PortfolioMemberSummary {
  const root = EVOLUTION_ROOTS.find((candidate) => candidate.role === role);
  const member = summary.members.find((candidate) => candidate.key === root?.key);
  if (root === undefined || member === undefined) throw new Error(`Comparison A has no ${role} portfolio.`);
  return member;
}

/** Rows for the study's benchmark file; refuses a month that no window covers. */
export function carryBenchmarkRows(runs: readonly CarryBenchmarkRun[], months: readonly string[] = CARRY_STUDY_MONTHS): CarryBenchmarkRow[] {
  const series = { champion: new Map<string, number>(), challenger: new Map<string, number>(), championBinding: new Map<string, number>(), challengerBinding: new Map<string, number>() };
  for (const run of runs) {
    if (run.summary.comparison !== "BASELINE") throw new Error("Only comparison A (BASELINE) feeds the carry benchmarks.");
    const champion = memberByRole(run.summary, "CHAMPION");
    const challenger = memberByRole(run.summary, "CHALLENGER");
    for (const [month, value] of memberMonthlyReturns(champion, run.window)) series.champion.set(month, value);
    for (const [month, value] of memberMonthlyReturns(challenger, run.window)) series.challenger.set(month, value);
    for (const [month, value] of memberMonthlyBinding(champion, run.window)) series.championBinding.set(month, value);
    for (const [month, value] of memberMonthlyBinding(challenger, run.window)) series.challengerBinding.set(month, value);
  }
  return months.map((month) => {
    const pick = (map: Map<string, number>) => {
      const value = map.get(month);
      if (value === undefined) throw new Error(`No benchmark value for ${month}.`);
      return value;
    };
    return { month, champion: pick(series.champion), challenger: pick(series.challenger), championBinding: pick(series.championBinding), challengerBinding: pick(series.challengerBinding) };
  });
}

/** CSV in the format the evaluation script reads (`parse_benchmarks`). */
export function carryBenchmarkCsv(rows: readonly CarryBenchmarkRow[]): string {
  const lines = ["month,champion,challenger,champion_binding,challenger_binding"];
  for (const row of rows) lines.push([row.month, row.champion, row.challenger, row.championBinding, row.challengerBinding].join(","));
  return `${lines.join("\n")}\n`;
}

/** Runs comparison A over each window with the unchanged roots and gates-v4 frame. */
export function runCarryBenchmarkComparisons(market: ReplayMarketData, codeVersion: string, windows: readonly CarryBenchmarkWindow[] = carryBenchmarkWindows()): CarryBenchmarkRun[] {
  const existing = EVOLUTION_ROOTS.map((root) => ({ key: root.key, subject: { kind: "ROOT" as const, rootKey: root.key } }));
  return windows.map((window) => {
    const spec: PortfolioRunSpec = { comparison: "BASELINE", existing, from: window.from, to: window.to, codeVersion };
    return { window, summary: runPortfolioComparison(market, spec, () => Date.now()) };
  });
}

/** Provenance written next to the CSV. */
export function carryBenchmarkMeta(runs: readonly CarryBenchmarkRun[], context: { dataFingerprint: string; cutoffAt: string; codeVersion: string }) {
  return {
    purpose: "FUNDING_CARRY_FEASIBILITY_V1 step 1.4: comparison A monthly returns of champion and challenger",
    ...context,
    roots: EVOLUTION_ROOTS.map((root) => ({ key: root.key, role: root.role, specificationHash: root.specificationHash })),
    runs: runs.map((run) => ({
      window: run.window,
      engineVersion: run.summary.engineVersion,
      groupRiskVersion: run.summary.groupRiskVersion,
      outputHash: run.summary.outputHash,
      reserveCash: run.summary.reserveCash,
      members: run.summary.members.map((member) => ({ key: member.key, strategyKey: member.strategyKey, startingCash: member.startingCash, trades: member.trades.length, outputHash: member.outputHash }))
    }))
  };
}
