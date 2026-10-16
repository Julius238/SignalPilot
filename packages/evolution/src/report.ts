/**
 * German research reports (markdown) of candidates and cycles.
 *
 * Every report states what the numbers are — a historical simulation with
 * the frozen cost model — and what they are not: a forecast, a forward
 * result or an investment recommendation.
 */

import type { EvidenceGrade, GateResult, ResearchScore } from "./gates.js";
import type { ParameterDiff } from "./genome.js";
import type { LineageAssessment } from "./gates-v3.js";
import type { GateResultV4, IndependentFamilyDecision, NeighbourPortfolioResult } from "./gates-v4.js";
import type { FoldMetrics, WindowMetrics } from "./metrics.js";
import type { PairedMonthlyTest } from "./paired.js";
import type { PortfolioSummaryDigest } from "./portfolio.js";
import type { PortfolioAssessment, PortfolioWindowComparison } from "./portfolio-metrics.js";
import type { WalkForwardResult } from "./walk-forward.js";

const n = (value: number | null | undefined, digits = 2): string => (value === null || value === undefined ? "–" : value.toFixed(digits));
const pct = (value: number | null | undefined, digits = 2): string => (value === null || value === undefined ? "–" : `${value.toFixed(digits)} %`);

export const EVIDENCE_LABEL_DE: Readonly<Record<EvidenceGrade, string>> = Object.freeze({
  STRONG: "stark",
  MODERATE: "mittel",
  WEAK: "schwach",
  NONE: "keine"
});

export const HISTORICAL_DISCLAIMER =
  "Historische Simulation mit eingefrorenem Kostenmodell (BINANCE_SPOT_VIP0_ESTIMATE_V1). Kein Forward-Ergebnis, keine Prognose, keine Handelsempfehlung. Der Holdout 2024–2026 wurde bereits in der Forschung vom 14.10.2026 analysiert und ist kein unberührter Out-of-Sample-Beweis.";

/** Gates v4: what the portfolio path of an independent-family candidate stored (metricsJson.portfolio). */
export interface PortfolioCheckRecord {
  readonly gatesVersion: string;
  readonly gatesHash: string;
  readonly preregistrationHash: string | null;
  readonly researchIdentity: string;
  /** Registered key the replay ran under — technical only, never an attribution. */
  readonly replayHull: string;
  readonly dataFingerprint: string;
  readonly baseline: PortfolioSummaryDigest;
  readonly withCandidate: PortfolioSummaryDigest;
  readonly assessment: PortfolioAssessment;
  readonly decision: IndependentFamilyDecision;
  readonly neighbours: readonly NeighbourPortfolioResult[] | null;
  readonly holdout: PortfolioWindowComparison | null;
}

const WINDOW_DE: Readonly<Record<string, string>> = { IN_SAMPLE: "Entdeckung + Validierung", DISCOVERY: "Entdeckung", VALIDATION: "Validierung", HOLDOUT: "Holdout*" };
const stripRoot = (key: string) => key.replace(/^ROOT:/, "");

function portfolioSection(p: PortfolioCheckRecord): string[] {
  const a = p.assessment;
  const windows = [a.windows.IN_SAMPLE, a.windows.DISCOVERY, a.windows.VALIDATION, ...(p.holdout === null ? [] : [p.holdout])];
  const members = (digest: PortfolioSummaryDigest) => new Map(digest.members.map((member) => [member.key, member] as const));
  const inA = members(p.baseline);
  const inB = members(p.withCandidate);
  return [
    "## Portfolio-Prüfung (Gates v4)",
    "",
    `Forschungsidentität **${p.researchIdentity}** (Vorregistrierung ${p.preregistrationHash === null ? "–" : `\`${p.preregistrationHash.slice(0, 12)}…\``}). Die Replay-Hülle ${p.replayHull} ist nur technisch (Registry, R-005): Ihr Evaluator wird nie aufgerufen, ihr Regime-Exit ist abgeschaltet, kein Trade wird ihr zugeordnet, und sie ist keine Forward-Freigabe.`,
    "",
    `Chronologische Simulation ${p.withCandidate.engineVersion} mit Gruppenprüfung ${p.withCandidate.groupRiskVersion ?? "–"}, ein Portfolio je Strategie mit BTCUSDT und ETHUSDT, feste Plätze à ${n(p.withCandidate.members[0]?.startingCash ?? null, 0)} USDT, Gesamtkapital ${n(a.totalCapital, 0)} USDT in beiden Vergleichen. Vergleich A: ${a.existingKeys.map(stripRoot).join(", ")} und ein Reserveplatz als Kasse. Vergleich B: der Kandidat auf dem Reserveplatz. Andere Gewichte werden nie gerechnet.`,
    "",
    "| Fenster | Netto A | Netto B | Δ | Sharpe A | Sharpe B | Δ | Max. DD A | Max. DD B |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...windows.map(
      (w) =>
        `| ${WINDOW_DE[w.key] ?? w.key} | ${pct(w.baseline.netReturnPct)} | ${pct(w.withCandidate.netReturnPct)} | ${n(w.netReturnDelta)} | ${n(w.baseline.sharpe)} | ${n(w.withCandidate.sharpe)} | ${n(w.sharpeDelta)} | ${pct(w.baseline.maxDrawdownPct)} | ${pct(w.withCandidate.maxDrawdownPct)} |`
    ),
    "",
    "| Portfolio | Trades A | Trades B | Netto A (USDT) | Netto B (USDT) | Kill-Switch A / B | Gruppenablehnungen B |",
    "|---|---:|---:|---:|---:|---|---:|",
    ...p.withCandidate.members.map((member) => {
      const before = inA.get(member.key);
      return `| ${stripRoot(member.key)}${member.replayHull === null ? "" : ` (${member.strategyKey})`} | ${before?.trades ?? "–"} | ${member.trades} | ${n(before?.netPnl ?? null)} | ${n(member.netPnl)} | ${before?.killSwitchEngagements ?? "–"} / ${inB.get(member.key)?.killSwitchEngagements ?? "–"} | ${member.groupRejected} |`;
    }),
    "",
    `Gleichzeitiges Risiko Ø ${n(a.openRisk.baselineAverage, 3)} % → ${n(a.openRisk.withCandidateAverage, 3)} %, Kapitalbindung Ø ${n(a.capitalBound.baselineAverage, 3)} % → ${n(a.capitalBound.withCandidateAverage, 3)} % des Gesamtkapitals. Die Verlustserien-Regel (R-021) wirkt je Portfolio über BTC und ETH zusammen, in A und B gleich.`,
    "",
    `Eigenes α gegenüber ${a.existingKeys.map(stripRoot).join(", ")}: t = ${n(a.alpha.tStat)} (Schwelle ${n(p.decision.alphaThreshold)}), ${a.alpha.months} Monate, R² ${n(a.rSquared)}, β ${(a.alpha.betas ?? []).map((beta) => n(beta)).join("/") || "–"}. Zuwachs des Gesamtportfolios: t = ${n(a.incrementTest.tStat)} (Schwelle ${n(p.decision.incrementThreshold)}). Mehrfachtest N = ${p.decision.trials}.`,
    "",
    ...(p.neighbours === null ? [] : [`Nachbarvarianten im Portfolio (Δ Netto / Δ Sharpe): ${p.neighbours.map((entry) => `${entry.key} ${n(entry.netReturnDelta)}/${n(entry.sharpeDelta)}`).join(", ") || "–"}.`, ""]),
    p.decision.passed
      ? "**Portfolio-Entscheidung: bestanden** — das Gesamtportfolio wird bei gleichem Kapital, nach Kosten und unter unveränderten Risk-Regeln besser, mit eigenem, belastbarem Ertrag."
      : `**Portfolio-Entscheidung: nicht bestanden** (${p.decision.failed.join(", ")}). Kein nachgewiesener zusätzlicher Portfolio-Nutzen.`,
    "",
    `Entschieden nach ${p.gatesVersion} (\`${p.gatesHash.slice(0, 12)}…\`), Datenstand \`${p.dataFingerprint.slice(0, 12)}…\`.`,
    ""
  ];
}

export function metricsTable(columns: readonly { readonly label: string; readonly metrics: WindowMetrics | null }[]): string {
  const rows: [string, (metrics: WindowMetrics) => string][] = [
    ["Trades", (m) => String(m.trades)],
    ["Trefferquote", (m) => pct(m.winRatePct, 1)],
    ["Profit Factor", (m) => n(m.profitFactor)],
    ["Ø R je Trade", (m) => n(m.averageR)],
    ["Erwartungswert je Trade (USDT)", (m) => n(m.expectancy)],
    ["Nettorendite", (m) => pct(m.netReturnPct)],
    ["Rendite p. a.", (m) => pct(m.annualizedReturnPct)],
    ["Max. Drawdown", (m) => pct(m.maxDrawdownPct)],
    ["Sharpe", (m) => n(m.sharpe)],
    ["Sortino", (m) => n(m.sortino)],
    ["Calmar", (m) => n(m.calmar)],
    ["Marktexposition", (m) => pct(m.exposurePct, 1)],
    ["Ø Haltedauer (h)", (m) => n(m.averageHoldHours, 1)],
    ["Kosten / Bruttogewinn", (m) => pct(m.costShareOfGrossProfitPct, 1)],
    ["Ø R bei 2× Kosten", (m) => n(m.stressed.averageR)],
    ["Buy & Hold", (m) => pct(m.buyAndHoldReturnPct)],
    ["Buy & Hold Drawdown", (m) => pct(m.buyAndHoldMaxDrawdownPct)]
  ];
  const header = `| Kennzahl | ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `|---|${columns.map(() => "---:").join("|")}|`;
  const body = rows.map(([label, value]) => `| ${label} | ${columns.map((column) => (column.metrics === null ? "–" : value(column.metrics))).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export function renderCandidateReport(input: {
  readonly candidateKey: string;
  readonly versionLabel: string;
  readonly lineage: readonly string[];
  readonly hypothesis: { readonly title: string; readonly marketObservation: string; readonly rationale: string; readonly expectedEffect: string; readonly falsificationCriterion: string };
  readonly changes: readonly ParameterDiff[];
  readonly status: string;
  readonly windowsSeen: readonly string[];
  readonly discovery: WindowMetrics | null;
  readonly validation: WindowMetrics | null;
  readonly holdout: WindowMetrics | null;
  readonly champion: WindowMetrics | null;
  readonly challenger: WindowMetrics | null;
  readonly folds: readonly FoldMetrics[];
  readonly gates: readonly (GateResult | GateResultV4)[];
  readonly score: ResearchScore | null;
  readonly evidence: { readonly grade: EvidenceGrade; readonly threshold: number; readonly trials: number; readonly tStat: number | null } | null;
  readonly walkForward: WalkForwardResult | null;
  readonly correlations: readonly { readonly key: string; readonly value: number | null }[];
  /** Gates v2: present when the candidate went through the successor rule. */
  readonly successor?: {
    readonly rootKey: string;
    readonly correlation: number | null;
    readonly candidateSharpe: number | null;
    readonly referenceSharpe: number | null;
    readonly paired: PairedMonthlyTest;
    readonly threshold: number;
    readonly trials: number;
  } | null;
  /** Gates v3: lineage and diversification assessment. */
  readonly lineageCheck?: LineageAssessment | null;
  /** Gates v4: the portfolio path of an independent family. */
  readonly portfolioCheck?: PortfolioCheckRecord | null;
  readonly gateVersion?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# Forschungsbericht ${input.candidateKey}`, "");
  lines.push(`**${input.versionLabel}** · Status: **${input.status}**`, "");
  lines.push(`Abstammung: ${input.lineage.join(" → ")}`, "");
  lines.push(`> ${HISTORICAL_DISCLAIMER}`, "");
  lines.push("## Hypothese", "", `**${input.hypothesis.title}**`, "");
  lines.push(`- Beobachtung: ${input.hypothesis.marketObservation}`);
  lines.push(`- Begründung: ${input.hypothesis.rationale}`);
  lines.push(`- Erwartete Wirkung: ${input.hypothesis.expectedEffect}`);
  lines.push(`- Scheitert, wenn: ${input.hypothesis.falsificationCriterion}`, "");
  lines.push("## Geänderte Parameter", "");
  lines.push(...(input.changes.length === 0 ? ["Keine."] : input.changes.map((change) => `- \`${change.parameter}\`: ${String(change.from ?? "–")} → ${String(change.to)}`)), "");
  lines.push("## Gesehene Daten", "", input.windowsSeen.length === 0 ? "Keine." : input.windowsSeen.map((window) => `- ${window}`).join("\n"), "");
  lines.push("## Ergebnisse (BTC + ETH, je 10 000 USDT)", "");
  lines.push(
    metricsTable([
      { label: "Entdeckung", metrics: input.discovery },
      { label: "Validierung", metrics: input.validation },
      { label: "Holdout*", metrics: input.holdout },
      { label: "Champion (E+V)", metrics: input.champion },
      { label: "Challenger (E+V)", metrics: input.challenger }
    ]),
    "",
    "\\* bereits analysiert, kein unberührter Out-of-Sample-Beweis.",
    ""
  );
  if (input.folds.length > 0) {
    lines.push("## Walk-Forward-Segmente", "", "| Segment | Fenster | Trades | Ø R | PF | Netto (USDT) |", "|---|---|---:|---:|---:|---:|");
    for (const fold of input.folds) lines.push(`| ${fold.key} | ${fold.window} | ${fold.trades} | ${n(fold.averageR)} | ${n(fold.profitFactor)} | ${n(fold.netPnl)} |`);
    lines.push("");
  }
  if (input.walkForward !== null) {
    lines.push(
      "## Rollierender Walk-Forward",
      "",
      `Außerhalb der Stichprobe Ø ${n(input.walkForward.outOfSampleAverageR)}R über ${input.walkForward.outOfSampleTrades} Trades, in der Stichprobe Ø ${n(input.walkForward.inSampleAverageR)}R, Effizienz ${n(input.walkForward.efficiency)}; der Kandidat selbst wurde in ${pct((input.walkForward.candidateSelectedShare ?? 0) * 100, 0)} der Schritte gewählt.`,
      ""
    );
  }
  if (input.correlations.length > 0) {
    lines.push("## Korrelation zu bestehenden Strategien", "", ...input.correlations.map((entry) => `- ${entry.key}: ${n(entry.value)}`), "");
  }
  if (input.successor) {
    const s = input.successor;
    lines.push(
      "## Nachfolger-Prüfung (Gates v2)",
      "",
      `Fast-Kopie der eigenen Wurzel ${s.rootKey.replace(/^ROOT:/, "")} (Korrelation ${n(s.correlation)}). Sharpe Entdeckung + Validierung ${n(s.candidateSharpe)} gegenüber ${n(s.referenceSharpe)}.`,
      "",
      `Gepaarter Monatsvergleich: ${s.paired.months} Monate (${s.paired.informativeMonths} mit Unterschied), Ø Differenz ${n(s.paired.meanDifference === null ? null : s.paired.meanDifference * 100, 3)} %-Punkte je Monat, t = ${n(s.paired.tStat)} mit Newey–West-Standardfehler (Lag ${s.paired.lag ?? "–"}; ohne Korrektur t = ${n(s.paired.naiveTStat)}), Schwelle ${n(s.threshold)} bei N = ${s.trials} geprüften Konfigurationen.`,
      ""
    );
  }
  if (input.lineageCheck) {
    const l = input.lineageCheck;
    const roles: Record<string, string> = { ROOT: "Wurzel", PARENT: "Eltern", FAMILY_BEST: "bester Familienvertreter" };
    lines.push(
      "## Linienprüfung (Gates v3)",
      "",
      l.path === "VALUE"
        ? "Bestanden als **Mehrwert gegenüber der eigenen Linie** — unabhängig von der Korrelation geprüft."
        : l.path === "DIVERSIFICATION"
          ? "Bestanden als **eigenständige Diversifikation**: schwächer als die eigene Linie, verbessert aber das Portfolio nachweisbar."
          : "**Weder Mehrwert gegenüber der eigenen Linie noch echte Diversifikation.**",
      "",
      "| Referenz | Rolle | Sharpe Referenz | Sharpe Kandidat | Δ | Δ Entdeckung / Validierung | gepaart t (Schwelle) | wesentlich schlechter in |",
      "|---|---|---:|---:|---:|---|---|---|",
      ...l.references.map(
        (entry) =>
          `| ${entry.key.replace(/^ROOT:/, "")} | ${entry.roles.map((role) => roles[role] ?? role).join(", ")} | ${n(entry.referenceSharpe)} | ${n(entry.candidateSharpe)} | ${n(entry.sharpeDelta)} | ${n(entry.discoverySharpeDelta)} / ${n(entry.validationSharpeDelta)} | ${n(entry.pairedT)} (${n(entry.threshold)}) | ${entry.deteriorations.join(", ").replace(/\|/g, "/") || "–"} |`
      ),
      "",
      `Unabhängigkeit: ${l.existing.map((entry) => `${entry.key.replace(/^ROOT:/, "")} Korrelation ${n(entry.correlation)}, bespielte Einstiege ${entry.signalOverlap === null ? "–" : pct(entry.signalOverlap * 100, 0)}`).join("; ") || "–"}.`,
      "",
      `Portfolio ${l.portfolio.members.map((key) => key.replace(/^ROOT:/, "")).join(" + ") || "–"}: Sharpe mit Kandidat ${n(l.portfolio.sharpeWith)} gegenüber ${n(l.portfolio.sharpeWithout)} (Δ ${n(l.portfolio.sharpeDelta)}; Entdeckung ${n(l.portfolio.discoverySharpeDelta)}, Validierung ${n(l.portfolio.validationSharpeDelta)}), max. Drawdown ${n(l.portfolio.drawdownWith)} % gegenüber ${n(l.portfolio.drawdownWithout)} %; α gegenüber den bestehenden Strategien t = ${n(l.portfolio.alphaT)} (Schwelle ${n(l.portfolio.alphaThreshold)}, β ${(l.portfolio.betas ?? []).map((value) => n(value)).join("/") || "–"}, ${l.portfolio.months} Monate).`,
      "",
      `Mehrfachtest-Zähler N = ${l.trials}; Prüfung ${l.screeningsThisMonth} dieser Familie im laufenden Monat.`,
      ""
    );
  }
  if (input.portfolioCheck) lines.push(...portfolioSection(input.portfolioCheck));
  if (input.gateVersion) lines.push(`Entschieden nach ${input.gateVersion}.`, "");
  lines.push("## Prüfungen", "", "| Prüfung | Stufe | Ergebnis | Begründung |", "|---|---|---|---|");
  for (const gate of input.gates) lines.push(`| ${gate.gate} | ${gate.stage} | ${gate.passed ? "bestanden" : gate.informational === true ? "nicht bestanden (informativ)" : "**nicht bestanden**"} | ${gate.message.replace(/\|/g, "/")} |`);
  lines.push("");
  if (input.score !== null) lines.push(`Forschungs-Score: **${n(input.score.score, 1)}** / 100 (neutral 50, Komplexitätsabzug ${n(input.score.complexityPenalty, 0)}).`, "");
  if (input.evidence !== null) {
    lines.push(
      `Evidenz nach Mehrfachtest-Korrektur: **${EVIDENCE_LABEL_DE[input.evidence.grade]}** (t = ${n(input.evidence.tStat)}, Schwelle √(2·ln N) = ${n(input.evidence.threshold)} bei N = ${input.evidence.trials} getesteten Konfigurationen).`,
      ""
    );
  }
  lines.push("## Einordnung", "", "Ein bestandener historischer Test beweist keine künftige Profitabilität. Über die Leistung entscheidet erst ein eigener Shadow-Forward-Test nach Freigabe durch den Betreiber; die Arena bewertet ihn unabhängig.");
  return lines.join("\n");
}

export function renderRunReport(input: {
  readonly runKey: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly provider: string;
  readonly models: readonly string[];
  readonly dataManifest: Readonly<Record<string, unknown>>;
  readonly findings: readonly string[];
  readonly aiSummary: string | null;
  readonly candidates: readonly { readonly key: string; readonly title: string; readonly status: string; readonly score: number | null; readonly reason: string }[];
  readonly cost: { readonly inputTokens: number; readonly outputTokens: number; readonly usd: number; readonly billable: boolean };
  readonly review: { readonly summary: string; readonly warnings: readonly string[]; readonly nextSteps: readonly string[] } | null;
}): string {
  const lines: string[] = [];
  lines.push(`# Forschungsdurchlauf ${input.runKey}`, "");
  lines.push(`Start ${input.startedAt}${input.finishedAt === null ? "" : `, Ende ${input.finishedAt}`} · KI-Anbieter ${input.provider} (${input.models.join(", ") || "–"})`, "");
  lines.push(`> ${HISTORICAL_DISCLAIMER}`, "");
  lines.push("## Datenbasis", "", "```json", JSON.stringify(input.dataManifest, null, 2), "```", "");
  lines.push("## Marktbedingungen (nur Entdeckungsdaten)", "", ...(input.findings.length === 0 ? ["Keine auffälligen Unterschiede zwischen Bedingungen."] : input.findings.map((finding) => `- ${finding}`)), "");
  if (input.aiSummary) lines.push("## Einschätzung der Hypothesen-KI", "", input.aiSummary, "");
  lines.push("## Kandidaten", "", "| Kandidat | Hypothese | Status | Score | Begründung |", "|---|---|---|---:|---|");
  for (const candidate of input.candidates) {
    lines.push(`| ${candidate.key} | ${candidate.title.replace(/\|/g, "/")} | ${candidate.status} | ${n(candidate.score, 1)} | ${candidate.reason.replace(/\|/g, "/")} |`);
  }
  lines.push("");
  lines.push("## KI-Kosten", "", `${input.cost.inputTokens} Eingabe- und ${input.cost.outputTokens} Ausgabe-Tokens, ${input.cost.billable ? `${input.cost.usd.toFixed(4)} USD` : `simuliert (${input.cost.usd.toFixed(4)} USD zu Listenpreis, nicht abgerechnet)`}.`, "");
  if (input.review !== null) {
    lines.push("## Zusammenfassung", "", input.review.summary, "");
    if (input.review.warnings.length > 0) lines.push("Warnungen:", ...input.review.warnings.map((warning) => `- ${warning}`), "");
    if (input.review.nextSteps.length > 0) lines.push("Nächste Schritte:", ...input.review.nextSteps.map((step) => `- ${step}`), "");
  }
  return lines.join("\n");
}
