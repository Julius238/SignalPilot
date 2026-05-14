import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import {
  AssetType,
  BotRunStatus,
  prisma,
  type Prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  BinanceMarketDataAdapter,
  saveCandles,
  supportedBinanceIntervals
} from "@signalpilot/market-data";
import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const candleLimit = 300;
const requestDelayMs = Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 250);

export async function fetchCryptoCandles(database: PrismaClient = prisma) {
  const adapter = new BinanceMarketDataAdapter();
  const startedAt = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchCryptoCandles",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        source: "BINANCE",
        intervals: [...supportedBinanceIntervals],
        limit: candleLimit
      }
    }
  });

  let savedCandles = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "fetchCryptoCandles started", {
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
      for (const interval of supportedBinanceIntervals) {
        try {
          const candles = await adapter.fetchKlines(asset.symbol, interval, candleLimit);
          await saveCandles(asset.id, candles, database);
          savedCandles += candles.length;

          await writeBotLog(database, "info", "Saved Binance candles", {
            botRunId: botRun.id,
            assetId: asset.id,
            symbol: asset.symbol,
            timeframe: interval,
            candleCount: candles.length
          });
        } catch (error) {
          errorCount += 1;
          const message = error instanceof Error ? error.message : "Unknown candle fetch error";

          logger.error({ error, symbol: asset.symbol, timeframe: interval }, message);
          await writeBotLog(database, "error", "Failed to fetch Binance candles", {
            botRunId: botRun.id,
            assetId: asset.id,
            symbol: asset.symbol,
            timeframe: interval,
            error: message
          });
        }

        await delay(requestDelayMs);
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
          source: "BINANCE",
          intervals: [...supportedBinanceIntervals],
          limit: candleLimit,
          savedCandles,
          errorCount,
          assetCount: assets.length
        }
      }
    });

    await writeBotLog(database, status === BotRunStatus.SUCCESS ? "info" : "warn", "fetchCryptoCandles finished", {
      botRunId: botRun.id,
      savedCandles,
      errorCount,
      assetCount: assets.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchCryptoCandles error";

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          source: "BINANCE",
          intervals: [...supportedBinanceIntervals],
          limit: candleLimit,
          savedCandles,
          errorCount,
          fatalError: message
        }
      }
    });

    await writeBotLog(database, "error", "fetchCryptoCandles failed", {
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

function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await fetchCryptoCandles();
    logger.info("fetchCryptoCandles completed");
  } finally {
    await prisma.$disconnect();
  }
}
