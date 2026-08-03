/**
 * Conservative shadow position sizing.
 *
 * Specification:
 *   docs/trading/05-strategy-v1-specification.md, "Positionsgrößenformel"
 *   docs/trading/06-risk-engine-specification.md, `R-009`, `R-013`–`R-015`, `R-025`
 *   docs/trading/07-shadow-execution-model.md, "Marktorder-Preis", "Gebühren",
 *   "Instrumentminimum und Präzision"
 *
 * Every step runs on `DecimalValue`; no intermediate value ever passes through
 * an IEEE-754 double. Rounding is directional and always against the portfolio:
 *
 *   - the worst buy price rounds up to the next tick,
 *   - the worst sell price rounds down to the next tick,
 *   - fees round up,
 *   - quantities round down to the step size.
 *
 * The function never raises a quantity. Every cap can only shrink it, and a
 * value that cannot be represented safely yields `computable: false` rather
 * than a guess.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

import { SizingCap, type RiskSizingResultV1 } from "./contracts.js";

const BPS_DIVISOR = DecimalValue.fromSafeInteger(10_000);
const TWO = DecimalValue.fromSafeInteger(2);

export interface PositionSizingInput {
  readonly referenceEntryPrice: DecimalValue;
  readonly stopPrice: DecimalValue;
  readonly takeProfitPrice: DecimalValue;

  readonly equity: DecimalValue;
  readonly availableCash: DecimalValue;
  readonly currentGrossExposure: DecimalValue;
  readonly currentAssetExposure: DecimalValue;
  readonly currentCorrelatedExposure: DecimalValue;

  readonly maxRiskPerTradePct: DecimalValue;
  readonly maxGrossExposurePct: DecimalValue;
  readonly maxAssetExposurePct: DecimalValue;
  readonly maxCorrelatedExposurePct: DecimalValue;

  readonly tickSize: DecimalValue;
  readonly stepSize: DecimalValue;
  readonly minQuantity: DecimalValue;
  readonly minNotional: DecimalValue;
  readonly maxQuantity: DecimalValue | null;

  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
}

const zeroResult = (): RiskSizingResultV1 => {
  const zero = DecimalValue.ZERO.toString();
  return {
    computable: false,
    riskBudget: zero,
    fullSpreadRate: zero,
    slippageRate: zero,
    feeRate: zero,
    worstEntryPrice: zero,
    worstStopFillPrice: zero,
    worstTakeProfitFillPrice: zero,
    entryFeePerUnit: zero,
    stopExitFeePerUnit: zero,
    roundTripFeesPerUnit: zero,
    perUnitRisk: zero,
    rawQuantity: zero,
    cashCapQuantity: zero,
    grossExposureCapQuantity: zero,
    assetExposureCapQuantity: zero,
    correlatedExposureCapQuantity: zero,
    instrumentMaximumQuantity: null,
    cappedBy: SizingCap.NONE,
    approvedQuantity: zero,
    notional: zero,
    entryFeeTotal: zero,
    reservedQuoteAmount: zero,
    riskAmount: zero,
    netRewardRisk: zero,
    conservativeRewardRisk: zero,
    postTradeGrossExposure: zero,
    postTradeAssetExposure: zero,
    postTradeCorrelatedExposure: zero
  };
};

/** Basis points to a decimal rate, e.g. `20` → `0.002`. Exact: bps/10000 always terminates. */
export const rateFromBps = (bps: number): DecimalValue | null => {
  if (!Number.isSafeInteger(bps) || bps < 0) return null;
  return DecimalValue.fromSafeInteger(bps).div(BPS_DIVISOR, RoundingMode.EXACT);
};

/**
 * Worst realistic sell fill for a given mid price: half spread and adverse
 * slippage against the seller, then down-tick. Shared by the pre-trade
 * worst-case sizing below and the post-fill net-CRV recheck
 * (`post-fill-recheck.ts`), which apply it to different prices (the
 * candidate's planned stop both times) but must use the exact same adverse
 * cost model — anything else would silently loosen or tighten the risk
 * limits the two call sites are supposed to share.
 */
export function computeWorstSellFill(
  price: DecimalValue,
  fullSpreadRate: DecimalValue,
  slippageRate: DecimalValue,
  tickSize: DecimalValue
): DecimalValue {
  const halfSpread = fullSpreadRate.div(TWO, RoundingMode.CEIL);
  const sellFactor = DecimalValue.ONE.sub(halfSpread).mul(DecimalValue.ONE.sub(slippageRate), RoundingMode.FLOOR);
  return price.mul(sellFactor, RoundingMode.FLOOR).quantizeToStep(tickSize, RoundingMode.FLOOR);
}

/** Remaining headroom under a percentage cap, never negative. */
function headroom(
  equity: DecimalValue,
  capPct: DecimalValue,
  current: DecimalValue
): DecimalValue {
  const limit = equity.mul(capPct, RoundingMode.FLOOR);
  const remaining = limit.sub(current);
  return remaining.isNegative() ? DecimalValue.ZERO : remaining;
}

/** Largest quantity whose notional at `unitCost` stays within `budget`. */
function quantityForBudget(budget: DecimalValue, unitCost: DecimalValue): DecimalValue {
  if (!unitCost.isPositive()) return DecimalValue.ZERO;
  return budget.div(unitCost, RoundingMode.FLOOR);
}

export function computePositionSizing(input: PositionSizingInput): RiskSizingResultV1 {
  const fullSpreadRate = rateFromBps(input.fullSpreadBps);
  const slippageRate = rateFromBps(input.slippageBps);
  const feeRate = rateFromBps(input.feeBps);

  if (
    fullSpreadRate === null ||
    slippageRate === null ||
    feeRate === null ||
    !input.referenceEntryPrice.isPositive() ||
    !input.stopPrice.isPositive() ||
    !input.takeProfitPrice.isPositive() ||
    !input.tickSize.isPositive() ||
    !input.stepSize.isPositive() ||
    !input.equity.isPositive() ||
    input.stopPrice.gte(input.referenceEntryPrice) ||
    input.takeProfitPrice.lte(input.referenceEntryPrice)
  ) {
    return zeroResult();
  }

  const halfSpread = fullSpreadRate.div(TWO, RoundingMode.CEIL);

  // Worst realistic buy: mid + half spread, then adverse slippage, then up-tick.
  const worstEntryPrice = input.referenceEntryPrice
    .mul(DecimalValue.ONE.add(halfSpread), RoundingMode.CEIL)
    .mul(DecimalValue.ONE.add(slippageRate), RoundingMode.CEIL)
    .quantizeToStep(input.tickSize, RoundingMode.CEIL);

  // Worst realistic sell: mid − half spread, then adverse slippage, then down-tick.
  const worstStopFillPrice = computeWorstSellFill(input.stopPrice, fullSpreadRate, slippageRate, input.tickSize);
  const worstTakeProfitFillPrice = computeWorstSellFill(
    input.takeProfitPrice,
    fullSpreadRate,
    slippageRate,
    input.tickSize
  );

  if (!worstEntryPrice.isPositive() || !worstStopFillPrice.isPositive()) return zeroResult();

  const entryFeePerUnit = worstEntryPrice.mul(feeRate, RoundingMode.CEIL);
  const stopExitFeePerUnit = worstStopFillPrice.mul(feeRate, RoundingMode.CEIL);
  const roundTripFeesPerUnit = entryFeePerUnit.add(stopExitFeePerUnit);

  // Loss to the stop plus both fees — the money genuinely at risk per unit.
  const perUnitRisk = worstEntryPrice.sub(worstStopFillPrice).add(roundTripFeesPerUnit);
  if (!perUnitRisk.isPositive()) return zeroResult();

  const riskBudget = input.equity.mul(input.maxRiskPerTradePct, RoundingMode.FLOOR);
  const rawQuantity = riskBudget.div(perUnitRisk, RoundingMode.FLOOR);

  // Cash must cover the worst entry notional plus its fee.
  const cashCapQuantity = quantityForBudget(
    input.availableCash,
    worstEntryPrice.add(entryFeePerUnit)
  );
  const grossExposureCapQuantity = quantityForBudget(
    headroom(input.equity, input.maxGrossExposurePct, input.currentGrossExposure),
    worstEntryPrice
  );
  const assetExposureCapQuantity = quantityForBudget(
    headroom(input.equity, input.maxAssetExposurePct, input.currentAssetExposure),
    worstEntryPrice
  );
  const correlatedExposureCapQuantity = quantityForBudget(
    headroom(input.equity, input.maxCorrelatedExposurePct, input.currentCorrelatedExposure),
    worstEntryPrice
  );

  const caps: readonly (readonly [SizingCap, DecimalValue])[] = [
    [SizingCap.RISK_BUDGET, rawQuantity],
    [SizingCap.AVAILABLE_CASH, cashCapQuantity],
    [SizingCap.GROSS_EXPOSURE, grossExposureCapQuantity],
    [SizingCap.ASSET_EXPOSURE, assetExposureCapQuantity],
    [SizingCap.CORRELATED_EXPOSURE, correlatedExposureCapQuantity],
    ...(input.maxQuantity === null
      ? []
      : ([[SizingCap.INSTRUMENT_MAXIMUM, input.maxQuantity]] as const))
  ];

  let cappedBy: SizingCap = SizingCap.RISK_BUDGET;
  let limited = rawQuantity;
  for (const [cap, value] of caps) {
    if (value.lt(limited)) {
      limited = value;
      cappedBy = cap;
    }
  }

  // Always down to the step size; never up (docs/trading/07).
  const approvedQuantity = limited.isPositive()
    ? limited.quantizeToStep(input.stepSize, RoundingMode.FLOOR)
    : DecimalValue.ZERO;

  const notional = approvedQuantity.mul(worstEntryPrice, RoundingMode.FLOOR);
  const entryFeeTotal = notional.mul(feeRate, RoundingMode.CEIL);
  const reservedQuoteAmount = notional.add(entryFeeTotal);
  const riskAmount = approvedQuantity.mul(perUnitRisk, RoundingMode.CEIL);

  // R-008 measure: gross reward against the fully costed risk.
  const netRewardRisk = input.takeProfitPrice
    .sub(worstEntryPrice)
    .div(perUnitRisk, RoundingMode.FLOOR);

  // Stricter variant: adverse take-profit fill minus its own exit fee.
  const takeProfitExitFeePerUnit = worstTakeProfitFillPrice.mul(feeRate, RoundingMode.CEIL);
  const conservativeReward = worstTakeProfitFillPrice
    .sub(worstEntryPrice)
    .sub(entryFeePerUnit)
    .sub(takeProfitExitFeePerUnit);
  const conservativeRewardRisk = conservativeReward.div(perUnitRisk, RoundingMode.FLOOR);

  return {
    computable: true,
    riskBudget: riskBudget.toString(),
    fullSpreadRate: fullSpreadRate.toString(),
    slippageRate: slippageRate.toString(),
    feeRate: feeRate.toString(),
    worstEntryPrice: worstEntryPrice.toString(),
    worstStopFillPrice: worstStopFillPrice.toString(),
    worstTakeProfitFillPrice: worstTakeProfitFillPrice.toString(),
    entryFeePerUnit: entryFeePerUnit.toString(),
    stopExitFeePerUnit: stopExitFeePerUnit.toString(),
    roundTripFeesPerUnit: roundTripFeesPerUnit.toString(),
    perUnitRisk: perUnitRisk.toString(),
    rawQuantity: rawQuantity.toString(),
    cashCapQuantity: cashCapQuantity.toString(),
    grossExposureCapQuantity: grossExposureCapQuantity.toString(),
    assetExposureCapQuantity: assetExposureCapQuantity.toString(),
    correlatedExposureCapQuantity: correlatedExposureCapQuantity.toString(),
    instrumentMaximumQuantity: input.maxQuantity?.toString() ?? null,
    cappedBy,
    approvedQuantity: approvedQuantity.toString(),
    notional: notional.toString(),
    entryFeeTotal: entryFeeTotal.toString(),
    reservedQuoteAmount: reservedQuoteAmount.toString(),
    riskAmount: riskAmount.toString(),
    netRewardRisk: netRewardRisk.toString(),
    conservativeRewardRisk: conservativeRewardRisk.toString(),
    postTradeGrossExposure: input.currentGrossExposure.add(notional).toString(),
    postTradeAssetExposure: input.currentAssetExposure.add(notional).toString(),
    postTradeCorrelatedExposure: input.currentCorrelatedExposure.add(notional).toString()
  };
}
