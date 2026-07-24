import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/ui";
import { formatDateTime } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type AssetCoverage,
  type DataQualityReport
} from "../../../lib/signalpilot-api";

type DataQualityPageProps = {
  searchParams: Promise<{
    assetType?: string;
    minQualityScore?: string;
  }>;
};

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "—";
}

function QualityBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "var(--good)" : score >= 50 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="progress-cell">
      <span style={{ color, fontWeight: 700 }}>{score}</span>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
    </div>
  );
}

function TimeframeCoverage({ asset }: { asset: AssetCoverage }) {
  return (
    <div className="stack-list compact">
      {Object.entries(asset.candleCountsByTimeframe).map(([timeframe, count]) => {
        const ok = asset.hasMinimumCandlesByTimeframe[timeframe];
        return (
          <div key={timeframe} className="list-row">
            <strong>{timeframe}</strong>
            <span style={{ color: ok ? undefined : "var(--bad)" }}>
              {count} {ok ? "" : "↓ zu wenig"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function parseWarningAction(warning: string): { what: string; action: string } {
  const w = warning.toLowerCase();

  if (w.includes("evaluation") || w.includes("eval")) {
    return {
      what: warning,
      action: "Evaluations-Pipeline prüfen oder manuell für betroffene Signale ausführen."
    };
  }
  if (w.includes("candle") || w.includes("kerze") || w.includes("kurs")) {
    return {
      what: warning,
      action: "Datenquelle prüfen — Candle-Sync möglicherweise unterbrochen."
    };
  }
  if (w.includes("alert")) {
    return {
      what: warning,
      action: "Alert-Konfiguration und Webhook-Verbindung überprüfen."
    };
  }
  if (w.includes("signal")) {
    return {
      what: warning,
      action: "Signal-Pipeline neu ausführen oder betroffenes Asset in der Watchlist prüfen."
    };
  }
  if (w.includes("coverage") || w.includes("abdeckung")) {
    return {
      what: warning,
      action: "Fehlende Daten im Asset-Coverage-Bereich unten identifizieren."
    };
  }
  return {
    what: warning,
    action: "Details in der Asset-Coverage-Tabelle unten prüfen."
  };
}

export default async function DataQualityPage({ searchParams }: DataQualityPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    assetType: params.assetType,
    minQualityScore: params.minQualityScore,
    limit: 100
  });
  const [report, assets] = await Promise.all([
    fetchApi<DataQualityReport>("/data-quality/report"),
    fetchApi<AssetCoverage[]>(`/data-quality/assets${query}`)
  ]);
  const data = report.data;

  const hasWarnings = (data?.warnings.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Datenqualität"
        subtitle="Wie vollständig und frisch Markt-, Signal- und Auswertungsdaten aktuell sind."
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/performance">
            Performance ansehen
          </Link>
        }
      />

      {report.error ? <ErrorState title="Qualitätsbericht nicht verfügbar" message={report.error} /> : null}
      {assets.error ? <ErrorState title="Asset-Coverage nicht verfügbar" message={assets.error} /> : null}

      <form className="filter-bar">
        <label>
          Asset-Typ
          <select name="assetType" defaultValue={params.assetType ?? ""}>
            <option value="">Alle</option>
            <option value="CRYPTO">CRYPTO</option>
            <option value="STOCK">STOCK</option>
            <option value="ETF">ETF</option>
          </select>
        </label>
        <label>
          Min. Qualitätsscore
          <input name="minQualityScore" defaultValue={params.minQualityScore ?? ""} inputMode="numeric" />
        </label>
        <button type="submit">Anwenden</button>
      </form>

      {/* ── Übersichtsmetriken ── */}
      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Signale gesamt</span>
          <strong className="metric-value">{data?.signalCoverage.totalSignals ?? 0}</strong>
        </div>
        <div className="card">
          <span className="metric-label">Signale (24 h)</span>
          <strong className="metric-value">{data?.signalCoverage.signalsLast24h ?? 0}</strong>
          <span className="muted small">neue Signale heute</span>
        </div>
        <div className="card">
          <span className="metric-label">Ohne Evaluation</span>
          <strong
            className="metric-value"
            style={{
              color:
                (data?.signalCoverage.signalsWithoutEvaluation ?? 0) > 0
                  ? "var(--warn)"
                  : undefined
            }}
          >
            {data?.signalCoverage.signalsWithoutEvaluation ?? 0}
          </strong>
          <span className="muted small">noch nicht ausgewertet</span>
        </div>
        <div className="card">
          <span className="metric-label">Eval-Abdeckung</span>
          <strong className="metric-value">
            {formatPercent(data?.signalCoverage.evaluationCoverageRate)}
          </strong>
          <span className="muted small">Anteil evaluierter Signale</span>
        </div>
        <div className="card">
          <span className="metric-label">Übersprungen</span>
          <strong
            className="metric-value"
            style={{
              color:
                (data?.evaluationCoverage.skippedRate ?? 0) > 20
                  ? "var(--warn)"
                  : undefined
            }}
          >
            {formatPercent(data?.evaluationCoverage.skippedRate)}
          </strong>
          <span className="muted small">Evaluations übersprungen</span>
        </div>
        <div className="card">
          <span className="metric-label">Erfolgreiche Alerts</span>
          <strong className="metric-value">
            {data?.alertCoverage.successfulAlertCount ?? 0}
          </strong>
          <span className="muted small">zugestellte Alerts</span>
        </div>
      </section>

      {data ? (
        <>
          <section className="card" style={{ marginTop: 16 }}>
            <h2>Provider-Coverage</h2>
            <p className="muted small">
              Persistente Messwerte aus inkrementellem Import, Initial-Backfill und Gap-Audit.
            </p>
            {data.providerHealth.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Coverage</th>
                      <th>Kerzen</th>
                      <th>Lücken</th>
                      <th>Veraltet</th>
                      <th>Providerfehler</th>
                      <th>Rate Limits</th>
                      <th>403</th>
                      <th>no_data</th>
                      <th>Letzter Erfolg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providerHealth.map((provider) => (
                      <tr key={provider.provider}>
                        <td><strong>{provider.provider}</strong></td>
                        <td>{formatPercent(provider.coveragePercent)}</td>
                        <td>{provider.candleCount} / {provider.expectedCandleCount}</td>
                        <td style={{ color: provider.gapCount > 0 ? "var(--warn)" : undefined }}>
                          {provider.gapCount} ({provider.missingCandleCount} Kerzen)
                        </td>
                        <td style={{ color: provider.staleSeriesCount > 0 ? "var(--warn)" : undefined }}>
                          {provider.staleSeriesCount}
                        </td>
                        <td>{provider.providerErrorCount}</td>
                        <td>{provider.rateLimitCount}</td>
                        <td style={{ color: provider.entitlementErrorCount > 0 ? "var(--bad)" : undefined }}>
                          {provider.entitlementErrorCount}
                        </td>
                        <td>{provider.noDataCount}</td>
                        <td>
                          {provider.lastSuccessfulFetchAt
                            ? formatDateTime(provider.lastSuccessfulFetchAt)
                            : "Noch keiner"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Noch keine Provider-Messwerte."
                description="Führe zunächst einen Candle-Import oder Gap-Audit aus."
              />
            )}
          </section>

          <section className="grid metrics" style={{ marginTop: 16 }}>
            <div className="card">
              <span className="metric-label">News gespeichert</span>
              <strong className="metric-value">{data.newsCoverage.totalStored}</strong>
              <span className="muted small">{data.newsCoverage.storedLast7Days} in 7 Tagen</span>
            </div>
            <div className="card">
              <span className="metric-label">Relevant (72 h)</span>
              <strong className="metric-value">{data.newsCoverage.relevantLast72Hours}</strong>
              <span className="muted small">Relevanz mindestens 30/100</span>
            </div>
            <div className="card">
              <span className="metric-label">Dashboard-only</span>
              <strong className="metric-value">{data.newsCoverage.dashboardOnlyCount}</strong>
              <span className="muted small">Rohmeldungen unter der Schwelle</span>
            </div>
            <div className="card">
              <span className="metric-label">Duplikate (7 Tage)</span>
              <strong className="metric-value">{data.newsCoverage.duplicateCount}</strong>
              <span className="muted small">zusammengeführt statt neu gespeichert</span>
            </div>
            <div className="card">
              <span className="metric-label">Verworfen (7 Tage)</span>
              <strong className="metric-value">{data.newsCoverage.discardedCount}</strong>
              <span className="muted small">unklassifizierte Meldungen bleiben erhalten</span>
            </div>
          </section>
        </>
      ) : null}

      {data ? (
        <div className="grid two" style={{ marginTop: 16 }}>
          {/* ── Warnungen (action-orientiert) ── */}
          <section className="card">
            <h2>
              Warnungen{" "}
              {hasWarnings ? (
                <span className="badge alert-pending" style={{ marginLeft: 8 }}>
                  {data.warnings.length}
                </span>
              ) : (
                <span className="badge alert-sent" style={{ marginLeft: 8 }}>
                  OK
                </span>
              )}
            </h2>

            {hasWarnings ? (
              <div className="stack-list" style={{ marginTop: 8 }}>
                {data.warnings.map((warning) => {
                  const { what, action } = parseWarningAction(warning);
                  return (
                    <div
                      key={warning}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 6,
                        background: "rgba(210,153,34,0.08)",
                        border: "1px solid rgba(210,153,34,0.3)",
                        marginBottom: 8
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color: "var(--warn)", fontSize: 14, lineHeight: 1.4 }}>⚠</span>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{what}</div>
                          <div className="muted small">
                            <strong>Nächster Schritt:</strong> {action}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 8 }}>
                Keine Datenqualitätsprobleme erkannt.
              </p>
            )}
          </section>

          {/* ── Empfehlungen ── */}
          <section className="card">
            <h2>Empfehlungen</h2>
            {data.recommendations.length > 0 ? (
              <div className="stack-list" style={{ marginTop: 8 }}>
                {data.recommendations.map((rec) => (
                  <div
                    key={rec}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 6,
                      background: "rgba(88,166,255,0.07)",
                      border: "1px solid rgba(88,166,255,0.2)",
                      marginBottom: 8
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "var(--accent)", fontSize: 14 }}>→</span>
                      <span>{rec}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 8 }}>
                Keine Empfehlungen vorhanden.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {/* ── Asset-Coverage-Tabelle ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Asset-Coverage</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>
          Score &lt; 50 = kritische Datenlücke. Score 50–80 = Verbesserungsbedarf. Score &gt; 80 = gut.
        </p>
        {assets.data && assets.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Typ</th>
                  <th>Score</th>
                  <th>Candles</th>
                  <th>Signale</th>
                  <th>Evaluations</th>
                  <th>Übersprungen</th>
                  <th>Events</th>
                  <th>Alerts</th>
                  <th>Letztes Signal (1h)</th>
                  <th>Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.map((asset) => (
                  <tr key={asset.symbol}>
                    <td>
                      <Link href={`/dashboard/assets/${encodeURIComponent(asset.symbol)}`}>
                        {asset.symbol}
                      </Link>
                    </td>
                    <td>{asset.assetType}</td>
                    <td>
                      <QualityBar score={asset.qualityScore} />
                    </td>
                    <td>
                      <TimeframeCoverage asset={asset} />
                    </td>
                    <td>{asset.signalCount}</td>
                    <td>{asset.evaluationCount}</td>
                    <td
                      style={{
                        color: asset.skippedEvaluationCount > 0 ? "var(--warn)" : undefined
                      }}
                    >
                      {asset.skippedEvaluationCount}
                    </td>
                    <td>
                      {asset.hasEventsInWindow === null ? (
                        <span className="muted">n/a</span>
                      ) : asset.hasEventsInWindow ? (
                        <span className="badge alert-sent">vorhanden</span>
                      ) : (
                        <span className="badge alert-pending">fehlt</span>
                      )}
                    </td>
                    <td>{asset.alertCount}</td>
                    <td className="muted small">{formatDateTime(asset.latestSignalByTimeframe["1h"])}</td>
                    <td>
                      {asset.warnings.length > 0 ? (
                        <span style={{ color: "var(--warn)", fontSize: 12 }}>
                          {asset.warnings.join(" · ")}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Keine Asset-Coverage gefunden." />
        )}
      </section>
    </>
  );
}
