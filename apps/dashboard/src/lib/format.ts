// Vierstelliges Jahr. Der kurze Datumsstil von Intl liefert im de-DE-Format nur
// "06.08.26"; für ein Finanzwerkzeug ist ein zweistelliges Jahr zu mehrdeutig —
// gerade weil hier Daten aus mehreren Monaten und Jahren nebeneinander stehen.
const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }

  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }

  return dateFormatter.format(date);
}

export function formatRelativeTime(value: string | null | undefined, now: Date = new Date()) {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const diffMs = now.getTime() - timestamp;

  if (diffMs < 0) {
    return formatDateTime(value);
  }

  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return "gerade eben";
  }

  if (diffMinutes < 60) {
    return `vor ${diffMinutes} Min.`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `vor ${diffHours} Std.`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return diffDays === 1 ? "vor 1 Tag" : `vor ${diffDays} Tagen`;
  }

  return formatDateTime(value);
}

export function formatScore(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "-";
  }

  return value.toFixed(1);
}

export function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

// ── Numerus ──────────────────────────────────────────────────────────────────
// Deutsche Ein-/Mehrzahl gehört zentral hierher. Verteilte
// `n === 1 ? "…" : "…"`-Sonderfälle haben in der Vergangenheit "1 Ereignisse"
// und "in den letzten 7 Tage" erzeugt.

/** "1 Meldung" · "3 Meldungen" — Zahl und passendes Wort. */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${pluralWord(count, singular, plural)}`;
}

/** Nur das Wort, ohne Zahl — für Sätze, die die Zahl selbst formatieren. */
export function pluralWord(count: number, singular: string, plural: string): string {
  return Math.abs(count) === 1 ? singular : plural;
}

/**
 * Zeitraum im Dativ: "in den letzten 24 Stunden", "in den letzten 7 Tagen",
 * "in der letzten Stunde". Die Dativ-Mehrzahl ("Tagen", nicht "Tage") ist genau
 * die Stelle, an der es vorher falsch war.
 *
 * Bis einschließlich 48 Stunden bleibt es bei Stunden — so heißen die Zeitfenster
 * der Anwendung ("24 Stunden", "48 Stunden"), und "2 Tage" wäre eine andere Aussage
 * als das, was im Filter steht.
 */
const HOURS_BEFORE_SWITCHING_TO_DAYS = 48;

export function lastPeriodPhrase(hours: number): string {
  if (hours > HOURS_BEFORE_SWITCHING_TO_DAYS && hours % 24 === 0) {
    const days = hours / 24;
    return `in den letzten ${days} ${pluralWord(days, "Tag", "Tagen")}`;
  }
  return hours === 1 ? "in der letzten Stunde" : `in den letzten ${hours} Stunden`;
}
