// Deutsche Labels und Formatierung für Trading → Evolution. Enums erscheinen
// nie roh im UI; unbekannte Werte fallen auf den Rohwert zurück, nie auf
// eine erfundene Bedeutung.

import type { EvolutionCandidateStatus } from "./evolution-api";

type Tone = "trading-good" | "trading-warn" | "trading-bad" | "trading-neutral";

export const CANDIDATE_STATUS: Record<EvolutionCandidateStatus, { label: string; tone: Tone }> = {
  GENERATED: { label: "Erzeugt", tone: "trading-neutral" },
  INVALID: { label: "Ungültig", tone: "trading-bad" },
  DUPLICATE: { label: "Bereits getestet", tone: "trading-neutral" },
  TECHNICAL_FAILED: { label: "Technisch gescheitert", tone: "trading-bad" },
  REJECTED: { label: "Verworfen", tone: "trading-bad" },
  RESERVE: { label: "Reserve", tone: "trading-warn" },
  PROPOSED: { label: "Zur Prüfung vorgeschlagen", tone: "trading-good" },
  APPROVED_FOR_FORWARD_TEST: { label: "Für Forward-Test freigegeben", tone: "trading-good" },
  REJECTED_BY_OPERATOR: { label: "Vom Betreiber abgelehnt", tone: "trading-neutral" }
};

export function candidateStatus(status: string): { label: string; tone: Tone } {
  return CANDIDATE_STATUS[status as EvolutionCandidateStatus] ?? { label: status, tone: "trading-neutral" };
}

export const AGENT_STATUS: Record<string, { label: string; tone: Tone; explanation: string }> = {
  ACTIVE: { label: "Aktiv", tone: "trading-good", explanation: "Forschungsdurchläufe laufen nach Zeitplan." },
  PAUSED: { label: "Pausiert", tone: "trading-warn", explanation: "Keine geplanten Durchläufe, bis der Betreiber den Agenten fortsetzt." },
  PAUSED_BUDGET: { label: "Budget-Pause", tone: "trading-warn", explanation: "Das Monatsbudget reicht für keinen weiteren KI-Aufruf; Fortsetzung im nächsten Monat." },
  DISABLED: { label: "Deaktiviert", tone: "trading-bad", explanation: "Der Agent ist abgeschaltet." },
  NOT_INITIALISED: { label: "Nicht eingerichtet", tone: "trading-neutral", explanation: "Der Evolution-Worker ist hier noch nie gelaufen." }
};

export const FAMILY_LABEL: Record<string, string> = {
  BREAKOUT_LONG: "Ausbruch",
  REGIME_LONG: "Regime-Halten"
};

export const GATE_LABEL: Record<string, string> = {
  TECHNICAL: "Technische Tests",
  DATA_INTEGRITY: "Datenintegrität",
  MIN_TRADES: "Stichprobe",
  DISCOVERY_EDGE: "Vorteil Entdeckung",
  VALIDATION_EDGE: "Vorteil Validierung",
  COST_STRESS: "Doppelte Kosten",
  DRAWDOWN: "Drawdown",
  FOLD_STABILITY: "Marktphasen",
  REDUNDANCY: "Eigenständigkeit",
  BENCHMARK: "Gegen Champion",
  PARAMETER_ROBUSTNESS: "Nachbarvarianten",
  WALK_FORWARD: "Walk-Forward",
  HOLDOUT: "Holdout",
  SUCCESSOR_BUDGET: "Nachfolger-Monatslimit",
  SUCCESSOR_IMPROVEMENT: "Nachfolger: deutliche Verbesserung",
  SUCCESSOR_CONSISTENCY: "Nachfolger: beide Zeiträume",
  SUCCESSOR_SIGNIFICANCE: "Nachfolger: gepaarte Signifikanz",
  SUCCESSOR_NO_DETERIORATION: "Nachfolger: keine Verschlechterung",
  SUCCESSOR_HOLDOUT_GUARD: "Nachfolger: Holdout-Schutz",
  LINEAGE_BUDGET: "Familien-Monatslimit",
  VALUE_RISK_ADJUSTED: "Linie: deutlich besser",
  VALUE_CONSISTENCY: "Linie: beide Zeiträume",
  VALUE_SIGNIFICANCE: "Linie: gepaarte Signifikanz",
  VALUE_NO_MATERIAL_DETERIORATION: "Linie: keine wesentliche Verschlechterung",
  DIVERSIFICATION_INDEPENDENCE: "Diversifikation: eigenständig",
  DIVERSIFICATION_PORTFOLIO_GAIN: "Diversifikation: Portfolio besser",
  DIVERSIFICATION_SIGNIFICANCE: "Diversifikation: α signifikant",
  LINEAGE_DECISION: "Mehrwert oder Diversifikation",
  LINEAGE_HOLDOUT_GUARD: "Linie: Holdout-Schutz",
  PORTFOLIO_HOLDOUT_GUARD: "Portfolio: Holdout-Schutz"
};

export const LINEAGE_PATH_LABEL: Record<string, string> = {
  VALUE: "Mehrwert gegenüber der eigenen Linie",
  DIVERSIFICATION: "eigenständige Diversifikation"
};

export const LINEAGE_ROLE_LABEL: Record<string, string> = {
  ROOT: "Wurzel",
  PARENT: "Eltern",
  FAMILY_BEST: "bester Familienvertreter"
};

export const GATES_VERSION_LABEL: Record<string, string> = {
  "evolution-gates-v1": "Gates v1",
  "evolution-gates-v2": "Gates v2 (Nachfolger-Regel)",
  "evolution-gates-v3": "Gates v3 (Linien- und Diversifikationsregel)",
  "evolution-gates-v4": "Gates v4 (Portfolio-Mehrwert)"
};

export const EVIDENCE_LABEL: Record<string, { label: string; tone: Tone }> = {
  STRONG: { label: "stark", tone: "trading-good" },
  MODERATE: { label: "mittel", tone: "trading-good" },
  WEAK: { label: "schwach", tone: "trading-warn" },
  NONE: { label: "keine", tone: "trading-bad" }
};

export const HYPOTHESIS_OUTCOME: Record<string, { label: string; tone: Tone }> = {
  ACCEPTED: { label: "Als Kandidat getestet", tone: "trading-good" },
  INVALID: { label: "Ungültig verworfen", tone: "trading-bad" },
  DUPLICATE: { label: "Bereits getestet", tone: "trading-neutral" },
  LINEAGE_BUDGET_EXHAUSTED: { label: "Familien-Monatslimit erreicht, nicht getestet", tone: "trading-neutral" }
};

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  RUNNING: { label: "Läuft", tone: "trading-warn" },
  COMPLETED: { label: "Abgeschlossen", tone: "trading-good" },
  FAILED: { label: "Fehlgeschlagen", tone: "trading-bad" },
  ABORTED: { label: "Abgebrochen", tone: "trading-warn" }
};

export const WINDOW_LABEL: Record<string, string> = {
  DISCOVERY: "Entdeckung",
  VALIDATION: "Validierung",
  HOLDOUT: "Holdout"
};

export const VISIBILITY_LABEL: Record<string, string> = {
  METRICS: "KI sieht Kennzahlen",
  VERDICT_ONLY: "KI sieht nur das Urteil",
  NEVER: "KI sieht nichts"
};

export const PURPOSE_LABEL: Record<string, string> = {
  SEARCH: "Suche",
  SELECTION: "Auswahl",
  HOLDOUT_CHECK: "Holdout-Prüfung",
  BENCHMARK: "Referenz"
};

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Claude (Anthropic API)",
  mock: "Mock (regelbasiert, ohne API)"
};

const de = (value: number, digits: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

export function fmt(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : de(value, digits);
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${de(value, digits)}`;
}

export function fmtR(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${fmtSigned(value)} R`;
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${de(value, digits)} %`;
}

export function fmtUsd(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${de(value, digits)} USD`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function toneOf(value: number | null | undefined): "good" | "bad" | "neutral" {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "good" : "bad";
}

export const rootLabel = (key: string) => key.replace(/^ROOT:/, "");

export interface LineageNode {
  key: string;
  status: EvolutionCandidateStatus | "ROOT";
  generation: number;
  children: LineageNode[];
}

/** Parent links → trees, one per frozen root; orphans hang under their recorded parent key. */
export function buildLineageTrees(nodes: { key: string; parentKey: string; generation: number; status: EvolutionCandidateStatus }[]): LineageNode[] {
  const byKey = new Map<string, LineageNode>(nodes.map((node) => [node.key, { key: node.key, status: node.status, generation: node.generation, children: [] }]));
  const roots = new Map<string, LineageNode>();
  for (const node of [...nodes].sort((a, b) => a.key.localeCompare(b.key))) {
    const own = byKey.get(node.key)!;
    const parent = byKey.get(node.parentKey);
    if (parent !== undefined) {
      parent.children.push(own);
      continue;
    }
    const root = roots.get(node.parentKey) ?? { key: node.parentKey, status: "ROOT" as const, generation: 0, children: [] };
    root.children.push(own);
    roots.set(node.parentKey, root);
  }
  return [...roots.values()].sort((a, b) => a.key.localeCompare(b.key));
}
