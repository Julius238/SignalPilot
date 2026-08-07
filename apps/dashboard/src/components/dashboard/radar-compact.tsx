import Link from "next/link";

import { EmptyState, ErrorState } from "../empty-state";
import { RetryButton } from "../retry-button";
import { SectionCard } from "../ui";
import { DirectionBadge, StatusBadge } from "../badges";
import { formatDateTime, formatRelativeTime, pluralize } from "../../lib/format";
import {
  describeStatus,
  formatMetric,
  isErrorStatus,
  metricValue,
  type DataStatus
} from "../../lib/data-status";
import type { Alert, RadarEvent, SignalListItem } from "../../lib/signalpilot-api";
import {
  chartPatternEventTypes,
  radarEventExplanation,
  radarEventTypeLabel,
  severityLabel,
  severitySymbol,
  severityTone
} from "./shared";

// Die Übersicht trennt Marktbewegungen von Chartmustern. So ist sofort
// erkennbar, ob die Beobachtung aus dem Krypto-, Aktien- oder Chart-Radar kommt.

export function RadarOverviewCard({
  events,
  now,
  status,
  errorMessage
}: {
  events: RadarEvent[];
  now: Date;
  status: DataStatus;
  errorMessage: string;
}) {
  const patternEvents = events.filter((event) =>
    chartPatternEventTypes.includes(event.eventType)
  );
  const cryptoEvents = events.filter(
    (event) => event.assetType === "CRYPTO" && !chartPatternEventTypes.includes(event.eventType)
  );
  const equityEvents = events.filter(
    (event) => event.assetType !== "CRYPTO" && !chartPatternEventTypes.includes(event.eventType)
  );
  const errorCopy = describeStatus(status, errorMessage, "Die Radar-Beobachtungen");

  return (
    <SectionCard
      className="radar-overview-card"
      title="Radar im Überblick"
      subtitle="Drei Blickwinkel auf ungewöhnliche Aktivität der letzten 24 Stunden."
      action={
        <Link href="/dashboard/scanner" className="section-link">
          Gesamten Markt-Radar öffnen
        </Link>
      }
    >
      {isErrorStatus(status) && errorCopy ? (
        // Ohne Abruf gibt es kein "ruhig" — die drei Spuren würden sonst
        // dreimal fälschlich Entwarnung geben.
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : (
        <div className="radar-lanes">
          <RadarLane
            description="Schnelle Bewegungen und ungewöhnliche Marktaktivität."
            events={cryptoEvents}
            label="Krypto"
            now={now}
          />
          <RadarLane
            description="Auffälligkeiten bei Aktien und ETFs aus gespeicherten Marktdaten."
            events={equityEvents}
            label="Aktien & ETFs"
            now={now}
          />
          <RadarLane
            description="Kurszonen, Momentumwechsel und mehrere Faktoren zugleich."
            events={patternEvents}
            label="Chartmuster"
            now={now}
          />
        </div>
      )}
    </SectionCard>
  );
}

function RadarLane({
  description,
  events,
  label,
  now
}: {
  description: string;
  events: RadarEvent[];
  label: string;
  now: Date;
}) {
  return (
    <section className="radar-lane">
      <div className="radar-lane-head">
        <div>
          <h3>{label}</h3>
          <p>{description}</p>
        </div>
        <span className="radar-lane-count">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <EmptyState tone="calm" title="Aktuell ruhig." />
      ) : (
        <div className="radar-list">
          {events.slice(0, 4).map((event) => (
            <RadarRow key={event.id} event={event} now={now} />
          ))}
        </div>
      )}
    </section>
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
        <span className={`sev-chip sev-chip--${tone}`}>
          <span className="sev-chip-symbol" aria-hidden="true">
            {severitySymbol(event.severity)}
          </span>
          {severityLabel(event.severity)}
        </span>
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
  watchlistHighPriority,
  alerts,
  signalsStatus,
  alertsStatus,
  watchlistStatus,
  errorMessage
}: {
  signals: SignalListItem[];
  watchlistCount: number;
  watchlistHighPriority: number;
  alerts: Alert[];
  signalsStatus: DataStatus;
  alertsStatus: DataStatus;
  watchlistStatus: DataStatus;
  errorMessage: string;
}) {
  const sentAlerts = alerts.filter((alert) => alert.status === "SENT").length;
  const failedAlerts = alerts.filter((alert) => alert.status === "FAILED").length;
  const errorCopy = describeStatus(signalsStatus, errorMessage, "Die Signale");
  const focusMetric = metricValue(signalsStatus, signals.length);
  const sentMetric = metricValue(alertsStatus, sentAlerts);
  const failedMetric = metricValue(alertsStatus, failedAlerts);

  return (
    <SectionCard
      className="signals-overview-card"
      title="Signale & Benachrichtigungen"
      subtitle="Beobachtungen mit der höchsten aktuellen Relevanz und ihr Zustellstatus."
      action={
        <Link href="/dashboard/signals" className="section-link">
          Alle Signale öffnen
        </Link>
      }
    >
      <div className="signal-overview-stats">
        <div>
          <strong>{formatMetric(focusMetric)}</strong>
          <span>im Fokus</span>
        </div>
        <div>
          <strong>{formatMetric(sentMetric)}</strong>
          <span>zugestellt</span>
        </div>
        <div className={failedMetric != null && failedMetric > 0 ? "has-issue" : undefined}>
          <strong>{formatMetric(failedMetric)}</strong>
          <span>nicht zugestellt</span>
        </div>
      </div>
      {isErrorStatus(signalsStatus) && errorCopy ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : signals.length === 0 ? (
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
                  ? ` · Qualität ${signal.score.toFixed(1)} · ${
                      signal.score >= 70
                        ? "hohe Relevanz"
                        : signal.score >= 50
                          ? "prüfenswert"
                          : "geringe Relevanz"
                    }`
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
        {isErrorStatus(watchlistStatus) ? (
          // "0 Assets" wäre falsch: Die Watchlist konnte gar nicht gelesen werden.
          <>Persönlicher Fokus: derzeit nicht abrufbar · </>
        ) : (
          <>
            Persönlicher Fokus: {pluralize(watchlistCount, "Asset", "Assets")}
            {watchlistHighPriority > 0 ? ` · ${watchlistHighPriority} besonders wichtig` : ""} ·{" "}
          </>
        )}
        <Link href="/dashboard/watchlist" className="section-link">
          Watchlist verwalten
        </Link>
      </p>
    </SectionCard>
  );
}
