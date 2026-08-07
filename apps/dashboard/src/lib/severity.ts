// Die *eine* Wichtigkeits-Zuordnung für alle Ereignis-Darstellungen.
//
// Vorher gab es zwei: `components/dashboard/shared.ts` kannte vier Stufen
// (WATCH = "Beobachten"), `lib/market-event-detail.ts` fasste WATCH und INFO zu
// "Informativ" zusammen. Dieselbe Meldung hieß dadurch auf dem Command Center
// anders als auf der Weltlage-Seite. Beide Module leiten jetzt hierher weiter.
//
// Farbe, Symbol, Text und Rangfolge stammen ausnahmslos aus dieser Tabelle —
// wer eine Stufe anzeigt, darf keine eigene Zuordnung mitbringen.

/** Die vom Backend gelieferten Stufen. Reihenfolge = fachliche Rangfolge. */
export const SEVERITY_KEYS = ["CRITICAL", "IMPORTANT", "WATCH", "INFO"] as const;

export type SeverityKey = (typeof SEVERITY_KEYS)[number];

/** Kleingeschriebene Variante für CSS-Klassen (`sev-chip--watch` usw.). */
export type SeverityTone = "critical" | "important" | "watch" | "info";

export type SeverityMeta = {
  key: SeverityKey;
  tone: SeverityTone;
  /** Menschliches Label — identisch auf jeder Seite. */
  label: string;
  /** Zweite Codierung neben der Farbe (Rot-Grün-Sehschwäche, S/W-Druck). */
  symbol: string;
  /** Höher = wichtiger. Für Sortierung und Schwellen ("ab WATCH"). */
  rank: number;
  /** Farb-Token. Immer über `var(--sev-…)`, nie als Hex-Wert. */
  color: string;
  /** Grundradius des Kartenmarkers — Wichtigkeit dominiert die Kreisgröße. */
  markerRadius: number;
};

const SEVERITY_META: Record<SeverityKey, SeverityMeta> = {
  CRITICAL: {
    key: "CRITICAL",
    tone: "critical",
    label: "Sofort ansehen",
    symbol: "▲",
    rank: 4,
    color: "var(--sev-critical)",
    markerRadius: 26
  },
  IMPORTANT: {
    key: "IMPORTANT",
    tone: "important",
    label: "Wichtig",
    symbol: "●",
    rank: 3,
    color: "var(--sev-important)",
    markerRadius: 20
  },
  WATCH: {
    key: "WATCH",
    tone: "watch",
    label: "Beobachten",
    symbol: "◆",
    rank: 2,
    color: "var(--sev-watch)",
    markerRadius: 16
  },
  INFO: {
    key: "INFO",
    tone: "info",
    label: "Information",
    symbol: "○",
    rank: 1,
    color: "var(--sev-info)",
    markerRadius: 13
  }
};

/**
 * Fail-safe: Ein unbekannter oder fehlender Wert wird als "Information"
 * dargestellt — die niedrigste Stufe. Ein neuer Backend-Wert darf niemals
 * versehentlich als "Sofort ansehen" erscheinen oder die Seite abstürzen lassen.
 */
export function resolveSeverity(value: string | null | undefined): SeverityMeta {
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (isSeverityKey(upper)) return SEVERITY_META[upper];
  }
  return SEVERITY_META.INFO;
}

export function isSeverityKey(value: string): value is SeverityKey {
  return (SEVERITY_KEYS as readonly string[]).includes(value);
}

export function severityLabel(value: string | null | undefined): string {
  return resolveSeverity(value).label;
}

export function severityTone(value: string | null | undefined): SeverityTone {
  return resolveSeverity(value).tone;
}

export function severityRank(value: string | null | undefined): number {
  return resolveSeverity(value).rank;
}

export function severitySymbol(value: string | null | undefined): string {
  return resolveSeverity(value).symbol;
}

export function severityColor(value: string | null | undefined): string {
  return resolveSeverity(value).color;
}

/** Alle Stufen von wichtig nach unwichtig — für Legenden und Filterlisten. */
export function severityScale(): SeverityMeta[] {
  return SEVERITY_KEYS.map((key) => SEVERITY_META[key]);
}

/** Schwelle "ab Beobachten" — die Stufe, ab der etwas ins Lagebild gehört. */
export const NOTABLE_SEVERITY_RANK = SEVERITY_META.WATCH.rank;
