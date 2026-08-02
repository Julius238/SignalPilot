/**
 * Manual shadow trading job: advance every open `ShadowPosition` by its next
 * unprocessed closed candle, resolving stop/take-profit/time exits.
 *
 * Specification: docs/trading/07-shadow-execution-model.md, "Stop, Take
 * Profit und Intrakerzenkonflikte"; docs/trading/02, "Datenfluss v1" step 8.
 *
 * Manual invocation only. Gated by its own
 * `TRADING_SHADOW_POSITION_MONITOR_ENABLED` flag — independent of
 * `TRADING_SHADOW_EXECUTION_ENABLED` so monitoring and risk-reducing exits
 * can keep running while new entries are disabled (docs/trading/04).
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, ShadowPositionStatus, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { findNextUnprocessedCandle } from "../lib/shadowCandleCursor.js";
import {
  ShadowMonitorOutcome,
  SHADOW_MONITOR_JOB_KEY,
  monitorPositionForCandle
} from "../lib/shadowPositionMonitor.js";
import { checkShadowPositionMonitorJobAllowed, type TradingFlagSnapshot } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowMonitorPositions";
const DEFAULT_BATCH_SIZE = 50;
/** One candle can trigger at most one exit event per position per run. */
const MAX_CANDLES_PER_POSITION_PER_RUN = 4;

export interface RunShadowMonitorPositionsOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly batchSize?: number;
}

export interface ShadowMonitorPositionsSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly scanned: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly flags: TradingFlagSnapshot | null;
}

function resolveCodeVersion(env: Readonly<Record<string, string | undefined>>): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowMonitorPositions(
  database: PrismaClient = prisma,
  options: RunShadowMonitorPositionsOptions = {}
): Promise<ShadowMonitorPositionsSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? resolveCodeVersion(env);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const gate = checkShadowPositionMonitorJobAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { correlationId, asOf: asOf.toISOString() } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { blockReasonCode: gate.reasonCode });
    return {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: gate.reasonCode,
      correlationId,
      scanned: 0,
      outcomes: {},
      flags: gate.flags
    };
  }

  const positions = await database.shadowPosition.findMany({
    where: { status: { in: [ShadowPositionStatus.OPEN, ShadowPositionStatus.PARTIALLY_CLOSED] } },
    orderBy: { openedAt: "asc" },
    take: batchSize
  });

  const outcomes: Record<string, number> = {};
  const bump = (key: string): void => {
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  };

  for (const position of positions) {
    for (let iteration = 0; iteration < MAX_CANDLES_PER_POSITION_PER_RUN; iteration += 1) {
      const fresh = await database.shadowPosition.findUnique({ where: { id: position.id } });
      if (fresh === null || (fresh.status !== ShadowPositionStatus.OPEN && fresh.status !== ShadowPositionStatus.PARTIALLY_CLOSED)) {
        break;
      }
      const candle = await findNextUnprocessedCandle(database, {
        assetId: fresh.assetId,
        timeframe: "1h",
        lastProcessedCandleId: fresh.lastProcessedCandleId,
        earliestEligibleAt: fresh.openedAt ?? asOf,
        asOf
      });
      if (candle === null) break;

      const result = await monitorPositionForCandle(database, {
        shadowPositionId: fresh.id,
        candleId: candle.id,
        asOf,
        codeVersion,
        correlationId
      });
      bump(result.outcome);
      await writeBotLog(database, result.outcome === ShadowMonitorOutcome.ERROR_LOCKED ? "error" : "info", `${JOB_NAME} processed a candle`, {
        botRunId: botRun.id,
        correlationId,
        shadowPositionId: fresh.id,
        candleId: candle.id,
        outcome: result.outcome
      });
      if (result.outcome === ShadowMonitorOutcome.TRIGGERED_CLOSED || result.outcome === ShadowMonitorOutcome.ERROR_LOCKED) break;
    }
  }

  const status = (outcomes[ShadowMonitorOutcome.ERROR_LOCKED] ?? 0) > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  const summary: ShadowMonitorPositionsSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    scanned: positions.length,
    outcomes,
    flags: gate.flags
  };
  await finishBotRun(database, botRun.id, status, { ...summary });
  return summary;
}

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  status: BotRunStatus,
  metadataJson: Record<string, unknown>
): Promise<void> {
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
): Promise<void> {
  await database.botLog.create({
    data: { level, service: "worker", message, metadataJson: metadataJson as Prisma.InputJsonObject }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runShadowMonitorPositions()
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${SHADOW_MONITOR_JOB_KEY} refused to run`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_MONITOR_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_MONITOR_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
