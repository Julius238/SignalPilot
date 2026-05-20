import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SignalDecision } from "@signalpilot/shared";
import type { MultiTimeframeSummary } from "@signalpilot/multi-timeframe";

import { composeSignalOutput } from "../src/index.js";

const baseDecision: SignalDecision = {
  symbol: "BTCUSDT",
  assetType: "crypto",
  timeframe: "4h",
  signalType: "MOMENTUM_ALERT",
  status: "WATCH",
  direction: "BULLISH",
  score: 72.4,
  riskLevel: "MEDIUM",
  trendScore: 82,
  momentumScore: 78,
  volumeScore: 68,
  volatilityScore: 55,
  rsiScore: 66,
  newsScore: 50,
  socialScore: 50,
  eventScore: 50,
  riskScore: 48,
  reasons: [
    "Price is above sma20 and sma20 is above sma50.",
    "Price is in the upper part of the 20-period range.",
    "Relative volume is above 1.5, showing strong participation."
  ],
  counterArguments: ["sma200 is missing, so long-term trend confirmation is unavailable."],
  nextTrigger: "Watch for price to hold above sma20 with relativeVolume above 1.5."
};

const baseMultiTimeframeSummary: MultiTimeframeSummary = {
  symbol: "BTCUSDT",
  alignment: "BULLISH_ALIGNED",
  alignmentScore: 78,
  primaryTimeframe: "1d",
  confirmingTimeframes: ["4h", "1h"],
  conflictingTimeframes: [],
  strongestSignal: null,
  weakestSignal: null,
  riskLevel: "MEDIUM",
  summary: "BTCUSDT: aligned.",
  riskNote: "Gesamt-Risiko ist MEDIUM.",
  nextFocus: "Als naechstes 4h beobachten."
};

describe("composeSignalOutput", () => {
  it("composes a bullish STRONG_WATCH signal", () => {
    const output = composeSignalOutput({
      decision: {
        ...baseDecision,
        status: "STRONG_WATCH",
        score: 84.2,
        riskLevel: "LOW",
        signalType: "BREAKOUT_ALERT"
      }
    });

    assert.match(output.shortConclusion, /starkes bullish Setup/i);
    assert.match(output.telegramText, /🚀 BTCUSDT · CRYPTO · 4h/);
    assert.equal(output.marketConfirmationJson.signalType, "BREAKOUT_ALERT");
  });

  it("composes a WATCH signal", () => {
    const output = composeSignalOutput({ decision: baseDecision });

    assert.match(output.shortConclusion, /beobachtenswert/i);
    assert.match(output.telegramText, /Status: WATCH/);
    assert.match(output.telegramText, /Richtung: BULLISH/);
  });

  it("composes an AVOID bearish signal", () => {
    const output = composeSignalOutput({
      decision: {
        ...baseDecision,
        signalType: "NO_SIGNAL",
        status: "AVOID",
        direction: "BEARISH",
        score: 32,
        riskLevel: "HIGH",
        trendScore: 20,
        momentumScore: 25,
        volumeScore: 35,
        rsiScore: 30,
        riskScore: 78
      }
    });

    assert.match(output.shortConclusion, /zu schwach oder zu riskant/i);
    assert.match(output.telegramText, /Risiko: HIGH/);
    assert.match(output.telegramText, /▫️ BTCUSDT/);
  });

  it("composes a NO_EDGE signal", () => {
    const output = composeSignalOutput({
      decision: {
        ...baseDecision,
        signalType: "NO_SIGNAL",
        status: "NO_EDGE",
        direction: "NEUTRAL",
        score: 44,
        riskLevel: "LOW"
      }
    });

    assert.match(output.shortConclusion, /keinen belastbaren technischen Edge/i);
    assert.match(output.telegramText, /Status: NO_EDGE/);
  });

  it("uses the required fallback when news is missing", () => {
    const output = composeSignalOutput({ decision: baseDecision });

    assert.equal(
      output.intelligenceJson.newsSummary,
      "Keine relevante neue Meldung im Scan-Fenster gefunden."
    );
    assert.match(output.telegramText, /News: Keine relevante neue Meldung im Scan-Fenster gefunden\./);
  });

  it("states that social is not connected", () => {
    const output = composeSignalOutput({
      decision: baseDecision,
      intelligence: {
        newsSummary: "ETF flows are stable.",
        sources: ["internal-test"]
      }
    });

    assert.equal(output.intelligenceJson.socialSummary, "noch nicht aktiv verbunden.");
    assert.match(output.telegramText, /X\/Social: noch nicht aktiv verbunden\./);
  });

  it("keeps high risk language direct", () => {
    const output = composeSignalOutput({
      decision: {
        ...baseDecision,
        signalType: "VOLATILITY_SPIKE",
        riskLevel: "HIGH",
        riskScore: 86,
        volatilityScore: 82,
        rsiScore: 84
      }
    });

    assert.match(output.telegramText, /Risiko: HIGH/);
    assert.match(output.telegramText, /RSI stark, aber überhitztes Risiko/);
  });

  it("telegram text contains every required block", () => {
    const output = composeSignalOutput({ decision: baseDecision });

    for (const block of [
      "Kurzfazit:",
      "Technik:",
      "News/X/Event:",
      "Marktbestätigung:",
      "Multi-Timeframe:",
      "Gegenargument:",
      "Nächster Trigger:"
    ]) {
      assert.match(output.telegramText, new RegExp(block));
    }
  });

  it("contains a multi-timeframe block when summary is provided", () => {
    const output = composeSignalOutput({
      decision: baseDecision,
      multiTimeframeSummary: baseMultiTimeframeSummary
    });

    assert.match(output.telegramText, /Multi-Timeframe:/);
    assert.match(output.telegramText, /Alignment: BULLISH_ALIGNED/);
    assert.match(output.telegramText, /Score: 78\/100/);
    assert.match(output.telegramText, /Bestätigung: 4h, 1h/);
    assert.equal(output.dashboardJson.multiTimeframeSummary, baseMultiTimeframeSummary);
    assert.equal(output.multiTimeframeSummary, baseMultiTimeframeSummary);
  });

  it("states when multi-timeframe summary is missing", () => {
    const output = composeSignalOutput({ decision: baseDecision });

    assert.match(output.telegramText, /Multi-Timeframe:\n• Noch nicht berechnet\./);
    assert.equal(output.dashboardJson.multiTimeframeSummary, null);
  });

  it("uses newsContext summary in the news block when provided", () => {
    const newsContext = {
      hasRecentNews: true,
      summary: "AAPL: Hochrelevante Meldung – \"Apple beats earnings expectations\".",
      sentiment: "POSITIVE",
      relevanceScore: 80,
      topNews: [{ headline: "Apple beats earnings", source: "Reuters", url: "https://example.com" }],
      riskNote: "",
      sourceNote: "Quelle: Reuters."
    };

    const output = composeSignalOutput({ decision: baseDecision, newsContext });

    assert.match(output.telegramText, /News: AAPL: Hochrelevante Meldung/);
    assert.equal(output.intelligenceJson.newsSummary, newsContext.summary);
    assert.equal(output.dashboardJson.newsContext, newsContext);
  });

  it("uses no-news fallback when newsContext.hasRecentNews is false", () => {
    const newsContext = {
      hasRecentNews: false,
      summary: "Keine relevante neue Meldung im News-Fenster gefunden.",
      sentiment: "UNKNOWN",
      relevanceScore: 0,
      topNews: [],
      riskNote: "",
      sourceNote: ""
    };

    const output = composeSignalOutput({ decision: baseDecision, newsContext });

    assert.match(output.telegramText, /News: Keine relevante neue Meldung/);
    assert.equal(output.dashboardJson.newsContext, newsContext);
  });
});
