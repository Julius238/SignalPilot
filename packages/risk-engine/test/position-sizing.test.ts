import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import { computePositionSizing, type PositionSizingInput } from "../src/position-sizing.js";

const d = (value: string): DecimalValue => DecimalValue.fromString(value);

const baseInput = (overrides: Partial<PositionSizingInput> = {}): PositionSizingInput => ({
  referenceEntryPrice: d("24100"),
  stopPrice: d("23598.03"),
  takeProfitPrice: d("25706.30"),
  equity: d("10000"),
  availableCash: d("10000"),
  currentGrossExposure: DecimalValue.ZERO,
  currentAssetExposure: DecimalValue.ZERO,
  currentCorrelatedExposure: DecimalValue.ZERO,
  maxRiskPerTradePct: d("0.0025"),
  maxGrossExposurePct: d("0.4"),
  maxAssetExposurePct: d("0.2"),
  maxCorrelatedExposurePct: d("0.3"),
  tickSize: d("0.01"),
  stepSize: d("0.00001"),
  minQuantity: d("0.00001"),
  minNotional: d("10"),
  maxQuantity: null,
  feeBps: 10,
  fullSpreadBps: 10,
  slippageBps: 10,
  ...overrides
});

describe("computePositionSizing — cost bridge", () => {
  const result = computePositionSizing(baseInput());

  it("prices the worst entry above and the worst stop fill below the reference", () => {
    assert.equal(result.computable, true);
    assert.ok(d(result.worstEntryPrice).gt(d("24100")));
    assert.ok(d(result.worstStopFillPrice).lt(d("23598.03")));
  });

  it("rounds the worst buy up and the worst sell down to the tick", () => {
    assert.ok(d(result.worstEntryPrice).isMultipleOf(d("0.01")));
    assert.ok(d(result.worstStopFillPrice).isMultipleOf(d("0.01")));
    assert.ok(d(result.worstTakeProfitFillPrice).isMultipleOf(d("0.01")));
  });

  it("charges both entry and exit fees in the per-unit risk", () => {
    const perUnitRisk = d(result.perUnitRisk);
    const spread = d(result.worstEntryPrice).sub(d(result.worstStopFillPrice));
    assert.equal(perUnitRisk.toString(), spread.add(d(result.roundTripFeesPerUnit)).toString());
    assert.ok(d(result.roundTripFeesPerUnit).isPositive());
  });

  it("keeps the risk budget at 0.25 % of equity", () => {
    assert.equal(result.riskBudget, d("25").toString());
  });

  it("never lets the worst-case loss exceed the budget", () => {
    assert.ok(d(result.riskAmount).lte(d(result.riskBudget)));
  });
});

describe("computePositionSizing — rounding and caps", () => {
  it("rounds the quantity down to the step size, never up", () => {
    const result = computePositionSizing(baseInput({ stepSize: d("0.01") }));
    const quantity = d(result.approvedQuantity);
    assert.ok(quantity.isMultipleOf(d("0.01")));
    assert.ok(quantity.lte(d(result.rawQuantity)));
  });

  it("shrinks the quantity when equity falls", () => {
    const larger = computePositionSizing(baseInput({ equity: d("10000") }));
    const smaller = computePositionSizing(baseInput({ equity: d("5000"), availableCash: d("5000") }));
    assert.ok(d(smaller.approvedQuantity).lt(d(larger.approvedQuantity)));
    assert.ok(d(smaller.riskAmount).lt(d(larger.riskAmount)));
  });

  it("caps on available cash when the wallet is thin", () => {
    const result = computePositionSizing(baseInput({ availableCash: d("100") }));
    assert.equal(result.cappedBy, "AVAILABLE_CASH");
    assert.ok(d(result.reservedQuoteAmount).lte(d("100")));
  });

  it("caps on the asset exposure limit", () => {
    const result = computePositionSizing(baseInput({ currentAssetExposure: d("1990") }));
    assert.equal(result.cappedBy, "ASSET_EXPOSURE");
    assert.ok(d(result.postTradeAssetExposure).lte(d("2000")));
  });

  it("caps on the correlated exposure limit", () => {
    const result = computePositionSizing(baseInput({ currentCorrelatedExposure: d("2995") }));
    assert.equal(result.cappedBy, "CORRELATED_EXPOSURE");
    assert.ok(d(result.postTradeCorrelatedExposure).lte(d("3000")));
  });

  it("respects an instrument maximum quantity", () => {
    const result = computePositionSizing(baseInput({ maxQuantity: d("0.001") }));
    assert.equal(result.cappedBy, "INSTRUMENT_MAXIMUM");
    assert.equal(result.approvedQuantity, d("0.001").toString());
  });

  it("returns zero rather than rounding up below one step", () => {
    const result = computePositionSizing(baseInput({ stepSize: d("1"), minQuantity: d("1") }));
    assert.equal(d(result.approvedQuantity).isZero(), true);
    assert.equal(d(result.notional).isZero(), true);
  });
});

describe("computePositionSizing — costs reduce reward/risk", () => {
  it("lowers the net reward/risk as spread, slippage and fees grow", () => {
    const cheap = computePositionSizing(baseInput({ feeBps: 0, fullSpreadBps: 0, slippageBps: 0 }));
    const expensive = computePositionSizing(baseInput({ feeBps: 10, fullSpreadBps: 20, slippageBps: 15 }));
    assert.ok(d(expensive.netRewardRisk).lt(d(cheap.netRewardRisk)));
    assert.ok(d(expensive.approvedQuantity).lt(d(cheap.approvedQuantity)));
  });

  it("reports a stricter conservative reward/risk than the R-008 measure", () => {
    const result = computePositionSizing(baseInput());
    assert.ok(d(result.conservativeRewardRisk).lt(d(result.netRewardRisk)));
  });

  it("reaches exactly 2.0 without any cost", () => {
    const result = computePositionSizing(
      baseInput({
        feeBps: 0,
        fullSpreadBps: 0,
        slippageBps: 0,
        referenceEntryPrice: d("100"),
        stopPrice: d("90"),
        takeProfitPrice: d("120")
      })
    );
    assert.equal(result.netRewardRisk, d("2").toString());
  });
});

describe("computePositionSizing — refuses impossible inputs", () => {
  const cases: readonly (readonly [string, Partial<PositionSizingInput>])[] = [
    ["stop at or above entry", { stopPrice: d("24100") }],
    ["take profit at or below entry", { takeProfitPrice: d("24100") }],
    ["zero equity", { equity: DecimalValue.ZERO }],
    ["zero tick size", { tickSize: DecimalValue.ZERO }],
    ["zero step size", { stepSize: DecimalValue.ZERO }],
    ["negative fee basis points", { feeBps: -1 }]
  ];

  for (const [label, override] of cases) {
    it(`reports not computable: ${label}`, () => {
      const result = computePositionSizing(baseInput(override));
      assert.equal(result.computable, false);
      assert.equal(d(result.approvedQuantity).isZero(), true);
    });
  }

  it("never returns a JavaScript number for a money value", () => {
    const result = computePositionSizing(baseInput());
    for (const value of [
      result.riskBudget,
      result.perUnitRisk,
      result.approvedQuantity,
      result.notional,
      result.riskAmount,
      result.reservedQuoteAmount
    ]) {
      assert.equal(typeof value, "string");
      assert.ok(DecimalValue.isDecimalString(value));
    }
  });

  it("is deterministic", () => {
    assert.deepEqual(computePositionSizing(baseInput()), computePositionSizing(baseInput()));
  });
});
