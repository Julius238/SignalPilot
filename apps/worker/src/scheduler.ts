import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import cron, { type ScheduledTask } from "node-cron";
import pino from "pino";

import {
  runCryptoSignalPipeline,
  type CryptoSignalPipelineSummary
} from "./jobs/runCryptoSignalPipeline.js";
import {
  runEquitySignalPipeline,
  type EquitySignalPipelineSummary
} from "./jobs/runEquitySignalPipeline.js";

const logger = pino({
  name: "signalpilot-worker-scheduler"
});

const appDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(appDir, "../../../.env") });
config();

export type SchedulerState = {
  isRunning: boolean;
  isShuttingDown: boolean;
};

export type ScheduledRunResult = "skipped" | "success" | "failed";

type RunCryptoPipeline = (database: PrismaClient) => Promise<CryptoSignalPipelineSummary>;
type RunEquityPipeline = (database: PrismaClient) => Promise<EquitySignalPipelineSummary>;

const defaultCryptoCron = "0 * * * *";
const defaultEquityCron = "30 * * * *";
const schedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const equitySchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};

export async function runScheduledCryptoPipeline(
  database: PrismaClient,
  state: SchedulerState,
  runPipeline: RunCryptoPipeline = runCryptoSignalPipeline
): Promise<ScheduledRunResult> {
  if (state.isRunning) {
    await writeBotLog(
      database,
      "warn",
      "Skipped scheduled crypto pipeline run because previous run is still active",
      {
        skippedAt: new Date().toISOString()
      }
    );
    return "skipped";
  }

  state.isRunning = true;

  await writeBotLog(database, "info", "Scheduled crypto pipeline run started", {
    startedAt: new Date().toISOString()
  });

  try {
    const summary = await runPipeline(database);

    await writeBotLog(database, "info", "Scheduled crypto pipeline run finished", {
      finishedAt: new Date().toISOString(),
      summary
    });

    return "success";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled pipeline error";

    logger.error({ error }, message);
    await writeBotLog(database, "error", "Scheduled crypto pipeline run failed", {
      failedAt: new Date().toISOString(),
      error: message
    });

    return "failed";
  } finally {
    state.isRunning = false;
  }
}

export async function runScheduledEquityPipeline(
  database: PrismaClient,
  state: SchedulerState,
  runPipeline: RunEquityPipeline = runEquitySignalPipeline
): Promise<ScheduledRunResult> {
  if (state.isRunning) {
    await writeBotLog(
      database,
      "warn",
      "Skipped scheduled equity pipeline run because previous run is still active",
      { skippedAt: new Date().toISOString() }
    );
    return "skipped";
  }

  state.isRunning = true;

  await writeBotLog(database, "info", "Scheduled equity pipeline run started", {
    startedAt: new Date().toISOString()
  });

  try {
    const summary = await runPipeline(database);

    await writeBotLog(database, "info", "Scheduled equity pipeline run finished", {
      finishedAt: new Date().toISOString(),
      summary
    });

    return "success";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled pipeline error";

    logger.error({ error }, message);
    await writeBotLog(database, "error", "Scheduled equity pipeline run failed", {
      failedAt: new Date().toISOString(),
      error: message
    });

    return "failed";
  } finally {
    state.isRunning = false;
  }
}

async function startScheduler() {
  const cryptoCron = process.env.CRYPTO_PIPELINE_CRON ?? defaultCryptoCron;
  const runOnStart = process.env.RUN_PIPELINE_ON_START === "true";
  const equityEnabled = process.env.ENABLE_EQUITY_PIPELINE === "true";
  const equityCron = process.env.EQUITY_PIPELINE_CRON ?? defaultEquityCron;
  const runEquityOnStart = process.env.RUN_EQUITY_PIPELINE_ON_START === "true";

  if (!cron.validate(cryptoCron)) {
    throw new Error(`Invalid CRYPTO_PIPELINE_CRON expression: ${cryptoCron}`);
  }

  if (equityEnabled && !cron.validate(equityCron)) {
    throw new Error(`Invalid EQUITY_PIPELINE_CRON expression: ${equityCron}`);
  }

  await writeBotLog(prisma, "info", "Crypto pipeline scheduler started", {
    cronExpression: cryptoCron,
    runOnStart,
    startedAt: new Date().toISOString()
  });
  logger.info({ cronExpression: cryptoCron, runOnStart }, "Crypto pipeline scheduler started");

  const cryptoTask = cron.schedule(cryptoCron, () => {
    void runScheduledCryptoPipeline(prisma, schedulerState);
  });

  const tasks = [cryptoTask];

  if (equityEnabled) {
    await writeBotLog(prisma, "info", "Equity pipeline scheduler started", {
      cronExpression: equityCron,
      runEquityOnStart,
      startedAt: new Date().toISOString()
    });
    logger.info({ cronExpression: equityCron, runEquityOnStart }, "Equity pipeline scheduler started");

    const equityTask = cron.schedule(equityCron, () => {
      void runScheduledEquityPipeline(prisma, equitySchedulerState);
    });
    tasks.push(equityTask);

    if (runEquityOnStart) {
      void runScheduledEquityPipeline(prisma, equitySchedulerState);
    }
  }

  registerShutdownHandlers(tasks);

  if (runOnStart) {
    void runScheduledCryptoPipeline(prisma, schedulerState);
  }
}

function registerShutdownHandlers(tasks: ScheduledTask[]) {
  const shutdown = async (signal: NodeJS.Signals) => {
    if (schedulerState.isShuttingDown) {
      return;
    }

    schedulerState.isShuttingDown = true;
    equitySchedulerState.isShuttingDown = true;
    tasks.forEach((task) => task.stop());

    logger.info({ signal, isRunning: schedulerState.isRunning }, "Pipeline schedulers shutdown");

    await writeBotLog(prisma, "info", "Pipeline schedulers shutdown", {
      signal,
      isRunning: schedulerState.isRunning,
      stoppedAt: new Date().toISOString()
    });

    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
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
      service: "worker-scheduler",
      message,
      metadataJson
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await startScheduler();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduler startup error";

    logger.error({ error }, message);
    await writeBotLog(prisma, "error", "Crypto pipeline scheduler failed to start", {
      error: message
    }).catch((logError: unknown) => {
      logger.error({ error: logError }, "Failed to write scheduler startup error BotLog");
    });
    await prisma.$disconnect();
    process.exit(1);
  }
}
