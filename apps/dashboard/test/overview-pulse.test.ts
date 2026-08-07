import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildPulse } from "../src/lib/overview-pulse";
import type { DataStatus } from "../src/lib/data-status";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CALM_CLAIMS = [
  "Ruhige Lage",
  "nichts Dringendes",
  "Das Markt-Radar ist ruhig"
];

function pulseWith(overrides: {
  eventsStatus: DataStatus;
  radarStatus: DataStatus;
  criticalCount?: number;
  notableCount?: number;
  radarCount?: number;
}) {
  return buildPulse({
    criticalCount: overrides.criticalCount ?? 0,
    notableCount: overrides.notableCount ?? 0,
    radarCount: overrides.radarCount ?? 0,
    topCluster: null,
    topRegion: null,
    regime: null,
    eventsStatus: overrides.eventsStatus,
    radarStatus: overrides.radarStatus
  });
}

describe("Lagebild bei API-Ausfall", () => {
  it("behauptet keine ruhige Lage, wenn beide Quellen ausgefallen sind", () => {
    const { pulse, context } = pulseWith({
      eventsStatus: "unreachable",
      radarStatus: "unreachable"
    });

    for (const claim of CALM_CLAIMS) {
      assert.ok(!pulse.includes(claim), `Puls behauptet "${claim}": ${pulse}`);
      assert.ok(!String(context).includes(claim), `Kontext behauptet "${claim}": ${context}`);
    }
    assert.match(pulse, /nicht beurteilbar/);
    assert.match(String(context), /nicht abgerufen werden/);
  });

  it("sagt bei ausgefallenem Weltgeschehen nicht, dass nichts los ist", () => {
    const { pulse, context } = pulseWith({
      eventsStatus: "server-error",
      radarStatus: "empty"
    });

    assert.ok(!pulse.includes("Ruhige Lage"));
    assert.match(pulse, /nur teilweise beurteilbar/);
    assert.match(String(context), /Weltgeschehen ist derzeit nicht abrufbar/);
  });

  it("sagt bei ausgefallenem Radar nicht, dass das Radar ruhig ist", () => {
    const { pulse, context } = pulseWith({
      eventsStatus: "empty",
      radarStatus: "unreachable"
    });

    assert.ok(!String(context).includes("Das Markt-Radar ist ruhig"));
    assert.match(String(context), /Markt-Radar ist derzeit nicht abrufbar/);
    assert.ok(!pulse.includes("Ruhige Lage"));
  });

  it("verhält sich bei einer abgelaufenen Sitzung genauso", () => {
    const { pulse } = pulseWith({
      eventsStatus: "unauthorized",
      radarStatus: "unauthorized"
    });

    assert.match(pulse, /nicht beurteilbar/);
  });
});

describe("Lagebild bei echten Daten", () => {
  it("darf ruhige Lage sagen, wenn beide Quellen erreichbar und leer sind", () => {
    const { pulse, context } = pulseWith({ eventsStatus: "empty", radarStatus: "empty" });

    assert.equal(pulse, "Ruhige Lage — aktuell nichts Dringendes.");
    assert.match(String(context), /Das Markt-Radar ist ruhig/);
  });

  it("meldet kritische Ereignisse mit korrektem Numerus", () => {
    assert.match(
      pulseWith({ eventsStatus: "available", radarStatus: "empty", criticalCount: 1 }).pulse,
      /1 sehr wichtiges Ereignis/
    );
    assert.match(
      pulseWith({ eventsStatus: "available", radarStatus: "empty", criticalCount: 3 }).pulse,
      /3 sehr wichtige Ereignisse/
    );
  });

  it("weist auf veraltete Ereignisdaten hin, statt sie als aktuell auszugeben", () => {
    const { context } = pulseWith({ eventsStatus: "stale", radarStatus: "empty" });

    assert.match(String(context), /außerhalb des Zeitfensters/);
  });
});

describe("Übersichtsseite: Fehler werden nie in Leere übersetzt", () => {
  it("rendert jede datengetriebene Sektion hinter einer Fehlerprüfung", async () => {
    const source = await readFile(resolve(appDir, "src/app/dashboard/page.tsx"), "utf8");

    // Weltkarte, Impact-Sektion, Radar, Signale und Watchlist haben bei
    // gestoppter API zuvor "keine Ereignisse" bzw. "0 Assets" behauptet.
    assert.match(source, /isErrorStatus\(eventsStatus\) && eventsErrorCopy/);
    assert.match(source, /status=\{radarStatus\}/);
    assert.match(source, /signalsStatus=\{signalsStatus\}/);
    assert.match(source, /watchlistStatus=\{watchlistStatus\}/);
    // Kennzahlen laufen ausnahmslos über metricValue/formatMetric.
    assert.match(source, /formatMetric\(importantMetric\)/);
    assert.match(source, /formatMetric\(radarMetric\)/);
    assert.match(source, /formatMetric\(activeSignalsMetric\)/);
    assert.match(source, /formatMetric\(alertsMetric\)/);
  });

  it("zeigt das Datenalter der beiden wichtigsten Quellen", async () => {
    const source = await readFile(resolve(appDir, "src/app/dashboard/page.tsx"), "utf8");

    assert.match(source, /<DataFreshness/);
    assert.match(source, /label="Weltgeschehen"/);
    assert.match(source, /label="Signale"/);
  });

  it("meldet fehlende Watchlist-Daten statt 0 Assets", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/radar-compact.tsx"),
      "utf8"
    );

    assert.match(source, /isErrorStatus\(watchlistStatus\)/);
    assert.match(source, /Persönlicher Fokus: derzeit nicht abrufbar/);
  });

  it("ersetzt 'Gerade ist nichts dringend' bei Fehlern durch eine Fehlermeldung", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/priority-feed.tsx"),
      "utf8"
    );

    assert.match(source, /isErrorStatus\(status\) && errorCopy/);
    // Der Leerzustandstext bleibt — aber nur im Zweig hinter der Fehlerprüfung.
    const errorBranch = source.indexOf("{isErrorStatus(status) && errorCopy ? (");
    // Der gerenderte Text, nicht die Erwähnung im Kommentar darüber.
    const calmText = source.indexOf('title="Gerade ist nichts dringend."');
    assert.ok(errorBranch > -1, "Fehlerzweig fehlt");
    assert.ok(calmText > errorBranch, "Leerzustand steht vor der Fehlerprüfung");
  });
});
