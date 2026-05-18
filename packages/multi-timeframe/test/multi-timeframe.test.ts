import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateMultiTimeframeSummary, type MultiTimeframeSignalInput } from "../src/index.js";

const baseSignal: MultiTimeframeSignalInput = {
  symbol: "BTCUSDT",
  timeframe: "1d",
  status: "WATCH",
  direction: "BULLISH",
  signalType: "TREND_ALERT",
  score: 70,
  riskLevel: "LOW",
  riskScore: 20,
  createdAt: "2026-05-17T08:00:00.000Z"
};

function signal(overrides: Partial<MultiTimeframeSignalInput>): MultiTimeframeSignalInput {
  return {
    ...baseSignal,
    ...overrides
  };
}

describe("calculateMultiTimeframeSummary", () => {
  it("summarizes 1d, 4h, and 1h as bullish aligned", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BULLISH", status: "WATCH", score: 76 }),
      signal({ timeframe: "4h", direction: "BULLISH", status: "WATCH", score: 72 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "WAIT", score: 58 })
    ]);

    assert.equal(summary.alignment, "BULLISH_ALIGNED");
    assert.equal(summary.primaryTimeframe, "1d");
    assert.deepEqual(summary.confirmingTimeframes, ["4h", "1h"]);
    assert.equal(summary.conflictingTimeframes.length, 0);
    assert.ok(summary.alignmentScore > 50);
  });

  it("summarizes 1d bullish, 4h neutral, and 1h bullish as higher timeframe confirmation", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BULLISH", status: "WATCH", score: 74 }),
      signal({ timeframe: "4h", direction: "NEUTRAL", status: "WAIT", score: 52 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "STRONG_WATCH", score: 86 })
    ]);

    assert.equal(summary.alignment, "HIGHER_TIMEFRAME_CONFIRMATION");
    assert.equal(summary.primaryTimeframe, "1d");
    assert.deepEqual(summary.confirmingTimeframes, ["1h"]);
  });

  it("summarizes strong 1h bullish with neutral 4h and 1d as short term only", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "NEUTRAL", status: "WAIT", score: 51 }),
      signal({ timeframe: "4h", direction: "MIXED", status: "NO_EDGE", score: 47 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "STRONG_WATCH", score: 88 })
    ]);

    assert.equal(summary.alignment, "SHORT_TERM_ONLY");
    assert.equal(summary.primaryTimeframe, "1h");
    assert.equal(summary.nextFocus.includes("4h"), true);
  });

  it("summarizes 1h bullish against 1d bearish as conflict", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BEARISH", status: "WATCH", score: 72 }),
      signal({ timeframe: "4h", direction: "NEUTRAL", status: "WAIT", score: 52 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "STRONG_WATCH", score: 84 })
    ]);

    assert.equal(summary.alignment, "CONFLICT");
    assert.deepEqual(summary.conflictingTimeframes, ["1h"]);
    assert.equal(summary.summary.includes("widersprechen"), true);
  });

  it("summarizes all no edge signals as no edge", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "NEUTRAL", status: "NO_EDGE", score: 42 }),
      signal({ timeframe: "4h", direction: "NEUTRAL", status: "NO_EDGE", score: 45 }),
      signal({ timeframe: "1h", direction: "MIXED", status: "WAIT", score: 50 })
    ]);

    assert.equal(summary.alignment, "NO_EDGE");
    assert.equal(summary.alignmentScore, 0);
    assert.equal(summary.primaryTimeframe, null);
  });

  it("sets total riskLevel to HIGH when 1d or 4h is HIGH risk", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BULLISH", status: "WATCH", score: 70, riskLevel: "LOW" }),
      signal({ timeframe: "4h", direction: "BULLISH", status: "WATCH", score: 68, riskLevel: "HIGH" }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "WATCH", score: 66, riskLevel: "LOW" })
    ]);

    assert.equal(summary.riskLevel, "HIGH");
    assert.equal(summary.riskNote.includes("HIGH Risk"), true);
  });

  it("creates a clear riskNote when a timeframe is AVOID", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BEARISH", status: "AVOID", score: 28, riskLevel: "HIGH" }),
      signal({ timeframe: "4h", direction: "BEARISH", status: "WATCH", score: 70, riskLevel: "MEDIUM" }),
      signal({ timeframe: "1h", direction: "NEUTRAL", status: "WAIT", score: 52, riskLevel: "LOW" })
    ]);

    assert.equal(summary.riskNote.includes("AVOID auf 1d"), true);
    assert.equal(summary.riskNote.includes("Risiko hat Vorrang"), true);
  });

  it("summarizes 1d and 1h as bullish aligned without 4h", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BULLISH", status: "WATCH", score: 72 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "WATCH", score: 69 })
    ]);

    assert.equal(summary.alignment, "BULLISH_ALIGNED");
    assert.equal(summary.symbol, "BTCUSDT");
    assert.equal(summary.primaryTimeframe, "1d");
    assert.deepEqual(summary.confirmingTimeframes, ["1h"]);
    assert.equal(summary.nextFocus.includes("4h"), false);
    assert.ok(summary.alignmentScore > 0);
  });

  it("summarizes 1d bullish and 1h neutral as bullish aligned in 2-TF mode", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BULLISH", status: "WATCH", score: 74 }),
      signal({ timeframe: "1h", direction: "NEUTRAL", status: "WAIT", score: 52 })
    ]);

    assert.equal(summary.alignment, "BULLISH_ALIGNED");
    assert.equal(summary.primaryTimeframe, "1d");
  });

  it("summarizes 1d neutral and strong 1h bullish as short term only in 2-TF mode", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "NEUTRAL", status: "WAIT", score: 51 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "STRONG_WATCH", score: 88 })
    ]);

    assert.equal(summary.alignment, "SHORT_TERM_ONLY");
    assert.equal(summary.nextFocus.includes("4h"), false);
    assert.equal(summary.nextFocus.includes("1d"), true);
  });

  it("summarizes 1d bearish and 1h bullish as conflict in 2-TF mode", () => {
    const summary = calculateMultiTimeframeSummary([
      signal({ timeframe: "1d", direction: "BEARISH", status: "WATCH", score: 72 }),
      signal({ timeframe: "1h", direction: "BULLISH", status: "STRONG_WATCH", score: 84 })
    ]);

    assert.equal(summary.alignment, "CONFLICT");
  });
});
