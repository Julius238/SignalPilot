/**
 * Tick alignment of a candidate price plan (`PRICE_TICK_POLICY_VERSION`).
 *
 * Exchange prices live on a tick grid, and the risk engine refuses a stop that
 * is not on it (R-007). Both prices are snapped in the conservative direction:
 * the stop away from the entry, the take profit towards it. Risk per unit can
 * therefore only grow and planned reward only shrink — never the reverse.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

import { parseDecimalString } from "./validate-input.js";

/** The execution profile's tick size, or null when it is not a positive decimal. */
export function usableTickSize(tickSize: string): DecimalValue | null {
  const tick = parseDecimalString(tickSize);
  return tick !== null && tick.isPositive() ? tick : null;
}

/** Long stop rounds down, short stop rounds up: always away from the entry. */
export function alignStopToTick(
  direction: "LONG" | "SHORT",
  stopPrice: DecimalValue,
  tick: DecimalValue
): DecimalValue {
  return stopPrice.quantizeToStep(tick, direction === "LONG" ? RoundingMode.FLOOR : RoundingMode.CEIL);
}

/** Long target rounds down, short target rounds up: always towards the entry. */
export function alignTakeProfitToTick(
  direction: "LONG" | "SHORT",
  takeProfitPrice: DecimalValue,
  tick: DecimalValue
): DecimalValue {
  return takeProfitPrice.quantizeToStep(tick, direction === "LONG" ? RoundingMode.FLOOR : RoundingMode.CEIL);
}
