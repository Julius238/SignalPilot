import { ErrorState, EmptyState } from "../../../../components/empty-state";
import {
  fetchApi,
  type BacktestGroupSummary,
  type StrategyBacktestResult,
  type StrategyComparisonRun,
  type StrategyComparisonSummary
} from "../../../../lib/signalpilot-api";

type StrategyLabDetailPageProps = {
  params: Promise<{ id: string }>;
};

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

export default async function StrategyLabDetailPage({ params }: StrategyLabDetailPageProps) {
  const { id } = await params;
  const [run, summary, results] = await Promise.all([
    fetchApi<StrategyComparisonRun>(`/strategy/comparisons/${encodeURIComponent(id)}`),
    fetchApi<StrategyComparisonSummary>(`/strategy/comparisons/${encodeURIComponent(id)}/summary`),
    fetchApi<StrategyBacktestResult[]>(`/strategy/comparisons/${encodeURIComponent(id)}/results`)
  ]);
  const errors = [run.error, summary.error, results.error].filter(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{run.data?.name ?? "Strategy Comparison"}</h1>
          <p>Historical hypothetical comparison of rule sets and strategy configs.</p>
        </div>
      </div>

      {errors.length > 0 ? <ErrorState title="Could not load comparison" message={errors.join(" | ")} /> : null}

      {summary.data ? (
        <section className="grid metrics">
          <Metric label="Best Strategy" value={summary.data.bestStrategy ?? "-"} />
          <Metric label="Best WinRate" value={formatPercent(summary.data.bestWinRate)} />
          <Metric label="Highest Avg 1d" value={summary.data.highestAvgReturnStrategy ?? "-"} />
          <Metric label="Compared" value={String(summary.data.totalStrategies)} />
        </section>
      ) : null}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Results</h2>
        {!results.data || results.data.length === 0 ? (
          <EmptyState title="Keine Results gefunden." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Strategy</th>
                  <th>Total</th>
                  <th>Evaluated</th>
                  <th>WinRate</th>
                  <th>Avg 1d</th>
                  <th>Positive</th>
                  <th>Negative</th>
                  <th>Neutral</th>
                  <th>Target Reached</th>
                  <th>Invalidated</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {results.data.map((result) => (
                  <tr key={result.id}>
                    <td>{result.rank ?? "-"}</td>
                    <td>{result.strategyName}</td>
                    <td>{result.totalSignals}</td>
                    <td>{result.evaluatedCount}</td>
                    <td>{formatPercent(result.winRate)}</td>
                    <td>{formatPercent(result.avgReturnAfter1d)}</td>
                    <td>{result.positiveCount}</td>
                    <td>{result.negativeCount}</td>
                    <td>{result.neutralCount}</td>
                    <td>{result.targetReachedCount}</td>
                    <td>{result.invalidatedCount}</td>
                    <td>{(result.summaryJson.warnings ?? []).join(" | ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(results.data ?? []).map((result) => (
        <section className="card" style={{ marginTop: 16 }} key={result.id}>
          <h2>{result.strategyName}</h2>
          <pre>{JSON.stringify(result.strategyConfig.configJson, null, 2)}</pre>
          <GroupedTable title="By Symbol" rows={result.summaryJson.groupedBySymbol ?? []} />
          <GroupedTable title="By Timeframe" rows={result.summaryJson.groupedByTimeframe ?? []} />
          <GroupedTable title="By Signal Type" rows={result.summaryJson.groupedBySignalType ?? []} />
          <GroupedTable title="By Score Bucket" rows={result.summaryJson.groupedByScoreBucket ?? []} />
        </section>
      ))}
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

function GroupedTable({ title, rows }: { title: string; rows: BacktestGroupSummary[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h3>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Total</th>
              <th>Evaluated</th>
              <th>WinRate</th>
              <th>Avg 1d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{row.totalSignals}</td>
                <td>{row.evaluatedCount}</td>
                <td>{formatPercent(row.winRate)}</td>
                <td>{formatPercent(row.avgReturnAfter1d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
