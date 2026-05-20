import Link from "next/link";

import { CandlestickChart } from "../../../../components/CandlestickChart";
import {
  AlignmentBadge,
  DirectionBadge,
  RiskBadge,
  StatusBadge
} from "../../../../components/badges";
import { ErrorState } from "../../../../components/empty-state";
import { SignalsTable } from "../../../../components/signals-table";
import { AssetWatchlistControls } from "../../../../components/watchlist-controls";
import { formatJson, formatScore } from "../../../../lib/format";
import { formatDateTime } from "../../../../lib/format";
import {
  fetchApi,
  type AssetDetail,
  type NewsItem,
  type SignalListItem
} from "../../../../lib/signalpilot-api";

type AssetDetailPageProps = {
  params: Promise<{ symbol: string }>;
};

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { symbol } = await params;
  const [asset, signals, newsResult] = await Promise.all([
    fetchApi<AssetDetail>(
      `/assets/${encodeURIComponent(symbol)}?includeCandles=true&candleLimit=250`
    ),
    fetchApi<SignalListItem[]>(`/assets/${encodeURIComponent(symbol)}/signals?limit=10`),
    fetchApi<NewsItem[]>(`/assets/${encodeURIComponent(symbol)}/news?limit=10`)
  ]);

  if (asset.error) {
    return <ErrorState title="Could not load asset" message={asset.error} />;
  }

  const data = asset.data;

  if (!data) {
    return <ErrorState title="Asset missing" message="The API returned no asset payload." />;
  }

  return (
    <>
      <div className="page-header">
        <h1>{data.symbol}</h1>
        <p>
          {data.name} · {data.assetType} · {data.exchange}
        </p>
      </div>

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Base / Quote</span>
          <span className="metric-value">
            {data.baseCurrency ?? "-"} / {data.quoteCurrency ?? "-"}
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Active</span>
          <span className="metric-value">{data.isActive ? "YES" : "NO"}</span>
        </div>
        <div className="card">
          <span className="metric-label">Candle Counts</span>
          <pre>{formatJson(data.candleCounts)}</pre>
        </div>
      </section>

      <section className="card watchlist-detail-card">
        <h2>Watchlist Management</h2>
        <AssetWatchlistControls symbol={data.symbol} watchlistItem={data.watchlistItem} />
      </section>

      <section className="detail-grid">
        <div className="card">
          <h2>Latest Signal</h2>
          {data.latestSignal ? (
            <div className="stack-list">
              <div className="list-row">
                <div>
                  <strong>{data.latestSignal.signalType}</strong>
                  <span>{data.latestSignal.timeframe}</span>
                </div>
                <div className="right-meta">
                  <StatusBadge value={data.latestSignal.status} />
                  <DirectionBadge value={data.latestSignal.direction} />
                  <RiskBadge value={data.latestSignal.riskLevel} />
                  <span>Score {formatScore(data.latestSignal.score)}</span>
                </div>
              </div>
              <p>{data.latestSignalOutput?.shortConclusion ?? "-"}</p>
              <p>{data.latestSignalOutput?.nextTrigger ?? "-"}</p>
            </div>
          ) : (
            <p>No latest signal found.</p>
          )}
        </div>
        <div className="card">
          <h2>Signal Output</h2>
          <pre>{formatJson(data.latestSignalOutput?.dashboardJson ?? data.latestSignalOutput)}</pre>
        </div>
      </section>

      <section className="card multi-timeframe-card">
        <h2>Multi-Timeframe Summary</h2>
        {data.multiTimeframeSummary ? (
          <div className="multi-timeframe-content">
            <div className="multi-timeframe-head">
              <AlignmentBadge value={data.multiTimeframeSummary.alignment} />
              <span className="metric-value metric-value-text">
                Score {formatScore(data.multiTimeframeSummary.alignmentScore)}
              </span>
              <RiskBadge value={data.multiTimeframeSummary.riskLevel} />
            </div>
            <div className="multi-timeframe-lists">
              <div>
                <span className="metric-label">Primary</span>
                <strong>{data.multiTimeframeSummary.primaryTimeframe ?? "-"}</strong>
              </div>
              <div>
                <span className="metric-label">Confirming</span>
                <strong>{formatTimeframes(data.multiTimeframeSummary.confirmingTimeframes)}</strong>
              </div>
              <div>
                <span className="metric-label">Conflicting</span>
                <strong>{formatTimeframes(data.multiTimeframeSummary.conflictingTimeframes)}</strong>
              </div>
            </div>
            <div className="multi-timeframe-lists">
              <SignalSnapshot
                label="Strongest"
                signal={data.multiTimeframeSummary.strongestSignal}
              />
              <SignalSnapshot
                label="Weakest"
                signal={data.multiTimeframeSummary.weakestSignal}
              />
            </div>
            <p>{data.multiTimeframeSummary.summary}</p>
            <p>{data.multiTimeframeSummary.riskNote}</p>
            <p>{data.multiTimeframeSummary.nextFocus}</p>
          </div>
        ) : (
          <p>No multi-timeframe summary available.</p>
        )}
      </section>

      <CandlestickChart
        candles={(data.candles ?? []).map((candle) => ({
          time: candle.openTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        }))}
        signalMarker={
          data.latestSignal
            ? {
                time: data.candles?.at(-1)?.openTime ?? data.latestSignal.createdAt,
                direction: data.latestSignal.direction,
                status: data.latestSignal.status,
                label: data.latestSignal.signalType
              }
            : undefined
        }
        title={`Candles · ${data.symbol} · ${data.latestSignal?.timeframe ?? "1d"}`}
      />

      {signals.error ? <ErrorState title="Could not load asset signals" message={signals.error} /> : null}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>
          Asset Signals{" "}
          <Link href={`/dashboard/signals?symbol=${encodeURIComponent(data.symbol)}`}>
            Open filtered feed
          </Link>
        </h2>
        <SignalsTable signals={signals.data ?? []} />
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>
          Recent News{" "}
          <Link href={`/dashboard/news?symbol=${encodeURIComponent(data.symbol)}`}>View all</Link>
        </h2>
        {!newsResult.data || newsResult.data.length === 0 ? (
          <p className="muted">No recent news found.</p>
        ) : (
          <div className="stack-list">
            {newsResult.data.map((item) => (
              <div key={item.id} className="list-row">
                <div>
                  <strong>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {item.headline}
                      </a>
                    ) : (
                      item.headline
                    )}
                  </strong>
                  {item.summary && (
                    <p className="muted small">{item.summary.slice(0, 120)}{item.summary.length > 120 ? "…" : ""}</p>
                  )}
                </div>
                <div className="nowrap muted small">
                  {item.source} · {formatDateTime(item.publishedAt)}
                  {item.sentiment && ` · ${item.sentiment}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function formatTimeframes(timeframes: string[]) {
  return timeframes.length > 0 ? timeframes.join(", ") : "-";
}

function SignalSnapshot({
  label,
  signal
}: {
  label: string;
  signal: NonNullable<AssetDetail["multiTimeframeSummary"]>["strongestSignal"];
}) {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <strong>{signal ? `${signal.timeframe} · ${signal.status} · ${formatScore(signal.score)}` : "-"}</strong>
    </div>
  );
}
