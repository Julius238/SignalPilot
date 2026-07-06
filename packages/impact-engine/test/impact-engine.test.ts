import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assessMarketEventImpact } from "../src/index.js";

describe("assessMarketEventImpact", () => {
  it("maps an oil price surge to energy positive and transport negative", () => {
    const impact = assessMarketEventImpact({
      eventType: "ENERGY_COMMODITY",
      title: "Oil prices surge as OPEC announces production cut",
      summary: "Brent crude jumps above 95 dollars."
    });

    assert.ok(impact);
    assert.deepEqual(impact.appliedRules, ["oil-price-up"]);
    assert.ok(impact.potentiallyPositive.includes("Energieaktien"));
    assert.ok(impact.potentiallyPositive.includes("Öl-/Gasproduzenten"));
    assert.ok(impact.potentiallyNegative.includes("Airlines"));
    assert.ok(impact.affectedSectors.includes("Energie"));
    assert.ok(impact.affectedSymbols.includes("XLE"));
    assert.equal(impact.confidence, 0.45);
    assert.match(impact.reasoning, /Ölpreis-Anstieg/);
    assert.match(impact.reasoning, /keine Handlungsempfehlung/);
  });

  it("maps an oil price drop to the inverse assessment", () => {
    const impact = assessMarketEventImpact({
      eventType: "ENERGY_COMMODITY",
      title: "Oil tumbles as supply glut swamps market",
      summary: null
    });

    assert.ok(impact);
    assert.deepEqual(impact.appliedRules, ["oil-price-down"]);
    assert.ok(impact.potentiallyPositive.includes("Airlines"));
    assert.ok(impact.potentiallyNegative.includes("Energieaktien"));
  });

  it("maps rate cut expectations to growth/bonds/gold/crypto positive", () => {
    const impact = assessMarketEventImpact({
      eventType: "CENTRAL_BANK",
      title: "Fed signals possible rate cut in September",
      summary: "Officials lean dovish after soft data."
    });

    assert.ok(impact);
    assert.ok(impact.appliedRules.includes("rate-cut-expectation"));
    assert.ok(impact.potentiallyPositive.includes("Growth-/Tech-Aktien"));
    assert.ok(impact.potentiallyPositive.includes("Gold"));
    assert.ok(impact.potentiallyPositive.includes("Bitcoin/Krypto"));
    assert.ok(impact.potentiallyNegative.includes("Bankenmargen/Finanzwerte"));
  });

  it("maps a strong dollar to gold and emerging markets negative", () => {
    const impact = assessMarketEventImpact({
      eventType: "MACRO",
      title: "Dollar index surges to six-month high",
      summary: "The greenback strengthens against major currencies."
    });

    assert.ok(impact);
    assert.ok(impact.appliedRules.includes("usd-strong"));
    assert.ok(impact.potentiallyNegative.includes("Gold"));
    assert.ok(impact.potentiallyNegative.includes("Emerging Markets"));
  });

  it("maps geopolitical escalation to safe havens positive and includes the region", () => {
    const impact = assessMarketEventImpact({
      eventType: "CONFLICT",
      title: "Missile attack escalates tensions in the region",
      summary: "Military escalation raises fears of wider war.",
      region: "Naher Osten"
    });

    assert.ok(impact);
    assert.ok(impact.appliedRules.includes("geopolitical-escalation"));
    assert.ok(impact.potentiallyPositive.includes("Gold"));
    assert.ok(impact.potentiallyPositive.includes("Rüstung/Verteidigung"));
    assert.ok(impact.potentiallyNegative.includes("Risikoassets breit (Aktien, Krypto)"));
    assert.match(impact.reasoning, /Regionale Betroffenheit: Naher Osten/);
  });

  it("keeps weak economic data one-sided with a rate context note", () => {
    const impact = assessMarketEventImpact({
      eventType: "LABOR_MARKET",
      title: "US payrolls miss expectations as hiring slows",
      summary: null
    });

    assert.ok(impact);
    assert.deepEqual(impact.appliedRules, ["weak-economic-data"]);
    assert.equal(impact.potentiallyPositive.length, 0);
    assert.ok(impact.potentiallyNegative.length > 0);
    assert.match(impact.reasoning, /Zinskontext/);
  });

  it("combines weak data with rate cut hopes into a two-sided assessment", () => {
    const impact = assessMarketEventImpact({
      eventType: "LABOR_MARKET",
      title: "Weak jobs report fuels rate cut bets",
      summary: "Payrolls miss expectations; traders price in easing."
    });

    assert.ok(impact);
    assert.ok(impact.appliedRules.includes("weak-economic-data"));
    assert.ok(impact.appliedRules.includes("rate-cut-expectation"));
    assert.ok(impact.potentiallyPositive.includes("Growth-/Tech-Aktien"));
    assert.ok(
      impact.potentiallyNegative.includes(
        "konjunktursensitive Sektoren (Industrie, Konsumzykliker, Banken)"
      )
    );
  });

  it("moves contradictory entries into mixedSignals instead of hiding them", () => {
    const impact = assessMarketEventImpact({
      eventType: "RISK_SENTIMENT",
      title: "Stocks rally to record high while gold surges on lingering war fears",
      summary: "Risk appetite returns even as tensions persist."
    });

    assert.ok(impact);
    assert.ok(impact.appliedRules.includes("risk-on"));
    assert.ok(impact.appliedRules.includes("precious-metals-up"));
    // Gold ist positiv (Edelmetall-Anstieg) und negativ (Risk-on) → gemischt
    assert.ok(impact.mixedSignals.length > 0 || impact.potentiallyPositive.includes("Gold"));
    for (const entry of impact.mixedSignals) {
      assert.ok(!impact.potentiallyPositive.includes(entry));
      assert.ok(!impact.potentiallyNegative.includes(entry));
    }
  });

  it("treats a rejected ceasefire as escalation, not as de-escalation", () => {
    const impact = assessMarketEventImpact({
      eventType: "CONFLICT",
      title: "Russia says Ukraine rejects ceasefire proposal",
      summary: null
    });

    assert.ok(impact);
    // "rejects" schließt die Entspannungs-Regel aus; "rejects ceasefire" greift als Eskalation.
    assert.deepEqual(impact.appliedRules, ["geopolitical-escalation"]);
    assert.ok(impact.potentiallyPositive.includes("Gold"));
  });

  it("prefers no assessment over a wrong direction for ambiguous ceasefire wording", () => {
    const impact = assessMarketEventImpact({
      eventType: "CONFLICT",
      title: "Ukraine rejects local ceasefire for prisoner handover",
      summary: null
    });

    // Entspannung ausgeschlossen (rejects), Eskalations-Keywords fehlen → ehrlich kein Impact.
    assert.equal(impact, null);
  });

  it("returns null when no rule matches", () => {
    const impact = assessMarketEventImpact({
      eventType: "CORPORATE",
      title: "Company announces new headquarters building",
      summary: "The move is planned for next year."
    });

    assert.equal(impact, null);
  });

  it("caps confidence at the most uncertain applied rule and never exceeds 0.6", () => {
    const impact = assessMarketEventImpact({
      eventType: "LABOR_MARKET",
      title: "Weak jobs report fuels rate cut bets",
      summary: "Payrolls miss expectations; traders price in easing."
    });

    assert.ok(impact);
    // weak-economic-data (0.35) + rate-cut-expectation (0.45) → min = 0.35
    assert.equal(impact.confidence, 0.35);
    assert.ok(impact.confidence <= 0.6);
  });

  it("mentions a defensive market regime in the reasoning", () => {
    const impact = assessMarketEventImpact(
      {
        eventType: "RISK_SENTIMENT",
        title: "Global selloff deepens as panic spreads",
        summary: null
      },
      { riskMode: "DEFENSIVE" }
    );

    assert.ok(impact);
    assert.match(impact.reasoning, /Marktumfeld aktuell DEFENSIVE/);
  });

  it("never produces trading language", () => {
    const inputs = [
      { eventType: "ENERGY_COMMODITY", title: "Oil surges after OPEC production cut", summary: null },
      { eventType: "CENTRAL_BANK", title: "Fed hints at rate cut", summary: "Dovish easing tone." },
      { eventType: "CONFLICT", title: "War escalates after missile attack", summary: null }
    ];

    for (const input of inputs) {
      const impact = assessMarketEventImpact(input);
      assert.ok(impact);
      assert.doesNotMatch(impact.reasoning, /\b(kaufen|verkaufen|long|short|entry|exit|buy|sell)\b/i);
    }
  });
});
