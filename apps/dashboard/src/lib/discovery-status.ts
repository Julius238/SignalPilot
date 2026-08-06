import type { ApiErrorKind } from "./signalpilot-api";

// Fünf Zustände, die vorher alle als "Asset Discovery ist sicher deaktiviert" erschienen
// sind. "loading" wird nicht hier entschieden, sondern von loading.tsx / Suspense
// gerendert, solange die Server-Komponente auf die API wartet.
export type DiscoveryStatus =
  | "error" // Aufruf gescheitert — Ursache steckt in errorKind
  | "disabled" // Feature-Flag aus
  | "no-run" // aktiviert, aber noch kein Lauf
  | "no-candidates-today" // Lauf vorhanden, heute nichts Neues
  | "ready"; // Kandidaten vorhanden

export type DiscoveryStatusInput = {
  errorKind: ApiErrorKind | undefined;
  hasError: boolean;
  enabled: boolean | undefined;
  hasRun: boolean | undefined;
  candidateCountToday: number;
};

export function resolveDiscoveryStatus({
  hasError,
  enabled,
  hasRun,
  candidateCountToday
}: DiscoveryStatusInput): DiscoveryStatus {
  // Ein Fehler gewinnt immer. Aus fehlenden Daten darf niemals eine Aussage über den
  // Konfigurationszustand abgeleitet werden — genau das war der ursprüngliche Fehler.
  if (hasError) return "error";
  if (!enabled) return "disabled";
  if (!hasRun) return "no-run";
  if (candidateCountToday === 0) return "no-candidates-today";
  return "ready";
}

export function discoveryEmptyCopy(status: DiscoveryStatus): {
  title: string;
  description: string;
} {
  switch (status) {
    case "disabled":
      return {
        title: "Asset Discovery ist deaktiviert.",
        description: "Vorschläge entstehen erst nach Aktivierung."
      };
    case "no-run":
      return {
        title: "Noch kein Discovery-Lauf durchgeführt.",
        description:
          "Discovery ist aktiviert, hat aber noch nicht gelaufen. Der erste Lauf erzeugt die Kandidaten."
      };
    default:
      return {
        title: "Heute noch keine neuen Discovery-Kandidaten.",
        description: "Der nächste Lauf aktualisiert diese kompakte Auswahl."
      };
  }
}
