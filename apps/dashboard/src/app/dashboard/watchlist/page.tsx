import Link from "next/link";

import {
  AlignmentBadge,
  DirectionBadge,
  PriorityBadge,
  StatusBadge
} from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { WatchlistItemEditor } from "../../../components/watchlist-controls";
import { buildQuery, fetchApi, type WatchlistItem } from "../../../lib/signalpilot-api";
import { formatScore } from "../../../lib/format";

const priorities = ["", "LOW", "MEDIUM", "HIGH"];
const assetTypes = ["", "CRYPTO", "STOCK", "ETF"];

type WatchlistPageProps = {
  searchParams: Promise<{
    priority?: string;
    assetType?: string;
    alertEnabled?: string;
  }>;
};

export default async function WatchlistPage({ searchParams }: WatchlistPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    priority: params.priority,
    assetType: params.assetType,
    alertEnabled: params.alertEnabled,
    limit: 500
  });
  const result = await fetchApi<WatchlistItem[]>(`/watchlist${query}`);
  const items = result.data ?? [];
  const highPriorityCount = items.filter((item) => item.priority === "HIGH").length;
  const alertEnabledCount = items.filter((item) => item.alertEnabled).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Watchlist</h1>
          <p>Tracked assets with latest signal state and multi-timeframe context.</p>
        </div>
        <Link className="primary-link secondary-link" href="/dashboard/assets">
          Browse Assets
        </Link>
      </div>

      <form className="filter-bar multi-timeframe-filter-bar">
        <select defaultValue={params.priority ?? ""} name="priority">
          {priorities.map((value) => (
            <option key={value} value={value}>
              {value || "ALL Priorities"}
            </option>
          ))}
        </select>
        <select defaultValue={params.assetType ?? ""} name="assetType">
          {assetTypes.map((value) => (
            <option key={value} value={value}>
              {value || "ALL Assets"}
            </option>
          ))}
        </select>
        <select defaultValue={params.alertEnabled ?? ""} name="alertEnabled">
          <option value="">ALL Alert States</option>
          <option value="true">Alerts Enabled</option>
          <option value="false">Alerts Disabled</option>
        </select>
        <button type="submit">Apply</button>
      </form>

      {result.error ? <ErrorState title="Could not load watchlist" message={result.error} /> : null}

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Watchlist Count</span>
          <span className="metric-value">{items.length}</span>
        </div>
        <div className="card">
          <span className="metric-label">High Priority</span>
          <span className="metric-value">{highPriorityCount}</span>
        </div>
        <div className="card">
          <span className="metric-label">Alert Enabled</span>
          <span className="metric-value">{alertEnabledCount}</span>
        </div>
      </section>

      {!result.error && items.length === 0 ? (
        <EmptyState title="No watchlist items found." />
      ) : null}

      {items.length > 0 ? (
        <section className="watchlist-grid">
          {items.map((item) => (
            <article className="card watchlist-card" key={item.id}>
              <div className="watchlist-card-head">
                <div>
                  <Link
                    className="watchlist-symbol"
                    href={`/dashboard/assets/${encodeURIComponent(item.symbol)}`}
                  >
                    {item.symbol}
                  </Link>
                  <span>
                    {item.asset.name} · {item.asset.assetType}
                  </span>
                </div>
                <div className="watchlist-badges">
                  <PriorityBadge value={item.priority} />
                  <span className={`badge ${item.alertEnabled ? "health-ok" : "status-no_edge"}`}>
                    {item.alertEnabled ? "ALERTS ON" : "ALERTS OFF"}
                  </span>
                </div>
              </div>

              <div className="watchlist-signal-grid">
                <div>
                  <span className="metric-label">Latest Signal</span>
                  {item.latestSignal ? (
                    <>
                      <Link href={`/dashboard/signals/${item.latestSignal.id}`}>
                        {item.latestSignal.signalType}
                      </Link>
                      <div className="watchlist-badges">
                        <StatusBadge value={item.latestSignal.status} />
                        <DirectionBadge value={item.latestSignal.direction} />
                        <span>Score {formatScore(item.latestSignal.score)}</span>
                      </div>
                    </>
                  ) : (
                    <strong>-</strong>
                  )}
                </div>
                <div>
                  <span className="metric-label">Multi-Timeframe</span>
                  {item.multiTimeframeSummary ? (
                    <>
                      <AlignmentBadge value={item.multiTimeframeSummary.alignment} />
                      <strong>Score {formatScore(item.multiTimeframeSummary.alignmentScore)}</strong>
                    </>
                  ) : (
                    <strong>-</strong>
                  )}
                </div>
              </div>

              <p className="watchlist-note">{item.notes ?? "No notes."}</p>
              <WatchlistItemEditor item={item} />
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
