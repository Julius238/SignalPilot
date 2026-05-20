import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import {
  AssetType,
  BotRunStatus,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { FinnhubNewsAdapter, type NormalizedNewsItem } from "@signalpilot/market-data";
import pino from "pino";

const logger = pino({ name: "signalpilot-worker" });

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

function getRequestDelayMs() {
  return Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 500);
}

function getLookbackDays() {
  return Number(process.env.NEWS_LOOKBACK_DAYS ?? 7);
}

export type FetchEquityNewsSummary = {
  status: BotRunStatus;
  assetCount: number;
  fetchedNewsCount: number;
  savedNewsCount: number;
  duplicateCount: number;
  noNewsCount: number;
  rateLimitCount: number;
  errorCount: number;
};

export async function fetchEquityNews(
  database: PrismaClient = prisma
): Promise<FetchEquityNewsSummary> {
  const apiKey = process.env.FINNHUB_API_KEY ?? "";

  if (!apiKey) {
    const botRun = await database.botRun.create({
      data: {
        jobName: "fetchEquityNews",
        status: BotRunStatus.FAILED,
        startedAt: new Date(),
        finishedAt: new Date(),
        metadataJson: { fatalError: "FINNHUB_API_KEY is not set." }
      }
    });
    await writeBotLog(database, "error", "fetchEquityNews failed: FINNHUB_API_KEY is not set.", {
      botRunId: botRun.id
    });
    logger.error({ botRunId: botRun.id }, "fetchEquityNews failed: FINNHUB_API_KEY is not set.");
    return {
      status: BotRunStatus.FAILED,
      assetCount: 0,
      fetchedNewsCount: 0,
      savedNewsCount: 0,
      duplicateCount: 0,
      noNewsCount: 0,
      rateLimitCount: 0,
      errorCount: 1
    };
  }

  const watchlistOnly = process.env.NEWS_WATCHLIST_ONLY === "true";
  const lookbackDays = getLookbackDays();
  const adapter = new FinnhubNewsAdapter({ apiKey });

  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchEquityNews",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { source: "FINNHUB", lookbackDays, watchlistOnly }
    }
  });

  let fetchedNewsCount = 0;
  let savedNewsCount = 0;
  let duplicateCount = 0;
  let noNewsCount = 0;
  let rateLimitCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "fetchEquityNews started", {
    botRunId: botRun.id,
    lookbackDays,
    watchlistOnly
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: { in: [AssetType.STOCK, AssetType.ETF] },
        isActive: true,
        watchlistItem: watchlistOnly ? { isNot: null } : undefined
      },
      orderBy: { symbol: "asc" }
    });

    const now = new Date();
    const from = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    for (const asset of assets) {
      try {
        const result = await adapter.fetchCompanyNews(asset.symbol, from, now);

        if (result.kind === "rate_limit") {
          rateLimitCount += 1;
          await writeBotLog(database, "warn", "Finnhub rate limit hit for news", {
            botRunId: botRun.id,
            symbol: asset.symbol
          });
        } else if (result.kind === "no_news") {
          noNewsCount += 1;
        } else {
          fetchedNewsCount += result.items.length;
          const { saved, duplicates } = await saveNewsItems(database, result.items, asset.id);
          savedNewsCount += saved;
          duplicateCount += duplicates;

          await writeBotLog(database, "info", "Saved equity news items", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            fetched: result.items.length,
            saved,
            duplicates
          });
        }
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "Unknown news fetch error";
        logger.error({ error, symbol: asset.symbol }, message);
        await writeBotLog(database, "error", "Failed to fetch equity news", {
          botRunId: botRun.id,
          symbol: asset.symbol,
          error: message
        });
      }

      await delay(getRequestDelayMs());
    }

    const status = errorCount > 0 || rateLimitCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: {
          source: "FINNHUB",
          lookbackDays,
          watchlistOnly,
          assetCount: assets.length,
          fetchedNewsCount,
          savedNewsCount,
          duplicateCount,
          noNewsCount,
          rateLimitCount,
          errorCount
        }
      }
    });

    await writeBotLog(database, status === BotRunStatus.SUCCESS ? "info" : "warn", "fetchEquityNews finished", {
      botRunId: botRun.id,
      assetCount: assets.length,
      fetchedNewsCount,
      savedNewsCount,
      duplicateCount,
      noNewsCount,
      rateLimitCount,
      errorCount
    });

    return {
      status,
      assetCount: assets.length,
      fetchedNewsCount,
      savedNewsCount,
      duplicateCount,
      noNewsCount,
      rateLimitCount,
      errorCount
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchEquityNews error";

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: { source: "FINNHUB", lookbackDays, fatalError: message, errorCount }
      }
    });

    await writeBotLog(database, "error", "fetchEquityNews failed", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

async function saveNewsItems(
  database: PrismaClient,
  items: NormalizedNewsItem[],
  assetId: string
): Promise<{ saved: number; duplicates: number }> {
  let saved = 0;
  let duplicates = 0;

  for (const item of items) {
    try {
      const isDuplicate = item.url
        ? !!(await database.newsItem.findUnique({ where: { url: item.url } }))
        : !!(await database.newsItem.findFirst({
            where: {
              symbol: item.symbol,
              headline: item.headline,
              publishedAt: item.publishedAt
            }
          }));

      if (isDuplicate) {
        duplicates += 1;
        continue;
      }

      await database.newsItem.create({
        data: {
          assetId,
          symbol: item.symbol,
          source: item.source,
          headline: item.headline,
          summary: item.summary,
          url: item.url,
          imageUrl: item.imageUrl,
          publishedAt: item.publishedAt,
          category: item.category,
          rawJson: item.rawJson as Prisma.InputJsonValue
        }
      });

      saved += 1;
    } catch (error) {
      // Ignore unique constraint errors from race conditions
      if (
        error instanceof Error &&
        error.message.includes("Unique constraint")
      ) {
        duplicates += 1;
      } else {
        throw error;
      }
    }
  }

  return { saved, duplicates };
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
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await fetchEquityNews();
    logger.info("fetchEquityNews completed");
  } finally {
    await prisma.$disconnect();
  }
}
