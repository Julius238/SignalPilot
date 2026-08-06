import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import {
  WorldMapExplorer,
  type MapMarker
} from "../../../components/dashboard/world-map-explorer";
import { marketEventTypeLabels } from "../../../components/dashboard/shared";
import {
  PageHeader,
  PageIntro,
  SectionCard,
  TechnicalDetails,
  type PageVerdictTone
} from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime } from "../../../lib/format";
import {
  SEVERITY_TIER_META,
  UNASSIGNED_REGION_KEY,
  UNASSIGNED_REGION_LABEL,
  severityTier,
  type SeverityTier
} from "../../../lib/market-event-detail";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  countryPaths,
  knownRegions,
  projectRegion,
  spherePath
} from "../../../lib/world-map-geo";
import {
  buildQuery,
  fetchApi,
  type MarketEvent,
  type NewsItem
} from "../../../lib/signalpilot-api";

type NewsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const TIME_RANGES = [
  { value: "24", label: "24 Stunden" },
  { value: "48", label: "48 Stunden" },
  { value: "168", label: "7 Tage" },
  { value: "720", label: "30 Tage" }
] as const;

const DEFAULT_RANGE = "168";

const SEVERITY_OPTIONS: Array<{ value: "" | SeverityTier; label: string }> = [
  { value: "", label: "Alle Wichtigkeiten" },
  { value: "critical", label: "Nur kritisch" },
  { value: "important", label: "Ab wichtig" },
  { value: "info", label: "Nur informativ" }
];

function isSeverityTier(value: string | undefined): value is SeverityTier {
  return value === "critical" || value === "important" || value === "info";
}

// Der server-gerenderte Kartenhintergrund. Er wandert als `children` in die
// Client-Komponente, damit die ~180 Länderpfade nicht als Props serialisiert werden.
function MapBase() {
  return (
    <g aria-hidden="true">
      <path d={spherePath} className="world-map-sphere" />
      {countryPaths.map((d, index) => (
        <path key={index} d={d} className="world-map-country" />
      ))}
    </g>
  );
}

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const params = await searchParams;

  const range = TIME_RANGES.some((option) => option.value === params.range)
    ? (params.range as string)
    : DEFAULT_RANGE;
  const severityFilter = isSeverityTier(params.severity) ? params.severity : "";
  const categoryFilter = params.eventType ?? "";
  const regionFilter = params.region ?? "";

  const [eventResult, newsResult] = await Promise.all([
    fetchApi<MarketEvent[]>(
      `/market-events${buildQuery({
        maxAgeHours: range,
        eventType: categoryFilter || undefined,
        region: regionFilter || undefined,
        limit: 200
      })}`
    ),
    fetchApi<NewsItem[]>(`/news${buildQuery({ maxAgeHours: range, limit: 60 })}`)
  ]);

  const allEvents = eventResult.data ?? [];
  // Die Wichtigkeitsstufe fasst WATCH und INFO zusammen; das lässt sich nicht auf
  // den einwertigen `severity`-Parameter der API abbilden und passiert deshalb hier.
  const events = severityFilter
    ? allEvents.filter((event) => severityTier(event.severity) === severityFilter)
    : allEvents;

  const renderedAt = new Date();
  const hasFilter = Boolean(
    severityFilter || categoryFilter || regionFilter || range !== DEFAULT_RANGE
  );

  // Marker nur für Regionen, die im aktuellen Ergebnis vorkommen — plus die Gruppe
  // ohne Zuordnung, die sonst unsichtbar bliebe.
  const presentRegions = new Set(events.map((event) => event.region ?? UNASSIGNED_REGION_KEY));
  const markers: MapMarker[] = [...knownRegions(), UNASSIGNED_REGION_KEY]
    .filter((regionKey) => presentRegions.has(regionKey))
    .map((regionKey) => ({
      regionKey,
      label: regionKey === UNASSIGNED_REGION_KEY ? UNASSIGNED_REGION_LABEL : regionKey,
      ...projectRegion(regionKey)
    }));

  const criticalCount = events.filter((event) => severityTier(event.severity) === "critical").length;
  const importantCount = events.filter(
    (event) => severityTier(event.severity) === "important"
  ).length;
  const withoutRegion = events.filter((event) => event.region === null).length;
  const rangeLabel =
    TIME_RANGES.find((option) => option.value === range)?.label ?? "gewählter Zeitraum";

  const errorCopy = describeApiError(
    eventResult.errorKind,
    eventResult.error ?? "",
    "Die Weltlage-Daten"
  );

  const tone: PageVerdictTone = eventResult.error
    ? "bad"
    : criticalCount > 0
      ? "bad"
      : importantCount > 0
        ? "warn"
        : events.length === 0
          ? "neutral"
          : "good";
  const verdict = eventResult.error
    ? "Meldungen nicht abrufbar."
    : events.length === 0
      ? `Keine erkannten Ereignisse in den letzten ${rangeLabel}.`
      : criticalCount > 0
        ? `${criticalCount} kritische ${criticalCount === 1 ? "Meldung" : "Meldungen"} in den letzten ${rangeLabel}.`
        : importantCount > 0
          ? `${importantCount} wichtige ${importantCount === 1 ? "Meldung" : "Meldungen"} unter ${events.length} erkannten Ereignissen.`
          : `${events.length} Ereignisse erkannt, keines davon als wichtig eingestuft.`;
  const nextStep = eventResult.error
    ? undefined
    : events.length === 0
      ? hasFilter
        ? "Zeitraum erweitern oder Filter zurücksetzen."
        : "Der Ereignis-Monitor prüft alle 30 Minuten neue Meldungen."
      : "Einen Kreis auf der Karte oder eine Meldung in der Liste auswählen — die Detailansicht zeigt Quelle und mögliche Marktrelevanz.";

  const newsItems = newsResult.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Kontext"
        title="Weltlage & Nachrichten"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard">
            Command Center
          </Link>
        }
      />

      <PageIntro
        purpose="Diese Seite zeigt, wo weltweit etwas passiert, das für Märkte relevant sein könnte — und was SignalPilot darüber weiß."
        tone={tone}
        verdict={verdict}
        detail={
          withoutRegion > 0
            ? `${withoutRegion} davon ohne verlässliche Regionszuordnung — sie stehen in der Liste und als eigene Gruppe auf der Karte.`
            : undefined
        }
        nextStep={nextStep}
      />

      {eventResult.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      {/* Filter gelten gemeinsam für Karte und Liste — sie stehen in der URL und
          sind damit teilbar. */}
      <form className="filter-bar" method="GET" style={{ marginBottom: 16 }}>
        <select name="range" defaultValue={range} aria-label="Zeitraum">
          {TIME_RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select name="severity" defaultValue={severityFilter} aria-label="Wichtigkeit">
          {SEVERITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select name="eventType" defaultValue={categoryFilter} aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          {Object.entries(marketEventTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="region" defaultValue={regionFilter} aria-label="Region">
          <option value="">Alle Regionen</option>
          {knownRegions().map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
          <option value={UNASSIGNED_REGION_KEY}>{UNASSIGNED_REGION_LABEL}</option>
        </select>
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/news" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      {events.length > 0 ? (
        <WorldMapExplorer
          events={events}
          markers={markers}
          mapWidth={MAP_WIDTH}
          mapHeight={MAP_HEIGHT}
          renderedAt={renderedAt.toISOString()}
          mapBase={<MapBase />}
        />
      ) : (
        // Die Karte bleibt sichtbar, auch wenn nichts darauf liegt — sonst verliert
        // der Nutzer die Orientierung, wo die Funktion überhaupt sitzt.
        <SectionCard>
          <figure className="world-map-figure world-map-figure--large">
            <svg
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              className="world-map-svg world-map-svg--empty"
              role="img"
              aria-label="Weltkarte ohne Ereignisse im gewählten Zeitraum"
            >
              <MapBase />
            </svg>
          </figure>
          <EmptyState
            title={
              hasFilter
                ? "Keine Meldung passt zu diesen Filtern."
                : `Keine erkannten Ereignisse in den letzten ${rangeLabel}.`
            }
            description={
              hasFilter
                ? "Zeitraum erweitern, Wichtigkeit lockern oder Filter zurücksetzen."
                : "Der Ereignis-Monitor ordnet neue Meldungen automatisch ein und trägt sie hier ein."
            }
          />
        </SectionCard>
      )}

      {/* Meldungen zu einzelnen Werten — andere Datenquelle, deshalb klar getrennt. */}
      <div style={{ marginTop: 20 }}>
        <SectionCard
          title="Meldungen zu beobachteten Werten"
          subtitle="Unternehmensnachrichten aus der Watchlist — unabhängig von der Weltkarte oben."
        >
          {newsResult.error ? (
            <ErrorState
              title="Nachrichten nicht verfügbar"
              message={
                describeApiError(newsResult.errorKind, newsResult.error, "Die Nachrichten")
                  .message
              }
            />
          ) : newsItems.length === 0 ? (
            <EmptyState
              title={`Keine Meldungen zu beobachteten Werten in den letzten ${rangeLabel}.`}
              description="Sie erscheinen hier, sobald der Nachrichtenabruf für Watchlist-Werte etwas findet."
            />
          ) : (
            <div className="news-feed">
              {newsItems.slice(0, 12).map((item) => (
                <article className="news-card" key={item.id}>
                  <div className="news-card-meta">
                    <Link
                      className="symbol-chip"
                      href={`/dashboard/assets/${encodeURIComponent(item.symbol)}`}
                    >
                      {item.symbol}
                    </Link>
                    <span>{item.source}</span>
                    <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt)}</time>
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
                  {item.summary ? <p>{item.summary.slice(0, 220)}</p> : null}
                </article>
              ))}
              {newsItems.length > 12 ? (
                <TechnicalDetails
                  summary="Weitere Meldungen"
                  count={newsItems.length - 12}
                >
                  <div className="news-feed">
                    {newsItems.slice(12).map((item) => (
                      <article className="news-card" key={item.id}>
                        <div className="news-card-meta">
                          <span className="symbol-chip">{item.symbol}</span>
                          <span>{item.source}</span>
                          <time dateTime={item.publishedAt}>
                            {formatDateTime(item.publishedAt)}
                          </time>
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
                      </article>
                    ))}
                  </div>
                </TechnicalDetails>
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>

      <p className="research-footnote">
        Einstufung und mögliche Auswirkungen entstehen regelbasiert aus Schlagworten der
        Meldung. Es sind automatische Vorbewertungen — keine bestätigten Marktwirkungen,
        keine Handlungsempfehlung.
        {" "}
        {(["critical", "important", "info"] as const)
          .map((tier) => `${SEVERITY_TIER_META[tier].symbol} ${SEVERITY_TIER_META[tier].label}`)
          .join(" · ")}
      </p>
    </>
  );
}
