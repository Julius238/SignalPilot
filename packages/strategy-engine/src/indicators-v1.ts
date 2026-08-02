/**
 * Indicator formulas pinned to strategy v1.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md,
 * "Indikatorformeln müssen für Strategy v1 gepinnt und in Unit-/Golden-Tests
 * gegen `packages/indicators` verglichen werden. Die Strategy Engine darf nicht
 * stillschweigend eine später geänderte Indikatorsemantik übernehmen."
 *
 * The semantics deliberately mirror `@signalpilot/indicators` at the time of
 * pinning — simple (not Wilder-smoothed) RSI and ATR averages — but the
 * arithmetic runs on `DecimalValue` instead of IEEE-754 doubles, because every
 * price comparison in this package feeds a money decision (docs/trading/02,
 * "JavaScript-Float ist für Persistenz, Mengen- oder Risikorechnung
 * unzulässig"). `test/indicators-v1.test.ts` compares both implementations.
 *
 * Two windows differ from the existing package on purpose and only here:
 *   - `priorPeriodHigh` and `averageVolume` operate on the candles *before* the
 *     anchor, because docs/trading/05 requires the breakout reference window to
 *     exclude `C0`;
 *   - divisions round HALF_UP at scale 12 instead of raising, so an average is
 *     always representable.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

/** Version of the pinned formulas; part of every input snapshot. */
export const INDICATORS_V1_VERSION = "strategy-indicators-v1/1.0.0";

/** Rounding used by every division in this module. */
export const INDICATOR_ROUNDING = RoundingMode.HALF_UP;

const HUNDRED = DecimalValue.fromSafeInteger(100);
const FIFTY = DecimalValue.fromSafeInteger(50);

/** Decimal OHLCV candle as the pinned formulas consume it. */
export interface PinnedCandle {
  readonly open: DecimalValue;
  readonly high: DecimalValue;
  readonly low: DecimalValue;
  readonly close: DecimalValue;
  readonly volume: DecimalValue;
}

function isUsablePeriod(period: number): boolean {
  return Number.isSafeInteger(period) && period > 0;
}

/** Arithmetic mean at scale 12, HALF_UP. */
export function mean(values: readonly DecimalValue[]): DecimalValue | null {
  if (values.length === 0) return null;
  const total = DecimalValue.sum(values);
  return total.div(DecimalValue.fromSafeInteger(values.length), INDICATOR_ROUNDING);
}

/** Simple moving average over the last `period` values. */
export function simpleMovingAverage(
  values: readonly DecimalValue[],
  period: number
): DecimalValue | null {
  if (!isUsablePeriod(period) || values.length < period) return null;
  return mean(values.slice(values.length - period));
}

/**
 * RSI over the last `period` price changes, i.e. the last `period + 1` closes.
 * A flat series returns 50, a series without losses returns 100 — same
 * convention as `@signalpilot/indicators`.
 */
export function relativeStrengthIndex(
  closes: readonly DecimalValue[],
  period = 14
): DecimalValue | null {
  if (!isUsablePeriod(period) || closes.length < period + 1) return null;

  const window = closes.slice(closes.length - (period + 1));
  let gains = DecimalValue.ZERO;
  let losses = DecimalValue.ZERO;

  for (let index = 1; index < window.length; index += 1) {
    const change = window[index].sub(window[index - 1]);
    if (change.isPositive()) {
      gains = gains.add(change);
    } else {
      losses = losses.add(change.abs());
    }
  }

  const periodValue = DecimalValue.fromSafeInteger(period);
  const averageGain = gains.div(periodValue, INDICATOR_ROUNDING);
  const averageLoss = losses.div(periodValue, INDICATOR_ROUNDING);

  if (averageLoss.isZero()) {
    return averageGain.isZero() ? FIFTY : HUNDRED;
  }

  const relativeStrength = averageGain.div(averageLoss, INDICATOR_ROUNDING);
  return HUNDRED.sub(HUNDRED.div(DecimalValue.ONE.add(relativeStrength), INDICATOR_ROUNDING));
}

/** True range of `current` against the previous close. */
export function trueRange(current: PinnedCandle, previous: PinnedCandle): DecimalValue {
  const highLow = current.high.sub(current.low);
  const highPreviousClose = current.high.sub(previous.close).abs();
  const lowPreviousClose = current.low.sub(previous.close).abs();
  return DecimalValue.max(highLow, DecimalValue.max(highPreviousClose, lowPreviousClose));
}

/** ATR as the mean of the last `period` true ranges. */
export function averageTrueRange(
  candles: readonly PinnedCandle[],
  period = 14
): DecimalValue | null {
  if (!isUsablePeriod(period) || candles.length < period + 1) return null;

  const window = candles.slice(candles.length - (period + 1));
  const ranges: DecimalValue[] = [];
  for (let index = 1; index < window.length; index += 1) {
    ranges.push(trueRange(window[index], window[index - 1]));
  }
  return mean(ranges);
}

/**
 * Highest high of the `period` candles that end immediately before `series`'s
 * last entry. The anchor candle itself is excluded — docs/trading/05:
 * "`C0` selbst darf nicht im Vergleichsfenster liegen".
 */
export function priorPeriodHigh(
  candles: readonly PinnedCandle[],
  period = 20
): DecimalValue | null {
  if (!isUsablePeriod(period) || candles.length < period + 1) return null;
  const window = candles.slice(candles.length - (period + 1), candles.length - 1);
  return window.reduce<DecimalValue>((highest, candle) => DecimalValue.max(highest, candle.high), window[0].high);
}

/**
 * Mean volume of the `period` candles immediately before the last entry. The
 * anchor candle is excluded so relative volume compares it against its own
 * history rather than against a window containing itself.
 */
export function priorAverageVolume(
  candles: readonly PinnedCandle[],
  period = 20
): DecimalValue | null {
  if (!isUsablePeriod(period) || candles.length < period + 1) return null;
  const window = candles.slice(candles.length - (period + 1), candles.length - 1);
  return mean(window.map((candle) => candle.volume));
}

/** `volume / averageVolume`; null when the average is zero or missing. */
export function relativeVolume(
  volume: DecimalValue,
  averageVolume: DecimalValue | null
): DecimalValue | null {
  if (averageVolume === null || averageVolume.isZero() || averageVolume.isNegative()) return null;
  return volume.div(averageVolume, INDICATOR_ROUNDING);
}

/** `atr / close`; null when the close is not strictly positive. */
export function atrToCloseRatio(
  atr: DecimalValue | null,
  close: DecimalValue
): DecimalValue | null {
  if (atr === null || !close.isPositive()) return null;
  return atr.div(close, INDICATOR_ROUNDING);
}
