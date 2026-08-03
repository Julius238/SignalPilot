/**
 * Manual shadow trading job: collect and deliver trading alerts (P8, "4.
 * Alert-Outbox").
 *
 * `pnpm trading-worker:shadow-alert-outbox`
 *
 * Two independently gated phases in one job:
 *
 *   collect  — `TRADING_ALERT_OUTBOX_ENABLED`: derive outbox entries from
 *              persisted state. Writes only `TradingAlertOutbox`.
 *   dispatch — `TRADING_ALERT_DELIVERY_ENABLED`: hand due entries to the
 *              existing n8n webhook. Writes only outbox status and attempts.
 *
 * Recording without delivering is the intended intermediate state while the
 * alert catalogue is being validated; that is why the two flags are separate.
 *
 * The job touches no order, position, fill, ledger entry, risk decision or
 * session — a bug here cannot alter trading, and a delivery outage cannot
 * delay a risk-reducing exit, because nothing in the trading path awaits it.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

import { BotRunStatus, Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import { collectTradingAlerts, type CollectTradingAlertsSummary } from "../lib/alertCollector.js";
import {
  createN8nTransport,
  dispatchPendingAlerts,
  type AlertTransport,
  type DispatchPendingAlertsSummary
} from "../lib/alertDispatcher.js";
import {
  checkTradingAlertDeliveryAllowed,
  checkTradingAlertOutboxAllowed,
  type TradingFlagSnapshot
} from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowAlertOutbox";
export const SHADOW_ALERT_OUTBOX_JOB_KEY = "trading:alert-outbox";

const EMPTY_COLLECT: CollectTradingAlertsSummary = {
  inspected: 0,
  enqueued: 0,
  deduplicated: 0,
  byEventType: {}
};
const EMPTY_DISPATCH: DispatchPendingAlertsSummary = { claimed: 0, sent: 0, failed: 0, deadLettered: 0 };

export interface RunShadowAlertOutboxOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly ownerId?: string;
  /** Injectable so a test never reaches the network. */
  readonly transport?: AlertTransport;
  readonly batchSize?: number;
}

export interface ShadowAlertOutboxSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly collect: CollectTradingAlertsSummary;
  readonly dispatch: DispatchPendingAlertsSummary;
  readonly deliveryEnabled: boolean;
  readonly deliveryBlockReasonCode: string | null;
  readonly flags: TradingFlagSnapshot | null;
}

export async function runShadowAlertOutbox(
  database: PrismaClient = prisma,
  options: RunShadowAlertOutboxOptions = {}
): Promise<ShadowAlertOutboxSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const ownerId = options.ownerId ?? `trading-worker:${hostname()}:${process.pid}`;

  const outboxGate = checkTradingAlertOutboxAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: SHADOW_ALERT_OUTBOX_JOB_KEY,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: { correlationId, asOf: asOf.toISOString() } as Prisma.InputJsonObject
    }
  });

  if (!outboxGate.allowed) {
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { blockReasonCode: outboxGate.reasonCode });
    await writeBotLog(database, "warn", `${JOB_NAME} refused to run`, {
      botRunId: botRun.id,
      correlationId,
      reasonCode: outboxGate.reasonCode
    });
    return {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: outboxGate.reasonCode,
      correlationId,
      collect: EMPTY_COLLECT,
      dispatch: EMPTY_DISPATCH,
      deliveryEnabled: false,
      deliveryBlockReasonCode: outboxGate.reasonCode,
      flags: outboxGate.flags
    };
  }

  let collect = EMPTY_COLLECT;
  let dispatch = EMPTY_DISPATCH;
  let failed = false;

  try {
    collect = await collectTradingAlerts(database, { asOf });
  } catch (error) {
    failed = true;
    await writeBotLog(database, "error", `${JOB_NAME} failed while collecting alerts`, {
      botRunId: botRun.id,
      correlationId,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }

  const deliveryGate = checkTradingAlertDeliveryAllowed(env);
  if (deliveryGate.allowed) {
    try {
      dispatch = await dispatchPendingAlerts(database, {
        asOf,
        ownerId,
        transport: options.transport ?? createN8nTransport(database),
        batchSize: options.batchSize
      });
    } catch (error) {
      // A delivery failure is logged, never rethrown: alerting must not be
      // able to fail the operations job that also records new alerts.
      failed = true;
      await writeBotLog(database, "error", `${JOB_NAME} failed while dispatching alerts`, {
        botRunId: botRun.id,
        correlationId,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  const status = failed ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  const summary: ShadowAlertOutboxSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    collect,
    dispatch,
    deliveryEnabled: deliveryGate.allowed,
    deliveryBlockReasonCode: deliveryGate.allowed ? null : deliveryGate.reasonCode,
    flags: outboxGate.flags
  };

  await writeBotLog(database, failed ? "error" : "info", `${JOB_NAME} completed`, {
    botRunId: botRun.id,
    correlationId,
    ...collect,
    ...dispatch,
    deliveryEnabled: deliveryGate.allowed
  });
  await finishBotRun(database, botRun.id, status, { ...collect, ...dispatch, correlationId });
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
  runShadowAlertOutbox()
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${SHADOW_ALERT_OUTBOX_JOB_KEY} refused to run`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_ALERT_OUTBOX_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_ALERT_OUTBOX_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
