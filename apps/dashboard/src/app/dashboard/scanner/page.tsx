import Link from "next/link";

import { ErrorState } from "../../../components/empty-state";
import { RegimeBadge, RiskModeBadge } from "../../../components/badges";
import { regimeSentence } from "../../../components/dashboard/shared";
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
        eyebrow="Beobachten"
        title="Markt-Radar"
        subtitle="Aktuelle Signale nach Bedeutung gruppiert — mit Qualität, Risiko und Bestätigung über mehrere Zeitebenen."
        actions={
          <>
            <Link className="primary-link secondary-link" href="/dashboard/signals">
              Alle Signale
            </Link>
            <Link className="primary-link secondary-link" href="/dashboard/multi-timeframe">
              Zeitebenen vergleichen
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
            {regimeSentence(marketRegime.data.overallRegime) ??
              marketRegime.data.summary?.slice(0, 120)}
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
        <MetricCard
          label="Hohe Relevanz"
          value={summary?.strongWatchCount ?? 0}
          sub="zuerst prüfen"
        />
        <MetricCard label="Beobachten" value={summary?.watchCount ?? 0} sub="im Blick behalten" />
        <MetricCard label="Konflikte" value={summary?.conflictCount ?? 0} sub="Zeitebenen uneinig" />
        <MetricCard
          label="Benachrichtigungen"
          value={summary?.alertsSentToday ?? 0}
          sub="heute zugestellt"
        />
      </section>

      <div className="scanner-summary-strip">
        <span>
          <strong style={{ color: "var(--good)" }}>{summary?.bullishAlignedCount ?? 0}</strong>{" "}
          aufwärts bestätigt
        </span>
        <span>
          <strong style={{ color: "var(--bad)" }}>{summary?.bearishAlignedCount ?? 0}</strong>{" "}
          abwärts bestätigt
        </span>
        <span>
          <strong>{summary?.noEdgeCount ?? 0}</strong> ohne klare Relevanz
        </span>
        <span>
          Datenlauf:{" "}
          <strong style={{ color: pipelineColor }}>
            {summary?.lastPipelineRunStatus === "SUCCESS"
              ? "erfolgreich"
              : summary?.lastPipelineRunStatus === "FAILED"
                ? "fehlgeschlagen"
                : summary?.lastPipelineRunStatus ?? "noch offen"}
          </strong>{" "}
          · {formatDateTime(summary?.lastPipelineRunAt)}
        </span>
      </div>

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
