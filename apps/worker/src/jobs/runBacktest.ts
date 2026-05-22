import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateBacktestSignals,
  generateBacktestSignals,
  summarizeBacktestRun,
  type BacktestAsset,
  type BacktestAssetType,
  type BacktestCandle,
  type BacktestConfig
} from "@signalpilot/backtesting";
import {
  AssetType,
  BacktestOutcome,
  BacktestOutcomeStatus,
  BacktestRunStatus,
  BotRunStatus,
  Prisma,
  prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export type RunBacktestOptions = Partial<BacktestConfig> & {
  name?: string;
};

export type RunBacktestSummary = {
  runId: string;
  status: BacktestRunStatus;
  totalSignals: number;
  evaluatedCount: number;
  winRate: number;
  warnings: string[];
};

export async function runBacktest(
  database: PrismaClient = prisma,
  options: RunBacktestOptions = {}
): Promise<RunBacktestSummary> {
  const config = buildConfig(options);
  const botRun = await database.botRun.create({
    data: {
      jobName: "runBacktest",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: config as unknown as Prisma.InputJsonObject
    }
  });
  const run = await database.backtestRun.create({
    data: {
      name: options.name ?? `Backtest ${new Date().toISOString()}`,
      assetType: config.assetType,
      symbols: config.symbols as Prisma.InputJsonArray,
      timeframes: config.timeframes as Prisma.InputJsonArray,
      from: config.from,
      to: config.to,
      status: BacktestRunStatus.RUNNING,
      configJson: serializeConfig(config) as Prisma.InputJsonObject
    }
  });

  await writeBotLog(database, "info", "runBacktest started", { botRunId: botRun.id, runId: run.id });

  try {
    const assets = await loadAssets(database, config);
    const candles = await loadCandles(database, assets, config);
    const warnings = buildCoverageWarnings(assets, candles, config);
    const generatedSignals = generateBacktestSignals({ assets, candles, config });
    const evaluatedSignals = evaluateBacktestSignals({ signals: generatedSignals, candles, to: config.to });
    const summary = summarizeBacktestRun({ signals: evaluatedSignals, warnings });

    if (evaluatedSignals.length > 0) {
      await database.backtestSignal.createMany({
        data: evaluatedSignals.map((signal) => ({
          backtestRunId: run.id,
          assetId: signal.assetId,
          symbol: signal.symbol,
          assetType: signal.assetType,
          timeframe: signal.timeframe,
          signalTime: signal.signalTime,
          signalType: signal.signalType as SignalType,
          status: signal.status as SignalStatus,
          direction: signal.direction as SignalDirection,
          riskLevel: signal.riskLevel as RiskLevel,
          score: signal.score,
          originalScore: signal.originalScore,
          adjustedScore: signal.adjustedScore,
          entryPrice: decimal(signal.entryPrice),
          targetPrice: signal.targetPrice === undefined ? undefined : decimal(signal.targetPrice),
          invalidationPrice: signal.invalidationPrice === undefined ? undefined : decimal(signal.invalidationPrice),
          outcome: signal.outcome as BacktestOutcome | null,
          outcomeStatus: signal.outcomeStatus as BacktestOutcomeStatus,
          evaluatedAt: signal.evaluatedAt,
          returnAfter1h: signal.returnAfter1h,
          returnAfter4h: signal.returnAfter4h,
          returnAfter1d: signal.returnAfter1d,
          returnAfter3d: signal.returnAfter3d,
          maxFavorableMove: signal.maxFavorableMove,
          maxAdverseMove: signal.maxAdverseMove,
          contextJson: signal.context as unknown as Prisma.InputJsonObject
        }))
      });
    }

    await database.backtestRun.update({
      where: { id: run.id },
      data: {
        status: BacktestRunStatus.SUCCESS,
        summaryJson: summary as unknown as Prisma.InputJsonObject,
        finishedAt: new Date()
      }
    });
    const result = {
      runId: run.id,
      status: BacktestRunStatus.SUCCESS,
      totalSignals: summary.totalSignals,
      evaluatedCount: summary.evaluatedCount,
      winRate: summary.winRate,
      warnings
    };
    await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, result);
    await writeBotLog(database, "info", "runBacktest finished", { botRunId: botRun.id, ...result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backtest error";
    await database.backtestRun.update({
      where: { id: run.id },
      data: {
        status: BacktestRunStatus.FAILED,
        summaryJson: { error: message },
        finishedAt: new Date()
      }
    });
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { runId: run.id, error: message });
    await writeBotLog(database, "error", "runBacktest failed", { botRunId: botRun.id, runId: run.id, error: message });
    throw error;
  }
}

function buildConfig(options: RunBacktestOptions): BacktestConfig {
  const assetType = options.assetType ?? parseAssetType(process.env.BACKTEST_ASSET_TYPE) ?? AssetType.CRYPTO;
  const symbols = options.symbols ?? parseList(process.env.BACKTEST_SYMBOLS) ?? ["BTCUSDT", "ETHUSDT"];
  const timeframes = options.timeframes ?? parseList(process.env.BACKTEST_TIMEFRAMES) ?? defaultTimeframes(assetType);
  const to = options.to ?? parseDate(process.env.BACKTEST_TO) ?? new Date();
  const from = options.from ?? parseDate(process.env.BACKTEST_FROM) ?? new Date(to.getTime() - 180 * 24 * 60 * 60 * 1000);

  return {
    symbols: symbols.map((symbol) => symbol.toUpperCase()),
    assetType,
    timeframes,
    from,
    to,
    minCandlesBeforeSignal: options.minCandlesBeforeSignal ?? 220,
    minScoreToRecord: options.minScoreToRecord ?? parseNumber(process.env.BACKTEST_MIN_SCORE_TO_RECORD, 50),
    useSignalRules: options.useSignalRules ?? parseBoolean(process.env.BACKTEST_USE_SIGNAL_RULES, true),
    maxSignalsPerAssetTimeframe:
      options.maxSignalsPerAssetTimeframe ?? parseNumber(process.env.BACKTEST_MAX_SIGNALS_PER_ASSET_TIMEFRAME, 500),
    includeNoEdge: options.includeNoEdge ?? false
  };
}

async function loadAssets(database: PrismaClient, config: BacktestConfig): Promise<BacktestAsset[]> {
  const assets = await database.asset.findMany({
    where: {
      isActive: true,
      assetType: config.assetType,
      symbol: config.symbols && config.symbols.length > 0 ? { in: config.symbols } : undefined
    },
    select: { id: true, symbol: true, assetType: true },
    orderBy: { symbol: "asc" }
  });
  return assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, assetType: asset.assetType as BacktestAssetType }));
}

async function loadCandles(database: PrismaClient, assets: BacktestAsset[], config: BacktestConfig): Promise<BacktestCandle[]> {
  if (assets.length === 0) return [];
  const warmupFrom = new Date(config.from.getTime() - warmupMs(config));
  const candles = await database.candle.findMany({
    where: {
      assetId: { in: assets.map((asset) => asset.id) },
      timeframe: { in: config.timeframes },
      closeTime: { gte: warmupFrom, lte: config.to }
    },
    orderBy: [{ assetId: "asc" }, { timeframe: "asc" }, { closeTime: "asc" }]
  });
  return candles.map((candle) => ({
    assetId: candle.assetId,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open.toString(),
    high: candle.high.toString(),
    low: candle.low.toString(),
    close: candle.close.toString(),
    volume: candle.volume.toString()
  }));
}

function buildCoverageWarnings(assets: BacktestAsset[], candles: BacktestCandle[], config: BacktestConfig) {
  const warnings: string[] = [];
  if (assets.length === 0) warnings.push("Keine passenden Assets fuer Backtest-Konfiguration gefunden.");

  for (const asset of assets) {
    for (const timeframe of config.timeframes) {
      const count = candles.filter((candle) => candle.assetId === asset.id && candle.timeframe === timeframe).length;
      if (count < (config.minCandlesBeforeSignal ?? 220)) {
        warnings.push(`${asset.symbol} ${timeframe} hat weniger historische Candles als Warmup benoetigt.`);
      }
    }
  }

  return warnings;
}

function serializeConfig(config: BacktestConfig) {
  return {
    ...config,
    from: config.from.toISOString(),
    to: config.to.toISOString()
  };
}

function defaultTimeframes(assetType: AssetType) {
  return assetType === AssetType.CRYPTO ? ["1h", "4h", "1d"] : ["1h", "1d"];
}

function warmupMs(config: BacktestConfig) {
  const maxHours = Math.max(...config.timeframes.map(timeframeHours), 24);
  return maxHours * (config.minCandlesBeforeSignal ?? 220) * 60 * 60 * 1000;
}

function timeframeHours(timeframe: string) {
  if (timeframe.endsWith("h")) return Number(timeframe.slice(0, -1)) || 1;
  if (timeframe.endsWith("d")) return (Number(timeframe.slice(0, -1)) || 1) * 24;
  return 24;
}

function parseList(value: string | undefined) {
  if (!value) return undefined;
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseAssetType(value: string | undefined) {
  if (value === AssetType.CRYPTO || value === AssetType.STOCK || value === AssetType.ETF) return value;
  return undefined;
}

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function decimal(value: number) {
  return value.toFixed(12);
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
  runBacktest()
    .then((summary) => {
      logger.info(summary, "runBacktest completed");
    })
    .catch((error) => {
      logger.error({ error }, "runBacktest failed");
      process.exitCode = 1;
    });
}
