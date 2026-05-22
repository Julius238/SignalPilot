import { ErrorState, EmptyState } from "../../../../components/empty-state";
import { formatDateTime, formatScore } from "../../../../lib/format";
import {
  fetchApi,
  type BacktestGroupSummary,
  type BacktestRun,
  type BacktestSignal,
  type BacktestSummary
} from "../../../../lib/signalpilot-api";

type BacktestDetailPageProps = {
  params: Promise<{ id: string }>;
};

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

export default async function BacktestDetailPage({ params }: BacktestDetailPageProps) {
  const { id } = await params;
  const [run, summary, signals] = await Promise.all([
    fetchApi<BacktestRun>(`/backtests/${encodeURIComponent(id)}`),
    fetchApi<BacktestSummary>(`/backtests/${encodeURIComponent(id)}/summary`),
    fetchApi<BacktestSignal[]>(`/backtests/${encodeURIComponent(id)}/signals?limit=200`)
  ]);
  const errors = [run.error, summary.error, signals.error].filter(Boolean);
  const data = summary.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{run.data?.name ?? "Backtest"}</h1>
          <p>Hypothetical historical outcome. No live execution or broker integration.</p>
        </div>
      </div>

      {errors.length > 0 ? <ErrorState title="Could not load backtest" message={errors.join(" | ")} /> : null}

      {data ? (
        <>
          <section className="grid metrics">
            <Metric label="Signals" value={String(data.totalSignals)} />
            <Metric label="Evaluated" value={String(data.evaluatedCount)} />
            <Metric label="WinRate" value={formatPercent(data.winRate)} />
            <Metric label="Avg 1h" value={formatPercent(data.avgReturnAfter1h)} />
            <Metric label="Avg 4h" value={formatPercent(data.avgReturnAfter4h)} />
            <Metric label="Avg 1d" value={formatPercent(data.avgReturnAfter1d)} />
            <Metric label="Avg 3d" value={formatPercent(data.avgReturnAfter3d)} />
          </section>

          <section className="grid metrics" style={{ marginTop: 16 }}>
            <Metric label="Positive" value={String(data.positiveCount)} />
            <Metric label="Negative" value={String(data.negativeCount)} />
            <Metric label="Neutral" value={String(data.neutralCount)} />
            <Metric label="Target Reached" value={String(data.targetReachedCount)} />
            <Metric label="Invalidated" value={String(data.invalidatedCount)} />
          </section>

          {data.warnings.length > 0 ? (
            <section className="card" style={{ marginTop: 16 }}>
              <h2>Coverage Warnings</h2>
              <ul>
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <GroupedTable title="By Symbol" rows={data.groupedBySymbol} />
          <GroupedTable title="By Timeframe" rows={data.groupedByTimeframe} />
          <GroupedTable title="By Signal Type" rows={data.groupedBySignalType} />
          <GroupedTable title="By Score Bucket" rows={data.groupedByScoreBucket} />
        </>
      ) : (
        <EmptyState title="Keine Summary gefunden." />
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Backtest Signals</h2>
        {!signals.data || signals.data.length === 0 ? (
          <EmptyState title="Keine Backtest Signale gefunden." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Timeframe</th>
                  <th>Signal Time</th>
                  <th>Status</th>
                  <th>Signal Type</th>
                  <th>Score</th>
                  <th>Outcome</th>
                  <th>Return 1d</th>
                  <th>Max Favorable</th>
                  <th>Max Adverse</th>
                </tr>
              </thead>
              <tbody>
                {signals.data.map((signal) => (
                  <tr key={signal.id}>
                    <td>{signal.symbol}</td>
                    <td>{signal.timeframe}</td>
                    <td>{formatDateTime(signal.signalTime)}</td>
                    <td>{signal.status}</td>
                    <td>{signal.signalType}</td>
                    <td>{formatScore(signal.score)}</td>
                    <td>{signal.outcome ?? signal.outcomeStatus}</td>
                    <td>{formatPercent(signal.returnAfter1d)}</td>
                    <td>{formatPercent(signal.maxFavorableMove)}</td>
                    <td>{formatPercent(signal.maxAdverseMove)}</td>
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

function GroupedTable({ title, rows }: { title: string; rows: BacktestGroupSummary[] }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>{title}</h2>
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
    </section>
  );
}
