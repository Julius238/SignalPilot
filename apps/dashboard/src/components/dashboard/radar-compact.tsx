import Link from "next/link";

import { EmptyState } from "../empty-state";
import { SectionCard } from "../ui";
import { DirectionBadge, StatusBadge } from "../badges";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import type { RadarEvent, SignalListItem } from "../../lib/signalpilot-api";
import {
  radarEventExplanation,
  radarEventTypeLabel,
  severityLabel,
  severityTone
} from "./shared";

// Kompakte Übersichtsblöcke: Markt-Radar und Signale.
// Jede Radar-Zeile trägt einen Erklärsatz, damit auch ohne Chart-Vorwissen
// klar ist, was die Beobachtung bedeutet. Details liegen auf den Unterseiten.

export function RadarCompactCard({ events, now }: { events: RadarEvent[]; now: Date }) {
  return (
    <SectionCard
      title="Markt-Radar"
      subtitle="Auffällige Bewegungen und Chartbilder der letzten 24 Stunden."
      action={
        <Link href="/dashboard/scanner" className="section-link">
          Zum Scanner →
        </Link>
      }
    >
      {events.length === 0 ? (
        <EmptyState
          tone="calm"
          title="Das Radar ist ruhig."
          description="Keine auffälligen Bewegungen oder Chartbilder in den letzten 24 Stunden."
        />
      ) : (
        <div className="radar-list">
          {events.map((event) => (
            <RadarRow key={event.id} event={event} now={now} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function RadarRow({ event, now }: { event: RadarEvent; now: Date }) {
  const tone = severityTone(event.severity);

  return (
    <div className="radar-row">
      <div className="radar-row-head">
        <Link
          href={`/dashboard/assets/${encodeURIComponent(event.symbol)}`}
          className="radar-symbol"
        >
          {event.symbol}
        </Link>
        <span className="radar-label">{radarEventTypeLabel(event.eventType)}</span>
        <span className={`sev-chip sev-chip--${tone}`}>{severityLabel(event.severity)}</span>
        <span className="radar-time" title={formatDateTime(event.createdAt)}>
          {formatRelativeTime(event.createdAt, now)}
        </span>
      </div>
      <div className="radar-explain">{radarEventExplanation(event.eventType)}</div>
    </div>
  );
}

export function SignalsCompactCard({
  signals,
  watchlistCount,
  watchlistHighPriority
}: {
  signals: SignalListItem[];
  watchlistCount: number;
  watchlistHighPriority: number;
}) {
  return (
    <SectionCard
      title="Signale im Blick"
      subtitle="Assets, die das System aktuell für beobachtenswert hält."
      action={
        <Link href="/dashboard/signals" className="section-link">
          Alle Signale →
        </Link>
      }
    >
      {signals.length === 0 ? (
        <EmptyState
          tone="calm"
          title="Kein Signal verlangt gerade Aufmerksamkeit."
          description="Sobald ein Asset als beobachtenswert eingestuft wird, erscheint es hier."
        />
      ) : (
        <div className="signal-mini-list">
          {signals.map((signal) => (
            <div key={signal.id} className="signal-mini">
              <Link href={`/dashboard/signals/${signal.id}`} className="signal-mini-symbol">
                {signal.symbol}
              </Link>
              <span className="signal-mini-meta">
                {signal.timeframe}
                {typeof signal.score === "number"
                  ? ` · Signalqualität ${signal.score.toFixed(1)}`
                  : ""}
              </span>
              <span className="signal-mini-right">
                <StatusBadge value={signal.status} />
                <DirectionBadge value={signal.direction} />
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        Watchlist: {watchlistCount} Assets
        {watchlistHighPriority > 0 ? ` · ${watchlistHighPriority} mit hoher Priorität` : ""} ·{" "}
        <Link href="/dashboard/watchlist" className="section-link">
          verwalten →
        </Link>
      </p>
    </SectionCard>
  );
}
