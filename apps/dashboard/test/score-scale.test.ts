import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  NEWS_HIGH_RELEVANCE,
  SCORE_SCALE_MAX,
  scoreBarColor,
  scoreBarMeaning,
  scoreBarPercent
} from "../src/lib/score-scale";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Regression: Die Faktor-Balken rechneten mit `(wert / 10) * 100` und färbten ab 7 grün.
// Die Scores von packages/scoring-engine liegen aber auf 0–100 — dadurch war jeder Balken
// zu 100 % gefüllt und grün, auch ein hoher Risiko-Score.

describe("score scale", () => {
  it("uses a 0-100 scale", () => {
    assert.equal(SCORE_SCALE_MAX, 100);
  });

  it("fills the bar proportionally to the 0-100 value", () => {
    assert.equal(scoreBarPercent(0), 0);
    assert.equal(scoreBarPercent(47), 47);
    assert.equal(scoreBarPercent(100), 100);
    assert.equal(scoreBarPercent(25), 25);
    assert.equal(scoreBarPercent(68), 68);
  });

  it("does not render every value as a full bar", () => {
    // Genau der Kern des Bugs: 25 und 68 sahen vorher beide wie 100 % aus.
    assert.notEqual(scoreBarPercent(25), scoreBarPercent(68));
    assert.ok(scoreBarPercent(25) < scoreBarPercent(68));
    assert.ok(scoreBarPercent(99) < 100);
  });

  it("clamps out-of-range and non-numeric values instead of overflowing", () => {
    assert.equal(scoreBarPercent(-10), 0);
    assert.equal(scoreBarPercent(140), 100);
    assert.equal(scoreBarPercent(null), 0);
    assert.equal(scoreBarPercent(undefined), 0);
    assert.equal(scoreBarPercent(Number.NaN), 0);
  });

  it("colours benefit factors by strength on the 0-100 scale", () => {
    assert.equal(scoreBarColor(0, "benefit"), "var(--bad)");
    assert.equal(scoreBarColor(25, "benefit"), "var(--bad)");
    assert.equal(scoreBarColor(47, "benefit"), "var(--accent)");
    assert.equal(scoreBarColor(100, "benefit"), "var(--good)");
  });

  it("never makes a high risk score look positive", () => {
    // Vorher: Risiko 47 → "var(--good)". Risiko ist invertiert zu lesen.
    assert.equal(scoreBarColor(47, "risk"), "var(--warn)");
    assert.equal(scoreBarColor(100, "risk"), "var(--bad)");
    assert.equal(scoreBarColor(85, "risk"), "var(--bad)");
    assert.equal(scoreBarColor(0, "risk"), "var(--good)");

    assert.notEqual(scoreBarColor(100, "risk"), scoreBarColor(100, "benefit"));
    assert.notEqual(scoreBarColor(0, "risk"), scoreBarColor(0, "benefit"));
  });

  it("mirrors the risk thresholds of packages/scoring-engine", () => {
    // determineRiskLevel: HIGH ab 70, MEDIUM ab 45, sonst LOW.
    assert.equal(scoreBarMeaning(70, "risk"), "hohes Risiko");
    assert.equal(scoreBarMeaning(69, "risk"), "mittleres Risiko");
    assert.equal(scoreBarMeaning(45, "risk"), "mittleres Risiko");
    assert.equal(scoreBarMeaning(44, "risk"), "niedriges Risiko");
  });

  it("states the meaning in words, not only in colour", () => {
    assert.equal(scoreBarMeaning(0, "benefit"), "schwach");
    assert.equal(scoreBarMeaning(47, "benefit"), "mittel");
    assert.equal(scoreBarMeaning(100, "benefit"), "stark");
    assert.equal(scoreBarMeaning(47, "risk"), "mittleres Risiko");
    assert.equal(scoreBarMeaning(null, "benefit"), "nicht berechenbar");
    assert.equal(scoreBarColor(null, "benefit"), "var(--line)");
  });

  it("treats news relevance on the same 0-100 scale as news-intelligence", () => {
    // Vorher lag die Schwelle bei 7 — praktisch jede Meldung galt als "hoch".
    assert.equal(NEWS_HIGH_RELEVANCE, 70);
    assert.ok(NEWS_HIGH_RELEVANCE > 10);
  });
});

describe("score rendering in the UI", () => {
  it("shows the scale next to the value and labels the risk direction", async () => {
    const source = await readFile(
      resolve(appDir, "src/app/dashboard/signals/[id]/page.tsx"),
      "utf8"
    );

    assert.match(source, /score-bar-scale/);
    assert.match(source, /scoreBarPercent\(numVal\)/);
    assert.match(source, /scoreBarColor\(numVal, polarity\)/);
    assert.match(source, /polarity: "risk"/);
    assert.match(source, /Bei „Risiko“ ist ein hoher Wert ungünstig/);
    // Der alte 0–10-Divisor darf nicht zurückkommen.
    assert.doesNotMatch(source, /\/ 10\) \* 100/);
  });

  it("keeps no 0-10 assumption in the signal card news level", async () => {
    const source = await readFile(resolve(appDir, "src/components/signal-card.tsx"), "utf8");

    assert.match(source, /NEWS_HIGH_RELEVANCE/);
    assert.doesNotMatch(source, /relevanceScore \?\? 0\) >= 7\b/);
  });
});
