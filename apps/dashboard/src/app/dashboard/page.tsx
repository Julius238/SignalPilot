import Link from "next/link";

import { HealthBadge, RegimeBadge, RiskModeBadge } from "../../components/badges";
import { SignalCard } from "../../components/signal-card";
import { ErrorState } from "../../components/empty-state";
import { formatDateTime } from "../../lib/format";
import {
  fetchApi,
  type Alert,
  type Asset,
  type BacktestRun,
  type BotRun,
  type MarketRegimeSnapshot,
  type PublicConfig,
  type ScannerResponse,
  type SignalListItem,
  type WatchlistItem
} from "../../lib/signalpilot-api";

export default async function DashboardPage() {
  const [
    health,
    config,
    assets,
    signals,
    alerts,
    cryptoPipeline,
    equityPipeline,
    scanner,
    watchlist,
    marketRegime,
    backtests
  ] = await Promise.all([
    fetchApi<{ status: string }>("/health"),
    fetchApi<PublicConfig>("/config/public"),
    fetchApi<Asset[]>("/assets?limit=500"),
    fetchApi<SignalListItem[]>("/signals?limit=200"),
    fetchApi<Alert[]>("/alerts?limit=50"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runCryptoSignalPipeline&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runEquitySignalPipeline&limit=1"),
    fetchApi<ScannerResponse>("/scanner"),
    fetchApi<WatchlistItem[]>("/watchlist?limit=500"),
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest"),
    fetchApi<BacktestRun[]>("/backtests?limit=5")
  ]);

  const criticalErrors = [health, config, scanner].filter((r) => r.error);
  const watchlistItems = watchlist.data ?? [];
  const signalList = signals.data ?? [];
  const alertList = alerts.data ?? [];
  const lastCrypto = cryptoPipeline.data?.[0] ?? null;
  const lastEquity = equityPipeline.data?.[0] ?? null;
  const regime = marketRegime.data;

  const highPrioritySignals = signalList
    .filter((s) => s.status === "STRONG_WATCH" || s.status === "WATCH")
    .slice(0, 6);
  const highPriorityWatchlist = watchlistItems
    .filter((w) => w.priority === "HIGH")
    .slice(0, 6);

  const latestAlert = alertList[0] ?? null;
  const failedAlerts = alertList.filter((a) => a.status === "FAILED").length;
  const activeAlertCount = watchlistItems.filter((w) => w.alertEnabled).length;

  const latestBacktest = backtests.data?.find((b) => b.status === "SUCCESS") ?? null;

  const systemWarnings: string[] = [];
  if (health.data?.status !== "ok") systemWarnings.push("API nicht erreichbar.");
  if (!regime) systemWarnings.push("Markt-Regime noch nicht berechnet.");
  if (lastCrypto?.status === "FAILED") systemWarnings.push("Letzte Crypto-Pipeline fehlgeschlagen.");
  if (lastEquity?.status === "FAILED") systemWarnings.push("Letzte Equity-Pipeline fehlgeschlagen.");
  if (failedAlerts > 0) systemWarnings.push(`${failedAlerts} fehlgeschlagene Alerts.`);

  return (
    <>
      {criticalErrors.length > 0 ? (
        <ErrorState
          title="API-Fehler"
          message={criticalErrors.map((r) => r.error).join(" | ")}
        />
      ) : null}

      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h1>Command Center</h1>
          <p className="muted">Markt-Intelligence-Übersicht · SignalPilot</p>
        </div>
        <div className="page-actions">
          <Link className="primary-link" href="/dashboard/scanner">
            Scanner öffnen
          </Link>
          <Link className="primary-link secondary-link" href="/dashboard/watchlist">
            Watchlist
          </Link>
          <Link className="primary-link secondary-link" href="/dashboard/signals">
            Alle Signals
          </Link>
        </div>
      </div>

      {/* ── Top status row ── */}
      <div className="cmd-status-row">

        {/* Market Regime */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Markt-Regime</h2>
            <Link href="/dashboard/market-regime" className="section-link">Details →</Link>
          </div>
          {regime ? (
            <div className="regime-card-content">
              <div className="regime-row">
                <RegimeBadge value={regime.overallRegime} />
                <RiskModeBadge value={regime.riskMode} />
              </div>
              <div className="confidence-bar-wrap">
                <div className="confidence-label">
                  <span>Konfidenz</span>
                  <strong>{Math.round(regime.confidence * 100)}%</strong>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(regime.confidence * 100)}%` }}
                  />
                </div>
              </div>
              <div className="health-rows">
                <div className="health-row">
                  <span className="health-row-label">Equity</span>
                  <span className="health-row-value">{regime.equityRegime}</span>
                </div>
                <div className="health-row">
                  <span className="health-row-label">Crypto</span>
                  <span className="health-row-value">{regime.cryptoRegime}</span>
                </div>
                {regime.report?.riskNote ? (
                  <div className="health-row">
                    <span className="health-row-label muted small" style={{ flex: 1, whiteSpace: "normal" }}>
                      {regime.report.riskNote.slice(0, 120)}
                      {regime.report.riskNote.length > 120 ? "…" : ""}
                    </span>
                  </div>
                ) : null}
              </div>
              <span className="muted small">{formatDateTime(regime.generatedAt)}</span>
            </div>
          ) : (
            <p className="muted small">Noch nicht berechnet. Pipeline ausführen.</p>
          )}
        </div>

        {/* Pipeline Health */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Pipeline-Status</h2>
            <Link href="/dashboard/logs" className="section-link">Logs →</Link>
          </div>
          <div className="health-rows">
            <div className="health-row">
              <span className="health-row-label">API</span>
              <HealthBadge ok={health.data?.status === "ok"} />
            </div>
            <div className="health-row">
              <span className="health-row-label">Crypto Pipeline</span>
              <span
                className={`health-row-value ${lastCrypto?.status === "SUCCESS" ? "" : lastCrypto?.status === "FAILED" ? "muted" : ""}`}
                style={{ color: lastCrypto?.status === "FAILED" ? "var(--bad)" : lastCrypto?.status === "SUCCESS" ? "var(--good)" : undefined }}
              >
                {lastCrypto?.status ?? "—"}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Letzter Crypto-Lauf</span>
              <span className="health-row-value muted small">
                {formatDateTime(lastCrypto?.finishedAt ?? lastCrypto?.startedAt)}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Equity Pipeline</span>
              <span
                className="health-row-value"
                style={{ color: lastEquity?.status === "FAILED" ? "var(--bad)" : lastEquity?.status === "SUCCESS" ? "var(--good)" : undefined }}
              >
                {lastEquity?.status ?? "—"}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Letzter Equity-Lauf</span>
              <span className="health-row-value muted small">
                {formatDateTime(lastEquity?.finishedAt ?? lastEquity?.startedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">System</h2>
            <Link href="/dashboard/data-quality" className="section-link">Qualität →</Link>
          </div>
          <div className="health-rows">
            <div className="health-row">
              <span className="health-row-label">Alert-Modus</span>
              <span className="health-row-value">{config.data?.alertMode ?? "—"}</span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Assets</span>
              <span className="health-row-value">{assets.data?.length ?? 0}</span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Watchlist (aktiv)</span>
              <span className="health-row-value">
                {watchlistItems.length} · {activeAlertCount} mit Alert
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Letzter Alert</span>
              <span className="health-row-value muted small">
                {latestAlert
                  ? `${latestAlert.signal?.symbol ?? "—"} · ${latestAlert.status} · ${formatDateTime(latestAlert.createdAt)}`
                  : "—"}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Fehlgeschlagene Alerts</span>
              <span
                className="health-row-value"
                style={{ color: failedAlerts > 0 ? "var(--bad)" : undefined }}
              >
                {failedAlerts}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Scanner summary strip ── */}
      <div className="regime-banner">
        <span className="regime-banner-label">Scanner</span>
        <div className="regime-banner-block">
          <span className="regime-banner-value">{scanner.data?.summary.strongWatchCount ?? 0}</span>
          <span className="muted small">Starke Beobachtung</span>
        </div>
        <span className="regime-sep">·</span>
        <div className="regime-banner-block">
          <span className="regime-banner-value">{scanner.data?.summary.watchCount ?? 0}</span>
          <span className="muted small">Beobachten</span>
        </div>
        <span className="regime-sep">·</span>
        <div className="regime-banner-block">
          <span className="regime-banner-value">{scanner.data?.summary.bullishAlignedCount ?? 0}</span>
          <span className="muted small" style={{ color: "var(--good)" }}>Aufwärts</span>
        </div>
        <span className="regime-sep">·</span>
        <div className="regime-banner-block">
          <span className="regime-banner-value">{scanner.data?.summary.bearishAlignedCount ?? 0}</span>
          <span className="muted small" style={{ color: "var(--bad)" }}>Abwärts</span>
        </div>
        <span className="regime-sep">·</span>
        <div className="regime-banner-block">
          <span className="regime-banner-value">{scanner.data?.summary.conflictCount ?? 0}</span>
          <span className="muted small">Konflikte</span>
        </div>
        <span className="regime-sep">·</span>
        <div className="regime-banner-block">
          <span className="regime-banner-value">{scanner.data?.summary.alertsSentToday ?? 0}</span>
          <span className="muted small">Alerts heute</span>
        </div>
      </div>

      {/* ── Signal Highlights ── */}
      <div className="cmd-section">
        <div className="section-header">
          <h2 className="section-title">Signal-Highlights</h2>
          <Link href="/dashboard/scanner" className="section-link">
            Alle im Scanner →
          </Link>
        </div>
        {highPrioritySignals.length === 0 ? (
          <div className="empty-state">Keine aktiven Signals mit hoher Priorität.</div>
        ) : (
          <div className="signal-cards-list">
            {highPrioritySignals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>

      {/* ── Watchlist Focus + Research Snapshot side by side ── */}
      <div className="grid two">
        {/* Watchlist Focus */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Watchlist-Fokus</h2>
            <Link href="/dashboard/watchlist" className="section-link">Alle →</Link>
          </div>
          {highPriorityWatchlist.length === 0 ? (
            <div className="empty-state">Keine High-Priority-Einträge in der Watchlist.</div>
          ) : (
            <div className="watchlist-focus-grid">
              {highPriorityWatchlist.map((item) => (
                <div key={item.id} className="watchlist-focus-row">
                  <div>
                    <Link
                      href={`/dashboard/assets/${encodeURIComponent(item.symbol)}`}
                      className="watchlist-focus-symbol"
                    >
                      {item.symbol}
                    </Link>
                    <div className="watchlist-focus-meta">
                      {item.asset.assetType}
                      {item.latestSignal
                        ? ` · ${item.latestSignal.timeframe} · ${item.latestSignal.signalType}`
                        : " · Kein Signal"}
                    </div>
                  </div>
                  <div className="watchlist-focus-right">
                    <div className="signal-card-badges">
                      {item.latestSignal ? (
                        <>
                          <span
                            className={`badge status-${item.latestSignal.status.toLowerCase()}`}
                            title={item.latestSignal.status}
                          >
                            {item.latestSignal.status === "STRONG_WATCH"
                              ? "Stark"
                              : item.latestSignal.status === "WATCH"
                                ? "Beob."
                                : item.latestSignal.status}
                          </span>
                          <span className={`badge risk-${item.latestSignal.riskLevel.toLowerCase()}`}>
                            {item.latestSignal.riskLevel}
                          </span>
                        </>
                      ) : null}
                      {item.alertEnabled ? (
                        <span className="badge" style={{ borderColor: "rgba(88,166,255,0.4)", color: "#79c0ff" }}>
                          Alert aktiv
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Research Snapshot */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Research-Snapshot</h2>
            <Link href="/dashboard/backtests" className="section-link">Backtests →</Link>
          </div>
          <div className="research-snapshot-grid">
            <div className="research-stat">
              <div className="research-stat-label">Signals (gesamt)</div>
              <div className="research-stat-value">{signalList.length}</div>
            </div>
            <div className="research-stat">
              <div className="research-stat-label">Letzter Backtest</div>
              <div className="research-stat-value">
                {latestBacktest
                  ? `${((latestBacktest.winRate ?? 0) * 100).toFixed(0)}%`
                  : "—"}
              </div>
              {latestBacktest ? (
                <div className="research-stat-sub">
                  Trefferquote · {latestBacktest.totalSignals} Signals
                  {latestBacktest.totalSignals < 30 ? (
                    <span style={{ color: "var(--warn)" }}> · kleine Stichprobe</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="research-stat">
              <div className="research-stat-label">Strong Watch</div>
              <div className="research-stat-value">
                {scanner.data?.summary.strongWatchCount ?? 0}
              </div>
              <div className="research-stat-sub">aktuelle Signals</div>
            </div>
            <div className="research-stat">
              <div className="research-stat-label">High Priority WL</div>
              <div className="research-stat-value">
                {watchlistItems.filter((w) => w.priority === "HIGH").length}
              </div>
              <div className="research-stat-sub">von {watchlistItems.length} gesamt</div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="health-rows">
              <div className="health-row">
                <Link href="/dashboard/backtests" className="muted small">Backtest-Läufe →</Link>
              </div>
              <div className="health-row">
                <Link href="/dashboard/strategy-lab" className="muted small">Strategy Lab →</Link>
              </div>
              <div className="health-row">
                <Link href="/dashboard/performance" className="muted small">Performance →</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── System Warnings ── */}
      {systemWarnings.length > 0 ? (
        <div className="warning-section" style={{ marginTop: 20 }}>
          <h3 className="warning-section-title">System-Warnungen</h3>
          <ul className="warning-list">
            {systemWarnings.map((w) => (
              <li key={w} className="warning-item">
                <span className="warning-icon">⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
