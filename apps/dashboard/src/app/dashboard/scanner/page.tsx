import Link from "next/link";

import { ErrorState } from "../../../components/empty-state";
import { RegimeBadge, RiskModeBadge } from "../../../components/badges";
import { ScannerFilters } from "../../../components/scanner-filters";
import { ScannerGroups } from "../../../components/scanner-groups";
import { PageHeader, MetricCard } from "../../../components/ui";
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

  const pipelineColor =
    summary?.lastPipelineRunStatus === "SUCCESS"
      ? "var(--good)"
      : summary?.lastPipelineRunStatus === "FAILED"
        ? "var(--bad)"
        : undefined;

  return (
    <>
      <PageHeader
        title="Signal Scanner"
        subtitle="Aktuelle Signals nach Gruppe · sortiert nach Qualität und Multi-TF-Ausrichtung"
        actions={
          <>
            <Link className="primary-link secondary-link" href="/dashboard/signals">
              Signal Feed
            </Link>
            <Link className="primary-link secondary-link" href="/dashboard/multi-timeframe">
              Multi-Timeframe
            </Link>
          </>
        }
      />

      {/* Markt-Regime-Banner */}
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
          <span className="muted small">
            {marketRegime.data.summary?.slice(0, 100)}
            {(marketRegime.data.summary?.length ?? 0) > 100 ? "…" : ""}
          </span>
          <span className="regime-sep" style={{ marginLeft: "auto" }}>·</span>
          <Link href="/dashboard/market-regime" className="section-link">Details →</Link>
        </div>
      ) : (
        <div className="regime-banner">
          <span className="regime-banner-label">Markt-Regime</span>
          <span className="muted small">Noch nicht berechnet.</span>
        </div>
      )}

      {/* Filter */}
      <ScannerFilters />

      {scanner.error ? (
        <ErrorState title="Scanner konnte nicht geladen werden" message={scanner.error} />
      ) : null}

      {/* Kennzahlen */}
      <section className="grid metrics scanner-metrics">
        <MetricCard label="Starke Beobachtung" value={summary?.strongWatchCount ?? 0} />
        <MetricCard label="Beobachten" value={summary?.watchCount ?? 0} />
        <MetricCard
          label="Aufwärts-Ausrichtung"
          value={
            <span style={{ color: "var(--good)" }}>{summary?.bullishAlignedCount ?? 0}</span>
          }
        />
        <MetricCard
          label="Abwärts-Ausrichtung"
          value={
            <span style={{ color: "var(--bad)" }}>{summary?.bearishAlignedCount ?? 0}</span>
          }
        />
        <MetricCard label="Konflikte" value={summary?.conflictCount ?? 0} />
        <MetricCard
          label="Kein Vorteil"
          value={summary?.noEdgeCount ?? 0}
          sub="niedrige Priorität"
        />
        <MetricCard label="Alerts heute" value={summary?.alertsSentToday ?? 0} />
        <MetricCard
          label="Pipeline-Status"
          value={
            <span style={{ color: pipelineColor }}>
              {summary?.lastPipelineRunStatus ?? "—"}
            </span>
          }
          sub={formatDateTime(summary?.lastPipelineRunAt)}
        />
      </section>

      {hasActiveFilter ? (
        <p className="muted small" style={{ marginBottom: 12 }}>
          Filter aktiv —{" "}
          <Link href="/dashboard/scanner" className="section-link">
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
