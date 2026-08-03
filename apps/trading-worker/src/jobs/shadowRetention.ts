/**
 * Manual shadow trading job: technical-data retention (P8, "8. Retention").
 *
 * `pnpm trading-worker:shadow-retention`            → dry run, deletes nothing
 * `pnpm trading-worker:shadow-retention -- --apply` → deletes
 *
 * Two independent conditions must both hold before a single row is removed:
 * `TRADING_RETENTION_ENABLED=true` (on top of the shadow-only base gate) and
 * an explicit `--apply`. Neither one alone is enough.
 *
 * Only `BotRun`, `BotLog` and `TradingAlertOutboxAttempt` are reachable from
 * `runTradingRetention`'s allowlist; no business trading table can be touched
 * from this job at all.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, Prisma, TradingActorType, prisma, type PrismaClient } from "@signalpilot/database";
import { buildAuditEventKey } from "@signalpilot/trading-domain";
import { config } from "dotenv";
import pino from "pino";

import { runTradingRetention, type RetentionPolicy, type RetentionResult } from "../lib/tradingRetention.js";
import { checkTradingRetentionAllowed, type TradingFlagSnapshot } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowRetention";
export const SHADOW_RETENTION_JOB_KEY = "trading:retention";

export interface RunShadowRetentionOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly policy?: RetentionPolicy;
  /** Defaults to false — a run without this deletes nothing. */
  readonly apply?: boolean;
}

export interface ShadowRetentionSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly result: RetentionResult | null;
  readonly flags: TradingFlagSnapshot | null;
}

export async function runShadowRetention(
  database: PrismaClient = prisma,
  options: RunShadowRetentionOptions = {}
): Promise<ShadowRetentionSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const apply = options.apply === true;

  const gate = checkTradingRetentionAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: SHADOW_RETENTION_JOB_KEY,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { correlationId, asOf: asOf.toISOString(), apply } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { blockReasonCode: gate.reasonCode });
    return {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: gate.reasonCode,
      correlationId,
      result: null,
      flags: gate.flags
    };
  }

  const result = await runTradingRetention(database, { asOf, policy: options.policy, apply });

  await database.botLog.create({
    data: {
      level: "info",
      service: "trading-worker",
      message: apply ? `${JOB_NAME} applied retention` : `${JOB_NAME} dry run`,
      metadataJson: { botRunId: botRun.id, correlationId, ...result } as unknown as Prisma.InputJsonObject
    }
  });

  // Only an applied run is an auditable state change; a dry run changed
  // nothing and does not belong in the trading audit trail.
  if (apply) {
    const idempotencyKey = `${correlationId}:retention`;
    const eventKey = buildAuditEventKey({
      eventType: "TRADING_RETENTION_APPLIED",
      aggregateType: "TradingRetention",
      aggregateId: asOf.toISOString().slice(0, 10),
      idempotencyKey
    });
    await database.tradingAuditEvent.upsert({
      where: { eventKey },
      update: {},
      create: {
        eventKey,
        eventType: "TRADING_RETENTION_APPLIED",
        aggregateType: "TradingRetention",
        aggregateId: asOf.toISOString().slice(0, 10),
        actorType: TradingActorType.SYSTEM,
        actorId: JOB_NAME,
        correlationId,
        causationId: correlationId,
        idempotencyKey,
        reasonCode: "TRADING_RETENTION_APPLIED",
        afterState: result as unknown as Prisma.InputJsonObject,
        occurredAt: asOf
      }
    });
  }

  await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, { ...result, correlationId });
  return {
    status: BotRunStatus.SUCCESS,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    result,
    flags: gate.flags
  };
}

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  status: BotRunStatus,
  metadataJson: Record<string, unknown>
): Promise<void> {
  await database.botRun.update({
    where: { id: botRunId },
    data: { status, finishedAt: new Date(), metadataJson: metadataJson as unknown as Prisma.InputJsonObject }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const apply = process.argv.includes("--apply");
  runShadowRetention(prisma, { apply })
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${SHADOW_RETENTION_JOB_KEY} refused to run`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, apply ? `${SHADOW_RETENTION_JOB_KEY} applied` : `${SHADOW_RETENTION_JOB_KEY} dry run`);
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_RETENTION_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
