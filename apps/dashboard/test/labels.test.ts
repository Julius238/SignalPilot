import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  alignmentExplanation,
  assetTypeLabel,
  auditActionLabel,
  auditActionTone,
  germanizeAnalysisText,
  germanizeDataQualityText,
  logLevelLabel,
  logLevelTone,
  repairAsciiUmlauts,
  signalTypeExplanation,
  signalTypeLabel,
  timeframeLabel,
  universeRoleLabel,
  universeSourceLabel
} from "../src/lib/labels";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("enum labels", () => {
  it("never leaves a raw enum in the UI", () => {
    for (const value of [
      "NO_SIGNAL",
      "MOMENTUM_ALERT",
      "TREND_ALERT",
      "VOLUME_SPIKE",
      "VOLATILITY_SPIKE",
      "BREAKOUT_ALERT",
      "NEWS_REACTION",
      "EVENT_IMPACT"
    ]) {
      const label = signalTypeLabel(value);
      assert.notEqual(label, value);
      assert.doesNotMatch(label, /_/);
    }

    assert.equal(assetTypeLabel("CRYPTO"), "Krypto");
    assert.equal(assetTypeLabel("STOCK"), "Aktie");
    assert.equal(universeRoleLabel("CORE"), "Kernbestand");
    assert.equal(universeSourceLabel("AUTO_DISCOVERED"), "Automatisch gefunden");
    assert.equal(timeframeLabel("1d"), "1 Tag");
    assert.equal(logLevelLabel("ERROR"), "Fehler");
  });

  it("falls back to the original value instead of hiding unknown data", () => {
    assert.equal(signalTypeLabel("BRAND_NEW_TYPE"), "BRAND_NEW_TYPE");
    assert.equal(assetTypeLabel("COMMODITY"), "COMMODITY");
    assert.equal(timeframeLabel("15m"), "15m");
    assert.equal(signalTypeLabel(null), "—");
  });

  it("explains what a signal type and an alignment mean", () => {
    assert.match(signalTypeExplanation("NO_SIGNAL") ?? "", /normaler Zustand/);
    assert.match(alignmentExplanation("CONFLICT") ?? "", /widersprechen/);
    assert.equal(signalTypeExplanation("UNKNOWN_TYPE"), null);
  });

  it("separates error, warning, success and neutral in the audit log", () => {
    assert.equal(auditActionLabel("login_failed"), "Anmeldung fehlgeschlagen");
    assert.equal(auditActionTone("login_failed"), "error");
    assert.equal(auditActionTone("login_success"), "success");
    assert.equal(auditActionTone("dev_login"), "warn");
    assert.equal(auditActionTone("trading_engage_kill_switch"), "error");
    assert.equal(auditActionTone("trading_release_kill_switch"), "neutral");

    assert.equal(logLevelTone("ERROR"), "error");
    assert.equal(logLevelTone("WARN"), "warn");
    assert.equal(logLevelTone("INFO"), "info");
    assert.equal(logLevelTone("TRACE"), "neutral");
  });

  it("keeps unknown audit actions readable without inventing a meaning", () => {
    assert.equal(auditActionLabel("some_new_action"), "some new action");
  });
});

describe("engine text germanization", () => {
  it("translates the English sentences that reach the UI from scoring-engine", () => {
    assert.equal(
      germanizeAnalysisText("Wait for clearer trend, momentum, or volume confirmation."),
      "Abwarten, bis Trend, Tempo oder Handelsvolumen ein klareres Bild ergeben."
    );
    assert.equal(
      germanizeAnalysisText("Price is not close enough to the period high or low."),
      "Der Kurs ist weder nahe am Hoch noch am Tief der betrachteten Spanne."
    );
    assert.match(
      germanizeAnalysisText("RSI above 75 is overheated and increases pullback risk.") ?? "",
      /überhitzt/
    );
  });

  it("leaves unmapped text untouched instead of guessing", () => {
    const unknown = "Some sentence the engine has never produced.";
    assert.equal(germanizeAnalysisText(unknown), unknown);
    assert.equal(germanizeAnalysisText(null), null);
  });

  it("repairs ASCII umlauts from multi-timeframe", () => {
    const repaired = repairAsciiUmlauts(
      "4h ist der fuehrende Timeframe. Bestaetigung kommt von 1h."
    );
    assert.match(repaired, /führende Zeitebene/);
    assert.match(repaired, /Bestätigung/);
    assert.doesNotMatch(repaired, /fuehrend|bestaetig|Timeframe/);
  });

  it("keeps the article correct when Timeframe becomes Zeitebene", () => {
    // "der fuehrende Timeframe" (m.) → "die führende Zeitebene" (f.)
    assert.match(
      repairAsciiUmlauts("1d ist der fuehrende Timeframe"),
      /die führende Zeitebene/
    );
    assert.doesNotMatch(
      repairAsciiUmlauts("1d ist der fuehrende Timeframe"),
      /der führende Zeitebene/
    );
  });

  it("does not damage correct German — no blanket ae/oe/ue rule", () => {
    for (const safe of [
      "Neue Steuer auf Aktien in Europa",
      "Feuer, Abenteuer und neue Werte",
      "Die Auswertung der Aktien läuft"
    ]) {
      assert.equal(repairAsciiUmlauts(safe), safe);
    }
  });
});

describe("data quality text germanization", () => {
  it("translates the templated warnings", () => {
    assert.equal(
      germanizeDataQualityText("AAPL has insufficient 1h candle coverage."),
      "AAPL: zu wenige Kursdaten auf der Zeitebene 1h."
    );
    assert.equal(
      germanizeDataQualityText("ADAUSDT has no crypto signals in the last 24h."),
      "ADAUSDT: in den letzten 24 Stunden kein Krypto-Signal erzeugt."
    );
    assert.equal(
      germanizeDataQualityText("30 signals have no Paper Evaluation."),
      "30 Signale wurden noch nicht rückblickend ausgewertet."
    );
    assert.match(
      germanizeDataQualityText("FINNHUB has 4 HTTP 403 entitlement errors."),
      /Zugriff verweigert/
    );
  });

  it("turns CLI-style recommendations into user-facing sentences", () => {
    const rec = germanizeDataQualityText(
      "Backfill candles for low-coverage assets and timeframes."
    );
    assert.match(rec, /nachladen/);
    assert.doesNotMatch(rec, /Backfill|worker|Run the/i);

    assert.doesNotMatch(
      germanizeDataQualityText("Run the Paper Evaluation backfill worker."),
      /Run the|worker/i
    );
  });

  it("keeps unmapped warnings verbatim", () => {
    const unknown = "SOMETHING has an entirely new problem.";
    assert.equal(germanizeDataQualityText(unknown), unknown);
  });
});

describe("technical pages use the shared label layer", () => {
  const PAGES = [
    "src/app/dashboard/signals/[id]/page.tsx",
    "src/app/dashboard/multi-timeframe/page.tsx",
    "src/app/dashboard/data-quality/page.tsx",
    "src/app/dashboard/logs/page.tsx",
    "src/app/dashboard/audit-logs/page.tsx",
    "src/app/dashboard/performance/page.tsx",
    "src/app/dashboard/backtests/page.tsx",
    "src/app/dashboard/rules/page.tsx",
    "src/app/dashboard/discovery/page.tsx"
  ];

  it("starts every technical page with purpose, state and next step", async () => {
    for (const page of PAGES) {
      const source = await readFile(resolve(appDir, page), "utf8");
      assert.match(source, /<PageIntro/, `${page} braucht eine Seiteneinleitung`);
      assert.match(source, /purpose=/, `${page} braucht einen Zweck-Satz`);
      assert.match(source, /verdict=/, `${page} braucht eine Zustandsaussage`);
    }
  });

  it("renders no raw signal type enum anywhere", async () => {
    const files = [
      ...PAGES,
      "src/components/signal-card.tsx",
      "src/components/signals-table.tsx",
      "src/components/scanner-groups.tsx",
      "src/components/alert-states-table.tsx",
      "src/components/alerts-list.tsx",
      "src/app/dashboard/watchlist/page.tsx",
      "src/app/dashboard/assets/[symbol]/page.tsx"
    ];
    for (const file of files) {
      const source = await readFile(resolve(appDir, file), "utf8");
      // Ein Rohwert würde als {x.signalType} direkt gerendert.
      assert.doesNotMatch(
        source,
        /\{[a-zA-Z.]*\.signalType\}/,
        `${file} rendert signalType roh`
      );
    }
  });
});
