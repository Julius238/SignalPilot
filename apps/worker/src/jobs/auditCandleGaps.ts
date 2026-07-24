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
  type BinanceInterval,
  type FinnhubInterval
} from "@signalpilot/market-data";
import pino from "pino";

import {
  recordProviderOutcome,
  refreshCandleDataQuality
} from "../lib/candleDataQuality.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

type AuditDependencies = {
  binance?: Pick<BinanceMarketDataAdapter, "fetchKlines">;
  finnhub?: Pick<FinnhubMarketDataAdapter, "fetchStockCandles">;
  now?: Date;
};

export type CandleGapAuditSummary = {
  status: BotRunStatus;
  seriesAudited: number;
  gapsDetected: number;
  gapsAttempted: number;
  gapsRepaired: number;
  remainingGaps: number;
  savedCandleCount: number;
  noDataCount: number;
  rateLimitCount: number;
  providerErrorCount: number;
};

export async function auditCandleGaps(
  database: PrismaClient = prisma,
  dependencies: AuditDependencies = {}
): Promise<CandleGapAuditSummary> {
  const now = dependencies.now ?? new Date();
  const binance = dependencies.binance ?? new BinanceMarketDataAdapter();
  const finnhub =
    dependencies.finnhub ??
    new FinnhubMarketDataAdapter({ apiKey: process.env.FINNHUB_API_KEY });
  const maxRepairs = positiveInteger(process.env.CANDLE_GAP_MAX_REPAIRS_PER_RUN, 25);
  const summary = emptySummary();
  const botRun = await database.botRun.create({
    data: {
      jobName: "auditCandleGaps",
      status: BotRunStatus.RUNNING,
      startedAt: now,
      metadataJson: { flow: "GAP_AUDIT", maxRepairs }
    }
  });

  try {
    const assets = await database.asset.findMany({
      where: { isActive: true },
      orderBy: { symbol: "asc" }
    });

    for (const asset of assets) {
      const isCrypto = asset.assetType === AssetType.CRYPTO;
      const provider = isCrypto ? "BINANCE" : "FINNHUB";
      const intervals = isCrypto ? supportedBinanceIntervals : supportedFinnhubIntervals;

      for (const timeframe of intervals) {
        summary.seriesAudited += 1;
        const audit = await refreshCandleDataQuality(database, {
          assetId: asset.id,
          provider,
          timeframe,
          marketKind: isCrypto ? "CONTINUOUS" : "SESSION",
          now
        });
        summary.gapsDetected += audit.gapCount;

        for (const gap of audit.gaps) {
          if (summary.gapsAttempted >= maxRepairs) break;
          summary.gapsAttempted += 1;

          if (isCrypto) {
            await repairBinanceGap(database, {
              adapter: binance,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe: timeframe as BinanceInterval,
              from: gap.from,
              to: gap.to,
              missingCandleCount: gap.missingCandleCount,
              now,
              botRunId: botRun.id,
              summary
            });
          } else {
            await repairFinnhubGap(database, {
              adapter: finnhub,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe: timeframe as FinnhubInterval,
              from: gap.from,
              to: gap.to,
              now,
              botRunId: botRun.id,
              summary
            });
          }
          await delay(requestDelayMs());
        }

        const after = await refreshCandleDataQuality(database, {
          assetId: asset.id,
          provider,
          timeframe,
          marketKind: isCrypto ? "CONTINUOUS" : "SESSION",
          now
        });
        summary.remainingGaps += after.gapCount;
      }
    }

    summary.gapsRepaired = Math.max(0, summary.gapsDetected - summary.remainingGaps);
    summary.status =
      summary.providerErrorCount > 0 || summary.rateLimitCount > 0
        ? BotRunStatus.FAILED
        : BotRunStatus.SUCCESS;
    await finishRun(database, botRun.id, summary);
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.providerErrorCount += 1;
    const message = error instanceof Error ? error.message : "Unknown gap audit error";
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: { flow: "GAP_AUDIT", fatalError: message, ...summary }
      }
    });
    throw error;
  }
}

async function repairBinanceGap(
  database: PrismaClient,
  input: {
    adapter: Pick<BinanceMarketDataAdapter, "fetchKlines">;
    assetId: string;
    symbol: string;
    timeframe: BinanceInterval;
    from: Date;
    to: Date;
    missingCandleCount: number;
    now: Date;
    botRunId: string;
    summary: CandleGapAuditSummary;
  }
) {
  try {
    const candles = await input.adapter.fetchKlines(input.symbol, input.timeframe, {
      limit: Math.min(1000, input.missingCandleCount + 2),
      startTime: input.from,
      endTime: input.to,
      retry: retryOptions(
        database,
        input.botRunId,
        input.assetId,
        "BINANCE",
        input.symbol,
        input.timeframe,
        input.summary
      )
    });
    const saved = await saveCandles(input.assetId, candles, database, input.now);
    input.summary.savedCandleCount += saved.savedCandleCount;
    await recordProviderOutcome(database, {
      assetId: input.assetId,
      provider: "BINANCE",
      timeframe: input.timeframe,
      kind: "SUCCESS"
    });
  } catch (error) {
    input.summary.providerErrorCount += 1;
    const outcomeKind = providerOutcomeFromError(error);
    if (outcomeKind === "RATE_LIMIT") input.summary.rateLimitCount += 1;
    await recordProviderOutcome(database, {
      assetId: input.assetId,
      provider: "BINANCE",
      timeframe: input.timeframe,
      kind: outcomeKind
    });
    await writeBotLog(database, "warn", "Binance gap repair failed", {
      botRunId: input.botRunId,
      symbol: input.symbol,
      timeframe: input.timeframe,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      errorKind: safeErrorKind(error)
    });
  }
}

async function repairFinnhubGap(
  database: PrismaClient,
  input: {
    adapter: Pick<FinnhubMarketDataAdapter, "fetchStockCandles">;
    assetId: string;
    symbol: string;
    timeframe: FinnhubInterval;
    from: Date;
    to: Date;
    now: Date;
    botRunId: string;
    summary: CandleGapAuditSummary;
  }
) {
  try {
    const outcome = await retryProviderRequest(
      () => input.adapter.fetchStockCandles(input.symbol, input.timeframe, input.from, input.to),
      {
        ...retryOptions(
          database,
          input.botRunId,
          input.assetId,
          "FINNHUB",
          input.symbol,
          input.timeframe,
          input.summary
        ),
        shouldRetryResult: (result) =>
          result.kind === "rate_limit" || result.kind === "temporary_error",
        resultKind: (result) => result.kind.toUpperCase()
      }
    );
    const result = outcome.value;
    if (result.kind === "ok") {
      const saved = await saveCandles(input.assetId, result.candles, database, input.now);
      input.summary.savedCandleCount += saved.savedCandleCount;
      await recordProviderOutcome(database, {
        assetId: input.assetId,
        provider: "FINNHUB",
        timeframe: input.timeframe,
        kind: "SUCCESS"
      });
    } else if (result.kind === "no_data") {
      input.summary.noDataCount += 1;
      await recordProviderOutcome(database, {
        assetId: input.assetId,
        provider: "FINNHUB",
        timeframe: input.timeframe,
        kind: "NO_DATA"
      });
    } else {
      input.summary.providerErrorCount += 1;
      if (result.kind === "rate_limit") input.summary.rateLimitCount += 1;
      await recordProviderOutcome(database, {
        assetId: input.assetId,
        provider: "FINNHUB",
        timeframe: input.timeframe,
        kind:
          result.kind === "rate_limit"
            ? "RATE_LIMIT"
            : result.kind === "entitlement"
              ? "ENTITLEMENT"
              : result.kind === "invalid_api_key"
                ? "INVALID_API_KEY"
                : result.kind === "unsupported_symbol"
                  ? "UNSUPPORTED_SYMBOL"
                  : result.kind === "temporary_error"
                    ? "TEMPORARY"
                    : "PERMANENT"
      });
    }
  } catch (error) {
    input.summary.providerErrorCount += 1;
    const outcomeKind = providerOutcomeFromError(error);
    if (outcomeKind === "RATE_LIMIT") input.summary.rateLimitCount += 1;
    await recordProviderOutcome(database, {
      assetId: input.assetId,
      provider: "FINNHUB",
      timeframe: input.timeframe,
      kind: outcomeKind
    });
    await writeBotLog(database, "warn", "Finnhub gap repair failed", {
      botRunId: input.botRunId,
      symbol: input.symbol,
      timeframe: input.timeframe,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      errorKind: safeErrorKind(error)
    });
  }
}

function retryOptions(
  database: PrismaClient,
  botRunId: string,
  assetId: string,
  provider: "BINANCE" | "FINNHUB",
  symbol: string,
  timeframe: string,
  summary: CandleGapAuditSummary
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
      await writeBotLog(database, "warn", "Retrying gap repair request", {
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

function safeErrorKind(error: unknown) {
  if (error && typeof error === "object" && "kind" in error && typeof error.kind === "string") {
    return error.kind;
  }
  return "PROVIDER_ERROR";
}

function providerOutcomeFromError(
  error: unknown
): "RATE_LIMIT" | "INVALID_API_KEY" | "ENTITLEMENT" | "UNSUPPORTED_SYMBOL" | "TEMPORARY" | "PERMANENT" {
  const kind = safeErrorKind(error);
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
  return "TEMPORARY";
}

function emptySummary(): CandleGapAuditSummary {
  return {
    status: BotRunStatus.RUNNING,
    seriesAudited: 0,
    gapsDetected: 0,
    gapsAttempted: 0,
    gapsRepaired: 0,
    remainingGaps: 0,
    savedCandleCount: 0,
    noDataCount: 0,
    rateLimitCount: 0,
    providerErrorCount: 0
  };
}

async function finishRun(
  database: PrismaClient,
  botRunId: string,
  summary: CandleGapAuditSummary
) {
  await database.botRun.update({
    where: { id: botRunId },
    data: {
      status: summary.status,
      finishedAt: new Date(),
      metadataJson: { flow: "GAP_AUDIT", ...summary }
    }
  });
  await writeBotLog(
    database,
    summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
    "Candle gap audit finished",
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
    const summary = await auditCandleGaps();
    if (summary.status === BotRunStatus.FAILED) {
      process.exitCode = 1;
      logger.error({ summary }, "auditCandleGaps completed with provider failures");
    } else {
      logger.info({ summary }, "auditCandleGaps completed");
    }
  } finally {
    await prisma.$disconnect();
  }
}
