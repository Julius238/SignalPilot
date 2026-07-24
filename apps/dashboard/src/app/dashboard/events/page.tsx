import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../components/ui";
import { buildQuery, fetchApi, type EventItem } from "../../../lib/signalpilot-api";
import { formatDateTime } from "../../../lib/format";

type EventsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function formatLargeNumber(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toFixed(2);
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams;
  const symbol = params.symbol?.toUpperCase() ?? "";
  const eventType = params.eventType ?? "";
  const from = params.from ?? "";
  const to = params.to ?? "";

  const query = buildQuery({
    symbol: symbol || undefined,
    eventType: eventType || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 200
  });

  const result = await fetchApi<EventItem[]>(`/events${query}`);
  const events = result.data ?? [];
  const hasFilter = !!(symbol || eventType || from || to);

  return (
    <>
      <PageHeader
        eyebrow="Kontext"
        title="Unternehmenstermine"
        subtitle="Earnings und bekannte Unternehmensereignisse — mit Schätzungen und veröffentlichten Werten."
      />

      {result.error ? (
        <ErrorState title="Events konnten nicht geladen werden" message={result.error} />
      ) : null}

      {/* Filter */}
      <form className="filter-bar" method="GET" style={{ marginBottom: 16 }}>
        <input
          name="symbol"
          placeholder="Symbol"
          defaultValue={symbol}
        />
        <input
          name="eventType"
          placeholder="Event-Typ (z.B. EARNINGS)"
          defaultValue={eventType}
        />
        <input
          name="from"
          type="date"
          defaultValue={from}
          title="Von"
        />
        <input
          name="to"
          type="date"
          defaultValue={to}
          title="Bis"
        />
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/events" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      <SectionCard
        title={events.length > 0 ? `${events.length} Termine` : undefined}
        subtitle={hasFilter ? "Die Ansicht ist aktuell gefiltert." : "Chronologische Unternehmensereignisse."}
      >
        {events.length === 0 ? (
          <EmptyState
            title="Keine passenden Termine gefunden."
            description="Passe den Zeitraum oder die Filter an."
          />
        ) : (
          <div className="event-card-grid">
            {events.map((event) => {
              const quarter =
                event.fiscalQuarter && event.fiscalYear
                  ? `Q${event.fiscalQuarter} ${event.fiscalYear}`
                  : event.fiscalQuarter
                    ? `Q${event.fiscalQuarter}`
                    : event.fiscalYear
                      ? String(event.fiscalYear)
                      : null;

              return (
                <article className="event-card" key={event.id}>
                  <div className="event-card-head">
                    <Link
                      className="event-card-symbol"
                      href={`/dashboard/assets/${encodeURIComponent(event.symbol ?? "")}`}
                    >
                      {event.symbol ?? "Ohne Symbol"}
                    </Link>
                    <span className="soft-chip">
                      {event.eventType === "EARNINGS" ? "Quartalszahlen" : event.eventType}
                    </span>
                  </div>
                  <h2>{event.title}</h2>
                  <p className="event-card-date">
                    {event.eventDate ? formatDateTime(event.eventDate) : "Termin noch offen"}
                    {event.eventTime ? ` · ${event.eventTime}` : ""}
                    {quarter ? ` · ${quarter}` : ""}
                  </p>
                  <div className="event-facts">
                    <div>
                      <span>Gewinn je Aktie</span>
                      <strong>{event.epsActual ?? "—"}</strong>
                      <small>Schätzung {event.epsEstimate ?? "—"}</small>
                    </div>
                    <div>
                      <span>Umsatz</span>
                      <strong>
                        {event.revenueActual ? formatLargeNumber(event.revenueActual) : "—"}
                      </strong>
                      <small>
                        Schätzung{" "}
                        {event.revenueEstimate
                          ? formatLargeNumber(event.revenueEstimate)
                          : "—"}
                      </small>
                    </div>
                  </div>
                  <span className="event-card-source">Quelle: {event.source}</span>
                </article>
              );
            })}
            </div>
        )}
      </SectionCard>
    </>
  );
}
