import Link from "next/link";

import { EmptyState, ErrorState } from "../../components/empty-state";
import { PageHeader, SectionCard } from "../../components/ui";
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
  regimeSentence,
  severityRank,
  withinHours
} from "../../components/dashboard/shared";
import { formatDateTime } from "../../lib/format";
import {
  fetchApi,
  type Alert,
  type BotRun,
  type MarketEvent,
  type MarketRegimeSnapshot,
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

// Baut den menschlichen Puls-Satz des Lagebilds aus den echten Zahlen —
// funktioniert auch ohne Regime-Snapshot.
function buildPulse({
  criticalCount,
  notableCount,
  radarCount,
  topCluster,
  topRegion,
  regime
}: {
  criticalCount: number;
  notableCount: number;
  radarCount: number;
  topCluster: string | null;
  topRegion: string | null;
  regime: MarketRegimeSnapshot | null | undefined;
}): { pulse: string; context: string | null } {
  let pulse: string;
  if (criticalCount > 0) {
    pulse =
      criticalCount === 1
        ? "Erhöhte Aufmerksamkeit: 1 sehr wichtiges Ereignis in den letzten 48 Stunden."
        : `Erhöhte Aufmerksamkeit: ${criticalCount} sehr wichtige Ereignisse in den letzten 48 Stunden.`;
  } else if (notableCount > 0) {
    pulse =
      notableCount === 1
        ? "Eine wichtige Entwicklung im Blick — kein akuter Alarm."
        : `${notableCount} wichtige Entwicklungen im Blick — kein akuter Alarm.`;
  } else {
    pulse = "Ruhige Lage — aktuell nichts Dringendes.";
  }

  const parts: string[] = [];
  if (topCluster) {
    parts.push(
      topRegion
        ? `Die meisten Meldungen drehen sich um ${topCluster} — häufigste Region: ${topRegion}.`
        : `Die meisten Meldungen drehen sich um ${topCluster}.`
    );
  }
  parts.push(
    radarCount > 0
      ? radarCount === 1
        ? "Das Markt-Radar meldet eine Beobachtung."
        : `Das Markt-Radar meldet ${radarCount} Beobachtungen.`
      : "Das Markt-Radar ist ruhig."
  );
  const regimePart = regimeSentence(regime?.overallRegime);
  if (regimePart) parts.push(regimePart);

  return { pulse, context: parts.length > 0 ? parts.join(" ") : null };
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
    marketRegime
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
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest")
  ]);

  const renderedAt = new Date();
  const signalList = signals.data ?? [];
  const alertList = alerts.data ?? [];
  const radarEventList = radarEvents.data ?? [];
  const marketEventList = marketEvents.data ?? [];
  const watchlistItems = watchlist.data ?? [];
  const regime = marketRegime.data;
  const scannerSummary = scanner.data?.summary;

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
    regime
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
  const importantTotal = criticalCount + notableCount;
  const activeSignals =
    (scannerSummary?.strongWatchCount ?? 0) + (scannerSummary?.watchCount ?? 0);

  const heroMetrics: HeroMetric[] = [
    {
      label: "Wichtige Entwicklungen",
      value: importantTotal,
      sub:
        criticalCount > 0
          ? `davon ${criticalCount} sehr wichtig`
          : importantTotal > 0
            ? "keine davon kritisch"
            : "ruhige Lage",
      href: "#wichtig-jetzt",
      tone: criticalCount > 0 ? "var(--sev-critical)" : undefined
    },
    {
      label: "Radar-Beobachtungen",
      value: radarLast24h.length,
      sub: "Bewegungen & Chartbilder · 24 Std.",
      href: "/dashboard/scanner"
    },
    {
      label: "Aktive Signale",
      value: activeSignals,
      sub: `${scannerSummary?.strongWatchCount ?? 0} mit starker Beobachtung`,
      href: "/dashboard/signals"
    },
    {
      label: "Benachrichtigungen heute",
      value: scannerSummary?.alertsSentToday ?? 0,
      sub: failedAlerts > 0 ? `${failedAlerts} fehlgeschlagen` : "alle zugestellt",
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
            title="Daten konnten nicht geladen werden"
            message={criticalErrors.map((result) => result.error).join(" | ")}
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
      <PriorityFeed items={priorityItems} now={renderedAt} />

      {/* ── 4 · Wo passiert es & was ist betroffen? ── */}
      <div className="cmd-grid-2 context-grid-overview">
        <SectionCard
          title="Wo gerade etwas passiert"
          subtitle="Herkunftsregionen der erkannten Ereignisse — letzte 48 Stunden."
        >
          {clusterChips.length > 0 ? (
            <div className="cluster-chips">
              {clusterChips.map((chip) => (
                <span key={chip.label} className="cluster-chip">
                  {chip.label} <strong>{chip.count}</strong>
                </span>
              ))}
            </div>
          ) : null}
          {eventsLast48h.length === 0 ? (
            <EmptyState
              title="Keine globalen Ereignisse in den letzten 48 Stunden."
              description="Die Karte füllt sich, sobald der Ereignis-Monitor neue Meldungen erkennt und einordnet."
            />
          ) : (
            <NewsWorldMap events={eventsLast48h} now={renderedAt} />
          )}
        </SectionCard>

        <SectionCard
          title="Was betroffen sein könnte"
          subtitle="Bereiche, die in den aktuellen Meldungen als möglicher Rücken- oder Gegenwind auftauchen."
        >
          {impactMap.length === 0 ? (
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

      {/* ── 5 · Radar & Signale kompakt ── */}
      <div className="overview-lower-grid">
        <RadarOverviewCard events={radarCompact} now={renderedAt} />
        <SignalsCompactCard
          alerts={alertList}
          signals={topSignals}
          watchlistCount={watchlistItems.length}
          watchlistHighPriority={highPriorityWatchlist}
        />
      </div>

      <p className="research-footnote">
        SignalPilot beobachtet Märkte und Ereignisse zu Research-Zwecken. Alle Einstufungen sind
        automatische Vorbewertungen — keine Handlungsempfehlung, keine Anlageberatung.
      </p>
    </>
  );
}
