/**
 * Direction-aware price-plan rules, shared by every layer that has to reason
 * about a long or a short plan.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md ("Candidate-Preisplan"),
 * docs/trading/06-risk-engine-specification.md (`R-007`, `R-008`) and
 * docs/trading/decisions/0011-separate-long-and-short-strategies.md.
 *
 * This module exists so the ordering rule is written down exactly once. A
 * long plan and a short plan are mirror images, and mirroring by hand at each
 * call site is precisely how a sign error gets into money arithmetic:
 *
 *   LONG   takeProfitPrice > entryPrice > stopPrice
 *   SHORT  stopPrice       > entryPrice > takeProfitPrice
 *
 * Everything here is pure and works on `DecimalValue`; no clock, no
 * environment, no database.
 */

import { DecimalValue } from "./decimal.js";
import {
  TradeDirection,
  TradingReasonCode,
  guardFail,
  guardOk,
  isTradeDirection,
  type DecimalString,
  type GuardResult
} from "./types.js";

export interface DirectionalPricePlan {
  readonly direction: TradeDirection;
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly takeProfitPrice: DecimalString;
}

function parse(value: DecimalString): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

/**
 * Strict ordering check. Every price must be strictly positive and the three
 * must be strictly ordered for the direction — equal prices are refused too,
 * because a zero-width stop or target is not a tradeable plan.
 */
export function checkPricePlanOrdering(
  plan: DirectionalPricePlan
): GuardResult {
  if (!isTradeDirection(plan.direction)) {
    return guardFail(
      TradingReasonCode.DIRECTION_UNKNOWN,
      `Unknown direction ${String(plan.direction)}.`
    );
  }

  const entry = parse(plan.entryPrice);
  const stop = parse(plan.stopPrice);
  const takeProfit = parse(plan.takeProfitPrice);
  if (entry === null || stop === null || takeProfit === null) {
    return guardFail(
      TradingReasonCode.PRICE_PLAN_NOT_POSITIVE,
      "A price in the plan is not a decimal value."
    );
  }
  if (!entry.isPositive() || !stop.isPositive() || !takeProfit.isPositive()) {
    return guardFail(
      TradingReasonCode.PRICE_PLAN_NOT_POSITIVE,
      "Every price in the plan must be greater than zero."
    );
  }

  const ordered =
    plan.direction === TradeDirection.LONG
      ? takeProfit.gt(entry) && entry.gt(stop)
      : stop.gt(entry) && entry.gt(takeProfit);

  return ordered
    ? guardOk()
    : guardFail(
        TradingReasonCode.PRICE_PLAN_NOT_ORDERED,
        plan.direction === TradeDirection.LONG
          ? "A LONG plan requires takeProfitPrice > entryPrice > stopPrice."
          : "A SHORT plan requires stopPrice > entryPrice > takeProfitPrice."
      );
}

/**
 * Absolute distance from entry to stop. Identical formula for both
 * directions — the sign lives in the ordering, not in the distance.
 */
export function stopDistance(plan: DirectionalPricePlan): DecimalValue | null {
  const entry = parse(plan.entryPrice);
  const stop = parse(plan.stopPrice);
  if (entry === null || stop === null) return null;
  return plan.direction === TradeDirection.LONG
    ? entry.sub(stop)
    : stop.sub(entry);
}

/** Absolute distance from entry to take profit. */
export function takeProfitDistance(
  plan: DirectionalPricePlan
): DecimalValue | null {
  const entry = parse(plan.entryPrice);
  const takeProfit = parse(plan.takeProfitPrice);
  if (entry === null || takeProfit === null) return null;
  return plan.direction === TradeDirection.LONG
    ? takeProfit.sub(entry)
    : entry.sub(takeProfit);
}

/**
 * True when `price` has moved to or past the stop for this direction — the
 * adverse side. Long stops trigger on a falling price, short stops on a
 * rising one.
 */
export function isStopTriggered(
  direction: TradeDirection,
  stopPrice: DecimalValue,
  price: DecimalValue
): boolean {
  return direction === TradeDirection.LONG
    ? price.lte(stopPrice)
    : price.gte(stopPrice);
}

/**
 * True when `price` has moved to or past the take profit — the favourable
 * side. Long targets trigger on a rising price, short targets on a falling one.
 */
export function isTakeProfitTriggered(
  direction: TradeDirection,
  takeProfitPrice: DecimalValue,
  price: DecimalValue
): boolean {
  return direction === TradeDirection.LONG
    ? price.gte(takeProfitPrice)
    : price.lte(takeProfitPrice);
}

/**
 * Realised profit and loss of a closed quantity, per direction.
 *
 *   LONG   (exit − entry) × quantity
 *   SHORT  (entry − exit) × quantity
 *
 * Gross of fees; the caller subtracts them.
 */
export function grossPnl(
  direction: TradeDirection,
  entryPrice: DecimalValue,
  exitPrice: DecimalValue,
  quantity: DecimalValue,
  mode: Parameters<DecimalValue["mul"]>[1]
): DecimalValue {
  const perUnit =
    direction === TradeDirection.LONG
      ? exitPrice.sub(entryPrice)
      : entryPrice.sub(exitPrice);
  return perUnit.mul(quantity, mode);
}

/**
 * The order side that opens a position in this direction, and the side that
 * closes it. A shadow short "sells to open" and "buys to close" — synthetic
 * only: no borrow is modelled anywhere (ADR 0012).
 */
export const ENTRY_SIDE: Readonly<Record<TradeDirection, "BUY" | "SELL">> =
  Object.freeze({
    [TradeDirection.LONG]: "BUY",
    [TradeDirection.SHORT]: "SELL"
  });

export const EXIT_SIDE: Readonly<Record<TradeDirection, "BUY" | "SELL">> =
  Object.freeze({
    [TradeDirection.LONG]: "SELL",
    [TradeDirection.SHORT]: "BUY"
  });
