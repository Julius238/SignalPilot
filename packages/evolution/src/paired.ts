/**
 * Paired comparison of a candidate with its reference strategy (gates v2,
 * successor rule).
 *
 * A successor is almost a copy of its reference (correlation > 0.9), so
 * both share most of their noise. Comparing their monthly returns month by
 * month removes that shared part: the differences are small and only a real
 * improvement survives. Three statistical traps are handled explicitly:
 *
 * - Autocorrelation: monthly differences of trend-following strategies are
 *   not independent. The standard error uses Newey–West (Bartlett kernel,
 *   lag ⌊4·(n/100)^(2/9)⌋, at least 1) and is never smaller than the iid
 *   standard error — negative autocorrelation never makes a result look
 *   more significant than an independent sample would.
 * - Small samples: the critical value is the Student-t quantile for n − 1
 *   degrees of freedom (never the normal 1.96), and too short or too
 *   uninformative series fail outright instead of being tested.
 * - A difference that is exactly zero in every month has no variance; the
 *   t-statistic is then undefined (null), never infinite.
 */

import type { DailyEquityPoint } from "./metrics.js";

export interface MonthlyReturn {
  /** YYYY-MM */
  readonly month: string;
  readonly value: number;
}

/**
 * Month-by-month simple returns of an equity curve inside [from, to]. The
 * first month is measured from the last equity before `from` (or the first
 * point of the window when there is none).
 */
export function monthlyReturns(curve: readonly DailyEquityPoint[], from: string, to: string): MonthlyReturn[] {
  const fromDay = from.slice(0, 10);
  const toDay = to.slice(0, 10);
  const sorted = [...curve].sort((a, b) => (a.day < b.day ? -1 : 1));
  const before = [...sorted].reverse().find((point) => point.day < fromDay);
  const inside = sorted.filter((point) => point.day >= fromDay && point.day <= toDay);
  if (inside.length === 0) return [];
  const monthEnd = new Map<string, number>();
  for (const point of inside) monthEnd.set(point.day.slice(0, 7), point.equity);
  const result: MonthlyReturn[] = [];
  let previous = before?.equity ?? inside[0]!.equity;
  for (const [month, equity] of [...monthEnd.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (previous > 0) result.push({ month, value: equity / previous - 1 });
    previous = equity;
  }
  return result;
}

/** Bartlett-kernel lag of Newey–West: ⌊4·(n/100)^(2/9)⌋, at least 1. */
export function neweyWestLag(n: number): number {
  return Math.max(1, Math.floor(4 * (n / 100) ** (2 / 9)));
}

export interface MeanStandardError {
  readonly n: number;
  readonly mean: number;
  /** iid standard error of the mean (sample variance, n − 1). */
  readonly iidStandardError: number;
  /** Newey–West standard error of the mean. */
  readonly hacStandardError: number;
  readonly lag: number;
  /** max(iid, HAC) — the one used for inference. */
  readonly standardError: number;
}

export function meanStandardError(values: readonly number[], lag: number = neweyWestLag(values.length)): MeanStandardError | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const centred = values.map((value) => value - mean);
  const autocovariance = (k: number) => {
    let sum = 0;
    for (let index = k; index < n; index += 1) sum += centred[index]! * centred[index - k]!;
    return sum / n;
  };
  const sampleVariance = centred.reduce((sum, value) => sum + value * value, 0) / (n - 1);
  const effectiveLag = Math.min(lag, n - 1);
  let hacVariance = autocovariance(0);
  for (let k = 1; k <= effectiveLag; k += 1) hacVariance += 2 * (1 - k / (effectiveLag + 1)) * autocovariance(k);
  const iidStandardError = Math.sqrt(sampleVariance / n);
  const hacStandardError = Math.sqrt(Math.max(0, hacVariance) / n);
  return { n, mean, iidStandardError, hacStandardError, lag: effectiveLag, standardError: Math.max(iidStandardError, hacStandardError) };
}

const Z_975 = 1.959963984540054;

/**
 * Two-sided 95 % critical value (upper 97.5 % quantile) of Student's t with
 * `df` degrees of freedom — Cornish–Fisher expansion around the normal
 * quantile, accurate to < 0.005 for df ≥ 3. Throws below 3 degrees of
 * freedom, where the expansion is not reliable and no decision should be
 * made anyway.
 */
export function studentT975(df: number): number {
  if (!Number.isFinite(df) || df < 3) throw new Error(`Student-t quantile needs at least 3 degrees of freedom, got ${df}.`);
  const z = Z_975;
  const z3 = z ** 3;
  const z5 = z ** 5;
  const z7 = z ** 7;
  const z9 = z ** 9;
  const g1 = (z3 + z) / 4;
  const g2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
  const g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
  const g4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
}

export interface PairedMonthlyTest {
  readonly months: number;
  /** Months in which the two strategies differ at all. */
  readonly informativeMonths: number;
  readonly meanDifference: number | null;
  readonly standardError: number | null;
  readonly iidStandardError: number | null;
  readonly hacStandardError: number | null;
  readonly lag: number | null;
  /** mean / max(iid, HAC) standard error; null without variance or with too few months. */
  readonly tStat: number | null;
  /** Student-t 97.5 % quantile for n − 1 degrees of freedom; null below 4 months. */
  readonly criticalT: number | null;
  /** Mean difference over its iid standard error — reported for transparency only. */
  readonly naiveTStat: number | null;
}

/** Paired test of the monthly return differences candidate − reference inside [from, to]. */
export function pairedMonthlyTest(
  candidate: readonly DailyEquityPoint[],
  reference: readonly DailyEquityPoint[],
  from: string,
  to: string
): PairedMonthlyTest {
  const own = new Map(monthlyReturns(candidate, from, to).map((entry) => [entry.month, entry.value] as const));
  const differences = monthlyReturns(reference, from, to)
    .filter((entry) => own.has(entry.month))
    .map((entry) => own.get(entry.month)! - entry.value);
  const informativeMonths = differences.filter((value) => Math.abs(value) > 1e-12).length;
  const estimate = meanStandardError(differences);
  const empty = { months: differences.length, informativeMonths, meanDifference: estimate?.mean ?? null, lag: estimate?.lag ?? null };
  if (estimate === null) {
    return { ...empty, standardError: null, iidStandardError: null, hacStandardError: null, tStat: null, criticalT: null, naiveTStat: null };
  }
  const usable = estimate.standardError > 1e-15;
  return {
    ...empty,
    standardError: estimate.standardError,
    iidStandardError: estimate.iidStandardError,
    hacStandardError: estimate.hacStandardError,
    tStat: usable ? estimate.mean / estimate.standardError : null,
    criticalT: differences.length - 1 >= 3 ? studentT975(differences.length - 1) : null,
    naiveTStat: estimate.iidStandardError > 1e-15 ? estimate.mean / estimate.iidStandardError : null
  };
}
