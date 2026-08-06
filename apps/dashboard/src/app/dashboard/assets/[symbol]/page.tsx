import Link from "next/link";

import { CandlestickChart } from "../../../../components/CandlestickChart";
import {
  AlignmentBadge,
  DirectionBadge,
  RiskBadge,
  ScoreBadge,
  StatusBadge
} from "../../../../components/badges";
import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { SectionCard } from "../../../../components/ui";
import { AssetWatchlistControls } from "../../../../components/watchlist-controls";
import { formatDateTime, formatScore } from "../../../../lib/format";
import {
  fetchApi,
  type AssetDetail,
  type EventItem,
  type NewsItem,
  type SignalListItem
} from "../../../../lib/signalpilot-api";
import { signalTypeLabel } from "../../../../lib/labels";

type AssetDetailPageProps = {
  params: Promise<{ symbol: string }>;
};

const SENTIMENT_LABELS: Record<string, string> = {
  POSITIVE: "Positiv",
  NEGATIVE: "Negativ",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt"
};

function sentimentLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  return SENTIMENT_LABELS[s] ?? s;
}

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
  const candleEntries = Object.entries(data.candleCounts);
  const totalCandles = Object.values(data.candleCounts).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* ── Breadcrumb ── */}
      <p className="page-header-breadcrumb" style={{ marginBottom: 12 }}>
        <Link href="/dashboard/assets">Asset-Übersicht</Link>
        {" / "}
        <span>{data.symbol}</span>
      </p>

      {/* ── Asset Profile Header ── */}
      <div className="card sig-header-card">
        <div className="sig-header-top">
          <div>
            <p className="sig-header-symbol">{data.symbol}</p>
            <p className="sig-header-meta">
              {data.name}
              {" · "}{data.assetType}
              {" · "}{data.exchange}
              {data.baseCurrency ? ` · ${data.baseCurrency}/${data.quoteCurrency}` : ""}
            </p>
            {totalCandles > 0 ? (
              <p className="muted small" style={{ marginTop: 3 }}>
                {candleEntries.length} Zeitrahmen · {totalCandles.toLocaleString("de-DE")} Kerzen
              </p>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            {latestSignal ? (
              <ScoreBadge value={latestSignal.score} label="Aktuell" />
            ) : null}
            {!data.isActive ? (
              <span
                className="badge"
                style={{ borderColor: "rgba(248,81,73,0.4)", color: "#ff7b72" }}
              >
                Inaktiv
              </span>
            ) : null}
          </div>
        </div>

        <div className="sig-header-badges">
          <span className={`badge${data.isWatchlisted ? " badge-info" : ""}`}>
            {data.isWatchlisted ? "In Watchlist" : "Nicht in Watchlist"}
          </span>
          {latestSignal ? (
            <>
              <StatusBadge value={latestSignal.status} />
              <DirectionBadge value={latestSignal.direction} />
              <RiskBadge value={latestSignal.riskLevel} />
            </>
          ) : null}
        </div>

        <div className="sig-header-footer">
          <span className="muted small">
            {latestSignal
              ? `Letztes Signal: ${formatDateTime(latestSignal.createdAt)} · ${latestSignal.timeframe}`
              : "Noch kein Signal"}
          </span>
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
      </div>

      {/* ── Aktuelle Beobachtung + Multi-Timeframe ── */}
      <div className="grid two">

        {/* Aktuelle Beobachtung */}
        <SectionCard
          title="Aktuelle Beobachtung"
          action={
            latestSignal ? (
              <Link
                href={`/dashboard/signals/${latestSignal.id}`}
                className="section-link"
              >
                Detail →
              </Link>
            ) : undefined
          }
        >
          {latestSignal ? (
            <div className="stack-list">
              <div className="list-row">
                <div>
                  <strong style={{ display: "block", marginBottom: 4 }}>
                    {signalTypeLabel(latestSignal.signalType)}
                  </strong>
                  <span className="muted small">
                    {latestSignal.timeframe} · {formatDateTime(latestSignal.createdAt)}
                  </span>
                </div>
                <ScoreBadge value={latestSignal.score} />
              </div>
              <div className="signal-card-badges">
                <StatusBadge value={latestSignal.status} />
                <DirectionBadge value={latestSignal.direction} />
                <RiskBadge value={latestSignal.riskLevel} />
              </div>
              {latestOutput?.shortConclusion ? (
                <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}>
                  {latestOutput.shortConclusion}
                </p>
              ) : null}
              {latestOutput?.counterArgument ? (
                <p className="signal-card-counter">{latestOutput.counterArgument}</p>
              ) : null}
              {latestOutput?.nextTrigger ? (
                <p className="signal-card-trigger">
                  Nächste Bestätigung: {latestOutput.nextTrigger}
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Noch kein Signal vorhanden." />
          )}
        </SectionCard>

        {/* Multi-Timeframe */}
        <SectionCard
          title="Multi-Timeframe"
          action={
            <Link href="/dashboard/multi-timeframe" className="section-link">
              Übersicht →
            </Link>
          }
        >
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
                    style={{
                      color:
                        mtf.conflictingTimeframes.length > 0 ? "var(--bad)" : undefined
                    }}
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
            <EmptyState title="Kein Multi-TF-Summary verfügbar." />
          )}
        </SectionCard>
      </div>

      {/* ── Watchlist ── */}
      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Watchlist"
          action={
            <span className={`badge${data.isWatchlisted ? " badge-info" : ""}`}>
              {data.isWatchlisted ? "In Watchlist" : "Nicht in Watchlist"}
            </span>
          }
        >
          <AssetWatchlistControls symbol={data.symbol} watchlistItem={data.watchlistItem} />
        </SectionCard>
      </div>

      {/* ── Kerzen-Abdeckung ── */}
      {candleEntries.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <SectionCard title="Kerzen-Abdeckung">
            <div className="research-snapshot-grid">
              {candleEntries.map(([tf, count]) => (
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
          </SectionCard>
        </div>
      ) : null}

      {/* ── Kerzenchart ── */}
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
                label: signalTypeLabel(latestSignal.signalType)
              }
            : undefined
        }
        title={`Kerzen · ${data.symbol} · ${latestSignal?.timeframe ?? "1d"}`}
      />

      {/* ── Signal-Historie ── */}
      <div style={{ marginTop: 16 }}>
        {signals.error ? (
          <ErrorState title="Signal-Historie konnte nicht geladen werden" message={signals.error} />
        ) : null}
        <SectionCard
          title="Signal-Historie"
          action={
            <Link
              href={`/dashboard/signals?symbol=${encodeURIComponent(data.symbol)}`}
              className="section-link"
            >
              Alle →
            </Link>
          }
        >
          {signals.data && signals.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>TF</th>
                    <th>Signaltyp</th>
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
                      <td>{signalTypeLabel(sig.signalType)}</td>
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
            <EmptyState title="Noch keine Signals für dieses Asset." />
          )}
        </SectionCard>
      </div>

      {/* ── Events ── */}
      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Events"
          action={
            <Link
              href={`/dashboard/events?symbol=${encodeURIComponent(data.symbol)}`}
              className="section-link"
            >
              Alle →
            </Link>
          }
        >
          {!eventsResult.data || eventsResult.data.length === 0 ? (
            <p className="muted small">
              Keine Events gefunden.
              {data.assetType === "ETF" ? " Earnings gelten nicht für ETFs." : ""}
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
        </SectionCard>
      </div>

      {/* ── News ── */}
      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Aktuelle News"
          action={
            <Link
              href={`/dashboard/news?symbol=${encodeURIComponent(data.symbol)}`}
              className="section-link"
            >
              Alle →
            </Link>
          }
        >
          {!newsResult.data || newsResult.data.length === 0 ? (
            <p className="muted small">Keine aktuellen News gefunden.</p>
          ) : (
            <div className="stack-list">
              {newsResult.data.map((item) => (
                <div key={item.id} className="list-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
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
                      <p className="muted small" style={{ margin: "2px 0 0" }}>
                        {item.summary.slice(0, 120)}
                        {item.summary.length > 120 ? "…" : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="right-meta nowrap">
                    <span>{item.source}</span>
                    <span>{formatDateTime(item.publishedAt)}</span>
                    {sentimentLabel(item.sentiment) ? (
                      <span className="muted small">{sentimentLabel(item.sentiment)}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
