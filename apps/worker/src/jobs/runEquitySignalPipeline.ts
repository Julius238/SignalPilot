import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { analyzeEquitySignals, type AnalyzeEquitySignalsSummary } from "./analyzeEquitySignals.js";
import { calculateMarketRegime, type CalculateMarketRegimeSummary } from "./calculateMarketRegime.js";
import { fetchEquityCandles, type FetchEquityCandlesSummary } from "./fetchEquityCandles.js";
import { fetchEquityEvents, type FetchEquityEventsSummary } from "./fetchEquityEvents.js";
import { fetchEquityNews, type FetchEquityNewsSummary } from "./fetchEquityNews.js";
import {
  createPaperEvaluationsForSignals,
  evaluatePaperSignals,
  type CreatePaperEvaluationsSummary,
  type EvaluatePaperSignalsSummary
} from "./paperSignalEvaluations.js";

const logger = pino({ name: "signalpilot-worker" });

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

export type EquitySignalPipelineSummary = {
  status: BotRunStatus;
  startedAt: string;
  finishedAt: string;
  fetchEquityCandles?: FetchEquityCandlesSummary;
  fetchEquityNews?: FetchEquityNewsSummary;
  fetchEquityEvents?: FetchEquityEventsSummary;
  calculateMarketRegime?: CalculateMarketRegimeSummary;
  analyzeEquitySignals?: AnalyzeEquitySignalsSummary;
  createPaperEvaluationsForSignals?: CreatePaperEvaluationsSummary;
  evaluatePaperSignals?: EvaluatePaperSignalsSummary;
  paperEvaluationEnabled: boolean;
  equityNewsEnabled: boolean;
  equityEventsEnabled: boolean;
  marketRegimeEnabled: boolean;
  error?: string;
};

type PipelineJobs = {
  fetchEquityCandles: (database: PrismaClient) => Promise<FetchEquityCandlesSummary>;
  fetchEquityNews: (database: PrismaClient) => Promise<FetchEquityNewsSummary>;
  fetchEquityEvents: (database: PrismaClient) => Promise<FetchEquityEventsSummary>;
  calculateMarketRegime?: (database: PrismaClient) => Promise<CalculateMarketRegimeSummary>;
  analyzeEquitySignals: (database: PrismaClient) => Promise<AnalyzeEquitySignalsSummary>;
  createPaperEvaluationsForSignals: (database: PrismaClient) => Promise<CreatePaperEvaluationsSummary>;
  evaluatePaperSignals: (database: PrismaClient) => Promise<EvaluatePaperSignalsSummary>;
};

const defaultJobs: PipelineJobs = {
  fetchEquityCandles,
  fetchEquityNews,
  fetchEquityEvents,
  calculateMarketRegime,
  analyzeEquitySignals,
  createPaperEvaluationsForSignals,
  evaluatePaperSignals
};

export async function runEquitySignalPipeline(
  database: PrismaClient = prisma,
  jobs: PipelineJobs = defaultJobs
): Promise<EquitySignalPipelineSummary> {
  const startedAt = new Date();
  const paperEvaluationEnabled = parseBooleanEnv(process.env.ENABLE_PAPER_EVALUATION, true);
  const equityNewsEnabled = parseBooleanEnv(process.env.ENABLE_EQUITY_NEWS, true);
  const equityEventsEnabled = parseBooleanEnv(process.env.ENABLE_EQUITY_EVENTS, true);
  const marketRegimeEnabled = parseBooleanEnv(process.env.ENABLE_MARKET_REGIME, true);
  let fetchSummary: FetchEquityCandlesSummary | undefined;
  let fetchNewsSummary: FetchEquityNewsSummary | undefined;
  let fetchEventsSummary: FetchEquityEventsSummary | undefined;
  let marketRegimeSummary: CalculateMarketRegimeSummary | undefined;
  let analyzeSummary: AnalyzeEquitySignalsSummary | undefined;
  let createPaperEvaluationsSummary: CreatePaperEvaluationsSummary | undefined;
  let evaluatePaperSignalsSummary: EvaluatePaperSignalsSummary | undefined;

  const botRun = await database.botRun.create({
    data: {
      jobName: "runEquitySignalPipeline",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        startedAt: startedAt.toISOString(),
        status: BotRunStatus.RUNNING,
        paperEvaluationEnabled,
        equityNewsEnabled,
        equityEventsEnabled,
        marketRegimeEnabled
      }
    }
  });

  await writeBotLog(database, "info", "Equity Pipeline gestartet", {
    botRunId: botRun.id,
    startedAt: startedAt.toISOString()
  });

  try {
    await writeBotLog(database, "info", "Equity Candle Fetch gestartet", { botRunId: botRun.id });
    fetchSummary = await jobs.fetchEquityCandles(database);
    await writeBotLog(database, "info", "Equity Candle Fetch beendet", {
      botRunId: botRun.id,
      fetchEquityCandles: fetchSummary
    });

    if (equityNewsEnabled) {
      await writeBotLog(database, "info", "Equity News Fetch gestartet", { botRunId: botRun.id });
      fetchNewsSummary = await jobs.fetchEquityNews(database);
      await writeBotLog(database, "info", "Equity News Fetch beendet", {
        botRunId: botRun.id,
        fetchEquityNews: fetchNewsSummary
      });
    }

    if (equityEventsEnabled) {
      await writeBotLog(database, "info", "Equity Events Fetch gestartet", { botRunId: botRun.id });
      fetchEventsSummary = await jobs.fetchEquityEvents(database);
      await writeBotLog(database, "info", "Equity Events Fetch beendet", {
        botRunId: botRun.id,
        fetchEquityEvents: fetchEventsSummary
      });
    }

    if (marketRegimeEnabled && jobs.calculateMarketRegime) {
      await writeBotLog(database, "info", "Market Regime Berechnung gestartet", { botRunId: botRun.id });
      marketRegimeSummary = await jobs.calculateMarketRegime(database);
      await writeBotLog(database, "info", "Market Regime Berechnung beendet", {
        botRunId: botRun.id,
        calculateMarketRegime: marketRegimeSummary
      });
    }

    await writeBotLog(database, "info", "Equity Signal Analyse gestartet", { botRunId: botRun.id });
    analyzeSummary = await jobs.analyzeEquitySignals(database);
    await writeBotLog(database, "info", "Equity Signal Analyse beendet", {
      botRunId: botRun.id,
      analyzeEquitySignals: analyzeSummary
    });

    if (paperEvaluationEnabled) {
      await writeBotLog(database, "info", "Paper Evaluation creation started", { botRunId: botRun.id });
      createPaperEvaluationsSummary = await jobs.createPaperEvaluationsForSignals(database);
      await writeBotLog(database, "info", "Paper Evaluation creation finished", {
        botRunId: botRun.id,
        createPaperEvaluationsForSignals: createPaperEvaluationsSummary
      });

      await writeBotLog(database, "info", "Paper Evaluation scoring started", { botRunId: botRun.id });
      evaluatePaperSignalsSummary = await jobs.evaluatePaperSignals(database);
      await writeBotLog(database, "info", "Paper Evaluation scoring finished", {
        botRunId: botRun.id,
        evaluatePaperSignals: evaluatePaperSignalsSummary
      });
    }

    const finishedAt = new Date();
    const summary = buildPipelineSummary({
      status: BotRunStatus.SUCCESS,
      startedAt,
      finishedAt,
      paperEvaluationEnabled,
      equityNewsEnabled,
      equityEventsEnabled,
      marketRegimeEnabled,
      fetchSummary,
      fetchNewsSummary,
      fetchEventsSummary,
      marketRegimeSummary,
      analyzeSummary,
      createPaperEvaluationsSummary,
      evaluatePaperSignalsSummary
    });

    await database.botRun.update({
      where: { id: botRun.id },
      data: { status: BotRunStatus.SUCCESS, finishedAt, metadataJson: summary as Prisma.InputJsonObject }
    });

    await writeBotLog(database, "info", "Equity Pipeline erfolgreich beendet", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : "Unknown pipeline error";
    const summary = buildPipelineSummary({
      status: BotRunStatus.FAILED,
      startedAt,
      finishedAt,
      paperEvaluationEnabled,
      equityNewsEnabled,
      equityEventsEnabled,
      marketRegimeEnabled,
      fetchSummary,
      fetchNewsSummary,
      fetchEventsSummary,
      marketRegimeSummary,
      analyzeSummary,
      createPaperEvaluationsSummary,
      evaluatePaperSignalsSummary,
      error: message
    });

    await database.botRun.update({
      where: { id: botRun.id },
      data: { status: BotRunStatus.FAILED, finishedAt, metadataJson: summary as Prisma.InputJsonObject }
    });

    await writeBotLog(database, "error", "Equity Pipeline Fehler", {
      botRunId: botRun.id,
      ...summary
    });

    throw error;
  }
}

function buildPipelineSummary(input: {
  status: BotRunStatus;
  startedAt: Date;
  finishedAt: Date;
  paperEvaluationEnabled: boolean;
  equityNewsEnabled: boolean;
  equityEventsEnabled: boolean;
  marketRegimeEnabled: boolean;
  fetchSummary?: FetchEquityCandlesSummary;
  fetchNewsSummary?: FetchEquityNewsSummary;
  fetchEventsSummary?: FetchEquityEventsSummary;
  marketRegimeSummary?: CalculateMarketRegimeSummary;
  analyzeSummary?: AnalyzeEquitySignalsSummary;
  createPaperEvaluationsSummary?: CreatePaperEvaluationsSummary;
  evaluatePaperSignalsSummary?: EvaluatePaperSignalsSummary;
  error?: string;
}): EquitySignalPipelineSummary {
  const summary: EquitySignalPipelineSummary = {
    status: input.status,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    paperEvaluationEnabled: input.paperEvaluationEnabled,
    equityNewsEnabled: input.equityNewsEnabled,
    equityEventsEnabled: input.equityEventsEnabled,
    marketRegimeEnabled: input.marketRegimeEnabled
  };

  if (input.fetchSummary) summary.fetchEquityCandles = input.fetchSummary;
  if (input.fetchNewsSummary) summary.fetchEquityNews = input.fetchNewsSummary;
  if (input.fetchEventsSummary) summary.fetchEquityEvents = input.fetchEventsSummary;
  if (input.marketRegimeSummary) summary.calculateMarketRegime = input.marketRegimeSummary;
  if (input.analyzeSummary) summary.analyzeEquitySignals = input.analyzeSummary;
  if (input.createPaperEvaluationsSummary) summary.createPaperEvaluationsForSignals = input.createPaperEvaluationsSummary;
  if (input.evaluatePaperSignalsSummary) summary.evaluatePaperSignals = input.evaluatePaperSignalsSummary;
  if (input.error) summary.error = input.error;

  return summary;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runEquitySignalPipeline();
    logger.info("runEquitySignalPipeline completed");
  } finally {
    await prisma.$disconnect();
  }
}
