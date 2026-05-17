import { ErrorState, EmptyState } from "../../../components/empty-state";
import {
  fetchApi,
  type PerformanceBucket,
  type PerformanceIntelligenceReport
} from "../../../lib/signalpilot-api";

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

function BucketTable({ title, buckets }: { title: string; buckets: PerformanceBucket[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {buckets.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Evaluated</th>
                <th>Skipped</th>
                <th>WinRate</th>
                <th>Avg 1d</th>
                <th>Confidence</th>
                <th>Insight</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td>{bucket.label}</td>
                  <td>{bucket.evaluatedCount}</td>
                  <td>{bucket.skippedCount}</td>
                  <td>
                    <div className="progress-cell">
                      <span>{formatPercent(bucket.winRate)}</span>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.min(Math.max(bucket.winRate, 0), 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>{formatPercent(bucket.avgReturnAfter1d)}</td>
                  <td>{bucket.confidenceLevel}</td>
                  <td>{bucket.insight}</td>
                  <td>{bucket.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Keine Buckets gefunden." />
      )}
    </section>
  );
}

export default async function PerformancePage() {
  const report = await fetchApi<PerformanceIntelligenceReport>("/performance/report");
  const data = report.data;

  return (
    <>
      <div className="page-header">
        <h1>Performance Intelligence</h1>
        <p>Paper Evaluation patterns by signal type, timeframe, asset, score and risk.</p>
      </div>

      {report.error ? (
        <ErrorState title="Could not load performance report" message={report.error} />
      ) : null}

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Total</span>
          <span className="metric-value">{data?.totalEvaluations ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Evaluated</span>
          <span className="metric-value">{data?.evaluatedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Skipped</span>
          <span className="metric-value">{data?.skippedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">WinRate</span>
          <span className="metric-value">{formatPercent(data?.overallWinRate)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Avg Return 1d</span>
          <span className="metric-value">{formatPercent(data?.overallAvgReturnAfter1d)}</span>
        </div>
      </section>

      {data ? (
        <>
          <section className="card" style={{ marginTop: 16 }}>
            <h2>Overall Summary</h2>
            <p>{data.summary}</p>
            {data.warnings.length > 0 ? (
              <ul>
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="grid two" style={{ marginTop: 16 }}>
            <BucketTable title="Best Signal Types" buckets={data.bestSignalTypes} />
            <BucketTable title="Worst Signal Types" buckets={data.worstSignalTypes} />
            <BucketTable title="Best Timeframes" buckets={data.bestTimeframes} />
            <BucketTable title="Worst Timeframes" buckets={data.worstTimeframes} />
            <BucketTable title="Best Assets" buckets={data.bestAssets} />
            <BucketTable title="Worst Assets" buckets={data.worstAssets} />
          </div>

          <div className="grid two" style={{ marginTop: 16 }}>
            <BucketTable title="Score Buckets" buckets={data.scoreBuckets} />
            <BucketTable title="Risk Buckets" buckets={data.riskBuckets} />
            <BucketTable title="Status Buckets" buckets={data.statusBuckets} />
          </div>
        </>
      ) : null}
    </>
  );
}
