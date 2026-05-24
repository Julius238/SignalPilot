import Link from "next/link";

import { DebugJsonBlock } from "../../../../components/debug-json-block";
import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../../components/ui";
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

function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—";
}

function reliabilityNote(n: number): string | undefined {
  if (n < 30) return "⚠ Kleine Datenbasis";
  if (n < 100) return "Begrenzte Stichprobe";
  return undefined;
}

const OUTCOME_LABELS: Record<string, string> = {
  POSITIVE: "Positiv",
  NEGATIVE: "Negativ",
  NEUTRAL: "Neutral",
  TARGET_REACHED: "Beobachtungsziel",
  INVALIDATED: "Invalidiert",
  OPEN: "Offen",
  EVALUATED: "Ausgewertet",
  EXPIRED: "Abgelaufen",
  SKIPPED: "Übersprungen"
};

function outcomeColor(outcome: string): string | undefined {
  if (outcome === "POSITIVE" || outcome === "TARGET_REACHED") return "var(--good)";
  if (outcome === "NEGATIVE" || outcome === "INVALIDATED") return "var(--bad)";
  return undefined;
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
    <div style={{ marginTop: 16 }}>
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
                  {row.evaluatedCount < 30 ? (
                    <span title="Kleine Datenbasis" style={{ marginLeft: 3 }}>⚠</span>
                  ) : null}
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

export default async function BacktestDetailPage({ params }: BacktestDetailPageProps) {
  const { id } = await params;
  const [run, summary, signals] = await Promise.all([
    fetchApi<BacktestRun>(`/backtests/${encodeURIComponent(id)}`),
    fetchApi<BacktestSummary>(`/backtests/${encodeURIComponent(id)}/summary`),
    fetchApi<BacktestSignal[]>(`/backtests/${encodeURIComponent(id)}/signals?limit=200`)
  ]);
  const errors = [run.error, summary.error, signals.error].filter(Boolean);
  const data = summary.data;
  const runData = run.data;

  return (
    <>
      {/* Breadcrumb */}
      <p className="page-header-breadcrumb" style={{ marginBottom: 12 }}>
        <Link href="/dashboard/backtests">Backtest-Analysen</Link>
        {" / "}
        <span>{runData?.name ?? id}</span>
      </p>

      <PageHeader
        title={runData?.name ?? "Backtest-Analyse"}
        subtitle="Hypothetische historische Auswertung · keine echten Trades · reine Forschungsgrundlage"
      />

      {errors.length > 0 ? (
        <ErrorState
          title="Backtest konnte nicht geladen werden"
          message={errors.join(" | ")}
        />
      ) : null}

      {data ? (
        <>
          {/* Datenbasis-Hinweis bei kleiner Stichprobe */}
          {data.evaluatedCount < 30 ? (
            <div className="warning-section" style={{ marginBottom: 16 }}>
              <h3 className="warning-section-title">
                Hinweis zur Datenbasis (n={data.evaluatedCount})
              </h3>
              <p className="muted small" style={{ margin: 0 }}>
                Die Stichprobengröße ist zu klein für belastbare Schlussfolgerungen.
                Ergebnisse sollten als erste Orientierung, nicht als gesicherte Aussage
                betrachtet werden. Mindestens 30–100 Datenpunkte werden empfohlen.
              </p>
            </div>
          ) : null}

          {/* Kern-Metriken */}
          <div className="grid metrics" style={{ marginBottom: 20 }}>
            <MetricCard
              label="Datenpunkte"
              value={data.totalSignals}
              sub={reliabilityNote(data.totalSignals)}
            />
            <MetricCard
              label="Ausgewertet"
              value={data.evaluatedCount}
              sub={`${data.totalSignals > 0 ? Math.round((data.evaluatedCount / data.totalSignals) * 100) : 0}% der Datenpunkte`}
            />
            <MetricCard
              label={`Trefferquote (n=${data.evaluatedCount})`}
              value={formatPercent(data.winRate)}
              sub={reliabilityNote(data.evaluatedCount)}
            />
            <MetricCard label="Ø 1h Kursänd." value={formatPercent(data.avgReturnAfter1h)} />
            <MetricCard label="Ø 4h Kursänd." value={formatPercent(data.avgReturnAfter4h)} />
            <MetricCard label="Ø 1d Kursänd." value={formatPercent(data.avgReturnAfter1d)} />
            <MetricCard label="Ø 3d Kursänd." value={formatPercent(data.avgReturnAfter3d)} />
          </div>

          {/* Ergebnis-Verteilung */}
          <div className="grid metrics" style={{ marginBottom: 20 }}>
            <MetricCard
              label="Positiv"
              value={<span style={{ color: "var(--good)" }}>{data.positiveCount}</span>}
            />
            <MetricCard
              label="Negativ"
              value={<span style={{ color: "var(--bad)" }}>{data.negativeCount}</span>}
            />
            <MetricCard label="Neutral" value={data.neutralCount} />
            <MetricCard label="Beobachtungsziel" value={data.targetReachedCount} />
            <MetricCard label="Invalidiert" value={data.invalidatedCount} />
          </div>

          {/* Warnungen zur Datenbasis */}
          {data.warnings.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <SectionCard title="Hinweise zur Datenbasis">
                <ul className="warning-list">
                  {data.warnings.map((w) => (
                    <li key={w} className="warning-item">
                      <span className="warning-icon">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          ) : null}

          {/* Gruppenauswertungen */}
          <SectionCard title="Gruppenauswertungen (hypothetisch)">
            <p className="muted small" style={{ marginBottom: 12 }}>
              ⚠ bei weniger als 30 Datenpunkten ist die Belastbarkeit eingeschränkt.
            </p>
            <GroupedSection title="Nach Symbol" rows={data.groupedBySymbol} />
            <GroupedSection title="Nach Zeitrahmen" rows={data.groupedByTimeframe} />
            <GroupedSection title="Nach Signaltyp" rows={data.groupedBySignalType} />
            <GroupedSection title="Nach Score-Gruppe" rows={data.groupedByScoreBucket} />
          </SectionCard>
        </>
      ) : (
        <EmptyState title="Keine Zusammenfassung verfügbar." />
      )}

      {/* Einzelsignale (eingeklappt) */}
      <div style={{ marginTop: 16 }}>
        <SectionCard title="Einzelsignale (Rohdaten)">
          {!signals.data || signals.data.length === 0 ? (
            <EmptyState title="Keine Signale gefunden." />
          ) : (
            <details>
              <summary>
                {signals.data.length} Signale anzeigen
              </summary>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>TF</th>
                      <th>Zeitpunkt</th>
                      <th>Status</th>
                      <th>Signaltyp</th>
                      <th>Score</th>
                      <th>Ergebnis</th>
                      <th>Kursänd. 1d</th>
                      <th>Max. Positiv</th>
                      <th>Max. Negativ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.data.map((sig) => {
                      const outcome = sig.outcome ?? sig.outcomeStatus;
                      return (
                        <tr key={sig.id}>
                          <td>{sig.symbol}</td>
                          <td>{sig.timeframe}</td>
                          <td className="nowrap">{formatDateTime(sig.signalTime)}</td>
                          <td>{sig.status}</td>
                          <td>{sig.signalType}</td>
                          <td>{formatScore(sig.score)}</td>
                          <td style={{ color: outcomeColor(outcome ?? "") }}>
                            {OUTCOME_LABELS[outcome ?? ""] ?? outcome ?? "—"}
                          </td>
                          <td>{formatPercent(sig.returnAfter1d)}</td>
                          <td style={{ color: "var(--good)" }}>
                            {sig.maxFavorableMove != null
                              ? `+${sig.maxFavorableMove.toFixed(2)}%`
                              : "—"}
                          </td>
                          <td style={{ color: "var(--bad)" }}>
                            {sig.maxAdverseMove != null
                              ? `${sig.maxAdverseMove.toFixed(2)}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </SectionCard>
      </div>

      {/* Debug */}
      {runData ? (
        <div style={{ marginTop: 16 }}>
          <SectionCard title="Konfiguration (Debug)">
            <DebugJsonBlock label="Backtest-Konfiguration" data={runData.configJson} />
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
