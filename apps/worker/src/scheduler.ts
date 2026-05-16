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

type RunPipeline = (database: PrismaClient) => Promise<CryptoSignalPipelineSummary>;

const defaultCron = "0 * * * *";
const schedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};

export async function runScheduledCryptoPipeline(
  database: PrismaClient,
  state: SchedulerState,
  runPipeline: RunPipeline = runCryptoSignalPipeline
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

async function startScheduler() {
  const cronExpression = process.env.CRYPTO_PIPELINE_CRON ?? defaultCron;
  const runOnStart = process.env.RUN_PIPELINE_ON_START === "true";

  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid CRYPTO_PIPELINE_CRON expression: ${cronExpression}`);
  }

  await writeBotLog(prisma, "info", "Crypto pipeline scheduler started", {
    cronExpression,
    runOnStart,
    startedAt: new Date().toISOString()
  });
  logger.info({ cronExpression, runOnStart }, "Crypto pipeline scheduler started");

  const task = cron.schedule(cronExpression, () => {
    void runScheduledCryptoPipeline(prisma, schedulerState);
  });

  registerShutdownHandlers(task);

  if (runOnStart) {
    void runScheduledCryptoPipeline(prisma, schedulerState);
  }
}

function registerShutdownHandlers(task: ScheduledTask) {
  const shutdown = async (signal: NodeJS.Signals) => {
    if (schedulerState.isShuttingDown) {
      return;
    }

    schedulerState.isShuttingDown = true;
    task.stop();

    logger.info({ signal, isRunning: schedulerState.isRunning }, "Crypto pipeline scheduler shutdown");

    await writeBotLog(prisma, "info", "Crypto pipeline scheduler shutdown", {
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
