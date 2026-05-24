import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../components/ui";
import { formatDateTime } from "../../../lib/format";
import { fetchApi, type BacktestRun } from "../../../lib/signalpilot-api";

function formatList(values: unknown[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" ? `${v.toFixed(2)}%` : "—";
}

const STATUS_LABELS: Record<string, string> = {
  RUNNING: "Läuft",
  SUCCESS: "Abgeschlossen",
  FAILED: "Fehlgeschlagen",
  CANCELLED: "Abgebrochen"
};

export default async function BacktestsPage() {
  const runs = await fetchApi<BacktestRun[]>("/backtests?limit=50");

  return (
    <>
      <PageHeader
        title="Backtest-Analysen"
        subtitle="Hypothetische historische Auswertungen · kein Indikator für zukünftige Ergebnisse"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/strategy-lab">
            Strategy Lab →
          </Link>
        }
      />

      {runs.error ? (
        <ErrorState title="Backtest-Läufe konnten nicht geladen werden" message={runs.error} />
      ) : null}

      <SectionCard title="Backtest-Läufe">
        {!runs.data || runs.data.length === 0 ? (
          <EmptyState title="Keine Backtest-Läufe gefunden." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Zeitraum</th>
                  <th>Symbole</th>
                  <th>Zeitrahmen</th>
                  <th>Datenpunkte</th>
                  <th>Trefferquote</th>
                  <th>Ø 1d Kursänd.</th>
                  <th>Gestartet</th>
                  <th>Abgeschlossen</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/dashboard/backtests/${encodeURIComponent(run.id)}`}>
                        {run.name}
                      </Link>
                    </td>
                    <td>{STATUS_LABELS[run.status] ?? run.status}</td>
                    <td className="nowrap">
                      {formatDateTime(run.from)} – {formatDateTime(run.to)}
                    </td>
                    <td>{formatList(run.symbols)}</td>
                    <td>{formatList(run.timeframes)}</td>
                    <td>
                      {run.totalSignals}
                      {run.totalSignals < 30 ? (
                        <span style={{ color: "var(--bad)", marginLeft: 4 }} title="Kleine Datenbasis">⚠</span>
                      ) : run.totalSignals < 100 ? (
                        <span style={{ color: "var(--warn)", marginLeft: 4 }} title="Begrenzte Datenbasis">△</span>
                      ) : null}
                    </td>
                    <td>{formatPercent(run.winRate)}</td>
                    <td>{formatPercent(run.avgReturnAfter1d)}</td>
                    <td className="nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="nowrap">
                      {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
