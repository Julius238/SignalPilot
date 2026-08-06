// Alle Scores in SignalPilot liegen auf 0–100. Die Schwellen hier spiegeln bewusst die
// Werte der erzeugenden Pakete, damit Dashboard und Engine dasselbe "hoch" meinen:
// - packages/news-intelligence: relevanceScore >= 70 gilt dort als hohe Relevanz
// - packages/scoring-engine (determineRiskLevel): Risiko HIGH ab 70, MEDIUM ab 45

export const SCORE_SCALE_MAX = 100;

/** News-Relevanz, ab der ein Signal als stark nachrichtengetrieben gilt. */
export const NEWS_HIGH_RELEVANCE = 70;

/** Risiko-Schwellen, identisch zu `determineRiskLevel` in packages/scoring-engine. */
export const RISK_HIGH = 70;
export const RISK_MEDIUM = 45;

/** Chancen-Schwellen für die Einfärbung von "je höher, desto besser"-Faktoren. */
export const BENEFIT_STRONG = 70;
export const BENEFIT_MEDIUM = 40;

/**
 * In welche Richtung ein hoher Wert zu lesen ist.
 * "benefit" = hoch ist günstig · "risk" = hoch ist ungünstig.
 * Ohne diese Unterscheidung sähe ein hoher Risiko-Score aus wie ein guter Wert.
 */
export type ScoreFactorPolarity = "benefit" | "risk";

/** Anteil der Skala 0–100, auf [0,100] geklemmt. Nicht berechenbare Werte füllen nichts. */
export function scoreBarPercent(val: number | null | undefined): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return 0;
  return Math.min(100, Math.max(0, (val / SCORE_SCALE_MAX) * 100));
}

export function scoreBarColor(
  val: number | null | undefined,
  polarity: ScoreFactorPolarity = "benefit"
): string {
  if (typeof val !== "number" || !Number.isFinite(val)) return "var(--line)";

  if (polarity === "risk") {
    if (val >= RISK_HIGH) return "var(--bad)";
    if (val >= RISK_MEDIUM) return "var(--warn)";
    return "var(--good)";
  }

  if (val >= BENEFIT_STRONG) return "var(--good)";
  if (val >= BENEFIT_MEDIUM) return "var(--accent)";
  return "var(--bad)";
}

/** Klartext neben dem Balken — der Wert allein sagt nicht, ob hoch gut oder schlecht ist. */
export function scoreBarMeaning(
  val: number | null | undefined,
  polarity: ScoreFactorPolarity = "benefit"
): string {
  if (typeof val !== "number" || !Number.isFinite(val)) return "nicht berechenbar";

  if (polarity === "risk") {
    if (val >= RISK_HIGH) return "hohes Risiko";
    if (val >= RISK_MEDIUM) return "mittleres Risiko";
    return "niedriges Risiko";
  }

  if (val >= BENEFIT_STRONG) return "stark";
  if (val >= BENEFIT_MEDIUM) return "mittel";
  return "schwach";
}
