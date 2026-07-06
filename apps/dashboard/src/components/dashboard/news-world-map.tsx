import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, Objects } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";

import worldAtlas from "world-atlas/countries-110m.json";

import type { MarketEvent } from "../../lib/signalpilot-api";

// Server-gerenderte SVG-Weltkarte: zeigt, aus welchen Regionen die zuletzt
// erkannten globalen Ereignisse stammen. Kein Client-JavaScript — die Karte
// wird komplett auf dem Server projiziert (d3-geo, Natural-Earth-Projektion).

const mapWidth = 960;
const mapHeight = 480;

// Ungefähre Kartenanker (Lon/Lat) für die Regionen aus der News-Klassifikation
const regionAnchors: Record<string, [number, number]> = {
  USA: [-98, 39],
  Europa: [10, 50],
  UK: [-2.5, 54.5],
  China: [104, 35],
  Japan: [138, 37],
  "Russland/Ukraine": [40, 54],
  "Naher Osten": [45, 28]
};

const severityColors: Record<MarketEvent["severity"], string> = {
  CRITICAL: "var(--bad)",
  IMPORTANT: "var(--warn)",
  WATCH: "var(--accent)",
  INFO: "var(--muted)"
};

const severityLabels: Record<MarketEvent["severity"], string> = {
  CRITICAL: "Hochrelevant",
  IMPORTANT: "Wichtig",
  WATCH: "Beobachten",
  INFO: "Nur Information"
};

const severityOrder: Array<MarketEvent["severity"]> = ["CRITICAL", "IMPORTANT", "WATCH", "INFO"];

type RegionBucket = {
  region: string;
  count: number;
  maxSeverity: MarketEvent["severity"];
};

const topology = worldAtlas as unknown as Topology<Objects>;
const countries = feature(
  topology,
  topology.objects.countries
) as unknown as FeatureCollection<Geometry>;

const projection = geoNaturalEarth1().fitSize([mapWidth, mapHeight], { type: "Sphere" });
const path = geoPath(projection);
const spherePath = path({ type: "Sphere" }) ?? "";
const countryPaths = countries.features
  .map((country) => path(country))
  .filter((d): d is string => Boolean(d));

export function NewsWorldMap({ events, now }: { events: MarketEvent[]; now: Date }) {
  const buckets = new Map<string, RegionBucket>();
  let unlocatedCount = 0;

  for (const event of events) {
    const region = event.region;

    if (!region || !(region in regionAnchors)) {
      unlocatedCount += 1;
      continue;
    }

    const bucket = buckets.get(region) ?? { region, count: 0, maxSeverity: "INFO" as const };
    bucket.count += 1;

    if (severityOrder.indexOf(event.severity) < severityOrder.indexOf(bucket.maxSeverity)) {
      bucket.maxSeverity = event.severity;
    }

    buckets.set(region, bucket);
  }

  // Größere Bubbles zuerst zeichnen, damit kleinere lesbar darüber liegen
  const markers = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .map((bucket) => {
      const projected = projection(regionAnchors[bucket.region]);

      return {
        ...bucket,
        x: projected?.[0] ?? 0,
        y: projected?.[1] ?? 0,
        radius: Math.min(34, 10 + Math.sqrt(bucket.count) * 6)
      };
    });

  const activeSeverities = severityOrder.filter((severity) =>
    markers.some((marker) => marker.maxSeverity === severity)
  );

  return (
    <figure className="world-map-figure">
      <svg
        viewBox={`0 0 ${mapWidth} ${mapHeight}`}
        role="img"
        aria-label="Weltkarte mit Herkunftsregionen der aktuellen Marktereignisse"
        className="world-map-svg"
      >
        <path d={spherePath} className="world-map-sphere" />
        {countryPaths.map((d, index) => (
          <path key={index} d={d} className="world-map-country" />
        ))}
        {markers.map((marker) => (
          <g key={marker.region} transform={`translate(${marker.x}, ${marker.y})`}>
            <title>
              {`${marker.region}: ${marker.count} ${marker.count === 1 ? "Ereignis" : "Ereignisse"} · höchste Einstufung: ${severityLabels[marker.maxSeverity]}`}
            </title>
            <circle
              r={marker.radius}
              fill={severityColors[marker.maxSeverity]}
              fillOpacity={0.22}
              stroke={severityColors[marker.maxSeverity]}
              strokeWidth={1.5}
            />
            <text className="world-map-count" dy="0.35em">
              {marker.count}
            </text>
            <text className="world-map-region-label" y={marker.radius + 14}>
              {marker.region}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="world-map-legend">
        {activeSeverities.map((severity) => (
          <span key={severity} className="world-map-legend-item">
            <span
              className="world-map-legend-dot"
              style={{ backgroundColor: severityColors[severity] }}
            />
            {severityLabels[severity]}
          </span>
        ))}
        {unlocatedCount > 0 ? (
          <span className="world-map-legend-item muted">
            Ohne Regionszuordnung: {unlocatedCount}
          </span>
        ) : null}
        <span className="world-map-legend-item muted">
          Ereignisse der letzten 48h · Stand {formatTime(now)}
        </span>
      </figcaption>
    </figure>
  );
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("de-DE", { timeStyle: "short" }).format(value);
}
