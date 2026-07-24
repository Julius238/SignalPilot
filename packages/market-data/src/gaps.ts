import { timeframeDurationMs, type CandleMarketKind } from "./candle-quality.js";

export type GapCandle = {
  openTime: Date | string;
  closeTime: Date | string;
};

export type CandleGap = {
  from: Date;
  to: Date;
  missingCandleCount: number;
};

export type CandleGapAudit = {
  oldestCandle: Date | null;
  latestClosedCandle: Date | null;
  candleCount: number;
  expectedCandleCount: number;
  gapCount: number;
  missingCandleCount: number;
  gaps: CandleGap[];
};

export function detectCandleGaps(
  candles: readonly GapCandle[],
  input: {
    timeframe: string;
    marketKind: CandleMarketKind;
    now?: Date;
    maxGaps?: number;
  }
): CandleGapAudit {
  const now = input.now ?? new Date();
  const durationMs = timeframeDurationMs(input.timeframe);
  const maxGaps = Math.max(1, input.maxGaps ?? 10_000);
  const closed = deduplicateClosedCandles(candles, now);

  if (closed.length === 0 || durationMs === null) {
    return {
      oldestCandle: closed[0]?.openTime ?? null,
      latestClosedCandle: closed.at(-1)?.closeTime ?? null,
      candleCount: closed.length,
      expectedCandleCount: closed.length,
      gapCount: 0,
      missingCandleCount: 0,
      gaps: []
    };
  }

  const missingTimes: Date[] = [];

  for (let index = 1; index < closed.length && missingTimes.length < maxGaps; index += 1) {
    const previous = closed[index - 1].openTime;
    const current = closed[index].openTime;

    for (
      let expected = previous.getTime() + durationMs;
      expected < current.getTime() && missingTimes.length < maxGaps;
      expected += durationMs
    ) {
      const candidate = new Date(expected);
      if (isExpectedSessionCandle(candidate, previous, current, input.timeframe, input.marketKind)) {
        missingTimes.push(candidate);
      }
    }
  }

  const gaps = groupMissingTimes(missingTimes, durationMs);

  return {
    oldestCandle: closed[0].openTime,
    latestClosedCandle: closed.at(-1)?.closeTime ?? null,
    candleCount: closed.length,
    expectedCandleCount: closed.length + missingTimes.length,
    gapCount: gaps.length,
    missingCandleCount: missingTimes.length,
    gaps
  };
}

function deduplicateClosedCandles(candles: readonly GapCandle[], now: Date) {
  const byOpenTime = new Map<number, { openTime: Date; closeTime: Date }>();

  for (const candle of candles) {
    const openTime = toDate(candle.openTime);
    const closeTime = toDate(candle.closeTime);
    if (!openTime || !closeTime || closeTime.getTime() > now.getTime()) continue;
    byOpenTime.set(openTime.getTime(), { openTime, closeTime });
  }

  return [...byOpenTime.values()].sort(
    (left, right) => left.openTime.getTime() - right.openTime.getTime()
  );
}

function isExpectedSessionCandle(
  candidate: Date,
  previous: Date,
  current: Date,
  timeframe: string,
  marketKind: CandleMarketKind
) {
  if (marketKind === "CONTINUOUS") return true;

  const weekday = candidate.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;

  if (timeframe.endsWith("h") || timeframe.endsWith("m")) {
    return utcDayKey(candidate) === utcDayKey(previous) && utcDayKey(candidate) === utcDayKey(current);
  }

  return true;
}

function groupMissingTimes(times: Date[], durationMs: number): CandleGap[] {
  const gaps: CandleGap[] = [];

  for (const time of times) {
    const last = gaps.at(-1);
    if (last && last.to.getTime() + durationMs === time.getTime()) {
      last.to = time;
      last.missingCandleCount += 1;
    } else {
      gaps.push({ from: time, to: time, missingCandleCount: 1 });
    }
  }

  return gaps;
}

function utcDayKey(date: Date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function toDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
