import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatDate,
  formatDateTime,
  lastPeriodPhrase,
  pluralWord,
  pluralize
} from "../src/lib/format";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("vierstelliges Jahr", () => {
  it("schreibt das Jahr aus", () => {
    // Vorher lieferte dateStyle: "short" das mehrdeutige "06.08.26".
    assert.match(formatDateTime("2026-08-06T14:41:00.000Z"), /06\.08\.2026/);
    assert.match(formatDate("2026-08-06T14:41:00.000Z"), /^06\.08\.2026$/);
    assert.doesNotMatch(formatDateTime("2026-08-06T14:41:00.000Z"), /\b\d{2}\.\d{2}\.\d{2}\b(?!\d)/);
  });

  it("behält Datum und Uhrzeit zusammen", () => {
    const formatted = formatDateTime("2026-05-24T15:13:00.000Z");
    assert.match(formatted, /24\.05\.2026/);
    assert.match(formatted, /\d{2}:\d{2}/);
  });

  it("gibt für fehlende und ungültige Werte einen Strich zurück", () => {
    assert.equal(formatDateTime(null), "-");
    assert.equal(formatDateTime(undefined), "-");
    assert.equal(formatDateTime(""), "-");
    assert.equal(formatDateTime("kein-datum"), "-");
    assert.equal(formatDate("kein-datum"), "-");
  });

  it("nutzt nirgendwo mehr dateStyle: short", async () => {
    const source = await readFile(resolve(appDir, "src/lib/format.ts"), "utf8");
    assert.doesNotMatch(source, /dateStyle:\s*"short"/);
    assert.match(source, /year:\s*"numeric"/);
  });
});

describe("Singular und Plural", () => {
  it("bildet Ein- und Mehrzahl korrekt", () => {
    assert.equal(pluralize(1, "Ereignis", "Ereignisse"), "1 Ereignis");
    assert.equal(pluralize(2, "Ereignis", "Ereignisse"), "2 Ereignisse");
    assert.equal(pluralize(0, "Ereignis", "Ereignisse"), "0 Ereignisse");
    assert.equal(pluralize(1, "Meldung", "Meldungen"), "1 Meldung");
    assert.equal(pluralize(25, "Meldung", "Meldungen"), "25 Meldungen");
    assert.equal(pluralize(1, "Asset", "Assets"), "1 Asset");
  });

  it("liefert auf Wunsch nur das Wort", () => {
    assert.equal(pluralWord(1, "Meldung", "Meldungen"), "Meldung");
    assert.equal(pluralWord(3, "Meldung", "Meldungen"), "Meldungen");
  });

  it("setzt Zeiträume in den Dativ", () => {
    // "in den letzten 7 Tage" war der sichtbare Fehler.
    assert.equal(lastPeriodPhrase(168), "in den letzten 7 Tagen");
    assert.equal(lastPeriodPhrase(720), "in den letzten 30 Tagen");
    assert.equal(lastPeriodPhrase(24), "in den letzten 24 Stunden");
    assert.equal(lastPeriodPhrase(48), "in den letzten 48 Stunden");
    assert.equal(lastPeriodPhrase(1), "in der letzten Stunde");
    assert.equal(lastPeriodPhrase(72), "in den letzten 3 Tagen");
    // Bis 48 h bleibt es bei Stunden — so heißen die Filteroptionen der Seite.
    assert.equal(lastPeriodPhrase(48), "in den letzten 48 Stunden");
  });
});

describe("Numerus auf den Seiten", () => {
  it("baut die Weltlage-Aussagen über die zentralen Helfer", async () => {
    const source = await readFile(resolve(appDir, "src/app/dashboard/news/page.tsx"), "utf8");

    // Kein "1 Ereignisse erkannt" und kein "in den letzten 7 Tage" mehr.
    assert.doesNotMatch(source, /\$\{events\.length\} Ereignisse erkannt/);
    assert.doesNotMatch(source, /in den letzten \$\{rangeLabel\}/);
    assert.match(source, /lastPeriodPhrase\(Number\(range\)\)/);
    assert.match(source, /pluralize\(/);
    assert.doesNotMatch(source, /\? "Meldung" : "Meldungen"/);
  });

  it("nutzt sie auch in der Karten- und Listenansicht", async () => {
    const source = await readFile(
      resolve(appDir, "src/components/dashboard/world-map-explorer.tsx"),
      "utf8"
    );

    assert.match(source, /pluralize\(visibleEvents\.length, "Meldung", "Meldungen"\)/);
    assert.doesNotMatch(source, /\? "Meldung" : "Meldungen"/);
  });
});

describe("Trenner zwischen Bezeichner und Zeitstempel", () => {
  it("trennt Jobname und Startzeit im Systemstatus", async () => {
    const source = await readFile(
      resolve(appDir, "src/app/dashboard/operations/page.tsx"),
      "utf8"
    );

    // Vorher: "Ereignis-Monitor06.08.2026, 13:29"
    assert.match(source, /<span className="muted small"> · \{formatDateTime\(run\.startedAt\)\}/);
  });
});
