/**
 * Candidate life cycle and the decisions between the stages of a cycle.
 *
 *   GENERATED ─┬─ INVALID            (genome refused: unknown parameter, off grid, unrealistic)
 *              ├─ DUPLICATE          (genome already tested — counts as a repeated variant)
 *              ├─ TECHNICAL_FAILED   (does not run deterministically / breaks invariants)
 *              └─ SCREENED ─┬─ REJECTED  (a screening gate failed)
 *                           ├─ RESERVE   (passed screening, not among this cycle's finalists)
 *                           └─ FINALIST ─┬─ REJECTED  (a final gate failed)
 *                                        └─ PROPOSED  → operator: APPROVED_FOR_FORWARD_TEST | REJECTED_BY_OPERATOR
 *
 * Only the operator moves a candidate out of PROPOSED. Approval records the
 * decision; it does not register a strategy, create a portfolio or touch the
 * arena (docs/trading/20-evolution-engine.md, "Freigabe").
 */

import type { GateResult } from "./gates.js";

export type CandidateStatus =
  | "GENERATED"
  | "INVALID"
  | "DUPLICATE"
  | "TECHNICAL_FAILED"
  | "REJECTED"
  | "RESERVE"
  | "PROPOSED"
  | "APPROVED_FOR_FORWARD_TEST"
  | "REJECTED_BY_OPERATOR";

export const OPERATOR_DECISIONS = Object.freeze({
  APPROVE: "APPROVED_FOR_FORWARD_TEST",
  REJECT: "REJECTED_BY_OPERATOR"
} as const);

export function failedGates(results: readonly GateResult[]): GateResult[] {
  return results.filter((result) => !result.passed);
}

/**
 * Candidates that passed screening, best research score first; ties broken
 * by key (never by luck). `maxSuccessors` (gates v2) caps how many
 * successor candidates may become finalists in one run.
 */
export function selectFinalists(
  entries: readonly { readonly key: string; readonly score: number; readonly passedScreening: boolean; readonly successor?: boolean }[],
  maxFinalists: number,
  options: { readonly maxSuccessors?: number } = {}
): string[] {
  const selected: string[] = [];
  let successors = 0;
  for (const entry of entries
    .filter((candidate) => candidate.passedScreening)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.key.localeCompare(b.key)))) {
    if (selected.length >= Math.max(0, maxFinalists)) break;
    if (entry.successor === true) {
      if (options.maxSuccessors !== undefined && successors >= options.maxSuccessors) continue;
      successors += 1;
    }
    selected.push(entry.key);
  }
  return selected;
}

export function statusAfterFinal(screening: readonly GateResult[], final: readonly GateResult[]): CandidateStatus {
  return failedGates([...screening, ...final]).length === 0 ? "PROPOSED" : "REJECTED";
}

/** Operator transitions; everything else is refused. */
export function checkOperatorDecision(from: CandidateStatus, to: CandidateStatus): { ok: true } | { ok: false; reason: string } {
  if (from !== "PROPOSED") return { ok: false, reason: `Nur vorgeschlagene Kandidaten können entschieden werden (Status ${from}).` };
  if (to !== OPERATOR_DECISIONS.APPROVE && to !== OPERATOR_DECISIONS.REJECT) return { ok: false, reason: `Unzulässige Entscheidung ${to}.` };
  return { ok: true };
}

export const STATUS_LABEL_DE: Readonly<Record<CandidateStatus, string>> = Object.freeze({
  GENERATED: "Erzeugt",
  INVALID: "Ungültig",
  DUPLICATE: "Bereits getestet",
  TECHNICAL_FAILED: "Technisch gescheitert",
  REJECTED: "Verworfen",
  RESERVE: "Reserve",
  PROPOSED: "Zur Prüfung vorgeschlagen",
  APPROVED_FOR_FORWARD_TEST: "Für Forward-Test freigegeben",
  REJECTED_BY_OPERATOR: "Vom Betreiber abgelehnt"
});
