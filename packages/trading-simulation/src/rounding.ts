/**
 * Adverse rounding helpers shared by the fill simulation.
 *
 * Specification: docs/trading/07-shadow-execution-model.md, "Marktorder-Preis":
 * "Rundung ist advers: BUY-Fillpreis auf den nächsthöheren Tick;
 * SELL-Fillpreis auf den nächstniedrigeren Tick; Kauf-/Verkaufsmenge immer auf
 * die nächstkleinere Step Size; Gebühren ... zuungunsten des Portfolios
 * aufrunden."
 *
 * Every intermediate multiplication (mid -> half-spread -> slippage) also
 * rounds against the portfolio rather than raising `DECIMAL_ROUNDING_REQUIRED`
 * on an inexact result. That mirrors `packages/risk-engine/src/position-sizing.ts`
 * on purpose: the risk engine's worst-case entry/stop/take-profit prices and
 * this module's actual fill prices are the same cost model applied to
 * different reference prices, and only reusing the same rounding discipline
 * keeps them comparable.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

const BPS_DIVISOR = DecimalValue.fromSafeInteger(10_000);
const TWO = DecimalValue.fromSafeInteger(2);

/** Basis points to a decimal rate, e.g. `20` -> `0.002`. Exact: bps/10000 always terminates. */
export function rateFromBps(bps: number): DecimalValue | null {
  if (!Number.isSafeInteger(bps) || bps < 0) return null;
  return DecimalValue.fromSafeInteger(bps).div(BPS_DIVISOR, RoundingMode.EXACT);
}

/** Adverse buy price: mid + half spread, then adverse slippage, then up-tick. */
export function adverseBuyPrice(
  mid: DecimalValue,
  fullSpreadRate: DecimalValue,
  slippageRate: DecimalValue,
  tickSize: DecimalValue
): DecimalValue {
  const halfSpread = fullSpreadRate.div(TWO, RoundingMode.CEIL);
  return mid
    .mul(DecimalValue.ONE.add(halfSpread), RoundingMode.CEIL)
    .mul(DecimalValue.ONE.add(slippageRate), RoundingMode.CEIL)
    .quantizeToStep(tickSize, RoundingMode.CEIL);
}

/** Adverse sell price: mid - half spread, then adverse slippage, then down-tick. */
export function adverseSellPrice(
  mid: DecimalValue,
  fullSpreadRate: DecimalValue,
  slippageRate: DecimalValue,
  tickSize: DecimalValue
): DecimalValue {
  const halfSpread = fullSpreadRate.div(TWO, RoundingMode.CEIL);
  const sellFactor = DecimalValue.ONE.sub(halfSpread).mul(
    DecimalValue.ONE.sub(slippageRate),
    RoundingMode.FLOOR
  );
  return mid.mul(sellFactor, RoundingMode.FLOOR).quantizeToStep(tickSize, RoundingMode.FLOOR);
}

/** Fee rounds up against the portfolio. */
export function adverseFee(notional: DecimalValue, feeRate: DecimalValue): DecimalValue {
  return notional.mul(feeRate, RoundingMode.CEIL);
}

/** Quantity always rounds down to the step size — never up (docs/trading/07). */
export function floorToStep(value: DecimalValue, step: DecimalValue): DecimalValue {
  return value.isPositive() ? value.quantizeToStep(step, RoundingMode.FLOOR) : DecimalValue.ZERO;
}
