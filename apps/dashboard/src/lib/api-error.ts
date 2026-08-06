import type { ApiErrorKind } from "./signalpilot-api";

// Ein fehlgeschlagener Aufruf darf nie als "es gibt nichts" oder "ist deaktiviert"
// dargestellt werden. Diese Funktion übersetzt den technischen Fehler in eine ehrliche
// Aussage plus eine konkrete Handlungsmöglichkeit.

export type ApiErrorCopy = {
  title: string;
  message: string;
  hint: string;
  /** Ein erneuter Versuch kann helfen (bei fehlender Anmeldung dagegen nicht). */
  retryable: boolean;
};

export function describeApiError(
  errorKind: ApiErrorKind | undefined,
  technicalMessage: string,
  subject = "Die Daten"
): ApiErrorCopy {
  switch (errorKind) {
    case "unauthorized":
      return {
        title: "Anmeldung abgelaufen",
        message: `${subject} konnten nicht geladen werden, weil die Sitzung nicht mehr gültig ist.`,
        hint: "Bitte neu anmelden.",
        retryable: false
      };
    case "unreachable":
      return {
        title: "API nicht erreichbar",
        message: `${subject} konnten nicht geladen werden — die SignalPilot-API antwortet nicht.`,
        hint: "Läuft der API-Dienst? Details stehen im Ausführungsprotokoll.",
        retryable: true
      };
    case "server":
      return {
        title: "Interner Fehler in der API",
        message: `${subject} konnten nicht geladen werden. Die API hat mit einem Fehler geantwortet.`,
        hint: `Technische Meldung: ${technicalMessage}`,
        retryable: true
      };
    case "request":
      return {
        title: "Anfrage wurde abgelehnt",
        message: `${subject} konnten nicht geladen werden. Die API hat die Anfrage zurückgewiesen.`,
        hint: `Technische Meldung: ${technicalMessage}`,
        retryable: true
      };
    default:
      return {
        title: "Daten konnten nicht geladen werden",
        message: `${subject} stehen gerade nicht zur Verfügung.`,
        hint: `Technische Meldung: ${technicalMessage}`,
        retryable: true
      };
  }
}
