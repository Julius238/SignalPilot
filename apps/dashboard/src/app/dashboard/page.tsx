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
  type BotLog,
  type BotRun,
  type MarketRegimeSnapshot,
  type PublicConfig,
  type RadarEvent,
  type ScannerResponse,
  type SignalListItem,
  type WatchlistItem
} from "../../lib/signalpilot-api";

function pipelineStatusColor(status: BotRun["status"] | undefined): string | undefined {
  if (status === "SUCCESS") return "var(--good)";
  if (status === "FAILED") return "var(--bad)";
  return undefined;
}

function radarSeverityColor(severity: RadarEvent["severity"] | undefined): string | undefined {
  if (severity === "CRITICAL") return "var(--bad)";
  if (severity === "IMPORTANT") return "var(--warn)";
  if (severity === "WATCH") return "var(--accent)";
  return undefined;
}

function formatEventType(eventType: RadarEvent["eventType"] | string | undefined) {
  if (eventType === "MOVEMENT_SPIKE") return "Auffällige Bewegung";
  if (eventType === "VOLUME_SPIKE") return "Volumen auffällig";
  if (eventType === "VOLATILITY_SPIKE") return "Erhöhte Volatilität";
  if (eventType === "SCORE_CHANGE") return "Score-Veränderung";
  if (eventType === "REGIME_CHANGE") return "Marktumfeld";
  return "Beobachtung";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "—";
}

function formatRelativeVolume(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}x` : "—";
}

function addMinutes(value: string | null | undefined, minutes: number) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + minutes * 60_000).toISOString();
}

function getAlertSummary(alert: Alert) {
  const payload = isRecord(alert.payloadJson) ? alert.payloadJson : {};
  const symbol = alert.signal?.symbol ?? stringFromRecord(payload, "symbol") ?? "—";
  const type = stringFromRecord(payload, "type") === "radar_event"
    ? formatEventType(stringFromRecord(payload, "eventType"))
    : "Alert";

  return `${symbol} · ${type}`;
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default async function DashboardPage() {
  const [
    health,
    config,
    assets,
    signals,
    alerts,
    radarEvents,
    recentBotRuns,
    workerLogs,
    cryptoPipeline,
    quickRadarRun,
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
    fetchApi<RadarEvent[]>("/radar/events?limit=20"),
    fetchApi<BotRun[]>("/bot-runs?limit=8"),
    fetchApi<BotLog[]>("/logs?service=worker&limit=20"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runCryptoSignalPipeline&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=quickCryptoRadar&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runEquitySignalPipeline&limit=1"),
    fetchApi<ScannerResponse>("/scanner"),
    fetchApi<WatchlistItem[]>("/watchlist?limit=500"),
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest"),
    fetchApi<BacktestRun[]>("/backtests?limit=5")
  ]);

  const watchlistItems = watchlist.data ?? [];
  const signalList = signals.data ?? [];
  const alertList = alerts.data ?? [];
  const radarEventList = radarEvents.data ?? [];
  const recentRuns = recentBotRuns.data ?? [];
  const recentWorkerLogs = workerLogs.data ?? [];
  const lastCrypto = cryptoPipeline.data?.[0] ?? null;
  const lastQuickRadar = quickRadarRun.data?.[0] ?? null;
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
  const latestRadarEvent = radarEventList[0] ?? null;
  const topMovers = [...radarEventList]
    .filter((event) => event.eventType === "MOVEMENT_SPIKE")
    .sort((left, right) => Math.abs(right.movePercent ?? 0) - Math.abs(left.movePercent ?? 0))
    .slice(0, 5);
  const recentActivities = [
    ...radarEventList.slice(0, 6).map((event) => ({
      id: `radar-${event.id}`,
      time: event.createdAt,
      title: `${event.symbol} · ${formatEventType(event.eventType)}`,
      detail: event.shortMessage,
      tone: radarSeverityColor(event.severity)
    })),
    ...recentRuns.slice(0, 5).map((run) => ({
      id: `run-${run.id}`,
      time: run.finishedAt ?? run.startedAt,
      title: `Worker · ${run.jobName}`,
      detail: run.status,
      tone: pipelineStatusColor(run.status)
    })),
    ...alertList.slice(0, 4).map((alert) => ({
      id: `alert-${alert.id}`,
      time: alert.sentAt ?? alert.createdAt,
      title: getAlertSummary(alert),
      detail: alert.status,
      tone: alert.status === "FAILED" ? "var(--bad)" : alert.status === "SENT" ? "var(--good)" : "var(--warn)"
    })),
    ...recentWorkerLogs.slice(0, 4).map((log) => ({
      id: `log-${log.id}`,
      time: log.createdAt,
      title: log.message,
      detail: log.level.toUpperCase(),
      tone: log.level === "error" ? "var(--bad)" : log.level === "warn" ? "var(--warn)" : undefined
    }))
  ]
    .filter((item) => item.time)
    .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
    .slice(0, 8);
  const expectedNextCrypto = addMinutes(lastCrypto?.finishedAt ?? lastCrypto?.startedAt, 15);
  const expectedNextQuickRadar = addMinutes(lastQuickRadar?.finishedAt ?? lastQuickRadar?.startedAt, 5);

  const criticalErrors = [health, config, scanner].filter((r) => r.error);

  const systemWarnings: string[] = [];
  if (health.data?.status !== "ok") systemWarnings.push("API nicht erreichbar.");
  if (!regime) systemWarnings.push("Markt-Regime noch nicht berechnet.");
  if (lastCrypto?.status === "FAILED") systemWarnings.push("Letzte Crypto-Pipeline fehlgeschlagen.");
  if (lastQuickRadar?.status === "FAILED") systemWarnings.push("Letzter Quick Radar Lauf fehlgeschlagen.");
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

      {/* ── Live Radar ── */}
      <div className="grid two" style={{ marginBottom: 20 }}>
        <SectionCard
          title="Live Radar"
          action={
            <Link href="/dashboard/logs" className="section-link">
              Aktivität →
            </Link>
          }
        >
          <div className="health-rows">
            <div className="health-row">
              <span className="health-row-label">Letzte Beobachtung</span>
              <span className="health-row-value muted small">
                {latestRadarEvent
                  ? `${latestRadarEvent.symbol} · ${formatDateTime(latestRadarEvent.createdAt)}`
                  : "—"}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Quick Radar</span>
              <span
                className="health-row-value"
                style={{ color: pipelineStatusColor(lastQuickRadar?.status) }}
              >
                {lastQuickRadar?.status ?? "—"}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Letzter Radar-Lauf</span>
              <span className="health-row-value muted small">
                {formatDateTime(lastQuickRadar?.finishedAt ?? lastQuickRadar?.startedAt)}
              </span>
            </div>
            <div className="health-row">
              <span className="health-row-label">Nächster Radar-Lauf</span>
              <span className="health-row-value muted small">
                {expectedNextQuickRadar ? `ca. ${formatDateTime(expectedNextQuickRadar)}` : "—"}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {radarEventList.length === 0 ? (
              <EmptyState title="Noch keine Radar-Beobachtungen vorhanden." />
            ) : (
              <div className="health-rows">
                {radarEventList.slice(0, 4).map((event) => (
                  <div key={event.id} className="health-row">
                    <div>
                      <div className="health-row-value" style={{ textAlign: "left" }}>
                        {event.symbol} · {formatEventType(event.eventType)}
                      </div>
                      <div className="muted small">{event.shortMessage}</div>
                    </div>
                    <span
                      className="badge badge-info"
                      style={{ color: radarSeverityColor(event.severity) }}
                    >
                      {event.severity}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recent Activity">
          {recentActivities.length === 0 ? (
            <EmptyState title="Noch keine Worker-Aktivität vorhanden." />
          ) : (
            <div className="health-rows">
              {recentActivities.map((item) => (
                <div key={item.id} className="health-row">
                  <div>
                    <div
                      className="health-row-value"
                      style={{ color: item.tone, textAlign: "left" }}
                    >
                      {item.title}
                    </div>
                    <div className="muted small">{item.detail}</div>
                  </div>
                  <span className="muted small">{formatDateTime(item.time)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Auffällige Bewegungen ── */}
      <div className="cmd-section">
        <div className="section-header">
          <h2 className="section-title">Auffällige Bewegungen</h2>
          <span className="muted small">Marktbewegung · Volumen auffällig · Marktumfeld</span>
        </div>
        {topMovers.length === 0 ? (
          <EmptyState title="Noch keine auffälligen Bewegungen aus dem Radar." />
        ) : (
          <div className="grid metrics">
            {topMovers.map((event) => (
              <div key={event.id} className="card">
                <span className="metric-label">{event.symbol}</span>
                <strong className="metric-value-text">{formatPercent(event.movePercent)}</strong>
                <span className="muted small">
                  {event.timeframe} · Volumen {formatRelativeVolume(event.relativeVolume)} · Range{" "}
                  {formatPercent(event.rangePercent)}
                </span>
              </div>
            ))}
          </div>
        )}
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
              <span className="health-row-label">Nächster Crypto-Lauf</span>
              <span className="health-row-value muted small">
                {expectedNextCrypto ? `ca. ${formatDateTime(expectedNextCrypto)}` : "—"}
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
                  ? `${getAlertSummary(latestAlert)} · ${formatDateTime(latestAlert.createdAt)}`
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
