import Link from "next/link";

import { EmptyState } from "../empty-state";
import { SectionCard } from "../ui";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import type { MarketEvent, RadarEvent } from "../../lib/signalpilot-api";
import {
  marketEventTypeLabels,
  radarEventTypeLabel,
  severityColor,
  severityLabel
} from "./shared";

// Drei Radar-Spalten: Marktbewegungen, Chart-Patterns, globale Ereignisse.
// Einheitliche kompakte Zeilen, Severity immer als Prioritäts-Label.

export function RadarColumns({
  marketMoves,
  patterns,
  globalEvents,
  clusterChips,
  now
}: {
  marketMoves: RadarEvent[];
  patterns: RadarEvent[];
  globalEvents: MarketEvent[];
  clusterChips: Array<{ label: string; count: number }>;
  now: Date;
}) {
  return (
    <div className="radar-columns">
      <SectionCard
        title="Marktbewegungen"
        action={
          <Link href="/dashboard/scanner" className="section-link">
            Scanner →
          </Link>
        }
      >
        {marketMoves.length === 0 ? (
          <EmptyState title="Keine auffälligen Bewegungen im Radar." />
        ) : (
          <div className="health-rows">
            {marketMoves.map((event) => (
              <RadarRow key={event.id} event={event} now={now} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Chart Pattern Watch">
        {patterns.length === 0 ? (
          <EmptyState title="Aktuell keine Chart-Beobachtungen." />
        ) : (
          <div className="health-rows">
            {patterns.map((event) => (
              <RadarRow key={event.id} event={event} now={now} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Globale Ereignisse">
        {clusterChips.length > 0 ? (
          <div className="cluster-chips">
            {clusterChips.map((chip) => (
              <span key={chip.label} className="cluster-chip">
                {chip.label} <strong>{chip.count}</strong>
              </span>
            ))}
          </div>
        ) : null}
        {globalEvents.length === 0 ? (
          <EmptyState title="Keine globalen Ereignisse erkannt. Event Monitor per GLOBAL_EVENT_MONITOR_ENABLED=true aktivieren." />
        ) : (
          <div className="health-rows">
            {globalEvents.map((event) => (
              <div key={event.id} className="health-row">
                <div style={{ minWidth: 0 }}>
                  <div className="health-row-value" style={{ textAlign: "left" }}>
                    {event.sourceUrl ? (
                      <a href={event.sourceUrl} target="_blank" rel="noreferrer noopener">
                        {event.title}
                      </a>
                    ) : (
                      event.title
                    )}
                  </div>
                  <div className="muted small">
                    {marketEventTypeLabels[event.eventType] ?? event.eventType}
                    {event.region ? ` · ${event.region}` : ""}
                    {` · ${event.source}`}
                    {` · ${formatRelativeTime(event.detectedAt, now)}`}
                  </div>
                </div>
                <span className="badge badge-info" style={{ color: severityColor(event.severity) }}>
                  {severityLabel(event.severity)}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function RadarRow({ event, now }: { event: RadarEvent; now: Date }) {
  return (
    <div className="health-row">
      <div style={{ minWidth: 0 }}>
        <div className="health-row-value" style={{ textAlign: "left" }}>
          <Link href={`/dashboard/assets/${encodeURIComponent(event.symbol)}`}>{event.symbol}</Link>{" "}
          · {radarEventTypeLabel(event.eventType)}
          <span className="muted small" title={formatDateTime(event.createdAt)}>
            {" "}
            · {event.assetType} · {formatRelativeTime(event.createdAt, now)}
          </span>
        </div>
        <div className="muted small">{event.shortMessage}</div>
      </div>
      <span className="badge badge-info" style={{ color: severityColor(event.severity) }}>
        {severityLabel(event.severity)}
      </span>
    </div>
  );
}
