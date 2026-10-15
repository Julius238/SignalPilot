/**
 * Evolution worker process: schedules research cycles and keeps a heartbeat.
 *
 * Independent of the trading path by construction: separate container, own
 * database role (Evolution* tables only), no import of the trading worker,
 * the API or any order/exchange code. If this process is paused, crashes or
 * is never deployed, trading, position monitoring and the risk engine are
 * unaffected — nothing in the trading worker waits for or reads from it.
 *
 * `EVOLUTION_ENABLED=false` (the default) keeps the process idle: it starts,
 * writes its heartbeat and schedules nothing.
 */

import "dotenv/config";

import { writeFileSync } from "node:fs";

import cron from "node-cron";

import { EvolutionConfigError, describeConfig, loadEvolutionConfig } from "./config.js";
import { runResearchCycle } from "./cycle/researchCycle.js";
import { createEvolutionDatabase } from "./database.js";
import { logger } from "./logger.js";
import { ensureAgentState } from "./persistence/agentState.js";
import { createBacktestPool, createProvider, loadMarketInfo } from "./runtime.js";

const config = loadEvolutionConfig();
logger.info({ config: describeConfig(config) }, "evolution worker starting");

const beat = () => {
  try {
    writeFileSync(config.heartbeatFile, new Date().toISOString());
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "heartbeat write failed");
  }
};
beat();
setInterval(beat, 30_000).unref();

if (!config.enabled) {
  logger.info("EVOLUTION_ENABLED is not true; the worker stays idle");
  setInterval(() => undefined, 1 << 30);
} else {
  if (config.databaseUrl === null) throw new EvolutionConfigError("EVOLUTION_DATABASE_URL (or DATABASE_URL) is required.");
  if (!cron.validate(config.scheduleCron)) throw new EvolutionConfigError(`EVOLUTION_SCHEDULE_CRON is invalid: ${config.scheduleCron}`);
  const db = createEvolutionDatabase(config.databaseUrl);
  const provider = createProvider(config);
  await ensureAgentState(db);
  let running = false;
  const task = cron.schedule(
    config.scheduleCron,
    async () => {
      if (running) {
        logger.warn("previous research cycle still running; tick skipped");
        return;
      }
      running = true;
      const runner = createBacktestPool(config);
      try {
        const market = await loadMarketInfo(config);
        const outcome = await runResearchCycle(
          { db, config, provider, runner, market, log: logger, now: () => new Date() },
          { trigger: "SCHEDULED", nextRunAt: task.getNextRun() }
        );
        logger.info({ outcome }, "scheduled research cycle done");
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, "scheduled research cycle crashed");
      } finally {
        await runner.close();
        running = false;
      }
    },
    { timezone: "UTC", noOverlap: true }
  );
  await db.evolutionAgentState.update({ where: { key: "EVOLUTION_V1" }, data: { nextRunAt: task.getNextRun() } });
  logger.info({ schedule: config.scheduleCron }, "research cycles scheduled (UTC)");
}
