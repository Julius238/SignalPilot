import type { MarketEvent, RadarEvent } from "../../lib/signalpilot-api";

// Gemeinsamer Verständlichkeits-Layer für alle Command-Center-Sektionen.
// Grundsatz: technische Enums erscheinen nirgendwo roh im UI — jede Einstufung
// hat ein menschliches Label, wichtige Konzepte zusätzlich einen Erklärsatz.
// Beobachtungs-/Research-Sprache, keine Handlungsempfehlungen.

export type Severity = RadarEvent["severity"];

export type SeverityTone = "critical" | "important" | "watch" | "info";

export function severityTone(severity: Severity | undefined): SeverityTone {
  if (severity === "CRITICAL") return "critical";
  if (severity === "IMPORTANT") return "important";
  if (severity === "WATCH") return "watch";
  return "info";
}

export function severityColor(severity: Severity | undefined): string | undefined {
  if (severity === "CRITICAL") return "var(--sev-critical)";
  if (severity === "IMPORTANT") return "var(--sev-important)";
  if (severity === "WATCH") return "var(--sev-watch)";
  return undefined;
}

export function severityLabel(severity: Severity | undefined): string {
  if (severity === "CRITICAL") return "Sofort ansehen";
  if (severity === "IMPORTANT") return "Wichtig";
  if (severity === "WATCH") return "Beobachten";
  return "Information";
}

export function severityRank(severity: Severity | undefined): number {
  if (severity === "CRITICAL") return 4;
  if (severity === "IMPORTANT") return 3;
  if (severity === "WATCH") return 2;
  return 1;
}

export function radarEventTypeLabel(
  eventType: RadarEvent["eventType"] | string | undefined
): string {
  if (eventType === "MOVEMENT_SPIKE") return "Auffällige Kursbewegung";
  if (eventType === "VOLUME_SPIKE") return "Ungewöhnlich viel Handel";
  if (eventType === "VOLATILITY_SPIKE") return "Erhöhte Schwankung";
  if (eventType === "SCORE_CHANGE") return "Neubewertung";
  if (eventType === "REGIME_CHANGE") return "Marktumfeld dreht";
  if (eventType === "BREAKOUT_PROXIMITY") return "Nähe Ausbruchszone";
  if (eventType === "SR_PROXIMITY") return "Wichtige Kurszone erreicht";
  if (eventType === "MOMENTUM_SHIFT") return "Tempo wechselt";
  if (eventType === "CONFLUENCE") return "Mehrere Faktoren gleichzeitig";
  return "Beobachtung";
}

// Ein Satz, der erklärt, was die Beobachtung bedeutet — für Nutzer ohne
// Chart-Vorwissen. Bewusst neutral formuliert (keine Handlungsempfehlung).
export function radarEventExplanation(
  eventType: RadarEvent["eventType"] | string | undefined
): string {
  if (eventType === "MOVEMENT_SPIKE")
    return "Der Kurs hat sich deutlich schneller bewegt als zuletzt üblich.";
  if (eventType === "VOLUME_SPIKE")
    return "Es wird gerade deutlich mehr gehandelt als normal — oft ein Zeichen für erhöhtes Interesse.";
  if (eventType === "VOLATILITY_SPIKE")
    return "Die Kursschwankungen sind größer als gewohnt.";
  if (eventType === "SCORE_CHANGE")
    return "Das System bewertet die Lage dieses Assets jetzt spürbar anders als zuvor.";
  if (eventType === "REGIME_CHANGE")
    return "Das übergeordnete Marktumfeld hat sich verändert.";
  if (eventType === "BREAKOUT_PROXIMITY")
    return "Der Kurs nähert sich dem Rand seiner jüngsten Spanne — dort entscheidet sich oft die weitere Richtung.";
  if (eventType === "SR_PROXIMITY")
    return "Der Kurs ist nahe einem Bereich, an dem er in der Vergangenheit öfter gedreht hat.";
  if (eventType === "MOMENTUM_SHIFT")
    return "Die Bewegungsdynamik wechselt gerade die Richtung.";
  if (eventType === "CONFLUENCE")
    return "Mehrere unabhängige Beobachtungen treffen im selben Kursbereich zusammen.";
  return "Das System hat hier etwas Ungewöhnliches registriert.";
}

export const chartPatternEventTypes: Array<RadarEvent["eventType"]> = [
  "BREAKOUT_PROXIMITY",
  "SR_PROXIMITY",
  "MOMENTUM_SHIFT",
  "CONFLUENCE"
];

export const marketEventTypeLabels: Record<MarketEvent["eventType"], string> = {
  MACRO: "Konjunktur",
  CENTRAL_BANK: "Zentralbank",
  INFLATION: "Inflation",
  LABOR_MARKET: "Arbeitsmarkt",
  RATES: "Zinsen",
  GEOPOLITICAL: "Geopolitik",
  SANCTIONS: "Sanktionen",
  CONFLICT: "Konflikt",
  ENERGY_COMMODITY: "Energie & Rohstoffe",
  SUPPLY_CHAIN: "Lieferketten",
  CORPORATE: "Unternehmen",
  RISK_SENTIMENT: "Marktstimmung",
  OTHER: "Sonstiges"
};

export function pipelineStatusColor(status: string | undefined): string | undefined {
  if (status === "SUCCESS") return "var(--good)";
  if (status === "FAILED") return "var(--bad)";
  if (status === "RUNNING") return "var(--accent)";
  return undefined;
}

export function pipelineStatusLabel(status: string | undefined): string {
  if (status === "SUCCESS") return "OK";
  if (status === "FAILED") return "Fehler";
  if (status === "RUNNING") return "läuft gerade";
  if (status === "SKIPPED") return "übersprungen";
  return status ?? "unbekannt";
}

// ── Marktlage in Alltagssprache (für das Lagebild) ──

export function regimeSentence(regime: string | undefined): string | null {
  if (regime === "RISK_ON")
    return "Das Umfeld ist konstruktiv: Marktteilnehmer akzeptieren derzeit eher Risiko.";
  if (regime === "RISK_OFF")
    return "Das Umfeld ist defensiv: Kapital sucht derzeit eher Stabilität und Schutz.";
  if (regime === "MIXED") return "Das Marktumfeld sendet gemischte Signale.";
  if (regime === "NEUTRAL") return "Das Marktumfeld ist unauffällig.";
  return null;
}

export function confidenceWords(confidence: number | undefined): string | null {
  if (typeof confidence !== "number") return null;
  if (confidence >= 0.75) return "recht sichere Einschätzung";
  if (confidence >= 0.5) return "mittlere Sicherheit";
  return "erste, noch unsichere Einschätzung";
}

export function withinHours(
  isoTime: string | null | undefined,
  hours: number,
  now: Date
): boolean {
  if (!isoTime) return false;
  const timestamp = new Date(isoTime).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp <= hours * 3_600_000;
}
