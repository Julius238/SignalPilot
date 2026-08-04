/**
 * Manual shadow trading job: create a `ShadowOrder` (and its cash reservation)
 * for every `APPROVED_FOR_SHADOW` candidate that does not have one yet.
 *
 * Specification: docs/trading/02-shadow-trading-target-architecture.md,
 * "Datenfluss v1" step 6; docs/trading/04-state-machines.md, "Shadow Order".
 *
 * Manual invocation only — no cron entry, no scheduler registration. Gated
 * by `TRADING_SHADOW_EXECUTION_ENABLED` on top of the shared shadow-only
 * base.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  Prisma,
  TradeCandidateStatus,
  TradeDirection,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import {
  ShadowOrderOutcome,
  SHADOW_ORDER_JOB_KEY,
  createShadowOrderForCandidate
} from "../lib/shadowOrderPersistence.js";
import {
  checkShadowExecutionJobAllowed,
  type TradingFlagSnapshot
} from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowCreateOrders";
const DEFAULT_BATCH_SIZE = 25;

export interface RunShadowCreateOrdersOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly batchSize?: number;
}

export interface ShadowCreateOrdersSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly scanned: number;
  readonly created: number;
  readonly idempotentReplays: number;
  readonly blockedByGuard: number;
  readonly flags: TradingFlagSnapshot | null;
}

function resolveCodeVersion(
  env: Readonly<Record<string, string | undefined>>
): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowCreateOrders(
  database: PrismaClient = prisma,
  options: RunShadowCreateOrdersOptions = {}
): Promise<ShadowCreateOrdersSummary> {
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
      created: 0,
      idempotentReplays: 0,
      blockedByGuard: 0,
      flags: gate.flags
    };
  }

  const candidates = await database.tradeCandidate.findMany({
    where: {
      status: TradeCandidateStatus.APPROVED_FOR_SHADOW,
      shadowOrders: { none: {} },
      direction: {
        in: [
          ...(gate.flags.strategyLongV1Enabled ? [TradeDirection.LONG] : []),
          ...(gate.flags.shadowShortEnabled && gate.flags.strategyShortV1Enabled
            ? [TradeDirection.SHORT]
            : [])
        ]
      }
    },
    orderBy: { decisionTime: "asc" },
    take: batchSize,
    select: { id: true }
  });

  let created = 0;
  let idempotentReplays = 0;
  let blockedByGuard = 0;

  for (const { id } of candidates) {
    const result = await createShadowOrderForCandidate(database, {
      tradeCandidateId: id,
      asOf,
      codeVersion,
      correlationId,
      capability: {
        strategyV1Enabled: gate.flags.strategyV1Enabled,
        strategyLongV1Enabled: gate.flags.strategyLongV1Enabled,
        strategyShortV1Enabled: gate.flags.strategyShortV1Enabled,
        shadowShortEnabled: gate.flags.shadowShortEnabled,
        shadowOnlyBuild: gate.flags.buildCapability === "SHADOW_ONLY",
        enableLiveTrading: gate.flags.enableLiveTrading,
        exchangeExecutionEnabled: false,
        marginTradingEnabled: false,
        futuresTradingEnabled: false
      }
    });
    if (result.outcome === ShadowOrderOutcome.CREATED) created += 1;
    else if (result.outcome === ShadowOrderOutcome.IDEMPOTENT_REPLAY)
      idempotentReplays += 1;
    else blockedByGuard += 1;

    await writeBotLog(
      database,
      result.outcome === ShadowOrderOutcome.BLOCKED ? "warn" : "info",
      `${JOB_NAME} processed a candidate`,
      {
        botRunId: botRun.id,
        correlationId,
        tradeCandidateId: id,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
        shadowOrderId: result.shadowOrderId
      }
    );
  }

  const summary: ShadowCreateOrdersSummary = {
    status: BotRunStatus.SUCCESS,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    scanned: candidates.length,
    created,
    idempotentReplays,
    blockedByGuard,
    flags: gate.flags
  };
  await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, { ...summary });
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
  runShadowCreateOrders()
    .then((summary) => {
      if (summary.blocked) {
        logger.error(
          { reasonCode: summary.blockReasonCode },
          `${SHADOW_ORDER_JOB_KEY} refused to run`
        );
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_ORDER_JOB_KEY} completed`);
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_ORDER_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
