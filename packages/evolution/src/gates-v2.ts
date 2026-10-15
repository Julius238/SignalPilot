/**
 * Gates v2: v1 plus the successor rule (docs/trading/research/2026-10-15-evolution-gates-v2-preregistration.md).
 *
 * v1 rejects every candidate whose daily returns correlate above 0.9 with an
 * existing strategy. v2 keeps that for copies of a *foreign* strategy, but
 * routes a near-copy of the candidate's *own* frozen root into a successor
 * check: it may stay close to its root only if it beats it clearly, in both
 * windows, significantly in a paired test, without getting worse anywhere,
 * and within a monthly limit of attempts per root. v1 stays untouched and
 * selectable; every decision records the gate version that made it.
 */

import { canonicalHash } from "@signalpilot/trading-domain";

import { EVOLUTION_GATES_V1, type EvolutionGates, type GateResult } from "./gates.js";
import type { WindowMetrics } from "./metrics.js";
import type { PairedMonthlyTest } from "./paired.js";

export interface SuccessorPolicy {
  /** A candidate is a near-copy above this daily-return correlation (same bound as v1's redundancy gate). */
  readonly correlationTrigger: number;
  /** Absolute Sharpe improvement over the reference (discovery + validation). */
  readonly minSharpeDelta: number;
  /** Relative Sharpe improvement, applied only when the reference Sharpe is at least `relativeReferenceFloor`. */
  readonly minRelativeSharpeGain: number;
  readonly relativeReferenceFloor: number;
  /** Below that floor (weak, zero or negative reference) the candidate's own Sharpe must reach this instead. */
  readonly minCandidateSharpe: number;
  /** Lower bound of the paired t-threshold; the effective bound is max(this, √(2·ln N), t(0.975, n − 1)). */
  readonly minPairedT: number;
  readonly minMonths: number;
  readonly minInformativeMonths: number;
  readonly maxValidationAverageRDrop: number;
  readonly maxDrawdownRatio: number;
  readonly maxStressedAverageRDrop: number;
  readonly minTradeRatio: number;
  /** Holdout (previously analysed): only a guard against getting worse, never evidence. */
  readonly minHoldoutSharpeDelta: number;
  readonly maxScreeningsPerRootPerMonth: number;
  readonly maxFinalistsPerRun: number;
}

export type EvolutionGatesV2 = EvolutionGates & { readonly successor: SuccessorPolicy };

export const EVOLUTION_GATES_V2: EvolutionGatesV2 = Object.freeze({
  ...EVOLUTION_GATES_V1,
  version: "evolution-gates-v2",
  successor: Object.freeze({
    correlationTrigger: 0.9,
    minSharpeDelta: 0.15,
    minRelativeSharpeGain: 0.1,
    relativeReferenceFloor: 0.5,
    minCandidateSharpe: 0.5,
    minPairedT: 2,
    minMonths: 36,
    minInformativeMonths: 24,
    maxValidationAverageRDrop: 0.05,
    maxDrawdownRatio: 1.1,
    maxStressedAverageRDrop: 0.05,
    minTradeRatio: 0.8,
    minHoldoutSharpeDelta: -0.1,
    maxScreeningsPerRootPerMonth: 8,
    maxFinalistsPerRun: 1
  })
});

/** Frozen fingerprints; the tests and the pre-registrations pin them. */
export const EVOLUTION_GATES_V1_HASH = canonicalHash(EVOLUTION_GATES_V1);
export const EVOLUTION_GATES_V2_HASH = canonicalHash(EVOLUTION_GATES_V2);

export function isGatesV2(gates: EvolutionGates): gates is EvolutionGatesV2 {
  return "successor" in gates && (gates as Partial<EvolutionGatesV2>).successor !== undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Routing
// ───────────────────────────────────────────────────────────────────────────

export interface SuccessorRoute {
  readonly routed: boolean;
  readonly rootKey: string;
  readonly correlation: number | null;
  /** Foreign strategies the candidate also nearly copies — any one keeps it redundant. */
  readonly foreignNearCopies: readonly string[];
}

/**
 * A candidate goes the successor way only if its own root is the *only*
 * existing strategy it nearly copies. A near-copy of a foreign strategy is
 * no refinement of anything the candidate descends from and stays redundant.
 */
export function successorRoute(input: {
  readonly rootKey: string;
  readonly correlations: readonly { readonly key: string; readonly value: number | null }[];
  readonly policy: SuccessorPolicy;
}): SuccessorRoute {
  const near = input.correlations.filter((entry) => entry.value !== null && entry.value > input.policy.correlationTrigger);
  const own = near.find((entry) => entry.key === input.rootKey) ?? null;
  const foreign = near.filter((entry) => entry.key !== input.rootKey).map((entry) => entry.key);
  return { routed: own !== null && foreign.length === 0, rootKey: input.rootKey, correlation: own?.value ?? null, foreignNearCopies: foreign };
}

// ───────────────────────────────────────────────────────────────────────────
// Successor gates
// ───────────────────────────────────────────────────────────────────────────

const de = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits).replace(".", ",");

const result = (gate: GateResult["gate"], stage: GateResult["stage"], passed: boolean, reasonCode: string, message: string, actual: string | null = null, limit: string | null = null): GateResult => ({
  gate,
  stage,
  passed,
  reasonCode,
  message,
  actual,
  limit
});

export interface SuccessorWindows {
  readonly discovery: WindowMetrics;
  readonly validation: WindowMetrics;
  readonly inSample: WindowMetrics;
}

export interface SuccessorScreeningInput {
  readonly rootKey: string;
  readonly correlation: number;
  readonly candidate: SuccessorWindows;
  readonly reference: SuccessorWindows;
  readonly paired: PairedMonthlyTest;
  /** Same counter as the evidence grade: prior research + every configuration evaluated so far, never reset. */
  readonly trials: number;
  /** Successor screenings of this root in the current calendar month, this one included. */
  readonly screeningsThisMonth: number;
}

/** Effective paired t-threshold: max(minimum, √(2·ln N), Student-t quantile for n − 1 degrees of freedom). */
export function successorTThreshold(policy: SuccessorPolicy, trials: number, criticalT: number | null): number {
  const multipleTesting = trials >= 2 ? Math.sqrt(2 * Math.log(trials)) : 0;
  return Math.max(policy.minPairedT, multipleTesting, criticalT ?? Number.POSITIVE_INFINITY);
}

export function successorScreeningGates(input: SuccessorScreeningInput, policy: SuccessorPolicy): GateResult[] {
  const S = "SCREENING" as const;
  const gates: GateResult[] = [];
  const root = input.rootKey.replace(/^ROOT:/, "");

  gates.push(
    input.screeningsThisMonth <= policy.maxScreeningsPerRootPerMonth
      ? result("SUCCESSOR_BUDGET", S, true, "WITHIN_MONTHLY_SUCCESSOR_LIMIT", `Nachfolger-Prüfung ${input.screeningsThisMonth} von höchstens ${policy.maxScreeningsPerRootPerMonth} für ${root} in diesem Monat.`, String(input.screeningsThisMonth), String(policy.maxScreeningsPerRootPerMonth))
      : result("SUCCESSOR_BUDGET", S, false, "SUCCESSOR_MONTHLY_LIMIT_REACHED", `Monatslimit von ${policy.maxScreeningsPerRootPerMonth} Nachfolger-Prüfungen für ${root} erreicht — die Validierungsdaten werden nicht weiter für Verfeinerungen dieser Wurzel abgenutzt.`, String(input.screeningsThisMonth), String(policy.maxScreeningsPerRootPerMonth))
  );

  const candidateSharpe = input.candidate.inSample.sharpe;
  const referenceSharpe = input.reference.inSample.sharpe;
  if (candidateSharpe === null || referenceSharpe === null) {
    gates.push(result("SUCCESSOR_IMPROVEMENT", S, false, "SHARPE_NOT_COMPUTABLE", `Sharpe nicht berechenbar (Kandidat ${de(candidateSharpe)}, ${root} ${de(referenceSharpe)}); ohne Vergleich kein Nachfolger.`));
  } else {
    const delta = candidateSharpe - referenceSharpe;
    const strongReference = referenceSharpe >= policy.relativeReferenceFloor;
    const passed = strongReference
      ? delta >= policy.minSharpeDelta && candidateSharpe >= referenceSharpe * (1 + policy.minRelativeSharpeGain)
      : delta >= policy.minSharpeDelta && candidateSharpe >= policy.minCandidateSharpe;
    const rule = strongReference
      ? `ΔSharpe ≥ ${de(policy.minSharpeDelta)} und ≥ ${Math.round(policy.minRelativeSharpeGain * 100)} % über ${root}`
      : `ΔSharpe ≥ ${de(policy.minSharpeDelta)} und eigene Sharpe ≥ ${de(policy.minCandidateSharpe)} (Referenz-Sharpe ${de(referenceSharpe)} unter ${de(policy.relativeReferenceFloor)}: eine relative Verbesserung ist dort nicht aussagekräftig)`;
    gates.push(
      result(
        "SUCCESSOR_IMPROVEMENT",
        S,
        passed,
        passed ? "CLEAR_RISK_ADJUSTED_IMPROVEMENT" : "NOT_A_CLEAR_IMPROVEMENT",
        passed
          ? `Sharpe ${de(candidateSharpe)} gegenüber ${de(referenceSharpe)} bei ${root} (Δ ${de(delta)}); erfüllt ${rule}.`
          : `Keine deutliche Verbesserung gegenüber ${root}: Sharpe ${de(candidateSharpe)} gegenüber ${de(referenceSharpe)} (Δ ${de(delta)}); verlangt ${rule}.`,
        de(delta),
        de(policy.minSharpeDelta)
      )
    );
  }

  const deltaOf = (key: "discovery" | "validation") => {
    const own = input.candidate[key].sharpe;
    const ref = input.reference[key].sharpe;
    return own === null || ref === null ? null : own - ref;
  };
  const discoveryDelta = deltaOf("discovery");
  const validationDelta = deltaOf("validation");
  const consistent = discoveryDelta !== null && validationDelta !== null && discoveryDelta > 0 && validationDelta > 0;
  gates.push(
    result(
      "SUCCESSOR_CONSISTENCY",
      S,
      consistent,
      consistent ? "IMPROVES_IN_BOTH_WINDOWS" : "IMPROVEMENT_NOT_IN_BOTH_WINDOWS",
      consistent
        ? `Besser als ${root} in Entdeckung (ΔSharpe ${de(discoveryDelta)}) und Validierung (ΔSharpe ${de(validationDelta)}).`
        : `Nicht in beiden Zeiträumen besser als ${root}: ΔSharpe Entdeckung ${de(discoveryDelta)}, Validierung ${de(validationDelta)}.`,
      `${de(discoveryDelta)}/${de(validationDelta)}`,
      "> 0/> 0"
    )
  );

  const paired = input.paired;
  const threshold = successorTThreshold(policy, input.trials, paired.criticalT);
  if (paired.months < policy.minMonths || paired.informativeMonths < policy.minInformativeMonths || paired.criticalT === null) {
    gates.push(
      result(
        "SUCCESSOR_SIGNIFICANCE",
        S,
        false,
        "INSUFFICIENT_PAIRED_SAMPLE",
        `Zu kurze gepaarte Stichprobe: ${paired.months} Monate, davon ${paired.informativeMonths} mit Unterschied (verlangt ≥ ${policy.minMonths} und ≥ ${policy.minInformativeMonths}).`,
        `${paired.months}/${paired.informativeMonths}`,
        `${policy.minMonths}/${policy.minInformativeMonths}`
      )
    );
  } else if (paired.tStat === null) {
    gates.push(result("SUCCESSOR_SIGNIFICANCE", S, false, "PAIRED_DIFFERENCE_UNDEFINED", `Keine messbare Streuung der Monatsdifferenzen zu ${root}; ein Unterschied lässt sich nicht nachweisen.`));
  } else {
    const passed = paired.tStat >= threshold;
    gates.push(
      result(
        "SUCCESSOR_SIGNIFICANCE",
        S,
        passed,
        passed ? "PAIRED_IMPROVEMENT_SIGNIFICANT" : "PAIRED_IMPROVEMENT_NOT_SIGNIFICANT",
        `Gepaarter Monatsvergleich mit ${root}: t = ${de(paired.tStat)} (Newey–West, Lag ${paired.lag}; ohne Autokorrelations-Korrektur ${de(paired.naiveTStat)}) über ${paired.months} Monate; Schwelle ${de(threshold)} = max(${de(policy.minPairedT)}; √(2·ln ${input.trials}); t₀,₉₇₅ mit ${paired.months - 1} FG).`,
        de(paired.tStat),
        de(threshold)
      )
    );
  }

  const problems: string[] = [];
  const own = input.candidate;
  const ref = input.reference;
  if (own.validation.averageR === null || ref.validation.averageR === null || own.validation.averageR < ref.validation.averageR - policy.maxValidationAverageRDrop) {
    problems.push(`Ø R Validierung ${de(own.validation.averageR)} gegenüber ${de(ref.validation.averageR)} (höchstens ${de(policy.maxValidationAverageRDrop)} R schlechter)`);
  }
  const ownDrawdown = own.inSample.maxDrawdownPct;
  const refDrawdown = ref.inSample.maxDrawdownPct;
  if (ownDrawdown === null || refDrawdown === null || (refDrawdown > 0 ? ownDrawdown > refDrawdown * policy.maxDrawdownRatio : ownDrawdown > 0)) {
    problems.push(`max. Drawdown ${de(ownDrawdown)} % gegenüber ${de(refDrawdown)} % (höchstens ${de(policy.maxDrawdownRatio)}-fach)`);
  }
  if (own.inSample.stressed.averageR === null || ref.inSample.stressed.averageR === null || own.inSample.stressed.averageR < ref.inSample.stressed.averageR - policy.maxStressedAverageRDrop) {
    problems.push(`Ø R bei doppelten Kosten ${de(own.inSample.stressed.averageR)} gegenüber ${de(ref.inSample.stressed.averageR)}`);
  }
  if (own.inSample.trades < ref.inSample.trades * policy.minTradeRatio) {
    problems.push(`${own.inSample.trades} Trades gegenüber ${ref.inSample.trades} (mindestens ${Math.round(policy.minTradeRatio * 100)} %)`);
  }
  gates.push(
    result(
      "SUCCESSOR_NO_DETERIORATION",
      S,
      problems.length === 0,
      problems.length === 0 ? "NO_DETERIORATION" : "DETERIORATES_AGAINST_REFERENCE",
      problems.length === 0 ? `In keiner Schutzgröße schlechter als ${root} (Validierung, Drawdown, Kostenstress, Stichprobe).` : `Schlechter als ${root}: ${problems.join("; ")}.`
    )
  );
  return gates;
}

/**
 * Holdout guard of a successor finalist. The holdout was analysed before
 * (and inspired the challenger), so it is never evidence for a successor —
 * it may only stop one that is clearly worse there.
 */
export function successorHoldoutGate(input: { readonly rootKey: string; readonly candidate: WindowMetrics | null; readonly reference: WindowMetrics | null }, policy: SuccessorPolicy): GateResult {
  const root = input.rootKey.replace(/^ROOT:/, "");
  const own = input.candidate?.sharpe ?? null;
  const ref = input.reference?.sharpe ?? null;
  const delta = own === null || ref === null ? null : own - ref;
  const passed = delta !== null && delta >= policy.minHoldoutSharpeDelta;
  return result(
    "SUCCESSOR_HOLDOUT_GUARD",
    "FINAL",
    passed,
    passed ? "NOT_WORSE_ON_HOLDOUT" : "WORSE_THAN_REFERENCE_ON_HOLDOUT",
    passed
      ? `Im bereits analysierten Holdout nicht schlechter als ${root} (ΔSharpe ${de(delta)}); zählt ausdrücklich nicht als Nachweis.`
      : `Im bereits analysierten Holdout schlechter als ${root} (ΔSharpe ${de(delta)}, Untergrenze ${de(policy.minHoldoutSharpeDelta)}).`,
    de(delta),
    de(policy.minHoldoutSharpeDelta)
  );
}

/**
 * The redundancy gate of a routed candidate is replaced by this pass, so
 * the decision rests on the successor gates. Only used when `successorRoute`
 * routed the candidate.
 */
export function routedRedundancyGate(route: SuccessorRoute): GateResult {
  const root = route.rootKey.replace(/^ROOT:/, "");
  return result(
    "REDUNDANCY",
    "SCREENING",
    true,
    "ROUTED_TO_SUCCESSOR_CHECK",
    `Fast-Kopie der eigenen Wurzel ${root} (Korrelation ${de(route.correlation)}) — wird nach der Nachfolger-Regel geprüft und muss ${root} nachweisbar übertreffen.`,
    de(route.correlation),
    "Nachfolger-Regel"
  );
}
