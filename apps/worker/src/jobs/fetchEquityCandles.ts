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
  FinnhubMarketDataAdapter,
  saveCandles,
  supportedFinnhubIntervals
} from "@signalpilot/market-data";
import pino from "pino";

const logger = pino({ name: "signalpilot-worker" });

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

function getRequestDelayMs() {
  return Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 500);
}

const lookbackDaysByTimeframe: Record<string, number> = {
  "1h": 60,
  "1d": 365
};

export type FetchEquityCandlesSummary = {
  status: BotRunStatus;
  assetCount: number;
  timeframeCount: number;
  savedCandleCount: number;
  noDataCount: number;
  errorCount: number;
  rateLimitCount: number;
};

export async function fetchEquityCandles(
  database: PrismaClient = prisma,
  adapterOverride?: FinnhubMarketDataAdapter
): Promise<FetchEquityCandlesSummary> {
  if (!adapterOverride && !process.env.FINNHUB_API_KEY) {
    const botRun = await database.botRun.create({
      data: {
        jobName: "fetchEquityCandles",
        status: BotRunStatus.FAILED,
        startedAt: new Date(),
        finishedAt: new Date(),
        metadataJson: { fatalError: "FINNHUB_API_KEY is not set." }
      }
    });

    await writeBotLog(database, "error", "fetchEquityCandles failed: FINNHUB_API_KEY is not set.", {
      botRunId: botRun.id
    });

    logger.error({ botRunId: botRun.id }, "fetchEquityCandles failed: FINNHUB_API_KEY is not set.");

    return {
      status: BotRunStatus.FAILED,
      assetCount: 0,
      timeframeCount: 0,
      savedCandleCount: 0,
      noDataCount: 0,
      errorCount: 1,
      rateLimitCount: 0
    };
  }

  const adapter =
    adapterOverride ??
    new FinnhubMarketDataAdapter({ apiKey: process.env.FINNHUB_API_KEY });

  const startedAt = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchEquityCandles",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        source: "FINNHUB",
        intervals: [...supportedFinnhubIntervals]
      }
    }
  });

  let savedCandles = 0;
  let noDataCount = 0;
  let errorCount = 0;
  let rateLimitCount = 0;
  let assetCount = 0;

  await writeBotLog(database, "info", "fetchEquityCandles started", { botRunId: botRun.id });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: { in: [AssetType.STOCK, AssetType.ETF] },
        isActive: true
      },
      orderBy: { symbol: "asc" }
    });
    assetCount = assets.length;

    const now = new Date();

    for (const asset of assets) {
      for (const interval of supportedFinnhubIntervals) {
        try {
          const lookbackDays = lookbackDaysByTimeframe[interval] ?? 60;
          const from = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

          const result = await adapter.fetchStockCandles(asset.symbol, interval, from, now);

          if (result.kind === "rate_limit") {
            rateLimitCount += 1;
            await writeBotLog(database, "warn", "Finnhub rate limit hit", {
              botRunId: botRun.id,
              symbol: asset.symbol,
              timeframe: interval
            });
          } else if (result.kind === "no_data") {
            noDataCount += 1;
            await writeBotLog(database, "info", "No Finnhub data for asset", {
              botRunId: botRun.id,
              symbol: asset.symbol,
              timeframe: interval
            });
          } else {
            await saveCandles(asset.id, result.candles, database);
            savedCandles += result.candles.length;
            await writeBotLog(database, "info", "Saved Finnhub candles", {
              botRunId: botRun.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe: interval,
              candleCount: result.candles.length
            });
          }
        } catch (error) {
          errorCount += 1;
          const message = error instanceof Error ? error.message : "Unknown candle fetch error";
          logger.error({ error, symbol: asset.symbol, timeframe: interval }, message);
          await writeBotLog(database, "error", "Failed to fetch Finnhub candles", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            timeframe: interval,
            error: message
          });
        }

        await delay(getRequestDelayMs());
      }
    }

    const status = errorCount > 0 || rateLimitCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: {
          source: "FINNHUB",
          intervals: [...supportedFinnhubIntervals],
          savedCandleCount: savedCandles,
          noDataCount,
          errorCount,
          rateLimitCount,
          assetCount
        }
      }
    });

    await writeBotLog(
      database,
      status === BotRunStatus.SUCCESS ? "info" : "warn",
      "fetchEquityCandles finished",
      {
        botRunId: botRun.id,
        savedCandleCount: savedCandles,
        noDataCount,
        errorCount,
        rateLimitCount,
        assetCount
      }
    );

    return {
      status,
      assetCount,
      timeframeCount: supportedFinnhubIntervals.length,
      savedCandleCount: savedCandles,
      noDataCount,
      errorCount,
      rateLimitCount
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchEquityCandles error";

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          source: "FINNHUB",
          intervals: [...supportedFinnhubIntervals],
          savedCandleCount: savedCandles,
          noDataCount,
          errorCount,
          rateLimitCount,
          fatalError: message
        }
      }
    });

    await writeBotLog(database, "error", "fetchEquityCandles failed", {
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
    data: { level, service: "worker", message, metadataJson }
  });
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await fetchEquityCandles();
    logger.info("fetchEquityCandles completed");
  } finally {
    await prisma.$disconnect();
  }
}
