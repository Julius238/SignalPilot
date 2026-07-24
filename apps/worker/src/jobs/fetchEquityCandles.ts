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
  retryProviderRequest,
  saveCandles,
  supportedFinnhubIntervals,
  timeframeDurationMs,
  type FinnhubFetchResult,
  type FinnhubInterval
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

type EquityCandleAdapter = Pick<FinnhubMarketDataAdapter, "fetchStockCandles">;

function getRequestDelayMs() {
  return Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 500);
}

export type FetchEquityCandlesSummary = {
  status: BotRunStatus;
  assetCount: number;
  timeframeCount: number;
  savedCandleCount: number;
  skippedOpenCandleCount: number;
  noDataCount: number;
  errorCount: number;
  rateLimitCount: number;
  forbiddenCount: number;
  invalidApiKeyCount: number;
  entitlementErrorCount: number;
  unsupportedSymbolCount: number;
  temporaryErrorCount: number;
  staleDataCount: number;
  lastSuccessfulFetchAt: string | null;
};

export async function fetchEquityCandles(
  database: PrismaClient = prisma,
  adapterOverride?: EquityCandleAdapter
): Promise<FetchEquityCandlesSummary> {
  if (!adapterOverride && !process.env.FINNHUB_API_KEY) {
    const botRun = await database.botRun.create({
      data: {
        jobName: "fetchEquityCandles",
        status: BotRunStatus.FAILED,
        startedAt: new Date(),
        finishedAt: new Date(),
        metadataJson: {
          provider: "FINNHUB",
          errorKind: "INVALID_API_KEY",
          fatalError: "FINNHUB_API_KEY is not set."
        }
      }
    });
    await writeBotLog(database, "error", "fetchEquityCandles failed: FINNHUB_API_KEY is not set.", {
      botRunId: botRun.id,
      provider: "FINNHUB",
      errorKind: "INVALID_API_KEY"
    });
    const missingKeySummary = emptySummary();
    missingKeySummary.invalidApiKeyCount = 1;
    missingKeySummary.errorCount = 1;
    return missingKeySummary;
  }

  const adapter =
    adapterOverride ?? new FinnhubMarketDataAdapter({ apiKey: process.env.FINNHUB_API_KEY });
  const startedAt = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchEquityCandles",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        provider: "FINNHUB",
        flow: "INCREMENTAL",
        intervals: [...supportedFinnhubIntervals]
      }
    }
  });
  const summary = emptySummary();
  await writeBotLog(database, "info", "fetchEquityCandles started", {
    botRunId: botRun.id,
    provider: "FINNHUB",
    flow: "INCREMENTAL"
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: { in: [AssetType.STOCK, AssetType.ETF] },
        isActive: true
      },
      orderBy: { symbol: "asc" }
    });
    summary.assetCount = assets.length;
    const now = new Date();

    for (const asset of assets) {
      for (const interval of supportedFinnhubIntervals) {
        const latest = await database.candle.findFirst({
          where: {
            assetId: asset.id,
            timeframe: interval,
            source: "FINNHUB",
            closeTime: { lte: now }
          },
          orderBy: { closeTime: "desc" },
          select: { closeTime: true }
        });
        const from = incrementalStart(latest?.closeTime ?? null, interval, now);

        try {
          const outcome = await retryProviderRequest(
            () => adapter.fetchStockCandles(asset.symbol, interval, from, now),
            {
              maxAttempts: Number(process.env.PROVIDER_RETRY_MAX_ATTEMPTS ?? 3),
              baseDelayMs: Number(process.env.PROVIDER_RETRY_BASE_DELAY_MS ?? 500),
              maxDelayMs: Number(process.env.PROVIDER_RETRY_MAX_DELAY_MS ?? 8_000),
              shouldRetryResult: (result) =>
                result.kind === "rate_limit" || result.kind === "temporary_error",
              resultKind: (result) => result.kind.toUpperCase(),
              onRetry: async (event) => {
                if (event.kind === "RATE_LIMIT") {
                  summary.rateLimitCount += 1;
                  await recordProviderOutcome(database, {
                    assetId: asset.id,
                    provider: "FINNHUB",
                    timeframe: interval,
                    kind: "RATE_LIMIT"
                  });
                }
                await writeBotLog(database, "warn", "Retrying Finnhub candle request", {
                  botRunId: botRun.id,
                  symbol: asset.symbol,
                  timeframe: interval,
                  attempt: event.attempt,
                  delayMs: event.delayMs,
                  errorKind: event.kind
                });
              }
            }
          );
          const result = outcome.value;
          await handleFetchResult(database, {
            botRunId: botRun.id,
            assetId: asset.id,
            symbol: asset.symbol,
            timeframe: interval,
            result,
            now,
            summary
          });
        } catch (error) {
          summary.errorCount += 1;
          await recordProviderOutcome(database, {
            assetId: asset.id,
            provider: "FINNHUB",
            timeframe: interval,
            kind: "TEMPORARY"
          });
          const message = error instanceof Error ? error.message : "Unknown candle fetch error";
          logger.error({ error, symbol: asset.symbol, timeframe: interval }, message);
          await writeBotLog(database, "error", "Failed to fetch Finnhub candles", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            timeframe: interval,
            error: message
          });
        }

        await refreshCandleDataQuality(database, {
          assetId: asset.id,
          provider: "FINNHUB",
          timeframe: interval,
          marketKind: "SESSION",
          now
        });
        await delay(getRequestDelayMs());
      }
    }

    summary.status = hasProviderFailure(summary) ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
    await finishRun(database, botRun.id, summary);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchEquityCandles error";
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          provider: "FINNHUB",
          flow: "INCREMENTAL",
          fatalError: message,
          ...summary
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

async function handleFetchResult(
  database: PrismaClient,
  input: {
    botRunId: string;
    assetId: string;
    symbol: string;
    timeframe: FinnhubInterval;
    result: FinnhubFetchResult;
    now: Date;
    summary: FetchEquityCandlesSummary;
  }
) {
  const { result, summary } = input;

  if (result.kind === "ok") {
    const saveResult = await saveCandles(input.assetId, result.candles, database, input.now);
    summary.savedCandleCount += saveResult.savedCandleCount;
    summary.skippedOpenCandleCount += saveResult.skippedOpenCandleCount;
    summary.lastSuccessfulFetchAt = input.now.toISOString();
    await recordProviderOutcome(database, qualityOutcome(input, "SUCCESS"));

    const newestClosed = result.candles
      .filter((candle) => candle.closeTime.getTime() <= input.now.getTime())
      .sort((left, right) => right.closeTime.getTime() - left.closeTime.getTime())[0];
    if (newestClosed && isStale(newestClosed.closeTime, input.timeframe, input.now)) {
      summary.staleDataCount += 1;
      await writeBotLog(database, "warn", "Finnhub returned stale candle data", {
        botRunId: input.botRunId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        latestClosedCandle: newestClosed.closeTime.toISOString(),
        errorKind: "STALE_DATA"
      });
    }
    return;
  }

  if (result.kind === "no_data") {
    summary.noDataCount += 1;
    await recordProviderOutcome(database, qualityOutcome(input, "NO_DATA"));
    return;
  }

  const kind = providerOutcomeKind(result.kind);
  if (result.kind === "rate_limit") summary.rateLimitCount += 1;
  if (result.kind === "invalid_api_key") summary.invalidApiKeyCount += 1;
  if (result.kind === "entitlement") {
    summary.entitlementErrorCount += 1;
    summary.forbiddenCount += 1;
  }
  if (result.kind === "unsupported_symbol") summary.unsupportedSymbolCount += 1;
  if (result.kind === "temporary_error") summary.temporaryErrorCount += 1;
  if (result.kind === "permanent_error") summary.errorCount += 1;
  await recordProviderOutcome(database, qualityOutcome(input, kind));
  await writeBotLog(database, "warn", "Finnhub candle provider failure", {
    botRunId: input.botRunId,
    provider: "FINNHUB",
    endpointType: "stock/candle",
    symbol: input.symbol,
    timeframe: input.timeframe,
    statusCode: "statusCode" in result ? result.statusCode : 429,
    errorKind: kind
  });
}

function qualityOutcome(
  input: { assetId: string; timeframe: string },
  kind: ProviderOutcomeKind
) {
  return {
    assetId: input.assetId,
    provider: "FINNHUB",
    timeframe: input.timeframe,
    kind
  };
}

function providerOutcomeKind(kind: Exclude<FinnhubFetchResult["kind"], "ok" | "no_data">): ProviderOutcomeKind {
  const mapping: Record<typeof kind, ProviderOutcomeKind> = {
    rate_limit: "RATE_LIMIT",
    invalid_api_key: "INVALID_API_KEY",
    entitlement: "ENTITLEMENT",
    unsupported_symbol: "UNSUPPORTED_SYMBOL",
    temporary_error: "TEMPORARY",
    permanent_error: "PERMANENT"
  };
  return mapping[kind];
}

function incrementalStart(latestClose: Date | null, timeframe: FinnhubInterval, now: Date) {
  const duration = timeframeDurationMs(timeframe) ?? 24 * 60 * 60 * 1000;
  if (latestClose) return new Date(latestClose.getTime() - duration * 2);
  const bootstrapDays = Number(
    process.env.EQUITY_INCREMENTAL_BOOTSTRAP_DAYS ?? (timeframe === "1h" ? 7 : 14)
  );
  return new Date(now.getTime() - bootstrapDays * 24 * 60 * 60 * 1000);
}

function isStale(closeTime: Date, timeframe: FinnhubInterval, now: Date) {
  const defaultHours = timeframe === "1h" ? 96 : 120;
  const maxAgeHours = Number(process.env.FINNHUB_MAX_DATA_AGE_HOURS ?? defaultHours);
  return now.getTime() - closeTime.getTime() > maxAgeHours * 60 * 60 * 1000;
}

function hasProviderFailure(summary: FetchEquityCandlesSummary) {
  return (
    summary.errorCount > 0 ||
    summary.rateLimitCount > 0 ||
    summary.invalidApiKeyCount > 0 ||
    summary.entitlementErrorCount > 0 ||
    summary.unsupportedSymbolCount > 0 ||
    summary.temporaryErrorCount > 0 ||
    summary.staleDataCount > 0
  );
}

function emptySummary(): FetchEquityCandlesSummary {
  return {
    status: BotRunStatus.FAILED,
    assetCount: 0,
    timeframeCount: supportedFinnhubIntervals.length,
    savedCandleCount: 0,
    skippedOpenCandleCount: 0,
    noDataCount: 0,
    errorCount: 0,
    rateLimitCount: 0,
    forbiddenCount: 0,
    invalidApiKeyCount: 0,
    entitlementErrorCount: 0,
    unsupportedSymbolCount: 0,
    temporaryErrorCount: 0,
    staleDataCount: 0,
    lastSuccessfulFetchAt: null
  };
}

async function finishRun(
  database: PrismaClient,
  botRunId: string,
  summary: FetchEquityCandlesSummary
) {
  await database.botRun.update({
    where: { id: botRunId },
    data: {
      status: summary.status,
      finishedAt: new Date(),
      metadataJson: {
        provider: "FINNHUB",
        flow: "INCREMENTAL",
        intervals: [...supportedFinnhubIntervals],
        ...summary
      }
    }
  });
  await writeBotLog(
    database,
    summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
    "fetchEquityCandles finished",
    { botRunId, ...summary }
  );
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
    await fetchEquityCandles();
    logger.info("fetchEquityCandles completed");
  } finally {
    await prisma.$disconnect();
  }
}
