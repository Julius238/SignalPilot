import Link from "next/link";

import { RegimeBadge, RiskModeBadge } from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../components/ui";
import { formatDateTime, formatScore } from "../../../lib/format";
import { fetchApi, type MarketRegimeSnapshot } from "../../../lib/signalpilot-api";

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    BULLISH: "Aufwärts",
    BEARISH: "Abwärts",
    NEUTRAL: "Neutral",
    SIDEWAYS: "Seitwärts",
    TRENDING_UP: "Aufwärts-Trend",
    TRENDING_DOWN: "Abwärts-Trend",
    RANGING: "Seitwärts-Range",
    HIGH: "Hoch",
    LOW: "Niedrig",
    MODERATE: "Moderat",
    NORMAL: "Normal",
    ELEVATED: "Erhöht",
    COMPRESSED: "Komprimiert"
  };
  return map[state] ?? state;
}

function stateColor(state: string): string | undefined {
  const u = state.toUpperCase();
  if (u.includes("BULL") || u.includes("UP") || u === "LOW" || u === "COMPRESSED") {
    return "var(--good)";
  }
  if (u.includes("BEAR") || u.includes("DOWN") || u === "HIGH" || u === "ELEVATED") {
    return "var(--bad)";
  }
  return undefined;
}

export default async function MarketRegimePage() {
  const [latest, history] = await Promise.all([
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest"),
    fetchApi<MarketRegimeSnapshot[]>("/market-regime/history?limit=50")
  ]);
  const snapshot = latest.data;
  const report = snapshot?.report ?? snapshot?.reportJson;
  const errors = [latest.error, history.error].filter(Boolean);

  return (
    <>
      <PageHeader
        eyebrow="Kontext"
        title="Marktlage"
        subtitle="Wie risikofreudig oder defensiv das Umfeld gerade ist — und was das für die Einordnung von Signalen bedeutet."
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/scanner">
            Scanner
          </Link>
        }
      />

      {errors.length > 0 ? (
        <ErrorState
          title="Markt-Regime konnte nicht geladen werden"
          message={errors.join(" | ")}
        />
      ) : null}

      {!snapshot || !report ? (
        <EmptyState title="Markt-Regime noch nicht berechnet. Pipeline ausführen." />
      ) : (
        <>
          {/* ── Aktueller Status ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <h2 className="section-title">Aktuelles Marktumfeld</h2>
              <span className="muted small">{formatDateTime(snapshot.generatedAt)}</span>
            </div>

            <div className="regime-card-content">
              <div className="regime-row">
                <RegimeBadge value={snapshot.overallRegime} />
                <RiskModeBadge value={snapshot.riskMode} />
              </div>

              <div className="confidence-bar-wrap">
                <div className="confidence-label">
                  <span>Konfidenz</span>
                  <strong>{Math.round(snapshot.confidence * 100)}%</strong>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(snapshot.confidence * 100)}%` }}
                  />
                </div>
              </div>

              <div className="health-rows">
                <div className="health-row">
                  <span className="health-row-label">Equity-Regime</span>
                  <RegimeBadge value={snapshot.equityRegime} />
                </div>
                <div className="health-row">
                  <span className="health-row-label">Crypto-Regime</span>
                  <RegimeBadge value={snapshot.cryptoRegime} />
                </div>
              </div>

              <p className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>
                Das Marktumfeld beschreibt den Risikocharakter der Märkte basierend auf
                Benchmark-Indizes. Risk-On steht für konstruktive Bedingungen — Risk-Off für
                erhöhte Vorsicht. Signale werden im jeweiligen Regime-Kontext gewichtet.
              </p>
            </div>
          </div>

          {/* ── Zusammenfassung + Empfehlungen ── */}
          <div className="grid two" style={{ marginBottom: 16 }}>
            <div className="context-block">
              <h3 className="context-block-title">Marktbewertung</h3>
              {snapshot.summary ? (
                <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 8px" }}>
                  {snapshot.summary}
                </p>
              ) : null}
              {snapshot.riskNote ? (
                <p
                  className="muted small"
                  style={{ color: "var(--warn)", lineHeight: 1.5, margin: 0 }}
                >
                  {snapshot.riskNote}
                </p>
              ) : null}
              {!snapshot.summary && !snapshot.riskNote ? (
                <p className="muted small">Keine Zusammenfassung verfügbar.</p>
              ) : null}
            </div>

            <div className="context-block">
              <h3 className="context-block-title">Beobachtungen</h3>
              {report.recommendations.length > 0 ? (
                <ul style={{ margin: 0, padding: "0 0 0 16px", display: "grid", gap: 6 }}>
                  {report.recommendations.map((rec, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
                      {rec}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Keine Empfehlungen vorhanden.</p>
              )}
            </div>
          </div>

          {/* ── Benchmark-Indizes ── */}
          <div style={{ marginBottom: 16 }}>
            <SectionCard title="Benchmark-Indizes">
              <p className="muted small" style={{ marginBottom: 12 }}>
                Marktbreite Benchmark-Instrumente, die zur Regime-Berechnung herangezogen werden.
              </p>
              {report.benchmarkSummaries.length > 0 ? (
                <div className="context-grid">
                  {report.benchmarkSummaries.map((bm) => (
                    <div key={bm.symbol} className="context-block">
                      <h3 className="context-block-title">
                        {bm.symbol}
                        <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                          {bm.assetType} · {bm.timeframe}
                        </span>
                      </h3>
                      <div className="context-stats">
                        <div className="context-stat-row">
                          <span className="context-stat-label">Trend</span>
                          <span
                            className="context-stat-value"
                            style={{ color: stateColor(bm.trendDirection) }}
                          >
                            {stateLabel(bm.trendDirection)}
                          </span>
                        </div>
                        <div className="context-stat-row">
                          <span className="context-stat-label">Momentum</span>
                          <span
                            className="context-stat-value"
                            style={{ color: stateColor(bm.momentumState) }}
                          >
                            {stateLabel(bm.momentumState)}
                          </span>
                        </div>
                        <div className="context-stat-row">
                          <span className="context-stat-label">Volatilität</span>
                          <span
                            className="context-stat-value"
                            style={{ color: stateColor(bm.volatilityState) }}
                          >
                            {stateLabel(bm.volatilityState)}
                          </span>
                        </div>
                        <div className="context-stat-row">
                          <span className="context-stat-label">vs SMA 50</span>
                          <span
                            className="context-stat-value"
                            style={{
                              color:
                                bm.priceVsSma50 != null
                                  ? bm.priceVsSma50 >= 0
                                    ? "var(--good)"
                                    : "var(--bad)"
                                  : undefined
                            }}
                          >
                            {formatPercent(bm.priceVsSma50)}
                          </span>
                        </div>
                        <div className="context-stat-row">
                          <span className="context-stat-label">vs SMA 200</span>
                          <span
                            className="context-stat-value"
                            style={{
                              color:
                                bm.priceVsSma200 != null
                                  ? bm.priceVsSma200 >= 0
                                    ? "var(--good)"
                                    : "var(--bad)"
                                  : undefined
                            }}
                          >
                            {formatPercent(bm.priceVsSma200)}
                          </span>
                        </div>
                        <div className="context-stat-row">
                          <span className="context-stat-label">RSI</span>
                          <span
                            className="context-stat-value"
                            style={{
                              color:
                                bm.rsi != null
                                  ? bm.rsi > 70
                                    ? "var(--bad)"
                                    : bm.rsi < 30
                                      ? "var(--good)"
                                      : undefined
                                  : undefined
                            }}
                          >
                            {formatScore(bm.rsi)}
                          </span>
                        </div>
                        <div className="context-stat-row">
                          <span className="context-stat-label">Score</span>
                          <span className="context-stat-value">{formatScore(bm.score)}</span>
                        </div>
                        {bm.summary ? (
                          <p
                            className="muted small"
                            style={{ marginTop: 6, lineHeight: 1.45, gridColumn: "1 / -1" }}
                          >
                            {bm.summary}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small">Keine Benchmark-Daten verfügbar.</p>
              )}
            </SectionCard>
          </div>

          {/* ── Verlauf ── */}
          <SectionCard title="Verlauf">
            <details>
              <summary>
                Letzte {history.data?.length ?? 0} Einträge anzeigen
              </summary>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Zeitpunkt</th>
                      <th>Equity</th>
                      <th>Crypto</th>
                      <th>Gesamt</th>
                      <th>Risiko-Modus</th>
                      <th>Konfidenz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(history.data ?? []).map((row) => (
                      <tr key={row.id}>
                        <td className="nowrap">{formatDateTime(row.generatedAt)}</td>
                        <td>{row.equityRegime}</td>
                        <td>{row.cryptoRegime}</td>
                        <td>{row.overallRegime}</td>
                        <td>{row.riskMode}</td>
                        <td>{Math.round(row.confidence * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </SectionCard>
        </>
      )}
    </>
  );
}
