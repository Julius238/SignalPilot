import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime, formatScore } from "../../../lib/format";
import { buildQuery, fetchApi, type RulesSummary, type SignalRuleApplication } from "../../../lib/signalpilot-api";

type RulesPageProps = {
  searchParams: Promise<{ symbol?: string; adjustedStatus?: string; category?: string }>;
};

export default async function RulesPage({ searchParams }: RulesPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    symbol: params.symbol,
    adjustedStatus: params.adjustedStatus,
    category: params.category
  });
  const [summary, applications] = await Promise.all([
    fetchApi<RulesSummary>("/rules/summary"),
    fetchApi<SignalRuleApplication[]>(`/rules/applications${query}`)
  ]);
  const errors = [summary.error, applications.error].filter(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Signal Rules</h1>
          <p>Explainable score adjustments applied after base scoring.</p>
        </div>
      </div>

      {errors.length > 0 ? <ErrorState title="Could not load rules" message={errors.join(" | ")} /> : null}

      <section className="grid metrics">
        <Metric label="Applications" value={String(summary.data?.totalApplications ?? 0)} />
        <Metric label="Avg Delta" value={formatScore(summary.data?.avgDelta ?? 0)} />
        <Metric label="Positive" value={String(summary.data?.positiveAdjustmentCount ?? 0)} />
        <Metric label="Negative" value={String(summary.data?.negativeAdjustmentCount ?? 0)} />
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Applications</h2>
        {!applications.data || applications.data.length === 0 ? (
          <EmptyState title="Keine Rule Applications gefunden." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Timeframe</th>
                  <th>Original</th>
                  <th>Adjusted</th>
                  <th>Original Status</th>
                  <th>Adjusted Status</th>
                  <th>Top Reason</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {applications.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/dashboard/signals/${encodeURIComponent(row.signalId)}`}>{row.symbol}</Link>
                    </td>
                    <td>{row.timeframe}</td>
                    <td>{formatScore(row.originalScore)}</td>
                    <td>{formatScore(row.adjustedScore)}</td>
                    <td>{row.originalStatus}</td>
                    <td>{row.adjustedStatus}</td>
                    <td>{row.adjustments[0]?.reason ?? "Keine regelbasierte Anpassung."}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <span className="metric-label">{label}</span>
      <span className="metric-value metric-value-text">{value}</span>
    </div>
  );
}
