import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { calculateMarketRegimeReport, type MarketRegimeReport } from "@signalpilot/market-regime";
import { AssetType, BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const benchmarkSymbols = ["SPY", "QQQ", "IWM", "BTCUSDT", "ETHUSDT"] as const;
const candleLimit = 220;
const defaultMaxAgeMinutes = 60;

export type CalculateMarketRegimeSummary = {
  status: BotRunStatus;
  snapshotId: string | null;
  reusedSnapshot: boolean;
  benchmarkCount: number;
  missingBenchmarkCount: number;
  equityRegime: string;
  cryptoRegime: string;
  overallRegime: string;
  riskMode: string;
  confidence: number;
};

export async function calculateMarketRegime(
  database: PrismaClient = prisma,
  options: { force?: boolean } = {}
): Promise<CalculateMarketRegimeSummary> {
  const maxAgeMinutes = parsePositiveNumberEnv(process.env.MARKET_REGIME_MAX_AGE_MINUTES, defaultMaxAgeMinutes);
  const botRun = await database.botRun.create({
    data: {
      jobName: "calculateMarketRegime",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { benchmarkSymbols: [...benchmarkSymbols], candleLimit, maxAgeMinutes }
    }
  });

  await writeBotLog(database, "info", "calculateMarketRegime started", {
    botRunId: botRun.id,
    benchmarkSymbols: [...benchmarkSymbols]
  });

  try {
    if (!options.force) {
      const reusable = await loadReusableSnapshot(database, maxAgeMinutes);
      if (reusable) {
        const report = reusable.reportJson as MarketRegimeReport;
        const summary = toSummary(BotRunStatus.SUCCESS, reusable.id, true, report);
        await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, summary);
        await writeBotLog(database, "info", "calculateMarketRegime reused latest snapshot", {
          botRunId: botRun.id,
          ...summary
        });
        return summary;
      }
    }

    const assets = await database.asset.findMany({
      where: { symbol: { in: [...benchmarkSymbols] }, isActive: true },
      select: { id: true, symbol: true, assetType: true }
    });
    const benchmarks = [];
    const missingSymbols = new Set<string>(benchmarkSymbols);

    for (const asset of assets) {
      missingSymbols.delete(asset.symbol);
      const candles = await database.candle.findMany({
        where: { assetId: asset.id, timeframe: "1d" },
        orderBy: { openTime: "desc" },
        take: candleLimit
      });

      if (candles.length === 0) {
        missingSymbols.add(asset.symbol);
      }

      benchmarks.push({
        symbol: asset.symbol,
        assetType: mapAssetType(asset.assetType),
        timeframe: "1d",
        candles: candles.reverse().map((candle) => ({
          close: candle.close.toString(),
          high: candle.high.toString(),
          low: candle.low.toString()
        }))
      });
    }

    const report = calculateMarketRegimeReport({ benchmarks });
    const snapshot = await database.marketRegimeSnapshot.create({
      data: {
        generatedAt: new Date(report.generatedAt),
        equityRegime: report.equityRegime,
        cryptoRegime: report.cryptoRegime,
        overallRegime: report.overallRegime,
        riskMode: report.riskMode,
        confidence: report.confidence,
        summary: report.summary,
        riskNote: report.riskNote,
        reportJson: report as unknown as Prisma.InputJsonObject
      }
    });
    const summary = toSummary(BotRunStatus.SUCCESS, snapshot.id, false, report, missingSymbols.size);

    await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, summary);
    await writeBotLog(database, "info", "calculateMarketRegime finished", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown market regime error";
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, {
      status: BotRunStatus.FAILED,
      snapshotId: null,
      reusedSnapshot: false,
      benchmarkCount: 0,
      missingBenchmarkCount: benchmarkSymbols.length,
      equityRegime: "UNKNOWN",
      cryptoRegime: "UNKNOWN",
      overallRegime: "UNKNOWN",
      riskMode: "UNKNOWN",
      confidence: 0,
      error: message
    });
    await writeBotLog(database, "error", "calculateMarketRegime failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

async function loadReusableSnapshot(database: PrismaClient, maxAgeMinutes: number) {
  const minGeneratedAt = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  return database.marketRegimeSnapshot.findFirst({
    where: { generatedAt: { gte: minGeneratedAt } },
    orderBy: { generatedAt: "desc" }
  });
}

function toSummary(
  status: BotRunStatus,
  snapshotId: string | null,
  reusedSnapshot: boolean,
  report: MarketRegimeReport,
  missingBenchmarkCount?: number
): CalculateMarketRegimeSummary {
  return {
    status,
    snapshotId,
    reusedSnapshot,
    benchmarkCount: report.benchmarkSummaries.length,
    missingBenchmarkCount:
      missingBenchmarkCount ?? benchmarkSymbols.length - report.benchmarkSummaries.filter((summary) => summary.priceVsSma50 !== null).length,
    equityRegime: report.equityRegime,
    cryptoRegime: report.cryptoRegime,
    overallRegime: report.overallRegime,
    riskMode: report.riskMode,
    confidence: report.confidence
  };
}

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  status: BotRunStatus,
  metadataJson: Record<string, unknown>
) {
  await database.botRun.update({
    where: { id: botRunId },
    data: { status, finishedAt: new Date(), metadataJson: metadataJson as Prisma.InputJsonObject }
  });
}

function mapAssetType(assetType: AssetType) {
  if (assetType === AssetType.CRYPTO) return "crypto";
  if (assetType === AssetType.ETF) return "etf";
  return "stock";
}

function parsePositiveNumberEnv(value: string | undefined, defaultValue: number) {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

async function writeBotLog(
  database: PrismaClient,
  level: "info" | "warn" | "error",
  message: string,
  metadataJson: Record<string, unknown>
) {
  await database.botLog.create({
    data: {
      level,
      service: "worker",
      message,
      metadataJson: metadataJson as Prisma.InputJsonObject
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  calculateMarketRegime()
    .then((summary) => {
      logger.info(summary, "calculateMarketRegime completed");
    })
    .catch((error) => {
      logger.error({ error }, "calculateMarketRegime failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
