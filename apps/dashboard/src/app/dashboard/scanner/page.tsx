import Link from "next/link";

import { ErrorState } from "../../../components/empty-state";
import { RegimeBadge, RiskModeBadge } from "../../../components/badges";
import { ScannerFilters } from "../../../components/scanner-filters";
import { ScannerGroups } from "../../../components/scanner-groups";
import { formatDateTime } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type MarketRegimeSnapshot,
  type ScannerResponse
} from "../../../lib/signalpilot-api";

type ScannerPageProps = {
  searchParams: Promise<{
    assetType?: string;
    timeframe?: string;
    minScore?: string;
    riskLevel?: string;
    showOnlyAlertWorthy?: string;
    watchlistOnly?: string;
  }>;
};

export default async function ScannerPage({ searchParams }: ScannerPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    assetType: params.assetType,
    timeframe: params.timeframe,
    minScore: params.minScore,
    riskLevel: params.riskLevel,
    showOnlyAlertWorthy: params.showOnlyAlertWorthy,
    watchlistOnly: params.watchlistOnly
  });

  const [scanner, marketRegime] = await Promise.all([
    fetchApi<ScannerResponse>(`/scanner${query}`),
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest")
  ]);

  const summary = scanner.data?.summary;
  const hasActiveFilter = Object.values(params).some(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Signal Scanner</h1>
          <p className="muted">
            Aktuelle Signals nach Gruppe · sortiert nach Qualität und Multi-TF-Ausrichtung
          </p>
        </div>
        <div className="page-actions">
          <Link className="primary-link secondary-link" href="/dashboard/signals">
            Alle Signals
          </Link>
          <Link className="primary-link secondary-link" href="/dashboard/multi-timeframe">
            Multi-Timeframe
          </Link>
        </div>
      </div>

      {/* Regime Banner */}
      {marketRegime.data ? (
        <div className="regime-banner">
          <span className="regime-banner-label">Markt-Regime</span>
          <div className="regime-banner-block">
            <RegimeBadge value={marketRegime.data.overallRegime} />
          </div>
          <span className="regime-sep">·</span>
          <div className="regime-banner-block">
            <RiskModeBadge value={marketRegime.data.riskMode} />
          </div>
          <span className="regime-sep">·</span>
          <span className="muted small">{marketRegime.data.summary?.slice(0, 100)}{(marketRegime.data.summary?.length ?? 0) > 100 ? "…" : ""}</span>
          <span className="regime-sep" style={{ marginLeft: "auto" }}>·</span>
          <Link href="/dashboard/market-regime" className="section-link">Details →</Link>
        </div>
      ) : (
        <div className="regime-banner">
          <span className="regime-banner-label">Markt-Regime</span>
          <span className="muted small">Noch nicht berechnet.</span>
        </div>
      )}

      {/* Filter bar */}
      <ScannerFilters />

      {scanner.error ? (
        <ErrorState title="Scanner konnte nicht geladen werden" message={scanner.error} />
      ) : null}

      {/* Summary metrics */}
      <section className="grid metrics scanner-metrics" style={{ marginBottom: 20 }}>
        <div className="card">
          <span className="metric-label">Starke Beobachtung</span>
          <span className="metric-value">{summary?.strongWatchCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Beobachten</span>
          <span className="metric-value">{summary?.watchCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Aufwärts-Ausrichtung</span>
          <span className="metric-value" style={{ color: "var(--good)" }}>
            {summary?.bullishAlignedCount ?? 0}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Abwärts-Ausrichtung</span>
          <span className="metric-value" style={{ color: "var(--bad)" }}>
            {summary?.bearishAlignedCount ?? 0}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Konflikte</span>
          <span className="metric-value">{summary?.conflictCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Kein Vorteil</span>
          <span className="metric-value metric-value-text muted">
            {summary?.noEdgeCount ?? 0}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Alerts heute</span>
          <span className="metric-value">{summary?.alertsSentToday ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Letzter Pipeline-Lauf</span>
          <span className="metric-value metric-value-text">
            {summary?.lastPipelineRunStatus ? (
              <span style={{ color: summary.lastPipelineRunStatus === "SUCCESS" ? "var(--good)" : summary.lastPipelineRunStatus === "FAILED" ? "var(--bad)" : undefined }}>
                {summary.lastPipelineRunStatus}
              </span>
            ) : "—"}
          </span>
          <span className="metric-label" style={{ marginTop: 4 }}>
            {formatDateTime(summary?.lastPipelineRunAt)}
          </span>
        </div>
      </section>

      {hasActiveFilter ? (
        <p className="muted small" style={{ marginBottom: 12 }}>
          Filter aktiv — zeige gefilterte Ergebnisse.{" "}
          <Link href="/dashboard/scanner" style={{ color: "var(--accent)" }}>
            Zurücksetzen
          </Link>
        </p>
      ) : null}

      {scanner.data ? (
        <ScannerGroups
          groups={scanner.data.groups}
          multiTimeframeSummaries={scanner.data.multiTimeframeSummaries}
        />
      ) : null}
    </>
  );
}
