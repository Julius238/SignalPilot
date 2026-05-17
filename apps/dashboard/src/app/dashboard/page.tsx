import Link from "next/link";

import { AlertsList } from "../../components/alerts-list";
import { HealthBadge } from "../../components/badges";
import { ErrorState } from "../../components/empty-state";
import { SignalsTable } from "../../components/signals-table";
import { formatDateTime } from "../../lib/format";
import {
  fetchApi,
  type Alert,
  type Asset,
  type BotRun,
  type ScannerResponse,
  type SignalListItem,
  type WatchlistItem
} from "../../lib/signalpilot-api";

export default async function DashboardPage() {
  const [health, assets, signals, alerts, pipelineRuns, scanner, watchlist] = await Promise.all([
    fetchApi<{ status: string }>("/health"),
    fetchApi<Asset[]>("/assets?limit=500"),
    fetchApi<SignalListItem[]>("/signals?limit=200"),
    fetchApi<Alert[]>("/alerts?limit=200"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runCryptoSignalPipeline&limit=1"),
    fetchApi<ScannerResponse>("/scanner"),
    fetchApi<WatchlistItem[]>("/watchlist?limit=500")
  ]);

  const errors = [health, assets, signals, alerts, pipelineRuns, scanner, watchlist]
    .map((result) => result.error)
    .filter(Boolean);
  const latestSignals = signals.data?.slice(0, 5) ?? [];
  const latestAlerts = alerts.data?.slice(0, 5) ?? [];
  const lastPipeline = pipelineRuns.data?.[0] ?? null;
  const watchlistItems = watchlist.data ?? [];
  const highPriorityCount = watchlistItems.filter((item) => item.priority === "HIGH").length;
  const alertEnabledCount = watchlistItems.filter((item) => item.alertEnabled).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Market Intelligence Overview</h1>
          <p>Technical crypto signal pipeline, alerts, assets and operational status.</p>
        </div>
        <div className="page-actions">
          <Link className="primary-link" href="/dashboard/scanner">
            Open Scanner
          </Link>
          <Link className="primary-link secondary-link" href="/dashboard/watchlist">
            Watchlist
          </Link>
          <Link className="primary-link secondary-link" href="/dashboard/multi-timeframe">
            Multi-Timeframe
          </Link>
        </div>
      </div>

      {errors.length > 0 ? (
        <ErrorState title="API request issue" message={errors.join(" | ")} />
      ) : null}

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">API Health</span>
          <span className="metric-value">
            <HealthBadge ok={health.data?.status === "ok"} />
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Assets</span>
          <span className="metric-value">{assets.data?.length ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Signals</span>
          <span className="metric-value">{signals.data?.length ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Alerts</span>
          <span className="metric-value">{alerts.data?.length ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Watchlist</span>
          <span className="metric-value">{watchlistItems.length}</span>
        </div>
        <div className="card">
          <span className="metric-label">High Priority</span>
          <span className="metric-value">{highPriorityCount}</span>
        </div>
        <div className="card">
          <span className="metric-label">Watchlist Alerts</span>
          <span className="metric-value">{alertEnabledCount}</span>
        </div>
        <div className="card">
          <span className="metric-label">Bullish Aligned</span>
          <span className="metric-value">{scanner.data?.summary.bullishAlignedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Bearish Aligned</span>
          <span className="metric-value">{scanner.data?.summary.bearishAlignedCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Conflicts</span>
          <span className="metric-value">{scanner.data?.summary.conflictCount ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">No Edge</span>
          <span className="metric-value">{scanner.data?.summary.noEdgeCount ?? 0}</span>
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Last Pipeline Run</h2>
          {lastPipeline ? (
            <div className="stack-list">
              <div className="list-row">
                <div>
                  <strong>{lastPipeline.status}</strong>
                  <span>{lastPipeline.jobName}</span>
                </div>
                <div className="right-meta">
                  <span>{formatDateTime(lastPipeline.startedAt)}</span>
                  <span>{formatDateTime(lastPipeline.finishedAt)}</span>
                </div>
              </div>
              <pre>{JSON.stringify(lastPipeline.metadataJson, null, 2)}</pre>
            </div>
          ) : (
            <p>No pipeline run found.</p>
          )}
        </div>
        <div className="card">
          <h2>Latest Alerts</h2>
          <AlertsList alerts={latestAlerts} />
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>
          Latest Signals <Link href="/dashboard/signals">View all</Link>
        </h2>
        <SignalsTable signals={latestSignals} />
      </section>
    </>
  );
}
