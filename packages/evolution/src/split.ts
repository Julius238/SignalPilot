/**
 * Pre-registered data split of the Evolution Engine V1.
 *
 * Fixed in code (and in docs/trading/research/2026-10-15-evolution-v1-preregistration.md)
 * before the first evolution experiment. Changing a window is a new split
 * version with its own key and hash; results under different splits are never
 * compared as if they were the same experiment.
 *
 * Why the windows look like this:
 * - The 2026-10-14 real-data research already used 2018-03 → 2023-12 as its
 *   TRAINING period (about 30 variant × regime configurations) and evaluated
 *   2024-01 → 2026-10-14 as its one-time TEST period. Nothing before
 *   2026-10-15 is therefore untouched. The holdout below is labelled
 *   `PREVIOUSLY_ANALYZED` and is never presented as a pristine
 *   out-of-sample proof.
 * - The only data no one has seen yet starts with the official forward test
 *   on 2026-10-15. The Evolution Engine never replays it: every backtest ends
 *   before `forwardFrom`, and the snapshot loader drops later candles. Forward
 *   evidence comes exclusively from shadow forward tests and the arena.
 * - Discovery is what the search may look at (the AI sees its metrics),
 *   validation selects (the AI sees only the verdict), the holdout confirms
 *   (the AI never sees it, and every access is counted).
 */

import { canonicalHash } from "@signalpilot/trading-domain";

export type EvolutionWindowKey = "DISCOVERY" | "VALIDATION" | "HOLDOUT";

/** What the AI provider may learn about a window. */
export type AiVisibility = "METRICS" | "VERDICT_ONLY" | "NEVER";

export interface EvolutionWindow {
  readonly key: EvolutionWindowKey;
  readonly label: string;
  /** Inclusive anchor close window (ISO, UTC). */
  readonly from: string;
  readonly to: string;
  readonly role: "SEARCH" | "SELECTION" | "CONFIRMATION";
  readonly aiVisibility: AiVisibility;
  /** `PREVIOUSLY_ANALYZED`: humans looked at this period before; it is not a clean out-of-sample test. */
  readonly integrity: "IN_SAMPLE" | "PREVIOUSLY_ANALYZED";
}

export interface EvolutionFold {
  readonly key: string;
  readonly window: Exclude<EvolutionWindowKey, "HOLDOUT">;
  readonly from: string;
  readonly to: string;
}

/** Earlier human research on the same history; it counts as exposure of these periods. */
export interface PriorExposure {
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly role: "TRAINING" | "TEST";
  readonly configurationsTried: number;
  readonly note: string;
}

export interface EvolutionDataSplit {
  readonly key: string;
  readonly preregisteredOn: string;
  readonly symbols: readonly string[];
  readonly windows: Readonly<Record<EvolutionWindowKey, EvolutionWindow>>;
  /** First instant the Evolution Engine may never replay: the official forward test. */
  readonly forwardFrom: string;
  readonly folds: readonly EvolutionFold[];
  readonly priorExposure: readonly PriorExposure[];
}

export const EVOLUTION_DATA_SPLIT_V1: EvolutionDataSplit = Object.freeze({
  key: "evolution-split-v1",
  preregisteredOn: "2026-10-15",
  symbols: Object.freeze(["BTCUSDT", "ETHUSDT"]),
  windows: Object.freeze({
    DISCOVERY: Object.freeze({
      key: "DISCOVERY",
      label: "Entdeckung",
      from: "2018-04-01T00:00:00.000Z",
      to: "2022-06-30T23:59:59.999Z",
      role: "SEARCH",
      aiVisibility: "METRICS",
      integrity: "IN_SAMPLE"
    }),
    VALIDATION: Object.freeze({
      key: "VALIDATION",
      label: "Validierung",
      from: "2022-07-01T00:00:00.000Z",
      to: "2023-12-31T23:59:59.999Z",
      role: "SELECTION",
      aiVisibility: "VERDICT_ONLY",
      integrity: "IN_SAMPLE"
    }),
    HOLDOUT: Object.freeze({
      key: "HOLDOUT",
      label: "Holdout (bereits analysiert)",
      from: "2024-01-01T00:00:00.000Z",
      to: "2026-10-14T23:59:59.999Z",
      role: "CONFIRMATION",
      aiVisibility: "NEVER",
      integrity: "PREVIOUSLY_ANALYZED"
    })
  }),
  forwardFrom: "2026-10-15T00:00:00.000Z",
  // Walk-forward segments: calendar years (the first and last discovery
  // segment are partial). Every segment is a separate market phase sample.
  folds: Object.freeze([
    { key: "2018", window: "DISCOVERY", from: "2018-04-01T00:00:00.000Z", to: "2018-12-31T23:59:59.999Z" },
    { key: "2019", window: "DISCOVERY", from: "2019-01-01T00:00:00.000Z", to: "2019-12-31T23:59:59.999Z" },
    { key: "2020", window: "DISCOVERY", from: "2020-01-01T00:00:00.000Z", to: "2020-12-31T23:59:59.999Z" },
    { key: "2021", window: "DISCOVERY", from: "2021-01-01T00:00:00.000Z", to: "2021-12-31T23:59:59.999Z" },
    { key: "2022H1", window: "DISCOVERY", from: "2022-01-01T00:00:00.000Z", to: "2022-06-30T23:59:59.999Z" },
    { key: "2022H2", window: "VALIDATION", from: "2022-07-01T00:00:00.000Z", to: "2022-12-31T23:59:59.999Z" },
    { key: "2023", window: "VALIDATION", from: "2023-01-01T00:00:00.000Z", to: "2023-12-31T23:59:59.999Z" }
  ] as const),
  priorExposure: Object.freeze([
    {
      source: "real-data-research-2026-10-14",
      from: "2018-03-01T00:00:00.000Z",
      to: "2023-12-31T23:59:59.999Z",
      role: "TRAINING",
      configurationsTried: 30,
      note: "Trainingsmatrix 10 Varianten × 3 Regime-Policies, Bedingungs- und Regime-Studie (docs/trading/research/2026-10-14-training-results.md)."
    },
    {
      source: "real-data-research-2026-10-14",
      from: "2024-01-01T00:00:00.000Z",
      to: "2026-10-14T23:59:59.999Z",
      role: "TEST",
      configurationsTried: 3,
      note: "Einmaliger Test von K1/K2 und Regime-Studie; Grundlage des Challengers CRYPTO_REGIME_LONG_V1 (docs/trading/research/2026-10-14-real-data-results.md)."
    }
  ] as const)
});

export const EVOLUTION_DATA_SPLIT_V1_HASH = canonicalHash(EVOLUTION_DATA_SPLIT_V1);

const ms = (iso: string): number => Date.parse(iso);

/** The window an anchor time belongs to, or null (warm-up, gaps, forward period). */
export function windowOfAnchor(split: EvolutionDataSplit, anchorAt: string): EvolutionWindowKey | null {
  const at = ms(anchorAt);
  for (const window of Object.values(split.windows)) {
    if (at >= ms(window.from) && at <= ms(window.to)) return window.key;
  }
  return null;
}

/** Walk-forward segment of an anchor time, or null. */
export function foldOfAnchor(split: EvolutionDataSplit, anchorAt: string): EvolutionFold | null {
  const at = ms(anchorAt);
  return split.folds.find((fold) => at >= ms(fold.from) && at <= ms(fold.to)) ?? null;
}

/**
 * Structural integrity of a split: windows ordered and disjoint, folds inside
 * their window and covering it, everything before the forward start. Returns
 * the violations; an empty list means the split is usable.
 */
export function validateDataSplit(split: EvolutionDataSplit): string[] {
  const problems: string[] = [];
  const order: EvolutionWindowKey[] = ["DISCOVERY", "VALIDATION", "HOLDOUT"];
  for (let index = 0; index < order.length; index += 1) {
    const window = split.windows[order[index]!];
    if (!(ms(window.from) < ms(window.to))) problems.push(`${window.key}: from must be before to`);
    const next = split.windows[order[index + 1] as EvolutionWindowKey];
    if (next !== undefined && !(ms(window.to) < ms(next.from))) problems.push(`${window.key} overlaps ${next.key}`);
  }
  if (!(ms(split.windows.HOLDOUT.to) < ms(split.forwardFrom))) problems.push("HOLDOUT reaches into the forward period");
  if (split.windows.HOLDOUT.aiVisibility !== "NEVER") problems.push("HOLDOUT must never be visible to the AI");
  for (const key of ["DISCOVERY", "VALIDATION"] as const) {
    const window = split.windows[key];
    const folds = split.folds.filter((fold) => fold.window === key);
    if (folds.length === 0) problems.push(`${key}: no walk-forward fold`);
    for (const fold of folds) {
      if (ms(fold.from) < ms(window.from) || ms(fold.to) > ms(window.to)) problems.push(`fold ${fold.key} outside ${key}`);
    }
    const sorted = [...folds].sort((a, b) => ms(a.from) - ms(b.from));
    if (sorted.length > 0 && (sorted[0]!.from !== window.from || sorted.at(-1)!.to !== window.to)) {
      problems.push(`${key}: folds do not cover the window`);
    }
    for (let index = 1; index < sorted.length; index += 1) {
      if (ms(sorted[index]!.from) !== ms(sorted[index - 1]!.to) + 1) problems.push(`${key}: gap or overlap before fold ${sorted[index]!.key}`);
    }
  }
  return problems;
}

/** Last instant a research replay may use, whatever the snapshot contains. */
export function researchDataEndMs(split: EvolutionDataSplit): number {
  return ms(split.forwardFrom) - 1;
}
