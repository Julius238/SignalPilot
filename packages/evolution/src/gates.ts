/**
 * Automatic acceptance gates and the research score of the Evolution Engine V1.
 *
 * Pre-registered with the data split (docs/trading/research/2026-10-15-evolution-v1-preregistration.md).
 * A candidate is proposed for review only if every gate passes; any failure
 * rejects it with a concrete, stored reason. The gates deliberately favour
 * robustness — enough trades, an edge after realistic and doubled costs, in
 * most market phases, not carried by one year, stable under small parameter
 * changes and in a rolling walk-forward — over the highest single number.
 */

import { distanceFromRoot, type CandidateGenome } from "./genome.js";
import type { FoldStability, WindowMetrics } from "./metrics.js";
import type { WalkForwardResult } from "./walk-forward.js";

export const EVOLUTION_GATES_V1 = Object.freeze({
  version: "evolution-gates-v1",
  minTradesDiscovery: 20,
  minTradesValidation: 6,
  minProfitFactorDiscovery: 1.15,
  minAverageRDiscovery: 0.05,
  minProfitFactorValidation: 1.0,
  /** Strict lower bounds (value must be greater). */
  minAverageRValidation: 0,
  minStressedNetPnl: 0,
  minDiversifierSharpe: 0,
  minNeighbourAverageR: 0,
  minOutOfSampleAverageR: 0,
  minAverageRHoldout: 0,
  maxDrawdownPct: 10,
  minPositiveFoldRatio: 0.5,
  maxFoldConcentration: 0.65,
  maxCorrelationWithExisting: 0.9,
  diversifierCorrelation: 0.5,
  minWalkForwardEfficiency: 0.25,
  minHoldoutTrades: 5,
  minHoldoutProfitFactor: 1.0,
  maxFinalists: 2,
  neighbourCount: 2
});

export type EvolutionGates = { readonly [K in keyof typeof EVOLUTION_GATES_V1]: (typeof EVOLUTION_GATES_V1)[K] extends string ? string : number };

export type GateId =
  | "TECHNICAL"
  | "DATA_INTEGRITY"
  | "MIN_TRADES"
  | "DISCOVERY_EDGE"
  | "VALIDATION_EDGE"
  | "COST_STRESS"
  | "DRAWDOWN"
  | "FOLD_STABILITY"
  | "REDUNDANCY"
  | "BENCHMARK"
  | "PARAMETER_ROBUSTNESS"
  | "WALK_FORWARD"
  | "HOLDOUT";

export type GateStage = "SCREENING" | "FINAL";

export interface GateResult {
  readonly gate: GateId;
  readonly stage: GateStage;
  readonly passed: boolean;
  readonly reasonCode: string;
  /** German, concrete, shown in the dashboard. */
  readonly message: string;
  readonly actual: string | null;
  readonly limit: string | null;
}

/** German decimal comma: the messages are shown verbatim in the German dashboard and reports. */
const fmt = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined ? "n/a" : value.toFixed(digits).replace(".", ",");
const pass = (gate: GateId, stage: GateStage, reasonCode: string, message: string, actual: string | null = null, limit: string | null = null): GateResult => ({
  gate,
  stage,
  passed: true,
  reasonCode,
  message,
  actual,
  limit
});
const fail = (gate: GateId, stage: GateStage, reasonCode: string, message: string, actual: string | null = null, limit: string | null = null): GateResult => ({
  gate,
  stage,
  passed: false,
  reasonCode,
  message,
  actual,
  limit
});

/** PF that may be unbounded (no losing trade) passes a minimum only with a positive result. */
const pfAtLeast = (metrics: WindowMetrics, minimum: number): boolean =>
  metrics.profitFactor === null ? metrics.losses === 0 && metrics.netPnl > 0 : metrics.profitFactor >= minimum;

export interface ScreeningInput {
  readonly technical: { readonly passed: boolean; readonly failures: readonly string[] };
  readonly dataIntegrity: { readonly passed: boolean; readonly failures: readonly string[] };
  readonly discovery: WindowMetrics;
  readonly validation: WindowMetrics;
  /** Discovery + validation together. */
  readonly inSample: WindowMetrics;
  readonly folds: FoldStability;
  /** Daily-return correlation with each existing strategy over the same window. */
  readonly correlations: readonly { readonly key: string; readonly value: number | null }[];
  /** Champion over the same window (discovery + validation). */
  readonly champion: WindowMetrics;
}

export function screeningGates(input: ScreeningInput, gates: EvolutionGates = EVOLUTION_GATES_V1): GateResult[] {
  const S: GateStage = "SCREENING";
  const results: GateResult[] = [];
  results.push(
    input.technical.passed
      ? pass("TECHNICAL", S, "TECHNICAL_TESTS_PASSED", "Technische Tests bestanden (deterministisch, keine Invariantenverletzung).")
      : fail("TECHNICAL", S, "TECHNICAL_TESTS_FAILED", `Technische Tests gescheitert: ${input.technical.failures.join("; ")}`)
  );
  results.push(
    input.dataIntegrity.passed
      ? pass("DATA_INTEGRITY", S, "NO_DATA_LEAK", "Nur erlaubte Zeitfenster, keine Forward-Daten, Holdout nicht in der Suche.")
      : fail("DATA_INTEGRITY", S, "DATA_LEAK_DETECTED", `Datenintegrität verletzt: ${input.dataIntegrity.failures.join("; ")}`)
  );
  const { discovery, validation, inSample } = input;
  results.push(
    discovery.trades >= gates.minTradesDiscovery && validation.trades >= gates.minTradesValidation
      ? pass("MIN_TRADES", S, "ENOUGH_TRADES", `${discovery.trades} Trades in der Entdeckung, ${validation.trades} in der Validierung.`, `${discovery.trades}/${validation.trades}`, `${gates.minTradesDiscovery}/${gates.minTradesValidation}`)
      : fail("MIN_TRADES", S, "TOO_FEW_TRADES", `Zu wenige Trades für eine Aussage: ${discovery.trades} in der Entdeckung (min. ${gates.minTradesDiscovery}), ${validation.trades} in der Validierung (min. ${gates.minTradesValidation}).`, `${discovery.trades}/${validation.trades}`, `${gates.minTradesDiscovery}/${gates.minTradesValidation}`)
  );
  const discoveryOk = discovery.averageR !== null && discovery.averageR >= gates.minAverageRDiscovery && pfAtLeast(discovery, gates.minProfitFactorDiscovery);
  results.push(
    discoveryOk
      ? pass("DISCOVERY_EDGE", S, "DISCOVERY_EDGE_AFTER_COSTS", `Entdeckung nach Kosten: Ø ${fmt(discovery.averageR)}R, PF ${fmt(discovery.profitFactor)}.`, `${fmt(discovery.averageR)}R/PF ${fmt(discovery.profitFactor)}`, `≥ ${gates.minAverageRDiscovery}R/PF ${gates.minProfitFactorDiscovery}`)
      : fail("DISCOVERY_EDGE", S, "NO_DISCOVERY_EDGE", `Kein ausreichender Vorteil nach Kosten in der Entdeckung: Ø ${fmt(discovery.averageR)}R (min. ${gates.minAverageRDiscovery}), PF ${fmt(discovery.profitFactor)} (min. ${gates.minProfitFactorDiscovery}).`, `${fmt(discovery.averageR)}R/PF ${fmt(discovery.profitFactor)}`, `≥ ${gates.minAverageRDiscovery}R/PF ${gates.minProfitFactorDiscovery}`)
  );
  const validationOk = validation.averageR !== null && validation.averageR > gates.minAverageRValidation && pfAtLeast(validation, gates.minProfitFactorValidation);
  results.push(
    validationOk
      ? pass("VALIDATION_EDGE", S, "VALIDATION_EDGE_AFTER_COSTS", `Validierung nach Kosten positiv: Ø ${fmt(validation.averageR)}R, PF ${fmt(validation.profitFactor)}.`, `${fmt(validation.averageR)}R/PF ${fmt(validation.profitFactor)}`, `> 0R/PF ${gates.minProfitFactorValidation}`)
      : fail("VALIDATION_EDGE", S, "VALIDATION_FAILED", `Hält in der Validierung nicht: Ø ${fmt(validation.averageR)}R, PF ${fmt(validation.profitFactor)} (erforderlich > 0R und PF ≥ ${gates.minProfitFactorValidation}).`, `${fmt(validation.averageR)}R/PF ${fmt(validation.profitFactor)}`, `> 0R/PF ${gates.minProfitFactorValidation}`)
  );
  results.push(
    inSample.stressed.netPnl > gates.minStressedNetPnl
      ? pass("COST_STRESS", S, "SURVIVES_COST_STRESS", `Bleibt bei ${inSample.stressed.multiplier}× Kosten positiv (${fmt(inSample.stressed.netPnl)} USDT, Ø ${fmt(inSample.stressed.averageR)}R).`, fmt(inSample.stressed.netPnl), "> 0")
      : fail("COST_STRESS", S, "FAILS_COST_STRESS", `Bei ${inSample.stressed.multiplier}× Gebühren, Spread und Slippage negativ (${fmt(inSample.stressed.netPnl)} USDT) — der Vorteil hängt an günstiger Ausführung.`, fmt(inSample.stressed.netPnl), "> 0")
  );
  results.push(
    inSample.maxDrawdownPct !== null && inSample.maxDrawdownPct <= gates.maxDrawdownPct
      ? pass("DRAWDOWN", S, "DRAWDOWN_WITHIN_LIMIT", `Maximaler Drawdown ${fmt(inSample.maxDrawdownPct)} %.`, fmt(inSample.maxDrawdownPct), `≤ ${gates.maxDrawdownPct}`)
      : fail("DRAWDOWN", S, "DRAWDOWN_TOO_DEEP", `Maximaler Drawdown ${fmt(inSample.maxDrawdownPct)} % über dem Limit von ${gates.maxDrawdownPct} %.`, fmt(inSample.maxDrawdownPct), `≤ ${gates.maxDrawdownPct}`)
  );
  const folds = input.folds;
  const foldsOk =
    folds.positiveRatio !== null &&
    folds.positiveRatio >= gates.minPositiveFoldRatio &&
    folds.concentration !== null &&
    folds.concentration <= gates.maxFoldConcentration;
  results.push(
    foldsOk
      ? pass("FOLD_STABILITY", S, "STABLE_ACROSS_PHASES", `${folds.positiveFolds} von ${folds.foldsWithTrades} Marktphasen positiv, größter Anteil einer Phase ${fmt((folds.concentration ?? 0) * 100, 0)} %.`, `${fmt(folds.positiveRatio)}/${fmt(folds.concentration)}`, `≥ ${gates.minPositiveFoldRatio}/≤ ${gates.maxFoldConcentration}`)
      : fail(
          "FOLD_STABILITY",
          S,
          folds.concentration !== null && folds.concentration > gates.maxFoldConcentration ? "CARRIED_BY_ONE_PHASE" : "UNSTABLE_ACROSS_PHASES",
          `Nicht stabil über Marktphasen: ${folds.positiveFolds} von ${folds.foldsWithTrades} Phasen positiv (min. ${Math.round(gates.minPositiveFoldRatio * 100)} %), größter Anteil einer Phase ${folds.concentration === null ? "n/a" : `${Math.round(folds.concentration * 100)} %`} (max. ${Math.round(gates.maxFoldConcentration * 100)} %).`,
          `${fmt(folds.positiveRatio)}/${fmt(folds.concentration)}`,
          `≥ ${gates.minPositiveFoldRatio}/≤ ${gates.maxFoldConcentration}`
        )
  );
  const known = input.correlations.filter((entry) => entry.value !== null) as { key: string; value: number }[];
  const highest = known.length === 0 ? null : [...known].sort((a, b) => b.value - a.value)[0]!;
  results.push(
    highest === null || highest.value <= gates.maxCorrelationWithExisting
      ? pass("REDUNDANCY", S, "NOT_REDUNDANT", highest === null ? "Korrelation nicht berechenbar (zu wenige gemeinsame Tage)." : `Höchste Korrelation ${fmt(highest.value)} mit ${highest.key}.`, highest === null ? null : fmt(highest.value), `≤ ${gates.maxCorrelationWithExisting}`)
      : fail("REDUNDANCY", S, "REDUNDANT_WITH_EXISTING", `Fast identisch mit ${highest.key} (Korrelation ${fmt(highest.value)}) — kein eigenständiger Beitrag.`, fmt(highest.value), `≤ ${gates.maxCorrelationWithExisting}`)
  );
  const candidateSharpe = inSample.sharpe;
  const championSharpe = input.champion.sharpe;
  const beatsChampion = candidateSharpe !== null && (championSharpe === null || candidateSharpe > championSharpe);
  const diversifier = candidateSharpe !== null && candidateSharpe > gates.minDiversifierSharpe && highest !== null && highest.value < gates.diversifierCorrelation;
  results.push(
    beatsChampion || diversifier
      ? pass("BENCHMARK", S, beatsChampion ? "BEATS_CHAMPION_RISK_ADJUSTED" : "DIVERSIFIES_EXISTING", beatsChampion ? `Risikobereinigt besser als der Champion (Sharpe ${fmt(candidateSharpe)} gegenüber ${fmt(championSharpe)}).` : `Schwächer als der Champion (Sharpe ${fmt(candidateSharpe)} gegenüber ${fmt(championSharpe)}), aber gering korreliert (${fmt(highest?.value)}).`, fmt(candidateSharpe), fmt(championSharpe))
      : fail("BENCHMARK", S, "NO_ADVANTAGE_OVER_CHAMPION", `Kein Vorteil gegenüber dem Champion: Sharpe ${fmt(candidateSharpe)} gegenüber ${fmt(championSharpe)}, und keine Diversifikation (Korrelation ${fmt(highest?.value)}).`, fmt(candidateSharpe), fmt(championSharpe))
  );
  return results;
}

export interface FinalInput {
  readonly neighbours: readonly { readonly key: string; readonly inSample: WindowMetrics }[];
  readonly walkForward: WalkForwardResult;
  readonly holdout: WindowMetrics;
}

export function finalGates(input: FinalInput, gates: EvolutionGates = EVOLUTION_GATES_V1): GateResult[] {
  const F: GateStage = "FINAL";
  const results: GateResult[] = [];
  const weak = input.neighbours.filter((neighbour) => neighbour.inSample.averageR === null || neighbour.inSample.averageR <= gates.minNeighbourAverageR);
  results.push(
    input.neighbours.length === 0
      ? fail("PARAMETER_ROBUSTNESS", F, "NO_NEIGHBOURS", "Keine gültigen Nachbarvarianten für die Robustheitsprüfung.")
      : weak.length === 0
        ? pass("PARAMETER_ROBUSTNESS", F, "ROBUST_TO_SMALL_CHANGES", `Alle ${input.neighbours.length} Nachbarvarianten (je ein Rasterschritt) bleiben positiv: ${input.neighbours.map((neighbour) => `Ø ${fmt(neighbour.inSample.averageR)}R`).join(", ")}.`)
        : fail("PARAMETER_ROBUSTNESS", F, "FRAGILE_OPTIMUM", `Spitzes Optimum: ${weak.length} von ${input.neighbours.length} Nachbarvarianten verlieren (${weak.map((neighbour) => `${neighbour.key}: Ø ${fmt(neighbour.inSample.averageR)}R`).join(", ")}).`)
  );
  const wf = input.walkForward;
  const wfOk =
    wf.outOfSampleAverageR !== null && wf.outOfSampleAverageR > gates.minOutOfSampleAverageR && (wf.efficiency === null || wf.efficiency >= gates.minWalkForwardEfficiency);
  results.push(
    wfOk
      ? pass("WALK_FORWARD", F, "WALK_FORWARD_HOLDS", `Rollierender Walk-Forward: außerhalb der Stichprobe Ø ${fmt(wf.outOfSampleAverageR)}R über ${wf.outOfSampleTrades} Trades, Effizienz ${fmt(wf.efficiency)}.`, fmt(wf.efficiency), `≥ ${gates.minWalkForwardEfficiency}`)
      : fail("WALK_FORWARD", F, "WALK_FORWARD_COLLAPSES", `Walk-Forward bricht ein: außerhalb der Stichprobe Ø ${fmt(wf.outOfSampleAverageR)}R, Effizienz ${fmt(wf.efficiency)} (min. ${gates.minWalkForwardEfficiency}).`, fmt(wf.efficiency), `≥ ${gates.minWalkForwardEfficiency}`)
  );
  const holdout = input.holdout;
  const holdoutOk =
    holdout.trades >= gates.minHoldoutTrades && holdout.averageR !== null && holdout.averageR > gates.minAverageRHoldout && pfAtLeast(holdout, gates.minHoldoutProfitFactor);
  results.push(
    holdoutOk
      ? pass("HOLDOUT", F, "HOLDOUT_POSITIVE", `Holdout 2024–2026 (bereits analysiert, kein unberührter Beweis): ${holdout.trades} Trades, Ø ${fmt(holdout.averageR)}R, PF ${fmt(holdout.profitFactor)}.`, `${fmt(holdout.averageR)}R/${holdout.trades}`, `> 0R/≥ ${gates.minHoldoutTrades}`)
      : fail("HOLDOUT", F, "HOLDOUT_FAILED", `Hält im Holdout 2024–2026 nicht: ${holdout.trades} Trades, Ø ${fmt(holdout.averageR)}R, PF ${fmt(holdout.profitFactor)}.`, `${fmt(holdout.averageR)}R/${holdout.trades}`, `> 0R/≥ ${gates.minHoldoutTrades}`)
  );
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Research score and evidence grade
// ───────────────────────────────────────────────────────────────────────────

export interface ScoreComponent {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  /** Normalised contribution in −1 … +1. */
  readonly value: number;
}

export interface ResearchScore {
  readonly version: string;
  /** 0–100 around a neutral 50; historical research only, never a forward fitness. */
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  readonly complexityPenalty: number;
}

const clamp = (value: number, low = -1, high = 1) => Math.max(low, Math.min(high, value));

export function researchScore(input: {
  readonly discovery: WindowMetrics;
  readonly validation: WindowMetrics;
  readonly inSample: WindowMetrics;
  readonly folds: FoldStability;
  readonly maxCorrelation: number | null;
  readonly genome: CandidateGenome;
}): ResearchScore {
  const { discovery, validation, inSample } = input;
  const components: ScoreComponent[] = [
    { key: "validationR", label: "Ø R Validierung", weight: 20, value: clamp((validation.averageR ?? -0.5) / 0.5) },
    { key: "discoveryR", label: "Ø R Entdeckung", weight: 10, value: clamp((discovery.averageR ?? -0.5) / 0.5) },
    { key: "sharpe", label: "Sharpe (Entdeckung + Validierung)", weight: 20, value: clamp((inSample.sharpe ?? -1.5) / 1.5) },
    { key: "costStress", label: "Ø R bei doppelten Kosten", weight: 15, value: clamp((inSample.stressed.averageR ?? -0.3) / 0.3) },
    { key: "folds", label: "Anteil positiver Marktphasen", weight: 15, value: clamp(((input.folds.positiveRatio ?? 0) - 0.5) * 2) },
    { key: "drawdown", label: "Drawdown", weight: 10, value: clamp(1 - ((inSample.maxDrawdownPct ?? 20) / 10) * 2) },
    { key: "trades", label: "Stichprobengröße", weight: 5, value: clamp(inSample.trades / 60 - 0.5) },
    { key: "diversification", label: "Diversifikation", weight: 5, value: clamp(1 - 2 * Math.max(0, input.maxCorrelation ?? 0)) }
  ];
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, component) => sum + component.weight * component.value, 0) / totalWeight;
  // Occam: every parameter beyond two that differs from the frozen root costs two points.
  const complexityPenalty = Math.max(0, distanceFromRoot(input.genome) - 2) * 2;
  const score = Math.max(0, Math.min(100, 50 + 50 * weighted - complexityPenalty));
  return { version: "evolution-score-v1", score: Math.round(score * 100) / 100, components, complexityPenalty };
}

export type EvidenceGrade = "STRONG" | "MODERATE" | "WEAK" | "NONE";

/**
 * Evidence after multiple testing. Under the null hypothesis the best of N
 * tried configurations still shows a t-statistic around √(2·ln N) by luck
 * alone; only what clears that bar is more than selection noise.
 */
export function evidenceGrade(tStat: number | null, trials: number): { grade: EvidenceGrade; threshold: number; trials: number } {
  const threshold = trials < 2 ? 1 : Math.sqrt(2 * Math.log(trials));
  const rounded = Math.round(threshold * 100) / 100;
  if (tStat === null) return { grade: "NONE", threshold: rounded, trials };
  if (tStat >= threshold + 1) return { grade: "STRONG", threshold: rounded, trials };
  if (tStat >= threshold) return { grade: "MODERATE", threshold: rounded, trials };
  if (tStat >= 1) return { grade: "WEAK", threshold: rounded, trials };
  return { grade: "NONE", threshold: rounded, trials };
}
