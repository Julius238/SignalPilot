import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, Objects } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";

import worldAtlas from "world-atlas/countries-110m.json";

import { UNASSIGNED_REGION_KEY } from "./market-event-detail";

// Projektion und Länderpfade werden einmal auf dem Server berechnet. Die Pfade sind
// gross (~180 Strings) und dürfen deshalb nicht als Props über die Server-Client-
// Grenze wandern — sie werden als server-gerendertes `children` eingesetzt.

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 480;

// Die Klassifikation in packages/events-intelligence kennt genau diese sieben
// Regionen (regionRules). Jede davon hat hier einen Anker — es fällt also keine
// zugeordnete Meldung von der Karte.
const REGION_ANCHORS: Record<string, [number, number]> = {
  USA: [-98, 39],
  Europa: [10, 50],
  UK: [-2.5, 54.5],
  China: [104, 35],
  Japan: [138, 37],
  "Russland/Ukraine": [40, 54],
  "Naher Osten": [45, 28]
};

// Meldungen ohne Regionszuordnung bekommen einen eigenen Platz im Südatlantik,
// statt nur als Fußnote gezählt zu werden. Sie sind damit anklickbar wie jede
// andere Gruppe.
const UNASSIGNED_ANCHOR: [number, number] = [-28, -38];

const topology = worldAtlas as unknown as Topology<Objects>;
const countries = feature(
  topology,
  topology.objects.countries
) as unknown as FeatureCollection<Geometry>;

const projection = geoNaturalEarth1().fitSize([MAP_WIDTH, MAP_HEIGHT], { type: "Sphere" });
const path = geoPath(projection);

export const spherePath = path({ type: "Sphere" }) ?? "";
export const countryPaths = countries.features
  .map((country) => path(country))
  .filter((d): d is string => Boolean(d));

export function knownRegions(): string[] {
  return Object.keys(REGION_ANCHORS);
}

export function isMappableRegion(region: string | null): boolean {
  return region !== null && region in REGION_ANCHORS;
}

/** Bildpunkt einer Region im Koordinatensystem der Karte (0..MAP_WIDTH/HEIGHT). */
export function projectRegion(regionKey: string): { x: number; y: number } {
  const anchor =
    regionKey === UNASSIGNED_REGION_KEY
      ? UNASSIGNED_ANCHOR
      : REGION_ANCHORS[regionKey] ?? UNASSIGNED_ANCHOR;
  const projected = projection(anchor);
  return { x: projected?.[0] ?? 0, y: projected?.[1] ?? 0 };
}
