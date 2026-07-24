import { prisma, type PrismaClient } from "@signalpilot/database";

import type { NormalizedCandle } from "./types.js";
import { isCandleClosed } from "./candle-quality.js";

export async function saveCandles(
  assetId: string,
  candles: NormalizedCandle[],
  database: PrismaClient = prisma,
  now: Date = new Date()
) {
  const closedCandles = candles.filter((candle) => isCandleClosed(candle, now));

  for (const candle of closedCandles) {
    await database.candle.upsert({
      where: {
        assetId_timeframe_openTime: {
          assetId,
          timeframe: candle.timeframe,
          openTime: candle.openTime
        }
      },
      create: {
        assetId,
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        source: candle.source
      },
      update: {
        symbol: candle.symbol,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        source: candle.source
      }
    });
  }

  return {
    savedCandleCount: closedCandles.length,
    skippedOpenCandleCount: candles.length - closedCandles.length
  };
}
