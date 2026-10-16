/**
 * Evolution gates v4 — the portfolio decision for independent strategy
 * families (pre-registered in docs/trading/research/2026-10-16-evolution-gates-v4-preregistration.md,
 * decision: docs/trading/decisions/0019-evolution-gates-v4-portfolio-value.md).
 *
 * v4 is v3 with identical thresholds and methods for every existing family
 * (BREAKOUT_LONG, REGIME_LONG): it carries v3's `lineage` policy unchanged and
 * adds a separate `independentFamily` policy. Only a candidate of a family
 * declared independent (own entry evaluator, entry parameters only, frozen
 * exits, own pre-registration) is decided by the portfolio path:
 *
 *   Does the additional strategy improve the existing portfolio — at identical
 *   total capital, with realistic costs and unchanged risk rules — and is the
 *   improvement its own, statistically robust return?
 *
 * The inputs come from two chronological portfolio replays (comparison A:
 * existing strategies plus a cash reserve slot; comparison B: the candidate on
 * that slot), never from adding up separate backtests. Gates v1–v3 and their
 * hashes stay untouched; v4 brings its own gate identifiers instead of
 * extending v1's.
 */

import { GROUP_RISK_RULE_CODES, GROUP_RISK_VERSION, PORTFOLIO_REPLAY_ENGINE_VERSION } from "@signalpilot/shadow-replay";
import { canonicalHash } from "@signalpilot/trading-domain";

import type { EvolutionGates, GateResult, GateStage } from "./gates.js";
import { EVOLUTION_GATES_V3, lineageTThreshold, type EvolutionGatesV3 } from "./gates-v3.js";
import type { PortfolioAssessment, PortfolioWindowComparison } from "./portfolio-metrics.js";
import { PORTFOLIO_SLOT_CASH } from "./portfolio.js";
import { EVOLUTION_DATA_SPLIT_V1 } from "./split.js";

export interface IndependentFamilyPolicy {
  /** Method identifiers: changing how a number is computed needs a new gate version. */
  readonly methods: Readonly<Record<string, string>>;
  /** The simulation every decision rests on. */
  readonly simulation: {
    readonly engineVersion: string;
    readonly groupRiskVersion: string;
    readonly groupRules: readonly string[];
    readonly slotCash: number;
    readonly reserveSlotsInBaseline: number;
    readonly symbols: readonly string[];
    readonly regimePolicy: string;
    readonly killSwitchReviewHours: number;
    readonly memberOrder: string;
  };
  readonly thresholds: {
    /** Strictly greater than these, in the in-sample window and in each of the two windows. */
    readonly minNetReturnDelta: number;
    readonly minSharpeDelta: number;
    /** Portfolio drawdown with the candidate, in % of the total capital, over discovery + validation. */
    readonly maxPortfolioDrawdownPct: number;
    /** Δ return per Δ concurrent risk / capital tie-up ≥ factor × the baseline's return per unit. */
    readonly efficiencyFactor: number;
    readonly minFoldTrades: number;
    readonly minPositiveFoldRatio: number;
    readonly maxFoldConcentration: number;
    readonly costStressMultiplier: number;
    readonly minAlphaT: number;
    readonly minIncrementT: number;
    readonly minMonths: number;
    readonly minInformativeMonths: number;
    /** Hold time and trades per year within this factor of an existing strategy: its trade metrics become hard minimums. */
    readonly geometryFactor: number;
    readonly maxValidationAverageRDrop: number;
    readonly minProfitFactorRatio: number;
    readonly maxStressedAverageRDrop: number;
    readonly minTradeRatio: number;
  };
  readonly finals: {
    readonly minNeighbourNetReturnDelta: number;
    readonly minNeighbourSharpeDelta: number;
    /** The holdout was analysed before: it can only stop, never prove. */
    readonly minHoldoutSharpeDelta: number;
    readonly minHoldoutNetReturnDelta: number;
  };
}

export type EvolutionGatesV4 = EvolutionGatesV3 & { readonly independentFamily: IndependentFamilyPolicy };

export const EVOLUTION_GATES_V4: EvolutionGatesV4 = Object.freeze({
  ...EVOLUTION_GATES_V3,
  version: "evolution-gates-v4",
  independentFamily: Object.freeze({
    methods: Object.freeze({
      simulation: "chronological-multi-strategy-portfolio-replay; no addition of separate backtests",
      stage2: "unchanged RISK_RULES on the group view only after a stage-1 approval; reject-only; R-014 duplicate branch via the own portfolio",
      capitalFrame: "equal fixed slots; comparison A keeps one slot as unallocated cash, comparison B puts the candidate on it; no weight is ever optimised",
      windows: "group start-of-day equity, curveStats (daily returns, sqrt365); in-sample, discovery and validation",
      drawdown: "return over max drawdown not worse in every window; max drawdown with the candidate within the cap",
      efficiency: "delta net return over delta average concurrent risk (and capital tie-up) versus the baseline's return per unit",
      increment: "group PnL B minus A per calendar-year fold; folds with at least minFoldTrades candidate trades",
      costStress: "analytic: every portfolio's equity minus (multiplier-1) x execution costs of its closed trades",
      alpha: "monthly OLS of the candidate portfolio (in B) on every existing portfolio (in B) as separate regressors; max(iid, Newey-West) SE; Student-t n-K-1; alpha > 0 in each window",
      incrementSignificance: "paired monthly test of group B minus group A; max(iid, Newey-West Bartlett) SE; Student-t n-1",
      multipleTesting: "threshold max(minimum, sqrt(2 ln N), Student-t quantile); N = trials counter of gates v3, never reset",
      geometry: "average hold hours and trades per year over discovery + validation; both within the factor makes the reference's trade metrics hard minimums",
      reported: "alpha share, R-squared, correlations, signal overlap and existing-portfolio changes are reported, never decisive"
    }),
    simulation: Object.freeze({
      engineVersion: PORTFOLIO_REPLAY_ENGINE_VERSION,
      groupRiskVersion: GROUP_RISK_VERSION,
      groupRules: Object.freeze([...GROUP_RISK_RULE_CODES]),
      slotCash: PORTFOLIO_SLOT_CASH,
      reserveSlotsInBaseline: 1,
      symbols: Object.freeze([...EVOLUTION_DATA_SPLIT_V1.symbols]),
      regimePolicy: "CRYPTO_NATIVE_V1",
      killSwitchReviewHours: 24,
      memberOrder: "roots, then operator-approved candidates by key, candidate last"
    }),
    thresholds: Object.freeze({
      minNetReturnDelta: 0,
      minSharpeDelta: 0,
      maxPortfolioDrawdownPct: 10,
      efficiencyFactor: 0.5,
      minFoldTrades: 2,
      minPositiveFoldRatio: 0.5,
      maxFoldConcentration: 0.65,
      costStressMultiplier: 2,
      minAlphaT: 2,
      minIncrementT: 2,
      minMonths: 36,
      minInformativeMonths: 24,
      geometryFactor: 2,
      maxValidationAverageRDrop: 0.05,
      minProfitFactorRatio: 0.9,
      maxStressedAverageRDrop: 0.05,
      minTradeRatio: 0.8
    }),
    finals: Object.freeze({
      minNeighbourNetReturnDelta: 0,
      minNeighbourSharpeDelta: 0,
      minHoldoutSharpeDelta: -0.05,
      minHoldoutNetReturnDelta: 0
    })
  })
});

/** Frozen fingerprint; the tests and the pre-registration pin it. */
export const EVOLUTION_GATES_V4_HASH = canonicalHash(EVOLUTION_GATES_V4);

export function isGatesV4(gates: EvolutionGates): gates is EvolutionGatesV4 {
  return "independentFamily" in gates && (gates as Partial<EvolutionGatesV4>).independentFamily !== undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Gate results
// ───────────────────────────────────────────────────────────────────────────

/** Gate identifiers v4 adds; v1's `GateId` stays unchanged. */
export type GateIdV4 =
  | "LINEAGE_BUDGET"
  | "INDEPENDENT_FAMILY"
  | "TRADE_GEOMETRY"
  | "PORTFOLIO_NET_GAIN"
  | "PORTFOLIO_SHARPE_GAIN"
  | "PORTFOLIO_DRAWDOWN"
  | "PORTFOLIO_RISK_EFFICIENCY"
  | "PORTFOLIO_CAPITAL_EFFICIENCY"
  | "INCREMENT_STABILITY"
  | "INCREMENT_COST_STRESS"
  | "OWN_ALPHA"
  | "INCREMENT_SIGNIFICANCE"
  | "PORTFOLIO_DECISION"
  | "PORTFOLIO_NEIGHBOURS"
  | "PORTFOLIO_HOLDOUT_GUARD";

export type GateResultV4 = Omit<GateResult, "gate"> & { readonly gate: GateIdV4 };

/** The structural declaration of an independent family (its pre-registration). */
export interface IndependentFamilyStructure {
  readonly declaredIndependent: boolean;
  /** The genome holds entry parameters only. */
  readonly entryParametersOnly: boolean;
  /** Stop, target and holding time are fixed in the family specification. */
  readonly exitsFrozen: boolean;
  /** Own entry evaluator that calls no other strategy's entry evaluator and no regime gate. */
  readonly ownEntryEvaluator: boolean;
  /** Hash of the family's pre-registration, recorded in the run manifest; null without one. */
  readonly preregistrationHash: string | null;
}

export interface IndependentFamilyScreeningInput {
  readonly family: string;
  readonly structure: IndependentFamilyStructure;
  readonly assessment: PortfolioAssessment;
  /** Prior research + every configuration evaluated so far, never reset. */
  readonly trials: number;
  /** Validation screenings of this family in the current calendar month, this one included. */
  readonly screeningsThisMonth: number;
}

export interface IndependentFamilyDecision {
  readonly gateVersion: string;
  readonly passed: boolean;
  readonly failed: readonly GateIdV4[];
  readonly alphaThreshold: number;
  readonly incrementThreshold: number;
  readonly trials: number;
}

const de = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits).replace(".", ",");
const pct = (value: number | null) => (value === null || !Number.isFinite(value) ? "n/a" : `${Math.round(value * 100)} %`);
const nameOf = (key: string) => key.replace(/^ROOT:/, "");
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const gate = (id: GateIdV4, stage: GateStage, passed: boolean, reasonCode: string, message: string, actual: string | null = null, limit: string | null = null): GateResultV4 => ({
  gate: id,
  stage,
  passed,
  reasonCode,
  message,
  actual,
  limit
});

const WINDOW_LABEL = { IN_SAMPLE: "Entdeckung + Validierung", DISCOVERY: "Entdeckung", VALIDATION: "Validierung", HOLDOUT: "Holdout" } as const;
const windowsOf = (assessment: PortfolioAssessment): PortfolioWindowComparison[] => [assessment.windows.IN_SAMPLE, assessment.windows.DISCOVERY, assessment.windows.VALIDATION];

/**
 * Screening of an independent-family candidate: the v4 portfolio path. The
 * v1 base gates (trades, edge, validation, cost stress, drawdown, phases,
 * redundancy, benchmark) run on the candidate's own backtests as for every
 * family; `PORTFOLIO_DECISION` summarises the v4 checks.
 */
export function independentFamilyScreeningGates(
  input: IndependentFamilyScreeningInput,
  gates: EvolutionGatesV4
): { gates: GateResultV4[]; decision: IndependentFamilyDecision } {
  const S: GateStage = "SCREENING";
  const policy = gates.independentFamily;
  const t = policy.thresholds;
  const a = input.assessment;
  const results: GateResultV4[] = [];
  const budget = gates.lineage.maxScreeningsPerFamilyPerMonth;

  results.push(
    gate(
      "LINEAGE_BUDGET",
      S,
      input.screeningsThisMonth <= budget,
      input.screeningsThisMonth <= budget ? "WITHIN_MONTHLY_FAMILY_LIMIT" : "FAMILY_MONTHLY_LIMIT_REACHED",
      input.screeningsThisMonth <= budget
        ? `Prüfung ${input.screeningsThisMonth} von höchstens ${budget} der Familie ${input.family} auf Validierungsdaten in diesem Monat.`
        : `Monatslimit von ${budget} Prüfungen der Familie ${input.family} erreicht.`,
      String(input.screeningsThisMonth),
      String(budget)
    )
  );

  const structure = input.structure;
  const structural = structure.declaredIndependent && structure.entryParametersOnly && structure.exitsFrozen && structure.ownEntryEvaluator && structure.preregistrationHash !== null;
  const missing = [
    structure.declaredIndependent ? null : "nicht als eigenständig vorregistriert",
    structure.entryParametersOnly ? null : "Genom enthält mehr als Einstiegsparameter",
    structure.exitsFrozen ? null : "Ausstiege nicht eingefroren",
    structure.ownEntryEvaluator ? null : "kein eigener Einstiegs-Evaluator",
    structure.preregistrationHash !== null ? null : "keine Vorregistrierung"
  ].filter((entry): entry is string => entry !== null);
  results.push(
    gate(
      "INDEPENDENT_FAMILY",
      S,
      structural,
      structural ? "INDEPENDENT_FAMILY_DECLARED" : "NOT_AN_INDEPENDENT_FAMILY",
      structural
        ? `Familie ${input.family} ist eigenständig vorregistriert (${structure.preregistrationHash!.slice(0, 12)}…): eigener Einstieg, feste Ausstiege.`
        : `Familie ${input.family} erfüllt die Eigenständigkeit nicht: ${missing.join(", ")}.`
    )
  );

  // Trade metrics of an existing strategy are hard minimums only at comparable geometry.
  const comparable = a.geometry.filter((relation) => relation.comparable);
  const geometryFailures: string[] = [];
  for (const relation of comparable) {
    const own = relation.candidate;
    const reference = relation.reference;
    if (finite(reference.validationAverageR) && (!finite(own.validationAverageR) || own.validationAverageR < reference.validationAverageR - t.maxValidationAverageRDrop)) {
      geometryFailures.push(`${nameOf(relation.key)}: Validierung Ø ${de(own.validationAverageR)}R gegen ${de(reference.validationAverageR)}R`);
    }
    const pfOk =
      reference.profitFactor === null
        ? own.profitFactor === null && own.losses === 0 && own.netPnl > 0
        : own.profitFactor === null
          ? own.losses === 0 && own.netPnl > 0
          : own.profitFactor >= t.minProfitFactorRatio * reference.profitFactor;
    if (!pfOk) geometryFailures.push(`${nameOf(relation.key)}: PF ${de(own.profitFactor)} gegen ${de(reference.profitFactor)}`);
    if (finite(reference.stressedAverageR) && (!finite(own.stressedAverageR) || own.stressedAverageR < reference.stressedAverageR - t.maxStressedAverageRDrop)) {
      geometryFailures.push(`${nameOf(relation.key)}: Ø R bei doppelten Kosten ${de(own.stressedAverageR)} gegen ${de(reference.stressedAverageR)}`);
    }
    if (own.trades < t.minTradeRatio * reference.trades) geometryFailures.push(`${nameOf(relation.key)}: ${own.trades} Trades gegen ${reference.trades}`);
  }
  results.push(
    gate(
      "TRADE_GEOMETRY",
      S,
      geometryFailures.length === 0,
      comparable.length === 0 ? "GEOMETRY_DIFFERS_TRADE_METRICS_REPORTED" : geometryFailures.length === 0 ? "COMPARABLE_GEOMETRY_TRADE_QUALITY_HELD" : "COMPARABLE_GEOMETRY_WORSE_TRADES",
      comparable.length === 0
        ? `Haltedauer oder Handelsfrequenz weichen um mindestens Faktor ${t.geometryFactor} von jeder bestehenden Strategie ab (${a.geometry
            .map((relation) => `${nameOf(relation.key)}: Haltedauer ×${de(relation.holdRatio)}, Frequenz ×${de(relation.frequencyRatio)}`)
            .join("; ")}); deren Trade-Kennzahlen sind nur Bericht.`
        : geometryFailures.length === 0
          ? `Vergleichbare Geometrie mit ${comparable.map((relation) => nameOf(relation.key)).join(", ")}; dessen Trade-Qualität wird gehalten.`
          : `Gebaut wie eine bestehende Strategie, aber mit schwächeren Trades: ${geometryFailures.join("; ")}.`
    )
  );

  const netOk = windowsOf(a).every((window) => finite(window.netReturnDelta) && window.netReturnDelta > t.minNetReturnDelta);
  results.push(
    gate(
      "PORTFOLIO_NET_GAIN",
      S,
      netOk,
      netOk ? "PORTFOLIO_NET_RETURN_RISES" : "NO_NET_PORTFOLIO_GAIN",
      `Nettorendite des Gesamtkapitals mit gegen ohne Kandidat (nach allen Kosten, Verdrängung eingerechnet): ${windowsOf(a)
        .map((window) => `${WINDOW_LABEL[window.key]} ${de(window.netReturnDelta)} Prozentpunkte`)
        .join(", ")}.`,
      windowsOf(a).map((window) => de(window.netReturnDelta)).join("/"),
      `> ${de(t.minNetReturnDelta)}`
    )
  );

  const sharpeOk = windowsOf(a).every((window) => finite(window.sharpeDelta) && window.sharpeDelta > t.minSharpeDelta);
  results.push(
    gate(
      "PORTFOLIO_SHARPE_GAIN",
      S,
      sharpeOk,
      sharpeOk ? "PORTFOLIO_SHARPE_RISES" : "NO_RISK_ADJUSTED_GAIN",
      `Sharpe des Gesamtportfolios mit gegen ohne Kandidat: ${windowsOf(a)
        .map((window) => `${WINDOW_LABEL[window.key]} ${de(window.baseline.sharpe)} → ${de(window.withCandidate.sharpe)}`)
        .join(", ")}.`,
      windowsOf(a).map((window) => de(window.sharpeDelta)).join("/"),
      `> ${de(t.minSharpeDelta)}`
    )
  );

  const ratioHeld = (window: PortfolioWindowComparison): boolean => {
    const before = window.baseline.returnToDrawdown;
    const after = window.withCandidate.returnToDrawdown;
    if (!finite(before)) return !finite(after) ? finite(window.netReturnDelta) && window.netReturnDelta > 0 : false;
    if (!finite(after)) return window.withCandidate.maxDrawdownPct === 0 && finite(window.withCandidate.netReturnPct) && window.withCandidate.netReturnPct > 0;
    return after >= before;
  };
  const drawdownCap = finite(a.drawdownWithCandidatePct) && a.drawdownWithCandidatePct <= t.maxPortfolioDrawdownPct;
  const drawdownOk = windowsOf(a).every(ratioHeld) && drawdownCap;
  results.push(
    gate(
      "PORTFOLIO_DRAWDOWN",
      S,
      drawdownOk,
      drawdownOk ? "RETURN_PER_DRAWDOWN_HELD" : "DRAWDOWN_NOT_PAID",
      `Rendite je Drawdown ohne → mit Kandidat: ${windowsOf(a)
        .map((window) => `${WINDOW_LABEL[window.key]} ${de(window.baseline.returnToDrawdown)} → ${de(window.withCandidate.returnToDrawdown)}`)
        .join(", ")}; maximaler Drawdown mit Kandidat ${de(a.drawdownWithCandidatePct)} % (höchstens ${de(t.maxPortfolioDrawdownPct)} %).`,
      de(a.drawdownWithCandidatePct),
      `≤ ${de(t.maxPortfolioDrawdownPct)}`
    )
  );

  const efficient = (measure: PortfolioAssessment["openRisk"]): boolean => {
    const netDelta = a.windows.IN_SAMPLE.netReturnDelta;
    if (!finite(netDelta) || netDelta <= 0) return false;
    if (!finite(measure.baselineAverage) || !finite(measure.withCandidateAverage) || measure.withCandidateAverage <= measure.baselineAverage) return true;
    if (!finite(measure.incrementalEfficiency)) return false;
    return !finite(measure.baselineEfficiency) || measure.incrementalEfficiency >= t.efficiencyFactor * measure.baselineEfficiency;
  };
  const describeEfficiency = (label: string, measure: PortfolioAssessment["openRisk"]) =>
    `${label} Ø ${de(measure.baselineAverage, 3)} % → ${de(measure.withCandidateAverage, 3)} %; Zusatzrendite je zusätzlicher Einheit ${de(measure.incrementalEfficiency)} gegen ${de(
      measure.baselineEfficiency
    )} des Bestands (mindestens ${de(t.efficiencyFactor)}-fach)`;
  const riskOk = efficient(a.openRisk);
  results.push(
    gate("PORTFOLIO_RISK_EFFICIENCY", S, riskOk, riskOk ? "CONCURRENT_RISK_PAID" : "CONCURRENT_RISK_NOT_PAID", `${describeEfficiency("Gleichzeitiges Risiko", a.openRisk)}.`, de(a.openRisk.incrementalEfficiency), `≥ ${de(t.efficiencyFactor)} × ${de(a.openRisk.baselineEfficiency)}`)
  );
  const capitalOk = efficient(a.capitalBound);
  results.push(
    gate("PORTFOLIO_CAPITAL_EFFICIENCY", S, capitalOk, capitalOk ? "CAPITAL_TIE_UP_PAID" : "CAPITAL_TIE_UP_NOT_PAID", `${describeEfficiency("Kapitalbindung", a.capitalBound)}.`, de(a.capitalBound.incrementalEfficiency), `≥ ${de(t.efficiencyFactor)} × ${de(a.capitalBound.baselineEfficiency)}`)
  );

  const increment = a.increment;
  const stable =
    increment.foldsWithTrades > 0 &&
    finite(increment.positiveRatio) &&
    increment.positiveRatio >= t.minPositiveFoldRatio &&
    finite(increment.concentration) &&
    increment.concentration <= t.maxFoldConcentration;
  results.push(
    gate(
      "INCREMENT_STABILITY",
      S,
      stable,
      stable ? "INCREMENT_SPREAD_OVER_PHASES" : increment.foldsWithTrades === 0 ? "TOO_FEW_TRADES_PER_PHASE" : "INCREMENT_CARRIED_BY_FEW_PHASES",
      `Zuwachs je Marktphase (mindestens ${t.minFoldTrades} Kandidaten-Trades): ${increment.positiveFolds} von ${increment.foldsWithTrades} Phasen positiv, größte Phase ${pct(increment.concentration)} des positiven Zuwachses (${increment.folds
        .map((fold) => `${fold.key} ${de(fold.increment, 0)} USDT/${fold.candidateTrades} Trades`)
        .join(", ")}).`,
      `${de(increment.positiveRatio)}/${de(increment.concentration)}`,
      `≥ ${de(t.minPositiveFoldRatio)}/≤ ${de(t.maxFoldConcentration)}`
    )
  );

  const stress = a.costStress;
  const stressOk = finite(stress.netReturnDelta) && stress.netReturnDelta > 0 && finite(stress.sharpeDelta) && stress.sharpeDelta > 0;
  results.push(
    gate(
      "INCREMENT_COST_STRESS",
      S,
      stressOk,
      stressOk ? "INCREMENT_SURVIVES_COST_STRESS" : "INCREMENT_NEEDS_CHEAP_EXECUTION",
      `Bei ${stress.multiplier}× Gebühren, Spread und Slippage aller Portfolios: Δ Nettorendite ${de(stress.netReturnDelta)} Prozentpunkte, Δ Sharpe ${de(stress.sharpeDelta)}.`,
      `${de(stress.netReturnDelta)}/${de(stress.sharpeDelta)}`,
      "> 0/> 0"
    )
  );

  const alpha = a.alpha;
  const alphaThreshold = lineageTThreshold(t.minAlphaT, input.trials, alpha.criticalT);
  const alphaWindows = finite(a.alphaByWindow.DISCOVERY) && a.alphaByWindow.DISCOVERY > 0 && finite(a.alphaByWindow.VALIDATION) && a.alphaByWindow.VALIDATION > 0;
  const alphaOk =
    alpha.tStat !== null && alpha.tStat >= alphaThreshold && alpha.months >= t.minMonths && alpha.informativeMonths >= t.minInformativeMonths && alphaWindows;
  results.push(
    gate(
      "OWN_ALPHA",
      S,
      alphaOk,
      alphaOk ? "OWN_SIGNIFICANT_ALPHA" : alpha.tStat === null ? "ALPHA_NOT_TESTABLE_COPY_OR_NO_VARIANCE" : "NO_OWN_ALPHA",
      `α der Monatsrenditen gegenüber ${a.existingKeys.map(nameOf).join(", ")} (jede als eigener Regressor, Mehrfachtest N = ${input.trials}): t = ${de(alpha.tStat)} (Schwelle ${de(
        alphaThreshold
      )}), ${alpha.months} Monate, ${alpha.informativeMonths} mit eigenem Ertrag; α̂ Entdeckung ${de(a.alphaByWindow.DISCOVERY, 4)}, Validierung ${de(a.alphaByWindow.VALIDATION, 4)}. Bericht: α-Anteil ${pct(
        a.alphaShare
      )}, R² ${de(a.rSquared)}.${alpha.tStat === null ? " Kein eigener Rest: eine Kopie oder Neugewichtung bestehender Strategien hat kein eigenes α." : ""}`,
      de(alpha.tStat),
      `≥ ${de(alphaThreshold)}`
    )
  );

  const test = a.incrementTest;
  const incrementThreshold = lineageTThreshold(t.minIncrementT, input.trials, test.criticalT);
  const incrementOk = test.tStat !== null && test.tStat >= incrementThreshold && test.months >= t.minMonths && test.informativeMonths >= t.minInformativeMonths;
  results.push(
    gate(
      "INCREMENT_SIGNIFICANCE",
      S,
      incrementOk,
      incrementOk ? "PORTFOLIO_INCREMENT_SIGNIFICANT" : "PORTFOLIO_INCREMENT_NOT_ROBUST",
      `Gepaarter Monatsvergleich Gesamtportfolio mit gegen ohne Kandidat (Newey–West, Student-t, Mehrfachtest N = ${input.trials}): t = ${de(test.tStat)} (Schwelle ${de(
        incrementThreshold
      )}), ${test.months} Monate, ${test.informativeMonths} mit Unterschied, Ø ${de(finite(test.meanDifference) ? test.meanDifference * 100 : null, 3)} % je Monat.`,
      de(test.tStat),
      `≥ ${de(incrementThreshold)}`
    )
  );

  const failed = results.filter((result) => !result.passed).map((result) => result.gate);
  results.push(
    gate(
      "PORTFOLIO_DECISION",
      S,
      failed.length === 0,
      failed.length === 0 ? "ADDS_OWN_PORTFOLIO_VALUE" : "NO_ROBUST_PORTFOLIO_VALUE",
      failed.length === 0
        ? "Verbessert das Gesamtportfolio bei gleichem Kapital, nach Kosten und unter unveränderten Risk-Regeln, mit eigenem, belastbarem Ertrag."
        : `Kein belastbarer eigener Portfolio-Mehrwert: ${failed.join(", ")}.`
    )
  );

  return {
    gates: results,
    decision: { gateVersion: gates.version, passed: failed.length === 0, failed, alphaThreshold, incrementThreshold, trials: input.trials }
  };
}

export interface NeighbourPortfolioResult {
  readonly key: string;
  readonly netReturnDelta: number | null;
  readonly sharpeDelta: number | null;
}

/** Final stage of the portfolio path: one-step neighbours must also add to the portfolio; the holdout can only stop. */
export function independentFamilyFinalGates(
  input: { readonly neighbours: readonly NeighbourPortfolioResult[]; readonly holdout: PortfolioWindowComparison },
  gates: EvolutionGatesV4
): GateResultV4[] {
  const F: GateStage = "FINAL";
  const f = gates.independentFamily.finals;
  const weak = input.neighbours.filter(
    (neighbour) => !(finite(neighbour.netReturnDelta) && neighbour.netReturnDelta > f.minNeighbourNetReturnDelta && finite(neighbour.sharpeDelta) && neighbour.sharpeDelta > f.minNeighbourSharpeDelta)
  );
  const neighboursOk = input.neighbours.length > 0 && weak.length === 0;
  const holdout = input.holdout;
  const holdoutOk =
    finite(holdout.sharpeDelta) && holdout.sharpeDelta >= f.minHoldoutSharpeDelta && finite(holdout.netReturnDelta) && holdout.netReturnDelta >= f.minHoldoutNetReturnDelta;
  return [
    gate(
      "PORTFOLIO_NEIGHBOURS",
      F,
      neighboursOk,
      input.neighbours.length === 0 ? "NO_NEIGHBOURS" : neighboursOk ? "NEIGHBOURS_ADD_VALUE" : "FRAGILE_PORTFOLIO_VALUE",
      input.neighbours.length === 0
        ? "Keine Nachbarvarianten im Portfolio geprüft."
        : `Nachbarvarianten im Portfolio (Δ Nettorendite / Δ Sharpe): ${input.neighbours.map((neighbour) => `${neighbour.key} ${de(neighbour.netReturnDelta)}/${de(neighbour.sharpeDelta)}`).join(", ")}.`
    ),
    gate(
      "PORTFOLIO_HOLDOUT_GUARD",
      F,
      holdoutOk,
      holdoutOk ? "HOLDOUT_DOES_NOT_STOP" : "HOLDOUT_STOPS",
      `Holdout 2024–2026 (bereits analysiert, nie Nachweis): Δ Sharpe ${de(holdout.sharpeDelta)} (mindestens ${de(f.minHoldoutSharpeDelta)}), Δ Nettorendite ${de(holdout.netReturnDelta)} Prozentpunkte (mindestens ${de(
        f.minHoldoutNetReturnDelta
      )}).`,
      `${de(holdout.sharpeDelta)}/${de(holdout.netReturnDelta)}`,
      `≥ ${de(f.minHoldoutSharpeDelta)}/≥ ${de(f.minHoldoutNetReturnDelta)}`
    )
  ];
}
