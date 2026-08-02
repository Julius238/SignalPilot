/**
 * Market-order fill simulation.
 *
 * Specification: docs/trading/07-shadow-execution-model.md,
 * "Marktorder-Preis", "Gebühren", "Instrumentminimum und Präzision",
 * "Liquidität und Teilausführungen", "Entry und Gap".
 *
 * A pure function of one candle, one order side/quantity and one immutable
 * execution-profile snapshot. It never reads a clock, a database or the
 * network, and it never claims a fill the candle cannot support: liquidity is
 * capped to a fraction of the candle's own base volume, never inferred from
 * an order book that does not exist in the data model.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

import type {
  CandleSnapshotV1,
  EntryGapCheckInputV1,
  EntryGapCheckResultV1,
  ExecutionProfileSnapshotV1,
  MarketFillComputationInputV1,
  MarketFillComputationResultV1
} from "./contracts.js";
import { MarketSide } from "./contracts.js";
import { SimulationReasonCode } from "./reason-codes.js";
import { adverseBuyPrice, adverseFee, adverseSellPrice, floorToStep, rateFromBps } from "./rounding.js";

export const MARKET_FILL_SIMULATION_VERSION = "market-fill-v1/1.0.0";

function decimalOrNull(value: string): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

function notFillable(
  reasonCode: SimulationReasonCode,
  referencePrice: string,
  assumptions: Readonly<Record<string, unknown>>
): MarketFillComputationResultV1 {
  const zero = DecimalValue.ZERO.toString();
  return {
    fillable: false,
    reasonCode,
    fillQuantity: zero,
    liquidityCap: zero,
    participationRate: zero,
    referencePrice,
    fullSpreadAmount: zero,
    slippageAmount: zero,
    fillPrice: zero,
    notional: zero,
    feeAmount: zero,
    feeRate: zero,
    assumptions
  };
}

function isValidCandle(candle: CandleSnapshotV1): boolean {
  const open = decimalOrNull(candle.open);
  const high = decimalOrNull(candle.high);
  const low = decimalOrNull(candle.low);
  const close = decimalOrNull(candle.close);
  const volume = decimalOrNull(candle.volume);
  if (open === null || high === null || low === null || close === null || volume === null) {
    return false;
  }
  if (!open.isPositive() || !high.isPositive() || !low.isPositive() || !close.isPositive()) {
    return false;
  }
  if (volume.isNegative()) return false;
  // low <= open/close <= high (docs/trading/05, "Vorvalidierung" 3).
  return (
    low.lte(open) &&
    open.lte(high) &&
    low.lte(close) &&
    close.lte(high) &&
    low.lte(high)
  );
}

function isValidExecutionProfile(profile: ExecutionProfileSnapshotV1): boolean {
  const tick = decimalOrNull(profile.tickSize);
  const step = decimalOrNull(profile.stepSize);
  const minQuantity = decimalOrNull(profile.minQuantity);
  const minNotional = decimalOrNull(profile.minNotional);
  const participation = decimalOrNull(profile.maxParticipationRate);
  if (tick === null || step === null || minQuantity === null || minNotional === null || participation === null) {
    return false;
  }
  if (!tick.isPositive() || !step.isPositive() || !participation.isPositive()) return false;
  if (minQuantity.isNegative() || minNotional.isNegative()) return false;
  if (!Number.isSafeInteger(profile.feeBps) || profile.feeBps < 0) return false;
  if (!Number.isSafeInteger(profile.fullSpreadBps) || profile.fullSpreadBps < 0) return false;
  if (!Number.isSafeInteger(profile.slippageBps) || profile.slippageBps < 0) return false;
  return true;
}

/**
 * Compute one candle's market-order fill, if any. Returns `fillable: false`
 * (never throws) for a candle the caller should simply wait past — an
 * invalid candle or execution profile, no liquidity, an amount below the
 * instrument minimum. `RESERVE_EXCEEDED` and `SELL_EXCEEDS_OPEN_QUANTITY` are
 * distinguished separately because they signal an upstream invariant
 * violation the caller must not silently swallow (docs/trading/07,
 * "Fehlerbehandlung").
 */
export function computeMarketFill(
  input: MarketFillComputationInputV1
): MarketFillComputationResultV1 {
  const assumptionsBase = {
    simulationVersion: MARKET_FILL_SIMULATION_VERSION,
    side: input.side,
    sourceCandleId: input.candle.id
  };

  if (!isValidCandle(input.candle)) {
    return notFillable(SimulationReasonCode.INVALID_CANDLE, input.referencePrice, assumptionsBase);
  }
  if (!isValidExecutionProfile(input.executionProfile)) {
    return notFillable(
      SimulationReasonCode.INVALID_EXECUTION_PROFILE,
      input.referencePrice,
      assumptionsBase
    );
  }

  const referencePrice = decimalOrNull(input.referencePrice);
  const requestedQuantity = decimalOrNull(input.requestedQuantity);
  if (referencePrice === null || !referencePrice.isPositive() || requestedQuantity === null || !requestedQuantity.isPositive()) {
    return notFillable(
      SimulationReasonCode.INVALID_REQUESTED_QUANTITY,
      input.referencePrice,
      assumptionsBase
    );
  }

  const profile = input.executionProfile;
  const tickSize = DecimalValue.fromString(profile.tickSize);
  const stepSize = DecimalValue.fromString(profile.stepSize);
  const minQuantity = DecimalValue.fromString(profile.minQuantity);
  const minNotional = DecimalValue.fromString(profile.minNotional);
  const maxQuantity = profile.maxQuantity === null ? null : DecimalValue.fromString(profile.maxQuantity);
  const volume = DecimalValue.fromString(input.candle.volume);
  const participationRate = DecimalValue.fromString(profile.maxParticipationRate);

  const fullSpreadRate = rateFromBps(profile.fullSpreadBps);
  const slippageRate = rateFromBps(profile.slippageBps);
  const feeRate = rateFromBps(profile.feeBps);
  if (fullSpreadRate === null || slippageRate === null || feeRate === null) {
    return notFillable(
      SimulationReasonCode.INVALID_EXECUTION_PROFILE,
      input.referencePrice,
      assumptionsBase
    );
  }

  // Liquidity cap: 1 % (v1) of the candle's own base volume, floored to the
  // step size — never an order-book measurement (docs/trading/07).
  const liquidityCap = floorToStep(volume.mul(participationRate, RoundingMode.FLOOR), stepSize);
  let fillQuantity = DecimalValue.min(requestedQuantity, liquidityCap);
  if (input.side === MarketSide.SELL && input.openQuantity !== undefined) {
    const open = decimalOrNull(input.openQuantity);
    if (open === null || open.isNegative()) {
      return notFillable(
        SimulationReasonCode.SELL_EXCEEDS_OPEN_QUANTITY,
        input.referencePrice,
        assumptionsBase
      );
    }
    if (fillQuantity.gt(open)) fillQuantity = floorToStep(open, stepSize);
  }
  if (maxQuantity !== null && fillQuantity.gt(maxQuantity)) {
    fillQuantity = floorToStep(maxQuantity, stepSize);
  }

  const assumptions = {
    ...assumptionsBase,
    candleVolume: input.candle.volume,
    maxParticipationRate: profile.maxParticipationRate,
    requestedQuantity: input.requestedQuantity
  };

  if (!fillQuantity.isPositive()) {
    return notFillable(SimulationReasonCode.NO_LIQUIDITY, input.referencePrice, assumptions);
  }
  if (fillQuantity.lt(minQuantity)) {
    return notFillable(SimulationReasonCode.BELOW_MIN_QUANTITY, input.referencePrice, assumptions);
  }

  const fillPrice =
    input.side === MarketSide.BUY
      ? adverseBuyPrice(referencePrice, fullSpreadRate, slippageRate, tickSize)
      : adverseSellPrice(referencePrice, fullSpreadRate, slippageRate, tickSize);

  if (!fillPrice.isPositive()) {
    return notFillable(SimulationReasonCode.ARITHMETIC_ERROR, input.referencePrice, assumptions);
  }

  const notional = fillQuantity.mul(fillPrice, RoundingMode.FLOOR);
  if (notional.lt(minNotional)) {
    return notFillable(SimulationReasonCode.BELOW_MIN_NOTIONAL, input.referencePrice, assumptions);
  }

  const feeAmount = adverseFee(notional, feeRate);

  if (input.side === MarketSide.BUY && input.reservedQuoteAmount !== undefined) {
    const reserve = decimalOrNull(input.reservedQuoteAmount);
    if (reserve === null || notional.add(feeAmount).gt(reserve)) {
      return notFillable(SimulationReasonCode.RESERVE_EXCEEDED, input.referencePrice, {
        ...assumptions,
        reservedQuoteAmount: input.reservedQuoteAmount
      });
    }
  }

  const halfSpreadAmount = referencePrice
    .mul(fullSpreadRate.div(DecimalValue.fromSafeInteger(2), RoundingMode.CEIL), RoundingMode.CEIL)
    .abs();

  return {
    fillable: true,
    reasonCode: SimulationReasonCode.FILLED,
    fillQuantity: fillQuantity.toString(),
    liquidityCap: liquidityCap.toString(),
    participationRate: profile.maxParticipationRate,
    referencePrice: referencePrice.toString(),
    fullSpreadAmount: halfSpreadAmount.mul(DecimalValue.fromSafeInteger(2), RoundingMode.CEIL).toString(),
    slippageAmount: fillPrice.sub(referencePrice).abs().toString(),
    fillPrice: fillPrice.toString(),
    notional: notional.toString(),
    feeAmount: feeAmount.toString(),
    feeRate: feeRate.toString(),
    assumptions: {
      ...assumptions,
      fullSpreadBps: profile.fullSpreadBps,
      slippageBps: profile.slippageBps,
      feeBps: profile.feeBps,
      tickSize: profile.tickSize,
      stepSize: profile.stepSize,
      executionProfileId: profile.id,
      executionProfileSpecificationHash: profile.specificationHash
    }
  };
}

/**
 * Entry-gap guard (docs/trading/07, "Entry und Gap" item 4): if the first
 * eligible candle opens more than the strategy's planned maximum above the
 * reference entry, the whole unfilled entry expires — the simulation never
 * chases a gapped-up open.
 */
export function checkEntryGap(input: EntryGapCheckInputV1): EntryGapCheckResultV1 {
  const open = decimalOrNull(input.candleOpen);
  const maximum = decimalOrNull(input.plannedEntryMaximum);
  if (open === null || maximum === null) {
    return { gapTooLarge: true, reasonCode: SimulationReasonCode.INVALID_CANDLE };
  }
  return open.gt(maximum)
    ? { gapTooLarge: true, reasonCode: SimulationReasonCode.ENTRY_GAP_TOO_LARGE }
    : { gapTooLarge: false, reasonCode: SimulationReasonCode.FILLED };
}
