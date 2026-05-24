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
        title="Events"
        subtitle="Earnings-Termine und Unternehmensereignisse"
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

      <SectionCard>
        {events.length === 0 ? (
          <EmptyState title="Keine Events gefunden." />
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {events.length} Einträge
              {hasFilter ? " (gefiltert)" : ""}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Typ</th>
                    <th>Titel</th>
                    <th>Datum</th>
                    <th>Quartal</th>
                    <th>EPS (Schätzung)</th>
                    <th>EPS (Tatsächlich)</th>
                    <th>Umsatz (Schätz.)</th>
                    <th>Umsatz (Tats.)</th>
                    <th>Quelle</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link
                          href={`/dashboard/assets/${encodeURIComponent(event.symbol ?? "")}`}
                        >
                          <strong>{event.symbol ?? "—"}</strong>
                        </Link>
                      </td>
                      <td>{event.eventType}</td>
                      <td>{event.title}</td>
                      <td className="nowrap">
                        {event.eventDate ? formatDateTime(event.eventDate) : "—"}
                        {event.eventTime ? (
                          <span className="muted small"> · {event.eventTime}</span>
                        ) : null}
                      </td>
                      <td>
                        {event.fiscalQuarter && event.fiscalYear
                          ? `Q${event.fiscalQuarter} ${event.fiscalYear}`
                          : event.fiscalQuarter
                            ? `Q${event.fiscalQuarter}`
                            : event.fiscalYear
                              ? String(event.fiscalYear)
                              : "—"}
                      </td>
                      <td>{event.epsEstimate ?? "—"}</td>
                      <td>{event.epsActual ?? "—"}</td>
                      <td>
                        {event.revenueEstimate
                          ? formatLargeNumber(event.revenueEstimate)
                          : "—"}
                      </td>
                      <td>
                        {event.revenueActual ? formatLargeNumber(event.revenueActual) : "—"}
                      </td>
                      <td>{event.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </>
  );
}
