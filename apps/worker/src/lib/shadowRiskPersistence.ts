/**
 * Atomic, idempotent persistence of one risk assessment.
 *
 * Specification:
 *   docs/trading/02-shadow-trading-target-architecture.md, "Transaktionsgrenzen" 2
 *     — `RiskAssessment` + all `RiskRuleResult` + `TradeDecision` + candidate
 *       transition are one transaction;
 *   docs/trading/02, "Idempotenz und Concurrency" — same key and payload returns
 *     the stored result, same key with a different hash is a critical event;
 *   docs/trading/04-state-machines.md — `READY_FOR_RISK -> APPROVED_FOR_SHADOW`
 *     or `RISK_REJECTED`.
 *
 * Writes `RiskAssessment`, `RiskRuleResult`, `TradeDecision`, the candidate
 * status transition, `TradingAuditEvent` and — on a critical finding — a
 * `RiskEvent`. It creates no `ShadowOrder`, `ShadowFill`, `ShadowPosition`,
 * `ExitPlan` and no `PortfolioLedgerEntry`: reserving cash belongs to work
 * package 4.
 */

import {
  Prisma,
  RiskAssessmentStatus,
  RiskEventType,
  RiskRuleOutcome,
  RiskSeverity,
  TradeCandidateStatus,
  TradeDecisionOutcome,
  TradingActorType,
  type PrismaClient
} from "@signalpilot/database";
import {
  RiskEvaluationOutcome,
  type RiskEvaluationResultV1,
  type RiskInputSnapshotV1
} from "@signalpilot/risk-engine";
import {
  DecimalValue,
  ReplayVerdict,
  TradingReasonCode,
  buildAuditEventKey,
  buildRiskEventKey,
  classifyReplay
} from "@signalpilot/trading-domain";

export const SHADOW_RISK_JOB_KEY = "trading:shadow-assess-risk";

export const ShadowRiskAuditEvent = {
  ASSESSMENT_RECORDED: "RISK_ASSESSMENT_RECORDED",
  INPUT_HASH_CONFLICT: "RISK_ASSESSMENT_INPUT_HASH_CONFLICT"
} as const;

export const RiskPersistOutcome = {
  RECORDED: "RECORDED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  CONFLICT: "CONFLICT"
} as const;
export type RiskPersistOutcome = (typeof RiskPersistOutcome)[keyof typeof RiskPersistOutcome];

export interface PersistRiskAssessmentInput {
  readonly evaluation: RiskEvaluationResultV1;
  readonly snapshot: RiskInputSnapshotV1;
  readonly correlationId: string;
  readonly codeVersion: string;
  readonly occurredAt: Date;
}

export interface PersistRiskAssessmentResult {
  readonly outcome: RiskPersistOutcome;
  readonly riskAssessmentId: string | null;
  readonly tradeDecisionId: string | null;
  readonly candidateStatus: string | null;
  readonly reasonCode: string;
  readonly approvedQuantity: string;
  readonly riskAmount: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

type Json = Prisma.InputJsonValue;
const asJson = (value: unknown): Json => value as Json;

/**
 * `RiskRuleResult.actualValue` / `limitValue` are `Decimal?` columns. A rule may
 * legitimately have no scalar comparison, and a non-numeric label must never
 * reach the column, so anything that is not a decimal string becomes null.
 */
const decimalColumn = (value: string | null): string | null =>
  value !== null && DecimalValue.isDecimalString(value) ? value : null;

const CANDIDATE_STATUS_BY_OUTCOME = {
  [RiskEvaluationOutcome.APPROVED]: TradeCandidateStatus.APPROVED_FOR_SHADOW,
  [RiskEvaluationOutcome.REJECTED]: TradeCandidateStatus.RISK_REJECTED,
  [RiskEvaluationOutcome.ERROR]: TradeCandidateStatus.RISK_REJECTED
} as const;

const DECISION_OUTCOME = {
  APPROVE_SHADOW: TradeDecisionOutcome.APPROVE_SHADOW,
  REJECT: TradeDecisionOutcome.REJECT,
  EXPIRE: TradeDecisionOutcome.EXPIRE,
  CANCEL: TradeDecisionOutcome.CANCEL,
  ERROR: TradeDecisionOutcome.ERROR
} as const;

export async function persistRiskAssessment(
  database: PrismaClient,
  input: PersistRiskAssessmentInput
): Promise<PersistRiskAssessmentResult> {
  const { evaluation, snapshot } = input;
  const assessment = evaluation.assessment;

  const existing = await database.riskAssessment.findUnique({
    where: { assessmentKey: assessment.assessmentKey },
    select: { id: true, inputHash: true, status: true, decision: { select: { id: true } } }
  });

  const verdict = classifyReplay(existing?.inputHash ?? null, assessment.inputHash);

  if (verdict === ReplayVerdict.IDEMPOTENT_REPLAY) {
    return {
      outcome: RiskPersistOutcome.IDEMPOTENT_REPLAY,
      riskAssessmentId: existing?.id ?? null,
      tradeDecisionId: existing?.decision?.id ?? null,
      candidateStatus: null,
      reasonCode: evaluation.primaryReasonCode,
      approvedQuantity: assessment.approvedQuantity,
      riskAmount: assessment.riskAmount,
      inputHash: assessment.inputHash,
      outputHash: assessment.outputHash
    };
  }

  if (verdict === ReplayVerdict.CONFLICT) {
    await recordHashConflict(database, input, existing?.id ?? null, existing?.inputHash ?? null);
    return {
      outcome: RiskPersistOutcome.CONFLICT,
      riskAssessmentId: existing?.id ?? null,
      tradeDecisionId: null,
      candidateStatus: null,
      reasonCode: TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      approvedQuantity: "0.000000000000",
      riskAmount: "0.000000000000",
      inputHash: assessment.inputHash,
      outputHash: assessment.outputHash
    };
  }

  // A verdict without a stored risk limit set cannot be persisted: the column is
  // a mandatory foreign key. The caller records a risk event instead.
  if (assessment.riskLimitSetId === null) {
    throw new Error(
      "Cannot persist a risk assessment without an active RiskLimitSet; run the bootstrap first."
    );
  }

  const candidateStatus = CANDIDATE_STATUS_BY_OUTCOME[evaluation.outcome];

  const result = await database.$transaction(async (tx) => {
    const created = await tx.riskAssessment.create({
      data: {
        tradeCandidateId: assessment.tradeCandidateId,
        portfolioId: assessment.portfolioId,
        riskLimitSetId: assessment.riskLimitSetId as string,
        assessmentKey: assessment.assessmentKey,
        status: assessment.status as RiskAssessmentStatus,
        ruleSetVersion: assessment.ruleSetVersion,
        equity: assessment.equity,
        availableCash: assessment.availableCash,
        reservedCash: assessment.reservedCash,
        dailyPnl: assessment.dailyPnl,
        openPositionCount: assessment.openPositionCount,
        newTradesToday: assessment.newTradesToday,
        consecutiveLosses: assessment.consecutiveLosses,
        grossExposure: assessment.grossExposure,
        assetExposure: assessment.assetExposure,
        correlatedExposure: assessment.correlatedExposure,
        requestedQuantity: assessment.requestedQuantity,
        approvedQuantity: assessment.approvedQuantity,
        riskAmount: assessment.riskAmount,
        tradingDateUtc: new Date(`${assessment.tradingDateUtc}T00:00:00.000Z`),
        portfolioSnapshotAsOf: new Date(assessment.portfolioSnapshotAsOf),
        marketDataAsOf: new Date(assessment.marketDataAsOf),
        // The full snapshot plus the cost and sizing bridge, so the verdict can
        // be recomputed later without the live tables.
        inputsJson: asJson({ snapshot, sizing: assessment.sizing }),
        inputHash: assessment.inputHash,
        outputHash: assessment.outputHash,
        assessedAt: new Date(assessment.assessedAt)
      },
      select: { id: true }
    });

    await tx.riskRuleResult.createMany({
      data: evaluation.ruleResults.map((rule) => ({
        riskAssessmentId: created.id,
        ruleCode: rule.ruleCode,
        ruleVersion: rule.ruleVersion,
        outcome: rule.outcome as RiskRuleOutcome,
        severity: rule.severity as RiskSeverity,
        reasonCode: rule.reasonCode,
        message: rule.message,
        actualValue: decimalColumn(rule.actualValue),
        limitValue: decimalColumn(rule.limitValue),
        unit: rule.unit,
        inputJson: asJson(rule.inputJson),
        evaluatedAt: new Date(rule.evaluatedAt)
      }))
    });

    const decision = await tx.tradeDecision.create({
      data: {
        tradeCandidateId: evaluation.decision.tradeCandidateId,
        riskAssessmentId: created.id,
        decisionKey: evaluation.decision.decisionKey,
        outcome: DECISION_OUTCOME[evaluation.decision.outcome],
        reasonCode: evaluation.decision.reasonCode,
        inputHash: evaluation.decision.inputHash,
        outputHash: evaluation.decision.outputHash,
        decidedAt: new Date(evaluation.decision.decidedAt)
      },
      select: { id: true }
    });

    // Candidate transitions exactly along docs/trading/04:
    //   CREATED -> VALIDATING -> READY_FOR_RISK -> APPROVED_FOR_SHADOW | RISK_REJECTED
    // Each hop is a compare-and-swap on the expected status, so a concurrent
    // worker cannot be overwritten. `APPROVED_FOR_SHADOW` means only that the
    // risk verdict passed; no order exists and no cash is reserved yet.
    const hops: readonly (readonly [TradeCandidateStatus[], TradeCandidateStatus])[] = [
      [[TradeCandidateStatus.CREATED], TradeCandidateStatus.VALIDATING],
      [[TradeCandidateStatus.VALIDATING], TradeCandidateStatus.READY_FOR_RISK],
      [[TradeCandidateStatus.READY_FOR_RISK], candidateStatus]
    ];
    for (const [from, to] of hops) {
      const changed = await tx.tradeCandidate.updateMany({
        where: { id: assessment.tradeCandidateId, status: { in: from } },
        data: {
          status: to,
          invalidReasonCode:
            to === TradeCandidateStatus.RISK_REJECTED &&
            evaluation.outcome === RiskEvaluationOutcome.ERROR
              ? evaluation.primaryReasonCode
              : undefined,
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        throw new Error(
          `Candidate ${assessment.tradeCandidateId} was not in ${from.join("/")}; concurrent update.`
        );
      }
    }

    await tx.tradingAuditEvent.create({
      data: auditData({
        eventType: ShadowRiskAuditEvent.ASSESSMENT_RECORDED,
        aggregateType: "RiskAssessment",
        aggregateId: created.id,
        reasonCode: evaluation.primaryReasonCode,
        input,
        afterState: asJson({
          assessment: { ...assessment, sizing: assessment.sizing },
          decision: evaluation.decision,
          candidateStatus
        }),
        metadata: asJson({
          jobKey: SHADOW_RISK_JOB_KEY,
          symbol: snapshot.candidate.symbol,
          tradeCandidateId: assessment.tradeCandidateId,
          outcome: evaluation.outcome,
          directive: evaluation.directive,
          policyHash: evaluation.policyHash,
          ruleResultCount: evaluation.ruleResults.length
        })
      })
    });

    // Critical findings are risk events in the same transaction.
    const criticalRules = evaluation.ruleResults.filter(
      (rule) => rule.severity === "CRITICAL" && rule.outcome !== "PASS"
    );
    for (const rule of criticalRules) {
      const eventKey = buildRiskEventKey({
        type: RiskEventType.RISK_RULE_BLOCK,
        aggregateType: "RiskAssessment",
        aggregateId: created.id,
        inputHash: assessment.inputHash
      });
      await tx.riskEvent.upsert({
        where: { eventKey: `${eventKey}|${rule.ruleCode}` },
        update: {},
        create: {
          eventKey: `${eventKey}|${rule.ruleCode}`,
          type: RiskEventType.RISK_RULE_BLOCK,
          severity: RiskSeverity.CRITICAL,
          reasonCode: rule.reasonCode,
          portfolioId: assessment.portfolioId,
          tradeCandidateId: assessment.tradeCandidateId,
          payloadJson: asJson({
            ruleCode: rule.ruleCode,
            message: rule.message,
            directive: evaluation.directive,
            jobKey: SHADOW_RISK_JOB_KEY
          }),
          inputHash: assessment.inputHash
        }
      });
    }

    return { riskAssessmentId: created.id, tradeDecisionId: decision.id };
  });

  return {
    outcome: RiskPersistOutcome.RECORDED,
    riskAssessmentId: result.riskAssessmentId,
    tradeDecisionId: result.tradeDecisionId,
    candidateStatus,
    reasonCode: evaluation.primaryReasonCode,
    approvedQuantity: assessment.approvedQuantity,
    riskAmount: assessment.riskAmount,
    inputHash: assessment.inputHash,
    outputHash: assessment.outputHash
  };
}

/** Same key, different payload — never overwrite, always escalate. */
async function recordHashConflict(
  database: PrismaClient,
  input: PersistRiskAssessmentInput,
  existingAssessmentId: string | null,
  existingInputHash: string | null
): Promise<void> {
  const assessment = input.evaluation.assessment;
  const payload = asJson({
    jobKey: SHADOW_RISK_JOB_KEY,
    assessmentKey: assessment.assessmentKey,
    existingInputHash,
    incomingInputHash: assessment.inputHash,
    tradeCandidateId: assessment.tradeCandidateId
  });

  const eventKey = buildRiskEventKey({
    type: RiskEventType.IDEMPOTENCY_OR_VERSION_CONFLICT,
    aggregateType: "RiskAssessment",
    aggregateId: existingAssessmentId ?? assessment.tradeCandidateId,
    inputHash: assessment.inputHash
  });

  await database.$transaction(async (tx) => {
    await tx.riskEvent.upsert({
      where: { eventKey },
      update: {},
      create: {
        eventKey,
        type: RiskEventType.IDEMPOTENCY_OR_VERSION_CONFLICT,
        severity: RiskSeverity.CRITICAL,
        reasonCode: TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
        portfolioId: assessment.portfolioId,
        tradeCandidateId: assessment.tradeCandidateId,
        payloadJson: payload,
        inputHash: assessment.inputHash
      }
    });

    const data = auditData({
      eventType: ShadowRiskAuditEvent.INPUT_HASH_CONFLICT,
      aggregateType: "RiskAssessment",
      aggregateId: existingAssessmentId ?? assessment.assessmentKey,
      reasonCode: TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      input,
      afterState: null,
      metadata: payload
    });
    await tx.tradingAuditEvent.upsert({ where: { eventKey: data.eventKey }, update: {}, create: data });
  });
}

function auditData(args: {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly reasonCode: string;
  readonly input: PersistRiskAssessmentInput;
  readonly afterState: Json | null;
  readonly metadata: Json;
}) {
  const { input } = args;
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
    actorId: SHADOW_RISK_JOB_KEY,
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
