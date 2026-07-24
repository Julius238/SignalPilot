import Link from "next/link";

import { DebugJsonBlock } from "../../../components/debug-json-block";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../components/ui";
import { formatDateTime } from "../../../lib/format";
import {
  fetchApi,
  type StrategyComparisonRun,
  type StrategyConfig
} from "../../../lib/signalpilot-api";

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

export default async function StrategyLabPage() {
  const [configs, comparisons] = await Promise.all([
    fetchApi<StrategyConfig[]>("/strategy/configs"),
    fetchApi<StrategyComparisonRun[]>("/strategy/comparisons?limit=50")
  ]);
  const errors = [configs.error, comparisons.error].filter(Boolean);

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Strategie-Labor"
        subtitle="Hypothetischer Vergleich von Strategiekonfigurationen · kein Indikator für zukünftige Ergebnisse"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/backtests">
            Backtest-Analysen →
          </Link>
        }
      />

      {errors.length > 0 ? (
        <ErrorState
          title="Strategie-Labor konnte nicht geladen werden"
          message={errors.join(" | ")}
        />
      ) : null}

      {/* Strategiekonfigurationen */}
      <SectionCard title="Strategiekonfigurationen">
        {!configs.data || configs.data.length === 0 ? (
          <EmptyState title="Keine Strategiekonfigurationen gefunden." />
        ) : (
          <div className="stack-list">
            {configs.data.map((config) => (
              <div key={config.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 14 }}>
                    {config.name}
                    {config.isDefault ? (
                      <span className="badge badge-info" style={{ marginLeft: 8, fontSize: 11 }}>
                        Standard
                      </span>
                    ) : null}
                  </strong>
                  {config.description ? (
                    <p className="muted small" style={{ margin: "2px 0 0" }}>
                      {config.description}
                    </p>
                  ) : null}
                  <div style={{ marginTop: 6 }}>
                    <DebugJsonBlock label="Konfiguration" data={config.configJson} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Vergleichs-Läufe */}
      <div style={{ marginTop: 16 }}>
        <SectionCard title="Vergleichs-Läufe">
          {!comparisons.data || comparisons.data.length === 0 ? (
            <EmptyState title="Keine Strategie-Vergleiche gefunden." />
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
                    <th>Gestartet</th>
                    <th>Beste Strategie</th>
                    <th>Trefferquote</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.data.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <Link
                          href={`/dashboard/strategy-lab/${encodeURIComponent(run.id)}`}
                        >
                          {run.name}
                        </Link>
                      </td>
                      <td>{STATUS_LABELS[run.status] ?? run.status}</td>
                      <td className="nowrap">
                        {formatDateTime(run.from)} – {formatDateTime(run.to)}
                      </td>
                      <td>{formatList(run.symbols)}</td>
                      <td>{formatList(run.timeframes)}</td>
                      <td className="nowrap">{formatDateTime(run.startedAt)}</td>
                      <td>{run.bestStrategy ?? "—"}</td>
                      <td>{formatPercent(run.bestWinRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
