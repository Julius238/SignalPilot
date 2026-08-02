/**
 * Manual shadow trading job: idempotent UTC day rollover — writes the
 * start-of-day equity snapshot `R-010-DAILY-LOSS` needs.
 *
 * Specification: docs/trading/06-risk-engine-specification.md, "Tagesverlust
 * und Drawdown".
 *
 * Manual invocation only. Gated by `TRADING_SHADOW_RECONCILIATION_ENABLED`.
 * Never activates a session or resets any counter by itself.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { startTradingDay, SHADOW_TRADING_DAY_JOB_KEY } from "../lib/shadowTradingDay.js";
import { checkShadowReconciliationJobAllowed, type TradingFlagSnapshot } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowStartTradingDay";

export interface RunShadowStartTradingDayOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly portfolioId?: string;
}

export interface ShadowStartTradingDaySummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly processed: number;
  readonly created: number;
  readonly alreadyStarted: number;
  readonly flags: TradingFlagSnapshot | null;
}

function resolveCodeVersion(env: Readonly<Record<string, string | undefined>>): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowStartTradingDay(
  database: PrismaClient = prisma,
  options: RunShadowStartTradingDayOptions = {}
): Promise<ShadowStartTradingDaySummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? resolveCodeVersion(env);

  const gate = checkShadowReconciliationJobAllowed(env);
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
      processed: 0,
      created: 0,
      alreadyStarted: 0,
      flags: gate.flags
    };
  }

  const portfolios = await database.portfolio.findMany({
    where: {
      status: { not: "ARCHIVED" },
      ...(options.portfolioId === undefined ? {} : { id: options.portfolioId })
    },
    select: { id: true, key: true }
  });

  let created = 0;
  let alreadyStarted = 0;

  for (const portfolio of portfolios) {
    const result = await startTradingDay(database, { portfolioId: portfolio.id, asOf, codeVersion, correlationId });
    if (result.outcome === "CREATED") created += 1;
    else alreadyStarted += 1;
    await writeBotLog(database, "info", `${JOB_NAME} processed a portfolio`, {
      botRunId: botRun.id,
      correlationId,
      portfolioId: portfolio.id,
      portfolioKey: portfolio.key,
      outcome: result.outcome,
      tradingDateUtc: result.tradingDateUtc
    });
  }

  const summary: ShadowStartTradingDaySummary = {
    status: BotRunStatus.SUCCESS,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    processed: portfolios.length,
    created,
    alreadyStarted,
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
  runShadowStartTradingDay()
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${SHADOW_TRADING_DAY_JOB_KEY} refused to run`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_TRADING_DAY_JOB_KEY} completed`);
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_TRADING_DAY_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
