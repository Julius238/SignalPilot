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
import {
  FinnhubNewsAdapter,
  retryProviderRequest,
  type NormalizedNewsItem
} from "@signalpilot/market-data";
import {
  buildNewsDedupeKey,
  classifyNewsSentiment,
  normalizeNewsUrl,
  scoreNewsRelevance
} from "@signalpilot/news-intelligence";
import pino from "pino";

const logger = pino({ name: "signalpilot-worker" });

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

type NewsAdapter = Pick<FinnhubNewsAdapter, "fetchCompanyNews">;
type AssetTarget = { id: string; symbol: string };

function getRequestDelayMs() {
  return Number(process.env.MARKET_DATA_REQUEST_DELAY_MS ?? 500);
}

function getLookbackDays() {
  return Number(process.env.NEWS_LOOKBACK_DAYS ?? 7);
}

function getRetryAttempts() {
  return Number(process.env.PROVIDER_RETRY_MAX_ATTEMPTS ?? 3);
}

function getDashboardOnlyThreshold() {
  return Number(process.env.NEWS_MIN_RELEVANCE_SCORE ?? 30);
}

export type FetchEquityNewsSummary = {
  status: BotRunStatus;
  assetCount: number;
  fetchedNewsCount: number;
  savedNewsCount: number;
  duplicateCount: number;
  dashboardOnlyCount: number;
  discardedNewsCount: number;
  noNewsCount: number;
  rateLimitCount: number;
  invalidApiKeyCount: number;
  entitlementErrorCount: number;
  unsupportedSymbolCount: number;
  temporaryErrorCount: number;
  errorCount: number;
};

export async function fetchEquityNews(
  database: PrismaClient = prisma,
  adapterOverride?: NewsAdapter
): Promise<FetchEquityNewsSummary> {
  const apiKey = process.env.FINNHUB_API_KEY ?? "";

  if (!adapterOverride && !apiKey) {
    const botRun = await database.botRun.create({
      data: {
        jobName: "fetchEquityNews",
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
    await writeBotLog(database, "error", "fetchEquityNews failed: FINNHUB_API_KEY is not set.", {
      botRunId: botRun.id,
      provider: "FINNHUB",
      errorKind: "INVALID_API_KEY"
    });
    const summary = emptySummary();
    summary.invalidApiKeyCount = 1;
    summary.errorCount = 1;
    return summary;
  }

  const watchlistOnly = process.env.NEWS_WATCHLIST_ONLY === "true";
  const lookbackDays = getLookbackDays();
  const adapter = adapterOverride ?? new FinnhubNewsAdapter({ apiKey });
  const botRun = await database.botRun.create({
    data: {
      jobName: "fetchEquityNews",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        provider: "FINNHUB",
        sourceType: "company-news",
        lookbackDays,
        watchlistOnly
      }
    }
  });

  const summary = emptySummary();
  await writeBotLog(database, "info", "fetchEquityNews started", {
    botRunId: botRun.id,
    provider: "FINNHUB",
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
    const assetBySymbol = new Map(
      assets.map((asset) => [asset.symbol.toUpperCase(), { id: asset.id, symbol: asset.symbol }])
    );
    summary.assetCount = assets.length;

    const now = new Date();
    const from = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    for (const asset of assets) {
      try {
        const outcome = await retryProviderRequest(
          () => adapter.fetchCompanyNews(asset.symbol, from, now),
          {
            maxAttempts: getRetryAttempts(),
            baseDelayMs: Number(process.env.PROVIDER_RETRY_BASE_DELAY_MS ?? 500),
            maxDelayMs: Number(process.env.PROVIDER_RETRY_MAX_DELAY_MS ?? 8_000),
            shouldRetryResult: (result) =>
              result.kind === "rate_limit" || result.kind === "temporary_error",
            resultKind: (result) => result.kind.toUpperCase(),
            onRetry: async (event) => {
              if (event.kind === "RATE_LIMIT") summary.rateLimitCount += 1;
              await writeBotLog(database, "warn", "Retrying Finnhub company-news request", {
                botRunId: botRun.id,
                symbol: asset.symbol,
                attempt: event.attempt,
                delayMs: event.delayMs,
                errorKind: event.kind
              });
            }
          }
        );
        const result = outcome.value;

        if (result.kind === "rate_limit") {
          summary.rateLimitCount += 1;
          await logProviderFailure(database, botRun.id, asset.symbol, "RATE_LIMIT");
        } else if (result.kind === "invalid_api_key") {
          summary.invalidApiKeyCount += 1;
          await logProviderFailure(database, botRun.id, asset.symbol, "INVALID_API_KEY", 401);
        } else if (result.kind === "entitlement") {
          summary.entitlementErrorCount += 1;
          await logProviderFailure(database, botRun.id, asset.symbol, "ENTITLEMENT", 403);
        } else if (result.kind === "unsupported_symbol") {
          summary.unsupportedSymbolCount += 1;
          await logProviderFailure(database, botRun.id, asset.symbol, "UNSUPPORTED_SYMBOL", result.statusCode);
        } else if (result.kind === "temporary_error") {
          summary.temporaryErrorCount += 1;
          await logProviderFailure(database, botRun.id, asset.symbol, "TEMPORARY", result.statusCode);
        } else if (result.kind === "permanent_error") {
          summary.errorCount += 1;
          await logProviderFailure(database, botRun.id, asset.symbol, "PERMANENT", result.statusCode);
        } else if (result.kind === "no_news") {
          summary.noNewsCount += 1;
        } else {
          summary.fetchedNewsCount += result.items.length;
          const saved = await saveNewsItems(
            database,
            result.items,
            assetBySymbol,
            asset,
            now
          );
          summary.savedNewsCount += saved.saved;
          summary.duplicateCount += saved.duplicates;
          summary.dashboardOnlyCount += saved.dashboardOnly;

          await writeBotLog(database, "info", "Saved equity news items", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            fetched: result.items.length,
            saved: saved.saved,
            duplicates: saved.duplicates,
            multiAssetLinks: saved.multiAssetLinks,
            dashboardOnly: saved.dashboardOnly
          });
        }
      } catch (error) {
        summary.errorCount += 1;
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

    summary.status = hasProviderFailure(summary) ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: summary.status,
        finishedAt: new Date(),
        metadataJson: {
          provider: "FINNHUB",
          sourceType: "company-news",
          lookbackDays,
          watchlistOnly,
          ...summary
        }
      }
    });
    await writeBotLog(
      database,
      summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
      "fetchEquityNews finished",
      { botRunId: botRun.id, ...summary }
    );
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetchEquityNews error";
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          provider: "FINNHUB",
          sourceType: "company-news",
          fatalError: message,
          ...summary
        }
      }
    });
    await writeBotLog(database, "error", "fetchEquityNews failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

export async function saveNewsItems(
  database: PrismaClient,
  items: NormalizedNewsItem[],
  assetBySymbol: Map<string, AssetTarget>,
  requestedAsset: AssetTarget,
  now: Date = new Date()
): Promise<{ saved: number; duplicates: number; dashboardOnly: number; multiAssetLinks: number }> {
  let saved = 0;
  let duplicates = 0;
  let dashboardOnlyCount = 0;
  let multiAssetLinks = 0;

  for (const item of items) {
    const relatedSymbols = [
      ...new Set([requestedAsset.symbol, ...item.relatedSymbols].map((symbol) => symbol.toUpperCase()))
    ];
    const targets = relatedSymbols
      .map((symbol) => assetBySymbol.get(symbol))
      .filter((asset): asset is AssetTarget => asset !== undefined);
    const uniqueTargets = targets.length > 0
      ? [...new Map(targets.map((asset) => [asset.id, asset])).values()]
      : [requestedAsset];
    const relevanceScore = scoreNewsRelevance(item, now);
    const sentiment = classifyNewsSentiment(item);
    const dashboardOnly = relevanceScore < getDashboardOnlyThreshold();
    const dedupeKey = buildNewsDedupeKey(item);
    const url = normalizeNewsUrl(item.url);

    for (const target of uniqueTargets) {
      try {
        const existing = await database.newsItem.findFirst({
          where: { assetId: target.id, dedupeKey }
        });

        if (existing) {
          duplicates += 1;
          await database.newsItem.update({
            where: { id: existing.id },
            data: {
              relatedSymbols,
              category: mergeCategories(existing.category, item.category),
              relevanceScore,
              sentiment,
              dashboardOnly,
              transportProvider: item.transportProvider
            }
          });
          continue;
        }

        await database.newsItem.create({
          data: {
            assetId: target.id,
            symbol: target.symbol,
            source: item.source,
            transportProvider: item.transportProvider,
            headline: item.headline,
            summary: item.summary,
            url,
            imageUrl: item.imageUrl,
            publishedAt: item.publishedAt,
            category: item.category,
            relatedSymbols,
            sentiment,
            relevanceScore,
            dedupeKey,
            dashboardOnly,
            rawJson: item.rawJson as Prisma.InputJsonValue
          }
        });
        saved += 1;
        if (dashboardOnly) dashboardOnlyCount += 1;
        if (target.id !== requestedAsset.id) multiAssetLinks += 1;
      } catch (error) {
        if (error instanceof Error && error.message.includes("Unique constraint")) {
          duplicates += 1;
        } else {
          throw error;
        }
      }
    }
  }

  return {
    saved,
    duplicates,
    dashboardOnly: dashboardOnlyCount,
    multiAssetLinks
  };
}

function emptySummary(): FetchEquityNewsSummary {
  return {
    status: BotRunStatus.FAILED,
    assetCount: 0,
    fetchedNewsCount: 0,
    savedNewsCount: 0,
    duplicateCount: 0,
    dashboardOnlyCount: 0,
    discardedNewsCount: 0,
    noNewsCount: 0,
    rateLimitCount: 0,
    invalidApiKeyCount: 0,
    entitlementErrorCount: 0,
    unsupportedSymbolCount: 0,
    temporaryErrorCount: 0,
    errorCount: 0
  };
}

function hasProviderFailure(summary: FetchEquityNewsSummary) {
  return (
    summary.rateLimitCount > 0 ||
    summary.invalidApiKeyCount > 0 ||
    summary.entitlementErrorCount > 0 ||
    summary.unsupportedSymbolCount > 0 ||
    summary.temporaryErrorCount > 0 ||
    summary.errorCount > 0
  );
}

function mergeCategories(existing: string | null, incoming: string | null) {
  const categories = [
    ...new Set(
      [existing, incoming]
        .flatMap((value) => value?.split(",") ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
  return categories.length > 0 ? categories.join(", ") : null;
}

async function logProviderFailure(
  database: PrismaClient,
  botRunId: string,
  symbol: string,
  errorKind: string,
  statusCode?: number | null
) {
  await writeBotLog(database, "warn", "Finnhub company-news provider failure", {
    botRunId,
    provider: "FINNHUB",
    endpointType: "company-news",
    symbol,
    errorKind,
    statusCode: statusCode ?? null
  });
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
    await fetchEquityNews();
    logger.info("fetchEquityNews completed");
  } finally {
    await prisma.$disconnect();
  }
}
