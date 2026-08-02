import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  MarketSide,
  SimulationReasonCode,
  computeMarketFill,
  type CandleSnapshotV1,
  type ExecutionProfileSnapshotV1
} from "../src/index.js";

const d = (value: string): DecimalValue => DecimalValue.fromString(value);

const candle = (overrides: Partial<CandleSnapshotV1> = {}): CandleSnapshotV1 => ({
  id: "candle-1",
  openTime: "2026-08-02T10:00:00.000Z",
  closeTime: "2026-08-02T11:00:00.000Z",
  open: "24100",
  high: "24300",
  low: "24000",
  close: "24200",
  volume: "1000",
  ...overrides
});

const profile = (overrides: Partial<ExecutionProfileSnapshotV1> = {}): ExecutionProfileSnapshotV1 => ({
  id: "profile-1",
  tickSize: "0.01",
  stepSize: "0.00001",
  minQuantity: "0.00001",
  minNotional: "10",
  maxQuantity: null,
  feeBps: 10,
  fullSpreadBps: 10,
  slippageBps: 10,
  maxParticipationRate: "0.01",
  specificationHash: "hash-1",
  ...overrides
});

describe("partial fills across the two allowed candles", () => {
  it("fills the liquidity-capped amount on candle 1 and the remainder on candle 2", () => {
    // requestedQuantity=15, 1 % of 1000 volume => cap 10 per candle.
    const first = computeMarketFill({
      side: MarketSide.BUY,
      referencePrice: "24100",
      requestedQuantity: "15",
      candle: candle({ id: "c1" }),
      executionProfile: profile()
    });
    assert.equal(first.fillable, true);
    assert.equal(first.fillQuantity, d("10").toString());

    const remaining = d("15").sub(d(first.fillQuantity));
    assert.equal(remaining.toString(), d("5").toString());

    const second = computeMarketFill({
      side: MarketSide.BUY,
      referencePrice: "24150",
      requestedQuantity: remaining.toString(),
      candle: candle({ id: "c2", volume: "2000" }),
      executionProfile: profile()
    });
    assert.equal(second.fillable, true);
    // 1 % of 2000 = 20, so all of the 5 remaining fill on candle 2.
    assert.equal(second.fillQuantity, d("5").toString());
  });

  it("leaves an order unfilled when a candle carries too little liquidity for even the minimum", () => {
    // volume 0.05 * 1 % participation = 0.0005 of liquidity, above zero but
    // below the instrument's minimum tradable quantity.
    const result = computeMarketFill({
      side: MarketSide.BUY,
      referencePrice: "24100",
      requestedQuantity: "1",
      candle: candle({ volume: "0.05" }),
      executionProfile: profile({ minQuantity: "0.001" })
    });
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.BELOW_MIN_QUANTITY);
  });

  it("caps the fill at the instrument's declared maximum quantity, if any", () => {
    const result = computeMarketFill({
      side: MarketSide.BUY,
      referencePrice: "24100",
      requestedQuantity: "1000",
      candle: candle({ volume: "1000000" }),
      executionProfile: profile({ maxQuantity: "3" })
    });
    assert.equal(result.fillable, true);
    assert.equal(result.fillQuantity, d("3").toString());
  });

  it("a SELL fill never exceeds the remaining open position quantity even under high liquidity", () => {
    const result = computeMarketFill({
      side: MarketSide.SELL,
      referencePrice: "24100",
      requestedQuantity: "10",
      openQuantity: "0.03",
      candle: candle({ volume: "1000000" }),
      executionProfile: profile()
    });
    assert.equal(result.fillable, true);
    assert.ok(d(result.fillQuantity).lte(d("0.03")));
  });
});
