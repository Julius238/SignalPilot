import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime } from "../../../lib/format";
import {
  fetchApi,
  type StrategyComparisonRun,
  type StrategyConfig
} from "../../../lib/signalpilot-api";

function formatList(values: unknown[]) {
  return values.length > 0 ? values.join(", ") : "-";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

export default async function StrategyLabPage() {
  const [configs, comparisons] = await Promise.all([
    fetchApi<StrategyConfig[]>("/strategy/configs"),
    fetchApi<StrategyComparisonRun[]>("/strategy/comparisons?limit=50")
  ]);
  const errors = [configs.error, comparisons.error].filter(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Strategy Lab</h1>
          <p>Historical hypothetical comparison of rule sets and strategy configs.</p>
        </div>
      </div>

      {errors.length > 0 ? <ErrorState title="Could not load Strategy Lab" message={errors.join(" | ")} /> : null}

      <section className="card">
        <h2>Strategy Configs</h2>
        {!configs.data || configs.data.length === 0 ? (
          <EmptyState title="Keine Strategy Configs gefunden." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Default</th>
                  <th>Description</th>
                  <th>Config</th>
                </tr>
              </thead>
              <tbody>
                {configs.data.map((config) => (
                  <tr key={config.id}>
                    <td>{config.name}</td>
                    <td>{config.isDefault ? "Yes" : "No"}</td>
                    <td>{config.description ?? "-"}</td>
                    <td>
                      <code>{JSON.stringify(config.configJson)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Comparison Runs</h2>
        {!comparisons.data || comparisons.data.length === 0 ? (
          <EmptyState title="Keine Strategy Comparisons gefunden." />
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
                  <th>Started</th>
                  <th>Best Strategy</th>
                  <th>Best WinRate</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.data.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/dashboard/strategy-lab/${encodeURIComponent(run.id)}`}>{run.name}</Link>
                    </td>
                    <td>{run.status}</td>
                    <td>
                      {formatDateTime(run.from)} - {formatDateTime(run.to)}
                    </td>
                    <td>{formatList(run.symbols)}</td>
                    <td>{formatList(run.timeframes)}</td>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>{run.bestStrategy ?? "-"}</td>
                    <td>{formatPercent(run.bestWinRate)}</td>
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
