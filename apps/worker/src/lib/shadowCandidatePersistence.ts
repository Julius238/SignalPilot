/**
 * Idempotent persistence of a strategy evaluation.
 *
 * Specification:
 *   docs/trading/02-shadow-trading-target-architecture.md, "Transaktionsgrenzen" 1
 *     — candidate, all evidence and the candidate audit are one transaction;
 *   docs/trading/02, "Idempotenz und Concurrency"
 *     — a retry with the same key returns the stored result; the same key with a
 *       different input hash is a critical risk event;
 *   docs/trading/03-domain-model.md, TradeCandidate / TradeCandidateEvidence.
 *
 * This module writes `TradeCandidate`, `TradeCandidateEvidence`,
 * `TradingAuditEvent` and — only on a hash conflict — `RiskEvent`. It creates no
 * `RiskAssessment`, `ShadowOrder`, `ShadowFill`, `ShadowPosition` and no ledger
 * entry: those belong to later work packages.
 *
 * Structured refusals are persisted as append-only `TradingAuditEvent` rows.
 * A `TradeDecision` is deliberately not used for them: its schema requires a
 * `tradeCandidateId` plus reference/stop/take-profit prices, which a refused
 * evaluation does not have, and inventing them would create a fictitious
 * candidate (docs/trading/03, TradeCandidate field list).
 */

import {
  Prisma,
  RiskEventType,
  RiskSeverity,
  TradeCandidateStatus,
  TradeDirection,
  TradeEntryType,
  TradeEvidenceType,
  TradingActorType,
  type PrismaClient
} from "@signalpilot/database";
import {
  ReplayVerdict,
  TradingReasonCode,
  buildAuditEventKey,
  buildRiskEventKey,
  classifyReplay
} from "@signalpilot/trading-domain";
import {
  StrategyEvaluationOutcome,
  StrategyReasonCode,
  type StrategyEvaluationResultV1,
  type StrategyInputSnapshotV1,
  type TradeCandidateDraftV1
} from "@signalpilot/strategy-engine";

export const SHADOW_CANDIDATE_JOB_KEY = "trading:shadow-generate-candidates";

export const ShadowCandidateAuditEvent = {
  CANDIDATE_CREATED: "STRATEGY_CANDIDATE_CREATED",
  EVALUATION_REJECTED: "STRATEGY_EVALUATION_REJECTED",
  INPUT_HASH_CONFLICT: "STRATEGY_CANDIDATE_INPUT_HASH_CONFLICT"
} as const;

export const PersistOutcome = {
  CREATED: "CREATED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  CONFLICT: "CONFLICT",
  REJECTION_RECORDED: "REJECTION_RECORDED"
} as const;
export type PersistOutcome = (typeof PersistOutcome)[keyof typeof PersistOutcome];

export interface PersistStrategyEvaluationInput {
  readonly evaluation: StrategyEvaluationResultV1;
  readonly snapshot: StrategyInputSnapshotV1;
  readonly correlationId: string;
  readonly codeVersion: string;
  readonly occurredAt: Date;
}

export interface PersistStrategyEvaluationResult {
  readonly outcome: PersistOutcome;
  readonly candidateKey: string | null;
  readonly tradeCandidateId: string | null;
  readonly reasonCode: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

type Json = Prisma.InputJsonValue;

const asJson = (value: unknown): Json => value as Json;

export async function persistStrategyEvaluation(
  database: PrismaClient,
  input: PersistStrategyEvaluationInput
): Promise<PersistStrategyEvaluationResult> {
  return input.evaluation.outcome === StrategyEvaluationOutcome.CANDIDATE
    ? persistCandidate(database, input, input.evaluation.candidate)
    : persistRejection(database, input);
}

// ───────────────────────────────────────────────────────────────────────────
// Candidate
// ───────────────────────────────────────────────────────────────────────────

async function persistCandidate(
  database: PrismaClient,
  input: PersistStrategyEvaluationInput,
  candidate: TradeCandidateDraftV1
): Promise<PersistStrategyEvaluationResult> {
  const existing = await database.tradeCandidate.findUnique({
    where: { candidateKey: candidate.candidateKey },
    select: { id: true, inputHash: true }
  });

  const verdict = classifyReplay(existing?.inputHash ?? null, candidate.inputHash);

  if (verdict === ReplayVerdict.IDEMPOTENT_REPLAY) {
    return {
      outcome: PersistOutcome.IDEMPOTENT_REPLAY,
      candidateKey: candidate.candidateKey,
      tradeCandidateId: existing?.id ?? null,
      reasonCode: StrategyReasonCode.CANDIDATE_IDEMPOTENT_REPLAY,
      inputHash: candidate.inputHash,
      outputHash: candidate.outputHash
    };
  }

  if (verdict === ReplayVerdict.CONFLICT) {
    await recordHashConflict(database, input, candidate, existing?.id ?? null, existing?.inputHash ?? null);
    return {
      outcome: PersistOutcome.CONFLICT,
      candidateKey: candidate.candidateKey,
      tradeCandidateId: existing?.id ?? null,
      reasonCode: StrategyReasonCode.CANDIDATE_INPUT_HASH_CONFLICT,
      inputHash: candidate.inputHash,
      outputHash: candidate.outputHash
    };
  }

  // Candidate + evidence + audit commit together (docs/trading/02, transaction 1).
  const createdId = await database.$transaction(async (tx) => {
    const created = await tx.tradeCandidate.create({
      data: {
        candidateKey: candidate.candidateKey,
        strategyAssignmentId: candidate.strategyAssignmentId,
        strategyVersionId: candidate.strategyVersionId,
        portfolioId: candidate.portfolioId,
        assetId: candidate.assetId,
        anchorCandleId: candidate.anchorCandleId,
        anchorSignalId: candidate.anchorSignalId,
        direction: TradeDirection.LONG,
        entryType: TradeEntryType.MARKET,
        status: TradeCandidateStatus.CREATED,
        referenceEntryPrice: candidate.referenceEntryPrice,
        stopPrice: candidate.stopPrice,
        takeProfitPrice: candidate.takeProfitPrice,
        minimumRewardRisk: candidate.minimumRewardRisk,
        // Typed plan fields (migration 20260802120000). The risk engine reads
        // these columns instead of the audit payload.
        stopDistance: candidate.stopDistance,
        stopDistancePct: candidate.stopDistancePct,
        plannedRewardRisk: candidate.plannedRewardRisk,
        plannedEntryMinimum: candidate.plannedEntryMinimum,
        plannedEntryMaximum: candidate.plannedEntryMaximum,
        maximumEntryGapDistance: candidate.maximumEntryGapDistance,
        validFrom: new Date(candidate.validFrom),
        earliestFillAt: new Date(candidate.earliestFillAt),
        maxHoldHours: candidate.maxHoldHours,
        strategyEngineVersion: candidate.engineVersion,
        strategySpecificationHash: candidate.specificationHash,
        strategyOutputHash: candidate.outputHash,
        dataAsOf: new Date(candidate.dataAsOf),
        decisionTime: new Date(candidate.decisionTime),
        expiresAt: new Date(candidate.expiresAt),
        inputSnapshotJson: asJson(input.snapshot),
        inputHash: candidate.inputHash,
        strategyReasonCodes: asJson([...candidate.reasonCodes])
      },
      select: { id: true }
    });

    await tx.tradeCandidateEvidence.createMany({
      data: candidate.evidence.map((item) => ({
        tradeCandidateId: created.id,
        type: item.type as TradeEvidenceType,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceKey: item.sourceKey,
        observedAt: new Date(item.observedAt),
        capturedAt: new Date(item.capturedAt),
        required: item.required,
        payloadJson: asJson(item.payload),
        payloadHash: item.payloadHash
      }))
    });

    await tx.tradingAuditEvent.create({
      data: auditData({
        eventType: ShadowCandidateAuditEvent.CANDIDATE_CREATED,
        aggregateType: "TradeCandidate",
        aggregateId: created.id,
        reasonCode: StrategyReasonCode.CANDIDATE_CREATED,
        input,
        afterState: asJson(candidate),
        metadata: asJson({
          jobKey: SHADOW_CANDIDATE_JOB_KEY,
          symbol: candidate.symbol,
          anchorCandleId: candidate.anchorCandleId,
          evidenceCount: candidate.evidence.length,
          checks: input.evaluation.checks
        })
      })
    });

    return created.id;
  });

  return {
    outcome: PersistOutcome.CREATED,
    candidateKey: candidate.candidateKey,
    tradeCandidateId: createdId,
    reasonCode: StrategyReasonCode.CANDIDATE_CREATED,
    inputHash: candidate.inputHash,
    outputHash: candidate.outputHash
  };
}

/**
 * "Ein gleicher Key mit anderem Hash ist ein Critical Risk Event"
 * (docs/trading/03, TradeCandidate). The stored candidate is never overwritten.
 */
async function recordHashConflict(
  database: PrismaClient,
  input: PersistStrategyEvaluationInput,
  candidate: TradeCandidateDraftV1,
  existingCandidateId: string | null,
  existingInputHash: string | null
): Promise<void> {
  const payload = asJson({
    jobKey: SHADOW_CANDIDATE_JOB_KEY,
    candidateKey: candidate.candidateKey,
    existingInputHash,
    incomingInputHash: candidate.inputHash,
    symbol: candidate.symbol,
    anchorCandleId: candidate.anchorCandleId
  });

  const riskEventKey = buildRiskEventKey({
    type: RiskEventType.IDEMPOTENCY_OR_VERSION_CONFLICT,
    aggregateType: "TradeCandidate",
    aggregateId: existingCandidateId ?? candidate.anchorCandleId,
    inputHash: candidate.inputHash
  });

  await database.$transaction(async (tx) => {
    await tx.riskEvent.upsert({
      where: { eventKey: riskEventKey },
      update: {},
      create: {
        eventKey: riskEventKey,
        type: RiskEventType.IDEMPOTENCY_OR_VERSION_CONFLICT,
        severity: RiskSeverity.CRITICAL,
        reasonCode: TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
        portfolioId: candidate.portfolioId,
        tradeCandidateId: existingCandidateId,
        payloadJson: payload,
        inputHash: candidate.inputHash
      }
    });

    const data = auditData({
      eventType: ShadowCandidateAuditEvent.INPUT_HASH_CONFLICT,
      aggregateType: "TradeCandidate",
      aggregateId: existingCandidateId ?? candidate.candidateKey,
      reasonCode: TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      input,
      afterState: null,
      metadata: payload
    });
    await tx.tradingAuditEvent.upsert({
      where: { eventKey: data.eventKey },
      update: {},
      create: data
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Structured refusal
// ───────────────────────────────────────────────────────────────────────────

async function persistRejection(
  database: PrismaClient,
  input: PersistStrategyEvaluationInput
): Promise<PersistStrategyEvaluationResult> {
  const evaluation = input.evaluation;
  if (evaluation.outcome === StrategyEvaluationOutcome.CANDIDATE) {
    throw new Error("persistRejection called with a candidate result.");
  }

  const data = auditData({
    eventType: ShadowCandidateAuditEvent.EVALUATION_REJECTED,
    aggregateType: "StrategyAssignment",
    aggregateId: input.snapshot.assignment.id,
    reasonCode: evaluation.primaryReasonCode,
    input,
    afterState: null,
    metadata: asJson({
      jobKey: SHADOW_CANDIDATE_JOB_KEY,
      symbol: input.snapshot.asset.symbol,
      outcome: evaluation.outcome,
      reasonCodes: [...evaluation.reasonCodes],
      checks: evaluation.checks,
      asOf: input.snapshot.asOf,
      strategyVersionId: input.snapshot.strategy.strategyVersionId
    })
  });

  await database.tradingAuditEvent.upsert({
    where: { eventKey: data.eventKey },
    update: {},
    create: data
  });

  return {
    outcome: PersistOutcome.REJECTION_RECORDED,
    candidateKey: null,
    tradeCandidateId: null,
    reasonCode: evaluation.primaryReasonCode,
    inputHash: evaluation.inputHash,
    outputHash: evaluation.outputHash
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Audit
// ───────────────────────────────────────────────────────────────────────────

function auditData(args: {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly reasonCode: string;
  readonly input: PersistStrategyEvaluationInput;
  readonly afterState: Json | null;
  readonly metadata: Json;
}) {
  const { input } = args;
  // The input hash is the idempotency key: the same snapshot re-evaluated
  // yields the same audit row instead of a duplicate.
  const idempotencyKey = input.evaluation.inputHash;
  return {
    eventKey: buildAuditEventKey({
      eventType: args.eventType,
      aggregateType: args.aggregateType,
      aggregateId: args.aggregateId,
      idempotencyKey
    }),
    eventType: args.eventType,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    actorType: TradingActorType.SYSTEM,
    actorId: SHADOW_CANDIDATE_JOB_KEY,
    correlationId: input.correlationId,
    causationId: input.correlationId,
    idempotencyKey,
    reasonCode: args.reasonCode,
    beforeState: undefined,
    afterState: args.afterState ?? undefined,
    metadataJson: args.metadata,
    inputHash: input.evaluation.inputHash,
    outputHash: input.evaluation.outputHash,
    engineVersion: input.evaluation.engineVersion,
    codeVersion: input.codeVersion,
    occurredAt: input.occurredAt
  };
}
