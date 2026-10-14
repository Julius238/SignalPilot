/**
 * Hourly arena evaluation (`trading:arena-evaluate`): fitness, evidence gate,
 * survival floor, hard stops, ranking and recommendation for every
 * participant with a running forward test (docs/trading/17-arena.md).
 *
 * Writes only arena evaluation rows. It never changes a participant's status,
 * a session, an assignment, a risk limit or any capital: Arena V1 recommends,
 * an operator decides.
 *
 *   pnpm --filter @signalpilot/trading-worker exec tsx src/jobs/arenaEvaluate.ts
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { evaluateArenaCohort, type ArenaEvaluationSummaryEntry } from "../lib/arena.js";
import { checkArenaJobAllowed } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "arenaEvaluate";

export interface RunArenaEvaluateOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Evaluate only this cohort; every cohort (each with its own policy) by default. */
  readonly cohortKey?: string;
  readonly correlationId?: string;
}

export interface ArenaEvaluateSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly entries: readonly ArenaEvaluationSummaryEntry[];
}

export async function runArenaEvaluate(
  database: PrismaClient = prisma,
  options: RunArenaEvaluateOptions = {}
): Promise<ArenaEvaluateSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = (env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "").trim() || "unversioned-local-build";

  const gate = checkArenaJobAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { correlationId, asOf: asOf.toISOString(), cohortKey: options.cohortKey ?? "ALL" } as Prisma.InputJsonObject
    }
  });
  const finish = async (status: BotRunStatus, metadata: Record<string, unknown>) => {
    await database.botRun.update({
      where: { id: botRun.id },
      data: { status, finishedAt: new Date(), metadataJson: { correlationId, ...metadata } as Prisma.InputJsonObject }
    });
  };

  if (!gate.allowed) {
    await finish(BotRunStatus.FAILED, { blockReasonCode: gate.reasonCode, message: gate.message });
    return { status: BotRunStatus.FAILED, blocked: true, blockReasonCode: gate.reasonCode, correlationId, entries: [] };
  }

  const cohortKeys =
    options.cohortKey === undefined
      ? (await database.arenaCohort.findMany({ orderBy: { createdAt: "asc" }, select: { key: true } })).map((cohort) => cohort.key)
      : [options.cohortKey];
  const entries: ArenaEvaluationSummaryEntry[] = [];
  for (const cohortKey of cohortKeys) {
    const result = await evaluateArenaCohort(database, { cohortKey, asOf, codeVersion });
    if (!result.ok) {
      await finish(BotRunStatus.FAILED, { blockReasonCode: result.reasonCode, message: result.message, cohortKey });
      return { status: BotRunStatus.FAILED, blocked: true, blockReasonCode: result.reasonCode, correlationId, entries };
    }
    entries.push(...result.result.entries);
  }
  // One participant that could not be valued (e.g. a missing candle) is
  // reported, not a failure of the job; only a run where every evaluable
  // participant failed is.
  const failed = entries.filter((entry) => entry.outcome === "FAILED");
  const evaluable = entries.filter((entry) => entry.outcome !== "SKIPPED");
  const status = failed.length > 0 && failed.length === evaluable.length ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  if (failed.length > 0) {
    await database.botLog.create({
      data: {
        level: "warn",
        service: "trading-worker",
        message: `${JOB_NAME} could not evaluate ${failed.length} participant(s)`,
        metadataJson: { botRunId: botRun.id, correlationId, failed } as unknown as Prisma.InputJsonObject
      }
    });
  }
  await finish(status, { cohortKeys, entries });
  return { status, blocked: false, blockReasonCode: null, correlationId, entries };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runArenaEvaluate()
    .then((summary) => {
      logger.info(summary, `${JOB_NAME} finished`);
      if (summary.blocked) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${JOB_NAME} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
