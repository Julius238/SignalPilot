/**
 * Manual shadow trading job: full ledger replay and invariant check for every
 * non-archived portfolio.
 *
 * Specification: docs/trading/02-shadow-trading-target-architecture.md,
 * "Wiederaufnahme nach Prozessabbruch"; docs/trading/06, "Portfolio-Konsistenz
 * und Toleranz".
 *
 * Manual invocation only. Gated by `TRADING_SHADOW_RECONCILIATION_ENABLED`.
 * A mismatch locks the session (`ERROR_LOCKED`) and raises critical
 * `RiskEvent`s; it never rewrites the cache from the replay.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { reconcilePortfolio, SHADOW_RECONCILE_JOB_KEY } from "../lib/shadowReconciliation.js";
import { checkShadowReconciliationJobAllowed, type TradingFlagSnapshot } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowReconcilePortfolio";

export interface RunShadowReconcilePortfolioOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly portfolioId?: string;
}

export interface ShadowReconcilePortfolioSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly checked: number;
  readonly consistent: number;
  readonly inconsistent: number;
  readonly flags: TradingFlagSnapshot | null;
}

function resolveCodeVersion(env: Readonly<Record<string, string | undefined>>): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowReconcilePortfolio(
  database: PrismaClient = prisma,
  options: RunShadowReconcilePortfolioOptions = {}
): Promise<ShadowReconcilePortfolioSummary> {
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
      checked: 0,
      consistent: 0,
      inconsistent: 0,
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

  let consistent = 0;
  let inconsistent = 0;

  for (const portfolio of portfolios) {
    const result = await reconcilePortfolio(database, { portfolioId: portfolio.id, asOf, codeVersion, correlationId });
    if (result.consistent) consistent += 1;
    else inconsistent += 1;
    await writeBotLog(database, result.consistent ? "info" : "error", `${JOB_NAME} reconciled a portfolio`, {
      botRunId: botRun.id,
      correlationId,
      portfolioId: portfolio.id,
      portfolioKey: portfolio.key,
      consistent: result.consistent,
      violations: result.violations
    });
  }

  const status = inconsistent > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  const summary: ShadowReconcilePortfolioSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    checked: portfolios.length,
    consistent,
    inconsistent,
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
  runShadowReconcilePortfolio()
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${SHADOW_RECONCILE_JOB_KEY} refused to run`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_RECONCILE_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_RECONCILE_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
