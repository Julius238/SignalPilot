/**
 * `apps/trading-worker` entrypoint.
 *
 * Specification: P5 task, "Docker und Betrieb" — "Healthcheck; Graceful
 * Shutdown; keine automatische Aktivierung der Trading Session; keine
 * Migration während des normalen Worker-Starts; der Service darf bei
 * deaktivierten Flags keine fachlichen Schreibvorgänge ausführen."
 *
 * Startup never runs a migration and never activates anything — it only
 * resolves configuration and, if every flag layer agrees, starts the
 * scheduler. Two distinct "not ok" outcomes are handled differently on
 * purpose:
 *
 *   - `ENABLE_LIVE_TRADING=true` (`safety.ts`) is severe enough to refuse to
 *     start the process at all (`process.exit(1)`) — the same choice
 *     `apps/worker` makes for the same flag.
 *   - Every other "not ready" state (`TRADING_WORKER_ENABLED=false` — the
 *     safe default — or any other unmet base gate, or malformed
 *     configuration) keeps the process running with the scheduler simply
 *     never started, so a default-safe deployment does not crash-loop and a
 *     Docker healthcheck against the running process still passes.
 *
 * The heartbeat file this module touches is a plain liveness signal for
 * `docker healthcheck` — deliberately not an HTTP endpoint, since P5's
 * non-scope explicitly excludes a Trading API.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@signalpilot/database";
import { config as loadDotenv } from "dotenv";
import type { ScheduledTask } from "node-cron";
import pino from "pino";

import { resolveTradingWorkerConfig } from "./config.js";
import { startTradingWorkerScheduler } from "./scheduler.js";
import { assertProductionSafety } from "./safety.js";

const logger = pino({ name: "trading-worker" });
const appDir = dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: resolve(appDir, "../../../.env") });
loadDotenv();

const HEARTBEAT_FILE = process.env.TRADING_WORKER_HEARTBEAT_FILE ?? "/tmp/trading-worker-heartbeat";
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

async function touchHeartbeatFile(): Promise<void> {
  try {
    await writeFile(HEARTBEAT_FILE, new Date().toISOString());
  } catch (error) {
    logger.warn({ error, HEARTBEAT_FILE }, "could not write heartbeat file");
  }
}

async function main(): Promise<void> {
  assertProductionSafety();

  const resolved = resolveTradingWorkerConfig();
  let tasks: readonly ScheduledTask[] = [];

  if (!resolved.ok) {
    logger.warn(
      { reasonCode: resolved.reasonCode, message: resolved.message },
      "trading-worker idle: scheduler not started"
    );
  } else if (!resolved.config.schedulerEnabled) {
    logger.info("trading-worker idle: TRADING_SCHEDULER_ENABLED is not true");
  } else {
    tasks = startTradingWorkerScheduler(resolved.config, prisma);
    logger.info({ jobCount: tasks.length }, "trading-worker scheduler started");
  }

  await touchHeartbeatFile();
  const heartbeatInterval = setInterval(() => {
    void touchHeartbeatFile();
  }, HEARTBEAT_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "trading-worker shutting down");
    clearInterval(heartbeatInterval);
    for (const task of tasks) task.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error({ error }, "trading-worker failed to start");
  process.exitCode = 1;
});
