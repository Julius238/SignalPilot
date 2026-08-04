/**
 * Manual shadow trading job: advance every waiting entry `ShadowOrder` by its
 * next unprocessed closed candle.
 *
 * Specification: docs/trading/07-shadow-execution-model.md;
 * docs/trading/02-shadow-trading-target-architecture.md, "Datenfluss v1" step 7.
 *
 * Manual invocation only. Gated by `TRADING_SHADOW_EXECUTION_ENABLED`.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  Prisma,
  ShadowOrderStatus,
  TradeDirection,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { findNextUnprocessedCandle } from "../lib/shadowCandleCursor.js";
import {
  ShadowFillOutcome,
  SHADOW_FILL_JOB_KEY,
  processEntryOrderFillForCandle
} from "../lib/shadowFillPersistence.js";
import {
  checkShadowExecutionJobAllowed,
  type TradingFlagSnapshot
} from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowProcessFills";
const DEFAULT_BATCH_SIZE = 50;
/** An entry order's fill window is at most two 1h candles. */
const MAX_CANDLES_PER_ORDER_PER_RUN = 2;

export interface RunShadowProcessFillsOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly batchSize?: number;
}

export interface ShadowProcessFillsSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly scanned: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly flags: TradingFlagSnapshot | null;
}

function resolveCodeVersion(
  env: Readonly<Record<string, string | undefined>>
): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowProcessFills(
  database: PrismaClient = prisma,
  options: RunShadowProcessFillsOptions = {}
): Promise<ShadowProcessFillsSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? resolveCodeVersion(env);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const gate = checkShadowExecutionJobAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        correlationId,
        asOf: asOf.toISOString()
      } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, {
      blockReasonCode: gate.reasonCode
    });
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

  const orders = await database.shadowOrder.findMany({
    where: {
      purpose: "ENTRY",
      status: {
        in: [
          ShadowOrderStatus.WAITING_FOR_ENTRY,
          ShadowOrderStatus.PARTIALLY_FILLED
        ]
      },
      direction: {
        in: [
          ...(gate.flags.strategyLongV1Enabled ? [TradeDirection.LONG] : []),
          ...(gate.flags.shadowShortEnabled && gate.flags.strategyShortV1Enabled
            ? [TradeDirection.SHORT]
            : [])
        ]
      }
    },
    orderBy: { createdAt: "asc" },
    take: batchSize
  });

  const outcomes: Record<string, number> = {};
  const bump = (key: string): void => {
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  };

  for (const order of orders) {
    for (
      let iteration = 0;
      iteration < MAX_CANDLES_PER_ORDER_PER_RUN;
      iteration += 1
    ) {
      const fresh = await database.shadowOrder.findUnique({
        where: { id: order.id }
      });
      if (
        fresh === null ||
        (fresh.status !== ShadowOrderStatus.WAITING_FOR_ENTRY &&
          fresh.status !== ShadowOrderStatus.PARTIALLY_FILLED)
      ) {
        break;
      }
      const candle = await findNextUnprocessedCandle(database, {
        assetId: fresh.assetId,
        timeframe: "1h",
        lastProcessedCandleId: fresh.lastProcessedCandleId,
        earliestEligibleAt: fresh.earliestFillAt ?? asOf,
        asOf
      });
      if (candle === null) break;

      const result = await processEntryOrderFillForCandle(database, {
        shadowOrderId: fresh.id,
        candleId: candle.id,
        asOf,
        codeVersion,
        correlationId
      });
      bump(result.outcome);
      await writeBotLog(
        database,
        result.outcome === ShadowFillOutcome.ERROR_LOCKED ? "error" : "info",
        `${JOB_NAME} processed a candle`,
        {
          botRunId: botRun.id,
          correlationId,
          shadowOrderId: fresh.id,
          candleId: candle.id,
          outcome: result.outcome
        }
      );
      if (
        result.outcome !== ShadowFillOutcome.PARTIALLY_FILLED &&
        result.outcome !== ShadowFillOutcome.WAITING
      )
        break;
    }
  }

  const status =
    (outcomes[ShadowFillOutcome.ERROR_LOCKED] ?? 0) > 0
      ? BotRunStatus.FAILED
      : BotRunStatus.SUCCESS;
  const summary: ShadowProcessFillsSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    scanned: orders.length,
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
    data: {
      status,
      finishedAt: new Date(),
      metadataJson: metadataJson as Prisma.InputJsonObject
    }
  });
}

async function writeBotLog(
  database: PrismaClient,
  level: "info" | "warn" | "error",
  message: string,
  metadataJson: Record<string, unknown>
): Promise<void> {
  await database.botLog.create({
    data: {
      level,
      service: "worker",
      message,
      metadataJson: metadataJson as Prisma.InputJsonObject
    }
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runShadowProcessFills()
    .then((summary) => {
      if (summary.blocked) {
        logger.error(
          { reasonCode: summary.blockReasonCode },
          `${SHADOW_FILL_JOB_KEY} refused to run`
        );
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_FILL_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_FILL_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
