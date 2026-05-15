import Link from "next/link";

import { DirectionBadge, RiskBadge, StatusBadge } from "../../../../components/badges";
import { ErrorState } from "../../../../components/empty-state";
import { SignalsTable } from "../../../../components/signals-table";
import { formatJson, formatScore } from "../../../../lib/format";
import {
  fetchApi,
  type AssetDetail,
  type SignalListItem
} from "../../../../lib/signalpilot-api";

type AssetDetailPageProps = {
  params: Promise<{ symbol: string }>;
};

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { symbol } = await params;
  const [asset, signals] = await Promise.all([
    fetchApi<AssetDetail>(`/assets/${encodeURIComponent(symbol)}`),
    fetchApi<SignalListItem[]>(`/assets/${encodeURIComponent(symbol)}/signals?limit=10`)
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
    </>
  );
}
