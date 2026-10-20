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
  buildPayloadHash,
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

import {
  EXPOSURE_POSITION_STATUSES,
  RESERVING_ORDER_STATUSES
} from "./riskInputAssembler.js";

export const SHADOW_CANDIDATE_JOB_KEY = "trading:shadow-generate-candidates";

export const ShadowCandidateAuditEvent = {
  CANDIDATE_CREATED: "STRATEGY_CANDIDATE_CREATED",
  /** A candidate signal while its asset slot is taken: recorded, not created. */
  CANDIDATE_SKIPPED: "STRATEGY_CANDIDATE_SKIPPED",
  EVALUATION_REJECTED: "STRATEGY_EVALUATION_REJECTED",
  INPUT_HASH_CONFLICT: "STRATEGY_CANDIDATE_INPUT_HASH_CONFLICT"
} as const;

/** Local reason codes of this job, like `ShadowFillReasonCode`. */
export const ShadowCandidateReasonCode = {
  /**
   * The portfolio already holds a position or a live entry order in the
   * asset. A repeated signal is not a candidate: R-022 would refuse it as a
   * CRITICAL scale-in, which is meant for a real breach, not for routine.
   */
  ASSET_SLOT_OCCUPIED: "ASSET_SLOT_OCCUPIED"
} as const;

export const PersistOutcome = {
  CREATED: "CREATED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  /** Same anchor candle, later decision time: the first decision stands. */
  ALREADY_DECIDED: "ALREADY_DECIDED",
  CONFLICT: "CONFLICT",
  REJECTION_RECORDED: "REJECTION_RECORDED",
  /** No candidate: the asset slot of its portfolio is taken (see above). */
  SKIPPED_ASSET_SLOT_OCCUPIED: "SKIPPED_ASSET_SLOT_OCCUPIED"
} as const;
export type PersistOutcome =
  (typeof PersistOutcome)[keyof typeof PersistOutcome];

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
    select: { id: true, inputHash: true, decisionTime: true }
  });

  const verdict = classifyReplay(
    existing?.inputHash ?? null,
    candidate.inputHash
  );

  // One decision per anchor candle. A later scan of the same anchor (manual
  // re-run, scheduler catch-up) necessarily has a different `asOf` and so a
  // different input hash; that is not tampering, the earlier decision simply
  // stands. Only a different input at the SAME decision time is a conflict.
  if (
    verdict === ReplayVerdict.CONFLICT &&
    existing !== null &&
    existing.decisionTime !== null &&
    existing.decisionTime.getTime() !== Date.parse(candidate.decisionTime)
  ) {
    return {
      outcome: PersistOutcome.ALREADY_DECIDED,
      candidateKey: candidate.candidateKey,
      tradeCandidateId: existing.id,
      reasonCode: StrategyReasonCode.CANDIDATE_ANCHOR_ALREADY_DECIDED,
      inputHash: candidate.inputHash,
      outputHash: candidate.outputHash
    };
  }

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
    await recordHashConflict(
      database,
      input,
      candidate,
      existing?.id ?? null,
      existing?.inputHash ?? null
    );
    return {
      outcome: PersistOutcome.CONFLICT,
      candidateKey: candidate.candidateKey,
      tradeCandidateId: existing?.id ?? null,
      reasonCode: StrategyReasonCode.CANDIDATE_INPUT_HASH_CONFLICT,
      inputHash: candidate.inputHash,
      outputHash: candidate.outputHash
    };
  }

  // An anchor once skipped for an occupied slot stays decided, even when the
  // slot frees later in the hour: no late entry on an old signal.
  const skipRecord = skippedAuditData(input, candidate, null);
  const alreadySkipped = await database.tradingAuditEvent.findUnique({
    where: { eventKey: skipRecord.eventKey },
    select: { id: true }
  });
  if (alreadySkipped !== null) return skippedResult(candidate);

  // Candidate + evidence + audit commit together (docs/trading/02, transaction 1).
  // The slot check runs in the same transaction, right before the insert.
  const outcome = await database.$transaction(async (tx) => {
    const occupancy = await loadAssetSlotOccupancy(
      tx,
      candidate.portfolioId,
      candidate.assetId
    );
    if (occupancy !== null) {
      const data = skippedAuditData(input, candidate, occupancy);
      await tx.tradingAuditEvent.upsert({
        where: { eventKey: data.eventKey },
        update: {},
        create: data
      });
      return { skipped: true as const };
    }

    const created = await tx.tradeCandidate.create({
      data: {
        candidateKey: candidate.candidateKey,
        strategyAssignmentId: candidate.strategyAssignmentId,
        strategyVersionId: candidate.strategyVersionId,
        portfolioId: candidate.portfolioId,
        assetId: candidate.assetId,
        anchorCandleId: candidate.anchorCandleId,
        anchorSignalId: candidate.anchorSignalId,
        direction:
          candidate.direction === TradeDirection.LONG
            ? TradeDirection.LONG
            : TradeDirection.SHORT,
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

    return { skipped: false as const, createdId: created.id };
  });

  if (outcome.skipped) return skippedResult(candidate);
  return {
    outcome: PersistOutcome.CREATED,
    candidateKey: candidate.candidateKey,
    tradeCandidateId: outcome.createdId,
    reasonCode: StrategyReasonCode.CANDIDATE_CREATED,
    inputHash: candidate.inputHash,
    outputHash: candidate.outputHash
  };
}

/** The audit record of a skipped candidate: one per anchor decision, keyed by the candidate key. */
function skippedAuditData(
  input: PersistStrategyEvaluationInput,
  candidate: TradeCandidateDraftV1,
  occupancy: Json | null
) {
  return auditData({
    eventType: ShadowCandidateAuditEvent.CANDIDATE_SKIPPED,
    aggregateType: "StrategyAssignment",
    aggregateId: candidate.strategyAssignmentId,
    reasonCode: ShadowCandidateReasonCode.ASSET_SLOT_OCCUPIED,
    input,
    afterState: null,
    metadata: asJson({
      jobKey: SHADOW_CANDIDATE_JOB_KEY,
      symbol: candidate.symbol,
      candidateKey: candidate.candidateKey,
      anchorCandleId: candidate.anchorCandleId,
      portfolioId: candidate.portfolioId,
      assetId: candidate.assetId,
      strategyVersionId: candidate.strategyVersionId,
      occupiedBy: occupancy
    }),
    // The composite candidate key contains "|": hashed, like a fill key.
    idempotencyKey: buildPayloadHash(candidate.candidateKey)
  });
}

function skippedResult(
  candidate: TradeCandidateDraftV1
): PersistStrategyEvaluationResult {
  return {
    outcome: PersistOutcome.SKIPPED_ASSET_SLOT_OCCUPIED,
    candidateKey: candidate.candidateKey,
    tradeCandidateId: null,
    reasonCode: ShadowCandidateReasonCode.ASSET_SLOT_OCCUPIED,
    inputHash: candidate.inputHash,
    outputHash: candidate.outputHash
  };
}

/**
 * What occupies the asset slot of a portfolio, exactly as the risk input
 * assembler hands it to R-022: a position that still carries exposure or a
 * live ENTRY order. `null` when the slot is free. Per portfolio: champion and
 * challenger never block each other.
 */
async function loadAssetSlotOccupancy(
  tx: Prisma.TransactionClient,
  portfolioId: string,
  assetId: string
): Promise<{ readonly shadowPositionIds: string[]; readonly entryOrderIds: string[] } | null> {
  const [positions, entryOrders] = await Promise.all([
    tx.shadowPosition.findMany({
      where: {
        portfolioId,
        assetId,
        status: { in: [...EXPOSURE_POSITION_STATUSES] }
      },
      select: { id: true }
    }),
    tx.shadowOrder.findMany({
      where: {
        portfolioId,
        assetId,
        purpose: "ENTRY",
        status: { in: [...RESERVING_ORDER_STATUSES] }
      },
      select: { id: true }
    })
  ]);
  if (positions.length === 0 && entryOrders.length === 0) return null;
  return {
    shadowPositionIds: positions.map((row) => row.id),
    entryOrderIds: entryOrders.map((row) => row.id)
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
  readonly idempotencyKey?: string;
}) {
  const { input } = args;
  // The input hash is the idempotency key unless the caller names one: the
  // same snapshot re-evaluated yields the same audit row, not a duplicate.
  const idempotencyKey = args.idempotencyKey ?? input.evaluation.inputHash;
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
