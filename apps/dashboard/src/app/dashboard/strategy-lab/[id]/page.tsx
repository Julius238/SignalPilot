import Link from "next/link";

import { DebugJsonBlock } from "../../../../components/debug-json-block";
import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../../components/ui";
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

function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" ? `${v.toFixed(2)}%` : "—";
}

function GroupedSection({
  title,
  rows
}: {
  title: string;
  rows: BacktestGroupSummary[];
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <p className="context-block-title">{title}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gruppe</th>
              <th>Datenpunkte</th>
              <th>Ausgewertet</th>
              <th>Trefferquote</th>
              <th>Ø 1d Kursänd.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{row.totalSignals}</td>
                <td
                  style={{
                    color:
                      row.evaluatedCount < 10
                        ? "var(--bad)"
                        : row.evaluatedCount < 30
                          ? "var(--warn)"
                          : undefined
                  }}
                >
                  {row.evaluatedCount}
                  {row.evaluatedCount < 30 ? " ⚠" : ""}
                </td>
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

export default async function StrategyLabDetailPage({ params }: StrategyLabDetailPageProps) {
  const { id } = await params;
  const [run, summary, results] = await Promise.all([
    fetchApi<StrategyComparisonRun>(`/strategy/comparisons/${encodeURIComponent(id)}`),
    fetchApi<StrategyComparisonSummary>(
      `/strategy/comparisons/${encodeURIComponent(id)}/summary`
    ),
    fetchApi<StrategyBacktestResult[]>(
      `/strategy/comparisons/${encodeURIComponent(id)}/results`
    )
  ]);
  const errors = [run.error, summary.error, results.error].filter(Boolean);
  const runData = run.data;

  return (
    <>
      {/* Breadcrumb */}
      <p className="page-header-breadcrumb" style={{ marginBottom: 12 }}>
        <Link href="/dashboard/strategy-lab">Strategy Lab</Link>
        {" / "}
        <span>{runData?.name ?? id}</span>
      </p>

      <PageHeader
        title={runData?.name ?? "Strategie-Vergleich"}
        subtitle="Hypothetischer Strategievergleich · keine echten Trades · reine Forschungsgrundlage"
      />

      {errors.length > 0 ? (
        <ErrorState
          title="Vergleich konnte nicht geladen werden"
          message={errors.join(" | ")}
        />
      ) : null}

      {/* Zusammenfassung */}
      {summary.data ? (
        <div className="grid metrics" style={{ marginBottom: 20 }}>
          <MetricCard
            label="Beste Strategie"
            value={summary.data.bestStrategy ?? "—"}
          />
          <MetricCard
            label="Trefferquote (beste)"
            value={formatPercent(summary.data.bestWinRate)}
            sub="hypothetisch · kleine Stichproben möglich"
          />
          <MetricCard
            label="Höchste Ø 1d-Kursänd."
            value={summary.data.highestAvgReturnStrategy ?? "—"}
          />
          <MetricCard
            label="Verglichene Strategien"
            value={summary.data.totalStrategies}
          />
        </div>
      ) : null}

      {/* Ergebnis-Übersicht */}
      <SectionCard title="Ergebnis-Übersicht (hypothetisch)">
        {!results.data || results.data.length === 0 ? (
          <EmptyState title="Keine Ergebnisse gefunden." />
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>
              Alle Werte sind hypothetisch. ⚠ zeigt Zeilen mit weniger als 30 Datenpunkten an.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rang</th>
                    <th>Strategie</th>
                    <th>Datenpunkte</th>
                    <th>Ausgewertet</th>
                    <th>Trefferquote</th>
                    <th>Ø 1d Kursänd.</th>
                    <th>Positiv</th>
                    <th>Negativ</th>
                    <th>Neutral</th>
                    <th>Beob.-Ziel</th>
                    <th>Invalidiert</th>
                  </tr>
                </thead>
                <tbody>
                  {results.data.map((result) => (
                    <tr key={result.id}>
                      <td>{result.rank ?? "—"}</td>
                      <td>{result.strategyName}</td>
                      <td>
                        {result.totalSignals}
                        {result.totalSignals < 30 ? (
                          <span style={{ color: "var(--bad)", marginLeft: 3 }} title="Kleine Datenbasis">⚠</span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          color:
                            result.evaluatedCount < 10
                              ? "var(--bad)"
                              : result.evaluatedCount < 30
                                ? "var(--warn)"
                                : undefined
                        }}
                      >
                        {result.evaluatedCount}
                      </td>
                      <td>{formatPercent(result.winRate)}</td>
                      <td>{formatPercent(result.avgReturnAfter1d)}</td>
                      <td style={{ color: "var(--good)" }}>{result.positiveCount}</td>
                      <td style={{ color: "var(--bad)" }}>{result.negativeCount}</td>
                      <td>{result.neutralCount}</td>
                      <td>{result.targetReachedCount}</td>
                      <td>{result.invalidatedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {/* Pro-Strategie-Details (eingeklappt) */}
      {(results.data ?? []).length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <SectionCard title="Strategie-Details (aufklappbar)">
            <p className="muted small" style={{ marginBottom: 12 }}>
              Detaillierte Gruppenauswertungen pro Strategie. Bei kleiner Stichprobe eingeschränkte Belastbarkeit.
            </p>
            {(results.data ?? []).map((result) => (
              <details key={result.id} style={{ marginBottom: 8 }}>
                <summary>
                  {result.rank != null ? `#${result.rank} · ` : ""}
                  {result.strategyName}
                  {" — "}
                  <span className="muted small">
                    {result.totalSignals} Datenpunkte · TQ: {formatPercent(result.winRate)}
                  </span>
                </summary>
                <div style={{ paddingTop: 10 }}>
                  {(result.summaryJson.warnings ?? []).length > 0 ? (
                    <ul className="warning-list" style={{ marginBottom: 10 }}>
                      {(result.summaryJson.warnings ?? []).map((w, i) => (
                        <li key={i} className="warning-item">
                          <span className="warning-icon">⚠</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <GroupedSection
                    title="Nach Symbol"
                    rows={result.summaryJson.groupedBySymbol ?? []}
                  />
                  <GroupedSection
                    title="Nach Zeitrahmen"
                    rows={result.summaryJson.groupedByTimeframe ?? []}
                  />
                  <GroupedSection
                    title="Nach Signaltyp"
                    rows={result.summaryJson.groupedBySignalType ?? []}
                  />
                  <GroupedSection
                    title="Nach Score-Gruppe"
                    rows={result.summaryJson.groupedByScoreBucket ?? []}
                  />
                  <div style={{ marginTop: 12 }}>
                    <DebugJsonBlock
                      label="Strategiekonfiguration"
                      data={result.strategyConfig.configJson}
                    />
                  </div>
                </div>
              </details>
            ))}
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
