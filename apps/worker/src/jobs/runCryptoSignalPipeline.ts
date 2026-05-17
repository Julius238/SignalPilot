import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { analyzeCryptoSignals, type AnalyzeCryptoSignalsSummary } from "./analyzeCryptoSignals.js";
import { fetchCryptoCandles, type FetchCryptoCandlesSummary } from "./fetchCryptoCandles.js";
import {
  createPaperEvaluationsForSignals,
  evaluatePaperSignals,
  type CreatePaperEvaluationsSummary,
  type EvaluatePaperSignalsSummary
} from "./paperSignalEvaluations.js";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export type CryptoSignalPipelineSummary = {
  status: BotRunStatus;
  startedAt: string;
  finishedAt: string;
  fetchCryptoCandles?: FetchCryptoCandlesSummary;
  analyzeCryptoSignals?: AnalyzeCryptoSignalsSummary;
  createPaperEvaluationsForSignals?: CreatePaperEvaluationsSummary;
  evaluatePaperSignals?: EvaluatePaperSignalsSummary;
  paperEvaluationEnabled: boolean;
  error?: string;
};

type PipelineJobs = {
  fetchCryptoCandles: (database: PrismaClient) => Promise<FetchCryptoCandlesSummary>;
  analyzeCryptoSignals: (database: PrismaClient) => Promise<AnalyzeCryptoSignalsSummary>;
  createPaperEvaluationsForSignals: (database: PrismaClient) => Promise<CreatePaperEvaluationsSummary>;
  evaluatePaperSignals: (database: PrismaClient) => Promise<EvaluatePaperSignalsSummary>;
};

const defaultJobs: PipelineJobs = {
  fetchCryptoCandles,
  analyzeCryptoSignals,
  createPaperEvaluationsForSignals,
  evaluatePaperSignals
};

export async function runCryptoSignalPipeline(
  database: PrismaClient = prisma,
  jobs: PipelineJobs = defaultJobs
): Promise<CryptoSignalPipelineSummary> {
  const startedAt = new Date();
  const paperEvaluationEnabled = parseBooleanEnv(process.env.ENABLE_PAPER_EVALUATION, true);
  let fetchSummary: FetchCryptoCandlesSummary | undefined;
  let analyzeSummary: AnalyzeCryptoSignalsSummary | undefined;
  let createPaperEvaluationsSummary: CreatePaperEvaluationsSummary | undefined;
  let evaluatePaperSignalsSummary: EvaluatePaperSignalsSummary | undefined;

  const botRun = await database.botRun.create({
    data: {
      jobName: "runCryptoSignalPipeline",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        startedAt: startedAt.toISOString(),
        status: BotRunStatus.RUNNING,
        paperEvaluationEnabled
      }
    }
  });

  await writeBotLog(database, "info", "Pipeline gestartet", {
    botRunId: botRun.id,
    startedAt: startedAt.toISOString()
  });

  try {
    await writeBotLog(database, "info", "Candle Fetch gestartet", {
      botRunId: botRun.id
    });
    fetchSummary = await jobs.fetchCryptoCandles(database);
    await writeBotLog(database, "info", "Candle Fetch beendet", {
      botRunId: botRun.id,
      fetchCryptoCandles: fetchSummary
    });

    await writeBotLog(database, "info", "Signal Analyse gestartet", {
      botRunId: botRun.id
    });
    analyzeSummary = await jobs.analyzeCryptoSignals(database);
    await writeBotLog(database, "info", "Signal Analyse beendet", {
      botRunId: botRun.id,
      analyzeCryptoSignals: analyzeSummary
    });

    if (paperEvaluationEnabled) {
      await writeBotLog(database, "info", "Paper Evaluation creation started", {
        botRunId: botRun.id
      });
      createPaperEvaluationsSummary = await jobs.createPaperEvaluationsForSignals(database);
      await writeBotLog(database, "info", "Paper Evaluation creation finished", {
        botRunId: botRun.id,
        createPaperEvaluationsForSignals: createPaperEvaluationsSummary
      });

      await writeBotLog(database, "info", "Paper Evaluation scoring started", {
        botRunId: botRun.id
      });
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
      fetchSummary,
      analyzeSummary,
      createPaperEvaluationsSummary,
      evaluatePaperSignalsSummary
    });

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status: BotRunStatus.SUCCESS,
        finishedAt,
        metadataJson: summary as Prisma.InputJsonObject
      }
    });

    await writeBotLog(database, "info", "Pipeline erfolgreich beendet", {
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
      fetchSummary,
      analyzeSummary,
      createPaperEvaluationsSummary,
      evaluatePaperSignalsSummary,
      error: message
    });

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt,
        metadataJson: summary as Prisma.InputJsonObject
      }
    });

    await writeBotLog(database, "error", "Pipeline Fehler", {
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
  fetchSummary?: FetchCryptoCandlesSummary;
  analyzeSummary?: AnalyzeCryptoSignalsSummary;
  createPaperEvaluationsSummary?: CreatePaperEvaluationsSummary;
  evaluatePaperSignalsSummary?: EvaluatePaperSignalsSummary;
  error?: string;
}): CryptoSignalPipelineSummary {
  const summary: CryptoSignalPipelineSummary = {
    status: input.status,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    paperEvaluationEnabled: input.paperEvaluationEnabled
  };

  if (input.fetchSummary) {
    summary.fetchCryptoCandles = input.fetchSummary;
  }

  if (input.analyzeSummary) {
    summary.analyzeCryptoSignals = input.analyzeSummary;
  }

  if (input.createPaperEvaluationsSummary) {
    summary.createPaperEvaluationsForSignals = input.createPaperEvaluationsSummary;
  }

  if (input.evaluatePaperSignalsSummary) {
    summary.evaluatePaperSignals = input.evaluatePaperSignalsSummary;
  }

  if (input.error) {
    summary.error = input.error;
  }

  return summary;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return defaultValue;
}

async function writeBotLog(
  database: PrismaClient,
  level: string,
  message: string,
  metadataJson?: Prisma.InputJsonValue
) {
  await database.botLog.create({
    data: {
      level,
      service: "worker",
      message,
      metadataJson
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runCryptoSignalPipeline();
    logger.info("runCryptoSignalPipeline completed");
  } finally {
    await prisma.$disconnect();
  }
}
