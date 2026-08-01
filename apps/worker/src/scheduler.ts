import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import cron, { type ScheduledTask } from "node-cron";
import pino from "pino";

import { assertProductionSafety } from "./lib/safety.js";

import {
  runCryptoSignalPipeline,
  type CryptoSignalPipelineSummary
} from "./jobs/runCryptoSignalPipeline.js";
import {
  runEquitySignalPipeline,
  type EquitySignalPipelineSummary
} from "./jobs/runEquitySignalPipeline.js";
import { quickCryptoRadar, type QuickCryptoRadarSummary } from "./jobs/quickCryptoRadar.js";
import { quickEquityRadar, type QuickEquityRadarSummary } from "./jobs/quickEquityRadar.js";
import { radarSummary, type RadarSummaryResult } from "./jobs/radarSummary.js";
import { globalEventMonitor, type GlobalEventMonitorSummary } from "./jobs/globalEventMonitor.js";
import { auditCandleGaps, type CandleGapAuditSummary } from "./jobs/auditCandleGaps.js";
import {
  runAssetDiscoveryPipeline,
  type AssetDiscoveryPipelineSummary
} from "./jobs/runAssetDiscoveryPipeline.js";

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
type RunQuickRadar = (database: PrismaClient) => Promise<QuickCryptoRadarSummary>;
type RunEquityRadar = (database: PrismaClient) => Promise<QuickEquityRadarSummary>;
type RunRadarSummary = (database: PrismaClient) => Promise<RadarSummaryResult>;
type RunGlobalEventMonitor = (database: PrismaClient) => Promise<GlobalEventMonitorSummary>;
type RunCandleGapAudit = (database: PrismaClient) => Promise<CandleGapAuditSummary>;
type RunAssetDiscovery = (database: PrismaClient) => Promise<AssetDiscoveryPipelineSummary>;

const defaultCryptoCron = "0 * * * *";
const defaultEquityCron = "30 * * * *";
const defaultQuickRadarCron = "*/5 * * * *";
const defaultEquityRadarCron = "15 */4 * * *";
const defaultRadarSummaryCron = "0 * * * *";
const defaultGlobalEventMonitorCron = "*/30 * * * *";
const defaultCandleGapAuditCron = "15 3 * * *";
const defaultAssetDiscoveryCron = "30 2 * * *";
const schedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const equitySchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const quickRadarSchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const equityRadarSchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const radarSummarySchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const globalEventMonitorSchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const candleGapAuditSchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};
const assetDiscoverySchedulerState: SchedulerState = {
  isRunning: false,
  isShuttingDown: false
};

export type SchedulerSettings = {
  cryptoCron: string;
  runOnStart: boolean;
  environment: string;
  schedulerEnabled: boolean;
  equityEnabled: boolean;
  equityCron: string;
  runEquityOnStart: boolean;
  quickRadarEnabled: boolean;
  quickRadarCron: string;
  equityRadarEnabled: boolean;
  equityRadarCron: string;
  radarSummaryEnabled: boolean;
  radarSummaryCron: string;
  globalEventMonitorEnabled: boolean;
  globalEventMonitorCron: string;
  candleGapAuditEnabled: boolean;
  candleGapAuditCron: string;
  assetDiscoveryEnabled: boolean;
  assetDiscoveryDryRun: boolean;
  assetDiscoveryCron: string;
};

export function resolveSchedulerSettings(env: NodeJS.ProcessEnv = process.env): SchedulerSettings {
  return {
    cryptoCron: env.CRYPTO_PIPELINE_CRON ?? defaultCryptoCron,
    runOnStart: env.WORKER_RUN_ON_START === "true",
    environment: env.NODE_ENV ?? "development",
    schedulerEnabled: true,
    equityEnabled: env.ENABLE_EQUITY_PIPELINE === "true",
    equityCron: env.EQUITY_PIPELINE_CRON ?? defaultEquityCron,
    runEquityOnStart: env.RUN_EQUITY_PIPELINE_ON_START === "true",
    quickRadarEnabled: env.QUICK_RADAR_ENABLED === "true",
    quickRadarCron: env.QUICK_RADAR_CRON ?? defaultQuickRadarCron,
    equityRadarEnabled: env.EQUITY_RADAR_ENABLED === "true",
    equityRadarCron: env.EQUITY_RADAR_CRON ?? defaultEquityRadarCron,
    radarSummaryEnabled: env.RADAR_SUMMARY_ENABLED === "true",
    radarSummaryCron: env.RADAR_SUMMARY_CRON ?? defaultRadarSummaryCron,
    globalEventMonitorEnabled: env.GLOBAL_EVENT_MONITOR_ENABLED === "true",
    globalEventMonitorCron: env.GLOBAL_EVENT_MONITOR_CRON ?? defaultGlobalEventMonitorCron,
    candleGapAuditEnabled: env.CANDLE_GAP_AUDIT_ENABLED === "true",
    candleGapAuditCron: env.CANDLE_GAP_AUDIT_CRON ?? defaultCandleGapAuditCron,
    assetDiscoveryEnabled: env.ASSET_DISCOVERY_ENABLED === "true",
    assetDiscoveryDryRun: env.ASSET_DISCOVERY_DRY_RUN !== "false",
    assetDiscoveryCron: env.ASSET_DISCOVERY_CRON ?? defaultAssetDiscoveryCron
  };
}

async function runScheduledJob<Summary>(
  database: PrismaClient,
  state: SchedulerState,
  jobLabel: string,
  runJob: (database: PrismaClient) => Promise<Summary>
): Promise<ScheduledRunResult> {
  if (state.isRunning) {
    await writeBotLog(
      database,
      "warn",
      `Skipped scheduled ${jobLabel} run because previous run is still active`,
      {
        skippedAt: new Date().toISOString()
      }
    );
    return "skipped";
  }

  state.isRunning = true;

  await writeBotLog(database, "info", `Scheduled ${jobLabel} run started`, {
    startedAt: new Date().toISOString()
  });

  try {
    const summary = await runJob(database);
    const reportedStatus =
      summary && typeof summary === "object" && "status" in summary
        ? String(summary.status)
        : "SUCCESS";

    await writeBotLog(database, "info", `Scheduled ${jobLabel} run finished`, {
      finishedAt: new Date().toISOString(),
      summary: summary as unknown as Prisma.InputJsonValue
    });

    return reportedStatus === BotRunStatus.FAILED ? "failed" : "success";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled pipeline error";

    logger.error({ error }, message);
    await writeBotLog(database, "error", `Scheduled ${jobLabel} run failed`, {
      failedAt: new Date().toISOString(),
      error: message
    });

    return "failed";
  } finally {
    state.isRunning = false;
  }
}

export async function runScheduledCryptoPipeline(
  database: PrismaClient,
  state: SchedulerState,
  runPipeline: RunCryptoPipeline = runCryptoSignalPipeline
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "crypto pipeline", runPipeline);
}

export async function runScheduledEquityPipeline(
  database: PrismaClient,
  state: SchedulerState,
  runPipeline: RunEquityPipeline = runEquitySignalPipeline
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "equity pipeline", runPipeline);
}

export async function runScheduledQuickRadar(
  database: PrismaClient,
  state: SchedulerState,
  runJob: RunQuickRadar = quickCryptoRadar
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "quick radar", runJob);
}

export async function runScheduledEquityRadar(
  database: PrismaClient,
  state: SchedulerState,
  runJob: RunEquityRadar = quickEquityRadar
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "equity radar", runJob);
}

export async function runScheduledRadarSummary(
  database: PrismaClient,
  state: SchedulerState,
  runJob: RunRadarSummary = radarSummary
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "radar summary", runJob);
}

export async function runScheduledGlobalEventMonitor(
  database: PrismaClient,
  state: SchedulerState,
  runJob: RunGlobalEventMonitor = globalEventMonitor
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "global event monitor", runJob);
}

export async function runScheduledCandleGapAudit(
  database: PrismaClient,
  state: SchedulerState,
  runJob: RunCandleGapAudit = auditCandleGaps
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "candle gap audit", runJob);
}

export async function runScheduledAssetDiscovery(
  database: PrismaClient,
  state: SchedulerState,
  runJob: RunAssetDiscovery = runAssetDiscoveryPipeline
): Promise<ScheduledRunResult> {
  return runScheduledJob(database, state, "asset discovery", runJob);
}

async function startScheduler() {
  const settings = resolveSchedulerSettings();
  const {
    cryptoCron,
    runOnStart,
    environment,
    schedulerEnabled,
    equityEnabled,
    equityCron,
    runEquityOnStart,
    quickRadarEnabled,
    quickRadarCron,
    equityRadarEnabled,
    equityRadarCron,
    radarSummaryEnabled,
    radarSummaryCron,
    globalEventMonitorEnabled,
    globalEventMonitorCron,
    candleGapAuditEnabled,
    candleGapAuditCron,
    assetDiscoveryEnabled,
    assetDiscoveryDryRun,
    assetDiscoveryCron
  } = settings;

  if (!cron.validate(cryptoCron)) {
    throw new Error(`Invalid CRYPTO_PIPELINE_CRON expression: ${cryptoCron}`);
  }

  if (equityEnabled && !cron.validate(equityCron)) {
    throw new Error(`Invalid EQUITY_PIPELINE_CRON expression: ${equityCron}`);
  }

  if (quickRadarEnabled && !cron.validate(quickRadarCron)) {
    throw new Error(`Invalid QUICK_RADAR_CRON expression: ${quickRadarCron}`);
  }

  if (equityRadarEnabled && !cron.validate(equityRadarCron)) {
    throw new Error(`Invalid EQUITY_RADAR_CRON expression: ${equityRadarCron}`);
  }

  if (radarSummaryEnabled && !cron.validate(radarSummaryCron)) {
    throw new Error(`Invalid RADAR_SUMMARY_CRON expression: ${radarSummaryCron}`);
  }

  if (globalEventMonitorEnabled && !cron.validate(globalEventMonitorCron)) {
    throw new Error(`Invalid GLOBAL_EVENT_MONITOR_CRON expression: ${globalEventMonitorCron}`);
  }

  if (candleGapAuditEnabled && !cron.validate(candleGapAuditCron)) {
    throw new Error(`Invalid CANDLE_GAP_AUDIT_CRON expression: ${candleGapAuditCron}`);
  }

  if (assetDiscoveryEnabled && !cron.validate(assetDiscoveryCron)) {
    throw new Error(`Invalid ASSET_DISCOVERY_CRON expression: ${assetDiscoveryCron}`);
  }

  await writeBotLog(prisma, "info", "Crypto pipeline scheduler started", {
    cronExpression: cryptoCron,
    runOnStart,
    environment,
    schedulerEnabled,
    startedAt: new Date().toISOString()
  });
  logger.info(
    { cronExpression: cryptoCron, runOnStart, environment, schedulerEnabled },
    "Crypto pipeline scheduler started"
  );

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

  if (quickRadarEnabled) {
    await writeBotLog(prisma, "info", "Quick radar scheduler started", {
      cronExpression: quickRadarCron,
      startedAt: new Date().toISOString()
    });
    logger.info({ cronExpression: quickRadarCron }, "Quick radar scheduler started");

    const quickRadarTask = cron.schedule(quickRadarCron, () => {
      void runScheduledQuickRadar(prisma, quickRadarSchedulerState);
    });
    tasks.push(quickRadarTask);
  }

  if (equityRadarEnabled) {
    await writeBotLog(prisma, "info", "Equity radar scheduler started", {
      cronExpression: equityRadarCron,
      startedAt: new Date().toISOString()
    });
    logger.info({ cronExpression: equityRadarCron }, "Equity radar scheduler started");

    const equityRadarTask = cron.schedule(equityRadarCron, () => {
      void runScheduledEquityRadar(prisma, equityRadarSchedulerState);
    });
    tasks.push(equityRadarTask);
  }

  if (radarSummaryEnabled) {
    await writeBotLog(prisma, "info", "Radar summary scheduler started", {
      cronExpression: radarSummaryCron,
      startedAt: new Date().toISOString()
    });
    logger.info({ cronExpression: radarSummaryCron }, "Radar summary scheduler started");

    const radarSummaryTask = cron.schedule(radarSummaryCron, () => {
      void runScheduledRadarSummary(prisma, radarSummarySchedulerState);
    });
    tasks.push(radarSummaryTask);
  }

  if (globalEventMonitorEnabled) {
    await writeBotLog(prisma, "info", "Global event monitor scheduler started", {
      cronExpression: globalEventMonitorCron,
      startedAt: new Date().toISOString()
    });
    logger.info({ cronExpression: globalEventMonitorCron }, "Global event monitor scheduler started");

    const globalEventMonitorTask = cron.schedule(globalEventMonitorCron, () => {
      void runScheduledGlobalEventMonitor(prisma, globalEventMonitorSchedulerState);
    });
    tasks.push(globalEventMonitorTask);
  }

  if (candleGapAuditEnabled) {
    await writeBotLog(prisma, "info", "Candle gap audit scheduler started", {
      cronExpression: candleGapAuditCron,
      startedAt: new Date().toISOString()
    });
    const candleGapAuditTask = cron.schedule(candleGapAuditCron, () => {
      void runScheduledCandleGapAudit(prisma, candleGapAuditSchedulerState);
    });
    tasks.push(candleGapAuditTask);
  }

  if (assetDiscoveryEnabled) {
    await writeBotLog(prisma, "info", "Asset discovery scheduler started", {
      cronExpression: assetDiscoveryCron,
      dryRun: assetDiscoveryDryRun,
      startedAt: new Date().toISOString()
    });
    const assetDiscoveryTask = cron.schedule(assetDiscoveryCron, () => {
      void runScheduledAssetDiscovery(prisma, assetDiscoverySchedulerState);
    });
    tasks.push(assetDiscoveryTask);
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
    quickRadarSchedulerState.isShuttingDown = true;
    equityRadarSchedulerState.isShuttingDown = true;
    radarSummarySchedulerState.isShuttingDown = true;
    globalEventMonitorSchedulerState.isShuttingDown = true;
    candleGapAuditSchedulerState.isShuttingDown = true;
    assetDiscoverySchedulerState.isShuttingDown = true;
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
  assertProductionSafety();

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
