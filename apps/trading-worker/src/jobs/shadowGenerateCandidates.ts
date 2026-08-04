/**
 * Manual shadow trading job: generate `TradeCandidate` drafts for BTCUSDT and
 * ETHUSDT from persisted SignalPilot data.
 *
 * Specification:
 *   docs/trading/05-strategy-v1-specification.md (the strategy itself)
 *   docs/trading/02-shadow-trading-target-architecture.md, "Datenfluss v1" 1–4
 *   docs/trading/decisions/0006-fail-closed-session-and-kill-switch.md
 *
 * Deliberate limits of this job:
 *   - it runs only on an explicit manual invocation; there is no cron entry and
 *     no scheduler registration;
 *   - it creates candidates, evidence, audit events and — on a hash conflict —
 *     one critical risk event. It never creates a risk assessment, order, fill,
 *     position or ledger entry;
 *   - all four safety flags must be set before it does anything at all;
 *   - it is idempotent: the same snapshot produces the same candidate key and
 *     the same audit key, so a second run writes nothing new.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  evaluateStrategy
} from "@signalpilot/strategy-engine";
import { config } from "dotenv";
import pino from "pino";

import { assembleStrategyInput } from "../lib/strategyInputAssembler.js";
import {
  PersistOutcome,
  SHADOW_CANDIDATE_JOB_KEY,
  persistStrategyEvaluation
} from "../lib/shadowCandidatePersistence.js";
import {
  checkShadowStrategyJobAllowed,
  type TradingFlagSnapshot
} from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowGenerateCandidates";

/** v1 processes exactly the two explicitly approved symbols. */
export const SHADOW_STRATEGY_SYMBOLS: readonly string[] =
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.allowedSymbols;

/**
 * Values a `StrategyVersion` row must carry for this job to accept it. They are
 * exported so an operator (and a test) can verify a seeded version instead of
 * guessing (docs/trading/03, StrategyVersion immutability).
 */
export const REQUIRED_STRATEGY_VERSION = Object.freeze({
  strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
  engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
});

export const REQUIRED_DIRECTIONAL_STRATEGY_VERSIONS = Object.freeze({
  LONG: Object.freeze({
    strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH
  }),
  SHORT: Object.freeze({
    strategyKey: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH
  })
});

export interface ShadowSymbolResult {
  readonly symbol: string;
  readonly strategyKey: string;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly candidateKey: string | null;
  readonly tradeCandidateId: string | null;
  readonly inputHash: string | null;
}

export interface ShadowGenerateCandidatesSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly asOf: string;
  readonly symbols: readonly string[];
  readonly created: number;
  readonly idempotentReplays: number;
  readonly conflicts: number;
  readonly rejections: number;
  readonly assemblerFailures: number;
  readonly errors: number;
  readonly results: readonly ShadowSymbolResult[];
  readonly flags: TradingFlagSnapshot | null;
}

export interface RunShadowGenerateCandidatesOptions {
  readonly asOf?: Date;
  readonly symbols?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly codeVersion?: string;
  readonly correlationId?: string;
}

function resolveCodeVersion(
  env: Readonly<Record<string, string | undefined>>
): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowGenerateCandidates(
  database: PrismaClient = prisma,
  options: RunShadowGenerateCandidatesOptions = {}
): Promise<ShadowGenerateCandidatesSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const symbols = options.symbols ?? SHADOW_STRATEGY_SYMBOLS;
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? resolveCodeVersion(env);

  const gate = checkShadowStrategyJobAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        correlationId,
        asOf: asOf.toISOString(),
        symbols: [...symbols],
        strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
        specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
        shadowOnly: true
      } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    const summary: ShadowGenerateCandidatesSummary = {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: gate.reasonCode,
      correlationId,
      asOf: asOf.toISOString(),
      symbols: [...symbols],
      created: 0,
      idempotentReplays: 0,
      conflicts: 0,
      rejections: 0,
      assemblerFailures: 0,
      errors: 0,
      results: [],
      flags: gate.flags
    };
    await writeBotLog(
      database,
      "warn",
      `${JOB_NAME} blocked by safety configuration`,
      {
        botRunId: botRun.id,
        reasonCode: gate.reasonCode,
        message: gate.message,
        flags: gate.flags
      }
    );
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, {
      ...summary,
      message: gate.message
    });
    return summary;
  }

  await writeBotLog(database, "info", `${JOB_NAME} started`, {
    botRunId: botRun.id,
    correlationId,
    symbols: [...symbols],
    flags: gate.flags
  });

  const results: ShadowSymbolResult[] = [];
  let created = 0;
  let idempotentReplays = 0;
  let conflicts = 0;
  let rejections = 0;
  let assemblerFailures = 0;
  let errors = 0;

  const strategyKeys = [
    gate.flags.strategyLongV1Enabled
      ? CRYPTO_MTF_BREAKOUT_LONG_V1_KEY
      : CRYPTO_MTF_BREAKOUT_V1_KEY,
    ...(gate.flags.shadowShortEnabled && gate.flags.strategyShortV1Enabled
      ? [CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY]
      : [])
  ];

  for (const symbol of symbols) {
    for (const strategyKey of strategyKeys) {
      try {
        const assembled = await assembleStrategyInput(database, {
          symbol,
          asOf,
          codeVersion,
          strategyKey
        });
        if (!assembled.ok) {
          assemblerFailures += 1;
          results.push({
            symbol,
            strategyKey,
            outcome: "ASSEMBLER_FAILURE",
            reasonCode: assembled.reasonCode,
            candidateKey: null,
            tradeCandidateId: null,
            inputHash: null
          });
          await writeBotLog(
            database,
            "warn",
            `${JOB_NAME} could not assemble a snapshot`,
            {
              botRunId: botRun.id,
              correlationId,
              symbol,
              reasonCode: assembled.reasonCode,
              message: assembled.message
            }
          );
          continue;
        }

        const evaluation = evaluateStrategy(assembled.snapshot);
        const persisted = await persistStrategyEvaluation(database, {
          evaluation,
          snapshot: assembled.snapshot,
          correlationId,
          codeVersion,
          occurredAt: asOf
        });

        if (persisted.outcome === PersistOutcome.CREATED) created += 1;
        else if (persisted.outcome === PersistOutcome.IDEMPOTENT_REPLAY)
          idempotentReplays += 1;
        else if (persisted.outcome === PersistOutcome.CONFLICT) conflicts += 1;
        else rejections += 1;

        results.push({
          symbol,
          strategyKey,
          outcome: persisted.outcome,
          reasonCode: persisted.reasonCode,
          candidateKey: persisted.candidateKey,
          tradeCandidateId: persisted.tradeCandidateId,
          inputHash: persisted.inputHash
        });

        await writeBotLog(
          database,
          persisted.outcome === PersistOutcome.CONFLICT ? "error" : "info",
          `${JOB_NAME} evaluated ${symbol}`,
          {
            botRunId: botRun.id,
            correlationId,
            symbol,
            evaluationOutcome: evaluation.outcome,
            persistOutcome: persisted.outcome,
            reasonCode: persisted.reasonCode,
            reasonCodes: [...evaluation.reasonCodes],
            inputHash: persisted.inputHash,
            outputHash: persisted.outputHash,
            candidateKey: persisted.candidateKey
          }
        );
      } catch (error) {
        errors += 1;
        const message =
          error instanceof Error ? error.message : "Unknown strategy job error";
        results.push({
          symbol,
          strategyKey,
          outcome: "ERROR",
          reasonCode: "WORKER_ERROR",
          candidateKey: null,
          tradeCandidateId: null,
          inputHash: null
        });
        await writeBotLog(
          database,
          "error",
          `${JOB_NAME} failed for ${symbol}`,
          {
            botRunId: botRun.id,
            correlationId,
            symbol,
            strategyKey,
            error: message
          }
        );
      }
    }
  }

  // A hash conflict is a critical risk event, so the run is not a success.
  const status =
    errors > 0 || conflicts > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  const summary: ShadowGenerateCandidatesSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    asOf: asOf.toISOString(),
    symbols: [...symbols],
    created,
    idempotentReplays,
    conflicts,
    rejections,
    assemblerFailures,
    errors,
    results,
    flags: gate.flags
  };

  await finishBotRun(database, botRun.id, status, { ...summary });
  await writeBotLog(
    database,
    status === BotRunStatus.SUCCESS ? "info" : "error",
    `${JOB_NAME} finished`,
    {
      botRunId: botRun.id,
      ...summary
    }
  );

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
  runShadowGenerateCandidates()
    .then((summary) => {
      if (summary.blocked) {
        logger.error(
          { reasonCode: summary.blockReasonCode, flags: summary.flags },
          `${SHADOW_CANDIDATE_JOB_KEY} refused to run: safety configuration is not shadow-enabled`
        );
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_CANDIDATE_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_CANDIDATE_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
