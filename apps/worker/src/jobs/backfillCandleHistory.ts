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
  FinnhubMarketDataAdapter,
  retryProviderRequest,
  saveCandles,
  supportedBinanceIntervals,
  supportedFinnhubIntervals,
  timeframeDurationMs,
  type BinanceInterval,
  type FinnhubFetchResult,
  type FinnhubInterval
} from "@signalpilot/market-data";
import pino from "pino";

import {
  markBackfillProgress,
  recordProviderOutcome,
  refreshCandleDataQuality,
  type ProviderOutcomeKind
} from "../lib/candleDataQuality.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

type BackfillAsset = {
  id: string;
  symbol: string;
  assetType: AssetType;
};

type BackfillDependencies = {
  binance?: Pick<BinanceMarketDataAdapter, "fetchKlines">;
  finnhub?: Pick<FinnhubMarketDataAdapter, "fetchStockCandles">;
  now?: Date;
};

export type CandleBackfillSummary = {
  status: BotRunStatus;
  assetCount: number;
  seriesCount: number;
  completedSeriesCount: number;
  resumedSeriesCount: number;
  requestCount: number;
  savedCandleCount: number;
  skippedOpenCandleCount: number;
  noDataCount: number;
  rateLimitCount: number;
  invalidApiKeyCount: number;
  entitlementErrorCount: number;
  unsupportedSymbolCount: number;
  temporaryErrorCount: number;
  providerErrorCount: number;
};

export async function backfillCandleHistory(
  database: PrismaClient = prisma,
  dependencies: BackfillDependencies = {}
): Promise<CandleBackfillSummary> {
  const now = dependencies.now ?? new Date();
  const binance = dependencies.binance ?? new BinanceMarketDataAdapter();
  const finnhub =
    dependencies.finnhub ??
    new FinnhubMarketDataAdapter({ apiKey: process.env.FINNHUB_API_KEY });
  const hasFinnhubApiKey =
    dependencies.finnhub !== undefined || Boolean(process.env.FINNHUB_API_KEY);
  const summary = emptySummary();
  const botRun = await database.botRun.create({
    data: {
      jobName: "backfillCandleHistory",
      status: BotRunStatus.RUNNING,
      startedAt: now,
      metadataJson: {
        flow: "INITIAL_BACKFILL",
        providers: ["BINANCE", "FINNHUB"]
      }
    }
  });

  await writeBotLog(database, "info", "Initial candle backfill started", {
    botRunId: botRun.id,
    flow: "INITIAL_BACKFILL"
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        isActive: true,
        assetType: { in: [AssetType.CRYPTO, AssetType.STOCK, AssetType.ETF] }
      },
      orderBy: { symbol: "asc" },
      take: positiveInteger(process.env.CANDLE_BACKFILL_MAX_ASSETS, 100)
    });
    summary.assetCount = assets.length;

    for (const asset of assets as BackfillAsset[]) {
      if (asset.assetType === AssetType.CRYPTO) {
        for (const timeframe of supportedBinanceIntervals) {
          summary.seriesCount += 1;
          const result = await backfillBinanceSeries(database, {
            asset,
            timeframe,
            adapter: binance,
            now,
            botRunId: botRun.id,
            summary
          });
          if (result.completed) summary.completedSeriesCount += 1;
          if (result.resumed) summary.resumedSeriesCount += 1;
          await delay(requestDelayMs());
        }
      } else {
        for (const timeframe of supportedFinnhubIntervals) {
          summary.seriesCount += 1;
          if (!hasFinnhubApiKey) {
            summary.providerErrorCount += 1;
            summary.invalidApiKeyCount += 1;
            await recordProviderOutcome(database, {
              assetId: asset.id,
              provider: "FINNHUB",
              timeframe,
              kind: "INVALID_API_KEY"
            });
            await writeBotLog(database, "error", "Finnhub backfill skipped: API key is not set", {
              botRunId: botRun.id,
              provider: "FINNHUB",
              symbol: asset.symbol,
              timeframe,
              errorKind: "INVALID_API_KEY"
            });
            continue;
          }
          const result = await backfillFinnhubSeries(database, {
            asset,
            timeframe,
            adapter: finnhub,
            now,
            botRunId: botRun.id,
            summary
          });
          if (result.completed) summary.completedSeriesCount += 1;
          if (result.resumed) summary.resumedSeriesCount += 1;
          await delay(requestDelayMs());
        }
      }
    }

    summary.status =
      summary.providerErrorCount > 0 || summary.rateLimitCount > 0
        ? BotRunStatus.FAILED
        : BotRunStatus.SUCCESS;
    await finishRun(database, botRun.id, summary);
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.providerErrorCount += 1;
    const message = error instanceof Error ? error.message : "Unknown initial backfill error";
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: { flow: "INITIAL_BACKFILL", fatalError: message, ...summary }
      }
    });
    await writeBotLog(database, "error", "Initial candle backfill failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

async function backfillBinanceSeries(
  database: PrismaClient,
  input: {
    asset: BackfillAsset;
    timeframe: BinanceInterval;
    adapter: Pick<BinanceMarketDataAdapter, "fetchKlines">;
    now: Date;
    botRunId: string;
    summary: CandleBackfillSummary;
  }
) {
  const desiredStart = new Date(
    input.now.getTime() -
      positiveInteger(process.env.CRYPTO_BACKFILL_LOOKBACK_DAYS, 730) * 24 * 60 * 60 * 1000
  );
  const desiredEnd = input.now;
  const state = await loadResumeState(
    database,
    input.asset.id,
    "BINANCE",
    input.timeframe,
    desiredStart,
    desiredEnd
  );
  const { start, end } = state;
  if (state.completed) return { completed: true, resumed: false };
  let cursor = state.cursor;
  const resumed = cursor.getTime() > start.getTime();
  const duration = timeframeDurationMs(input.timeframe) ?? 60 * 60 * 1000;

  try {
    while (cursor.getTime() <= end.getTime()) {
      const pageSize = positiveInteger(process.env.BINANCE_BACKFILL_PAGE_SIZE, 1000, 1000);
      const page = await input.adapter.fetchKlines(input.asset.symbol, input.timeframe, {
        limit: pageSize,
        startTime: cursor,
        endTime: end,
        retry: retryOptions(
          database,
          input.botRunId,
          input.asset.id,
          "BINANCE",
          input.asset.symbol,
          input.timeframe,
          input.summary
        )
      });
      input.summary.requestCount += 1;

      if (page.length === 0) break;
      const saved = await saveCandles(input.asset.id, page, database, input.now);
      input.summary.savedCandleCount += saved.savedCandleCount;
      input.summary.skippedOpenCandleCount += saved.skippedOpenCandleCount;
      await recordProviderOutcome(database, {
        assetId: input.asset.id,
        provider: "BINANCE",
        timeframe: input.timeframe,
        kind: "SUCCESS"
      });

      const next = new Date(page.at(-1)!.openTime.getTime() + duration);
      await markBackfillProgress(database, {
        assetId: input.asset.id,
        provider: "BINANCE",
        timeframe: input.timeframe,
        start,
        end,
        cursor: next,
        status: "RUNNING",
        metadataJson: { botRunId: input.botRunId }
      });
      if (next.getTime() <= cursor.getTime() || page.length < pageSize) {
        cursor = next;
        break;
      }
      cursor = next;
      await delay(requestDelayMs());
    }

    await markBackfillProgress(database, {
      assetId: input.asset.id,
      provider: "BINANCE",
      timeframe: input.timeframe,
      start,
      end,
      cursor: end,
      status: "SUCCESS",
      metadataJson: { botRunId: input.botRunId }
    });
    await refreshCandleDataQuality(database, {
      assetId: input.asset.id,
      provider: "BINANCE",
      timeframe: input.timeframe,
      marketKind: "CONTINUOUS",
      now: input.now
    });
    return { completed: true, resumed };
  } catch (error) {
    const outcomeKind = providerOutcomeFromError(error);
    countProviderFailure(input.summary, outcomeKind);
    await recordProviderOutcome(database, {
      assetId: input.asset.id,
      provider: "BINANCE",
      timeframe: input.timeframe,
      kind: outcomeKind
    });
    await markBackfillProgress(database, {
      assetId: input.asset.id,
      provider: "BINANCE",
      timeframe: input.timeframe,
      start,
      end,
      cursor,
      status: "FAILED",
      metadataJson: { botRunId: input.botRunId, errorKind: safeErrorKind(error) }
    });
    await writeBotLog(database, "error", "Binance backfill series failed", {
      botRunId: input.botRunId,
      symbol: input.asset.symbol,
      timeframe: input.timeframe,
      cursor: cursor.toISOString(),
      errorKind: safeErrorKind(error)
    });
    return { completed: false, resumed };
  }
}

async function backfillFinnhubSeries(
  database: PrismaClient,
  input: {
    asset: BackfillAsset;
    timeframe: FinnhubInterval;
    adapter: Pick<FinnhubMarketDataAdapter, "fetchStockCandles">;
    now: Date;
    botRunId: string;
    summary: CandleBackfillSummary;
  }
) {
  const lookbackDays =
    input.timeframe === "1h"
      ? positiveInteger(process.env.FINNHUB_BACKFILL_1H_DAYS, 90)
      : positiveInteger(process.env.FINNHUB_BACKFILL_1D_DAYS, 1825);
  const windowDays =
    input.timeframe === "1h"
      ? positiveInteger(process.env.FINNHUB_BACKFILL_1H_WINDOW_DAYS, 30)
      : positiveInteger(process.env.FINNHUB_BACKFILL_1D_WINDOW_DAYS, 365);
  const desiredStart = new Date(input.now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const desiredEnd = input.now;
  const state = await loadResumeState(
    database,
    input.asset.id,
    "FINNHUB",
    input.timeframe,
    desiredStart,
    desiredEnd
  );
  const { start, end } = state;
  if (state.completed) return { completed: true, resumed: false };
  let cursor = state.cursor;
  const resumed = cursor.getTime() > start.getTime();

  try {
    while (cursor.getTime() <= end.getTime()) {
      const windowEnd = new Date(
        Math.min(end.getTime(), cursor.getTime() + windowDays * 24 * 60 * 60 * 1000)
      );
      const outcome = await retryProviderRequest(
        () => input.adapter.fetchStockCandles(input.asset.symbol, input.timeframe, cursor, windowEnd),
        {
          ...retryOptions(
            database,
            input.botRunId,
            input.asset.id,
            "FINNHUB",
            input.asset.symbol,
            input.timeframe,
            input.summary
          ),
          shouldRetryResult: (result) =>
            result.kind === "rate_limit" || result.kind === "temporary_error",
          resultKind: (result) => result.kind.toUpperCase()
        }
      );
      input.summary.requestCount += 1;
      const result = outcome.value;

      if (result.kind === "ok") {
        const saved = await saveCandles(input.asset.id, result.candles, database, input.now);
        input.summary.savedCandleCount += saved.savedCandleCount;
        input.summary.skippedOpenCandleCount += saved.skippedOpenCandleCount;
        await recordProviderOutcome(database, {
          assetId: input.asset.id,
          provider: "FINNHUB",
          timeframe: input.timeframe,
          kind: "SUCCESS"
        });
      } else if (result.kind === "no_data") {
        input.summary.noDataCount += 1;
        await recordProviderOutcome(database, {
          assetId: input.asset.id,
          provider: "FINNHUB",
          timeframe: input.timeframe,
          kind: "NO_DATA"
        });
      } else {
        await recordFinnhubFailure(database, input, result);
        await markBackfillProgress(database, {
          assetId: input.asset.id,
          provider: "FINNHUB",
          timeframe: input.timeframe,
          start,
          end,
          cursor,
          status: "FAILED",
          metadataJson: { botRunId: input.botRunId, errorKind: result.kind.toUpperCase() }
        });
        await writeBotLog(database, "error", "Finnhub backfill series stopped", {
          botRunId: input.botRunId,
          symbol: input.asset.symbol,
          timeframe: input.timeframe,
          cursor: cursor.toISOString(),
          errorKind: result.kind.toUpperCase()
        });
        return { completed: false, resumed };
      }

      const next = new Date(windowEnd.getTime() + 1000);
      await markBackfillProgress(database, {
        assetId: input.asset.id,
        provider: "FINNHUB",
        timeframe: input.timeframe,
        start,
        end,
        cursor: next,
        status: "RUNNING",
        metadataJson: { botRunId: input.botRunId }
      });
      cursor = next;
      await delay(requestDelayMs());
    }

    await markBackfillProgress(database, {
      assetId: input.asset.id,
      provider: "FINNHUB",
      timeframe: input.timeframe,
      start,
      end,
      cursor: end,
      status: "SUCCESS",
      metadataJson: { botRunId: input.botRunId }
    });
    await refreshCandleDataQuality(database, {
      assetId: input.asset.id,
      provider: "FINNHUB",
      timeframe: input.timeframe,
      marketKind: "SESSION",
      now: input.now
    });
    return { completed: true, resumed };
  } catch (error) {
    const outcomeKind = providerOutcomeFromError(error);
    countProviderFailure(input.summary, outcomeKind);
    await recordProviderOutcome(database, {
      assetId: input.asset.id,
      provider: "FINNHUB",
      timeframe: input.timeframe,
      kind: outcomeKind
    });
    await markBackfillProgress(database, {
      assetId: input.asset.id,
      provider: "FINNHUB",
      timeframe: input.timeframe,
      start,
      end,
      cursor,
      status: "FAILED",
      metadataJson: { botRunId: input.botRunId, errorKind: safeErrorKind(error) }
    });
    await writeBotLog(database, "error", "Finnhub backfill series failed", {
      botRunId: input.botRunId,
      symbol: input.asset.symbol,
      timeframe: input.timeframe,
      cursor: cursor.toISOString(),
      errorKind: safeErrorKind(error)
    });
    return { completed: false, resumed };
  }
}

async function loadResumeState(
  database: PrismaClient,
  assetId: string,
  provider: string,
  timeframe: string,
  start: Date,
  end: Date
) {
  const quality = await database.candleDataQuality.findUnique({
    where: {
      assetId_provider_timeframe: { assetId, provider, timeframe }
    },
    select: {
      backfillStart: true,
      backfillEnd: true,
      backfillCursor: true,
      backfillStatus: true
    }
  });
  const unfinished =
    (quality?.backfillStatus === "RUNNING" || quality?.backfillStatus === "FAILED") &&
    quality.backfillStart &&
    quality.backfillEnd;
  const completed =
    quality?.backfillStatus === "SUCCESS" &&
    quality.backfillStart !== null &&
    quality.backfillStart.getTime() <= start.getTime();
  const rangeStart = unfinished ? quality.backfillStart! : start;
  const rangeEnd = unfinished ? quality.backfillEnd! : end;
  return {
    start: rangeStart,
    end: rangeEnd,
    cursor: unfinished && quality?.backfillCursor ? quality.backfillCursor : rangeStart,
    completed
  };
}

function retryOptions(
  database: PrismaClient,
  botRunId: string,
  assetId: string,
  provider: "BINANCE" | "FINNHUB",
  symbol: string,
  timeframe: string,
  summary: CandleBackfillSummary
) {
  return {
    maxAttempts: positiveInteger(process.env.PROVIDER_RETRY_MAX_ATTEMPTS, 3, 10),
    baseDelayMs: positiveInteger(process.env.PROVIDER_RETRY_BASE_DELAY_MS, 500, 60_000, true),
    maxDelayMs: positiveInteger(process.env.PROVIDER_RETRY_MAX_DELAY_MS, 8_000, 120_000, true),
    onRetry: async (event: { attempt: number; delayMs: number; kind: string }) => {
      if (event.kind === "RATE_LIMIT") {
        summary.rateLimitCount += 1;
        await recordProviderOutcome(database, {
          assetId,
          provider,
          timeframe,
          kind: "RATE_LIMIT"
        });
      }
      await writeBotLog(database, "warn", "Retrying provider backfill request", {
        botRunId,
        symbol,
        timeframe,
        attempt: event.attempt,
        delayMs: event.delayMs,
        errorKind: event.kind
      });
    }
  };
}

async function recordFinnhubFailure(
  database: PrismaClient,
  input: {
    asset: BackfillAsset;
    timeframe: FinnhubInterval;
    summary: CandleBackfillSummary;
  },
  result: Exclude<FinnhubFetchResult, { kind: "ok" | "no_data" }>
) {
  const kind =
    result.kind === "rate_limit"
      ? "RATE_LIMIT"
      : result.kind === "invalid_api_key"
        ? "INVALID_API_KEY"
        : result.kind === "entitlement"
          ? "ENTITLEMENT"
          : result.kind === "unsupported_symbol"
            ? "UNSUPPORTED_SYMBOL"
            : result.kind === "temporary_error"
              ? "TEMPORARY"
              : "PERMANENT";
  countProviderFailure(input.summary, kind);
  await recordProviderOutcome(database, {
    assetId: input.asset.id,
    provider: "FINNHUB",
    timeframe: input.timeframe,
    kind
  });
}

function countProviderFailure(
  summary: CandleBackfillSummary,
  kind: ProviderOutcomeKind
) {
  summary.providerErrorCount += 1;
  if (kind === "RATE_LIMIT") summary.rateLimitCount += 1;
  if (kind === "INVALID_API_KEY") summary.invalidApiKeyCount += 1;
  if (kind === "ENTITLEMENT") summary.entitlementErrorCount += 1;
  if (kind === "UNSUPPORTED_SYMBOL") summary.unsupportedSymbolCount += 1;
  if (kind === "TEMPORARY") summary.temporaryErrorCount += 1;
}

function providerOutcomeFromError(error: unknown): ProviderOutcomeKind {
  if (error && typeof error === "object" && "kind" in error) {
    const kind = error.kind;
    if (
      kind === "RATE_LIMIT" ||
      kind === "INVALID_API_KEY" ||
      kind === "ENTITLEMENT" ||
      kind === "UNSUPPORTED_SYMBOL" ||
      kind === "TEMPORARY" ||
      kind === "PERMANENT"
    ) {
      return kind;
    }
  }
  return "TEMPORARY";
}

function safeErrorKind(error: unknown) {
  if (error && typeof error === "object" && "kind" in error && typeof error.kind === "string") {
    return error.kind;
  }
  return "PROVIDER_ERROR";
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
  allowZero = false
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < (allowZero ? 0 : 1)) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function requestDelayMs() {
  return positiveInteger(process.env.MARKET_DATA_REQUEST_DELAY_MS, 500, 60_000, true);
}

function emptySummary(): CandleBackfillSummary {
  return {
    status: BotRunStatus.RUNNING,
    assetCount: 0,
    seriesCount: 0,
    completedSeriesCount: 0,
    resumedSeriesCount: 0,
    requestCount: 0,
    savedCandleCount: 0,
    skippedOpenCandleCount: 0,
    noDataCount: 0,
    rateLimitCount: 0,
    invalidApiKeyCount: 0,
    entitlementErrorCount: 0,
    unsupportedSymbolCount: 0,
    temporaryErrorCount: 0,
    providerErrorCount: 0
  };
}

async function finishRun(
  database: PrismaClient,
  botRunId: string,
  summary: CandleBackfillSummary
) {
  await database.botRun.update({
    where: { id: botRunId },
    data: {
      status: summary.status,
      finishedAt: new Date(),
      metadataJson: { flow: "INITIAL_BACKFILL", ...summary }
    }
  });
  await writeBotLog(
    database,
    summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
    "Initial candle backfill finished",
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
    const summary = await backfillCandleHistory();
    if (summary.status === BotRunStatus.FAILED) {
      process.exitCode = 1;
      logger.error({ summary }, "backfillCandleHistory completed with provider failures");
    } else {
      logger.info({ summary }, "backfillCandleHistory completed");
    }
  } finally {
    await prisma.$disconnect();
  }
}
