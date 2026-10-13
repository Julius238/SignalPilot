/**
 * Deterministic synthetic market for tests and local end-to-end runs.
 *
 * Seeded random walk with alternating trend regimes and occasional volume
 * bursts, so breakout setups actually occur. Every candle it produces is
 * synthetic — results computed on it say nothing about real performance.
 */

import type { ReplayCandle, ReplaySeries } from "./contracts.js";

const HOUR_MS = 60 * 60 * 1000;

/** Mulberry32 — small, fast, deterministic. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticMarketOptions {
  readonly symbol: string;
  readonly assetType?: "CRYPTO" | "ETF";
  readonly startMs: number;
  readonly hours: number;
  readonly startPrice: number;
  readonly seed: number;
  /** Price decimals (tick 0.01 → 2). */
  readonly decimals?: number;
  readonly baseVolume?: number;
  /** Hourly noise scale (default 0.006). */
  readonly noise?: number;
}

export function generateSyntheticSeries(options: SyntheticMarketOptions): ReplaySeries {
  const random = seededRandom(options.seed);
  const decimals = options.decimals ?? 2;
  const baseVolume = options.baseVolume ?? 800;
  const hourly: ReplayCandle[] = [];
  let price = options.startPrice;
  let drift = 0.0004;
  let regimeHoursLeft = 0;

  let impulseHoursLeft = 0;
  for (let hour = 0; hour < options.hours; hour += 1) {
    if (regimeHoursLeft <= 0) {
      // Trend regimes of 1–3 weeks: up, down or sideways.
      const pick = random();
      drift = pick < 0.5 ? 0.0004 : pick < 0.75 ? -0.0004 : 0;
      regimeHoursLeft = 168 + Math.floor(random() * 336);
    }
    regimeHoursLeft -= 1;
    // Occasional multi-day impulse inside an up regime: steady gains on rising
    // volume across hours, 4h blocks and days — the setup breakout rules look for.
    if (impulseHoursLeft <= 0 && drift > 0 && random() < 0.004) impulseHoursLeft = 36 + Math.floor(random() * 24);
    const impulse = impulseHoursLeft > 0;
    if (impulse) impulseHoursLeft -= 1;

    const shock = (random() + random() + random() - 1.5) * (options.noise ?? 0.006);
    const burst = random() < 0.05;
    const open = price;
    const close = Math.max(1, open * (1 + drift + (impulse ? 0.0012 : 0) + shock + (burst ? Math.abs(shock) : 0)));
    const high = Math.max(open, close) * (1 + random() * 0.003);
    const low = Math.min(open, close) * (1 - random() * 0.003);
    const volume = baseVolume * (0.6 + random() * 0.8) * (burst ? 2.2 : 1) * (impulse ? 2.4 : 1);
    const openTime = options.startMs + hour * HOUR_MS;
    hourly.push({
      openTime,
      closeTime: openTime + HOUR_MS - 1,
      open: open.toFixed(decimals),
      high: high.toFixed(decimals),
      low: low.toFixed(decimals),
      close: close.toFixed(decimals),
      volume: volume.toFixed(4)
    });
    price = close;
  }

  return {
    symbol: options.symbol,
    assetType: options.assetType ?? "CRYPTO",
    source: "SYNTHETIC",
    candles: { "1h": hourly, "4h": aggregate(hourly, 4), "1d": aggregate(hourly, 24) }
  };
}

/** Aggregates complete groups of hourly candles (aligned to UTC multiples). */
export function aggregate(hourly: readonly ReplayCandle[], hours: number): ReplayCandle[] {
  const span = hours * HOUR_MS;
  const groups = new Map<number, ReplayCandle[]>();
  for (const candle of hourly) {
    const bucket = Math.floor(candle.openTime / span) * span;
    const group = groups.get(bucket) ?? [];
    group.push(candle);
    groups.set(bucket, group);
  }
  const result: ReplayCandle[] = [];
  for (const [bucket, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length !== hours) continue;
    const decimals = (group[0].close.split(".")[1] ?? "").length;
    result.push({
      openTime: bucket,
      closeTime: bucket + span - 1,
      open: group[0].open,
      high: Math.max(...group.map((c) => Number(c.high))).toFixed(decimals),
      low: Math.min(...group.map((c) => Number(c.low))).toFixed(decimals),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + Number(c.volume), 0).toFixed(4)
    });
  }
  return result;
}

export interface BreakoutScenarioOptions {
  readonly symbol: string;
  readonly assetType?: "CRYPTO" | "ETF";
  readonly startMs: number;
  readonly days: number;
  readonly startPrice: number;
  /** Day indexes on which a volume-confirmed breakout fires (08:00–09:00 UTC), and how it resolves. */
  readonly events: readonly { readonly day: number; readonly outcome: "WIN" | "LOSS" }[];
  readonly seed?: number;
}

/**
 * Deterministic test scenario: an uptrend with regular pullbacks and, on each
 * event day, the textbook setup the long breakout rules require — a
 * high-volume morning the day before (daily volume), a high-volume 04–08h
 * block (4h volume) and a high-volume breakout hour 08–09h — followed by a
 * move to the target (`WIN`) or through the stop (`LOSS`). Synthetic; for
 * exercising the pipeline only.
 */
export function generateBreakoutScenario(options: BreakoutScenarioOptions): ReplaySeries {
  const random = seededRandom(options.seed ?? 1);
  const hours = options.days * 24;
  const eventByDay = new Map(options.events.map((event) => [event.day, event.outcome] as const));
  const hourly: ReplayCandle[] = [];
  let offset = 0;
  let ramp: { perHour: number; hoursLeft: number } | null = null;
  let previousClose = options.startPrice;

  for (let hour = 0; hour < hours; hour += 1) {
    const day = Math.floor(hour / 24);
    const hourOfDay = hour % 24;
    const eventToday = eventByDay.get(day);

    let volumeFactor = 1;
    if (eventByDay.has(day + 1) && hourOfDay < 10) volumeFactor = 4; // daily volume the day before
    if (eventToday !== undefined && hourOfDay >= 4 && hourOfDay < 8) volumeFactor = 2.5; // 4h block
    if (eventToday !== undefined && hourOfDay === 8) {
      volumeFactor = 3; // breakout hour
      offset += 0.014;
      ramp = { perHour: eventToday === "WIN" ? 0.0016 : -0.0028, hoursLeft: 30 };
    } else if (ramp !== null) {
      offset += ramp.perHour;
      ramp.hoursLeft -= 1;
      if (ramp.hoursLeft === 0) ramp = null;
    }

    // Uptrend (+0.24 %/day) with a 3-day swing and an 11-hour wiggle.
    const logPrice =
      Math.log(options.startPrice) +
      0.0001 * hour +
      0.02 * Math.sin((2 * Math.PI * hour) / 71) +
      0.006 * Math.sin((2 * Math.PI * hour) / 11) +
      offset +
      (random() - 0.5) * 0.002;
    const open = previousClose;
    const close = Math.exp(logPrice);
    const high = Math.max(open, close) * (1 + 0.002 + random() * 0.002);
    const low = Math.min(open, close) * (1 - 0.002 - random() * 0.002);
    const volume = 1000 * (0.9 + random() * 0.2) * volumeFactor;
    const openTime = options.startMs + hour * HOUR_MS;
    hourly.push({
      openTime,
      closeTime: openTime + HOUR_MS - 1,
      open: open.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      close: close.toFixed(2),
      volume: volume.toFixed(4)
    });
    previousClose = Number(close.toFixed(2));
  }

  return {
    symbol: options.symbol,
    assetType: options.assetType ?? "CRYPTO",
    source: "SYNTHETIC",
    candles: { "1h": hourly, "4h": aggregate(hourly, 4), "1d": aggregate(hourly, 24) }
  };
}
