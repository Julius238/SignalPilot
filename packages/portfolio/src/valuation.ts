/**
 * Conservative mark-to-market, equity and drawdown.
 *
 * Specification: docs/trading/07-shadow-execution-model.md, "Realisiert,
 * unrealisiert und Equity".
 *
 * "Mark ist Candle-Close mit halbem Sell-Spread, ohne zusätzliche Slippage" —
 * deliberately less pessimistic than an actual exit fill (which also pays
 * slippage and a fee), because this is a *valuation*, not a claim about what
 * an exit would net. `computePositionMark` additionally deducts an estimated
 * exit fee so unrealized P&L is not overstated by ignoring the cost of ever
 * closing the position.
 */

import {
  DecimalValue,
  RoundingMode,
  TradeDirection,
  type DecimalString,
  type TradeDirection as TradeDirectionValue
} from "@signalpilot/trading-domain";
import { rateFromBps } from "@signalpilot/trading-simulation";

import type {
  PortfolioValuationInputV1,
  PortfolioValuationResultV1,
  PositionMarkInputV1,
  PositionMarkResultV1
} from "./contracts.js";

function decimalOrNull(value: string): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

const TWO = DecimalValue.fromSafeInteger(2);

/**
 * Conservative bid mark: candle close reduced by half the modelled full
 * spread, floored to the tick if one is supplied. No slippage is applied —
 * slippage is charged only when an actual exit fill happens.
 */
export function computeConservativeBidMark(
  closePrice: string,
  fullSpreadBps: number,
  tickSize: string | null
): DecimalString | null {
  const close = decimalOrNull(closePrice);
  const rate = rateFromBps(fullSpreadBps);
  if (close === null || !close.isPositive() || rate === null) return null;
  const halfSpread = rate.div(TWO, RoundingMode.CEIL);
  const mark = close.mul(DecimalValue.ONE.sub(halfSpread), RoundingMode.FLOOR);
  if (tickSize === null) return mark.toString();
  const tick = decimalOrNull(tickSize);
  if (tick === null || !tick.isPositive()) return mark.toString();
  return mark.quantizeToStep(tick, RoundingMode.FLOOR).toString();
}

/** Directional conservative close mark: bid for LONG, ask for SHORT. */
export function computeConservativeMark(
  direction: TradeDirectionValue,
  closePrice: string,
  fullSpreadBps: number,
  tickSize: string | null
): DecimalString | null {
  if (direction === TradeDirection.LONG) {
    return computeConservativeBidMark(closePrice, fullSpreadBps, tickSize);
  }
  if (direction !== TradeDirection.SHORT) return null;
  const close = decimalOrNull(closePrice);
  const rate = rateFromBps(fullSpreadBps);
  if (close === null || !close.isPositive() || rate === null) return null;
  const halfSpread = rate.div(TWO, RoundingMode.CEIL);
  const mark = close.mul(DecimalValue.ONE.add(halfSpread), RoundingMode.CEIL);
  if (tickSize === null) return mark.toString();
  const tick = decimalOrNull(tickSize);
  if (tick === null || !tick.isPositive()) return mark.toString();
  return mark.quantizeToStep(tick, RoundingMode.CEIL).toString();
}

/** Open quantity × (mark - average entry), minus an estimated exit fee. */
export function computePositionMark(
  input: PositionMarkInputV1
): PositionMarkResultV1 | null {
  const quantity = decimalOrNull(input.openQuantity);
  const averageEntry = decimalOrNull(input.averageEntryPrice);
  const mark = decimalOrNull(input.conservativeBidMark);
  const feeRate = decimalOrNull(input.estimatedExitFeeRate);
  if (
    quantity === null ||
    quantity.isNegative() ||
    averageEntry === null ||
    !averageEntry.isPositive() ||
    mark === null ||
    !mark.isPositive() ||
    feeRate === null ||
    feeRate.isNegative()
  ) {
    return null;
  }

  const marketValue = quantity.mul(mark, RoundingMode.FLOOR);
  const estimatedExitFee = marketValue.mul(feeRate, RoundingMode.CEIL);
  const grossUnrealized =
    input.direction === TradeDirection.LONG
      ? mark.sub(averageEntry).mul(quantity, RoundingMode.FLOOR)
      : input.direction === TradeDirection.SHORT
        ? averageEntry.sub(mark).mul(quantity, RoundingMode.FLOOR)
        : null;
  if (grossUnrealized === null) return null;
  const unrealizedPnl = grossUnrealized.sub(estimatedExitFee);
  const equityContribution =
    input.direction === TradeDirection.LONG ? marketValue : unrealizedPnl;

  return {
    marketValue: marketValue.toString(),
    unrealizedPnl: unrealizedPnl.toString(),
    equityContribution: equityContribution.toString()
  };
}

/**
 * Portfolio-level roll-up: equity, drawdown against the high-water mark, and
 * daily P&L when a start-of-day equity is supplied. The high-water mark is
 * never lowered here — it only ever rises, and only when the caller confirms
 * a reconciled snapshot backs this valuation (docs/trading/07, "High Water
 * Mark steigt nur mit einem reconciled Snapshot").
 */
export function computePortfolioValuation(
  input: PortfolioValuationInputV1
): PortfolioValuationResultV1 | null {
  const availableCash = decimalOrNull(input.availableCash);
  const reservedCash = decimalOrNull(input.reservedCash);
  const priorHighWaterMark = decimalOrNull(input.highWaterMark);
  if (
    availableCash === null ||
    reservedCash === null ||
    priorHighWaterMark === null
  )
    return null;

  let marketValue = DecimalValue.ZERO;
  let unrealizedPnl = DecimalValue.ZERO;
  let equityContribution = DecimalValue.ZERO;
  for (const mark of input.openPositionMarks) {
    const marketValueEntry = decimalOrNull(mark.marketValue);
    const unrealizedEntry = decimalOrNull(mark.unrealizedPnl);
    const equityEntry = decimalOrNull(mark.equityContribution);
    if (
      marketValueEntry === null ||
      unrealizedEntry === null ||
      equityEntry === null
    )
      return null;
    marketValue = marketValue.add(marketValueEntry);
    unrealizedPnl = unrealizedPnl.add(unrealizedEntry);
    equityContribution = equityContribution.add(equityEntry);
  }

  const equity = availableCash.add(reservedCash).add(equityContribution);
  const highWaterMark = DecimalValue.max(priorHighWaterMark, equity);
  const drawdownAmount = highWaterMark.sub(equity);
  const drawdownPct = highWaterMark.isPositive()
    ? drawdownAmount.div(highWaterMark, RoundingMode.CEIL)
    : DecimalValue.ZERO;

  let dailyPnl: string | null = null;
  if (input.startOfDayEquity !== null) {
    const startOfDay = decimalOrNull(input.startOfDayEquity);
    if (startOfDay === null) return null;
    dailyPnl = equity.sub(startOfDay).toString();
  }

  return {
    marketValue: marketValue.toString(),
    unrealizedPnl: unrealizedPnl.toString(),
    equity: equity.toString(),
    dailyPnl,
    highWaterMark: highWaterMark.toString(),
    drawdownAmount: drawdownAmount.toString(),
    drawdownPct: drawdownPct.toString()
  };
}
