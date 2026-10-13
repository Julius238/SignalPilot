/**
 * DEVELOPMENT ONLY: fills an empty local database with synthetic candles
 * (`source = "SYNTHETIC"`) so the replay, the research pipeline and the
 * dashboard can be exercised without exchange access.
 *
 *   ALLOW_SYNTHETIC_SEED=true pnpm --filter @signalpilot/trading-worker dev:seed-synthetic-market
 *
 * Refuses to run in production, without the explicit flag, or when real
 * (non-synthetic) candles already exist for any seeded symbol — synthetic and
 * real data must never mix.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import { generateSyntheticSeries, type ReplaySeries } from "@signalpilot/shadow-replay";
import { config } from "dotenv";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

const SEEDS = [
  { symbol: "BTCUSDT", startPrice: 40000, seed: 7, baseVolume: 900 },
  { symbol: "ETHUSDT", startPrice: 2300, seed: 11, baseVolume: 9000 },
  { symbol: "SPY", startPrice: 470, seed: 101, baseVolume: 50000, assetType: "ETF" as const },
  { symbol: "QQQ", startPrice: 400, seed: 102, baseVolume: 40000, assetType: "ETF" as const },
  { symbol: "IWM", startPrice: 200, seed: 103, baseVolume: 30000, assetType: "ETF" as const }
];

export async function seedSyntheticMarket(database: PrismaClient, options: { days: number; endMs: number }) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_SYNTHETIC_SEED !== "true") {
    throw new Error("Synthetic seeding requires ALLOW_SYNTHETIC_SEED=true and a non-production environment.");
  }
  const startMs = Math.floor((options.endMs - options.days * 86_400_000) / 86_400_000) * 86_400_000;
  const hours = Math.floor((options.endMs - startMs) / 3_600_000);
  const summary: Record<string, number> = {};

  for (const entry of SEEDS) {
    const asset = await database.asset.findFirst({ where: { symbol: entry.symbol } });
    if (asset === null) throw new Error(`Asset ${entry.symbol} missing — run pnpm db:seed first.`);
    const real = await database.candle.count({ where: { assetId: asset.id, source: { not: "SYNTHETIC" } } });
    if (real > 0) throw new Error(`${entry.symbol} already has ${real} real candles; refusing to mix synthetic data.`);

    const series: ReplaySeries = generateSyntheticSeries({
      symbol: entry.symbol,
      assetType: entry.assetType ?? "CRYPTO",
      startMs,
      hours,
      startPrice: entry.startPrice,
      seed: entry.seed,
      baseVolume: entry.baseVolume
    });
    await database.candle.deleteMany({ where: { assetId: asset.id, source: "SYNTHETIC" } });
    for (const timeframe of ["1h", "4h", "1d"] as const) {
      if (entry.assetType === "ETF" && timeframe !== "1d") continue;
      const rows = (series.candles[timeframe] ?? []).map((candle) => ({
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
        source: "SYNTHETIC"
      }));
      for (let offset = 0; offset < rows.length; offset += 5000) {
        await database.candle.createMany({ data: rows.slice(offset, offset + 5000) });
      }
      summary[`${entry.symbol} ${timeframe}`] = rows.length;
    }
  }
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const days = Number(process.env.SYNTHETIC_DAYS ?? 420);
  seedSyntheticMarket(prisma, { days, endMs: Math.floor(Date.now() / 3_600_000) * 3_600_000 })
    .then((summary) => console.log("Synthetische Kerzen angelegt:", summary))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
