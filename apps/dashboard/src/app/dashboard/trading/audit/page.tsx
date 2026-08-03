import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import { TradingPagination } from "../../../../components/trading/trading-pagination";
import {
  DRILLDOWN_AGGREGATE_TYPES,
  fetchAuditDrilldown,
  fetchTradingAudit
} from "../../../../lib/trading-api";
import { formatUtcDateTime } from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

const LIMIT = 50;

type PageProps = {
  searchParams: Promise<{
    aggregateType?: string;
    aggregateId?: string;
    eventType?: string;
    sessionId?: string;
    offset?: string;
    drilldownType?: string;
    drilldownId?: string;
  }>;
};

export default async function TradingAuditPage({ searchParams }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const params = await searchParams;
  const offset = Math.max(0, Number(params.offset) || 0);

  // Der Drilldown ist eine eigene, geschützte Route: die Ereigniskette wird
  // serverseitig zusammengesetzt UND bereinigt, damit Secrets gar nicht erst
  // über die Leitung gehen.
  const drilldownRequested = Boolean(params.drilldownType && params.drilldownId);
  const drilldownResult = drilldownRequested
    ? await fetchAuditDrilldown({
        aggregateType: params.drilldownType as string,
        aggregateId: params.drilldownId as string,
        limit: 200
      })
    : null;
  const drilldown = drilldownResult?.data ?? null;

  const result = await fetchTradingAudit({
    aggregateType: params.aggregateType || undefined,
    aggregateId: params.aggregateId || undefined,
    eventType: params.eventType || undefined,
    sessionId: params.sessionId || undefined,
    limit: LIMIT,
    offset
  });

  const events = result.data ?? [];
  const hasFilter = Boolean(
    params.aggregateType || params.aggregateId || params.eventType || params.sessionId
  );

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Audit Timeline"
        subtitle="Unveränderliche fachliche Ereigniskette — Filter nach Aggregat, Typ, Session und Zeit"
      />

      {result.error ? <ErrorState title="Audit-Ereignisse konnten nicht geladen werden" message={result.error} /> : null}

      <form className="filter-bar" method="GET">
        <input name="aggregateType" placeholder="Aggregat-Typ" defaultValue={params.aggregateType ?? ""} />
        <input name="aggregateId" placeholder="Aggregat-ID" defaultValue={params.aggregateId ?? ""} />
        <input name="eventType" placeholder="Ereignistyp" defaultValue={params.eventType ?? ""} />
        <input name="sessionId" placeholder="Session-ID" defaultValue={params.sessionId ?? ""} />
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/trading/audit" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      <SectionCard
        title="Audit-Ereignisse"
        subtitle="Ereigniszustände (beforeState/afterState) werden hier bewusst nicht als Rohdaten angezeigt"
      >
        {events.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Zeitpunkt (UTC)</th>
                    <th>Ereignistyp</th>
                    <th>Aggregat</th>
                    <th>Akteur</th>
                    <th>Grund</th>
                    <th>Session</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td data-label="Zeitpunkt" className="nowrap">
                        {formatUtcDateTime(event.occurredAt)}
                      </td>
                      <td data-label="Ereignistyp">{event.eventType}</td>
                      <td data-label="Aggregat" className="muted small">
                        {event.aggregateType} · {event.aggregateId}
                      </td>
                      <td data-label="Akteur">
                        {event.actorType}
                        {event.actorId ? ` (${event.actorId})` : ""}
                      </td>
                      <td data-label="Grund" className="muted small">
                        {event.reasonCode}
                      </td>
                      <td data-label="Session" className="muted small">
                        {event.tradingSessionId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TradingPagination
              basePath="/dashboard/trading/audit"
              searchParams={params}
              offset={offset}
              limit={LIMIT}
              count={events.length}
            />
          </>
        ) : (
          <EmptyState title="Keine Audit-Ereignisse für diese Filter gefunden." />
        )}
      </SectionCard>

      <div style={{ marginTop: 16 }}>
        <PageHeader
          eyebrow="Incident Review"
          title="Audit-Drilldown"
          subtitle="Vollständige Ereigniskette je Candidate, Assessment, Order, Fill, Position oder Session — serverseitig bereinigt"
        />

        <form className="filter-bar" method="GET">
          <input type="hidden" name="aggregateType" value={params.aggregateType ?? ""} />
          <input type="hidden" name="aggregateId" value={params.aggregateId ?? ""} />
          <select name="drilldownType" defaultValue={params.drilldownType ?? "ShadowPosition"}>
            {DRILLDOWN_AGGREGATE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input name="drilldownId" placeholder="Aggregat-ID" defaultValue={params.drilldownId ?? ""} />
          <button type="submit">Kette laden</button>
        </form>

        {drilldownResult?.error ? (
          <ErrorState title="Drilldown konnte nicht geladen werden" message={drilldownResult.error} />
        ) : null}

        {drilldown ? (
          <>
            <SectionCard
              title="Ereigniskette"
              subtitle={`${drilldown.chain.length} beteiligte Aggregate · ${drilldown.correlationIds.length} Correlation-IDs`}
            >
              {drilldown.chain.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Zeitpunkt (UTC)</th>
                        <th>Aggregat</th>
                        <th>Bezeichnung</th>
                        <th>Status</th>
                        <th>Reason Codes</th>
                        <th>Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drilldown.chain.map((node) => (
                        <tr key={`${node.aggregateType}:${node.aggregateId}`}>
                          <td className="nowrap">{formatUtcDateTime(node.occurredAt)}</td>
                          <td className="muted small">{node.aggregateType}</td>
                          <td>{node.label}</td>
                          <td>{node.status ?? "—"}</td>
                          <td className="muted small">
                            {node.reasonCodes.length > 0 ? node.reasonCodes.join(", ") : "—"}
                          </td>
                          <td>{node.version ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="Keine verknüpften Aggregate gefunden." />
              )}
            </SectionCard>

            <div style={{ marginTop: 16 }}>
              <SectionCard
                title="Audit-Ereignisse der Kette"
                subtitle={
                  drilldown.truncated
                    ? "Gekürzt — es gibt mehr Ereignisse als das Limit zulässt"
                    : "Vollständig, mit bereinigtem Vorher-/Nachher-Zustand"
                }
              >
                {drilldown.events.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Zeitpunkt (UTC)</th>
                          <th>Ereignistyp</th>
                          <th>Aggregat</th>
                          <th>Akteur</th>
                          <th>Grund</th>
                          <th>Versionen</th>
                          <th>Vorher → Nachher (bereinigt)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldown.events.map((event) => (
                          <tr key={event.id}>
                            <td className="nowrap">{formatUtcDateTime(event.occurredAt)}</td>
                            <td>{event.eventType}</td>
                            <td className="muted small">
                              {event.aggregateType} · {event.aggregateId}
                            </td>
                            <td>
                              {event.actorType}
                              {event.actorId ? ` (${event.actorId})` : ""}
                            </td>
                            <td className="muted small">{event.reasonCode}</td>
                            <td className="muted small">
                              {event.engineVersion ?? "—"} / {event.codeVersion ?? "—"}
                            </td>
                            <td>
                              <details>
                                <summary className="muted small">Zustand anzeigen</summary>
                                <pre className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>
                                  {JSON.stringify(
                                    { before: event.beforeState, after: event.afterState },
                                    null,
                                    2
                                  )}
                                </pre>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="Keine Audit-Ereignisse in dieser Kette." />
                )}
              </SectionCard>
            </div>
          </>
        ) : drilldownRequested ? null : (
          <SectionCard title="Ereigniskette" subtitle="Aggregat-Typ und ID wählen">
            <EmptyState
              title="Kein Drilldown angefordert."
              description="Wähle einen Aggregat-Typ und gib die ID ein, um die vollständige Ereigniskette zu laden."
            />
          </SectionCard>
        )}
      </div>
    </>
  );
}
