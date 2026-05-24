import Link from "next/link";

import { HealthBadge, RegimeBadge, RiskBadge, RiskModeBadge, StatusBadge } from "../../components/badges";
import { SignalCard } from "../../components/signal-card";
import { EmptyState, ErrorState } from "../../components/empty-state";
import { PageHeader, SectionCard, MetricCard } from "../../components/ui";
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

function pipelineStatusColor(status: BotRun["status"] | undefined): string | undefined {
  if (status === "SUCCESS") return "var(--good)";
  if (status === "FAILED") return "var(--bad)";
  return undefined;
}

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

  const watchlistItems = watchlist.data ?? [];
  const signalList = signals.data ?? [];
  const alertList = alerts.data ?? [];
  const lastCrypto = cryptoPipeline.data?.[0] ?? null;
  const lastEquity = equityPipeline.data?.[0] ?? null;
  const regime = marketRegime.data;
  const scannerSummary = scanner.data?.summary;

  const highPrioritySignals = signalList
    .filter((s) => s.status === "STRONG_WATCH" || s.status === "WATCH")
    .slice(0, 6);
  const highPriorityWatchlist = watchlistItems
    .filter((w) => w.priority === "HIGH")
    .slice(0, 6);

  const failedAlerts = alertList.filter((a) => a.status === "FAILED").length;
  const activeAlertCount = watchlistItems.filter((w) => w.alertEnabled).length;
  const latestAlert = alertList[0] ?? null;
  const latestBacktest = backtests.data?.find((b) => b.status === "SUCCESS") ?? null;

  const criticalErrors = [health, config, scanner].filter((r) => r.error);

  const systemWarnings: string[] = [];
  if (health.data?.status !== "ok") systemWarnings.push("API nicht erreichbar.");
  if (!regime) systemWarnings.push("Markt-Regime noch nicht berechnet.");
  if (lastCrypto?.status === "FAILED") systemWarnings.push("Letzte Crypto-Pipeline fehlgeschlagen.");
  if (lastEquity?.status === "FAILED") systemWarnings.push("Letzte Equity-Pipeline fehlgeschlagen.");
  if (failedAlerts > 0) systemWarnings.push(`${failedAlerts} fehlgeschlagene Alerts.`);

  return (
    <>
      {/* ── Page header ── */}
      <PageHeader
        title="Command Center"
        subtitle="Markt-Intelligence-Übersicht · SignalPilot"
        actions={
          <>
            <Link className="primary-link" href="/dashboard/scanner">Scanner</Link>
            <Link className="primary-link secondary-link" href="/dashboard/watchlist">Watchlist</Link>
            <Link className="primary-link secondary-link" href="/dashboard/signals">Signals</Link>
          </>
        }
      />

      {/* ── API-Fehler ── */}
      {criticalErrors.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title="API-Fehler"
            message={criticalErrors.map((r) => r.error).join(" | ")}
          />
        </div>
      ) : null}

      {/* ── System-Warnungen ── */}
      {systemWarnings.length > 0 ? (
        <div className="warning-section" style={{ marginBottom: 20 }}>
          <h3 className="warning-section-title">
            System-Warnungen ({systemWarnings.length})
          </h3>
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

      {/* ── Scanner-Metriken ── */}
      <div className="grid metrics">
        <MetricCard
          label="Starke Beobachtung"
          value={scannerSummary?.strongWatchCount ?? 0}
          sub="aktive Signals"
        />
        <MetricCard
          label="Beobachten"
          value={scannerSummary?.watchCount ?? 0}
          sub="aktive Signals"
        />
        <MetricCard
          label="Aufwärts-Ausrichtung"
          value={scannerSummary?.bullishAlignedCount ?? 0}
          sub="Multi-TF bestätigt"
        />
        <MetricCard
          label="Abwärts-Ausrichtung"
          value={scannerSummary?.bearishAlignedCount ?? 0}
          sub="Multi-TF bestätigt"
        />
        <MetricCard
          label="Konflikte"
          value={scannerSummary?.conflictCount ?? 0}
          sub="Multi-TF-Konflikt"
        />
        <MetricCard
          label="Alerts heute"
          value={scannerSummary?.alertsSentToday ?? 0}
          sub="versandte Alerts"
        />
      </div>

      {/* ── Primäre Statuskarten ── */}
      <div className="cmd-status-row">

        {/* Markt-Regime */}
        <SectionCard
          title="Markt-Regime"
          action={
            <Link href="/dashboard/market-regime" className="section-link">
              Details →
            </Link>
          }
        >
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
                    <span
                      className="health-row-label muted small"
                      style={{ flex: 1, whiteSpace: "normal" }}
                    >
                      {regime.report.riskNote.slice(0, 120)}
                      {regime.report.riskNote.length > 120 ? "…" : ""}
                    </span>
                  </div>
                ) : null}
              </div>
              <span className="muted small">{formatDateTime(regime.generatedAt)}</span>
            </div>
          ) : (
            <EmptyState title="Noch nicht berechnet. Pipeline ausführen." />
          )}
        </SectionCard>

        {/* Pipeline-Status */}
        <SectionCard
          title="Pipeline-Status"
          action={
            <Link href="/dashboard/logs" className="section-link">
              Logs →
            </Link>
          }
        >
          <div className="health-rows">
            <div className="health-row">
              <span className="health-row-label">API</span>
              <HealthBadge ok={health.data?.status === "ok"} />
            </div>
            <div className="health-row">
              <span className="health-row-label">Crypto Pipeline</span>
              <span
                className="health-row-value"
                style={{ color: pipelineStatusColor(lastCrypto?.status) }}
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
                style={{ color: pipelineStatusColor(lastEquity?.status) }}
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
        </SectionCard>

        {/* System & Alerts */}
        <SectionCard
          title="System & Alerts"
          action={
            <Link href="/dashboard/data-quality" className="section-link">
              Datenqualität →
            </Link>
          }
        >
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
              <span className="health-row-label">Watchlist</span>
              <span className="health-row-value">
                {watchlistItems.length} · {activeAlertCount} mit Alert
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Letzter Alert</span>
              <span className="health-row-value muted small">
                {latestAlert
                  ? `${latestAlert.signal?.symbol ?? "—"} · ${formatDateTime(latestAlert.createdAt)}`
                  : "—"}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Fehlgeschlagene Alerts</span>
              <span
                className="health-row-value"
                style={{ color: failedAlerts > 0 ? "var(--bad)" : "var(--good)" }}
              >
                {failedAlerts > 0 ? failedAlerts : "Keine"}
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Signal-Highlights ── */}
      <div className="cmd-section">
        <div className="section-header">
          <h2 className="section-title">Signal-Highlights</h2>
          <Link href="/dashboard/scanner" className="section-link">
            Alle im Scanner →
          </Link>
        </div>
        {highPrioritySignals.length === 0 ? (
          <EmptyState title="Keine aktiven Signals mit hoher Priorität." />
        ) : (
          <div className="signal-cards-list">
            {highPrioritySignals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>

      {/* ── Watchlist-Fokus + Research-Snapshot ── */}
      <div className="grid two">

        {/* Watchlist-Fokus */}
        <SectionCard
          title="Watchlist-Fokus"
          action={
            <Link href="/dashboard/watchlist" className="section-link">
              Alle →
            </Link>
          }
        >
          {highPriorityWatchlist.length === 0 ? (
            <EmptyState title="Keine High-Priority-Einträge in der Watchlist." />
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
                          <StatusBadge value={item.latestSignal.status} />
                          <RiskBadge value={item.latestSignal.riskLevel} />
                        </>
                      ) : null}
                      {item.alertEnabled ? (
                        <span className="badge badge-info">Alert aktiv</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Research-Snapshot */}
        <SectionCard
          title="Research-Snapshot"
          action={
            <Link href="/dashboard/backtests" className="section-link">
              Backtests →
            </Link>
          }
        >
          <div className="research-snapshot-grid">
            <div className="research-stat">
              <div className="research-stat-label">Signals gesamt</div>
              <div className="research-stat-value">{signalList.length}</div>
            </div>
            <div className="research-stat">
              <div className="research-stat-label">Backtest-Trefferquote</div>
              <div className="research-stat-value">
                {latestBacktest
                  ? `${((latestBacktest.winRate ?? 0) * 100).toFixed(0)}%`
                  : "—"}
              </div>
              {latestBacktest ? (
                <div className="research-stat-sub">
                  {latestBacktest.totalSignals} Signals
                  {latestBacktest.totalSignals < 30 ? (
                    <span style={{ color: "var(--warn)" }}> · kleine Stichprobe</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="research-stat">
              <div className="research-stat-label">Strong Watch</div>
              <div className="research-stat-value">
                {scannerSummary?.strongWatchCount ?? 0}
              </div>
              <div className="research-stat-sub">aktuelle Signals</div>
            </div>
            <div className="research-stat">
              <div className="research-stat-label">High Priority WL</div>
              <div className="research-stat-value">
                {watchlistItems.filter((w) => w.priority === "HIGH").length}
              </div>
              <div className="research-stat-sub">
                von {watchlistItems.length} gesamt
              </div>
            </div>
          </div>
          <div className="health-rows" style={{ marginTop: 14 }}>
            <div className="health-row">
              <Link href="/dashboard/backtests" className="muted small">
                Backtest-Läufe →
              </Link>
            </div>
            <div className="health-row">
              <Link href="/dashboard/strategy-lab" className="muted small">
                Strategy Lab →
              </Link>
            </div>
            <div className="health-row">
              <Link href="/dashboard/performance" className="muted small">
                Performance →
              </Link>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
