import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDefaultStrategyConfigs,
  rankStrategyResults,
  summarizeStrategyComparison,
  type StrategyRuleConfig
} from "@signalpilot/strategy-lab";
import {
  AssetType,
  BotRunStatus,
  Prisma,
  prisma,
  StrategyComparisonStatus,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { runBacktest } from "./runBacktest.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export type RunStrategyComparisonOptions = {
  name?: string;
  symbols?: string[];
  assetType?: AssetType;
  timeframes?: string[];
  from?: Date;
  to?: Date;
  strategyConfigNames?: string[];
  strategyConfigIds?: string[];
  maxSignalsPerAssetTimeframe?: number;
};

export async function runStrategyComparison(
  database: PrismaClient = prisma,
  options: RunStrategyComparisonOptions = {}
) {
  const configInput = buildComparisonConfig(options);
  const botRun = await database.botRun.create({
    data: {
      jobName: "runStrategyComparison",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: serializeConfig(configInput) as Prisma.InputJsonObject
    }
  });
  const comparisonRun = await database.strategyComparisonRun.create({
    data: {
      name: options.name ?? `Strategy Comparison ${new Date().toISOString()}`,
      status: StrategyComparisonStatus.RUNNING,
      from: configInput.from,
      to: configInput.to,
      symbols: configInput.symbols as Prisma.InputJsonArray,
      assetType: configInput.assetType,
      timeframes: configInput.timeframes as Prisma.InputJsonArray,
      configJson: serializeConfig(configInput) as Prisma.InputJsonObject
    }
  });

  await writeBotLog(database, "info", "runStrategyComparison started", {
    botRunId: botRun.id,
    comparisonRunId: comparisonRun.id
  });

  try {
    await ensureDefaultStrategyConfigs(database);
    const strategies = await loadStrategies(database, configInput);
    const resultInputs = [];

    for (const strategy of strategies) {
      const strategyConfig = parseStrategyConfig(strategy.configJson);
      const backtest = await runBacktest(database, {
        name: `${comparisonRun.name} - ${strategy.name}`,
        symbols: configInput.symbols,
        assetType: configInput.assetType,
        timeframes: configInput.timeframes,
        from: configInput.from,
        to: configInput.to,
        minScoreToRecord: strategyConfig.minScoreToRecord,
        maxSignalsPerAssetTimeframe: strategyConfig.maxSignalsPerAssetTimeframe ?? configInput.maxSignalsPerAssetTimeframe,
        useSignalRules: strategyConfig.useSignalRules ?? true,
        strategyConfig
      });
      const backtestRun = await database.backtestRun.findUnique({ where: { id: backtest.runId } });
      const summary = parseSummary(backtestRun?.summaryJson);
      const result = await database.strategyBacktestResult.create({
        data: {
          comparisonRunId: comparisonRun.id,
          strategyConfigId: strategy.id,
          backtestRunId: backtest.runId,
          totalSignals: summary.totalSignals,
          evaluatedCount: summary.evaluatedCount,
          winRate: summary.winRate,
          avgReturnAfter1d: summary.avgReturnAfter1d,
          targetReachedCount: summary.targetReachedCount,
          invalidatedCount: summary.invalidatedCount,
          positiveCount: summary.positiveCount,
          negativeCount: summary.negativeCount,
          neutralCount: summary.neutralCount,
          summaryJson: summary as unknown as Prisma.InputJsonObject
        }
      });
      resultInputs.push({
        id: result.id,
        strategyConfigId: strategy.id,
        strategyName: strategy.name,
        totalSignals: summary.totalSignals,
        evaluatedCount: summary.evaluatedCount,
        winRate: summary.winRate,
        avgReturnAfter1d: summary.avgReturnAfter1d,
        summaryJson: summary
      });
    }

    const ranked = rankStrategyResults(resultInputs);
    await Promise.all(
      ranked.map((result) =>
        database.strategyBacktestResult.update({
          where: { id: result.id },
          data: {
            rank: result.rank,
            summaryJson: {
              ...result.summaryJson,
              warnings: result.warnings,
              rankingScore: result.rankingScore
            } as Prisma.InputJsonObject
          }
        })
      )
    );

    const summary = summarizeStrategyComparison(resultInputs);
    await database.strategyComparisonRun.update({
      where: { id: comparisonRun.id },
      data: {
        status: StrategyComparisonStatus.SUCCESS,
        summaryJson: summary as unknown as Prisma.InputJsonObject,
        finishedAt: new Date()
      }
    });
    const finalSummary = {
      comparisonRunId: comparisonRun.id,
      status: StrategyComparisonStatus.SUCCESS,
      totalStrategies: strategies.length,
      bestStrategy: summary.bestStrategy,
      bestWinRate: summary.bestWinRate
    };
    await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, finalSummary);
    await writeBotLog(database, "info", "runStrategyComparison finished", { botRunId: botRun.id, ...finalSummary });
    return finalSummary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown strategy comparison error";
    await database.strategyComparisonRun.update({
      where: { id: comparisonRun.id },
      data: { status: StrategyComparisonStatus.FAILED, summaryJson: { error: message }, finishedAt: new Date() }
    });
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { comparisonRunId: comparisonRun.id, error: message });
    await writeBotLog(database, "error", "runStrategyComparison failed", {
      botRunId: botRun.id,
      comparisonRunId: comparisonRun.id,
      error: message
    });
    throw error;
  }
}

async function ensureDefaultStrategyConfigs(database: PrismaClient) {
  for (const definition of buildDefaultStrategyConfigs()) {
    const existing = await database.strategyConfig.findFirst({ where: { name: definition.name } });
    const data = {
      name: definition.name,
      description: definition.description,
      isDefault: definition.isDefault,
      configJson: definition.configJson as unknown as Prisma.InputJsonObject
    };

    if (existing) {
      await database.strategyConfig.update({ where: { id: existing.id }, data });
    } else {
      await database.strategyConfig.create({ data });
    }
  }
}

async function loadStrategies(database: PrismaClient, configInput: ReturnType<typeof buildComparisonConfig>) {
  const where =
    configInput.strategyConfigIds.length > 0
      ? { id: { in: configInput.strategyConfigIds } }
      : configInput.strategyConfigNames.length > 0
        ? { name: { in: configInput.strategyConfigNames } }
        : { isDefault: true };
  return database.strategyConfig.findMany({ where, orderBy: { name: "asc" } });
}

function buildComparisonConfig(options: RunStrategyComparisonOptions) {
  const assetType = options.assetType ?? parseAssetType(process.env.STRATEGY_ASSET_TYPE) ?? AssetType.CRYPTO;
  const to = options.to ?? parseDate(process.env.STRATEGY_TO) ?? new Date();
  return {
    symbols: options.symbols ?? parseList(process.env.STRATEGY_SYMBOLS) ?? ["BTCUSDT", "ETHUSDT"],
    assetType,
    timeframes: options.timeframes ?? parseList(process.env.STRATEGY_TIMEFRAMES) ?? (assetType === AssetType.CRYPTO ? ["1h", "4h", "1d"] : ["1h", "1d"]),
    from: options.from ?? parseDate(process.env.STRATEGY_FROM) ?? new Date(to.getTime() - 180 * 24 * 60 * 60 * 1000),
    to,
    maxSignalsPerAssetTimeframe:
      options.maxSignalsPerAssetTimeframe ?? parseNumber(process.env.STRATEGY_MAX_SIGNALS_PER_ASSET_TIMEFRAME, 300),
    strategyConfigNames: options.strategyConfigNames ?? parseList(process.env.STRATEGY_CONFIGS) ?? [],
    strategyConfigIds: options.strategyConfigIds ?? []
  };
}

function parseStrategyConfig(value: unknown): StrategyRuleConfig {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StrategyRuleConfig : {};
}

function parseSummary(value: unknown) {
  const record = parseSummaryObject(value);
  return {
    totalSignals: numberValue(record.totalSignals),
    evaluatedCount: numberValue(record.evaluatedCount),
    winRate: numberValue(record.winRate),
    avgReturnAfter1d: numberValue(record.avgReturnAfter1d),
    targetReachedCount: numberValue(record.targetReachedCount),
    invalidatedCount: numberValue(record.invalidatedCount),
    positiveCount: numberValue(record.positiveCount),
    negativeCount: numberValue(record.negativeCount),
    neutralCount: numberValue(record.neutralCount),
    ...record
  };
}

function parseSummaryObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function serializeConfig(configInput: ReturnType<typeof buildComparisonConfig>) {
  return { ...configInput, from: configInput.from.toISOString(), to: configInput.to.toISOString() };
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function finishBotRun(database: PrismaClient, botRunId: string, status: BotRunStatus, metadataJson: Record<string, unknown>) {
  await database.botRun.update({
    where: { id: botRunId },
    data: { status, finishedAt: new Date(), metadataJson: metadataJson as Prisma.InputJsonObject }
  });
}

async function writeBotLog(database: PrismaClient, level: "info" | "warn" | "error", message: string, metadataJson: Record<string, unknown>) {
  await database.botLog.create({ data: { level, service: "worker", message, metadataJson: metadataJson as Prisma.InputJsonObject } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runStrategyComparison()
    .then((summary) => logger.info(summary, "runStrategyComparison completed"))
    .catch((error) => {
      logger.error({ error }, "runStrategyComparison failed");
      process.exitCode = 1;
    });
}
