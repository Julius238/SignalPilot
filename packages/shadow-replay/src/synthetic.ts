/**
 * Deterministic synthetic market for tests and local end-to-end runs.
 *
 * Seeded random walk with alternating trend regimes and occasional volume
 * bursts, so breakout setups actually occur. Every candle it produces is
 * synthetic — results computed on it say nothing about real performance.
 */

import type { ReplayCandle, ReplaySeries } from "./contracts.js";

const DAY_MS = 86_400_000;
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

export interface BreakoutScenarioEvent {
  /** Open time (UTC, on the hour, 04:00–23:00) of the breakout candle. */
  readonly breakoutAtMs: number;
  readonly outcome: "WIN" | "LOSS";
}

export interface BreakoutScenarioOptions {
  readonly symbol: string;
  readonly assetType?: "CRYPTO" | "ETF";
  /** UTC midnight, so scenario days coincide with exchange daily candles. */
  readonly startMs: number;
  /** Generate candles opening before this instant (default: through the last event + 2 days). */
  readonly endMs?: number;
  readonly startPrice: number;
  readonly events: readonly BreakoutScenarioEvent[];
  readonly seed?: number;
  /** Mean hourly true range as a fraction of price (default 1.3 %). */
  readonly hourlyRange?: number;
}

type Phase =
  | "PRIOR_DAY_ADVANCE"
  | "PRIOR_DAY_SIDEWAYS"
  | "SIDEWAYS"
  | "PUSH"
  | "BREAKOUT"
  | "FOLLOW_THROUGH_WIN"
  | "FOLLOW_THROUGH_LOSS";

/**
 * Deterministic "textbook" scenario for exercising the full pipeline: a steady
 * uptrend with a 3-day swing, wide hourly ranges and, for every event,
 * exactly the setup the long breakout rules describe —
 *   prior UTC day:   high-volume advance in the morning, sideways afterwards
 *                    (daily candle closes near its 20-day high on high volume);
 *   last 4h block:   high-volume push (4h candle near its 20-period high);
 *   breakout candle: volume-confirmed close above the prior 20 hourly highs,
 *                    RSI kept moderate by the sideways phases;
 * followed by a move to the target (`WIN`) or through the stop (`LOSS`).
 *
 * SYNTHETIC — it proves that the pipeline acts correctly when the market does
 * present the setup; it says nothing about how often real markets do.
 */
export function generateBreakoutScenario(options: BreakoutScenarioOptions): ReplaySeries {
  if (options.startMs % DAY_MS !== 0) throw new Error("startMs must be UTC midnight.");
  const random = seededRandom(options.seed ?? 1);
  const range = options.hourlyRange ?? 0.013;
  const lastEvent = Math.max(options.startMs, ...options.events.map((event) => event.breakoutAtMs));
  const endMs = options.endMs ?? lastEvent + 2 * DAY_MS;
  const hours = Math.floor((endMs - options.startMs) / HOUR_MS);

  const phases = new Map<number, { phase: Phase; index: number }>();
  /** Hours around an event where the swing is muted so the setup does not depend on its phase. */
  const calm = new Set<number>();
  for (const event of options.events) {
    const b = Math.round((event.breakoutAtMs - options.startMs) / HOUR_MS);
    if ((b % 24) < 4) throw new Error("Breakout hour must be 04:00–23:00 UTC.");
    const pushStart = 4 * (Math.floor((b + 1) / 4) - 1);
    const dayStart = Math.floor(b / 24) * 24;
    const priorDayStart = dayStart - 24;
    for (let hour = priorDayStart - 48; hour < b + 12; hour += 1) calm.add(hour);
    for (let hour = priorDayStart; hour < b + 12; hour += 1) {
      const phase: Phase =
        hour < priorDayStart + 12
          ? "PRIOR_DAY_ADVANCE"
          : hour < dayStart
            ? "PRIOR_DAY_SIDEWAYS"
            : hour < pushStart
              ? "SIDEWAYS"
              : hour < b
                ? "PUSH"
                : hour === b
                  ? "BREAKOUT"
                  : event.outcome === "WIN"
                    ? "FOLLOW_THROUGH_WIN"
                    : "FOLLOW_THROUGH_LOSS";
      phases.set(hour, {
        phase,
        index: hour - (phase === "PUSH" ? pushStart : phase.startsWith("FOLLOW_THROUGH") ? b + 1 : priorDayStart)
      });
    }
  }

  const hourly: ReplayCandle[] = [];
  let logPrice = Math.log(options.startPrice);
  let previousClose = options.startPrice;

  for (let hour = 0; hour < hours; hour += 1) {
    const alternating = hour % 2 === 0 ? 1 : -1;
    // Base: +0.02 %/h drift, a 3-day swing (so 4h/daily candles also close
    // lower at times and their RSI stays realistic) and alternating hourly moves.
    const swing = calm.has(hour) ? 0 : 0.02 * ((2 * Math.PI) / 72) * Math.cos((2 * Math.PI * hour) / 72);
    let move = 0.0002 + swing + alternating * 0.0018 + (random() - 0.5) * 0.0012;
    let volumeFactor = 1;

    const scripted = phases.get(hour);
    switch (scripted?.phase) {
      case "PRIOR_DAY_ADVANCE":
        move = 0.0016 + (random() - 0.5) * 0.0006;
        volumeFactor = 1.8;
        break;
      case "PRIOR_DAY_SIDEWAYS":
        move = alternating * 0.0022 + 0.0001;
        volumeFactor = 1.8;
        break;
      case "SIDEWAYS":
        move = alternating * 0.0022 + 0.0001;
        break;
      case "PUSH":
        move = scripted.index % 2 === 0 ? 0.0034 : -0.0012;
        volumeFactor = 2.2;
        break;
      case "BREAKOUT":
        move = 0.008;
        volumeFactor = 3.3;
        break;
      // Three decisive hours, then sideways: the target (or the stop) is
      // reached within ~3 candles after the entry fill.
      case "FOLLOW_THROUGH_WIN":
        move = scripted.index < 3 ? 0.018 : alternating * 0.0022;
        volumeFactor = 1.4;
        break;
      case "FOLLOW_THROUGH_LOSS":
        move = scripted.index < 3 ? -0.012 : alternating * 0.0022;
        volumeFactor = 1.4;
        break;
      default:
        break;
    }

    logPrice += move;
    const open = previousClose;
    const close = Math.exp(logPrice);
    const wick = range / 2 - Math.abs(Math.log(close / open)) / 2;
    const high = Math.max(open, close) * (1 + Math.max(0.0005, wick * (0.8 + random() * 0.4)));
    const low = Math.min(open, close) * (1 - Math.max(0.0005, wick * (0.8 + random() * 0.4)));
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
