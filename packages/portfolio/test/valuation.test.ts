import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  computeConservativeBidMark,
  computeConservativeMark,
  computePortfolioValuation,
  computePositionMark
} from "../src/index.js";

const d = (value: string): DecimalValue => DecimalValue.fromString(value);

describe("computeConservativeBidMark", () => {
  it("marks below the candle close by half the modelled spread, no slippage", () => {
    const mark = computeConservativeBidMark("24200", 10, "0.01");
    assert.ok(mark !== null);
    assert.ok(d(mark!).lt(d("24200")));
  });
});

describe("computePositionMark", () => {
  it("computes market value and unrealized P&L net of an estimated exit fee", () => {
    const result = computePositionMark({
      direction: "LONG",
      openQuantity: "0.1",
      averageEntryPrice: "24000",
      conservativeBidMark: "24500",
      estimatedExitFeeRate: "0.001"
    });
    assert.ok(result !== null);
    assert.equal(
      result!.marketValue,
      d("0.1").mul(d("24500"), "FLOOR").toString()
    );
    // Unrealized gain net of a small modelled exit fee.
    assert.ok(d(result!.unrealizedPnl).isPositive());
  });

  it("returns null rather than a fabricated mark for an invalid input", () => {
    const result = computePositionMark({
      direction: "LONG",
      openQuantity: "-1",
      averageEntryPrice: "100",
      conservativeBidMark: "110",
      estimatedExitFeeRate: "0.001"
    });
    assert.equal(result, null);
  });
});

describe("computePortfolioValuation", () => {
  it("rolls up equity, drawdown and daily P&L", () => {
    const result = computePortfolioValuation({
      availableCash: "8000",
      reservedCash: "1000",
      realizedPnl: "50",
      feesPaid: "5",
      openPositionMarks: [
        { marketValue: "1200", unrealizedPnl: "20", equityContribution: "1200" }
      ],
      highWaterMark: "10000",
      startOfDayEquity: "10100"
    });
    assert.ok(result !== null);
    assert.equal(result!.equity, "10200.000000000000");
    assert.equal(result!.highWaterMark, "10200.000000000000");
    assert.equal(result!.drawdownAmount, "0.000000000000");
    assert.equal(result!.dailyPnl, "100.000000000000");
  });

  it("never lowers the high-water mark below its prior value", () => {
    const result = computePortfolioValuation({
      availableCash: "8000",
      reservedCash: "0",
      realizedPnl: "-1900",
      feesPaid: "5",
      openPositionMarks: [],
      highWaterMark: "10000",
      startOfDayEquity: null
    });
    assert.ok(result !== null);
    assert.equal(result!.equity, "8000.000000000000");
    assert.equal(result!.highWaterMark, "10000.000000000000");
    assert.ok(d(result!.drawdownAmount).isPositive());
    assert.equal(result!.dailyPnl, null);
  });
});

describe("synthetic SHORT valuation", () => {
  it("uses an adverse ask mark and the inverse PnL sign", () => {
    const mark = computeConservativeMark("SHORT", "23000", 10, "0.01");
    assert.ok(mark !== null && d(mark).gt(d("23000")));
    const result = computePositionMark({
      direction: "SHORT",
      openQuantity: "0.1",
      averageEntryPrice: "24000",
      conservativeBidMark: mark!,
      estimatedExitFeeRate: "0.001"
    });
    assert.ok(result !== null);
    assert.ok(d(result!.unrealizedPnl).isPositive());
    assert.equal(result!.equityContribution, result!.unrealizedPnl);
  });
});
