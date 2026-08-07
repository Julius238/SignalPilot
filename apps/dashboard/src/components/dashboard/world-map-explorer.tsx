"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { marketEventTypeLabels } from "./shared";
import { formatDateTime, pluralize } from "../../lib/format";
import {
  UNASSIGNED_REGION_KEY,
  UNASSIGNED_REGION_LABEL,
  confidenceNote,
  derivedSummary,
  eventAge,
  marketRelevance,
  severityMeta,
  severitySortRank,
  storedSummary
} from "../../lib/market-event-detail";
import { severityScale, type SeverityMeta } from "../../lib/severity";
import type { MarketEvent } from "../../lib/signalpilot-api";

export type MapMarker = {
  regionKey: string;
  label: string;
  x: number;
  y: number;
};

// Karte, Liste und Detail teilen sich einen Auswahlzustand. Die Karte selbst wird
// serverseitig projiziert und als `mapBase` hereingereicht — nur die Marker und die
// Interaktion leben im Client.
export function WorldMapExplorer({
  events,
  markers,
  mapWidth,
  mapHeight,
  renderedAt,
  mapBase
}: {
  events: MarketEvent[];
  markers: MapMarker[];
  mapWidth: number;
  mapHeight: number;
  renderedAt: string;
  mapBase: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const now = useMemo(() => new Date(renderedAt), [renderedAt]);

  const regionOf = useCallback(
    (event: MarketEvent) => event.region ?? UNASSIGNED_REGION_KEY,
    []
  );

  // Sortierung: Wichtigkeit zuerst, dann Aktualität. Eine kritische Meldung steht
  // damit oben, unabhängig davon, wie viele Meldungen ihre Region sonst hat.
  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (left, right) =>
          severitySortRank(right.severity) - severitySortRank(left.severity) ||
          new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime()
      ),
    [events]
  );

  const visibleEvents = useMemo(
    () =>
      focusedRegion === null
        ? sortedEvents
        : sortedEvents.filter((event) => regionOf(event) === focusedRegion),
    [sortedEvents, focusedRegion, regionOf]
  );

  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? null,
    [events, selectedId]
  );

  // Auswahl fällt weg, wenn sie durch einen Filterwechsel aus der Liste verschwindet.
  useEffect(() => {
    if (selectedId && !events.some((event) => event.id === selectedId)) {
      setSelectedId(null);
    }
  }, [events, selectedId]);

  const markerData = useMemo(() => {
    const counts = new Map<string, { total: number; top: SeverityMeta }>();
    for (const event of events) {
      const key = regionOf(event);
      const meta = severityMeta(event.severity);
      const entry = counts.get(key);
      if (!entry) {
        counts.set(key, { total: 1, top: meta });
        continue;
      }
      entry.total += 1;
      if (meta.rank > entry.top.rank) entry.top = meta;
    }

    return markers
      .map((marker) => {
        const entry = counts.get(marker.regionKey);
        if (!entry) return null;
        // Wichtigkeit bestimmt den Grundradius (aus `lib/severity.ts`), die Anzahl
        // nur einen kleinen Zuschlag. Sonst würde eine einzelne kritische Meldung
        // neben einem großen Info-Cluster optisch untergehen.
        return {
          ...marker,
          count: entry.total,
          meta: entry.top,
          radius: entry.top.markerRadius + Math.min(10, Math.sqrt(entry.total) * 2.5)
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null)
      .sort((left, right) => right.radius - left.radius);
  }, [events, markers, regionOf]);

  const selectEvent = useCallback((id: string) => {
    setSelectedId(id);
    // Auf schmalen Bildschirmen steht das Detail unter der Karte — dorthin scrollen,
    // damit ein Marker-Klick nicht ins Leere zu laufen scheint.
    window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  const handleMarker = useCallback(
    (regionKey: string) => {
      const inRegion = sortedEvents.filter((event) => regionOf(event) === regionKey);
      if (inRegion.length === 0) return;
      // Cluster auflösen: Die Liste filtert auf die Region, die wichtigste Meldung
      // daraus wird geöffnet.
      setFocusedRegion(regionKey);
      selectEvent(inRegion[0].id);
    },
    [sortedEvents, regionOf, selectEvent]
  );

  const selectedRegion = selected ? regionOf(selected) : null;

  return (
    <div className="map-explorer">
      <div className="map-explorer-main">
        <figure className="world-map-figure world-map-figure--large">
          <svg
            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
            className="world-map-svg"
            role="group"
            aria-label="Weltkarte der erkannten Ereignisse — Regionen sind auswählbar"
          >
            {mapBase}
            {markerData.map((marker) => {
              const meta = marker.meta;
              // Ausgewählt ist ein Marker, sobald seine Region die Liste filtert ODER
              // die offene Meldung aus ihr stammt. Beides muss `aria-pressed` setzen,
              // sonst erfährt ein Screenreader nichts von der Auswahl.
              const isActive =
                selectedRegion === marker.regionKey || focusedRegion === marker.regionKey;
              return (
                <g
                  key={marker.regionKey}
                  className={`map-marker${isActive ? " map-marker--active" : ""}`}
                  transform={`translate(${marker.x}, ${marker.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  aria-label={`${marker.label}: ${pluralize(
                    marker.count,
                    "Meldung",
                    "Meldungen"
                  )}, höchste Einstufung ${meta.label}`}
                  onClick={() => handleMarker(marker.regionKey)}
                  onKeyDown={(event) => {
                    // SVG-Elemente mit role="button" lösen — anders als <button> —
                    // nicht von selbst aus. Enter und Leertaste müssen von Hand
                    // behandelt werden; "Spacebar" ist der Legacy-Name älterer Engines.
                    if (
                      event.key === "Enter" ||
                      event.key === " " ||
                      event.key === "Spacebar"
                    ) {
                      event.preventDefault();
                      handleMarker(marker.regionKey);
                    }
                  }}
                >
                  {/* Immer im DOM, auch ohne Auswahl: Der Fokusring hing vorher
                      am Auswahlring und fehlte damit genau dort, wo er gebraucht
                      wird — beim noch nicht ausgewählten Marker. Sichtbar wird er
                      allein über `:focus-visible`. */}
                  <circle className="map-marker-focus" r={marker.radius + 11} />
                  {isActive ? (
                    <circle className="map-marker-ring" r={marker.radius + 6} />
                  ) : null}
                  <circle
                    r={marker.radius}
                    fill={meta.color}
                    fillOpacity={0.24}
                    stroke={meta.color}
                    strokeWidth={meta.key === "INFO" ? 1.5 : 2.5}
                  />
                  <text className="world-map-count" dy="0.35em">
                    {marker.count}
                  </text>
                  <text className="world-map-region-label" y={marker.radius + 14}>
                    {meta.symbol} {marker.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <figcaption className="world-map-legend">
            {severityScale()
              .filter((meta) => markerData.some((marker) => marker.meta.key === meta.key))
              .map((meta) => (
                <span key={meta.key} className="world-map-legend-item">
                  <span
                    className="world-map-legend-dot"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.symbol} {meta.label}
                </span>
              ))}
            <span className="world-map-legend-item muted">
              Kreisgröße folgt der Wichtigkeit, die Zahl der Anzahl · Stand{" "}
              {formatDateTime(renderedAt)}
            </span>
          </figcaption>
        </figure>

        <div ref={detailRef}>
          {selected ? (
            <EventDetail event={selected} now={now} onClose={() => setSelectedId(null)} />
          ) : (
            <p className="map-explorer-hint">
              Eine Meldung in der Liste oder einen Kreis auf der Karte auswählen, um
              Einordnung, Quelle und mögliche Marktrelevanz zu sehen.
            </p>
          )}
        </div>
      </div>

      <aside className="map-explorer-list" aria-label="Meldungen">
        <div className="map-explorer-list-head">
          <strong>{pluralize(visibleEvents.length, "Meldung", "Meldungen")}</strong>
          {focusedRegion ? (
            <button
              type="button"
              className="map-explorer-clear"
              onClick={() => setFocusedRegion(null)}
            >
              {focusedRegion === UNASSIGNED_REGION_KEY
                ? UNASSIGNED_REGION_LABEL
                : focusedRegion}{" "}
              ✕
            </button>
          ) : (
            <span className="muted small">wichtigste zuerst</span>
          )}
        </div>

        <ul className="map-explorer-items">
          {visibleEvents.map((event) => {
            const meta = severityMeta(event.severity);
            const isActive = event.id === selectedId;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className={`event-item event-item--${meta.tone}${
                    isActive ? " event-item--active" : ""
                  }`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    setFocusedRegion(null);
                    selectEvent(event.id);
                  }}
                >
                  <span className="event-item-top">
                    <span className="event-item-severity" style={{ color: meta.color }}>
                      {meta.symbol} {meta.label}
                    </span>
                    <span className="event-item-category">
                      {marketEventTypeLabels[event.eventType] ?? event.eventType}
                    </span>
                  </span>
                  <span className="event-item-title">{event.title}</span>
                  <span className="event-item-meta">
                    {event.region ?? UNASSIGNED_REGION_LABEL} · {eventAge(event, now)} ·{" "}
                    {event.source}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

function EventDetail({
  event,
  now,
  onClose
}: {
  event: MarketEvent;
  now: Date;
  onClose: () => void;
}) {
  const meta = severityMeta(event.severity);
  const stored = storedSummary(event);
  const derived = stored ? null : derivedSummary(event, now);
  const relevance = marketRelevance(event);

  return (
    <article className={`event-detail event-detail--${meta.tone}`} aria-live="polite">
      <div className="event-detail-head">
        <span className="event-detail-severity" style={{ color: meta.color }}>
          {meta.symbol} {meta.label}
        </span>
        <span className="event-detail-category">
          {marketEventTypeLabels[event.eventType] ?? event.eventType}
        </span>
        <button
          type="button"
          className="event-detail-close"
          onClick={onClose}
          aria-label="Detailansicht schließen"
        >
          ✕
        </button>
      </div>

      <h3 className="event-detail-title">{event.title}</h3>

      {stored ? (
        <p className="event-detail-summary">{stored}</p>
      ) : derived ? (
        <p className="event-detail-summary event-detail-summary--derived">
          {derived.text}
          <span className="event-detail-derived-note">
            Aus den gespeicherten Angaben zusammengestellt — keine Zusammenfassung des
            Artikeltexts.
          </span>
        </p>
      ) : (
        <p className="event-detail-summary muted">
          Für diese Meldung liegt keine Zusammenfassung vor. Der Originaltext steht bei
          der Quelle.
        </p>
      )}

      <dl className="event-detail-facts">
        <div>
          <dt>Zeitpunkt</dt>
          <dd>
            {formatDateTime(event.detectedAt)}
            <span className="muted"> · {eventAge(event, now)}</span>
          </dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>
            {event.region ?? (
              <span className="muted">Nicht zuverlässig zuordenbar</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Kategorie</dt>
          <dd>{marketEventTypeLabels[event.eventType] ?? event.eventType}</dd>
        </div>
        <div>
          <dt>Quelle</dt>
          <dd>
            {event.sourceUrl ? (
              <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
                {event.source} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <>
                {event.source}
                <span className="muted"> · kein Link gespeichert</span>
              </>
            )}
          </dd>
        </div>
      </dl>

      {relevance.hasAny ? (
        <div className="event-detail-relevance">
          <p className="context-block-title">Was betroffen sein könnte</p>
          {relevance.areas.length > 0 ? (
            <p className="event-detail-areas">
              {relevance.areas.map((area) => (
                <span className="soft-chip" key={area}>
                  {area}
                </span>
              ))}
            </p>
          ) : null}
          {relevance.symbols.length > 0 ? (
            <p className="event-detail-areas">
              {relevance.symbols.map((symbol) => (
                <span className="soft-chip" key={symbol}>
                  {symbol}
                </span>
              ))}
            </p>
          ) : null}
          {relevance.positive.length > 0 ? (
            <p className="event-detail-impact">
              <span className="impact-entry-arrow impact-entry-arrow--pos" aria-hidden="true">
                ↗
              </span>
              Rückenwind möglich für {relevance.positive.join(", ")}
            </p>
          ) : null}
          {relevance.negative.length > 0 ? (
            <p className="event-detail-impact">
              <span className="impact-entry-arrow impact-entry-arrow--neg" aria-hidden="true">
                ↘
              </span>
              Gegenwind möglich für {relevance.negative.join(", ")}
            </p>
          ) : null}
          <p className="event-detail-uncertainty">{confidenceNote(event)}</p>
        </div>
      ) : (
        <p className="event-detail-uncertainty">
          Für diese Meldung wurde keine mögliche Marktwirkung abgeleitet. Es wird bewusst
          keine vermutet.
        </p>
      )}

      {event.reasoning ? (
        <details className="technical-details">
          <summary>Wie diese Einordnung entstanden ist</summary>
          <div className="technical-details-body">
            <p className="muted small" style={{ margin: 0 }}>
              {event.reasoning}
            </p>
          </div>
        </details>
      ) : null}
    </article>
  );
}
