import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  MarketSide,
  SimulationReasonCode,
  checkEntryGap,
  computeMarketFill,
  type CandleSnapshotV1,
  type ExecutionProfileSnapshotV1,
  type MarketFillComputationInputV1
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

const baseInput = (overrides: Partial<MarketFillComputationInputV1> = {}): MarketFillComputationInputV1 => ({
  side: MarketSide.BUY,
  referencePrice: "24100",
  requestedQuantity: "0.1",
  candle: candle(),
  executionProfile: profile(),
  ...overrides
});

describe("computeMarketFill — BUY", () => {
  it("rounds the fill price up, charges an adverse fee and fills within liquidity", () => {
    const result = computeMarketFill(baseInput());
    assert.equal(result.fillable, true);
    assert.equal(result.reasonCode, SimulationReasonCode.FILLED);
    assert.ok(d(result.fillPrice).gt(d("24100")), "buy fill must be above the reference");
    assert.ok(d(result.fillPrice).isMultipleOf(d("0.01")));
    assert.ok(d(result.feeAmount).isPositive());
    assert.equal(result.notional, d(result.fillQuantity).mul(d(result.fillPrice), "FLOOR").toString());
  });

  it("caps the fill at 1 % of candle volume, floored to the step size", () => {
    const result = computeMarketFill(baseInput({ requestedQuantity: "1000" }));
    assert.equal(result.fillable, true);
    // 1 % of 1000 volume = 10, floored to the step size.
    assert.equal(result.fillQuantity, d("10").toString());
    assert.equal(result.liquidityCap, d("10").toString());
  });

  it("never fills more than requested", () => {
    // Notional at ~24100 for 0.0005 units clears the 10 USDT minimum.
    const result = computeMarketFill(baseInput({ requestedQuantity: "0.0005" }));
    assert.equal(result.fillable, true);
    assert.equal(result.fillQuantity, d("0.0005").toString());
  });

  it("refuses a fill whose notional would be below the instrument minimum", () => {
    // Liquidity cap (30 volume * 1 %) allows the full 0.0003 request through,
    // but its notional (~7.2 USDT) stays below the 10 USDT minimum.
    const result = computeMarketFill(
      baseInput({ requestedQuantity: "0.0003", candle: candle({ volume: "30" }) })
    );
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.BELOW_MIN_NOTIONAL);
  });

  it("reports no liquidity when the candle has no volume", () => {
    const result = computeMarketFill(baseInput({ candle: candle({ volume: "0" }) }));
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.NO_LIQUIDITY);
  });

  it("blocks a fill that would exceed the tied reservation", () => {
    const result = computeMarketFill(
      baseInput({ requestedQuantity: "10", reservedQuoteAmount: "1" })
    );
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.RESERVE_EXCEEDED);
  });

  it("passes when the reservation comfortably covers the worst-case cost", () => {
    const result = computeMarketFill(
      baseInput({ requestedQuantity: "0.1", reservedQuoteAmount: "10000" })
    );
    assert.equal(result.fillable, true);
  });
});

describe("computeMarketFill — SELL", () => {
  it("rounds the fill price down and never exceeds the open position quantity", () => {
    const result = computeMarketFill(
      baseInput({ side: "SELL", referencePrice: "24000", requestedQuantity: "50", openQuantity: "0.2" })
    );
    assert.equal(result.fillable, true);
    assert.ok(d(result.fillPrice).lt(d("24000")), "sell fill must be below the reference");
    assert.ok(d(result.fillQuantity).lte(d("0.2")));
  });

  it("refuses when the open quantity itself is invalid", () => {
    const result = computeMarketFill(
      baseInput({ side: "SELL", referencePrice: "24000", requestedQuantity: "1", openQuantity: "-1" })
    );
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.SELL_EXCEEDS_OPEN_QUANTITY);
  });
});

describe("computeMarketFill — invalid inputs never fabricate a fill", () => {
  it("refuses a candle with an OHLC contradiction", () => {
    const result = computeMarketFill(baseInput({ candle: candle({ low: "25000" }) }));
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.INVALID_CANDLE);
  });

  it("refuses a negative execution-profile fee", () => {
    const result = computeMarketFill(baseInput({ executionProfile: profile({ feeBps: -1 }) }));
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.INVALID_EXECUTION_PROFILE);
  });

  it("refuses a non-positive requested quantity", () => {
    const result = computeMarketFill(baseInput({ requestedQuantity: "0" }));
    assert.equal(result.fillable, false);
    assert.equal(result.reasonCode, SimulationReasonCode.INVALID_REQUESTED_QUANTITY);
  });
});

describe("checkEntryGap", () => {
  it("passes when the open stays within the planned maximum", () => {
    const result = checkEntryGap({ candleOpen: "24100", plannedEntryMaximum: "24200" });
    assert.equal(result.gapTooLarge, false);
  });

  it("rejects an open beyond the planned maximum — no FOMO fill", () => {
    const result = checkEntryGap({ candleOpen: "24300", plannedEntryMaximum: "24200" });
    assert.equal(result.gapTooLarge, true);
    assert.equal(result.reasonCode, SimulationReasonCode.ENTRY_GAP_TOO_LARGE);
  });

  it("treats exactly the maximum as acceptable, not a gap", () => {
    const result = checkEntryGap({ candleOpen: "24200", plannedEntryMaximum: "24200" });
    assert.equal(result.gapTooLarge, false);
  });
});
