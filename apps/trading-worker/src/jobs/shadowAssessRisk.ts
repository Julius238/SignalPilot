/**
 * Manual shadow trading job: assess risk for open `TradeCandidate`s.
 *
 * Specification:
 *   docs/trading/06-risk-engine-specification.md (the rules themselves)
 *   docs/trading/02-shadow-trading-target-architecture.md, "Datenfluss v1" step 5–6
 *   docs/trading/04-state-machines.md (candidate transitions)
 *
 * Deliberate limits:
 *   - manual invocation only; no cron entry, no scheduler registration;
 *   - writes `RiskAssessment`, all `RiskRuleResult`s, one `TradeDecision`, the
 *     candidate transition, audit events and — on a critical finding — a
 *     `RiskEvent`;
 *   - never writes a `ShadowOrder`, `ShadowFill`, `ShadowPosition`, `ExitPlan`
 *     or `PortfolioLedgerEntry`; approval reserves nothing;
 *   - all four safety flags must hold before anything happens;
 *   - idempotent: the same snapshot yields the same assessment key, and a
 *     second run writes nothing new.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  Prisma,
  TradeDirection,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  RISK_ENGINE_VERSION,
  RISK_POLICY_HASH,
  RISK_RULE_COUNT,
  evaluateRisk
} from "@signalpilot/risk-engine";
import { config } from "dotenv";
import pino from "pino";

import { assembleRiskInput } from "../lib/riskInputAssembler.js";
import {
  RiskPersistOutcome,
  SHADOW_RISK_JOB_KEY,
  persistRiskAssessment
} from "../lib/shadowRiskPersistence.js";
import {
  checkShadowRiskJobAllowed,
  type TradingFlagSnapshot
} from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowAssessRisk";

/** Candidate states that still await a final decision (docs/trading/04). */
const ASSESSABLE_STATUSES = [
  "CREATED",
  "VALIDATING",
  "READY_FOR_RISK"
] as const;

const DEFAULT_BATCH_SIZE = 25;

export interface ShadowRiskCandidateResult {
  readonly tradeCandidateId: string;
  readonly symbol: string | null;
  readonly evaluationOutcome: string;
  readonly persistOutcome: string;
  readonly reasonCode: string;
  readonly approvedQuantity: string | null;
  readonly riskAmount: string | null;
  readonly directive: string | null;
  readonly riskAssessmentId: string | null;
}

export interface ShadowAssessRiskSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly asOf: string;
  readonly scanned: number;
  readonly approved: number;
  readonly rejected: number;
  readonly errored: number;
  readonly idempotentReplays: number;
  readonly conflicts: number;
  readonly assemblerFailures: number;
  readonly workerErrors: number;
  readonly results: readonly ShadowRiskCandidateResult[];
  readonly flags: TradingFlagSnapshot | null;
}

export interface RunShadowAssessRiskOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  readonly batchSize?: number;
  /** Restrict the run to one candidate; useful for a targeted replay. */
  readonly tradeCandidateId?: string;
}

function resolveCodeVersion(
  env: Readonly<Record<string, string | undefined>>
): string {
  const candidate = env.TRADING_CODE_VERSION ?? env.GIT_COMMIT_SHA ?? "";
  return candidate.trim() === "" ? "unversioned-local-build" : candidate.trim();
}

export async function runShadowAssessRisk(
  database: PrismaClient = prisma,
  options: RunShadowAssessRiskOptions = {}
): Promise<ShadowAssessRiskSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? resolveCodeVersion(env);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const gate = checkShadowRiskJobAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        correlationId,
        asOf: asOf.toISOString(),
        engineVersion: RISK_ENGINE_VERSION,
        policyHash: RISK_POLICY_HASH,
        ruleCount: RISK_RULE_COUNT,
        shadowOnly: true
      } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    const summary = emptySummary(
      BotRunStatus.FAILED,
      correlationId,
      asOf,
      gate.reasonCode,
      gate.flags
    );
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

  const candidates = await database.tradeCandidate.findMany({
    where: {
      ...(options.tradeCandidateId === undefined
        ? {}
        : { id: options.tradeCandidateId }),
      status: { in: [...ASSESSABLE_STATUSES] },
      decision: { is: null },
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

  await writeBotLog(database, "info", `${JOB_NAME} started`, {
    botRunId: botRun.id,
    correlationId,
    candidateCount: candidates.length,
    flags: gate.flags
  });

  const capability = {
    buildCapability: gate.flags.buildCapability,
    tradingMode: gate.flags.tradingMode,
    enableLiveTrading: gate.flags.enableLiveTrading,
    shadowMasterFlagEnabled: gate.flags.shadowEnabled,
    riskJobEnabled: gate.flags.riskV1Enabled,
    strategyLongV1Enabled: gate.flags.strategyLongV1Enabled,
    strategyShortV1Enabled: gate.flags.strategyShortV1Enabled,
    shadowShortEnabled: gate.flags.shadowShortEnabled,
    // This build contains no exchange, margin or futures execution adapter.
    exchangeExecutionEnabled: false,
    marginTradingEnabled: false,
    futuresTradingEnabled: false
  };

  const results: ShadowRiskCandidateResult[] = [];
  let approved = 0;
  let rejected = 0;
  let errored = 0;
  let idempotentReplays = 0;
  let conflicts = 0;
  let assemblerFailures = 0;
  let workerErrors = 0;

  for (const { id } of candidates) {
    try {
      const assembled = await assembleRiskInput(database, {
        tradeCandidateId: id,
        asOf,
        codeVersion,
        capability
      });
      if (!assembled.ok) {
        assemblerFailures += 1;
        results.push({
          tradeCandidateId: id,
          symbol: null,
          evaluationOutcome: "ASSEMBLER_FAILURE",
          persistOutcome: "NONE",
          reasonCode: assembled.reasonCode,
          approvedQuantity: null,
          riskAmount: null,
          directive: null,
          riskAssessmentId: null
        });
        await writeBotLog(
          database,
          "warn",
          `${JOB_NAME} could not assemble a risk snapshot`,
          {
            botRunId: botRun.id,
            correlationId,
            tradeCandidateId: id,
            reasonCode: assembled.reasonCode,
            message: assembled.message
          }
        );
        continue;
      }

      const evaluation = evaluateRisk(assembled.snapshot);

      // An ERROR without an active risk limit set has no foreign key to hang a
      // RiskAssessment on. It is recorded as a risk event instead of guessing.
      if (evaluation.assessment.riskLimitSetId === null) {
        errored += 1;
        results.push({
          tradeCandidateId: id,
          symbol: assembled.snapshot.candidate.symbol,
          evaluationOutcome: evaluation.outcome,
          persistOutcome: "NOT_PERSISTABLE",
          reasonCode: evaluation.primaryReasonCode,
          approvedQuantity: null,
          riskAmount: null,
          directive: evaluation.directive,
          riskAssessmentId: null
        });
        await writeBotLog(
          database,
          "error",
          `${JOB_NAME} has no active RiskLimitSet`,
          {
            botRunId: botRun.id,
            correlationId,
            tradeCandidateId: id,
            reasonCode: evaluation.primaryReasonCode,
            hint: "Run pnpm worker:shadow-bootstrap first."
          }
        );
        continue;
      }

      const persisted = await persistRiskAssessment(database, {
        evaluation,
        snapshot: assembled.snapshot,
        correlationId,
        codeVersion,
        occurredAt: asOf
      });

      if (persisted.outcome === RiskPersistOutcome.CONFLICT) conflicts += 1;
      else if (persisted.outcome === RiskPersistOutcome.IDEMPOTENT_REPLAY)
        idempotentReplays += 1;
      else if (evaluation.outcome === "APPROVED") approved += 1;
      else if (evaluation.outcome === "REJECTED") rejected += 1;
      else errored += 1;

      results.push({
        tradeCandidateId: id,
        symbol: assembled.snapshot.candidate.symbol,
        evaluationOutcome: evaluation.outcome,
        persistOutcome: persisted.outcome,
        reasonCode: persisted.reasonCode,
        approvedQuantity: persisted.approvedQuantity,
        riskAmount: persisted.riskAmount,
        directive: evaluation.directive,
        riskAssessmentId: persisted.riskAssessmentId
      });

      await writeBotLog(
        database,
        persisted.outcome === RiskPersistOutcome.CONFLICT ||
          evaluation.outcome === "ERROR"
          ? "error"
          : "info",
        `${JOB_NAME} assessed ${assembled.snapshot.candidate.symbol}`,
        {
          botRunId: botRun.id,
          correlationId,
          tradeCandidateId: id,
          evaluationOutcome: evaluation.outcome,
          persistOutcome: persisted.outcome,
          directive: evaluation.directive,
          reasonCode: persisted.reasonCode,
          approvedQuantity: persisted.approvedQuantity,
          riskAmount: persisted.riskAmount,
          netRewardRisk: evaluation.assessment.sizing.netRewardRisk,
          inputHash: persisted.inputHash,
          outputHash: persisted.outputHash,
          failedRules: evaluation.ruleResults
            .filter((rule) => rule.outcome !== "PASS")
            .map((rule) => `${rule.ruleCode}:${rule.reasonCode}`)
        }
      );
    } catch (error) {
      workerErrors += 1;
      const message =
        error instanceof Error ? error.message : "Unknown risk job error";
      results.push({
        tradeCandidateId: id,
        symbol: null,
        evaluationOutcome: "ERROR",
        persistOutcome: "NONE",
        reasonCode: "WORKER_ERROR",
        approvedQuantity: null,
        riskAmount: null,
        directive: null,
        riskAssessmentId: null
      });
      await writeBotLog(
        database,
        "error",
        `${JOB_NAME} failed for a candidate`,
        {
          botRunId: botRun.id,
          correlationId,
          tradeCandidateId: id,
          error: message
        }
      );
    }
  }

  const status =
    workerErrors > 0 || conflicts > 0 || errored > 0
      ? BotRunStatus.FAILED
      : BotRunStatus.SUCCESS;
  const summary: ShadowAssessRiskSummary = {
    status,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    asOf: asOf.toISOString(),
    scanned: candidates.length,
    approved,
    rejected,
    errored,
    idempotentReplays,
    conflicts,
    assemblerFailures,
    workerErrors,
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

function emptySummary(
  status: BotRunStatus,
  correlationId: string,
  asOf: Date,
  blockReasonCode: string | null,
  flags: TradingFlagSnapshot | null
): ShadowAssessRiskSummary {
  return {
    status,
    blocked: blockReasonCode !== null,
    blockReasonCode,
    correlationId,
    asOf: asOf.toISOString(),
    scanned: 0,
    approved: 0,
    rejected: 0,
    errored: 0,
    idempotentReplays: 0,
    conflicts: 0,
    assemblerFailures: 0,
    workerErrors: 0,
    results: [],
    flags
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
  runShadowAssessRisk()
    .then((summary) => {
      if (summary.blocked) {
        logger.error(
          { reasonCode: summary.blockReasonCode, flags: summary.flags },
          `${SHADOW_RISK_JOB_KEY} refused to run: safety configuration is not shadow-enabled`
        );
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_RISK_JOB_KEY} completed`);
      if (summary.status !== BotRunStatus.SUCCESS) process.exitCode = 1;
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_RISK_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
