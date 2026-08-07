import Link from "next/link";

import { DataFreshness } from "../../components/data-freshness";
import { EmptyState, ErrorState } from "../../components/empty-state";
import { RetryButton } from "../../components/retry-button";
import { PageHeader, SectionCard } from "../../components/ui";
import { describeApiError } from "../../lib/api-error";
import {
  describeStatus,
  isErrorStatus,
  metricValue,
  formatMetric,
  resolveDataStatus,
  statusOfList,
  type DataStatus
} from "../../lib/data-status";
import { discoveryEmptyCopy, resolveDiscoveryStatus } from "../../lib/discovery-status";
import { HeroBand, type HeroMetric } from "../../components/dashboard/hero-band";
import { PriorityFeed, type PriorityItem } from "../../components/dashboard/priority-feed";
import { RadarOverviewCard, SignalsCompactCard } from "../../components/dashboard/radar-compact";
import { StatusLine, type StatusTone } from "../../components/dashboard/status-line";
import { NewsWorldMap } from "../../components/dashboard/news-world-map";
import {
  chartPatternEventTypes,
  marketEventTypeLabels,
  radarEventExplanation,
  radarEventTypeLabel,
  severityRank,
  withinHours
} from "../../components/dashboard/shared";
import { formatDateTime, lastPeriodPhrase, pluralize } from "../../lib/format";
import { buildPulse } from "../../lib/overview-pulse";
import {
  fetchApi,
  type Alert,
  type AssetDiscoveryOverview,
  type BotRun,
  type MarketEvent,
  type MarketRegimeSnapshot,
  type NewsItem,
  type PublicConfig,
  type RadarEvent,
  type ScannerResponse,
  type SignalListItem,
  type WatchlistItem
} from "../../lib/signalpilot-api";

// Übersicht v3 — eine Seite, die sich wie eine kurze Lagebesprechung liest:
// 1. Läuft alles? (Statuszeile)   2. Wie ist die Lage? (Lagebild)
// 3. Was ist wichtig — und was könnte es bedeuten? (Wichtig jetzt)
// 4. Wo passiert es & was ist betroffen? (Karte + Impact)
// 5. Radar & Signale kompakt. Alles Weitere liegt auf den Unterseiten.

const impactWindowHours = 48;

const severityWeights: Record<MarketEvent["severity"], number> = {
  CRITICAL: 3,
  IMPORTANT: 2,
  WATCH: 1,
  INFO: 0.5
};

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

const impactToneMeta: Record<
  ImpactMapEntry["tone"],
  { label: string; arrow: string; arrowClass: string; color: string }
> = {
  chance: {
    label: "eher Rückenwind",
    arrow: "↗",
    arrowClass: "impact-entry-arrow--pos",
    color: "var(--good)"
  },
  risiko: {
    label: "eher Gegenwind",
    arrow: "↘",
    arrowClass: "impact-entry-arrow--neg",
    color: "var(--bad)"
  },
  gemischt: {
    label: "widersprüchliche Signale",
    arrow: "↕",
    arrowClass: "impact-entry-arrow--mixed",
    color: "var(--mixed)"
  }
};

const riskClusters: Array<{ label: string; types: Array<MarketEvent["eventType"]> }> = [
  { label: "Konjunktur & Zinsen", types: ["CENTRAL_BANK", "RATES", "INFLATION", "LABOR_MARKET", "MACRO"] },
  { label: "Geopolitik", types: ["GEOPOLITICAL", "SANCTIONS", "CONFLICT"] },
  { label: "Energie & Rohstoffe", types: ["ENERGY_COMMODITY", "SUPPLY_CHAIN"] },
  { label: "Unternehmen & Stimmung", types: ["RISK_SENTIMENT", "CORPORATE", "OTHER"] }
];

const assetTypeLabels: Record<string, string> = {
  CRYPTO: "Krypto",
  STOCK: "Aktie",
  ETF: "ETF"
};

// Finnhub-Summaries sind oft nur der Titel in anderer Zeichensetzung —
// dann lieber gar keine Notiz zeigen. (Das technische reasoning-Feld des
// Klassifikators gehört bewusst nicht auf die Übersicht.)
function usefulSummary(summary: string | null, title: string): string | null {
  if (!summary) return null;
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return normalize(summary) === normalize(title) ? null : summary;
}

function countBy<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.reduce((total, item) => (predicate(item) ? total + 1 : total), 0);
}


export default async function DashboardPage() {
  const [
    health,
    config,
    signals,
    alerts,
    radarEvents,
    marketEvents,
    cryptoPipeline,
    quickRadarRun,
    equityPipeline,
    eventMonitorRun,
    equityRadarRun,
    scanner,
    watchlist,
    marketRegime,
    relevantNews,
    discovery
  ] = await Promise.all([
    fetchApi<{ status: string }>("/health"),
    fetchApi<PublicConfig>("/config/public"),
    fetchApi<SignalListItem[]>("/signals?limit=100"),
    fetchApi<Alert[]>("/alerts?limit=30"),
    fetchApi<RadarEvent[]>("/radar/events?limit=40"),
    fetchApi<MarketEvent[]>("/market-events?limit=50"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runCryptoSignalPipeline&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=quickCryptoRadar&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=runEquitySignalPipeline&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=globalEventMonitor&limit=1"),
    fetchApi<BotRun[]>("/bot-runs?jobName=quickEquityRadar&limit=1"),
    fetchApi<ScannerResponse>("/scanner"),
    fetchApi<WatchlistItem[]>("/watchlist?limit=200"),
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest"),
    fetchApi<NewsItem[]>("/news?minRelevance=30&maxAgeHours=72&limit=5"),
    fetchApi<AssetDiscoveryOverview>("/discovery/overview?limit=20")
  ]);

  const renderedAt = new Date();
  const signalList = signals.data ?? [];
  const alertList = alerts.data ?? [];
  const radarEventList = radarEvents.data ?? [];
  const marketEventList = marketEvents.data ?? [];
  const watchlistItems = watchlist.data ?? [];
  const regime = marketRegime.data;
  const relevantNewsItems = relevantNews.data ?? [];
  const discoveryData = discovery.data;
  const scannerSummary = scanner.data?.summary;

  // ── Datenzustand je Quelle ──
  // Jede Sektion kennt ihren eigenen Zustand. Ein Fehler in einer Quelle darf
  // weder die Nachbarsektion stumm schalten noch als "es gibt nichts" erscheinen.
  const newest = (values: Array<string | undefined>): string | null =>
    values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  const newestEventAt = newest(marketEventList.map((event) => event.detectedAt));
  const newestRadarAt = newest(radarEventList.map((event) => event.createdAt));
  const newestSignalAt = newest(signalList.map((signal) => signal.createdAt));

  const eventsStatus = statusOfList(marketEvents, {
    newestAt: newestEventAt,
    staleAfterHours: impactWindowHours,
    now: renderedAt
  });
  const radarStatus = statusOfList(radarEvents, {
    newestAt: newestRadarAt,
    staleAfterHours: 24,
    now: renderedAt
  });
  const signalsStatus = statusOfList(signals, {
    newestAt: newestSignalAt,
    staleAfterHours: 24,
    now: renderedAt
  });
  const watchlistStatus = statusOfList(watchlist, { now: renderedAt });
  const alertsStatus = statusOfList(alerts, { now: renderedAt });
  // Der Scanner liefert ein Objekt, keine Liste — "leer" gibt es dort nicht.
  const scannerStatus: DataStatus = resolveDataStatus({
    error: scanner.error,
    errorKind: scanner.errorKind,
    isEmpty: false,
    now: renderedAt
  });

  // ── Abgeleitete Sichten ──
  const radarLast24h = radarEventList.filter((event) =>
    withinHours(event.createdAt, 24, renderedAt)
  );
  const eventsLast48h = marketEventList.filter((event) =>
    withinHours(event.detectedAt, impactWindowHours, renderedAt)
  );
  const impactMap = buildImpactMap(marketEventList, renderedAt);

  const clusterChips = riskClusters
    .map((cluster) => ({
      label: cluster.label,
      types: cluster.types,
      count: countBy(eventsLast48h, (event) => cluster.types.includes(event.eventType))
    }))
    .filter((chip) => chip.count > 0)
    .sort((left, right) => right.count - left.count);

  const regionCounts = new Map<string, number>();
  for (const event of eventsLast48h) {
    if (event.region) regionCounts.set(event.region, (regionCounts.get(event.region) ?? 0) + 1);
  }
  const topRegion =
    [...regionCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  const criticalCount =
    countBy(eventsLast48h, (event) => event.severity === "CRITICAL") +
    countBy(radarLast24h, (event) => event.severity === "CRITICAL");
  const notableCount =
    countBy(eventsLast48h, (event) => event.severity === "IMPORTANT") +
    countBy(radarLast24h, (event) => event.severity === "IMPORTANT");

  const { pulse, context } = buildPulse({
    criticalCount,
    notableCount,
    radarCount: radarLast24h.length,
    topCluster: clusterChips[0]?.label ?? null,
    topRegion,
    regime,
    eventsStatus,
    radarStatus
  });

  // ── Wichtig jetzt: Ereignisse + Radar gemischt, nur ab "Im Blick" ──
  const priorityItems: PriorityItem[] = [
    ...eventsLast48h
      .filter((event) => severityRank(event.severity) >= 2)
      .map(
        (event): PriorityItem => ({
          id: `event-${event.id}`,
          kind: "event",
          severity: event.severity,
          title: event.title,
          note: usefulSummary(event.summary, event.title),
          impactPos: event.positiveImpact ?? [],
          impactNeg: event.negativeImpact ?? [],
          showOpenImpact: true,
          meta: [
            marketEventTypeLabels[event.eventType] ?? event.eventType,
            event.region,
            `Quelle: ${event.source}`
          ]
            .filter(Boolean)
            .join(" · "),
          time: event.detectedAt,
          externalUrl: event.sourceUrl
        })
      ),
    ...radarLast24h
      .filter((event) => severityRank(event.severity) >= 2)
      .map(
        (event): PriorityItem => ({
          id: `radar-${event.id}`,
          kind: chartPatternEventTypes.includes(event.eventType) ? "chart" : "radar",
          severity: event.severity,
          title: `${event.symbol}: ${radarEventTypeLabel(event.eventType)}`,
          note: radarEventExplanation(event.eventType),
          meta: [assetTypeLabels[event.assetType] ?? event.assetType, `Zeitebene ${event.timeframe}`]
            .filter(Boolean)
            .join(" · "),
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
    .slice(0, 5);

  // ── Systemstatus als eine Zeile ──
  const apiOk = health.data?.status === "ok";
  const failedAlerts = countBy(alertList, (alert) => alert.status === "FAILED");
  const jobChecks: Array<{ label: string; run: BotRun | null }> = [
    { label: "Krypto-Analyse", run: cryptoPipeline.data?.[0] ?? null },
    { label: "Markt-Radar", run: quickRadarRun.data?.[0] ?? null },
    { label: "Aktien-Analyse", run: equityPipeline.data?.[0] ?? null },
    { label: "Ereignis-Monitor", run: eventMonitorRun.data?.[0] ?? null },
    { label: "Aktien-Radar", run: equityRadarRun.data?.[0] ?? null }
  ];

  const systemIssues: string[] = [];
  if (!apiOk) {
    systemIssues.push("Die Datenverbindung zur API ist gestört — Anzeigen können veraltet sein.");
  }
  for (const check of jobChecks) {
    if (check.run?.status === "FAILED") {
      systemIssues.push(`Der Hintergrund-Job „${check.label}“ ist zuletzt fehlgeschlagen.`);
    }
  }
  if (failedAlerts > 0) {
    systemIssues.push(
      failedAlerts === 1
        ? "1 Benachrichtigung konnte nicht zugestellt werden."
        : `${failedAlerts} Benachrichtigungen konnten nicht zugestellt werden.`
    );
  }

  const statusTone: StatusTone = !apiOk ? "error" : systemIssues.length > 0 ? "warn" : "ok";
  const statusHeadline = !apiOk
    ? "Verbindungsproblem"
    : systemIssues.length > 0
      ? systemIssues.length === 1
        ? "Ein Hinweis zum System"
        : `${systemIssues.length} Hinweise zum System`
      : "Alle Systeme laufen";

  // ── Lagebild-Kennzahlen ──
  // `metricValue` liefert bei einem gescheiterten Abruf `null`; `formatMetric`
  // macht daraus "—". Eine "0" wäre hier eine Behauptung, die niemand geprüft hat.
  const importantMetric = metricValue(
    isErrorStatus(eventsStatus) ? eventsStatus : radarStatus,
    criticalCount + notableCount
  );
  const radarMetric = metricValue(radarStatus, radarLast24h.length);
  const activeSignalsMetric = metricValue(
    scannerStatus,
    (scannerSummary?.strongWatchCount ?? 0) + (scannerSummary?.watchCount ?? 0)
  );
  const alertsMetric = metricValue(scannerStatus, scannerSummary?.alertsSentToday ?? 0);

  const unavailableSub = "Abruf fehlgeschlagen";

  const heroMetrics: HeroMetric[] = [
    {
      label: "Wichtige Entwicklungen",
      value: formatMetric(importantMetric),
      sub:
        importantMetric == null
          ? unavailableSub
          : criticalCount > 0
            ? `davon ${criticalCount} sehr wichtig`
            : importantMetric > 0
              ? "keine davon kritisch"
              : eventsStatus === "empty" && radarStatus === "empty"
                ? "ruhige Lage"
                : "nichts über der Schwelle",
      href: "#wichtig-jetzt",
      tone: criticalCount > 0 ? "var(--sev-critical)" : undefined
    },
    {
      label: "Radar-Beobachtungen",
      value: formatMetric(radarMetric),
      sub: radarMetric == null ? unavailableSub : "Bewegungen & Chartbilder · 24 Std.",
      href: "/dashboard/scanner"
    },
    {
      label: "Aktive Signale",
      value: formatMetric(activeSignalsMetric),
      sub:
        activeSignalsMetric == null
          ? unavailableSub
          : `${scannerSummary?.strongWatchCount ?? 0} mit starker Beobachtung`,
      href: "/dashboard/signals"
    },
    {
      label: "Benachrichtigungen heute",
      value: formatMetric(alertsMetric),
      sub:
        alertsMetric == null
          ? unavailableSub
          : failedAlerts > 0
            ? `${failedAlerts} fehlgeschlagen`
            : "alle zugestellt",
      href: "/dashboard/logs",
      tone: failedAlerts > 0 ? "var(--bad)" : undefined
    }
  ];

  // ── Radar & Signale kompakt ──
  const radarCompact = [...radarLast24h]
    .sort(
      (left, right) =>
        severityRank(right.severity) - severityRank(left.severity) ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );

  const topSignals = signalList
    .filter((signal) => signal.status === "STRONG_WATCH" || signal.status === "WATCH")
    .slice(0, 4);
  const highPriorityWatchlist = countBy(watchlistItems, (item) => item.priority === "HIGH");

  const criticalErrors = [health, config, scanner].filter((result) => result.error);
  const criticalErrorCopy = describeApiError(
    criticalErrors[0]?.errorKind,
    criticalErrors.map((result) => result.error).join(" | "),
    "Kernbereiche der Übersicht"
  );

  const discoveryToday = (discoveryData?.candidates ?? [])
    .filter(
      (candidate) =>
        withinHours(candidate.createdAt, 24, renderedAt) &&
        (candidate.proposedAction === "ADD" ||
          candidate.previousScore === null ||
          (candidate.scoreDelta ?? 0) >= 5)
    )
    .slice(0, 4);

  // Getrennte Aussagen, die vorher alle als "sicher deaktiviert" erschienen sind:
  // Aufruf fehlgeschlagen · Feature deaktiviert · aktiviert, aber noch kein Lauf.
  const discoveryErrorCopy = describeApiError(
    discovery.errorKind,
    discovery.error ?? "",
    "Die Discovery-Daten"
  );
  const discoveryStatus = resolveDiscoveryStatus({
    errorKind: discovery.errorKind,
    hasError: Boolean(discovery.error),
    enabled: discoveryData?.config.enabled,
    hasRun: discoveryData?.latestRun != null,
    candidateCountToday: discoveryToday.length
  });
  const discoveryEmpty = discoveryEmptyCopy(discoveryStatus);
  const newsErrorCopy = describeApiError(
    relevantNews.errorKind,
    relevantNews.error ?? "",
    "Die Nachrichten"
  );
  const eventsErrorCopy = describeStatus(
    eventsStatus,
    marketEvents.error ?? "",
    "Die globalen Ereignisse"
  );

  return (
    <>
      <PageHeader
        eyebrow="SignalPilot Lagezentrum"
        title="Command Center"
        subtitle={`Was jetzt zählt — Märkte, Weltgeschehen und Systemlage · Aktualisiert ${formatDateTime(renderedAt.toISOString())}`}
        actions={
          <>
            <Link className="primary-link" href="/dashboard/scanner">
              Markt-Radar öffnen
            </Link>
            <Link className="primary-link secondary-link" href="/dashboard/watchlist">
              Meine Watchlist
            </Link>
          </>
        }
      />

      {criticalErrors.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title={criticalErrorCopy.title}
            message={criticalErrorCopy.message}
            hint={criticalErrorCopy.hint}
            action={criticalErrorCopy.retryable ? <RetryButton /> : null}
          />
        </div>
      ) : null}

      {/* ── 1 · Läuft alles? ── */}
      <StatusLine
        tone={statusTone}
        headline={statusHeadline}
        meta={statusTone === "ok" ? "Worker, Datenverbindung und Zustellung geprüft" : undefined}
        issues={systemIssues}
        workers={jobChecks.map((check) => ({
          label: check.label,
          status: check.run?.status ?? null
        }))}
      />

      {/* ── 2 · Wie ist die Lage? ── */}
      <HeroBand pulse={pulse} context={context} regime={regime} metrics={heroMetrics} />

      {/* ── 3 · Was ist wichtig — und was könnte es bedeuten? ── */}
      <PriorityFeed
        items={priorityItems}
        now={renderedAt}
        status={isErrorStatus(eventsStatus) ? eventsStatus : radarStatus}
        errorMessage={marketEvents.error ?? radarEvents.error ?? ""}
      />

      <SectionCard
        title="Heute neu im Blick"
        subtitle="Frühe Discovery-Beobachtungen; noch keine Kauf- oder Verkaufsempfehlungen."
        action={
          <Link className="text-link" href="/dashboard/discovery">
            Markt entdecken →
          </Link>
        }
      >
        {discoveryStatus === "error" ? (
          // Ein fehlgeschlagener Aufruf darf nie als "deaktiviert" oder "nichts vorhanden"
          // erscheinen — das wäre eine falsche Tatsachenbehauptung über den Systemzustand.
          <ErrorState
            title={discoveryErrorCopy.title}
            message={discoveryErrorCopy.message}
            hint={discoveryErrorCopy.hint}
            action={discoveryErrorCopy.retryable ? <RetryButton /> : null}
          />
        ) : discoveryToday.length > 0 ? (
          <div className="discovery-overview-list">
            {discoveryToday.map((candidate) => (
              <Link
                key={candidate.id}
                href={`/dashboard/assets/${encodeURIComponent(candidate.symbol)}`}
                className="discovery-overview-item"
              >
                <span>
                  <strong>{candidate.symbol}</strong>
                  <small>
                    {candidate.reasons[0]?.replaceAll("_", " ") ?? "Neuer Kandidat"} ·{" "}
                    {candidate.isActive ? "vollständig analysiert" : "frühe Beobachtung"}
                  </small>
                </span>
                <span className="score-badge score-badge-medium">
                  <span className="score-badge-value">{candidate.score.toFixed(0)}</span>
                  <span className="score-badge-label">Discovery</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title={discoveryEmpty.title} description={discoveryEmpty.description} />
        )}
      </SectionCard>

      {/* ── 4 · Wo passiert es & was ist betroffen? ── */}
      <div className="cmd-grid-2 context-grid-overview">
        <SectionCard
          title="Wo gerade etwas passiert"
          subtitle="Herkunftsregionen der erkannten Ereignisse — letzte 48 Stunden."
          action={
            <Link className="section-link" href="/dashboard/news">
              Weltlage öffnen
            </Link>
          }
        >
          {/* Die Kategorie-Chips waren reine Anzeige; sie filtern jetzt die
              Weltlage-Seite vor. */}
          {clusterChips.length > 0 ? (
            <div className="cluster-chips">
              {clusterChips.map((chip) => (
                <Link
                  key={chip.label}
                  className="cluster-chip"
                  href={`/dashboard/news?range=48&eventType=${encodeURIComponent(chip.types[0])}`}
                >
                  {chip.label} <strong>{chip.count}</strong>
                </Link>
              ))}
            </div>
          ) : null}
          {isErrorStatus(eventsStatus) && eventsErrorCopy ? (
            // Vorher stand hier "Keine globalen Ereignisse in den letzten 48 Stunden."
            // — auch dann, wenn schlicht niemand nachgesehen hatte.
            <ErrorState
              title={eventsErrorCopy.title}
              message={eventsErrorCopy.message}
              hint={eventsErrorCopy.hint}
              action={eventsErrorCopy.retryable ? <RetryButton /> : null}
            />
          ) : eventsLast48h.length === 0 ? (
            <EmptyState
              title={`Keine globalen Ereignisse ${lastPeriodPhrase(impactWindowHours)}.`}
              description="Die Karte füllt sich, sobald der Ereignis-Monitor neue Meldungen erkennt und einordnet."
            />
          ) : (
            <NewsWorldMap events={eventsLast48h} now={renderedAt} />
          )}
          <DataFreshness
            label="Weltgeschehen"
            newestAt={newestEventAt}
            status={eventsStatus}
            now={renderedAt}
            staleHint={`Die jüngste Meldung liegt länger als ${impactWindowHours} Stunden zurück.`}
          />
        </SectionCard>

        <SectionCard
          title="Was betroffen sein könnte"
          subtitle="Bereiche, die in den aktuellen Meldungen als möglicher Rücken- oder Gegenwind auftauchen."
        >
          {isErrorStatus(eventsStatus) && eventsErrorCopy ? (
            <ErrorState
              title={eventsErrorCopy.title}
              message={eventsErrorCopy.message}
              hint={eventsErrorCopy.hint}
              action={eventsErrorCopy.retryable ? <RetryButton /> : null}
            />
          ) : impactMap.length === 0 ? (
            <EmptyState
              title="Noch keine Zuordnungen im Zeitfenster."
              description="Sie entstehen automatisch, wenn erkannte Ereignisse per Regelwerk auf Anlagebereiche wirken könnten."
            />
          ) : (
            <div className="impact-board">
              {impactMap.map((entry) => {
                const meta = impactToneMeta[entry.tone];
                const mentions: string[] = [];
                if (entry.positiveCount > 0) mentions.push(`${entry.positiveCount}× positiv erwähnt`);
                if (entry.negativeCount > 0) mentions.push(`${entry.negativeCount}× negativ erwähnt`);

                return (
                  <div key={entry.area} className="impact-entry">
                    <span className={`impact-entry-arrow ${meta.arrowClass}`} aria-hidden="true">
                      {meta.arrow}
                    </span>
                    <div className="impact-entry-body">
                      <span className="impact-entry-name">{entry.area}</span>
                      <span className="impact-entry-note">{mentions.join(" · ")}</span>
                    </div>
                    <span className="impact-entry-tone" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                );
              })}
              <p className="impact-footnote">
                Regelbasiert aus den Ereignissen der letzten {impactWindowHours} Stunden abgeleitet
                — ein Ausgangspunkt für eigene Recherche, keine Handlungsempfehlung.
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── 5 · Relevante Nachrichten ── */}
      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Relevante Nachrichten"
          subtitle="Aktuelle, automatisch bewertete Meldungen — keine Sofortmeldungen per Telegram."
          action={
            <Link className="section-link" href="/dashboard/news">
              Alle Nachrichten
            </Link>
          }
        >
          {relevantNews.error ? (
            <ErrorState
              title={newsErrorCopy.title}
              message={newsErrorCopy.message}
              hint={newsErrorCopy.hint}
              action={newsErrorCopy.retryable ? <RetryButton /> : null}
            />
          ) : relevantNewsItems.length === 0 ? (
            <EmptyState
              title="Keine ausreichend relevante aktuelle Meldung."
              description="Rohmeldungen und ältere Nachrichten bleiben auf der Nachrichtenseite einsehbar."
            />
          ) : (
            <div className="news-feed">
              {relevantNewsItems.slice(0, 4).map((item) => {
                const ageHours =
                  (renderedAt.getTime() - new Date(item.publishedAt).getTime()) /
                  (60 * 60 * 1000);
                return (
                  <article className="news-card" key={item.id}>
                    <div className="news-card-meta">
                      <span className="symbol-chip">
                        {(item.relatedSymbols.length > 0
                          ? item.relatedSymbols
                          : [item.symbol]
                        ).join(", ")}
                      </span>
                      <span>Quelle: {item.source}</span>
                      <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt)}</time>
                      {ageHours > 24 ? <span style={{ color: "var(--warn)" }}>älter als 24 h</span> : null}
                    </div>
                    <h2>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          {item.headline} <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        item.headline
                      )}
                    </h2>
                    <div className="news-card-footer">
                      <span className="soft-chip">Relevanz {item.relevanceScore ?? 0}/100</span>
                      <span className="soft-chip">via {item.transportProvider}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── 6 · Radar & Signale kompakt ── */}
      <div className="overview-lower-grid">
        <RadarOverviewCard
          events={radarCompact}
          now={renderedAt}
          status={radarStatus}
          errorMessage={radarEvents.error ?? ""}
        />
        <SignalsCompactCard
          alerts={alertList}
          signals={topSignals}
          watchlistCount={watchlistItems.length}
          watchlistHighPriority={highPriorityWatchlist}
          signalsStatus={signalsStatus}
          alertsStatus={alertsStatus}
          watchlistStatus={watchlistStatus}
          errorMessage={signals.error ?? ""}
        />
      </div>

      <DataFreshness
        label="Signale"
        newestAt={newestSignalAt}
        status={signalsStatus}
        now={renderedAt}
        staleHint={`Die jüngste Beobachtung ist älter als 24 Stunden — ${pluralize(
          signalList.length,
          "gespeichertes Signal",
          "gespeicherte Signale"
        )} insgesamt.`}
      />

      <p className="research-footnote">
        SignalPilot beobachtet Märkte und Ereignisse zu Research-Zwecken. Alle Einstufungen sind
        automatische Vorbewertungen — keine Handlungsempfehlung, keine Anlageberatung.
      </p>
    </>
  );
}
