import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import { computePostFillNetRewardRisk } from "../src/post-fill-recheck.js";

const d = (value: string): DecimalValue => DecimalValue.fromString(value);

const baseInput = (
  overrides: Partial<Parameters<typeof computePostFillNetRewardRisk>[0]> = {}
) => ({
  direction: "LONG" as const,
  actualAverageEntryPrice: d("24150"),
  actualEntryFeePerUnit: d("2.415"),
  stopPrice: d("23600"),
  takeProfitPrice: d("25350"),
  tickSize: d("0.01"),
  feeBps: 10,
  fullSpreadBps: 10,
  slippageBps: 10,
  ...overrides
});

describe("computePostFillNetRewardRisk", () => {
  it("computes a positive net reward/risk for a healthy fill", () => {
    const result = computePostFillNetRewardRisk(baseInput());
    assert.equal(result.computable, true);
    assert.ok(d(result.netRewardRisk).isPositive());
  });

  it("does not double-charge adverse cost on the already-realised entry price", () => {
    // If the entry side were re-priced adversely on top of an already
    // adverse actual fill, the ratio would come out lower than treating the
    // actual entry price as final. Assert against the by-hand formula this
    // module documents: only the stop side gets an adverse projection.
    const input = baseInput();
    const result = computePostFillNetRewardRisk(input);
    assert.equal(result.computable, true);

    const worstStop = d(result.worstStopFillPrice);
    const stopFee = worstStop.mul(d("0.001"), "CEIL");
    const perUnitRisk = input.actualAverageEntryPrice
      .sub(worstStop)
      .add(input.actualEntryFeePerUnit)
      .add(stopFee);
    const worstTakeProfit = d(result.worstTakeProfitFillPrice);
    const takeProfitFee = worstTakeProfit.mul(d("0.001"), "CEIL");
    const expected = worstTakeProfit
      .sub(input.actualAverageEntryPrice)
      .sub(input.actualEntryFeePerUnit)
      .sub(takeProfitFee)
      .div(perUnitRisk, "FLOOR");
    assert.equal(result.netRewardRisk, expected.toString());
  });

  it("prices the stop conservatively below the raw stop price", () => {
    const result = computePostFillNetRewardRisk(baseInput());
    assert.ok(d(result.worstStopFillPrice).lt(d("23600")));
  });

  it("is not computable when the take profit is not above the actual entry", () => {
    const result = computePostFillNetRewardRisk(
      baseInput({ takeProfitPrice: d("24100") })
    );
    assert.equal(result.computable, false);
  });

  it("is not computable when the stop is not below the actual entry", () => {
    const result = computePostFillNetRewardRisk(
      baseInput({ stopPrice: d("24200") })
    );
    assert.equal(result.computable, false);
  });

  it("reports a lower net reward/risk when spread and slippage widen", () => {
    const tight = computePostFillNetRewardRisk(baseInput());
    const wide = computePostFillNetRewardRisk(
      baseInput({ fullSpreadBps: 20, slippageBps: 15 })
    );
    assert.ok(d(wide.netRewardRisk).lt(d(tight.netRewardRisk)));
  });

  it("never rewards a worse fill with a better ratio (a higher actual entry price shrinks the reward)", () => {
    const cheaper = computePostFillNetRewardRisk(
      baseInput({ actualAverageEntryPrice: d("24100") })
    );
    const pricier = computePostFillNetRewardRisk(
      baseInput({ actualAverageEntryPrice: d("24300") })
    );
    assert.ok(d(pricier.netRewardRisk).lt(d(cheaper.netRewardRisk)));
  });

  it("mirrors risk and reward for a synthetic short", () => {
    const result = computePostFillNetRewardRisk(
      baseInput({
        direction: "SHORT",
        actualAverageEntryPrice: d("24050"),
        actualEntryFeePerUnit: d("2.405"),
        stopPrice: d("24602"),
        takeProfitPrice: d("22400")
      })
    );
    assert.equal(result.computable, true);
    assert.ok(d(result.worstStopFillPrice).gt(d("24602")));
    assert.ok(d(result.worstTakeProfitFillPrice).gt(d("22400")));
    assert.ok(d(result.netRewardRisk).gte(d("2")));
  });
});
