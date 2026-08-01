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
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/shared.ts"),
      "utf8"
    );

    assert.match(source, /return "Sofort ansehen"/);
    assert.match(source, /return "Wichtig"/);
    assert.match(source, /return "Beobachten"/);
    assert.match(source, /return "Information"/);
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
    assert.match(news, /Keine passenden Nachrichten gefunden/);
  });

  it("keeps data-driven signal types while presenting readable labels", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/signal-card.tsx"),
      "utf8"
    );

    assert.match(source, /MOMENTUM_ALERT: "Momentum"/);
    assert.match(source, /NO_SIGNAL: "Keine besondere Auffälligkeit"/);
    assert.match(source, /signalTypeLabel\(signal\.signalType\)/);
  });

  it("shows relevant news with explicit empty, error, and stale states on the overview", async () => {
    const source = await readFile(resolve(appDir, "src/app/dashboard/page.tsx"), "utf8");

    assert.match(source, /Relevante Nachrichten/);
    assert.match(source, /Keine ausreichend relevante aktuelle Meldung/);
    assert.match(source, /Nachrichten derzeit nicht verfügbar/);
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
