/**
 * The research context an AI provider receives — built only from data its
 * window visibility allows (split.ts):
 *
 * - DISCOVERY: metrics, trades by market condition, segment summaries;
 * - VALIDATION: only the screening verdict (passed / failed and which gate),
 *   never a number, so the search cannot fit the validation period;
 * - HOLDOUT and FORWARD: nothing. Final-stage outcomes are not reported
 *   either, because "proposed" would reveal that a candidate passed the
 *   holdout.
 *
 * `assertContextLeakFree` re-checks the finished context before any call.
 */

import type { MarketAnalysis } from "./analysis.js";
import { EVOLUTION_ROOTS, FAMILY_SPECS, type EvolutionFamily, type ParameterDiff, type ParameterValue } from "./genome.js";
import type { WindowMetrics } from "./metrics.js";
import type { EvolutionDataSplit } from "./split.js";

export interface DiscoverySnapshot {
  readonly trades: number;
  readonly averageR: number | null;
  readonly profitFactor: number | null;
  readonly winRatePct: number | null;
  readonly netReturnPct: number | null;
  readonly sharpe: number | null;
  readonly maxDrawdownPct: number | null;
  readonly stressedAverageR: number | null;
  readonly exposurePct: number | null;
  readonly tradesPerSymbol: Readonly<Record<string, number>>;
}

export type ScreeningVerdict = "PASSED_SCREENING" | "FAILED_SCREENING" | "NOT_EVALUATED";

export interface HistoryEntry {
  readonly candidateKey: string;
  readonly family: EvolutionFamily;
  readonly parentKey: string;
  readonly generation: number;
  readonly hypothesis: string;
  readonly changes: readonly ParameterDiff[];
  /** Full genome, so a later hypothesis can build on it. */
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly verdict: ScreeningVerdict;
  /** Reason codes of failed SCREENING gates only. */
  readonly failedGates: readonly string[];
  readonly discovery: DiscoverySnapshot | null;
  /** The operator's decision on a proposed candidate; an operator-rejected candidate is no parent. */
  readonly operatorDecision?: "APPROVED_FOR_FORWARD_TEST" | "REJECTED_BY_OPERATOR";
}

export interface ResearchContext {
  readonly contextVersion: string;
  readonly splitKey: string;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly families: readonly {
    readonly family: EvolutionFamily;
    readonly label: string;
    readonly description: string;
    readonly parameters: readonly { readonly name: string; readonly kind: string; readonly description: string; readonly values: string }[];
  }[];
  readonly roots: readonly { readonly key: string; readonly label: string; readonly family: EvolutionFamily; readonly parameters: Readonly<Record<string, ParameterValue>> }[];
  readonly benchmarks: readonly { readonly key: string; readonly label: string; readonly discovery: DiscoverySnapshot }[];
  readonly market: {
    readonly segments: MarketAnalysis["segments"];
    readonly findings: readonly string[];
    readonly buckets: MarketAnalysis["buckets"];
  };
  readonly history: readonly HistoryEntry[];
  readonly allowedParents: readonly string[];
  readonly request: { readonly hypotheses: number; readonly maxChangesPerHypothesis: number };
}

export const RESEARCH_CONTEXT_VERSION = "evolution-context-v2";

export function discoverySnapshot(metrics: WindowMetrics): DiscoverySnapshot {
  return {
    trades: metrics.trades,
    averageR: metrics.averageR,
    profitFactor: metrics.profitFactor,
    winRatePct: metrics.winRatePct,
    netReturnPct: metrics.netReturnPct,
    sharpe: metrics.sharpe,
    maxDrawdownPct: metrics.maxDrawdownPct,
    stressedAverageR: metrics.stressed.averageR,
    exposurePct: metrics.exposurePct,
    tradesPerSymbol: Object.fromEntries(Object.entries(metrics.perSymbol).map(([symbol, entry]) => [symbol, entry.trades]))
  };
}

const describeValues = (spec: (typeof FAMILY_SPECS)[EvolutionFamily]["parameters"][number]): string => {
  if (spec.kind === "boolean") return "true | false";
  if (spec.allowed !== undefined) return spec.allowed.join(" | ");
  return `${spec.min} … ${spec.max}, Schritt ${spec.step}`;
};

export function buildResearchContext(input: {
  readonly split: EvolutionDataSplit;
  readonly benchmarks: readonly { readonly key: string; readonly label: string; readonly discovery: WindowMetrics }[];
  readonly analysis: MarketAnalysis;
  readonly history: readonly HistoryEntry[];
  readonly hypotheses: number;
  readonly maxChangesPerHypothesis?: number;
  /** Gates v2: refinements of the own root are allowed under the successor rule. */
  readonly successorRule?: boolean;
  /** Gates v3: every candidate is measured against its lineage; remaining screenings per family this month. */
  readonly lineageRule?: { readonly remainingScreenings: Readonly<Record<string, number>> };
}): ResearchContext {
  return {
    contextVersion: RESEARCH_CONTEXT_VERSION,
    splitKey: input.split.key,
    objective:
      "Langfristig möglichst hohe risikobereinigte Nettorendite nach allen Handelskosten (Gebühren, Spread, Slippage) für BTCUSDT und ETHUSDT Spot, Long-only, 1h-Entscheidungen. Robuste, über Marktphasen stabile Ergebnisse haben Vorrang vor hohen Einzelwerten.",
    constraints: [
      "Nur die aufgeführten Parameter der beiden Familien sind veränderbar; Kosten, Ausführung, Positionsgröße (0,25 % Risiko je Trade), Risk Engine und Datenzeiträume sind fest.",
      "Kein Hebel, keine Leerverkäufe, keine Derivate, keine zukünftigen Daten.",
      "Jede Hypothese ändert höchstens die angegebene Zahl von Parametern gegenüber genau einer Elternstrategie aus allowedParents.",
      "Bereits getestete Genome werden verworfen; wiederhole keine Kombination aus history.",
      "Bewertet wird zuerst auf Entdeckungsdaten, dann auf getrennten Validierungsdaten (nur das Urteil wird zurückgemeldet), danach auf weiteren nie gezeigten Daten.",
      "Wenige, ökonomisch begründete Änderungen sind besser als viele feine Anpassungen: jede zusätzliche Änderung erhöht das Risiko der Überanpassung.",
      ...(input.successorRule === true
        ? [
            "Verfeinerungen der eigenen Wurzel (fast gleiche Tagesrenditen) sind zulässig, werden aber nur akzeptiert, wenn sie die Wurzel risikobereinigt deutlich, in beiden Zeiträumen und statistisch belastbar übertreffen, ohne irgendwo schlechter zu werden; die Zahl solcher Versuche je Wurzel ist monatlich begrenzt. Kleine Kosmetik an einer Wurzel scheitert."
          ]
        : []),
      ...(input.lineageRule !== undefined
        ? [
            "Jeder Kandidat wird unabhängig von seiner Korrelation mit seiner eingefrorenen Wurzel, seiner Elternstrategie und dem besten bestehenden Vertreter seiner Familie verglichen. Er besteht nur, wenn er jede dieser Referenzen risikobereinigt deutlich, in beiden Zeiträumen und statistisch belastbar übertrifft, ohne in Profit Factor, Drawdown, Kosten, Marktphasen, Kapitalbindung oder Validierung wesentlich schlechter zu werden. Eine geringere Korrelation allein hilft nicht.",
            "Alternativ kann eine wirklich eigenständige Strategie bestehen: Korrelation höchstens 0,5 mit jeder bestehenden Strategie und höchstens 50 % ihrer Einstiege dort, wo eine bestehende Strategie binnen ±24 h selbst einsteigt oder schon eine Position hält; ein Portfolio der bestehenden Strategien wird mit ihr in beiden Zeiträumen besser, und ihr Ertrag lässt sich statistisch belastbar durch keine Kombination der bestehenden Strategien erklären. Eine Parametervariante mit nur anderen Ausstiegen oder Haltedauern behält ihre Einstiege und gilt nicht als eigenständig.",
            `Verbleibende Prüfungen in diesem Monat: ${Object.entries(input.lineageRule.remainingScreenings)
              .map(([family, remaining]) => `${family} ${remaining}`)
              .join(", ")}. Hypothesen einer Familie ohne verbleibende Prüfungen werden ohne Test verworfen.`
          ]
        : [])
    ],
    families: Object.values(FAMILY_SPECS).map((spec) => ({
      family: spec.family,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters.map((parameter) => ({
        name: parameter.name,
        kind: parameter.kind,
        description: parameter.description,
        values: describeValues(parameter)
      }))
    })),
    roots: EVOLUTION_ROOTS.map((root) => ({ key: root.key, label: root.label, family: root.genome.family, parameters: root.genome.parameters })),
    benchmarks: input.benchmarks.map((benchmark) => ({ key: benchmark.key, label: benchmark.label, discovery: discoverySnapshot(benchmark.discovery) })),
    market: {
      segments: input.analysis.segments,
      findings: input.analysis.findings.map((finding) => finding.sentence),
      buckets: input.analysis.buckets.filter((bucket) => bucket.trades >= 3)
    },
    history: input.history,
    allowedParents: [
      ...EVOLUTION_ROOTS.map((root) => root.key),
      ...input.history.filter((entry) => entry.verdict === "PASSED_SCREENING" && entry.operatorDecision !== "REJECTED_BY_OPERATOR").map((entry) => entry.candidateKey)
    ],
    request: { hypotheses: input.hypotheses, maxChangesPerHypothesis: input.maxChangesPerHypothesis ?? 3 }
  };
}

const FORBIDDEN_KEYS = /^(holdout|forward|validationMetrics|testMetrics|holdoutMetrics|finalGates)$/i;
const ISO_DAY = /\b(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z)?\b/g;

/**
 * Throws if the context contains anything beyond its visibility: a forbidden
 * key, or any calendar date after the discovery window.
 */
export function assertContextLeakFree(context: unknown, split: EvolutionDataSplit): void {
  const lastAllowedDay = split.windows.DISCOVERY.to.slice(0, 10);
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(ISO_DAY)) {
        if (match[1]! > lastAllowedDay) throw new Error(`Research context leaks a date after discovery (${match[1]}) at ${path}.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.test(key)) throw new Error(`Research context contains forbidden key ${key} at ${path}.`);
        visit(entry, `${path}.${key}`);
      }
    }
  };
  visit(context, "$");
}
