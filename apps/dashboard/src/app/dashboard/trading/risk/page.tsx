import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../../components/ui";
import {
  RiskAssessmentStatusBadge,
  RiskRuleOutcomeBadge,
  RiskSeverityBadge
} from "../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import { TradingPagination } from "../../../../components/trading/trading-pagination";
import { fetchRiskAssessments, fetchRiskEvents } from "../../../../lib/trading-api";
import { formatDecimalAmount, formatUtcDateTime } from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

const LIMIT = 30;

type PageProps = {
  searchParams: Promise<{
    assessmentStatus?: string;
    eventSeverity?: string;
    eventAcknowledged?: string;
    assessmentOffset?: string;
    eventOffset?: string;
  }>;
};

export default async function RiskPage({ searchParams }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const params = await searchParams;
  const assessmentOffset = Math.max(0, Number(params.assessmentOffset) || 0);
  const eventOffset = Math.max(0, Number(params.eventOffset) || 0);
  const acknowledged =
    params.eventAcknowledged === "true" ? "true" : params.eventAcknowledged === "false" ? "false" : undefined;

  const [assessmentsResult, eventsResult] = await Promise.all([
    fetchRiskAssessments({
      status: params.assessmentStatus || undefined,
      limit: LIMIT,
      offset: assessmentOffset
    }),
    fetchRiskEvents({
      severity: params.eventSeverity || undefined,
      acknowledged,
      limit: LIMIT,
      offset: eventOffset
    })
  ]);

  const assessments = assessmentsResult.data ?? [];
  const events = eventsResult.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Risiko"
        subtitle="Risk Assessments mit allen Rule Results sowie Risk Events"
      />

      {assessmentsResult.error ? (
        <ErrorState title="Risk Assessments konnten nicht geladen werden" message={assessmentsResult.error} />
      ) : null}
      {eventsResult.error ? (
        <ErrorState title="Risk Events konnten nicht geladen werden" message={eventsResult.error} />
      ) : null}

      <SectionCard title="Risk Assessments" subtitle={`${assessments.length} Einträge auf dieser Seite`}>
        <form className="filter-bar" method="GET">
          <select name="assessmentStatus" defaultValue={params.assessmentStatus ?? ""}>
            <option value="">Alle Status</option>
            <option value="PASS">Bestanden</option>
            <option value="FAIL">Nicht bestanden</option>
            <option value="ERROR">Fehler</option>
          </select>
          <input type="hidden" name="eventSeverity" value={params.eventSeverity ?? ""} />
          <input type="hidden" name="eventAcknowledged" value={params.eventAcknowledged ?? ""} />
          <button type="submit">Filtern</button>
        </form>

        {assessments.length > 0 ? (
          <>
            {assessments.map((assessment) => (
              <details key={assessment.id} className="card" style={{ marginBottom: 12, padding: 14 }}>
                <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>
                    <strong>{assessment.tradeCandidateId}</strong>
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      {formatUtcDateTime(assessment.assessedAt)} · Regelwerk {assessment.ruleSetVersion}
                    </span>
                  </span>
                  <RiskAssessmentStatusBadge value={assessment.status} />
                </summary>

                <div className="grid metrics" style={{ marginTop: 12 }}>
                  <div className="card">
                    <span className="metric-label">Equity</span>
                    <strong className="metric-value">{formatDecimalAmount(assessment.equity)}</strong>
                  </div>
                  <div className="card">
                    <span className="metric-label">Verfügbares Cash</span>
                    <strong className="metric-value">{formatDecimalAmount(assessment.availableCash)}</strong>
                  </div>
                  <div className="card">
                    <span className="metric-label">Angefordert / Genehmigt</span>
                    <strong className="metric-value">
                      {formatDecimalAmount(assessment.requestedQuantity, { maximumFractionDigits: 6 })} /{" "}
                      {formatDecimalAmount(assessment.approvedQuantity, { maximumFractionDigits: 6 })}
                    </strong>
                  </div>
                  <div className="card">
                    <span className="metric-label">Risikobetrag</span>
                    <strong className="metric-value">{formatDecimalAmount(assessment.riskAmount)}</strong>
                  </div>
                </div>

                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Regel</th>
                        <th>Ergebnis</th>
                        <th>Grund</th>
                        <th>Severity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assessment.ruleResults.map((rule) => (
                        <tr key={rule.id}>
                          <td>{rule.ruleCode}</td>
                          <td>
                            <RiskRuleOutcomeBadge value={rule.outcome} />
                          </td>
                          <td className="muted small">{rule.reasonCode}</td>
                          <td>
                            <RiskSeverityBadge value={rule.severity} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {assessment.decision ? (
                  <p className="muted small" style={{ marginTop: 10 }}>
                    Entscheidung: {assessment.decision.outcome} ({assessment.decision.reasonCode}) ·{" "}
                    {formatUtcDateTime(assessment.decision.decidedAt)}
                  </p>
                ) : null}
              </details>
            ))}
            <TradingPagination
              basePath="/dashboard/trading/risk"
              searchParams={params}
              offset={assessmentOffset}
              limit={LIMIT}
              count={assessments.length}
              paramName="assessmentOffset"
            />
          </>
        ) : (
          <EmptyState title="Keine Risk Assessments gefunden." />
        )}
      </SectionCard>

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Risk Events" subtitle={`${events.length} Einträge auf dieser Seite`}>
          <form className="filter-bar" method="GET">
            <input type="hidden" name="assessmentStatus" value={params.assessmentStatus ?? ""} />
            <select name="eventSeverity" defaultValue={params.eventSeverity ?? ""}>
              <option value="">Alle Severities</option>
              <option value="INFO">Info</option>
              <option value="WARNING">Warnung</option>
              <option value="BLOCKER">Blockierend</option>
              <option value="CRITICAL">Kritisch</option>
            </select>
            <select name="eventAcknowledged" defaultValue={params.eventAcknowledged ?? ""}>
              <option value="">Bestätigt & unbestätigt</option>
              <option value="false">Nur unbestätigt</option>
              <option value="true">Nur bestätigt</option>
            </select>
            <button type="submit">Filtern</button>
          </form>

          {events.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Typ</th>
                      <th>Severity</th>
                      <th>Grund</th>
                      <th>Bestätigt</th>
                      <th>Zeitpunkt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td data-label="Typ">{event.type}</td>
                        <td data-label="Severity">
                          <RiskSeverityBadge value={event.severity} />
                        </td>
                        <td data-label="Grund" className="muted small">
                          {event.reasonCode}
                        </td>
                        <td data-label="Bestätigt">
                          {event.acknowledgedAt ? (
                            <span className="badge trading-good">
                              bestätigt · {formatUtcDateTime(event.acknowledgedAt)}
                            </span>
                          ) : (
                            <span className="badge trading-warn">unbestätigt</span>
                          )}
                        </td>
                        <td data-label="Zeitpunkt" className="nowrap">
                          {formatUtcDateTime(event.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TradingPagination
                basePath="/dashboard/trading/risk"
                searchParams={params}
                offset={eventOffset}
                limit={LIMIT}
                count={events.length}
                paramName="eventOffset"
              />
            </>
          ) : (
            <EmptyState title="Keine Risk Events gefunden." tone="calm" />
          )}
        </SectionCard>
      </div>
    </>
  );
}
