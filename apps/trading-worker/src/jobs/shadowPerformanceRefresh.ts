/**
 * Manual shadow trading job: recompute strategy performance (P8, "3. Manueller
 * Performance-Job").
 *
 * `pnpm trading-worker:shadow-performance-refresh`
 *
 * Reads closed shadow positions, their fills and the portfolio snapshots;
 * writes `StrategyPerformance` rows, a `BotRun`/`BotLog` pair and one
 * `TradingAuditEvent` per run. It changes no order, no position, no fill, no
 * ledger entry and no risk decision — the job is a projection, never a
 * participant.
 *
 * Disabled by default behind its own flag `TRADING_PERFORMANCE_JOB_ENABLED`,
 * on top of the shared shadow-only base gate. It is deliberately NOT wired
 * into `scheduler.ts`: P5's scheduler owns the trading workflow, and adding a
 * reporting job to it would give a reporting bug a way to consume an ENTRY
 * lease. An operator triggers it manually, or via `/trading/operations/run-job`.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  PortfolioStatus,
  Prisma,
  StrategyPerformanceWindow,
  TradingActorType,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { buildAuditEventKey } from "@signalpilot/trading-domain";
import { config } from "dotenv";
import pino from "pino";

import {
  SHADOW_PERFORMANCE_ENGINE_VERSION,
  SHADOW_PERFORMANCE_JOB_KEY,
  refreshShadowPerformance,
  type PersistShadowPerformanceSummary
} from "../lib/shadowPerformancePersistence.js";
import { checkShadowPerformanceJobAllowed, type TradingFlagSnapshot } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowPerformanceRefresh";

/** Every window is refreshed in one run; they share the same data cut. */
const WINDOWS: readonly StrategyPerformanceWindow[] = [
  StrategyPerformanceWindow.DAILY,
  StrategyPerformanceWindow.ROLLING_30D,
  StrategyPerformanceWindow.ALL_TIME
];

export interface RunShadowPerformanceRefreshOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly portfolioId?: string;
  readonly derivePriceExtremes?: boolean;
}

export interface ShadowPerformanceRefreshSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly engineVersion: string;
  readonly portfolios: number;
  readonly windows: number;
  readonly segmentsWritten: number;
  readonly segmentsUnchanged: number;
  readonly flags: TradingFlagSnapshot | null;
}

function resolveCodeVersion(env: Readonly<Record<string, string | undefined>>): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowPerformanceRefresh(
  database: PrismaClient = prisma,
  options: RunShadowPerformanceRefreshOptions = {}
): Promise<ShadowPerformanceRefreshSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? resolveCodeVersion(env);

  const gate = checkShadowPerformanceJobAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: SHADOW_PERFORMANCE_JOB_KEY,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { correlationId, asOf: asOf.toISOString() } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { blockReasonCode: gate.reasonCode });
    await writeBotLog(database, "warn", `${JOB_NAME} refused to run`, {
      botRunId: botRun.id,
      correlationId,
      reasonCode: gate.reasonCode
    });
    return {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: gate.reasonCode,
      correlationId,
      engineVersion: SHADOW_PERFORMANCE_ENGINE_VERSION,
      portfolios: 0,
      windows: 0,
      segmentsWritten: 0,
      segmentsUnchanged: 0,
      flags: gate.flags
    };
  }

  const portfolios = await database.portfolio.findMany({
    where: {
      status: { not: PortfolioStatus.ARCHIVED },
      ...(options.portfolioId === undefined ? {} : { id: options.portfolioId })
    },
    select: { id: true, key: true }
  });

  let segmentsWritten = 0;
  let segmentsUnchanged = 0;
  let failures = 0;

  for (const portfolio of portfolios) {
    for (const window of WINDOWS) {
      let summary: PersistShadowPerformanceSummary | null = null;
      try {
        summary = await refreshShadowPerformance(database, {
          portfolioId: portfolio.id,
          window,
          asOf,
          codeVersion,
          derivePriceExtremes: options.derivePriceExtremes
        });
        segmentsWritten += summary.written;
        segmentsUnchanged += summary.unchanged;
      } catch (error) {
        failures += 1;
        await writeBotLog(database, "error", `${JOB_NAME} failed for one window`, {
          botRunId: botRun.id,
          correlationId,
          portfolioId: portfolio.id,
          window,
          error: error instanceof Error ? error.message : "unknown error"
        });
        continue;
      }

      await writeBotLog(database, "info", `${JOB_NAME} refreshed a window`, {
        botRunId: botRun.id,
        correlationId,
        portfolioId: portfolio.id,
        portfolioKey: portfolio.key,
        window,
        ...summary
      });

      // One audit event per portfolio and window, keyed on the engine's own
      // input hash: re-running over unchanged data is a no-op here too.
      const idempotencyKey = `${correlationId}:${portfolio.id}:${window}:${summary.inputHash}`;
      await database.tradingAuditEvent.upsert({
        where: {
          eventKey: buildAuditEventKey({
            eventType: "SHADOW_PERFORMANCE_REFRESHED",
            aggregateType: "Portfolio",
            aggregateId: portfolio.id,
            idempotencyKey
          })
        },
        update: {},
        create: {
          eventKey: buildAuditEventKey({
            eventType: "SHADOW_PERFORMANCE_REFRESHED",
            aggregateType: "Portfolio",
            aggregateId: portfolio.id,
            idempotencyKey
          }),
          eventType: "SHADOW_PERFORMANCE_REFRESHED",
          aggregateType: "Portfolio",
          aggregateId: portfolio.id,
          actorType: TradingActorType.SYSTEM,
          actorId: JOB_NAME,
          correlationId,
          causationId: correlationId,
          idempotencyKey,
          reasonCode: "SHADOW_PERFORMANCE_REFRESHED",
          afterState: { window, ...summary } as Prisma.InputJsonObject,
          inputHash: summary.inputHash,
          outputHash: summary.outputHash,
          engineVersion: summary.engineVersion,
          codeVersion,
          occurredAt: asOf
        }
      });
    }
  }

  const status = failures > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  const summary: ShadowPerformanceRefreshSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    engineVersion: SHADOW_PERFORMANCE_ENGINE_VERSION,
    portfolios: portfolios.length,
    windows: WINDOWS.length,
    segmentsWritten,
    segmentsUnchanged,
    flags: gate.flags
  };
  await finishBotRun(database, botRun.id, status, { ...summary, failures });
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
    data: { level, service: "trading-worker", message, metadataJson: metadataJson as Prisma.InputJsonObject }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runShadowPerformanceRefresh()
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${SHADOW_PERFORMANCE_JOB_KEY} refused to run`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_PERFORMANCE_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_PERFORMANCE_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
