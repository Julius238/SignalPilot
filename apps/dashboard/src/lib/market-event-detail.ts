import { resolveSeverity, severityRank, type SeverityMeta } from "./severity";
import type { MarketEvent } from "./signalpilot-api";

// Aufbereitung eines MarketEvent für die Detailansicht.
//
// Grundregel: Es wird ausschließlich umformuliert, was gespeichert ist. Nichts wird
// abgeleitet, geraten oder prognostiziert. Fehlt ein Feld, entfällt die Aussage —
// es gibt keinen Ersatztext, der eine Information vortäuscht.

export const UNASSIGNED_REGION_KEY = "__none__";
export const UNASSIGNED_REGION_LABEL = "Ohne Regionszuordnung";

/**
 * Wichtigkeit kommt aus `lib/severity.ts` — derselben Tabelle, aus der auch das
 * Command Center liest. Früher fasste diese Datei WATCH und INFO zu "Informativ"
 * zusammen; dieselbe Meldung hieß dadurch je nach Seite anders.
 */
export function severityMeta(severity: string | null | undefined): SeverityMeta {
  return resolveSeverity(severity);
}

/** Rangfolge für die Sortierung "wichtigste zuerst". */
export function severitySortRank(severity: string | null | undefined): number {
  return severityRank(severity);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Die gespeicherte Zusammenfassung ist bei der aktuellen Quelle fast immer nur der
 * Titel in anderer Zeichensetzung. Nur eine echt abweichende Fassung ist brauchbar.
 */
export function storedSummary(event: MarketEvent): string | null {
  const summary = event.summary?.trim();
  if (!summary) return null;
  if (normalize(summary) === normalize(event.title)) return null;
  // Ein Fragment, das kürzer ist als der Titel, trägt keine zusätzliche Information.
  if (summary.length < 40) return null;
  return summary;
}

const EVENT_TYPE_SUBJECTS: Record<MarketEvent["eventType"], string> = {
  MACRO: "eine Konjunkturmeldung",
  CENTRAL_BANK: "eine Zentralbank-Meldung",
  INFLATION: "eine Meldung zur Inflation",
  LABOR_MARKET: "eine Meldung zum Arbeitsmarkt",
  RATES: "eine Meldung zu Zinsen",
  GEOPOLITICAL: "eine geopolitische Meldung",
  SANCTIONS: "eine Meldung zu Sanktionen",
  CONFLICT: "eine Meldung zu einem Konflikt",
  ENERGY_COMMODITY: "eine Meldung zu Energie oder Rohstoffen",
  SUPPLY_CHAIN: "eine Meldung zu Lieferketten",
  CORPORATE: "eine Unternehmensmeldung",
  RISK_SENTIMENT: "eine Meldung zur Marktstimmung",
  OTHER: "eine Meldung"
};

function joinList(values: string[]): string {
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} und ${values.at(-1)}`;
}

/**
 * Deterministischer Ersatz, wenn keine echte Zusammenfassung gespeichert ist:
 * beschreibt ausschließlich, *was* das System über die Meldung weiß.
 * Kein Modellaufruf, keine Persistenz, immer synchron zu den Daten.
 */
export function derivedSummary(
  event: MarketEvent,
  now: Date
): { text: string; isDerived: true } | null {
  const areas = [...new Set([...event.affectedAssetClasses, ...event.affectedSectors])];
  if (areas.length === 0 && event.affectedSymbols.length === 0) {
    // Es bliebe nur ein Satz, der dasselbe sagt wie die Metadaten daneben.
    // Dann lieber gar keine Zusammenfassung als eine inhaltsleere.
    return null;
  }

  const sentences: string[] = [];
  const subject = EVENT_TYPE_SUBJECTS[event.eventType] ?? "eine Meldung";
  const detected = new Date(event.detectedAt);
  const ageText = Number.isFinite(detected.getTime())
    ? relativeAge(detected, now)
    : "zu unbekanntem Zeitpunkt";
  const where = event.region ? ` Die Meldung hat Bezug zu ${event.region}.` : "";
  sentences.push(
    `${event.source} hat ${ageText} ${subject} veröffentlicht, die SignalPilot automatisch eingeordnet hat.${where}`
  );

  if (areas.length > 0) {
    sentences.push(
      `Regelbasiert gelten diese Bereiche als möglicherweise berührt: ${joinList(areas)}.`
    );
  }
  if (event.affectedSymbols.length > 0) {
    sentences.push(
      `Konkret genannte Werte: ${joinList(event.affectedSymbols)}.`
    );
  }

  // Die Richtungsangaben (Rücken-/Gegenwind) stehen strukturiert direkt darunter —
  // hier bewusst nicht wiederholt.
  return { text: sentences.join(" "), isDerived: true };
}

function relativeAge(value: Date, now: Date): string {
  const diffMinutes = Math.floor((now.getTime() - value.getTime()) / 60_000);
  if (diffMinutes < 1) return "gerade eben";
  if (diffMinutes === 1) return "vor einer Minute";
  if (diffMinutes < 60) return `vor ${diffMinutes} Minuten`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return "vor einer Stunde";
  if (diffHours < 24) return `vor ${diffHours} Stunden`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "vor einem Tag" : `vor ${diffDays} Tagen`;
}

export function eventAge(event: MarketEvent, now: Date): string {
  const detected = new Date(event.detectedAt);
  if (!Number.isFinite(detected.getTime())) return "Zeitpunkt unbekannt";
  return relativeAge(detected, now);
}

/**
 * Warum die Meldung für Märkte relevant sein *könnte*. Nutzt ausschließlich die
 * regelbasierten Impact-Felder. Ohne diese Felder gibt es keine Aussage — es wird
 * kein Zusammenhang konstruiert.
 */
export function marketRelevance(event: MarketEvent): {
  positive: string[];
  negative: string[];
  areas: string[];
  symbols: string[];
  hasAny: boolean;
} {
  const areas = [...new Set([...event.affectedAssetClasses, ...event.affectedSectors])];
  return {
    positive: event.positiveImpact,
    negative: event.negativeImpact,
    areas,
    symbols: event.affectedSymbols,
    hasAny:
      areas.length > 0 ||
      event.positiveImpact.length > 0 ||
      event.negativeImpact.length > 0 ||
      event.affectedSymbols.length > 0
  };
}

/**
 * Der Unsicherheitshinweis ist Pflicht, sobald eine mögliche Marktwirkung gezeigt
 * wird. Die Confidence der Klassifikation ist bewusst auf 0,6 gedeckelt — es gibt
 * also nie eine bestätigte Auswirkung.
 */
export function confidenceNote(event: MarketEvent): string {
  const percent = Math.round((event.confidence ?? 0) * 100);
  return `Automatische Einordnung mit ${percent} % Sicherheit — mögliche Auswirkungen sind regelbasiert vermutet, nicht bestätigt.`;
}
