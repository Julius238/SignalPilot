import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SEVERITY_KEYS,
  resolveSeverity,
  severityLabel,
  severityRank,
  severityScale,
  severitySymbol,
  severityTone
} from "../src/lib/severity";
import { severityMeta, severitySortRank } from "../src/lib/market-event-detail";
import {
  severityLabel as sharedSeverityLabel,
  severityRank as sharedSeverityRank,
  severitySymbol as sharedSeveritySymbol,
  severityTone as sharedSeverityTone
} from "../src/components/dashboard/shared";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("zentrale Severity-Zuordnung", () => {
  it("liefert für dieselbe Meldung überall dieselbe Wichtigkeit", () => {
    // Der behobene Widerspruch: WATCH hieß auf dem Command Center "Beobachten"
    // und auf der Weltlage-Seite "Informativ".
    for (const key of SEVERITY_KEYS) {
      assert.equal(sharedSeverityLabel(key), severityLabel(key), `Label weicht ab für ${key}`);
      assert.equal(severityMeta(key).label, severityLabel(key), `Label weicht ab für ${key}`);
      assert.equal(sharedSeverityTone(key), severityTone(key), `Ton weicht ab für ${key}`);
      assert.equal(severityMeta(key).tone, severityTone(key), `Ton weicht ab für ${key}`);
      assert.equal(sharedSeverityRank(key), severityRank(key), `Rang weicht ab für ${key}`);
      assert.equal(severitySortRank(key), severityRank(key), `Rang weicht ab für ${key}`);
    }

    assert.equal(severityLabel("WATCH"), "Beobachten");
    assert.equal(severityMeta("WATCH").label, "Beobachten");
    assert.notEqual(severityMeta("WATCH").label, severityMeta("INFO").label);
  });

  it("hält Farbe, Symbol und Text in einer Quelle zusammen", () => {
    for (const meta of severityScale()) {
      assert.ok(meta.label.length > 0, `Label fehlt für ${meta.key}`);
      assert.ok(meta.symbol.length > 0, `Symbol fehlt für ${meta.key}`);
      assert.match(meta.color, /^var\(--sev-/, `Farb-Token fehlt für ${meta.key}`);
      assert.ok(meta.markerRadius > 0, `Marker-Radius fehlt für ${meta.key}`);
    }

    // Vier unterscheidbare Stufen — sonst trägt die Farbe allein die Aussage.
    assert.equal(new Set(severityScale().map((meta) => meta.label)).size, 4);
    assert.equal(new Set(severityScale().map((meta) => meta.symbol)).size, 4);
    assert.equal(new Set(severityScale().map((meta) => meta.color)).size, 4);
  });

  it("sortiert von wichtig nach unwichtig", () => {
    const ranks = severityScale().map((meta) => meta.rank);
    assert.deepEqual(ranks, [...ranks].sort((left, right) => right - left));
    assert.ok(severityRank("CRITICAL") > severityRank("IMPORTANT"));
    assert.ok(severityRank("IMPORTANT") > severityRank("WATCH"));
    assert.ok(severityRank("WATCH") > severityRank("INFO"));
  });

  it("lässt Wichtigkeit die Markergröße dominieren, nicht die Anzahl", () => {
    const critical = resolveSeverity("CRITICAL").markerRadius;
    const info = resolveSeverity("INFO").markerRadius;
    // Ein einzelnes kritisches Ereignis bleibt größer als ein Info-Cluster,
    // dessen Zuschlag bei 10 gedeckelt ist.
    assert.ok(critical > info + 10, "Kritisch geht neben einem Info-Cluster unter");
  });

  it("fängt unbekannte und fehlende Werte neutral ab", () => {
    for (const value of [undefined, null, "", "PANIC", "kritisch!", "0"]) {
      const meta = resolveSeverity(value);
      assert.equal(meta.key, "INFO", `Unbekannter Wert ${String(value)} nicht neutral`);
      assert.equal(meta.tone, "info");
      // Fail-safe: nie versehentlich als höchste Stufe darstellen.
      assert.equal(meta.rank, 1);
    }

    // Groß-/Kleinschreibung des Backends soll nicht zum Ausfall führen.
    assert.equal(resolveSeverity("watch").key, "WATCH");
    assert.equal(severitySymbol("critical"), severitySymbol("CRITICAL"));
  });
});

describe("keine zweite Severity-Tabelle", () => {
  it("verwendet in Karte, Liste und Detail nur die zentrale Zuordnung", async () => {
    const explorer = await readFile(
      resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"),
      "utf8"
    );
    const news = await readFile(resolve(appDir, "src/app/dashboard/news/page.tsx"), "utf8");

    for (const source of [explorer, news]) {
      assert.doesNotMatch(source, /SEVERITY_TIER_META/);
      assert.doesNotMatch(source, /"Informativ"/);
    }
    assert.match(explorer, /severityMeta\(/);
    assert.match(news, /severityScale\(\)/);
  });

  it("zeichnet WATCH auf Command Center und Weltlage mit demselben Symbol", async () => {
    const [priorityFeed, radarCompact, compactMap, explorer, styles] = await Promise.all(
      [
        "src/components/dashboard/priority-feed.tsx",
        "src/components/dashboard/radar-compact.tsx",
        "src/components/dashboard/news-world-map.tsx",
        "src/components/dashboard/world-map-explorer.tsx",
        "src/app/globals.css"
      ].map((file) => readFile(resolve(appDir, file), "utf8"))
    );

    // Der konkrete Widerspruch: Das Command Center zeichnete einen festen runden
    // CSS-Punkt (`.sev-chip::before`), die Weltlage das zentrale Symbol "◆".
    // Dieselbe WATCH-Meldung trug dadurch zwei verschiedene Symbole.
    assert.doesNotMatch(styles, /\.sev-chip::before/);
    assert.match(styles, /\.sev-chip-symbol/);

    for (const source of [priorityFeed, radarCompact]) {
      assert.match(source, /severitySymbol\(/);
      assert.match(source, /className="sev-chip-symbol"/);
    }

    // Beide Karten und die Liste holen Symbol und Label aus derselben Quelle.
    for (const source of [compactMap, explorer]) {
      assert.match(source, /meta\.symbol/);
      assert.match(source, /meta\.label/);
    }

    // Und keine der Ansichten bringt eine eigene Farb- oder Rangtabelle mit.
    assert.doesNotMatch(compactMap, /severityColors/);
    assert.doesNotMatch(compactMap, /severityOrder/);
    assert.match(compactMap, /from "\.\.\/\.\.\/lib\/severity"/);
  });

  it("liefert WATCH über jeden Zugriffsweg dieselben Metadaten", () => {
    const central = resolveSeverity("WATCH");
    const detail = severityMeta("WATCH");

    assert.deepEqual(detail, central);
    assert.equal(sharedSeverityLabel("WATCH"), central.label);
    assert.equal(sharedSeveritySymbol("WATCH"), central.symbol);
    assert.equal(sharedSeverityTone("WATCH"), central.tone);
    assert.equal(sharedSeverityRank("WATCH"), central.rank);
    assert.equal(severitySortRank("WATCH"), central.rank);

    // Und die Stufe bleibt von der Nachbarstufe unterscheidbar — Symbol wie Text.
    assert.notEqual(central.symbol, resolveSeverity("INFO").symbol);
    assert.notEqual(central.symbol, resolveSeverity("IMPORTANT").symbol);
  });

  it("hält shared.ts und market-event-detail.ts als reine Weiterleitungen", async () => {
    const shared = await readFile(
      resolve(appDir, "src/components/dashboard/shared.ts"),
      "utf8"
    );
    const detail = await readFile(resolve(appDir, "src/lib/market-event-detail.ts"), "utf8");

    assert.match(shared, /from "\.\.\/\.\.\/lib\/severity"/);
    assert.match(detail, /from "\.\/severity"/);
    // Keine eigenen Labels mehr in den Weiterleitungen.
    assert.doesNotMatch(shared, /"Sofort ansehen"/);
    assert.doesNotMatch(detail, /"Kritisch"/);
  });
});

describe("Kartenmarker-Zugänglichkeit", () => {
  it("meldet den ausgewählten Marker über aria-pressed", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"),
      "utf8"
    );

    // Vorher: aria-pressed={isFocused} — beim Klick auf einen Listeneintrag blieb
    // der zugehörige Marker optisch aktiv, für Screenreader aber "nicht gedrückt".
    assert.match(source, /aria-pressed=\{isActive\}/);
    assert.match(
      source,
      /selectedRegion === marker\.regionKey \|\|\s*focusedRegion === marker\.regionKey/
    );
  });

  it("bleibt mit Enter und Leertaste bedienbar", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"),
      "utf8"
    );

    assert.match(source, /role="button"/);
    assert.match(source, /tabIndex=\{0\}/);
    assert.match(source, /event\.key === "Enter"/);
    assert.match(source, /event\.key === " "/);
    // Ältere Engines melden die Leertaste als "Spacebar".
    assert.match(source, /event\.key === "Spacebar"/);
    assert.match(source, /event\.preventDefault\(\)/);
  });

  it("zeigt auch am noch nicht ausgewählten Marker einen sichtbaren Fokus", async () => {
    const [source, styles] = await Promise.all(
      [
        "src/components/dashboard/world-map-explorer.tsx",
        "src/app/globals.css"
      ].map((file) => readFile(resolve(appDir, file), "utf8"))
    );

    // Der konkrete Fehler: Der Fokusring hing am Auswahlring, den es ohne
    // Auswahl gar nicht im DOM gab. Ein per Tab angesprungener Marker war
    // fokussiert, aber unsichtbar.
    assert.match(source, /<circle className="map-marker-focus"/);
    const start = source.indexOf('<circle className="map-marker-focus"');
    const focusCircle = source.slice(start, source.indexOf("/>", start) + 2);
    assert.doesNotMatch(focusCircle, /isActive/, "Fokusring darf nicht an der Auswahl hängen");
    // Der Auswahlring bleibt dagegen bedingt — er markiert weiterhin nur die Auswahl.
    assert.match(source, /\{isActive \? \(\s*<circle className="map-marker-ring"/);

    // Unsichtbar ohne Fokus, sichtbar bei :focus-visible.
    assert.match(styles, /\.map-marker-focus \{[^}]*stroke:\s*none/);
    const focusRule = styles.slice(
      styles.indexOf(".map-marker:focus-visible .map-marker-focus {")
    );
    const focusBlock = focusRule.slice(0, focusRule.indexOf("}"));
    assert.ok(focusBlock.length > 0, "Regel für den sichtbaren Fokusring fehlt");
    assert.match(focusBlock, /stroke:\s*var\(--/);
    // Zweite Codierung neben der Farbe: gestrichelte Linie mit eigener Stärke.
    assert.match(focusBlock, /stroke-dasharray:/);
    assert.match(focusBlock, /stroke-width:/);

    // Der aktive Marker bleibt davon unabhängig unterscheidbar.
    assert.match(styles, /\.map-marker--active \.map-marker-ring \{[^}]*stroke:\s*var\(--/);
    assert.doesNotMatch(styles, /\.map-marker:focus-visible \.map-marker-ring/);
  });

  it("markiert den aktiven Listeneintrag weiterhin mit aria-current", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"),
      "utf8"
    );

    assert.match(source, /aria-current=\{isActive \? "true" : undefined\}/);
  });

  it("gibt jedem Marker einen verständlichen Namen mit korrektem Numerus", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"),
      "utf8"
    );

    assert.match(source, /aria-label=\{`\$\{marker\.label\}: \$\{pluralize\(/);
    assert.match(source, /höchste Einstufung \$\{meta\.label\}/);
  });
});
