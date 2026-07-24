export type CandleMarketKind = "CONTINUOUS" | "SESSION";

export type TimedCandle = {
  closeTime: Date | string;
};

export type CandleSeriesQuality<T extends TimedCandle> = {
  closedCandles: T[];
  openOrInvalidCandleCount: number;
  latestCloseTime: Date | null;
  ageMs: number | null;
  isFresh: boolean;
  reason: "OK" | "INSUFFICIENT_CLOSED_CANDLES" | "STALE_DATA";
};

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

export function assessCandleSeriesQuality<T extends TimedCandle>(
  candles: readonly T[],
  input: {
    now?: Date;
    timeframe: string;
    marketKind: CandleMarketKind;
    minimumClosedCandles: number;
    maxAgeMs?: number;
  }
): CandleSeriesQuality<T> {
  const now = input.now ?? new Date();
  const closedCandles = candles
    .filter((candle) => isCandleClosed(candle, now))
    .sort((left, right) => toTimestamp(left.closeTime) - toTimestamp(right.closeTime));
  const openOrInvalidCandleCount = candles.length - closedCandles.length;
  const latestCloseTime = toValidDate(closedCandles.at(-1)?.closeTime);

  if (closedCandles.length < input.minimumClosedCandles || !latestCloseTime) {
    return {
      closedCandles,
      openOrInvalidCandleCount,
      latestCloseTime,
      ageMs: latestCloseTime ? Math.max(0, now.getTime() - latestCloseTime.getTime()) : null,
      isFresh: false,
      reason: "INSUFFICIENT_CLOSED_CANDLES"
    };
  }

  const ageMs = Math.max(0, now.getTime() - latestCloseTime.getTime());
  const maxAgeMs =
    input.maxAgeMs ?? defaultMaxCandleAgeMs(input.timeframe, input.marketKind);
  const isFresh = ageMs <= maxAgeMs;

  return {
    closedCandles,
    openOrInvalidCandleCount,
    latestCloseTime,
    ageMs,
    isFresh,
    reason: isFresh ? "OK" : "STALE_DATA"
  };
}

export function isCandleClosed(candle: TimedCandle, now: Date = new Date()): boolean {
  const closeTime = toValidDate(candle.closeTime);
  return closeTime !== null && closeTime.getTime() <= now.getTime();
}

export function isTimestampFresh(
  timestamp: Date | string,
  timeframe: string,
  marketKind: CandleMarketKind,
  now: Date = new Date()
): boolean {
  const date = toValidDate(timestamp);

  if (!date || date.getTime() > now.getTime()) {
    return false;
  }

  return now.getTime() - date.getTime() <= defaultMaxCandleAgeMs(timeframe, marketKind);
}

export function defaultMaxCandleAgeMs(
  timeframe: string,
  marketKind: CandleMarketKind
): number {
  if (marketKind === "SESSION") {
    return timeframe === "1d" ? 5 * dayMs : 4 * dayMs;
  }

  const durationMs = timeframeDurationMs(timeframe);
  return durationMs === null ? 2 * dayMs : durationMs * 2 + 15 * minuteMs;
}

export function timeframeDurationMs(timeframe: string): number | null {
  const match = /^(\d+)(m|h|d)$/.exec(timeframe);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  if (unit === "m") {
    return amount * minuteMs;
  }

  if (unit === "h") {
    return amount * hourMs;
  }

  return amount * dayMs;
}

function toTimestamp(value: Date | string): number {
  return toValidDate(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function toValidDate(value: Date | string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
