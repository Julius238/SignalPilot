import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("dashboard information architecture", () => {
  it("groups navigation by user task and supports the mobile drawer", async () => {
    const source = await readFile(resolve(appDir, "src/components/nav-bar.tsx"), "utf8");

    for (const group of ["Lage", "Beobachten", "Kontext", "Research", "System"]) {
      assert.match(source, new RegExp(`label: "${group}"`));
    }
    assert.match(source, /"Navigation schließen" : "Navigation öffnen"/);
    assert.match(source, /aria-current=\{active \? "page" : undefined\}/);
    assert.match(source, /Market Intelligence/);
  });

  it("uses the requested German priority language", async () => {
    // Die Stufen liegen jetzt zentral in lib/severity.ts, damit Command Center und
    // Weltlage dieselbe Meldung nicht unterschiedlich benennen können.
    // Vollständig geprüft in test/severity.test.ts.
    const source = await readFile(resolve(appDir, "src/lib/severity.ts"), "utf8");

    assert.match(source, /label: "Sofort ansehen"/);
    assert.match(source, /label: "Wichtig"/);
    assert.match(source, /label: "Beobachten"/);
    assert.match(source, /label: "Information"/);
  });

  it("separates the market radar into human-readable lanes", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/radar-compact.tsx"),
      "utf8"
    );

    assert.match(source, /label="Krypto"/);
    assert.match(source, /label="Aktien & ETFs"/);
    assert.match(source, /label="Chartmuster"/);
    assert.match(source, /RadarOverviewCard/);
  });
});

describe("dashboard comprehension and responsive states", () => {
  it("explains scores and market regimes instead of exposing raw codes", async () => {
    const source = await readFile(resolve(appDir, "src/components/badges.tsx"), "utf8");

    assert.match(source, /RISK_ON: "Konstruktives Umfeld"/);
    assert.match(source, /RISK_OFF: "Defensives Umfeld"/);
    assert.match(source, /value >= 70/);
    assert.match(source, /"hohe Relevanz"/);
    assert.match(source, /"gemischtes Bild"/);
  });

  it("provides explicit loading, empty and mobile presentation rules", async () => {
    const source = await readFile(resolve(appDir, "src/app/globals.css"), "utf8");
    const loading = await readFile(
      resolve(appDir, "src/app/dashboard/scanner/loading.tsx"),
      "utf8"
    );
    const news = await readFile(resolve(appDir, "src/app/dashboard/news/page.tsx"), "utf8");

    assert.match(source, /@media \(max-width: 390px\)/);
    assert.match(source, /\.skeleton/);
    assert.match(loading, /Beobachtungen werden nach Relevanz geordnet/);
    // Die Weltlage-Seite unterscheidet jetzt zwei Leerzustände: keine Ereignisse im
    // Zeitraum und keine Treffer für die gesetzten Filter. Der Zeitraum kommt aus
    // `lastPeriodPhrase`, damit "in den letzten 7 Tagen" grammatisch stimmt —
    // siehe test/format.test.ts.
    assert.match(news, /Keine erkannten Ereignisse \$\{rangePhrase\}/);
    assert.match(news, /Keine Meldung passt zu diesen Filtern/);
  });

  it("keeps data-driven signal types while presenting readable labels", async () => {
    // Die Zuordnung lag früher lokal in signal-card.tsx und war dort dupliziert.
    // Sie liegt jetzt zentral in lib/labels.ts — inhaltlich geprüft in labels.test.ts.
    const labels = await readFile(resolve(appDir, "src/lib/labels.ts"), "utf8");
    const card = await readFile(resolve(appDir, "src/components/signal-card.tsx"), "utf8");

    assert.match(labels, /MOMENTUM_ALERT: "/);
    assert.match(labels, /NO_SIGNAL: "/);
    assert.match(card, /signalTypeLabel\(signal\.signalType\)/);
    // Keine lokale Zweitzuordnung mehr.
    assert.doesNotMatch(card, /function signalTypeLabel/);
  });

  it("shows relevant news with explicit empty, error, and stale states on the overview", async () => {
    const source = await readFile(resolve(appDir, "src/app/dashboard/page.tsx"), "utf8");

    assert.match(source, /Relevante Nachrichten/);
    assert.match(source, /Keine ausreichend relevante aktuelle Meldung/);
    // Der Fehlerzustand wird nicht mehr über einen festen Titel gerendert, sondern über
    // describeApiError — dadurch nennt er die Ursache (nicht erreichbar / Serverfehler)
    // statt einer pauschalen Meldung. Siehe test/discovery-status.test.ts.
    assert.match(source, /relevantNews\.error \?/);
    assert.match(source, /newsErrorCopy\.title/);
    assert.match(source, /älter als 24 h/);
    assert.match(source, /minRelevance=30&maxAgeHours=72&limit=5/);
  });

  it("does not introduce a Telegram dispatch path for overview news", async () => {
    const source = await readFile(resolve(appDir, "src/app/dashboard/page.tsx"), "utf8");

    assert.doesNotMatch(source, /sendSignalAlert|sendMarketEventAlert|N8N_WEBHOOK/);
    assert.match(source, /keine Sofortmeldungen per Telegram/);
  });

  it("explains discovery decisions and labels dry-run safety", async () => {
    const source = await readFile(
      resolve(appDir, "src/app/dashboard/discovery/page.tsx"),
      "utf8"
    );

    assert.match(source, /Score erklären/);
    assert.match(source, /Datenqualität/);
    assert.match(source, /Liquidität/);
    assert.match(source, /Vorgeschlagene Aufnahmen/);
    assert.match(source, /Dry-Run: Vorschläge ohne produktive Änderungen/);
    assert.match(source, /Discovery\s+erzeugt keine Telegram-Sofortmeldungen/);
  });
});
