/**
 * DEVELOPMENT ONLY — a synthetic stand-in for the exchange feed, so the full
 * research → trading loop can run unattended where Binance is unreachable
 * (e.g. a sandbox without exchange egress).
 *
 *   ALLOW_SYNTHETIC_FEED=true pnpm worker:dev-synthetic-feed          # every hour
 *   ALLOW_SYNTHETIC_FEED=true pnpm worker:dev-synthetic-feed --once   # single tick
 *
 * Each tick (shortly after every full hour) it appends the candles that closed
 * since the last tick (`source = "SYNTHETIC"`, deterministic from a fixed
 * start), refreshes their data-quality rows and then runs the real research
 * jobs — market regime and crypto signals — exactly as the hourly pipeline
 * would after a Binance fetch. The trading worker consumes the result
 * unchanged.
 *
 * Scenario mode (still synthetic, for demonstrating the full trading cycle):
 *
 *   SYNTHETIC_SCENARIO_BREAKOUT_AT=2026-10-13T12:00:00Z   # breakout candle open (UTC, 04–23 h)
 *   SYNTHETIC_SCENARIO_OUTCOME=WIN                         # or LOSS
 *
 * replaces the random walk with the textbook breakout scenario of
 * `generateBreakoutScenario`: the market itself presents the setup the long
 * strategy describes at that hour, so the unchanged strategy, risk engine and
 * simulation act on it on their own. All candles stay `source = "SYNTHETIC"`.
 *
 * Refuses to run in production, without the flag, or next to real candles.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import { generateBreakoutScenario, generateSyntheticSeries, type ReplaySeries } from "@signalpilot/shadow-replay";
import { config } from "dotenv";

import { analyzeCryptoSignals } from "../jobs/analyzeCryptoSignals.js";
import { calculateMarketRegime } from "../jobs/calculateMarketRegime.js";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

const HOUR_MS = 3_600_000;
const PROVIDER = "SYNTHETIC";
const FEED_START_MS = Date.parse(process.env.SYNTHETIC_FEED_START ?? "2025-08-01T00:00:00.000Z");
const SERIES = [
  { symbol: "BTCUSDT", startPrice: 60000, scenarioStartPrice: 15000, seed: 7, baseVolume: 900, timeframes: ["1h", "4h", "1d"] },
  { symbol: "ETHUSDT", startPrice: 3000, scenarioStartPrice: 750, seed: 11, baseVolume: 9000, timeframes: ["1h", "4h", "1d"] },
  { symbol: "SPY", startPrice: 560, scenarioStartPrice: 140, seed: 101, baseVolume: 50000, timeframes: ["1d"], assetType: "ETF" as const },
  { symbol: "QQQ", startPrice: 480, scenarioStartPrice: 120, seed: 102, baseVolume: 40000, timeframes: ["1d"], assetType: "ETF" as const },
  { symbol: "IWM", startPrice: 220, scenarioStartPrice: 55, seed: 103, baseVolume: 30000, timeframes: ["1d"], assetType: "ETF" as const }
] as const;

export interface FeedScenario {
  readonly breakoutAtMs: number;
  readonly outcome: "WIN" | "LOSS";
}

export function scenarioFromEnv(env: NodeJS.ProcessEnv = process.env): FeedScenario | null {
  const at = env.SYNTHETIC_SCENARIO_BREAKOUT_AT;
  if (at === undefined || at === "") return null;
  const breakoutAtMs = Date.parse(at);
  if (!Number.isFinite(breakoutAtMs) || breakoutAtMs % HOUR_MS !== 0) {
    throw new Error("SYNTHETIC_SCENARIO_BREAKOUT_AT must be a full UTC hour.");
  }
  const outcome = env.SYNTHETIC_SCENARIO_OUTCOME === "LOSS" ? "LOSS" : "WIN";
  return { breakoutAtMs, outcome };
}

/** The deterministic series the feed publishes for one symbol up to `endMs`. */
export function feedSeries(entry: (typeof SERIES)[number], endMs: number, scenario: FeedScenario | null): ReplaySeries {
  const assetType = "assetType" in entry ? entry.assetType : "CRYPTO";
  return scenario === null
    ? generateSyntheticSeries({
        symbol: entry.symbol,
        assetType,
        startMs: FEED_START_MS,
        hours: Math.floor((endMs - FEED_START_MS) / HOUR_MS),
        startPrice: entry.startPrice,
        seed: entry.seed,
        baseVolume: entry.baseVolume
      })
    : generateBreakoutScenario({
        symbol: entry.symbol,
        assetType,
        startMs: FEED_START_MS,
        endMs,
        startPrice: entry.scenarioStartPrice,
        seed: entry.seed,
        events: [{ breakoutAtMs: scenario.breakoutAtMs, outcome: scenario.outcome }]
      });
}

export const FEED_SERIES = SERIES;

export async function syntheticFeedTick(
  database: PrismaClient,
  now: Date = new Date(),
  scenario: FeedScenario | null = scenarioFromEnv()
) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_SYNTHETIC_FEED !== "true") {
    throw new Error("The synthetic feed requires ALLOW_SYNTHETIC_FEED=true outside production.");
  }
  const endMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const inserted: Record<string, number> = {};

  for (const entry of SERIES) {
    const asset = await database.asset.findFirst({ where: { symbol: entry.symbol } });
    if (asset === null) throw new Error(`Asset ${entry.symbol} missing — run pnpm db:seed first.`);
    const real = await database.candle.count({ where: { assetId: asset.id, source: { not: PROVIDER } } });
    if (real > 0) throw new Error(`${entry.symbol} has ${real} real candles; refusing to mix synthetic data.`);

    const series = feedSeries(entry, endMs, scenario);

    for (const timeframe of entry.timeframes) {
      const candles = (series.candles[timeframe] ?? []).filter((candle) => candle.closeTime < now.getTime());
      const created = await database.candle.createMany({
        data: candles.map((candle) => ({
          assetId: asset.id,
          symbol: entry.symbol,
          timeframe,
          openTime: new Date(candle.openTime),
          closeTime: new Date(candle.closeTime),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          source: PROVIDER
        })),
        skipDuplicates: true
      });
      inserted[`${entry.symbol} ${timeframe}`] = created.count;

      const first = candles[0];
      const last = candles[candles.length - 1];
      const quality = {
        oldestCandle: first ? new Date(first.openTime) : null,
        latestClosedCandle: last ? new Date(last.closeTime) : null,
        candleCount: candles.length,
        expectedCandleCount: candles.length,
        gapCount: 0,
        missingCandleCount: 0,
        latestDataAgeSeconds: last ? Math.max(0, Math.round((now.getTime() - last.closeTime) / 1000)) : null,
        lastSuccessfulFetchAt: now,
        lastAuditAt: now
      };
      await database.candleDataQuality.upsert({
        where: { assetId_provider_timeframe: { assetId: asset.id, provider: PROVIDER, timeframe } },
        create: { assetId: asset.id, provider: PROVIDER, timeframe, ...quality },
        update: quality
      });
    }
  }

  const regime = await calculateMarketRegime(database, { force: true });
  const signals = await analyzeCryptoSignals(database);
  return {
    scenario: scenario === null ? null : { breakoutAt: new Date(scenario.breakoutAtMs).toISOString(), outcome: scenario.outcome },
    inserted,
    regimeStatus: regime.status,
    signalStatus: signals.status
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const once = process.argv.includes("--once");
  const run = async () => {
    try {
      const summary = await syntheticFeedTick(prisma);
      console.log(new Date().toISOString(), "Synthetischer Feed-Tick", JSON.stringify(summary));
    } catch (error) {
      console.error(new Date().toISOString(), error instanceof Error ? error.message : error);
      if (once) process.exitCode = 1;
    }
  };
  await run();
  if (once) {
    await prisma.$disconnect();
  } else {
    const scheduleNext = () => {
      const delay = HOUR_MS - (Date.now() % HOUR_MS) + 20_000;
      setTimeout(() => void run().then(scheduleNext), delay);
    };
    scheduleNext();
  }
}
