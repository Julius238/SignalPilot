import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime, formatScore } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type PaperSignalEvaluation,
  type PaperStats
} from "../../../lib/signalpilot-api";

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

type PaperPageProps = {
  searchParams: Promise<{
    evaluationKind?: string;
    skipReason?: string;
  }>;
};

const evaluationKinds = [
  "DIRECTIONAL_BULLISH",
  "DIRECTIONAL_BEARISH",
  "RISK_WARNING",
  "OBSERVATION",
  "SKIPPED"
];

export default async function PaperPage({ searchParams }: PaperPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    limit: 100,
    evaluationKind: params.evaluationKind,
    skipReason: params.skipReason
  });
  const [stats, evaluations] = await Promise.all([
    fetchApi<PaperStats>("/paper/stats"),
    fetchApi<PaperSignalEvaluation[]>(`/paper/evaluations${query}`)
  ]);

  const summary = stats.data;

  return (
    <>
      <div className="page-header">
        <h1>Paper Evaluation</h1>
        <p>Hypothetical outcome tracking for signal quality measurement.</p>
        <Link className="primary-link" href="/dashboard/performance">
          Performance Intelligence
        </Link>
      </div>

      {stats.error ? <ErrorState title="Could not load paper stats" message={stats.error} /> : null}
      {evaluations.error ? (
        <ErrorState title="Could not load paper evaluations" message={evaluations.error} />
      ) : null}

      <form className="filter-bar">
        <label>
          Evaluation Kind
          <select name="evaluationKind" defaultValue={params.evaluationKind ?? ""}>
            <option value="">All</option>
            {evaluationKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Skip Reason
          <input name="skipReason" defaultValue={params.skipReason ?? ""} />
        </label>
        <button type="submit">Apply</button>
      </form>

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Total</span>
          <span className="metric-value">{summary?.totalEvaluations ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Open</span>
          <span className="metric-value">{summary?.openCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Evaluated</span>
          <span className="metric-value">{summary?.evaluatedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">WinRate</span>
          <span className="metric-value">{formatPercent(summary?.winRate)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Avg 1h</span>
          <span className="metric-value">{formatPercent(summary?.avgReturnAfter1h)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Avg 4h</span>
          <span className="metric-value">{formatPercent(summary?.avgReturnAfter4h)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Avg 1d</span>
          <span className="metric-value">{formatPercent(summary?.avgReturnAfter1d)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Positive</span>
          <span className="metric-value">
            {(summary?.positiveCount ?? 0) + (summary?.targetReachedCount ?? 0)}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Negative</span>
          <span className="metric-value">
            {(summary?.negativeCount ?? 0) + (summary?.invalidatedCount ?? 0)}
          </span>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Evaluations</h2>
        {evaluations.data && evaluations.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>TF</th>
                  <th>Status</th>
                  <th>Kind</th>
                  <th>Signal</th>
                  <th>Direction</th>
                  <th>Score</th>
                  <th>Entry</th>
                  <th>1h</th>
                  <th>4h</th>
                  <th>1d</th>
                  <th>Hypothetical outcome</th>
                  <th>Skip Reason</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.data.map((evaluation) => (
                  <tr key={evaluation.id}>
                    <td>
                      <Link href={`/dashboard/assets/${encodeURIComponent(evaluation.symbol)}`}>
                        {evaluation.symbol}
                      </Link>
                    </td>
                    <td>{evaluation.timeframe}</td>
                    <td>{evaluation.status}</td>
                    <td>{evaluation.evaluationKind}</td>
                    <td>
                      <Link href={`/dashboard/signals/${encodeURIComponent(evaluation.signalId)}`}>
                        {evaluation.signalType}
                      </Link>
                    </td>
                    <td>{evaluation.direction}</td>
                    <td>{formatScore(evaluation.score)}</td>
                    <td>{evaluation.entryPrice}</td>
                    <td>{formatPercent(evaluation.returnAfter1h)}</td>
                    <td>{formatPercent(evaluation.returnAfter4h)}</td>
                    <td>{formatPercent(evaluation.returnAfter1d)}</td>
                    <td>{evaluation.outcome ?? evaluation.evaluationStatus}</td>
                    <td>{evaluation.skipReason ?? "-"}</td>
                    <td>{formatDateTime(evaluation.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Keine Paper Evaluations gefunden." />
        )}
      </section>
    </>
  );
}
