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
import { FinnhubEventsAdapter, type NormalizedEarningsEvent } from "@signalpilot/market-data";
import pino from "pino";

const logger = pino({ name: "signalpilot-worker" });

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

function getLookbackDays() {
  return Number(process.env.EVENTS_LOOKBACK_DAYS ?? 14);
}

function getLookaheadDays() {
  return Number(process.env.EVENTS_LOOKAHEAD_DAYS ?? 60);
}

function getRequestDelayMs() {
  return Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 500);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type FetchEquityEventsSummary = {
  status: BotRunStatus;
  assetCount: number;
  fetchedEventCount: number;
  savedEventCount: number;
  duplicateCount: number;
  noEventCount: number;
  rateLimitCount: number;
  forbiddenCount: number;
  errorCount: number;
};

export async function fetchEquityEvents(
  database: PrismaClient = prisma
): Promise<FetchEquityEventsSummary> {
  const apiKey = process.env.FINNHUB_API_KEY ?? "";

  if (!apiKey) {
    const botRun = await database.botRun.create({
      data: {
        jobName: "fetchEquityEvents",
        status: BotRunStatus.FAILED,
        startedAt: new Date(),
        finishedAt: new Date(),
        metadataJson: { fatalError: "FINNHUB_API_KEY is not set." }
      }
    });
    await writeBotLog(database, "error", "fetchEquityEvents failed: FINNHUB_API_KEY is not set.", {
      botRunId: botRun.id
    });
    logger.error({ botRunId: botRun.id }, "fetchEquityEvents failed: FINNHUB_API_KEY is not set.");
    return {
      status: BotRunStatus.FAILED,
      assetCount: 0,
      fetchedEventCount: 0,
      savedEventCount: 0,
      duplicateCount: 0,
      noEventCount: 0,
      rateLimitCount: 0,
      forbiddenCount: 0,
      errorCount: 1
    };
  }

  const watchlistOnly = process.env.EVENTS_WATCHLIST_ONLY === "true";
  const lookbackDays = getLookbackDays();
  const lookaheadDays = getLookaheadDays();
  const adapter = new FinnhubEventsAdapter({ apiKey });

  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchEquityEvents",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { source: "FINNHUB", lookbackDays, lookaheadDays, watchlistOnly }
    }
  });

  let fetchedEventCount = 0;
  let savedEventCount = 0;
  let duplicateCount = 0;
  let noEventCount = 0;
  let rateLimitCount = 0;
  let forbiddenCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "fetchEquityEvents started", {
    botRunId: botRun.id,
    lookbackDays,
    lookaheadDays,
    watchlistOnly
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: AssetType.STOCK,
        isActive: true,
        watchlistItem: watchlistOnly ? { isNot: null } : undefined
      },
      orderBy: { symbol: "asc" }
    });

    const now = new Date();
    const from = formatDate(new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000));
    const to = formatDate(new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000));

    for (const asset of assets) {
      try {
        const result = await adapter.fetchEarningsCalendar({
          from,
          to,
          symbol: asset.symbol
        });

        if (result.kind === "rate_limit") {
          rateLimitCount += 1;
          await writeBotLog(database, "warn", "Finnhub rate limit hit for events", {
            botRunId: botRun.id,
            symbol: asset.symbol
          });
        } else if (result.kind === "forbidden") {
          forbiddenCount += 1;
          await writeBotLog(database, "warn", "Finnhub forbidden for events", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            statusCode: result.statusCode
          });
        } else if (result.kind === "no_events") {
          noEventCount += 1;
        } else {
          fetchedEventCount += result.items.length;
          const { saved, duplicates } = await saveEarningsEvents(
            database,
            result.items,
            asset.id
          );
          savedEventCount += saved;
          duplicateCount += duplicates;

          await writeBotLog(database, "info", "Saved equity events", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            fetched: result.items.length,
            saved,
            duplicates
          });
        }
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "Unknown event fetch error";
        logger.error({ error, symbol: asset.symbol }, message);
        await writeBotLog(database, "error", "Failed to fetch equity events", {
          botRunId: botRun.id,
          symbol: asset.symbol,
          error: message
        });
      }

      await delay(getRequestDelayMs());
    }

    const status =
      errorCount > 0 || rateLimitCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: {
          source: "FINNHUB",
          lookbackDays,
          lookaheadDays,
          watchlistOnly,
          assetCount: assets.length,
          fetchedEventCount,
          savedEventCount,
          duplicateCount,
          noEventCount,
          rateLimitCount,
          forbiddenCount,
          errorCount
        }
      }
    });

    await writeBotLog(
      database,
      status === BotRunStatus.SUCCESS ? "info" : "warn",
      "fetchEquityEvents finished",
      {
        botRunId: botRun.id,
        assetCount: assets.length,
        fetchedEventCount,
        savedEventCount,
        duplicateCount,
        noEventCount,
        rateLimitCount,
        forbiddenCount,
        errorCount
      }
    );

    return {
      status,
      assetCount: assets.length,
      fetchedEventCount,
      savedEventCount,
      duplicateCount,
      noEventCount,
      rateLimitCount,
      forbiddenCount,
      errorCount
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchEquityEvents error";

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          source: "FINNHUB",
          lookbackDays,
          lookaheadDays,
          fatalError: message,
          errorCount
        }
      }
    });

    await writeBotLog(database, "error", "fetchEquityEvents failed", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

async function saveEarningsEvents(
  database: PrismaClient,
  items: NormalizedEarningsEvent[],
  assetId: string
): Promise<{ saved: number; duplicates: number }> {
  let saved = 0;
  let duplicates = 0;

  for (const item of items) {
    try {
      const existing = await database.event.findFirst({
        where: {
          symbol: item.symbol,
          eventType: item.eventType,
          eventDate: item.eventDate,
          fiscalQuarter: item.fiscalQuarter ?? undefined,
          fiscalYear: item.fiscalYear ?? undefined
        }
      });

      if (existing) {
        await database.event.update({
          where: { id: existing.id },
          data: {
            epsEstimate: item.epsEstimate ?? undefined,
            epsActual: item.epsActual ?? undefined,
            revenueEstimate: item.revenueEstimate ?? undefined,
            revenueActual: item.revenueActual ?? undefined,
            rawJson: item.rawJson as Prisma.InputJsonValue
          }
        });
        duplicates += 1;
        continue;
      }

      await database.event.create({
        data: {
          assetId,
          symbol: item.symbol,
          eventType: item.eventType,
          title: item.title,
          source: item.source,
          eventDate: item.eventDate,
          eventTime: item.eventTime,
          fiscalQuarter: item.fiscalQuarter,
          fiscalYear: item.fiscalYear,
          epsEstimate: item.epsEstimate ?? undefined,
          epsActual: item.epsActual ?? undefined,
          revenueEstimate: item.revenueEstimate ?? undefined,
          revenueActual: item.revenueActual ?? undefined,
          rawJson: item.rawJson as Prisma.InputJsonValue
        }
      });

      saved += 1;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unique constraint")) {
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
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await fetchEquityEvents();
    logger.info("fetchEquityEvents completed");
  } finally {
    await prisma.$disconnect();
  }
}
