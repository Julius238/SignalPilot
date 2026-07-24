import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetType,
  BotRunStatus,
  prisma,
  type Prisma,
  type PrismaClient
} from "@signalpilot/database";
import { buildIndicatorSnapshot, type IndicatorCandle } from "@signalpilot/indicators";
import {
  assessCandleSeriesQuality,
  supportedBinanceIntervals
} from "@signalpilot/market-data";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const candleLimit = 250;
const minimumUsefulCandles = 20;

export async function analyzeCryptoIndicators(database: PrismaClient = prisma) {
  const analysisNow = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "analyzeCryptoIndicators",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        intervals: [...supportedBinanceIntervals],
        candleLimit
      }
    }
  });

  let analyzedCount = 0;
  let insufficientDataCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "analyzeCryptoIndicators started", {
    botRunId: botRun.id
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: AssetType.CRYPTO,
        isActive: true
      },
      orderBy: {
        symbol: "asc"
      }
    });

    for (const asset of assets) {
      for (const timeframe of supportedBinanceIntervals) {
        try {
          const candles = await database.candle.findMany({
            where: {
              assetId: asset.id,
              timeframe,
              closeTime: {
                lte: analysisNow
              }
            },
            orderBy: {
              openTime: "desc"
            },
            take: candleLimit
          });
          const candleQuality = assessCandleSeriesQuality(candles, {
            now: analysisNow,
            timeframe,
            marketKind: "CONTINUOUS",
            minimumClosedCandles: minimumUsefulCandles
          });

          if (candleQuality.reason !== "OK") {
            insufficientDataCount += 1;
            await writeBotLog(database, "warn", "Crypto indicator analysis skipped for candle quality", {
              botRunId: botRun.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              reason: candleQuality.reason,
              closedCandleCount: candleQuality.closedCandles.length,
              excludedOpenOrInvalidCandleCount:
                candleQuality.openOrInvalidCandleCount,
              latestCloseTime:
                candleQuality.latestCloseTime?.toISOString() ?? null
            });
            continue;
          }

          const chronologicalCandles: IndicatorCandle[] = candleQuality.closedCandles.map((candle) => ({
              high: candle.high.toString(),
              low: candle.low.toString(),
              close: candle.close.toString(),
              volume: candle.volume.toString()
            }));

          const snapshot = buildIndicatorSnapshot(chronologicalCandles);
          const logLevel = snapshot.candleCount < minimumUsefulCandles ? "warn" : "info";

          if (snapshot.candleCount < minimumUsefulCandles) {
            insufficientDataCount += 1;
          } else {
            analyzedCount += 1;
          }

          await writeBotLog(
            database,
            logLevel,
            snapshot.candleCount < minimumUsefulCandles
              ? "Insufficient candles for indicator snapshot"
              : "Calculated crypto indicator snapshot",
            {
              botRunId: botRun.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              candleCount: snapshot.candleCount,
              lastClose: snapshot.lastClose,
              sma20: snapshot.sma20,
              sma50: snapshot.sma50,
              sma200: snapshot.sma200,
              rsi14: snapshot.rsi14,
              atr14: snapshot.atr14,
              relativeVolume: snapshot.relativeVolume
            }
          );
        } catch (error) {
          errorCount += 1;
          const message =
            error instanceof Error ? error.message : "Unknown indicator analysis error";

          logger.error({ error, symbol: asset.symbol, timeframe }, message);
          await writeBotLog(database, "error", "Failed to analyze crypto indicators", {
            botRunId: botRun.id,
            assetId: asset.id,
            symbol: asset.symbol,
            timeframe,
            error: message
          });
        }
      }
    }

    const status = errorCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: {
          intervals: [...supportedBinanceIntervals],
          candleLimit,
          assetCount: assets.length,
          analyzedCount,
          insufficientDataCount,
          errorCount
        }
      }
    });

    await writeBotLog(
      database,
      status === BotRunStatus.SUCCESS ? "info" : "warn",
      "analyzeCryptoIndicators finished",
      {
        botRunId: botRun.id,
        assetCount: assets.length,
        analyzedCount,
        insufficientDataCount,
        errorCount
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown analyzeCryptoIndicators error";

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          intervals: [...supportedBinanceIntervals],
          candleLimit,
          analyzedCount,
          insufficientDataCount,
          errorCount,
          fatalError: message
        }
      }
    });

    await writeBotLog(database, "error", "analyzeCryptoIndicators failed", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

async function writeBotLog(
  database: PrismaClient,
  level: string,
  message: string,
  metadataJson?: Prisma.InputJsonValue
) {
  await database.botLog.create({
    data: {
      level,
      service: "worker",
      message,
      metadataJson
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await analyzeCryptoIndicators();
    logger.info("analyzeCryptoIndicators completed");
  } finally {
    await prisma.$disconnect();
  }
}
