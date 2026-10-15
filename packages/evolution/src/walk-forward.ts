/**
 * Rolling walk-forward test of the parameter choice.
 *
 * A candidate and its one-step neighbours form a small local family. For
 * every walk-forward segment k ≥ 2 the variant with the best mean R over the
 * segments before k is "selected" — using only information that existed at
 * that time — and its result in segment k is recorded out of sample. If the
 * parameter choice reflects a real effect, the selected variants keep a
 * positive edge out of sample; if it is curve-fitting, the out-of-sample
 * edge collapses relative to the in-sample one.
 */

import type { CompactTrade, FoldMetrics } from "./metrics.js";
import type { EvolutionDataSplit } from "./split.js";

export interface WalkForwardVariant {
  readonly key: string;
  readonly trades: readonly CompactTrade[];
}

export interface WalkForwardStep {
  readonly foldKey: string;
  readonly selectedVariant: string;
  readonly inSampleTrades: number;
  readonly inSampleAverageR: number;
  readonly outOfSampleTrades: number;
  readonly outOfSampleAverageR: number | null;
}

export interface WalkForwardResult {
  readonly steps: readonly WalkForwardStep[];
  readonly outOfSampleTrades: number;
  /** Trade-weighted mean R of the selected variants in their out-of-sample segments. */
  readonly outOfSampleAverageR: number | null;
  /** Trade-weighted mean in-sample R of the same selections. */
  readonly inSampleAverageR: number | null;
  /** Out-of-sample mean R / in-sample mean R; null when in-sample is not positive. */
  readonly efficiency: number | null;
  /** Share of steps that selected the candidate itself (not a neighbour). */
  readonly candidateSelectedShare: number | null;
}

const inFold = (trade: CompactTrade, from: string, to: string) => {
  const at = Date.parse(trade.anchorAt);
  return at >= Date.parse(from) && at <= Date.parse(to);
};

const rOf = (trades: readonly CompactTrade[]) => trades.map((trade) => trade.rMultiple).filter((value): value is number => value !== null);
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function rollingWalkForward(
  split: EvolutionDataSplit,
  candidateKey: string,
  variants: readonly WalkForwardVariant[],
  options: { readonly minInSampleTrades?: number } = {}
): WalkForwardResult {
  const minInSample = options.minInSampleTrades ?? 5;
  const folds = split.folds;
  const steps: WalkForwardStep[] = [];
  for (let index = 1; index < folds.length; index += 1) {
    const before = folds.slice(0, index);
    let best: { key: string; trades: number; averageR: number } | null = null;
    for (const variant of variants) {
      const inSample = rOf(variant.trades.filter((trade) => before.some((fold) => inFold(trade, fold.from, fold.to))));
      if (inSample.length < minInSample) continue;
      const averageR = sum(inSample) / inSample.length;
      // Ties keep the earlier variant — the candidate is listed first, so a tie never flatters a neighbour.
      if (best === null || averageR > best.averageR) best = { key: variant.key, trades: inSample.length, averageR };
    }
    if (best === null) continue;
    const fold = folds[index]!;
    const chosen = variants.find((variant) => variant.key === best!.key)!;
    const outOfSample = rOf(chosen.trades.filter((trade) => inFold(trade, fold.from, fold.to)));
    steps.push({
      foldKey: fold.key,
      selectedVariant: best.key,
      inSampleTrades: best.trades,
      inSampleAverageR: best.averageR,
      outOfSampleTrades: outOfSample.length,
      outOfSampleAverageR: outOfSample.length === 0 ? null : sum(outOfSample) / outOfSample.length
    });
  }
  const scored = steps.filter((step) => step.outOfSampleTrades > 0);
  const oosTrades = sum(scored.map((step) => step.outOfSampleTrades));
  const oosAverage = oosTrades === 0 ? null : sum(scored.map((step) => step.outOfSampleAverageR! * step.outOfSampleTrades)) / oosTrades;
  const isAverage = oosTrades === 0 ? null : sum(scored.map((step) => step.inSampleAverageR * step.outOfSampleTrades)) / oosTrades;
  return {
    steps,
    outOfSampleTrades: oosTrades,
    outOfSampleAverageR: oosAverage,
    inSampleAverageR: isAverage,
    efficiency: oosAverage !== null && isAverage !== null && isAverage > 0 ? oosAverage / isAverage : null,
    candidateSelectedShare: steps.length === 0 ? null : steps.filter((step) => step.selectedVariant === candidateKey).length / steps.length
  };
}

/** Convenience: fold metrics of several variants side by side (dashboard / report). */
export function foldTable(rows: readonly { readonly key: string; readonly folds: readonly FoldMetrics[] }[]): string[][] {
  if (rows.length === 0) return [];
  const header = ["Variante", ...rows[0]!.folds.map((fold) => fold.key)];
  return [
    header,
    ...rows.map((row) => [row.key, ...row.folds.map((fold) => (fold.trades === 0 ? "–" : `${fold.averageR?.toFixed(2) ?? "–"}R/${fold.trades}`))])
  ];
}
