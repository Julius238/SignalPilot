import { ErrorState } from "../../../components/empty-state";
import { ScannerFilters } from "../../../components/scanner-filters";
import { ScannerGroups } from "../../../components/scanner-groups";
import { formatDateTime } from "../../../lib/format";
import { buildQuery, fetchApi, type ScannerResponse } from "../../../lib/signalpilot-api";

type ScannerPageProps = {
  searchParams: Promise<{
    assetType?: string;
    timeframe?: string;
    minScore?: string;
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
    showOnlyAlertWorthy: params.showOnlyAlertWorthy,
    watchlistOnly: params.watchlistOnly
  });
  const scanner = await fetchApi<ScannerResponse>(`/scanner${query}`);
  const summary = scanner.data?.summary;

  return (
    <>
      <div className="page-header scanner-page-header">
        <div>
          <h1>Signal Scanner</h1>
          <p>Grouped current signals for fast watchlist triage.</p>
        </div>
      </div>

      <ScannerFilters />

      {scanner.error ? (
        <ErrorState title="Could not load scanner" message={scanner.error} />
      ) : null}

      <section className="grid metrics scanner-metrics">
        <div className="card">
          <span className="metric-label">Strong Watch</span>
          <span className="metric-value">{summary?.strongWatchCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Watch</span>
          <span className="metric-value">{summary?.watchCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Alerts Sent heute</span>
          <span className="metric-value">{summary?.alertsSentToday ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Last Pipeline Status</span>
          <span className="metric-value metric-value-text">
            {summary?.lastPipelineRunStatus ?? "-"}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Last Pipeline Run</span>
          <span className="metric-value metric-value-text">
            {formatDateTime(summary?.lastPipelineRunAt)}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Bullish Aligned</span>
          <span className="metric-value">{summary?.bullishAlignedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Bearish Aligned</span>
          <span className="metric-value">{summary?.bearishAlignedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Conflicts</span>
          <span className="metric-value">{summary?.conflictCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">No Edge</span>
          <span className="metric-value">{summary?.noEdgeCount ?? 0}</span>
        </div>
      </section>

      {scanner.data ? (
        <ScannerGroups
          groups={scanner.data.groups}
          multiTimeframeSummaries={scanner.data.multiTimeframeSummaries}
        />
      ) : null}
    </>
  );
}
