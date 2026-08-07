import { formatDateTime, formatRelativeTime } from "../lib/format";
import { isErrorStatus, shortStatusNote, type DataStatus } from "../lib/data-status";

// Macht sichtbar, *wie alt* die Zahlen daneben sind. Ohne diese Angabe wirken
// Daten vom Mai unter einer Überschrift wie "Aktuelle Signale" wie von heute.
//
// Bewusst eine reine Anzeigekomponente ohne Funktions-Props — sie wird aus
// Server-Komponenten heraus gerendert.

export function DataFreshness({
  label,
  newestAt,
  status,
  now,
  staleHint
}: {
  /** Worauf sich der Zeitstempel bezieht, z. B. "Signale". */
  label: string;
  newestAt: string | null | undefined;
  status: DataStatus;
  now: Date;
  /** Zusatzsatz, der nur im Zustand "stale" erscheint. */
  staleHint?: string;
}) {
  if (isErrorStatus(status)) {
    return (
      <p className="data-freshness data-freshness--error">
        <span className="data-freshness-dot" aria-hidden="true" />
        {label}: {shortStatusNote(status)}
      </p>
    );
  }

  if (status === "empty" || !newestAt) {
    return (
      <p className="data-freshness">
        <span className="data-freshness-dot" aria-hidden="true" />
        {label}: noch keine Daten vorhanden
      </p>
    );
  }

  const isStale = status === "stale";
  const absolute = formatDateTime(newestAt);
  const relative = formatRelativeTime(newestAt, now);
  // Jenseits einer Woche fällt `formatRelativeTime` auf das absolute Datum
  // zurück — dann stünde dasselbe zweimal nebeneinander.
  const showRelative = relative !== absolute;

  return (
    <p className={`data-freshness${isStale ? " data-freshness--stale" : ""}`}>
      <span className="data-freshness-dot" aria-hidden="true" />
      {label}: Stand <time dateTime={newestAt}>{absolute}</time>
      {showRelative ? <span className="muted"> ({relative})</span> : null}
      {isStale && staleHint ? <span className="data-freshness-hint">{staleHint}</span> : null}
    </p>
  );
}
