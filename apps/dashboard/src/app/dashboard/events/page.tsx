import { ErrorState } from "../../../components/empty-state";
import { fetchApi, buildQuery } from "../../../lib/signalpilot-api";
import { formatDateTime } from "../../../lib/format";
import type { EventItem } from "../../../lib/signalpilot-api";

type EventsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

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

  if (result.error) {
    return <ErrorState title="Could not load events" message={result.error} />;
  }

  const events = result.data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Events</h1>
        <p>Earnings calendar and corporate events from Finnhub</p>
      </div>

      <section className="card">
        <div className="filter-row">
          <form method="GET">
            <input name="symbol" placeholder="Filter by symbol…" defaultValue={symbol} />
            <input name="eventType" placeholder="Filter by type (EARNINGS)…" defaultValue={eventType} />
            <input name="from" type="date" defaultValue={from} />
            <input name="to" type="date" defaultValue={to} />
            <button type="submit">Filter</button>
            {(symbol || eventType || from || to) && (
              <a href="/dashboard/events">Clear</a>
            )}
          </form>
          <span>{events.length} events</span>
        </div>

        {events.length === 0 ? (
          <p className="muted">
            No events found. Run <code>pnpm worker:fetch-equity-events</code> to populate.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th>Title</th>
                <th>Event Date</th>
                <th>Quarter</th>
                <th>EPS Est.</th>
                <th>EPS Actual</th>
                <th>Rev. Est.</th>
                <th>Rev. Actual</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>
                      <a href={`/dashboard/assets/${encodeURIComponent(event.symbol ?? "")}`}>
                        {event.symbol ?? "-"}
                      </a>
                    </strong>
                  </td>
                  <td>{event.eventType}</td>
                  <td>{event.title}</td>
                  <td className="nowrap">
                    {event.eventDate ? formatDateTime(event.eventDate) : "-"}
                    {event.eventTime && (
                      <span className="muted small"> · {event.eventTime}</span>
                    )}
                  </td>
                  <td>
                    {event.fiscalQuarter && event.fiscalYear
                      ? `Q${event.fiscalQuarter} ${event.fiscalYear}`
                      : event.fiscalQuarter
                        ? `Q${event.fiscalQuarter}`
                        : event.fiscalYear
                          ? String(event.fiscalYear)
                          : "-"}
                  </td>
                  <td>{event.epsEstimate ?? "-"}</td>
                  <td>{event.epsActual ?? "-"}</td>
                  <td>{event.revenueEstimate ? formatLargeNumber(event.revenueEstimate) : "-"}</td>
                  <td>{event.revenueActual ? formatLargeNumber(event.revenueActual) : "-"}</td>
                  <td>{event.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function formatLargeNumber(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toFixed(2);
}
