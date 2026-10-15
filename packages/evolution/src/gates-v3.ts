/**
 * Gates v3: the lineage and diversification rule
 * (docs/trading/research/2026-10-15-evolution-gates-v3-preregistration.md).
 *
 * v2 compared a candidate with its own root only when their daily returns
 * correlated above 0.9. EVO-REG-0004 correlated 0.89 with the strong
 * challenger, was therefore measured against the weak champion only, and
 * passed although it was weaker than the challenger it descends from. v3
 * removes that switch. Every candidate has to take one of two paths:
 *
 *  A. Value (a better version of its lineage): compared — whatever the
 *     correlation — with its frozen root, its parent and the best existing
 *     representative of its family, each separately. It must beat every one
 *     of them clearly in risk-adjusted net return, in both windows and
 *     significantly in a paired monthly test, and may not get materially
 *     worse in profit factor, drawdown, costs, market phases, capital binding,
 *     validation or sample size. Not every metric has to improve.
 *  B. Diversification (a genuinely independent addition): low correlation
 *     with every existing strategy AND few shared entry signals (so a
 *     parameter variant cannot pose as independent by changing its exits),
 *     a portfolio of the existing strategies that becomes better in both
 *     windows when it is added, and a significant α that no combination of
 *     the existing strategies explains (a copy of the strongest strategy also
 *     "improves" an equal-weight portfolio that holds a weak one — the α
 *     regression on each strategy separately does not fall for that).
 *
 * Correlation only decides which path is *possible* (a near-copy can never be
 * independent); it never decides which reference a candidate is measured
 * against. The holdout stays a guard against getting worse, never evidence.
 * v1 and v2 stay untouched and selectable; every decision records its version.
 */

import { canonicalHash } from "@signalpilot/trading-domain";

import { EVOLUTION_GATES_V1, type EvolutionGates, type GateResult } from "./gates.js";
import { combineDailyEquity, curveStats, type CurveStats, type DailyEquityPoint, type FoldStability, type WindowMetrics } from "./metrics.js";
import { spanningAlphaTest, type PairedMonthlyTest, type SpanningAlphaTest } from "./paired.js";

export interface LineageValuePolicy {
  /** Absolute Sharpe improvement over each reference (discovery + validation). */
  readonly minSharpeDelta: number;
  /** Relative improvement, applied when the reference Sharpe is at least `relativeReferenceFloor`. */
  readonly minRelativeSharpeGain: number;
  readonly relativeReferenceFloor: number;
  /** Below that floor (weak, zero or negative reference) the candidate's own Sharpe must reach this instead. */
  readonly minCandidateSharpe: number;
  /** Lower bound of the paired t-threshold; effective bound max(this, √(2·ln N), t(0.975, n − 1)). */
  readonly minPairedT: number;
  readonly minMonths: number;
  readonly minInformativeMonths: number;
  // Tolerances: how much worse than the reference a dimension may get without the value being lost.
  readonly maxValidationAverageRDrop: number;
  readonly minProfitFactorRatio: number;
  readonly maxDrawdownRatio: number;
  readonly maxStressedAverageRDrop: number;
  /** Percentage points of the gross profit that execution costs may additionally consume. */
  readonly maxCostShareIncreasePct: number;
  /** Positive market phases that may be lost. */
  readonly maxPositiveFoldLoss: number;
  readonly maxConcentrationIncrease: number;
  /** Time in the market relative to the reference — unless the return per unit of exposure is at least as high. */
  readonly maxExposureRatio: number;
  readonly minTradeRatio: number;
  /** Holdout (previously analysed): only a guard against getting worse, never evidence. */
  readonly minHoldoutSharpeDelta: number;
}

export interface LineageDiversificationPolicy {
  /** Daily-return correlation with every existing strategy (discovery + validation). */
  readonly maxCorrelation: number;
  /** Share of the candidate's entries where an existing strategy enters (±window) or already holds a position. */
  readonly maxSignalOverlap: number;
  readonly signalWindowHours: number;
  /** Portfolio Sharpe gain over discovery + validation; additionally > 0 in each window. */
  readonly minPortfolioSharpeGain: number;
  /** Max drawdown of the portfolio with the candidate relative to without it. */
  readonly maxPortfolioDrawdownRatio: number;
  /** Lower bound of the α t-threshold; effective bound max(this, √(2·ln N), t(0.975, n − K − 1)). */
  readonly minAlphaT: number;
  readonly minMonths: number;
  readonly minInformativeMonths: number;
  /** Holdout guard: portfolio Sharpe with the candidate minus without it. */
  readonly minHoldoutPortfolioSharpeDelta: number;
}

export interface LineagePolicy {
  /**
   * Method identifiers: part of the frozen policy, so changing how a number
   * is computed changes the hash and needs a new gate version, like a threshold.
   */
  readonly methods: Readonly<Record<"sharpe" | "paired" | "alpha" | "signalOverlap" | "portfolio" | "trials", string>>;
  readonly value: LineageValuePolicy;
  readonly diversification: LineageDiversificationPolicy;
  /** Candidates of one family screened on validation data per calendar month (all gate versions count). */
  readonly maxScreeningsPerFamilyPerMonth: number;
  readonly maxFinalistsPerFamilyPerRun: number;
}

export type EvolutionGatesV3 = EvolutionGates & { readonly lineage: LineagePolicy };

export const EVOLUTION_GATES_V3: EvolutionGatesV3 = Object.freeze({
  ...EVOLUTION_GATES_V1,
  version: "evolution-gates-v3",
  lineage: Object.freeze({
    methods: Object.freeze({
      sharpe: "daily-mark-to-market-btc+eth-sqrt365",
      paired: "monthly-difference-max(iid,newey-west-bartlett)-student-t",
      alpha: "monthly-ols-on-each-existing-strategy-max(iid,newey-west-sandwich)-student-t",
      signalOverlap: "same-symbol-entry-within-window-or-reference-position-open",
      portfolio: "equal-capital-separate-accounts-roots+approved",
      trials: "prior-training-configurations+distinct-candidate-and-neighbour-backtests-never-reset"
    }),
    value: Object.freeze({
      minSharpeDelta: 0.15,
      minRelativeSharpeGain: 0.1,
      relativeReferenceFloor: 0.5,
      minCandidateSharpe: 0.5,
      minPairedT: 2,
      minMonths: 36,
      minInformativeMonths: 24,
      maxValidationAverageRDrop: 0.05,
      minProfitFactorRatio: 0.9,
      maxDrawdownRatio: 1.1,
      maxStressedAverageRDrop: 0.05,
      maxCostShareIncreasePct: 10,
      maxPositiveFoldLoss: 1,
      maxConcentrationIncrease: 0.15,
      maxExposureRatio: 1.2,
      minTradeRatio: 0.8,
      minHoldoutSharpeDelta: -0.1
    }),
    diversification: Object.freeze({
      maxCorrelation: 0.5,
      maxSignalOverlap: 0.5,
      signalWindowHours: 24,
      minPortfolioSharpeGain: 0.1,
      maxPortfolioDrawdownRatio: 1,
      minAlphaT: 2,
      minMonths: 36,
      minInformativeMonths: 24,
      minHoldoutPortfolioSharpeDelta: -0.05
    }),
    maxScreeningsPerFamilyPerMonth: 10,
    maxFinalistsPerFamilyPerRun: 1
  })
});

/** Frozen fingerprint; the tests and the pre-registration pin it. */
export const EVOLUTION_GATES_V3_HASH = canonicalHash(EVOLUTION_GATES_V3);

export function isGatesV3(gates: EvolutionGates): gates is EvolutionGatesV3 {
  return "lineage" in gates && (gates as Partial<EvolutionGatesV3>).lineage !== undefined;
}

/** Multiple-testing aware t-threshold: max(minimum, √(2·ln N), Student-t quantile for n − 1 degrees of freedom). */
export function lineageTThreshold(minimum: number, trials: number, criticalT: number | null): number {
  const multipleTesting = trials >= 2 ? Math.sqrt(2 * Math.log(trials)) : 0;
  return Math.max(minimum, multipleTesting, criticalT ?? Number.POSITIVE_INFINITY);
}

// ───────────────────────────────────────────────────────────────────────────
// Inputs and the portfolio comparison
// ───────────────────────────────────────────────────────────────────────────

export interface LineageWindows {
  readonly discovery: WindowMetrics;
  readonly validation: WindowMetrics;
  /** Discovery + validation together. */
  readonly inSample: WindowMetrics;
  readonly folds: FoldStability;
}

export type LineageRole = "ROOT" | "PARENT" | "FAMILY_BEST";

export interface LineageReference {
  /** `ROOT:<strategy key>` or a candidate key. */
  readonly key: string;
  readonly roles: readonly LineageRole[];
  readonly metrics: LineageWindows;
  /** Candidate minus this reference, monthly, discovery + validation. */
  readonly paired: PairedMonthlyTest;
}

export interface ExistingStrategyRelation {
  readonly key: string;
  /** Daily-return correlation over discovery + validation (null below 30 common days). */
  readonly correlation: number | null;
  /** Share of the candidate's entries within the signal window of this strategy's entries. */
  readonly signalOverlap: number | null;
}

export interface PortfolioWindowStats {
  readonly discovery: CurveStats;
  readonly validation: CurveStats;
  readonly inSample: CurveStats;
}

export interface PortfolioComparison {
  readonly members: readonly string[];
  readonly without: PortfolioWindowStats;
  readonly with: PortfolioWindowStats;
  /** α of the candidate against every existing strategy (monthly regression, discovery + validation). */
  readonly alpha: SpanningAlphaTest;
}

export interface PortfolioCurveInput {
  readonly key: string;
  readonly curve: readonly DailyEquityPoint[];
  readonly startingCash: number;
}

/** Sum of separate, equally funded accounts — the existing strategies with and without the candidate. */
export function portfolioCurve(members: readonly PortfolioCurveInput[]): DailyEquityPoint[] {
  return combineDailyEquity(
    members.map((member) => member.curve),
    members.map((member) => member.startingCash)
  );
}

export function portfolioComparison(input: {
  readonly existing: readonly PortfolioCurveInput[];
  readonly candidate: PortfolioCurveInput;
  readonly windows: { readonly discovery: { readonly from: string; readonly to: string }; readonly validation: { readonly from: string; readonly to: string } };
}): PortfolioComparison {
  const without = portfolioCurve(input.existing);
  const withCandidate = portfolioCurve([...input.existing, input.candidate]);
  const { discovery, validation } = input.windows;
  const stats = (curve: readonly DailyEquityPoint[]): PortfolioWindowStats => ({
    discovery: curveStats(curve, discovery.from, discovery.to),
    validation: curveStats(curve, validation.from, validation.to),
    inSample: curveStats(curve, discovery.from, validation.to)
  });
  return {
    members: input.existing.map((member) => member.key),
    without: stats(without),
    with: stats(withCandidate),
    alpha: spanningAlphaTest(
      input.candidate.curve,
      input.existing.map((member) => member.curve),
      discovery.from,
      validation.to
    )
  };
}

export interface LineageScreeningInput {
  readonly family: string;
  readonly candidate: LineageWindows;
  /** Root, parent and best family representative — merged when one strategy holds several roles. */
  readonly references: readonly LineageReference[];
  /** Every existing strategy (roots and operator-approved candidates of all families). */
  readonly existing: readonly ExistingStrategyRelation[];
  readonly portfolio: PortfolioComparison;
  /** Prior research + every configuration evaluated so far, never reset. */
  readonly trials: number;
  /** Screenings of this family in the current calendar month, this one included. */
  readonly screeningsThisMonth: number;
}

export type LineagePath = "VALUE" | "DIVERSIFICATION";

export interface LineageReferenceAssessment {
  readonly key: string;
  readonly roles: readonly LineageRole[];
  readonly referenceSharpe: number | null;
  readonly candidateSharpe: number | null;
  readonly sharpeDelta: number | null;
  readonly discoverySharpeDelta: number | null;
  readonly validationSharpeDelta: number | null;
  readonly improvement: boolean;
  readonly consistent: boolean;
  readonly significant: boolean;
  readonly pairedT: number | null;
  readonly threshold: number;
  readonly months: number;
  readonly informativeMonths: number;
  readonly deteriorations: readonly string[];
}

export interface LineageAssessment {
  readonly gateVersion: string;
  readonly path: LineagePath | null;
  readonly valuePassed: boolean;
  readonly diversificationPassed: boolean;
  readonly references: readonly LineageReferenceAssessment[];
  readonly existing: readonly ExistingStrategyRelation[];
  readonly portfolio: {
    readonly members: readonly string[];
    readonly sharpeWithout: number | null;
    readonly sharpeWith: number | null;
    readonly sharpeDelta: number | null;
    readonly discoverySharpeDelta: number | null;
    readonly validationSharpeDelta: number | null;
    readonly drawdownWithout: number | null;
    readonly drawdownWith: number | null;
    readonly alphaT: number | null;
    readonly alphaThreshold: number;
    readonly betas: readonly number[] | null;
    readonly months: number;
    readonly informativeMonths: number;
  };
  readonly trials: number;
  readonly screeningsThisMonth: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Gates
// ───────────────────────────────────────────────────────────────────────────

const de = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits).replace(".", ",");
const pct = (value: number) => `${Math.round(value * 100)} %`;
const nameOf = (key: string) => key.replace(/^ROOT:/, "");
const ROLE_LABEL: Readonly<Record<LineageRole, string>> = { ROOT: "Wurzel", PARENT: "Eltern", FAMILY_BEST: "bester Familienvertreter" };
const describe = (reference: { key: string; roles: readonly LineageRole[] }) => `${nameOf(reference.key)} (${reference.roles.map((role) => ROLE_LABEL[role]).join(", ")})`;

const gate = (id: GateResult["gate"], stage: GateResult["stage"], passed: boolean, reasonCode: string, message: string, actual: string | null = null, limit: string | null = null): GateResult => ({
  gate: id,
  stage,
  passed,
  reasonCode,
  message,
  actual,
  limit
});

const deltaOf = (own: number | null, reference: number | null): number | null => (own === null || reference === null ? null : own - reference);

function assessReference(candidate: LineageWindows, reference: LineageReference, policy: LineageValuePolicy, trials: number): LineageReferenceAssessment {
  const own = candidate.inSample;
  const ref = reference.metrics.inSample;
  const sharpeDelta = deltaOf(own.sharpe, ref.sharpe);
  const strongReference = ref.sharpe !== null && ref.sharpe >= policy.relativeReferenceFloor;
  const improvement =
    own.sharpe !== null &&
    ref.sharpe !== null &&
    sharpeDelta !== null &&
    sharpeDelta >= policy.minSharpeDelta &&
    (strongReference ? own.sharpe >= ref.sharpe * (1 + policy.minRelativeSharpeGain) : own.sharpe >= policy.minCandidateSharpe);
  const discoverySharpeDelta = deltaOf(candidate.discovery.sharpe, reference.metrics.discovery.sharpe);
  const validationSharpeDelta = deltaOf(candidate.validation.sharpe, reference.metrics.validation.sharpe);
  const consistent = discoverySharpeDelta !== null && validationSharpeDelta !== null && discoverySharpeDelta > 0 && validationSharpeDelta > 0;
  const paired = reference.paired;
  const threshold = lineageTThreshold(policy.minPairedT, trials, paired.criticalT);
  const significant =
    paired.months >= policy.minMonths && paired.informativeMonths >= policy.minInformativeMonths && paired.criticalT !== null && paired.tStat !== null && paired.tStat >= threshold;

  const deteriorations: string[] = [];
  const ownValidation = candidate.validation.averageR;
  const refValidation = reference.metrics.validation.averageR;
  if (ownValidation === null || refValidation === null || ownValidation < refValidation - policy.maxValidationAverageRDrop) {
    deteriorations.push(`Ø R Validierung ${de(ownValidation)} gegenüber ${de(refValidation)}`);
  }
  if (ref.profitFactor !== null) {
    const ownUnbounded = own.profitFactor === null && own.losses === 0 && own.netPnl > 0;
    if (!ownUnbounded && (own.profitFactor === null || own.profitFactor < ref.profitFactor * policy.minProfitFactorRatio)) {
      deteriorations.push(`Profit Factor ${de(own.profitFactor)} gegenüber ${de(ref.profitFactor)}`);
    }
  }
  if (own.maxDrawdownPct === null || ref.maxDrawdownPct === null || (ref.maxDrawdownPct > 0 ? own.maxDrawdownPct > ref.maxDrawdownPct * policy.maxDrawdownRatio : own.maxDrawdownPct > 0)) {
    deteriorations.push(`max. Drawdown ${de(own.maxDrawdownPct)} % gegenüber ${de(ref.maxDrawdownPct)} %`);
  }
  if (own.stressed.averageR === null || ref.stressed.averageR === null || own.stressed.averageR < ref.stressed.averageR - policy.maxStressedAverageRDrop) {
    deteriorations.push(`Ø R bei doppelten Kosten ${de(own.stressed.averageR)} gegenüber ${de(ref.stressed.averageR)}`);
  }
  if (ref.costShareOfGrossProfitPct !== null && (own.costShareOfGrossProfitPct === null || own.costShareOfGrossProfitPct > ref.costShareOfGrossProfitPct + policy.maxCostShareIncreasePct)) {
    deteriorations.push(`Kostenanteil am Bruttogewinn ${de(own.costShareOfGrossProfitPct, 1)} % gegenüber ${de(ref.costShareOfGrossProfitPct, 1)} %`);
  }
  if (candidate.folds.positiveFolds < reference.metrics.folds.positiveFolds - policy.maxPositiveFoldLoss) {
    deteriorations.push(`${candidate.folds.positiveFolds} positive Marktphasen gegenüber ${reference.metrics.folds.positiveFolds}`);
  }
  const ownConcentration = candidate.folds.concentration;
  const refConcentration = reference.metrics.folds.concentration;
  if (refConcentration !== null && (ownConcentration === null || ownConcentration > refConcentration + policy.maxConcentrationIncrease)) {
    deteriorations.push(`größter Phasenanteil ${ownConcentration === null ? "n/a" : pct(ownConcentration)} gegenüber ${pct(refConcentration)}`);
  }
  if (own.exposurePct !== null && ref.exposurePct !== null && ref.exposurePct > 0 && own.exposurePct > ref.exposurePct * policy.maxExposureRatio) {
    const efficiency = (metrics: WindowMetrics) => (metrics.netReturnPct === null || metrics.exposurePct === null || metrics.exposurePct <= 0 ? null : metrics.netReturnPct / metrics.exposurePct);
    const ownEfficiency = efficiency(own);
    const refEfficiency = efficiency(ref);
    if (ownEfficiency === null || refEfficiency === null || ownEfficiency < refEfficiency) {
      deteriorations.push(`Kapitalbindung ${de(own.exposurePct, 1)} % gegenüber ${de(ref.exposurePct, 1)} % der Zeit im Markt ohne höhere Rendite je gebundener Zeit`);
    }
  }
  if (own.trades < ref.trades * policy.minTradeRatio) {
    deteriorations.push(`${own.trades} Trades gegenüber ${ref.trades}`);
  }
  return {
    key: reference.key,
    roles: reference.roles,
    referenceSharpe: ref.sharpe,
    candidateSharpe: own.sharpe,
    sharpeDelta,
    discoverySharpeDelta,
    validationSharpeDelta,
    improvement,
    consistent,
    significant,
    pairedT: paired.tStat,
    threshold,
    months: paired.months,
    informativeMonths: paired.informativeMonths,
    deteriorations
  };
}

/**
 * Screening of gates v3: the lineage budget, both paths and the decision.
 * The sub-gates of the path that did not carry the decision are marked
 * informational — shown with their verdict, never blocking on their own;
 * `LINEAGE_DECISION` blocks when neither path holds.
 */
export function lineageScreeningGates(input: LineageScreeningInput, gates: EvolutionGatesV3): { gates: GateResult[]; assessment: LineageAssessment } {
  const S = "SCREENING" as const;
  const policy = gates.lineage;
  const valuePolicy = policy.value;
  const diversification = policy.diversification;
  const family = input.family;

  const budget = gate(
    "LINEAGE_BUDGET",
    S,
    input.screeningsThisMonth <= policy.maxScreeningsPerFamilyPerMonth,
    input.screeningsThisMonth <= policy.maxScreeningsPerFamilyPerMonth ? "WITHIN_MONTHLY_FAMILY_LIMIT" : "FAMILY_MONTHLY_LIMIT_REACHED",
    input.screeningsThisMonth <= policy.maxScreeningsPerFamilyPerMonth
      ? `Prüfung ${input.screeningsThisMonth} von höchstens ${policy.maxScreeningsPerFamilyPerMonth} der Familie ${family} auf Validierungsdaten in diesem Monat.`
      : `Monatslimit von ${policy.maxScreeningsPerFamilyPerMonth} Prüfungen der Familie ${family} erreicht — die Validierungsdaten werden nicht weiter für diese Familie abgenutzt.`,
    String(input.screeningsThisMonth),
    String(policy.maxScreeningsPerFamilyPerMonth)
  );

  // ── Path A: value over the lineage, every reference separately ──────────
  const references = input.references.map((reference) => assessReference(input.candidate, reference, valuePolicy, input.trials));
  const noReferences = references.length === 0;
  const all = (predicate: (entry: LineageReferenceAssessment) => boolean) => !noReferences && references.every(predicate);
  const list = (render: (entry: LineageReferenceAssessment) => string) => references.map(render).join("; ");
  const relativeRule = `ΔSharpe ≥ ${de(valuePolicy.minSharpeDelta)} und ≥ ${pct(valuePolicy.minRelativeSharpeGain)} über der Referenz (bei Referenz-Sharpe unter ${de(valuePolicy.relativeReferenceFloor)} stattdessen eigene Sharpe ≥ ${de(valuePolicy.minCandidateSharpe)})`;
  const improvementPassed = all((entry) => entry.improvement);
  const consistencyPassed = all((entry) => entry.consistent);
  const significancePassed = all((entry) => entry.significant);
  const deteriorationPassed = all((entry) => entry.deteriorations.length === 0);
  const valueGates: GateResult[] = [
    gate(
      "VALUE_RISK_ADJUSTED",
      S,
      improvementPassed,
      improvementPassed ? "BEATS_LINEAGE_RISK_ADJUSTED" : "NOT_BETTER_THAN_LINEAGE",
      noReferences
        ? "Keine Referenz der eigenen Linie verfügbar — ohne Vergleich kein Mehrwert."
        : `${improvementPassed ? "Risikobereinigt deutlich besser als die eigene Linie" : "Nicht deutlich besser als die eigene Linie"} (Sharpe Entdeckung + Validierung, unabhängig von der Korrelation): ${list((entry) => `${describe(entry)} ${de(entry.candidateSharpe)} gegenüber ${de(entry.referenceSharpe)}, Δ ${de(entry.sharpeDelta)}`)}. Verlangt je Referenz ${relativeRule}.`,
      list((entry) => de(entry.sharpeDelta)),
      de(valuePolicy.minSharpeDelta)
    ),
    gate(
      "VALUE_CONSISTENCY",
      S,
      consistencyPassed,
      consistencyPassed ? "BEATS_LINEAGE_IN_BOTH_WINDOWS" : "LINEAGE_ADVANTAGE_NOT_IN_BOTH_WINDOWS",
      noReferences
        ? "Keine Referenz der eigenen Linie verfügbar."
        : `${consistencyPassed ? "In Entdeckung und Validierung besser" : "Nicht in beiden Zeiträumen besser"}: ${list((entry) => `${describe(entry)} ΔSharpe ${de(entry.discoverySharpeDelta)}/${de(entry.validationSharpeDelta)}`)}.`,
      list((entry) => `${de(entry.discoverySharpeDelta)}/${de(entry.validationSharpeDelta)}`),
      "> 0/> 0"
    ),
    gate(
      "VALUE_SIGNIFICANCE",
      S,
      significancePassed,
      significancePassed ? "LINEAGE_ADVANTAGE_SIGNIFICANT" : "LINEAGE_ADVANTAGE_NOT_SIGNIFICANT",
      noReferences
        ? "Keine Referenz der eigenen Linie verfügbar."
        : `Gepaarter Monatsvergleich (Newey–West, Student-t, Mehrfachtest N = ${input.trials}): ${list((entry) =>
            entry.months < valuePolicy.minMonths || entry.informativeMonths < valuePolicy.minInformativeMonths
              ? `${describe(entry)} zu kurze Stichprobe (${entry.months} Monate, ${entry.informativeMonths} mit Unterschied; verlangt ≥ ${valuePolicy.minMonths}/${valuePolicy.minInformativeMonths})`
              : `${describe(entry)} t = ${de(entry.pairedT)}, Schwelle ${de(entry.threshold)}`
          )}.`,
      list((entry) => de(entry.pairedT)),
      list((entry) => de(entry.threshold))
    ),
    gate(
      "VALUE_NO_MATERIAL_DETERIORATION",
      S,
      deteriorationPassed,
      deteriorationPassed ? "NO_MATERIAL_DETERIORATION" : "MATERIALLY_WORSE_THAN_LINEAGE",
      noReferences
        ? "Keine Referenz der eigenen Linie verfügbar."
        : deteriorationPassed
          ? `In keiner Dimension wesentlich schlechter als ${references.map(describe).join(", ")} (Validierung, Profit Factor, Drawdown, Kosten, Marktphasen, Kapitalbindung, Stichprobe; Toleranzen vorregistriert).`
          : `Wesentlich schlechter als die eigene Linie: ${references.filter((entry) => entry.deteriorations.length > 0).map((entry) => `${describe(entry)}: ${entry.deteriorations.join(", ")}`).join("; ")}.`
    )
  ];
  const valuePassed = improvementPassed && consistencyPassed && significancePassed && deteriorationPassed;

  // ── Path B: genuine diversification of the existing portfolio ───────────
  const correlated = input.existing.filter((entry) => entry.correlation === null || entry.correlation > diversification.maxCorrelation);
  const overlapping = input.existing.filter((entry) => entry.signalOverlap === null || entry.signalOverlap > diversification.maxSignalOverlap);
  const independent = input.existing.length > 0 && correlated.length === 0 && overlapping.length === 0;
  const portfolio = input.portfolio;
  const sharpeDelta = deltaOf(portfolio.with.inSample.sharpe, portfolio.without.inSample.sharpe);
  const discoveryDelta = deltaOf(portfolio.with.discovery.sharpe, portfolio.without.discovery.sharpe);
  const validationDelta = deltaOf(portfolio.with.validation.sharpe, portfolio.without.validation.sharpe);
  const drawdownWith = portfolio.with.inSample.maxDrawdownPct;
  const drawdownWithout = portfolio.without.inSample.maxDrawdownPct;
  const drawdownOk =
    drawdownWith !== null && drawdownWithout !== null && (drawdownWithout > 0 ? drawdownWith <= drawdownWithout * diversification.maxPortfolioDrawdownRatio : drawdownWith <= 0);
  const portfolioGain =
    sharpeDelta !== null && discoveryDelta !== null && validationDelta !== null && sharpeDelta >= diversification.minPortfolioSharpeGain && discoveryDelta > 0 && validationDelta > 0 && drawdownOk;
  const alpha = portfolio.alpha;
  const alphaThreshold = lineageTThreshold(diversification.minAlphaT, input.trials, alpha.criticalT);
  const alphaSampleOk = alpha.months >= diversification.minMonths && alpha.informativeMonths >= diversification.minInformativeMonths && alpha.criticalT !== null;
  const alphaSignificant = alphaSampleOk && alpha.tStat !== null && alpha.tStat >= alphaThreshold;
  const members = portfolio.members.map(nameOf).join(" + ");
  const diversificationGates: GateResult[] = [
    gate(
      "DIVERSIFICATION_INDEPENDENCE",
      S,
      independent,
      independent ? "GENUINELY_INDEPENDENT" : correlated.length > 0 ? "NOT_INDEPENDENT_CORRELATED" : "NOT_INDEPENDENT_SHARED_SIGNALS",
      input.existing.length === 0
        ? "Keine bestehende Strategie zum Vergleich — Unabhängigkeit nicht prüfbar."
        : `${independent ? "Eigenständig" : "Nicht eigenständig"}: ${input.existing
            .map((entry) => `${nameOf(entry.key)} Korrelation ${de(entry.correlation)}, bespielte Einstiege ${entry.signalOverlap === null ? "n/a" : pct(entry.signalOverlap)}`)
            .join("; ")} (verlangt je Strategie Korrelation ≤ ${de(diversification.maxCorrelation)} und höchstens ${pct(diversification.maxSignalOverlap)} Einstiege, bei denen sie binnen ±${diversification.signalWindowHours} h selbst einsteigt oder schon eine Position hält — eine Parametervariante mit anderen Ausstiegen bleibt eine Variante).`,
      input.existing.map((entry) => `${de(entry.correlation)}/${entry.signalOverlap === null ? "n/a" : de(entry.signalOverlap)}`).join("; "),
      `≤ ${de(diversification.maxCorrelation)}/≤ ${de(diversification.maxSignalOverlap)}`
    ),
    gate(
      "DIVERSIFICATION_PORTFOLIO_GAIN",
      S,
      portfolioGain,
      portfolioGain ? "IMPROVES_PORTFOLIO" : "DOES_NOT_IMPROVE_PORTFOLIO",
      `Portfolio ${members || "–"} mit dem Kandidaten: Sharpe ${de(portfolio.with.inSample.sharpe)} gegenüber ${de(portfolio.without.inSample.sharpe)} (Δ ${de(sharpeDelta)}, Entdeckung ${de(discoveryDelta)}, Validierung ${de(validationDelta)}), max. Drawdown ${de(drawdownWith)} % gegenüber ${de(drawdownWithout)} %. Verlangt ΔSharpe ≥ ${de(diversification.minPortfolioSharpeGain)}, in beiden Zeiträumen > 0, Drawdown höchstens ${de(diversification.maxPortfolioDrawdownRatio)}-fach.`,
      `${de(sharpeDelta)}/${de(discoveryDelta)}/${de(validationDelta)}`,
      `≥ ${de(diversification.minPortfolioSharpeGain)}/> 0/> 0`
    ),
    gate(
      "DIVERSIFICATION_SIGNIFICANCE",
      S,
      alphaSignificant,
      alphaSignificant ? "PORTFOLIO_ALPHA_SIGNIFICANT" : alphaSampleOk ? "PORTFOLIO_ALPHA_NOT_SIGNIFICANT" : "INSUFFICIENT_ALPHA_SAMPLE",
      alphaSampleOk
        ? `Eigenständiger Ertrag, den keine Kombination der bestehenden Strategien erklärt (α der Regression der Monatsrenditen auf ${portfolio.members.map(nameOf).join(", ") || "–"}; β ${(alpha.betas ?? []).map((value) => de(value)).join("/") || "n/a"}): t = ${de(alpha.tStat)} (Newey–West, Lag ${alpha.lag ?? "–"}; ohne Korrektur ${de(alpha.naiveTStat)}) über ${alpha.months} Monate; Schwelle ${de(alphaThreshold)} = max(${de(diversification.minAlphaT)}; √(2·ln ${input.trials}); t₀,₉₇₅ mit ${alpha.months - portfolio.members.length - 1} FG).`
        : `Zu kurze Stichprobe für den α-Test: ${alpha.months} Monate, davon ${alpha.informativeMonths} mit eigenem Ertrag (verlangt ≥ ${diversification.minMonths}/${diversification.minInformativeMonths}).`,
      de(alpha.tStat),
      de(alphaThreshold)
    )
  ];
  const diversificationPassed = independent && portfolioGain && alphaSignificant;

  const path: LineagePath | null = valuePassed ? "VALUE" : diversificationPassed ? "DIVERSIFICATION" : null;
  const failedNames = [...valueGates, ...diversificationGates].filter((entry) => !entry.passed).map((entry) => entry.reasonCode);
  const decision = gate(
    "LINEAGE_DECISION",
    S,
    path !== null,
    path === "VALUE" ? "VALUE_OVER_LINEAGE" : path === "DIVERSIFICATION" ? "GENUINE_DIVERSIFIER" : "NO_VALUE_NO_DIVERSIFICATION",
    path === "VALUE"
      ? `Mehrwert gegenüber der eigenen Linie ${references.map(describe).join(", ")} nachgewiesen — unabhängig von der Korrelation geprüft.`
      : path === "DIVERSIFICATION"
        ? `Schwächer als die eigene Linie, aber eine eigenständige Strategie, die das Portfolio ${members} nachweisbar verbessert.`
        : `Weder Mehrwert gegenüber der eigenen Linie (${references.map(describe).join(", ") || "keine Referenz"}) noch echte Diversifikation: ${failedNames.join(", ")}.`,
    path ?? "keiner",
    "Mehrwert oder Diversifikation"
  );
  const mark = (entries: GateResult[], decides: boolean) => entries.map((entry) => (decides ? entry : { ...entry, informational: true }));
  return {
    gates: [budget, ...mark(valueGates, path === "VALUE"), ...mark(diversificationGates, path === "DIVERSIFICATION"), decision],
    assessment: {
      gateVersion: gates.version,
      path,
      valuePassed,
      diversificationPassed,
      references,
      existing: input.existing,
      portfolio: {
        members: portfolio.members,
        sharpeWithout: portfolio.without.inSample.sharpe,
        sharpeWith: portfolio.with.inSample.sharpe,
        sharpeDelta,
        discoverySharpeDelta: discoveryDelta,
        validationSharpeDelta: validationDelta,
        drawdownWithout,
        drawdownWith,
        alphaT: alpha.tStat,
        alphaThreshold,
        betas: alpha.betas,
        months: alpha.months,
        informativeMonths: alpha.informativeMonths
      },
      trials: input.trials,
      screeningsThisMonth: input.screeningsThisMonth
    }
  };
}

/**
 * Redundancy under v3: a near-copy (> 0.9) of a strategy *outside* the own
 * lineage stays redundant, exactly as in v1. A near-copy of the own lineage is
 * no longer special — the lineage check measures it like every candidate.
 */
export function lineageRedundancyGate(input: { readonly correlations: readonly { readonly key: string; readonly value: number | null }[]; readonly lineageKeys: readonly string[] }, gates: EvolutionGatesV3): GateResult {
  const near = input.correlations.filter((entry) => entry.value !== null && entry.value > gates.maxCorrelationWithExisting) as { key: string; value: number }[];
  const foreign = near.filter((entry) => !input.lineageKeys.includes(entry.key)).sort((a, b) => b.value - a.value);
  const own = near.filter((entry) => input.lineageKeys.includes(entry.key)).sort((a, b) => b.value - a.value);
  const known = input.correlations.filter((entry) => entry.value !== null) as { key: string; value: number }[];
  const highest = known.length === 0 ? null : [...known].sort((a, b) => b.value - a.value)[0]!;
  if (foreign.length > 0) {
    return gate("REDUNDANCY", "SCREENING", false, "REDUNDANT_WITH_EXISTING", `Fast identisch mit ${nameOf(foreign[0]!.key)} außerhalb der eigenen Linie (Korrelation ${de(foreign[0]!.value)}) — kein eigenständiger Beitrag.`, de(foreign[0]!.value), `≤ ${gates.maxCorrelationWithExisting}`);
  }
  if (own.length > 0) {
    return gate("REDUNDANCY", "SCREENING", true, "NEAR_COPY_OF_OWN_LINEAGE", `Fast-Kopie der eigenen Linie ${nameOf(own[0]!.key)} (Korrelation ${de(own[0]!.value)}) — zulässig nur mit nachgewiesenem Mehrwert in der Linienprüfung.`, de(own[0]!.value), "Linienprüfung");
  }
  return gate("REDUNDANCY", "SCREENING", true, "NOT_REDUNDANT", highest === null ? "Korrelation nicht berechenbar (zu wenige gemeinsame Tage)." : `Höchste Korrelation ${de(highest.value)} mit ${nameOf(highest.key)}.`, highest === null ? null : de(highest.value), `≤ ${gates.maxCorrelationWithExisting}`);
}

/**
 * Holdout guard of a v3 finalist, depending on the path that carried it.
 * The holdout was analysed before, so it is never evidence — it can only stop
 * a candidate that is clearly worse there than its lineage (value path) or
 * that makes the portfolio worse there (diversification path).
 */
export function lineageHoldoutGate(
  input: {
    readonly path: LineagePath;
    readonly candidate: WindowMetrics | null;
    readonly references: readonly { readonly key: string; readonly holdout: WindowMetrics | null }[];
    readonly portfolio: { readonly sharpeWith: number | null; readonly sharpeWithout: number | null } | null;
  },
  gates: EvolutionGatesV3
): GateResult {
  if (input.path === "VALUE") {
    const minimum = gates.lineage.value.minHoldoutSharpeDelta;
    const deltas = input.references.map((reference) => ({ key: reference.key, delta: deltaOf(input.candidate?.sharpe ?? null, reference.holdout?.sharpe ?? null) }));
    const passed = deltas.length > 0 && deltas.every((entry) => entry.delta !== null && entry.delta >= minimum);
    const text = deltas.map((entry) => `${nameOf(entry.key)} ΔSharpe ${de(entry.delta)}`).join("; ");
    return gate(
      "LINEAGE_HOLDOUT_GUARD",
      "FINAL",
      passed,
      passed ? "NOT_WORSE_THAN_LINEAGE_ON_HOLDOUT" : "WORSE_THAN_LINEAGE_ON_HOLDOUT",
      passed
        ? `Im bereits analysierten Holdout nicht schlechter als die eigene Linie (${text}); zählt ausdrücklich nicht als Nachweis.`
        : `Im bereits analysierten Holdout schlechter als die eigene Linie (${text || "nicht berechenbar"}; Untergrenze ${de(minimum)}).`,
      deltas.map((entry) => de(entry.delta)).join("; "),
      de(minimum)
    );
  }
  const minimum = gates.lineage.diversification.minHoldoutPortfolioSharpeDelta;
  const delta = deltaOf(input.portfolio?.sharpeWith ?? null, input.portfolio?.sharpeWithout ?? null);
  const passed = delta !== null && delta >= minimum;
  return gate(
    "PORTFOLIO_HOLDOUT_GUARD",
    "FINAL",
    passed,
    passed ? "PORTFOLIO_NOT_WORSE_ON_HOLDOUT" : "PORTFOLIO_WORSE_ON_HOLDOUT",
    passed
      ? `Im bereits analysierten Holdout macht der Kandidat das Portfolio nicht schlechter (ΔSharpe ${de(delta)}); zählt ausdrücklich nicht als Nachweis.`
      : `Im bereits analysierten Holdout verschlechtert der Kandidat das Portfolio (ΔSharpe ${de(delta)}, Untergrenze ${de(minimum)}).`,
    de(delta),
    de(minimum)
  );
}
