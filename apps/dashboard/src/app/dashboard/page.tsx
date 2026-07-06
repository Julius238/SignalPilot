import Link from "next/link";

import { SignalCard } from "../../components/signal-card";
import { EmptyState, ErrorState } from "../../components/empty-state";
import { PageHeader, SectionCard } from "../../components/ui";
import { HeroBand, type HeroMetric } from "../../components/dashboard/hero-band";
import { PriorityFeed, type PriorityItem } from "../../components/dashboard/priority-feed";
import { RadarColumns } from "../../components/dashboard/radar-columns";
import { SystemPanel, type WorkerStatusRow } from "../../components/dashboard/system-panel";
import { NewsWorldMap } from "../../components/dashboard/news-world-map";
import {
  chartPatternEventTypes,
  marketEventTypeLabels,
  radarEventTypeLabel,
  severityColor,
  severityRank,
  withinHours
} from "../../components/dashboard/shared";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import {
  fetchApi,
  type Alert,
  type BotLog,
  type BotRun,
  type MarketEvent,
  type MarketRegimeSnapshot,
  type PublicConfig,
  type RadarEvent,
  type ScannerResponse,
  type SignalListItem,
  type WatchlistItem
} from "../../lib/signalpilot-api";

// Command Center v2 — Aufbau als Geschichte in fünf Bändern:
// 1. Marktlage (Hero)  2. Wichtig jetzt  3. Woher & was betroffen (Karte + Impact)
// 4. Radar (Bewegungen / Patterns / globale Ereignisse)  5. Signale, Aktivität, System.

const severityWeights: Record<MarketEvent["severity"], number> = {
  CRITICAL: 3,
  IMPORTANT: 2,
  WATCH: 1,
  INFO: 0.5
};

const impactWindowHours = 48;

type ImpactMapEntry = {
  area: string;
  score: number;
  positiveCount: number;
  negativeCount: number;
  tone: "chance" | "risiko" | "gemischt";
};

function buildImpactMap(events: MarketEvent[], now: Date): ImpactMapEntry[] {
  const areas = new Map<string, { score: number; positiveCount: number; negativeCount: number }>();

  const bump = (area: string, scoreDelta: number, side: "positiveCount" | "negativeCount") => {
    const entry = areas.get(area) ?? { score: 0, positiveCount: 0, negativeCount: 0 };
    entry.score += scoreDelta;
    entry[side] += 1;
    areas.set(area, entry);
  };

  for (const event of events) {
    if (!withinHours(event.detectedAt, impactWindowHours, now)) continue;
    const weight = severityWeights[event.severity] ?? 0.5;

    for (const area of event.positiveImpact ?? []) bump(area, weight, "positiveCount");
    for (const area of event.negativeImpact ?? []) bump(area, -weight, "negativeCount");
  }

  return [...areas.entries()]
    .map(([area, entry]) => {
      const smaller = Math.min(entry.positiveCount, entry.negativeCount);
      const larger = Math.max(entry.positiveCount, entry.negativeCount);
      const isMixed = smaller > 0 && smaller / larger >= 0.5;
      const tone: ImpactMapEntry["tone"] = isMixed
        ? "gemischt"
        : entry.score >= 0
          ? "chance"
          : "risiko";

      return { area, tone, ...entry };
    })
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
    .slice(0, 8);
}

const impactToneStyles: Record<ImpactMapEntry["tone"], { label: string; color: string }> = {
  chance: { label: "Potenzielle Chance", color: "var(--good)" },
  risiko: { label: "Potenzielles Risiko", color: "var(--bad)" },
  gemischt: { label: "Gemischte Signale", color: "var(--warn)" }
};

const riskClusters: Array<{ label: string; types: Array<MarketEvent["eventType"]> }> = [
  { label: "Makro", types: ["CENTRAL_BANK", "RATES", "INFLATION", "LABOR_MARKET", "MACRO"] },
  { label: "Geopolitik", types: ["GEOPOLITICAL", "SANCTIONS", "CONFLICT"] },
  { label: "Rohstoffe", types: ["ENERGY_COMMODITY", "SUPPLY_CHAIN"] },
  { label: "Markt", types: ["RISK_SENTIMENT", "CORPORATE", "OTHER"] }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getAlertSummary(alert: Alert) {
  const payload = isRecord(alert.payloadJson) ? alert.payloadJson : {};
  const symbol = alert.signal?.symbol ?? stringFromRecord(payload, "symbol");
  const title = stringFromRecord(payload, "title");
  return title ?? (symbol ? `${symbol} · Alert` : "Alert");
}

export default async function DashboardPage() {
  const [
    health,
    config,
    signals,
    alerts,
    radarEvents,
    marketEvents,
    workerLogs,
    cryptoPipeline,
    quickRadarRun,
    equityPipeline,
    eventMonitorRun,
    equityRadarRun,
    scanner,
    watchlist,
    marketRegime
  ] = await Promise.all([
    fetchApi<{ status: string }>("/health"),
    fetchApi<PublicConfig>("/config/public"),
    fetchApi<SignalListItem[]>("/signals?limit=100"),
    fetchApi<Alert[]>("/alerts?limit=30"),
    fetchApi<RadarEvent[]>("/radar/events?limit=40"),
    fetchApi<MarketEvent[]>("/market-events?limit=50"),
    fetchApi<BotLog[]>("/logs?service=worker&limit=12"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runCryptoSignalPipeline&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=quickCryptoRadar&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runEquitySignalPipeline&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=globalEventMonitor&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=quickEquityRadar&limit=1"),
    fetchApi<ScannerResponse>("/scanner"),
    fetchApi<WatchlistItem[]>("/watchlist?limit=200"),
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest")
  ]);

  const renderedAt = new Date();
  const signalList = signals.data ?? [];
  const alertList = alerts.data ?? [];
  const radarEventList = radarEvents.data ?? [];
  const marketEventList = marketEvents.data ?? [];
  const recentWorkerLogs = workerLogs.data ?? [];
  const watchlistItems = watchlist.data ?? [];
  const regime = marketRegime.data;
  const scannerSummary = scanner.data?.summary;
  const lastCrypto = cryptoPipeline.data?.[0] ?? null;
  const lastQuickRadar = quickRadarRun.data?.[0] ?? null;
  const lastEquity = equityPipeline.data?.[0] ?? null;
  const lastEventMonitor = eventMonitorRun.data?.[0] ?? null;
  const lastEquityRadar = equityRadarRun.data?.[0] ?? null;

  // ── Abgeleitete Sichten ──
  const radarLast24h = radarEventList.filter((event) => withinHours(event.createdAt, 24, renderedAt));
  const eventsLast48h = marketEventList.filter((event) =>
    withinHours(event.detectedAt, impactWindowHours, renderedAt)
  );
  const patternEvents = radarEventList
    .filter((event) => chartPatternEventTypes.includes(event.eventType))
    .slice(0, 5);
  const marketMoves = radarEventList
    .filter((event) => !chartPatternEventTypes.includes(event.eventType))
    .slice(0, 5);
  const impactMap = buildImpactMap(marketEventList, renderedAt);
  const clusterChips = riskClusters
    .map((cluster) => ({
      label: cluster.label,
      count: eventsLast48h.filter((event) => cluster.types.includes(event.eventType)).length
    }))
    .filter((chip) => chip.count > 0);

  const priorityItems: PriorityItem[] = [
    ...eventsLast48h.map(
      (event): PriorityItem => ({
        id: `event-${event.id}`,
        kind: "Event",
        severity: event.severity,
        title: event.title,
        detail: [
          marketEventTypeLabels[event.eventType] ?? event.eventType,
          event.region,
          event.source
        ]
          .filter(Boolean)
          .join(" · "),
        time: event.detectedAt,
        externalUrl: event.sourceUrl
      })
    ),
    ...radarLast24h.map(
      (event): PriorityItem => ({
        id: `radar-${event.id}`,
        kind: chartPatternEventTypes.includes(event.eventType) ? "Chart" : "Radar",
        severity: event.severity,
        title: `${event.symbol} · ${radarEventTypeLabel(event.eventType)}`,
        detail: event.shortMessage,
        time: event.createdAt,
        href: `/dashboard/assets/${encodeURIComponent(event.symbol)}`
      })
    )
  ]
    .sort(
      (left, right) =>
        severityRank(right.severity) - severityRank(left.severity) ||
        new Date(right.time).getTime() - new Date(left.time).getTime()
    )
    .slice(0, 6);

  const failedAlerts = alertList.filter((alert) => alert.status === "FAILED").length;
  const latestAlert = alertList[0] ?? null;
  const highPrioritySignals = signalList
    .filter((signal) => signal.status === "STRONG_WATCH" || signal.status === "WATCH")
    .slice(0, 3);
  const highPriorityWatchlist = watchlistItems.filter((item) => item.priority === "HIGH");

  const heroMetrics: HeroMetric[] = [
    {
      label: "Beobachtungen 24h",
      value: radarLast24h.length,
      sub: "Radar & Chart-Patterns",
      href: "/dashboard/scanner"
    },
    {
      label: "Globale Events 48h",
      value: eventsLast48h.length,
      sub: "Makro · Geopolitik · Rohstoffe",
      href: "/dashboard/events"
    },
    {
      label: "Aktive Signale",
      value: (scannerSummary?.strongWatchCount ?? 0) + (scannerSummary?.watchCount ?? 0),
      sub: `${scannerSummary?.strongWatchCount ?? 0} starke Beobachtung`,
      href: "/dashboard/signals"
    },
    {
      label: "Alerts heute",
      value: scannerSummary?.alertsSentToday ?? 0,
      sub: failedAlerts > 0 ? `${failedAlerts} fehlgeschlagen` : "alle zugestellt",
      href: "/dashboard/logs",
      tone: failedAlerts > 0 ? "var(--bad)" : undefined
    }
  ];

  const workerRows: WorkerStatusRow[] = [
    {
      label: "Crypto Pipeline",
      status: lastCrypto?.status,
      time: lastCrypto?.finishedAt ?? lastCrypto?.startedAt
    },
    {
      label: "Quick Radar",
      status: lastQuickRadar?.status,
      time: lastQuickRadar?.finishedAt ?? lastQuickRadar?.startedAt
    },
    {
      label: "Equity Pipeline",
      status: lastEquity?.status,
      time: lastEquity?.finishedAt ?? lastEquity?.startedAt,
      note: "deaktiviert"
    },
    {
      label: "Equity-Radar",
      status: lastEquityRadar?.status,
      time: lastEquityRadar?.finishedAt ?? lastEquityRadar?.startedAt,
      note: "deaktiviert"
    },
    {
      label: "Event Monitor",
      status: lastEventMonitor?.status,
      time: lastEventMonitor?.finishedAt ?? lastEventMonitor?.startedAt,
      note: "deaktiviert"
    }
  ];

  const recentActivities = [
    ...radarEventList.slice(0, 5).map((event) => ({
      id: `radar-${event.id}`,
      time: event.createdAt,
      title: `${event.symbol} · ${radarEventTypeLabel(event.eventType)}`,
      tone: severityColor(event.severity)
    })),
    ...alertList.slice(0, 4).map((alert) => ({
      id: `alert-${alert.id}`,
      time: alert.sentAt ?? alert.createdAt,
      title: `Alert · ${getAlertSummary(alert)}`,
      tone:
        alert.status === "FAILED"
          ? "var(--bad)"
          : alert.status === "SENT"
            ? "var(--good)"
            : "var(--warn)"
    })),
    ...recentWorkerLogs.slice(0, 5).map((log) => ({
      id: `log-${log.id}`,
      time: log.createdAt,
      title: log.message,
      tone:
        log.level === "error" ? "var(--bad)" : log.level === "warn" ? "var(--warn)" : undefined
    }))
  ]
    .filter((item) => item.time)
    .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
    .slice(0, 9);

  const criticalErrors = [health, config, scanner].filter((result) => result.error);

  const systemWarnings: string[] = [];
  if (health.data?.status !== "ok") systemWarnings.push("API nicht erreichbar.");
  if (!regime) systemWarnings.push("Markt-Regime noch nicht berechnet.");
  if (lastCrypto?.status === "FAILED") systemWarnings.push("Letzte Crypto-Pipeline fehlgeschlagen.");
  if (lastQuickRadar?.status === "FAILED") systemWarnings.push("Letzter Quick Radar Lauf fehlgeschlagen.");
  if (lastEquity?.status === "FAILED") systemWarnings.push("Letzte Equity-Pipeline fehlgeschlagen.");
  if (lastEventMonitor?.status === "FAILED") systemWarnings.push("Letzter Event-Monitor-Lauf fehlgeschlagen.");
  if (lastEquityRadar?.status === "FAILED") systemWarnings.push("Letzter Equity-Radar-Lauf fehlgeschlagen.");
  if (failedAlerts > 0) systemWarnings.push(`${failedAlerts} fehlgeschlagene Alerts.`);

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={`Global Market Intelligence Radar · Stand: ${formatDateTime(renderedAt.toISOString())}`}
        actions={
          <>
            <Link className="primary-link" href="/dashboard/scanner">
              Scanner
            </Link>
            <Link className="primary-link secondary-link" href="/dashboard/watchlist">
              Watchlist
            </Link>
          </>
        }
      />

      {criticalErrors.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title="API-Fehler"
            message={criticalErrors.map((result) => result.error).join(" | ")}
          />
        </div>
      ) : null}

      {systemWarnings.length > 0 ? (
        <div className="warning-section" style={{ marginBottom: 20 }}>
          <h3 className="warning-section-title">System-Warnungen ({systemWarnings.length})</h3>
          <ul className="warning-list">
            {systemWarnings.map((warning) => (
              <li key={warning} className="warning-item">
                <span className="warning-icon">⚠</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="all-clear-line">
          <span className="status-dot" style={{ backgroundColor: "var(--good)" }} />
          Alle Systeme laufen · letzte Prüfung {formatRelativeTime(renderedAt.toISOString(), renderedAt)}
        </p>
      )}

      {/* ── 1 · Marktlage ── */}
      <HeroBand regime={regime} metrics={heroMetrics} />

      {/* ── 2 · Wichtig jetzt ── */}
      <PriorityFeed items={priorityItems} now={renderedAt} />

      {/* ── 3 · Woher kommen die News & was ist betroffen ── */}
      <div className="grid two map-row">
        <SectionCard title="News-Weltkarte">
          {eventsLast48h.length === 0 ? (
            <EmptyState title="Keine globalen Ereignisse in den letzten 48h — die Karte füllt sich, sobald der Event Monitor Ereignisse erkennt." />
          ) : (
            <NewsWorldMap events={eventsLast48h} now={renderedAt} />
          )}
        </SectionCard>
        <SectionCard title="Asset Impact Map">
          {impactMap.length === 0 ? (
            <EmptyState title="Noch keine Impact-Zuordnungen im Zeitfenster. Sie entstehen automatisch aus erkannten Ereignissen." />
          ) : (
            <div className="impact-list">
              {impactMap.map((entry) => (
                <div key={entry.area} className="impact-row">
                  <span className="impact-area">{entry.area}</span>
                  <span className="muted small">
                    {entry.positiveCount > 0 ? `${entry.positiveCount}× positiv` : null}
                    {entry.positiveCount > 0 && entry.negativeCount > 0 ? " · " : null}
                    {entry.negativeCount > 0 ? `${entry.negativeCount}× negativ` : null}
                  </span>
                  <span
                    className="impact-tone"
                    style={{ color: impactToneStyles[entry.tone].color }}
                  >
                    {impactToneStyles[entry.tone].label}
                  </span>
                </div>
              ))}
              <p className="muted small impact-footnote">
                Regelbasierte Zuordnung aus Events der letzten {impactWindowHours}h · keine
                Handlungsempfehlung
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── 4 · Radar ── */}
      <RadarColumns
        marketMoves={marketMoves}
        patterns={patternEvents}
        globalEvents={eventsLast48h.slice(0, 5)}
        clusterChips={clusterChips}
        now={renderedAt}
      />

      {/* ── 5 · Signale, Aktivität, System ── */}
      <div className="bottom-columns">
        <SectionCard
          title="Signal-Highlights"
          action={
            <Link href="/dashboard/signals" className="section-link">
              Alle →
            </Link>
          }
        >
          {highPrioritySignals.length === 0 ? (
            <EmptyState title="Keine aktiven Signals mit hoher Priorität." />
          ) : (
            <div className="signal-cards-list">
              {highPrioritySignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>
            Watchlist: {watchlistItems.length} Assets · {highPriorityWatchlist.length} mit hoher
            Priorität ·{" "}
            <Link href="/dashboard/watchlist" className="section-link">
              verwalten →
            </Link>
          </p>
        </SectionCard>

        <SectionCard
          title="Aktivität"
          action={
            <Link href="/dashboard/logs" className="section-link">
              Logs →
            </Link>
          }
        >
          {recentActivities.length === 0 ? (
            <EmptyState title="Noch keine Aktivität vorhanden." />
          ) : (
            <div className="health-rows">
              {recentActivities.map((item) => (
                <div key={item.id} className="health-row">
                  <span
                    className="health-row-value activity-title"
                    style={{ color: item.tone, textAlign: "left" }}
                  >
                    {item.title}
                  </span>
                  <span className="muted small" title={formatDateTime(item.time)}>
                    {formatRelativeTime(item.time, renderedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SystemPanel
          healthOk={health.data?.status === "ok"}
          workerRows={workerRows}
          failedAlertCount={failedAlerts}
          lastAlertSummary={
            latestAlert
              ? `Letzter: ${getAlertSummary(latestAlert)} · ${formatRelativeTime(latestAlert.sentAt ?? latestAlert.createdAt, renderedAt)}`
              : null
          }
          now={renderedAt}
        />
      </div>

      <p className="research-footnote">
        SignalPilot beobachtet Märkte und Ereignisse zu Research-Zwecken. Alle Einstufungen sind
        automatische Vorbewertungen — keine Handlungsempfehlung, keine Anlageberatung.
      </p>
    </>
  );
}
