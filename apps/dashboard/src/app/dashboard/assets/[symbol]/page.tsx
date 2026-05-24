import Link from "next/link";

import { CandlestickChart } from "../../../../components/CandlestickChart";
import {
  AlignmentBadge,
  DirectionBadge,
  RiskBadge,
  ScoreBadge,
  StatusBadge
} from "../../../../components/badges";
import { ErrorState } from "../../../../components/empty-state";
import { AssetWatchlistControls } from "../../../../components/watchlist-controls";
import { formatDateTime, formatScore } from "../../../../lib/format";
import {
  fetchApi,
  type AssetDetail,
  type EventItem,
  type NewsItem,
  type SignalListItem
} from "../../../../lib/signalpilot-api";

type AssetDetailPageProps = {
  params: Promise<{ symbol: string }>;
};

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { symbol } = await params;
  const [asset, signals, newsResult, eventsResult] = await Promise.all([
    fetchApi<AssetDetail>(
      `/assets/${encodeURIComponent(symbol)}?includeCandles=true&candleLimit=250`
    ),
    fetchApi<SignalListItem[]>(`/assets/${encodeURIComponent(symbol)}/signals?limit=10`),
    fetchApi<NewsItem[]>(`/assets/${encodeURIComponent(symbol)}/news?limit=10`),
    fetchApi<EventItem[]>(`/assets/${encodeURIComponent(symbol)}/events?limit=10`)
  ]);

  if (asset.error) {
    return <ErrorState title="Asset konnte nicht geladen werden" message={asset.error} />;
  }

  const data = asset.data;
  if (!data) {
    return (
      <ErrorState
        title="Asset fehlt"
        message="Die API hat keine Asset-Daten zurückgegeben."
      />
    );
  }

  const latestSignal = data.latestSignal;
  const latestOutput = data.latestSignalOutput;
  const mtf = data.multiTimeframeSummary;

  return (
    <>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <p className="page-header-breadcrumb">
            <Link href="/dashboard/assets">Assets</Link> / {data.symbol}
          </p>
          <h1>{data.symbol}</h1>
          <p className="muted">
            {data.name} · {data.assetType} · {data.exchange}
            {data.baseCurrency ? ` · ${data.baseCurrency}/${data.quoteCurrency}` : ""}
            {!data.isActive ? " · INAKTIV" : ""}
          </p>
        </div>
        <div className="page-actions">
          <Link
            className="primary-link secondary-link"
            href={`/dashboard/signals?symbol=${encodeURIComponent(data.symbol)}`}
          >
            Alle Signals
          </Link>
          <Link
            className="primary-link secondary-link"
            href={`/dashboard/scanner?assetType=${data.assetType}`}
          >
            Scanner
          </Link>
        </div>
      </div>

      {/* ── Watchlist status ── */}
      <section className="card watchlist-detail-card">
        <div className="section-header">
          <h2 className="section-title">Watchlist</h2>
          <span className={`badge ${data.isWatchlisted ? "status-strong_watch" : ""}`}>
            {data.isWatchlisted ? "In Watchlist" : "Nicht in Watchlist"}
          </span>
        </div>
        <AssetWatchlistControls symbol={data.symbol} watchlistItem={data.watchlistItem} />
      </section>

      {/* ── Latest signal + MTF side by side ── */}
      <div className="grid two" style={{ marginTop: 16 }}>

        {/* Latest signal */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Aktuelles Signal</h2>
            {latestSignal ? (
              <Link
                href={`/dashboard/signals/${latestSignal.id}`}
                className="section-link"
              >
                Detail →
              </Link>
            ) : null}
          </div>
          {latestSignal ? (
            <div className="stack-list">
              <div className="list-row">
                <div>
                  <strong style={{ display: "block", marginBottom: 4 }}>
                    {latestSignal.signalType}
                  </strong>
                  <span className="muted small">
                    {latestSignal.timeframe} · {formatDateTime(latestSignal.createdAt)}
                  </span>
                </div>
                <div>
                  <ScoreBadge value={latestSignal.score} />
                </div>
              </div>
              <div className="signal-card-badges">
                <StatusBadge value={latestSignal.status} />
                <DirectionBadge value={latestSignal.direction} />
                <RiskBadge value={latestSignal.riskLevel} />
              </div>
              {latestOutput?.shortConclusion ? (
                <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                  {latestOutput.shortConclusion}
                </p>
              ) : null}
              {latestOutput?.counterArgument ? (
                <p className="signal-card-counter">
                  Gegenargument: {latestOutput.counterArgument}
                </p>
              ) : null}
              {latestOutput?.nextTrigger ? (
                <p className="signal-card-trigger">
                  Nächster Auslöser: {latestOutput.nextTrigger}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">Noch kein Signal vorhanden.</div>
          )}
        </div>

        {/* Multi-Timeframe Summary */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Multi-Timeframe</h2>
            <Link href="/dashboard/multi-timeframe" className="section-link">
              Übersicht →
            </Link>
          </div>
          {mtf ? (
            <div className="multi-timeframe-content">
              <div className="multi-timeframe-head">
                <AlignmentBadge value={mtf.alignment} />
                <RiskBadge value={mtf.riskLevel} />
                <span className="muted small">Score: {formatScore(mtf.alignmentScore)}</span>
              </div>
              <div className="multi-timeframe-lists">
                <div>
                  <span className="metric-label">Primär</span>
                  <strong>{mtf.primaryTimeframe ?? "—"}</strong>
                </div>
                <div>
                  <span className="metric-label">Bestätigend</span>
                  <strong>
                    {mtf.confirmingTimeframes.length > 0
                      ? mtf.confirmingTimeframes.join(", ")
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span className="metric-label">Konflikte</span>
                  <strong
                    style={{ color: mtf.conflictingTimeframes.length > 0 ? "var(--bad)" : undefined }}
                  >
                    {mtf.conflictingTimeframes.length > 0
                      ? mtf.conflictingTimeframes.join(", ")
                      : "—"}
                  </strong>
                </div>
              </div>
              {mtf.summary ? (
                <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{mtf.summary}</p>
              ) : null}
              {mtf.riskNote ? (
                <p className="muted small" style={{ color: "var(--warn)" }}>
                  {mtf.riskNote}
                </p>
              ) : null}
              {mtf.nextFocus ? (
                <p className="signal-card-trigger">Fokus: {mtf.nextFocus}</p>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">Kein Multi-TF-Summary verfügbar.</div>
          )}
        </div>
      </div>

      {/* ── Candle Coverage ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Kerzen-Abdeckung</h2>
        </div>
        {Object.entries(data.candleCounts).length > 0 ? (
          <div className="research-snapshot-grid">
            {Object.entries(data.candleCounts).map(([tf, count]) => (
              <div key={tf} className="research-stat">
                <div className="research-stat-label">{tf}</div>
                <div className="research-stat-value">{count}</div>
                <div className="research-stat-sub">
                  {count < 50 ? (
                    <span style={{ color: "var(--bad)" }}>Zu wenig Kerzen</span>
                  ) : count < 200 ? (
                    <span style={{ color: "var(--warn)" }}>Begrenzte Historie</span>
                  ) : (
                    <span style={{ color: "var(--good)" }}>Ausreichend</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Keine Kerzen-Daten gefunden.</p>
        )}
      </section>

      {/* ── Chart ── */}
      <CandlestickChart
        candles={(data.candles ?? []).map((c) => ({
          time: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        }))}
        signalMarker={
          latestSignal
            ? {
                time: data.candles?.at(-1)?.openTime ?? latestSignal.createdAt,
                direction: latestSignal.direction,
                status: latestSignal.status,
                label: latestSignal.signalType
              }
            : undefined
        }
        title={`Kerzen · ${data.symbol} · ${latestSignal?.timeframe ?? "1d"}`}
      />

      {/* ── Signal history ── */}
      {signals.error ? (
        <ErrorState title="Signal-Historie fehler" message={signals.error} />
      ) : null}

      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Letzte Signals</h2>
          <Link
            href={`/dashboard/signals?symbol=${encodeURIComponent(data.symbol)}`}
            className="section-link"
          >
            Alle →
          </Link>
        </div>
        {signals.data && signals.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>TF</th>
                  <th>Typ</th>
                  <th>Status</th>
                  <th>Richtung</th>
                  <th>Score</th>
                  <th>Risiko</th>
                  <th>Schlussfolgerung</th>
                </tr>
              </thead>
              <tbody>
                {signals.data.map((sig) => (
                  <tr key={sig.id}>
                    <td className="nowrap">{formatDateTime(sig.createdAt)}</td>
                    <td>{sig.timeframe}</td>
                    <td>{sig.signalType}</td>
                    <td>
                      <StatusBadge value={sig.status} />
                    </td>
                    <td>
                      <DirectionBadge value={sig.direction} />
                    </td>
                    <td>
                      <Link href={`/dashboard/signals/${sig.id}`}>
                        {formatScore(sig.score)}
                      </Link>
                    </td>
                    <td>
                      <RiskBadge value={sig.riskLevel} />
                    </td>
                    <td className="wide-cell">
                      {sig.signalOutput?.shortConclusion?.slice(0, 80) ?? "—"}
                      {(sig.signalOutput?.shortConclusion?.length ?? 0) > 80 ? "…" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Noch keine Signals für dieses Asset.</div>
        )}
      </section>

      {/* ── Events ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Bevorstehende / Vergangene Events</h2>
          <Link
            href={`/dashboard/events?symbol=${encodeURIComponent(data.symbol)}`}
            className="section-link"
          >
            Alle →
          </Link>
        </div>
        {!eventsResult.data || eventsResult.data.length === 0 ? (
          <p className="muted small">
            Keine Events gefunden.
            {data.assetType === "ETF"
              ? " Earnings gelten nicht für ETFs."
              : ""}
          </p>
        ) : (
          <div className="stack-list">
            {eventsResult.data.map((event) => (
              <div key={event.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>{event.title}</strong>
                  {event.fiscalQuarter ? (
                    <span className="muted small">
                      {" · "}Q{event.fiscalQuarter} {event.fiscalYear}
                    </span>
                  ) : null}
                  {event.epsEstimate !== null || event.epsActual !== null ? (
                    <p className="muted small">
                      EPS: gesch. {event.epsEstimate ?? "—"} / tats. {event.epsActual ?? "—"}
                    </p>
                  ) : null}
                </div>
                <div className="right-meta nowrap">
                  <span>{event.eventDate ? formatDateTime(event.eventDate) : "—"}</span>
                  <span>{event.source}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── News ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Aktuelle News</h2>
          <Link
            href={`/dashboard/news?symbol=${encodeURIComponent(data.symbol)}`}
            className="section-link"
          >
            Alle →
          </Link>
        </div>
        {!newsResult.data || newsResult.data.length === 0 ? (
          <p className="muted small">Keine aktuellen News gefunden.</p>
        ) : (
          <div className="stack-list">
            {newsResult.data.map((item) => (
              <div key={item.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {item.headline}
                      </a>
                    ) : (
                      item.headline
                    )}
                  </strong>
                  {item.summary ? (
                    <p className="muted small">
                      {item.summary.slice(0, 120)}
                      {item.summary.length > 120 ? "…" : ""}
                    </p>
                  ) : null}
                </div>
                <div className="right-meta nowrap">
                  <span>{item.source}</span>
                  <span>{formatDateTime(item.publishedAt)}</span>
                  {item.sentiment ? <span className="muted small">{item.sentiment}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
