/**
 * Post-fill net reward/risk recheck.
 *
 * Specification:
 *   docs/trading/05-strategy-v1-specification.md, "Candidate-Preisplan":
 *     "Nach tatsächlichem Entry-Fill werden Risikobudget und RR mit dem
 *      adversen Fill erneut geprüft. Liegt RR dann unter 2,0, darf die
 *      Order vor Fill auslaufen/abgelehnt werden; ein bereits erfolgter
 *      Fill erhält unverzüglich einen gültigen ExitPlan und wird nicht
 *      'unsichtbar' gemacht."
 *   docs/trading/decisions/0009-post-fill-net-crv-recheck.md
 *
 * `R-008-MIN-RR` (docs/trading/06) checked this *before* the fill, using the
 * worst-case *projected* entry price. Once a fill has actually happened, the
 * entry side of the ratio is no longer a projection — it is the position's
 * real weighted-average entry price and the real fee already paid on it.
 * Re-running the pre-trade formula unchanged on this input would apply a
 * second, redundant adverse buy-side adjustment on top of a price that is
 * already realised, silently making every recheck stricter than the
 * documented 2.0 minimum for no stated reason. This module therefore prices
 * only the side that is still a projection — the eventual stop exit — with
 * exactly the same adverse cost model `computePositionSizing` uses
 * (`computeWorstSellFill`), and takes the entry side as-is.
 *
 * Pure function: no DB, clock, network or `process.env`.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

import { computeWorstSellFill, rateFromBps } from "./position-sizing.js";

export interface PostFillRewardRiskInput {
  /** The position's actual weighted-average entry price after the fill. */
  readonly actualAverageEntryPrice: DecimalValue;
  /** Actual entry fee already paid, per unit (`feesPaid / openQuantity`). */
  readonly actualEntryFeePerUnit: DecimalValue;
  readonly stopPrice: DecimalValue;
  readonly takeProfitPrice: DecimalValue;
  readonly tickSize: DecimalValue;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
}

export interface PostFillRewardRiskResult {
  readonly computable: boolean;
  readonly worstStopFillPrice: string;
  readonly stopExitFeePerUnit: string;
  readonly roundTripFeesPerUnit: string;
  readonly perUnitRisk: string;
  /** `(takeProfitPrice - actualAverageEntryPrice) / perUnitRisk`, floored. */
  readonly netRewardRisk: string;
}

function zero(): PostFillRewardRiskResult {
  const z = DecimalValue.ZERO.toString();
  return {
    computable: false,
    worstStopFillPrice: z,
    stopExitFeePerUnit: z,
    roundTripFeesPerUnit: z,
    perUnitRisk: z,
    netRewardRisk: z
  };
}

export function computePostFillNetRewardRisk(input: PostFillRewardRiskInput): PostFillRewardRiskResult {
  const fullSpreadRate = rateFromBps(input.fullSpreadBps);
  const slippageRate = rateFromBps(input.slippageBps);
  const feeRate = rateFromBps(input.feeBps);

  if (
    fullSpreadRate === null ||
    slippageRate === null ||
    feeRate === null ||
    !input.actualAverageEntryPrice.isPositive() ||
    input.actualEntryFeePerUnit.isNegative() ||
    !input.stopPrice.isPositive() ||
    !input.takeProfitPrice.isPositive() ||
    !input.tickSize.isPositive() ||
    input.stopPrice.gte(input.actualAverageEntryPrice) ||
    input.takeProfitPrice.lte(input.actualAverageEntryPrice)
  ) {
    return zero();
  }

  const worstStopFillPrice = computeWorstSellFill(input.stopPrice, fullSpreadRate, slippageRate, input.tickSize);
  if (!worstStopFillPrice.isPositive() || worstStopFillPrice.gte(input.actualAverageEntryPrice)) {
    return zero();
  }

  const stopExitFeePerUnit = worstStopFillPrice.mul(feeRate, RoundingMode.CEIL);
  const roundTripFeesPerUnit = input.actualEntryFeePerUnit.add(stopExitFeePerUnit);
  const perUnitRisk = input.actualAverageEntryPrice.sub(worstStopFillPrice).add(roundTripFeesPerUnit);
  if (!perUnitRisk.isPositive()) {
    return zero();
  }

  const netRewardRisk = input.takeProfitPrice
    .sub(input.actualAverageEntryPrice)
    .div(perUnitRisk, RoundingMode.FLOOR);

  return {
    computable: true,
    worstStopFillPrice: worstStopFillPrice.toString(),
    stopExitFeePerUnit: stopExitFeePerUnit.toString(),
    roundTripFeesPerUnit: roundTripFeesPerUnit.toString(),
    perUnitRisk: perUnitRisk.toString(),
    netRewardRisk: netRewardRisk.toString()
  };
}
