import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SEVERITY_TIER_META,
  UNASSIGNED_REGION_KEY,
  confidenceNote,
  derivedSummary,
  eventAge,
  marketRelevance,
  severitySortRank,
  severityTier,
  storedSummary
} from "../src/lib/market-event-detail";
import { knownRegions, isMappableRegion, projectRegion } from "../src/lib/world-map-geo";
import type { MarketEvent } from "../src/lib/signalpilot-api";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-08-06T12:00:00.000Z");

function event(overrides: Partial<MarketEvent> = {}): MarketEvent {
  return {
    id: "event-1",
    eventType: "CONFLICT",
    severity: "WATCH",
    confidence: 0.45,
    title: "Oil supply disrupted in the Gulf",
    summary: null,
    region: "Naher Osten",
    source: "Reuters",
    sourceUrl: "https://example.invalid/story",
    affectedAssetClasses: ["Rohstoffe"],
    affectedSectors: [],
    affectedSymbols: [],
    positiveImpact: ["Gold"],
    negativeImpact: ["Aktien"],
    reasoning: "Keyword-basierte Einordnung als CONFLICT: oil.",
    publishedAt: "2026-08-06T10:00:00.000Z",
    detectedAt: "2026-08-06T10:00:00.000Z",
    alertSentAt: null,
    ...overrides
  };
}

describe("severity priority", () => {
  it("maps the stored severities onto three visible tiers", () => {
    assert.equal(severityTier("CRITICAL"), "critical");
    assert.equal(severityTier("IMPORTANT"), "important");
    assert.equal(severityTier("WATCH"), "info");
    assert.equal(severityTier("INFO"), "info");
  });

  it("codes importance beyond colour alone", () => {
    for (const tier of ["critical", "important", "info"] as const) {
      const meta = SEVERITY_TIER_META[tier];
      assert.ok(meta.label.length > 0, "Textlabel fehlt");
      assert.ok(meta.symbol.length > 0, "Symbol fehlt");
      assert.ok(meta.color.startsWith("var("), "Farbe fehlt");
    }
    // Symbole müssen unterscheidbar sein, sonst trägt nur die Farbe die Aussage.
    const symbols = new Set(
      (["critical", "important", "info"] as const).map((tier) => SEVERITY_TIER_META[tier].symbol)
    );
    assert.equal(symbols.size, 3);
  });

  it("ranks a lone critical event above a large pile of info events", () => {
    assert.ok(severitySortRank("CRITICAL") > severitySortRank("IMPORTANT"));
    assert.ok(severitySortRank("IMPORTANT") > severitySortRank("WATCH"));
    assert.ok(severitySortRank("WATCH") > severitySortRank("INFO"));

    const events = [
      ...Array.from({ length: 20 }, (_, index) =>
        event({ id: `info-${index}`, severity: "INFO", detectedAt: "2026-08-06T11:59:00.000Z" })
      ),
      event({ id: "critical", severity: "CRITICAL", detectedAt: "2026-08-06T06:00:00.000Z" })
    ];
    const sorted = [...events].sort(
      (left, right) =>
        severitySortRank(right.severity) - severitySortRank(left.severity) ||
        new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime()
    );
    // Trotz älterem Zeitstempel und 20 konkurrierenden Meldungen steht sie oben.
    assert.equal(sorted[0].id, "critical");
  });
});

describe("summaries", () => {
  it("ignores a stored summary that only repeats the title", () => {
    assert.equal(
      storedSummary(event({ summary: "Oil supply disrupted in the Gulf." })),
      null
    );
    assert.equal(storedSummary(event({ summary: "  " })), null);
    assert.equal(storedSummary(event({ summary: null })), null);
  });

  it("keeps a genuinely different stored summary", () => {
    const real =
      "Brent futures traded just above $72 a barrel, while West Texas Intermediate was below $69 a barrel.";
    assert.equal(storedSummary(event({ summary: real })), real);
  });

  it("derives a factual summary only from stored fields", () => {
    const derived = derivedSummary(event(), NOW);
    assert.notEqual(derived, null);
    const text = derived!.text;

    assert.match(text, /Reuters/);
    assert.match(text, /Rohstoffe/);
    assert.match(text, /Naher Osten/);
    // Keine Prognose, keine Bewertung, keine erfundene Kausalität.
    assert.doesNotMatch(text, /wird steigen|wird fallen|dürfte|Prognose|empfehl/i);
  });

  it("returns no derived summary when nothing beyond the metadata is known", () => {
    const bare = event({
      affectedAssetClasses: [],
      affectedSectors: [],
      affectedSymbols: [],
      positiveImpact: [],
      negativeImpact: []
    });
    // Ein reiner "erfasst am"-Satz wäre inhaltsleer — dann lieber gar nichts.
    assert.equal(derivedSummary(bare, NOW), null);
  });

  it("does not repeat the impact direction that is rendered structurally", () => {
    const derived = derivedSummary(event(), NOW);
    assert.doesNotMatch(derived!.text, /Rückenwind|Gegenwind/);
  });

  it("formats the data age in correct German singular and plural", () => {
    assert.equal(eventAge(event({ detectedAt: NOW.toISOString() }), NOW), "gerade eben");
    assert.equal(
      eventAge(event({ detectedAt: "2026-08-06T11:59:00.000Z" }), NOW),
      "vor einer Minute"
    );
    assert.equal(
      eventAge(event({ detectedAt: "2026-08-06T11:00:00.000Z" }), NOW),
      "vor einer Stunde"
    );
    assert.equal(
      eventAge(event({ detectedAt: "2026-08-05T12:00:00.000Z" }), NOW),
      "vor einem Tag"
    );
    assert.equal(
      eventAge(event({ detectedAt: "2026-08-02T12:00:00.000Z" }), NOW),
      "vor 4 Tagen"
    );
    assert.equal(eventAge(event({ detectedAt: "kaputt" }), NOW), "Zeitpunkt unbekannt");
  });
});

describe("market relevance", () => {
  it("reports nothing when no impact was derived — it invents no link", () => {
    const bare = event({
      affectedAssetClasses: [],
      affectedSectors: [],
      affectedSymbols: [],
      positiveImpact: [],
      negativeImpact: []
    });
    const relevance = marketRelevance(bare);
    assert.equal(relevance.hasAny, false);
    assert.deepEqual(relevance.areas, []);
    assert.deepEqual(relevance.positive, []);
  });

  it("merges asset classes and sectors without duplicates", () => {
    const relevance = marketRelevance(
      event({ affectedAssetClasses: ["Aktien", "Rohstoffe"], affectedSectors: ["Rohstoffe"] })
    );
    assert.deepEqual(relevance.areas, ["Aktien", "Rohstoffe"]);
  });

  it("always states the uncertainty with the stored confidence", () => {
    const note = confidenceNote(event({ confidence: 0.45 }));
    assert.match(note, /45 %/);
    assert.match(note, /vermutet, nicht bestätigt/);
  });
});

describe("map geography", () => {
  it("has an anchor for every region the classifier can produce", () => {
    // packages/events-intelligence/src/marketEvents.ts kennt genau diese Regionen.
    const classifierRegions = [
      "Russland/Ukraine",
      "Naher Osten",
      "China",
      "Japan",
      "Europa",
      "UK",
      "USA"
    ];
    for (const region of classifierRegions) {
      assert.ok(isMappableRegion(region), `${region} hat keinen Kartenanker`);
    }
    assert.deepEqual([...knownRegions()].sort(), [...classifierRegions].sort());
  });

  it("places events without a region on the map instead of hiding them", () => {
    const point = projectRegion(UNASSIGNED_REGION_KEY);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    // Eigener Platz, nicht auf einem echten Regionsanker.
    for (const region of knownRegions()) {
      const other = projectRegion(region);
      assert.ok(
        Math.abs(other.x - point.x) > 1 || Math.abs(other.y - point.y) > 1,
        `Anker überlappt mit ${region}`
      );
    }
  });

  it("treats a missing region as not mappable", () => {
    assert.equal(isMappableRegion(null), false);
    assert.equal(isMappableRegion("Antarktis"), false);
  });
});

describe("world map explorer wiring", () => {
  const source = () =>
    readFile(resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"), "utf8");

  it("makes markers selectable by mouse and keyboard", async () => {
    const code = await source();
    assert.match(code, /role="button"/);
    assert.match(code, /tabIndex=\{0\}/);
    assert.match(code, /onKeyDown/);
    assert.match(code, /event\.key === "Enter" \|\| event\.key === " "/);
    assert.match(code, /aria-label=/);
  });

  it("synchronises selection between map, list and detail", async () => {
    const code = await source();
    assert.match(code, /setSelectedId/);
    assert.match(code, /setFocusedRegion/);
    assert.match(code, /map-marker--active/);
    assert.match(code, /event-item--active/);
    assert.match(code, /aria-current=/);
  });

  it("resolves a cluster into the region's events", async () => {
    const code = await source();
    assert.match(code, /handleMarker/);
    assert.match(code, /regionOf\(event\) === regionKey/);
  });

  it("drops a selection that a filter change removed", async () => {
    const code = await source();
    assert.match(code, /!events\.some\(\(event\) => event\.id === selectedId\)/);
  });

  it("handles a missing source link and a missing summary", async () => {
    const code = await source();
    assert.match(code, /kein Link gespeichert/);
    assert.match(code, /keine Zusammenfassung vor/);
  });
});

describe("weltlage page", () => {
  const source = () => readFile(resolve(appDir, "src/app/dashboard/news/page.tsx"), "utf8");

  it("applies every filter to map and list through one query", async () => {
    const code = await source();
    for (const param of ["range", "severity", "eventType", "region"]) {
      assert.match(code, new RegExp(`name="${param}"`), `Filter ${param} fehlt`);
    }
    // Ein einziger Datensatz speist Karte und Liste.
    assert.match(code, /<WorldMapExplorer[\s\S]*events=\{events\}/);
    assert.match(code, /markers=\{markers\}/);
  });

  it("keeps the map visible when nothing matches", async () => {
    const code = await source();
    assert.match(code, /world-map-svg--empty/);
    assert.match(code, /Keine Meldung passt zu diesen Filtern/);
  });

  it("offers the region-less group as its own filter and marker", async () => {
    const code = await source();
    assert.match(code, /UNASSIGNED_REGION_KEY/);
    assert.match(code, /ohne verlässliche Regionszuordnung/);
  });

  it("surfaces an API failure instead of showing an empty map", async () => {
    const code = await source();
    assert.match(code, /eventResult\.error \?/);
    assert.match(code, /<RetryButton \/>/);
  });
});
