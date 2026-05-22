import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime, formatScore } from "../../../lib/format";
import { fetchApi, type BacktestRun } from "../../../lib/signalpilot-api";

function formatList(values: unknown[]) {
  return values.length > 0 ? values.join(", ") : "-";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

export default async function BacktestsPage() {
  const runs = await fetchApi<BacktestRun[]>("/backtests?limit=50");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Backtests</h1>
          <p>Hypothetical historical outcome analysis for technical SignalPilot signals.</p>
        </div>
      </div>

      {runs.error ? <ErrorState title="Could not load backtests" message={runs.error} /> : null}

      <section className="card">
        <h2>Backtest Runs</h2>
        {!runs.data || runs.data.length === 0 ? (
          <EmptyState title="Keine Backtest Runs gefunden." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Period</th>
                  <th>Symbols</th>
                  <th>Timeframes</th>
                  <th>Signals</th>
                  <th>WinRate</th>
                  <th>Avg 1d</th>
                  <th>Started</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/dashboard/backtests/${encodeURIComponent(run.id)}`}>{run.name}</Link>
                    </td>
                    <td>{run.status}</td>
                    <td>
                      {formatDateTime(run.from)} - {formatDateTime(run.to)}
                    </td>
                    <td>{formatList(run.symbols)}</td>
                    <td>{formatList(run.timeframes)}</td>
                    <td>{run.totalSignals}</td>
                    <td>{formatPercent(run.winRate)}</td>
                    <td>{formatScore(run.avgReturnAfter1d)}</td>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>{run.finishedAt ? formatDateTime(run.finishedAt) : "-"}</td>
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
