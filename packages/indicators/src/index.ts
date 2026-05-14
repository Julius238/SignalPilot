import type { IndicatorSnapshot } from "@signalpilot/shared";

import type { IndicatorCandle } from "./types.js";

export type { IndicatorCandle };

export function calculateSMA(values: readonly unknown[], period: number): number | null {
  if (!isValidPeriod(period) || values.length < period) {
    return null;
  }

  const window = values.slice(-period).map(toFiniteNonNegativeNumber);

  if (window.some((value) => value === null)) {
    return null;
  }

  return average(window as number[]);
}

export function calculateEMA(values: readonly unknown[], period: number): number | null {
  if (!isValidPeriod(period) || values.length < period) {
    return null;
  }

  const numbers = values.map(toFiniteNonNegativeNumber);

  if (numbers.some((value) => value === null)) {
    return null;
  }

  const typedNumbers = numbers as number[];
  const smoothing = 2 / (period + 1);
  let ema = average(typedNumbers.slice(0, period));

  for (const value of typedNumbers.slice(period)) {
    ema = value * smoothing + ema * (1 - smoothing);
  }

  return ema;
}

export function calculateRSI(closes: readonly unknown[], period = 14): number | null {
  if (!isValidPeriod(period) || closes.length < period + 1) {
    return null;
  }

  const values = closes.map(toFiniteNonNegativeNumber);

  if (values.some((value) => value === null)) {
    return null;
  }

  const typedValues = values as number[];
  const recent = typedValues.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < recent.length; index += 1) {
    const change = recent[index] - recent[index - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

export function calculateATR(candles: readonly IndicatorCandle[], period = 14): number | null {
  if (!isValidPeriod(period) || candles.length < period + 1) {
    return null;
  }

  const normalized = normalizeCandles(candles);

  if (normalized === null) {
    return null;
  }

  const recent = normalized.slice(-period - 1);
  const trueRanges: number[] = [];

  for (let index = 1; index < recent.length; index += 1) {
    const current = recent[index];
    const previous = recent[index - 1];
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  return average(trueRanges);
}

export function calculateAverageVolume(
  candles: readonly Pick<IndicatorCandle, "volume">[],
  period = 20
): number | null {
  if (!isValidPeriod(period) || candles.length < period) {
    return null;
  }

  const volumes = candles.slice(-period).map((candle) => toFiniteNonNegativeNumber(candle.volume));

  if (volumes.some((volume) => volume === null)) {
    return null;
  }

  return average(volumes as number[]);
}

export function calculateRelativeVolume(
  currentVolume: unknown,
  averageVolume: unknown
): number | null {
  const current = toFiniteNonNegativeNumber(currentVolume);
  const averageVolumeValue = toFiniteNonNegativeNumber(averageVolume);

  if (current === null || averageVolumeValue === null || averageVolumeValue === 0) {
    return null;
  }

  return current / averageVolumeValue;
}

export function calculatePeriodHigh(
  candles: readonly Pick<IndicatorCandle, "high">[],
  period = 20
): number | null {
  if (!isValidPeriod(period) || candles.length < period) {
    return null;
  }

  const highs = candles.slice(-period).map((candle) => toFiniteNonNegativeNumber(candle.high));

  if (highs.some((high) => high === null)) {
    return null;
  }

  return Math.max(...(highs as number[]));
}

export function calculatePeriodLow(
  candles: readonly Pick<IndicatorCandle, "low">[],
  period = 20
): number | null {
  if (!isValidPeriod(period) || candles.length < period) {
    return null;
  }

  const lows = candles.slice(-period).map((candle) => toFiniteNonNegativeNumber(candle.low));

  if (lows.some((low) => low === null)) {
    return null;
  }

  return Math.min(...(lows as number[]));
}

export function buildIndicatorSnapshot(candles: readonly IndicatorCandle[]): IndicatorSnapshot {
  const normalized = normalizeCandles(candles);

  if (normalized === null || normalized.length === 0) {
    return emptySnapshot(candles.length);
  }

  const closes = normalized.map((candle) => candle.close);
  const lastCandle = normalized.at(-1);
  const averageVolume20 = calculateAverageVolume(normalized, 20);
  const lastVolume = lastCandle?.volume ?? null;

  return {
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: calculateSMA(closes, 200),
    ema20: calculateEMA(closes, 20),
    rsi14: calculateRSI(closes, 14),
    atr14: calculateATR(normalized, 14),
    averageVolume20,
    relativeVolume:
      lastVolume === null ? null : calculateRelativeVolume(lastVolume, averageVolume20),
    periodHigh20: calculatePeriodHigh(normalized, 20),
    periodLow20: calculatePeriodLow(normalized, 20),
    lastClose: lastCandle?.close ?? null,
    lastVolume,
    candleCount: normalized.length
  };
}

function normalizeCandles(candles: readonly IndicatorCandle[]) {
  const normalized = candles.map((candle) => {
    const high = toFiniteNonNegativeNumber(candle.high);
    const low = toFiniteNonNegativeNumber(candle.low);
    const close = toFiniteNonNegativeNumber(candle.close);
    const volume = toFiniteNonNegativeNumber(candle.volume);

    if (high === null || low === null || close === null || volume === null || high < low) {
      return null;
    }

    return {
      high,
      low,
      close,
      volume
    };
  });

  if (normalized.some((candle) => candle === null)) {
    return null;
  }

  return normalized as Array<{ high: number; low: number; close: number; volume: number }>;
}

function emptySnapshot(candleCount: number): IndicatorSnapshot {
  return {
    sma20: null,
    sma50: null,
    sma200: null,
    ema20: null,
    rsi14: null,
    atr14: null,
    averageVolume20: null,
    relativeVolume: null,
    periodHigh20: null,
    periodLow20: null,
    lastClose: null,
    lastVolume: null,
    candleCount
  };
}

function toFiniteNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function isValidPeriod(period: number): boolean {
  return Number.isInteger(period) && period > 0;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
