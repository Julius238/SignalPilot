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

export interface SpanningAlphaTest extends PairedMonthlyTest {
  /** Slopes on each existing strategy, in input order (null when the regression is not identifiable). */
  readonly betas: readonly number[] | null;
}

/** Solves A·x = b by Gaussian elimination with partial pivoting; null when A is (numerically) singular. */
function solveLinear(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    const scale = Math.max(...a.map((row) => Math.abs(row[column]!)), 1e-300);
    if (Math.abs(a[pivot]![column]!) <= 1e-12 * scale) return null;
    [a[column], a[pivot]] = [a[pivot]!, a[column]!];
    for (let row = column + 1; row < n; row += 1) {
      const factor = a[row]![column]! / a[column]![column]!;
      for (let k = column; k <= n; k += 1) a[row]![k]! -= factor * a[column]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row]![n]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

function invert(matrix: readonly (readonly number[])[]): number[][] | null {
  const n = matrix.length;
  const columns: number[][] = [];
  for (let index = 0; index < n; index += 1) {
    const unit = Array.from({ length: n }, (_, k) => (k === index ? 1 : 0));
    const column = solveLinear(matrix, unit);
    if (column === null) return null;
    columns.push(column);
  }
  return Array.from({ length: n }, (_, row) => columns.map((column) => column[row]!));
}

/**
 * Does a candidate add something the existing strategies cannot already
 * deliver (gates v3, diversification path)? Its monthly returns are regressed
 * on the monthly returns of *each* existing strategy,
 *
 *   r_c = α + β₁·r₁ + … + β_K·r_K + ε,
 *
 * and the intercept α — return no combination of existing strategies explains
 * — is tested against zero. A copy of any existing strategy (or of a mix of
 * them) has α ≈ 0 however its correlation was lowered; a lower-return but
 * independent strategy can show a clearly positive α. The standard error is
 * max(iid, Newey–West sandwich) of the OLS intercept (Bartlett kernel, lag
 * ⌊4·(n/100)^(2/9)⌋), the critical value the Student-t quantile with
 * n − K − 1 degrees of freedom. "Informative" months are those in which the
 * candidate's own return is not zero.
 */
export function spanningAlphaTest(candidate: readonly DailyEquityPoint[], factors: readonly (readonly DailyEquityPoint[])[], from: string, to: string): SpanningAlphaTest {
  const factorMaps = factors.map((curve) => new Map(monthlyReturns(curve, from, to).map((entry) => [entry.month, entry.value] as const)));
  const rows = monthlyReturns(candidate, from, to)
    .filter((entry) => factorMaps.every((map) => map.has(entry.month)))
    .map((entry) => ({ y: entry.value, x: [1, ...factorMaps.map((map) => map.get(entry.month)!)] }));
  const n = rows.length;
  const p = factors.length + 1;
  const informativeMonths = rows.filter((row) => Math.abs(row.y) > 1e-12).length;
  const lag = neweyWestLag(n);
  const none = { months: n, informativeMonths, meanDifference: null, standardError: null, iidStandardError: null, hacStandardError: null, lag, tStat: null, criticalT: null, naiveTStat: null, betas: null };
  if (n - p < 3) return none;
  const xtx = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => rows.reduce((sum, row) => sum + row.x[i]! * row.x[j]!, 0)));
  const xty = Array.from({ length: p }, (_, i) => rows.reduce((sum, row) => sum + row.x[i]! * row.y, 0));
  const coefficients = solveLinear(xtx, xty);
  const inverse = invert(xtx);
  if (coefficients === null || inverse === null) return none;
  const residuals = rows.map((row) => row.y - row.x.reduce((sum, value, k) => sum + value * coefficients[k]!, 0));
  const rss = residuals.reduce((sum, value) => sum + value * value, 0);
  const tss = rows.reduce((sum, row) => sum + row.y * row.y, 0);
  const iidVariance = (rss / (n - p)) * inverse[0]![0]!;
  // Newey–West meat: Σ e_t² x_t x_tᵀ + Σ_l w_l Σ_t e_t e_{t−l} (x_t x_{t−l}ᵀ + x_{t−l} x_tᵀ).
  const effectiveLag = Math.min(lag, n - 1);
  const meat = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let t = 0; t < n; t += 1) {
    for (let i = 0; i < p; i += 1) for (let j = 0; j < p; j += 1) meat[i]![j]! += residuals[t]! ** 2 * rows[t]!.x[i]! * rows[t]!.x[j]!;
  }
  for (let l = 1; l <= effectiveLag; l += 1) {
    const weight = 1 - l / (effectiveLag + 1);
    for (let t = l; t < n; t += 1) {
      const product = residuals[t]! * residuals[t - l]!;
      for (let i = 0; i < p; i += 1) {
        for (let j = 0; j < p; j += 1) meat[i]![j]! += weight * product * (rows[t]!.x[i]! * rows[t - l]!.x[j]! + rows[t - l]!.x[i]! * rows[t]!.x[j]!);
      }
    }
  }
  let hacVariance = 0;
  for (let i = 0; i < p; i += 1) for (let j = 0; j < p; j += 1) hacVariance += inverse[0]![i]! * meat[i]![j]! * inverse[j]![0]!;
  const iidStandardError = Math.sqrt(Math.max(0, iidVariance));
  const hacStandardError = Math.sqrt(Math.max(0, hacVariance));
  const standardError = Math.max(iidStandardError, hacStandardError);
  const alpha = coefficients[0]!;
  // Nothing left to explain (an exact copy): α is not testable, never "infinitely significant".
  const explained = rss <= 1e-18 * Math.max(tss, 1e-300);
  return {
    months: n,
    informativeMonths,
    meanDifference: alpha,
    standardError,
    iidStandardError,
    hacStandardError,
    lag: effectiveLag,
    tStat: explained || standardError <= 1e-15 ? null : alpha / standardError,
    criticalT: studentT975(n - p),
    naiveTStat: explained || iidStandardError <= 1e-15 ? null : alpha / iidStandardError,
    betas: coefficients.slice(1)
  };
}
