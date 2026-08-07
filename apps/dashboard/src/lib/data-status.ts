import { describeApiError, type ApiErrorCopy } from "./api-error";
import type { ApiErrorKind, ApiResult } from "./signalpilot-api";

// Ein gemeinsamer, typisierter Zustand für jeden Datenbereich der Anwendung.
//
// Der eigentliche Fehler, den dieses Modul verhindert: Ein fehlgeschlagener
// Abruf liefert `data: null`. Wer daraus `?? []` macht und dann `length === 0`
// prüft, erzählt dem Nutzer „es ist nichts passiert" — obwohl in Wahrheit
// niemand nachgesehen hat. Genau so entstand „Ruhige Lage — aktuell nichts
// Dringendes." bei ausgefallener API.
//
// Regel: **Fehler gewinnt immer vor Leerzustand.** Und: Kennzahlen aus einem
// gescheiterten Abruf sind `null`, nie `0`.

export type DataStatus =
  | "available" // Daten liegen vor
  | "empty" // Abruf erfolgreich, es gibt nichts
  | "stale" // Daten liegen vor, sind aber älter als erwartet
  | "unreachable" // API antwortet nicht
  | "server-error" // API antwortet mit einem Fehler
  | "unauthorized"; // Sitzung fehlt oder ist abgelaufen

const ERROR_STATUS: Record<ApiErrorKind, DataStatus> = {
  unauthorized: "unauthorized",
  unreachable: "unreachable",
  server: "server-error",
  // Eine abgelehnte Anfrage ist für den Nutzer dasselbe wie ein interner Fehler:
  // Die Daten fehlen, und er kann die Ursache nicht beheben.
  request: "server-error"
};

const ERROR_STATUSES: readonly DataStatus[] = [
  "unreachable",
  "server-error",
  "unauthorized"
];

/** Ist dieser Zustand ein Fehler? Dann darf nichts Positives behauptet werden. */
export function isErrorStatus(status: DataStatus): boolean {
  return ERROR_STATUSES.includes(status);
}

/** Liegen belastbare Daten vor? "stale" zählt dazu — sie sind echt, nur alt. */
export function hasData(status: DataStatus): boolean {
  return status === "available" || status === "stale";
}

export type ResolveDataStatusInput = {
  /** Fehlermeldung aus `ApiResult`, falls der Abruf gescheitert ist. */
  error?: string | null;
  errorKind?: ApiErrorKind;
  /** Ist die erfolgreich geladene Menge leer? */
  isEmpty: boolean;
  /** Jüngster Zeitstempel der Daten — nur nötig, wenn `staleAfterHours` gesetzt ist. */
  newestAt?: string | Date | null;
  /** Ab welchem Alter gelten die Daten als veraltet? */
  staleAfterHours?: number;
  now?: Date;
};

export function resolveDataStatus({
  error,
  errorKind,
  isEmpty,
  newestAt,
  staleAfterHours,
  now = new Date()
}: ResolveDataStatusInput): DataStatus {
  // 1. Fehler gewinnt immer — aus einem gescheiterten Abruf darf niemals eine
  //    Aussage über die Sachlage abgeleitet werden.
  if (error) return errorKind ? ERROR_STATUS[errorKind] : "server-error";
  // 2. Erfolgreich, aber nichts da.
  if (isEmpty) return "empty";
  // 3. Da, aber möglicherweise zu alt, um „aktuell" genannt zu werden.
  if (staleAfterHours != null && newestAt != null) {
    const newest = newestAt instanceof Date ? newestAt : new Date(newestAt);
    if (Number.isFinite(newest.getTime())) {
      const ageHours = (now.getTime() - newest.getTime()) / 3_600_000;
      if (ageHours > staleAfterHours) return "stale";
    }
  }
  return "available";
}

/** Bequemer Weg für Listen-Endpunkte: `statusOfList(result, …)`. */
export function statusOfList<T>(
  result: ApiResult<T[]>,
  options: { items?: T[]; newestAt?: string | Date | null; staleAfterHours?: number; now?: Date } = {}
): DataStatus {
  const items = options.items ?? result.data ?? [];
  return resolveDataStatus({
    error: result.error,
    errorKind: result.errorKind,
    isEmpty: items.length === 0,
    newestAt: options.newestAt,
    staleAfterHours: options.staleAfterHours,
    now: options.now
  });
}

/**
 * Kennzahlen: bei Fehler `null` statt `0`. Eine „0" neben dem Wort
 * „Benachrichtigungen" ist eine Tatsachenbehauptung — die darf nur fallen, wenn
 * tatsächlich nachgesehen wurde.
 */
export function metricValue(status: DataStatus, value: number): number | null {
  return isErrorStatus(status) ? null : value;
}

/** Anzeige einer Kennzahl: „—", wenn sie nicht ermittelt werden konnte. */
export function formatMetric(value: number | null): string {
  return value == null ? "—" : String(value);
}

/**
 * Die deutsche Fehlerbeschreibung zu einem Zustand. Nutzt dieselbe Copy wie alle
 * anderen Fehlerstellen, damit die Anwendung bei einem Ausfall überall gleich klingt.
 */
export function describeStatus(
  status: DataStatus,
  technicalMessage: string,
  subject: string
): ApiErrorCopy | null {
  if (!isErrorStatus(status)) return null;
  const kind: ApiErrorKind =
    status === "unauthorized" ? "unauthorized" : status === "unreachable" ? "unreachable" : "server";
  return describeApiError(kind, technicalMessage, subject);
}

/**
 * Kurzer Hinweis für Stellen, an denen kein voller Fehlerblock passt — etwa in
 * einer Fußzeile oder neben einer Kennzahl.
 */
export function shortStatusNote(status: DataStatus): string | null {
  switch (status) {
    case "unreachable":
      return "nicht abrufbar — API antwortet nicht";
    case "server-error":
      return "nicht abrufbar — Fehler in der API";
    case "unauthorized":
      return "nicht abrufbar — Sitzung abgelaufen";
    default:
      return null;
  }
}
