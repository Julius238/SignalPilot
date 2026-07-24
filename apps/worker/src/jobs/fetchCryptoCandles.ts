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
  ProviderRequestError,
  saveCandles,
  supportedBinanceIntervals,
  timeframeDurationMs
} from "@signalpilot/market-data";
import pino from "pino";

import {
  recordProviderOutcome,
  refreshCandleDataQuality,
  type ProviderOutcomeKind
} from "../lib/candleDataQuality.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

type CryptoCandleAdapter = Pick<BinanceMarketDataAdapter, "fetchKlines">;

const requestDelayMs = Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 250);

export type FetchCryptoCandlesSummary = {
  status: BotRunStatus;
  assetCount: number;
  timeframeCount: number;
  savedCandleCount: number;
  skippedOpenCandleCount: number;
  errorCount: number;
  rateLimitCount: number;
  entitlementErrorCount: number;
  temporaryErrorCount: number;
  lastSuccessfulFetchAt: string | null;
};

export async function fetchCryptoCandles(
  database: PrismaClient = prisma,
  adapterOverride?: CryptoCandleAdapter
): Promise<FetchCryptoCandlesSummary> {
  const adapter = adapterOverride ?? new BinanceMarketDataAdapter();
  const startedAt = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchCryptoCandles",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        provider: "BINANCE",
        flow: "INCREMENTAL",
        intervals: [...supportedBinanceIntervals]
      }
    }
  });
  const summary = emptySummary();

  await writeBotLog(database, "info", "fetchCryptoCandles started", {
    botRunId: botRun.id,
    provider: "BINANCE",
    flow: "INCREMENTAL"
  });

  try {
    const assets = await database.asset.findMany({
      where: { assetType: AssetType.CRYPTO, isActive: true },
      orderBy: { symbol: "asc" }
    });
    summary.assetCount = assets.length;
    const now = new Date();

    for (const asset of assets) {
      for (const interval of supportedBinanceIntervals) {
        const latest = await database.candle.findFirst({
          where: {
            assetId: asset.id,
            timeframe: interval,
            source: "BINANCE",
            closeTime: { lte: now }
          },
          orderBy: { openTime: "desc" },
          select: { openTime: true }
        });

        try {
          const duration = timeframeDurationMs(interval) ?? 60 * 60 * 1000;
          const startTime = latest
            ? new Date(latest.openTime.getTime() - duration)
            : undefined;
          const candles = await adapter.fetchKlines(asset.symbol, interval, {
            limit: Number(process.env.CRYPTO_INCREMENTAL_CANDLE_LIMIT ?? 300),
            startTime,
            endTime: now,
            retry: {
              maxAttempts: Number(process.env.PROVIDER_RETRY_MAX_ATTEMPTS ?? 3),
              baseDelayMs: Number(process.env.PROVIDER_RETRY_BASE_DELAY_MS ?? 500),
              maxDelayMs: Number(process.env.PROVIDER_RETRY_MAX_DELAY_MS ?? 8_000),
              onRetry: async (event) => {
                if (event.kind === "RATE_LIMIT") {
                  summary.rateLimitCount += 1;
                  await recordProviderOutcome(database, {
                    assetId: asset.id,
                    provider: "BINANCE",
                    timeframe: interval,
                    kind: "RATE_LIMIT"
                  });
                }
                await writeBotLog(database, "warn", "Retrying Binance candle request", {
                  botRunId: botRun.id,
                  symbol: asset.symbol,
                  timeframe: interval,
                  attempt: event.attempt,
                  delayMs: event.delayMs,
                  errorKind: event.kind
                });
              }
            }
          });
          const saveResult = await saveCandles(asset.id, candles, database, now);
          summary.savedCandleCount += saveResult.savedCandleCount;
          summary.skippedOpenCandleCount += saveResult.skippedOpenCandleCount;
          summary.lastSuccessfulFetchAt = now.toISOString();
          await recordProviderOutcome(database, {
            assetId: asset.id,
            provider: "BINANCE",
            timeframe: interval,
            kind: "SUCCESS"
          });
        } catch (error) {
          summary.errorCount += 1;
          const outcomeKind = classifyOutcome(error);
          if (outcomeKind === "RATE_LIMIT") summary.rateLimitCount += 1;
          if (outcomeKind === "ENTITLEMENT") summary.entitlementErrorCount += 1;
          if (outcomeKind === "TEMPORARY") summary.temporaryErrorCount += 1;
          await recordProviderOutcome(database, {
            assetId: asset.id,
            provider: "BINANCE",
            timeframe: interval,
            kind: outcomeKind
          });
          const message = error instanceof Error ? error.message : "Unknown candle fetch error";
          logger.error({ error, symbol: asset.symbol, timeframe: interval }, message);
          await writeBotLog(database, "error", "Failed to fetch Binance candles", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            timeframe: interval,
            error: message,
            errorKind: outcomeKind
          });
        }

        await refreshCandleDataQuality(database, {
          assetId: asset.id,
          provider: "BINANCE",
          timeframe: interval,
          marketKind: "CONTINUOUS",
          now
        });
        await delay(requestDelayMs);
      }
    }

    summary.status = summary.errorCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: summary.status,
        finishedAt: new Date(),
        metadataJson: {
          provider: "BINANCE",
          flow: "INCREMENTAL",
          intervals: [...supportedBinanceIntervals],
          ...summary
        }
      }
    });
    await writeBotLog(
      database,
      summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
      "fetchCryptoCandles finished",
      { botRunId: botRun.id, ...summary }
    );
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchCryptoCandles error";
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          provider: "BINANCE",
          flow: "INCREMENTAL",
          fatalError: message,
          ...summary
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

function classifyOutcome(error: unknown): ProviderOutcomeKind {
  if (!(error instanceof ProviderRequestError)) return "TEMPORARY";
  return error.kind;
}

function emptySummary(): FetchCryptoCandlesSummary {
  return {
    status: BotRunStatus.FAILED,
    assetCount: 0,
    timeframeCount: supportedBinanceIntervals.length,
    savedCandleCount: 0,
    skippedOpenCandleCount: 0,
    errorCount: 0,
    rateLimitCount: 0,
    entitlementErrorCount: 0,
    temporaryErrorCount: 0,
    lastSuccessfulFetchAt: null
  };
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
  return new Promise<void>((resolveDelay) => {
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
