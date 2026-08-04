/**
 * Idempotent, atomic creation of a `ShadowOrder` from an `APPROVED_FOR_SHADOW`
 * candidate.
 *
 * Specification:
 *   docs/trading/04-state-machines.md, "Shadow Order" (`PROPOSED -> ACCEPTED
 *     -> WAITING_FOR_ENTRY`)
 *   docs/trading/02-shadow-trading-target-architecture.md, "Transaktionsgrenzen" 3
 *     — Decision + ShadowOrder + Portfolio-Reserve-Ledger + Audit is one
 *       transaction; no reservation, no approval.
 *   docs/trading/07-shadow-execution-model.md, "Portfolio-Cash und
 *     Reservierung"
 *
 * `reservedQuoteAmount` and `approvedQuantity` are never recomputed here —
 * they are read back from the risk assessment the candidate was actually
 * approved with. This module only re-verifies that the world is still safe to
 * act on (session, portfolio, execution profile, scope) and then reserves and
 * writes.
 */

import {
  Prisma,
  RiskEventType,
  RiskSeverity,
  ShadowOrderStatus,
  ShadowOrderPurpose,
  ShadowOrderSide,
  ShadowOrderTimeInForce,
  ShadowOrderType,
  ShadowPositionStatus,
  TradeCandidateStatus,
  TradeDirection,
  TradingActorType,
  type PrismaClient
} from "@signalpilot/database";
import { computeReserveEntry } from "@signalpilot/portfolio";
import {
  DecimalValue,
  ENTRY_SIDE,
  TradingReasonCode,
  buildAuditEventKey,
  buildClientOrderId,
  buildEntryOrderKey,
  buildLedgerEntryKey,
  buildOpenEntryOrderScopeKey,
  buildPayloadHash,
  buildRiskEventKey
} from "@signalpilot/trading-domain";

import {
  asJson,
  decimalString,
  ledgerEntryCreateData,
  portfolioState
} from "./shadowPortfolioIo.js";

export const SHADOW_ORDER_JOB_KEY = "trading:shadow-create-orders";

const TERMINAL_ORDER_STATUSES = [
  ShadowOrderStatus.FILLED,
  ShadowOrderStatus.REJECTED,
  ShadowOrderStatus.CANCELLED,
  ShadowOrderStatus.EXPIRED
];
const TERMINAL_POSITION_STATUSES = [
  ShadowPositionStatus.CLOSED,
  ShadowPositionStatus.STOPPED_OUT,
  ShadowPositionStatus.INVALIDATED,
  ShadowPositionStatus.ERROR
];

/** One order's fill window is at most two 1h candles (docs/trading/05, 07). */
const ORDER_FILL_WINDOW_MS = 2 * 60 * 60 * 1000;

export const ShadowOrderReasonCode = {
  CANDIDATE_NOT_FOUND: "SHADOW_ORDER_CANDIDATE_NOT_FOUND",
  CANDIDATE_NOT_APPROVED: "SHADOW_ORDER_CANDIDATE_NOT_APPROVED",
  DECISION_MISSING: "SHADOW_ORDER_DECISION_MISSING",
  RISK_ASSESSMENT_MISSING: "SHADOW_ORDER_RISK_ASSESSMENT_MISSING",
  SIZING_UNREADABLE: "SHADOW_ORDER_SIZING_UNREADABLE",
  DIRECTION_DISABLED: "SHADOW_ORDER_DIRECTION_DISABLED",
  DIRECTION_CONFLICT: "SHADOW_ORDER_DIRECTION_CONFLICT",
  PORTFOLIO_NOT_ACTIVE: TradingReasonCode.PORTFOLIO_NOT_ACTIVE,
  SESSION_BLOCKS_ENTRY: TradingReasonCode.SESSION_BLOCKS_ENTRY,
  EXECUTION_PROFILE_MISSING: "SHADOW_ORDER_EXECUTION_PROFILE_MISSING",
  EXECUTION_PROFILE_CHANGED: "SHADOW_ORDER_EXECUTION_PROFILE_CHANGED",
  SCALE_IN_FORBIDDEN: "SHADOW_ORDER_SCALE_IN_FORBIDDEN",
  INSUFFICIENT_CASH: "SHADOW_ORDER_INSUFFICIENT_CASH",
  CREATED: "SHADOW_ORDER_CREATED",
  IDEMPOTENT_REPLAY: "SHADOW_ORDER_IDEMPOTENT_REPLAY"
} as const;
export type ShadowOrderReasonCode =
  (typeof ShadowOrderReasonCode)[keyof typeof ShadowOrderReasonCode];

export const ShadowOrderOutcome = {
  CREATED: "CREATED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  BLOCKED: "BLOCKED"
} as const;
export type ShadowOrderOutcome =
  (typeof ShadowOrderOutcome)[keyof typeof ShadowOrderOutcome];

export interface CreateShadowOrderInput {
  readonly tradeCandidateId: string;
  readonly asOf: Date;
  readonly codeVersion: string;
  readonly correlationId: string;
  readonly capability: {
    readonly strategyV1Enabled: boolean;
    readonly strategyLongV1Enabled: boolean;
    readonly strategyShortV1Enabled: boolean;
    readonly shadowShortEnabled: boolean;
    readonly shadowOnlyBuild: boolean;
    readonly enableLiveTrading: boolean;
    readonly exchangeExecutionEnabled: boolean;
    readonly marginTradingEnabled: boolean;
    readonly futuresTradingEnabled: boolean;
  };
}

export interface CreateShadowOrderResult {
  readonly outcome: ShadowOrderOutcome;
  readonly reasonCode: ShadowOrderReasonCode;
  readonly shadowOrderId: string | null;
  readonly message?: string;
}

type Sizing = {
  readonly approvedQuantity: string;
  readonly reservedQuoteAmount: string;
  readonly worstEntryPrice: string;
};

/** Extract only the fields this module needs from `RiskAssessment.inputsJson`. */
function extractSizing(inputsJson: Prisma.JsonValue): Sizing | null {
  if (
    typeof inputsJson !== "object" ||
    inputsJson === null ||
    Array.isArray(inputsJson)
  )
    return null;
  const sizing = (inputsJson as Record<string, unknown>).sizing;
  if (typeof sizing !== "object" || sizing === null) return null;
  const record = sizing as Record<string, unknown>;
  const approvedQuantity = record.approvedQuantity;
  const reservedQuoteAmount = record.reservedQuoteAmount;
  const worstEntryPrice = record.worstEntryPrice;
  if (
    typeof approvedQuantity !== "string" ||
    typeof reservedQuoteAmount !== "string" ||
    typeof worstEntryPrice !== "string" ||
    !DecimalValue.isDecimalString(approvedQuantity) ||
    !DecimalValue.isDecimalString(reservedQuoteAmount) ||
    !DecimalValue.isDecimalString(worstEntryPrice)
  ) {
    return null;
  }
  return { approvedQuantity, reservedQuoteAmount, worstEntryPrice };
}

function extractExecutionProfileRef(
  inputsJson: Prisma.JsonValue
): { readonly id: string; readonly specificationHash: string } | null {
  if (
    typeof inputsJson !== "object" ||
    inputsJson === null ||
    Array.isArray(inputsJson)
  )
    return null;
  const snapshot = (inputsJson as Record<string, unknown>).snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const profile = (snapshot as Record<string, unknown>).executionProfile;
  if (typeof profile !== "object" || profile === null) return null;
  const record = profile as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.specificationHash !== "string"
  )
    return null;
  return { id: record.id, specificationHash: record.specificationHash };
}

function blocked(
  reasonCode: ShadowOrderReasonCode,
  message: string
): CreateShadowOrderResult {
  return {
    outcome: ShadowOrderOutcome.BLOCKED,
    reasonCode,
    shadowOrderId: null,
    message
  };
}

/**
 * Create exactly one `ShadowOrder` (and its cash reservation) for a candidate
 * that already carries a `PASS` risk assessment and an `APPROVE_SHADOW`
 * decision. Idempotent by `entryCandidateKey` — a repeat call for the same
 * candidate returns the existing order without writing anything.
 */
export async function createShadowOrderForCandidate(
  database: PrismaClient,
  input: CreateShadowOrderInput
): Promise<CreateShadowOrderResult> {
  const candidate = await database.tradeCandidate.findUnique({
    where: { id: input.tradeCandidateId },
    include: {
      decision: true,
      strategyVersion: { include: { strategy: true } },
      strategyAssignment: true
    }
  });
  if (candidate === null) {
    return blocked(
      ShadowOrderReasonCode.CANDIDATE_NOT_FOUND,
      `No TradeCandidate ${input.tradeCandidateId}.`
    );
  }

  const assignmentConfig = candidate.strategyAssignment.assignmentConfigJson;
  const assignmentDirection =
    typeof assignmentConfig === "object" &&
    assignmentConfig !== null &&
    !Array.isArray(assignmentConfig)
      ? (assignmentConfig as Record<string, unknown>).direction
      : null;
  const strategyParameters = candidate.strategyVersion.parametersJson;
  const strategyDirection =
    typeof strategyParameters === "object" &&
    strategyParameters !== null &&
    !Array.isArray(strategyParameters)
      ? (strategyParameters as Record<string, unknown>).direction
      : null;
  if (
    strategyDirection !== candidate.direction ||
    assignmentDirection !== candidate.direction
  ) {
    return blocked(
      ShadowOrderReasonCode.DIRECTION_CONFLICT,
      "Candidate, StrategyVersion and StrategyAssignment do not declare the same direction."
    );
  }
  const capability = input.capability;
  const capabilitySafe =
    capability.strategyV1Enabled === true &&
    capability.shadowOnlyBuild === true &&
    capability.enableLiveTrading === false &&
    capability.exchangeExecutionEnabled === false &&
    capability.marginTradingEnabled === false &&
    capability.futuresTradingEnabled === false;
  const directionEnabled =
    candidate.direction === TradeDirection.LONG
      ? capabilitySafe &&
        (candidate.strategyVersion.strategy.key === "CRYPTO_MTF_BREAKOUT_V1" ||
          (candidate.strategyVersion.strategy.key ===
            "CRYPTO_MTF_BREAKOUT_LONG_V1" &&
            capability.strategyLongV1Enabled === true))
      : candidate.direction === TradeDirection.SHORT &&
        capabilitySafe &&
        candidate.strategyVersion.strategy.key ===
          "CRYPTO_MTF_BREAKDOWN_SHORT_V1" &&
        capability.strategyShortV1Enabled === true &&
        capability.shadowShortEnabled === true;
  if (!directionEnabled) {
    return blocked(
      ShadowOrderReasonCode.DIRECTION_DISABLED,
      `Entry capability is disabled or contradictory for ${candidate.direction}.`
    );
  }

  const existingOrder = await database.shadowOrder.findUnique({
    where: { entryCandidateKey: candidate.candidateKey },
    select: { id: true }
  });
  if (existingOrder !== null) {
    return {
      outcome: ShadowOrderOutcome.IDEMPOTENT_REPLAY,
      reasonCode: ShadowOrderReasonCode.IDEMPOTENT_REPLAY,
      shadowOrderId: existingOrder.id
    };
  }

  if (candidate.status !== TradeCandidateStatus.APPROVED_FOR_SHADOW) {
    return blocked(
      ShadowOrderReasonCode.CANDIDATE_NOT_APPROVED,
      `Candidate is ${candidate.status}, not APPROVED_FOR_SHADOW.`
    );
  }
  if (
    candidate.decision === null ||
    candidate.decision.outcome !== "APPROVE_SHADOW"
  ) {
    return blocked(
      ShadowOrderReasonCode.DECISION_MISSING,
      "No APPROVE_SHADOW decision on the candidate."
    );
  }

  const riskAssessment =
    candidate.decision.riskAssessmentId === null
      ? null
      : await database.riskAssessment.findUnique({
          where: { id: candidate.decision.riskAssessmentId }
        });
  if (riskAssessment === null || riskAssessment.status !== "PASS") {
    return blocked(
      ShadowOrderReasonCode.RISK_ASSESSMENT_MISSING,
      "No PASS risk assessment behind this decision."
    );
  }

  const sizing = extractSizing(riskAssessment.inputsJson);
  const profileRef = extractExecutionProfileRef(riskAssessment.inputsJson);
  if (sizing === null || profileRef === null) {
    return blocked(
      ShadowOrderReasonCode.SIZING_UNREADABLE,
      "Risk assessment sizing is unreadable."
    );
  }

  const portfolio = await database.portfolio.findUnique({
    where: { id: candidate.portfolioId }
  });
  if (portfolio === null || portfolio.status !== "ACTIVE") {
    return blocked(
      ShadowOrderReasonCode.PORTFOLIO_NOT_ACTIVE,
      `Portfolio is ${portfolio?.status ?? "MISSING"}.`
    );
  }

  const session = await database.tradingSession.findFirst({
    where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" }
  });
  if (
    session === null ||
    session.status !== "SHADOW_ACTIVE" ||
    session.killSwitchEngaged
  ) {
    return blocked(
      ShadowOrderReasonCode.SESSION_BLOCKS_ENTRY,
      `Session is ${session?.status ?? "MISSING"} (kill switch ${session?.killSwitchEngaged ?? "unknown"}).`
    );
  }

  const executionProfile = await database.instrumentExecutionProfile.findFirst({
    where: { assetId: candidate.assetId, status: "ACTIVE" },
    orderBy: { version: "desc" }
  });
  if (executionProfile === null) {
    return blocked(
      ShadowOrderReasonCode.EXECUTION_PROFILE_MISSING,
      "No active execution profile."
    );
  }
  if (
    executionProfile.id !== profileRef.id ||
    executionProfile.specificationHash !== profileRef.specificationHash
  ) {
    await recordExecutionProfileChange(
      database,
      candidate.id,
      portfolio.id,
      executionProfile.id
    );
    return blocked(
      ShadowOrderReasonCode.EXECUTION_PROFILE_CHANGED,
      "The active execution profile changed after risk approval; the order is refused, not silently re-priced."
    );
  }

  // Defensive re-check of R-022 (no scale-in): the risk engine already
  // verified this at approval time, but time has passed since then.
  const [conflictingOrder, conflictingPosition] = await Promise.all([
    database.shadowOrder.findFirst({
      where: {
        portfolioId: portfolio.id,
        assetId: candidate.assetId,
        purpose: ShadowOrderPurpose.ENTRY,
        status: { notIn: TERMINAL_ORDER_STATUSES }
      }
    }),
    database.shadowPosition.findFirst({
      where: {
        portfolioId: portfolio.id,
        assetId: candidate.assetId,
        status: { notIn: TERMINAL_POSITION_STATUSES }
      }
    })
  ]);
  if (conflictingOrder !== null || conflictingPosition !== null) {
    await recordScaleInAttempt(database, candidate.id, portfolio.id);
    return blocked(
      ShadowOrderReasonCode.SCALE_IN_FORBIDDEN,
      "A non-terminal order or position already exists for this portfolio and asset."
    );
  }

  const state = portfolioState(portfolio);
  const reserveEntryKeyPlaceholder = buildLedgerEntryKey({
    portfolioId: portfolio.id,
    type: "RESERVE",
    causeType: "ShadowOrder",
    causeId: candidate.candidateKey
  });
  const reserve = computeReserveEntry({
    state,
    entryKey: reserveEntryKeyPlaceholder,
    reservedQuoteAmount: sizing.reservedQuoteAmount,
    shadowOrderId: candidate.candidateKey,
    occurredAt: input.asOf.toISOString()
  });
  if (!reserve.ok) {
    return blocked(
      ShadowOrderReasonCode.INSUFFICIENT_CASH,
      `Cannot reserve ${sizing.reservedQuoteAmount}: ${reserve.reasonCode}.`
    );
  }

  const orderKey = buildEntryOrderKey({
    tradeDecisionId: candidate.decision.id
  });
  const clientOrderId = buildClientOrderId(orderKey);
  const earliestFillAt = candidate.earliestFillAt ?? candidate.validFrom;
  if (earliestFillAt === null) {
    return blocked(
      ShadowOrderReasonCode.SIZING_UNREADABLE,
      "Candidate has no earliestFillAt/validFrom."
    );
  }
  const orderExpiresAt = new Date(
    earliestFillAt.getTime() + ORDER_FILL_WINDOW_MS
  );

  const createdOrderId = await database.$transaction(async (tx) => {
    const created = await tx.shadowOrder.create({
      data: {
        orderKey,
        clientOrderId,
        tradeCandidateId: candidate.id,
        tradeDecisionId: candidate.decision!.id,
        portfolioId: portfolio.id,
        assetId: candidate.assetId,
        tradingSessionId: session.id,
        executionProfileId: executionProfile.id,
        entryCandidateKey: candidate.candidateKey,
        openEntryScopeKey: buildOpenEntryOrderScopeKey({
          portfolioId: portfolio.id,
          assetId: candidate.assetId,
          purpose: ShadowOrderPurpose.ENTRY
        }),
        direction: candidate.direction,
        purpose: ShadowOrderPurpose.ENTRY,
        side: ENTRY_SIDE[candidate.direction] as ShadowOrderSide,
        orderType: ShadowOrderType.MARKET,
        timeInForce: ShadowOrderTimeInForce.NEXT_BARS,
        status: ShadowOrderStatus.WAITING_FOR_ENTRY,
        requestedQuantity: sizing.approvedQuantity,
        filledQuantity: "0",
        remainingQuantity: sizing.approvedQuantity,
        referencePrice: decimalString(candidate.referenceEntryPrice),
        reservedQuoteAmount: sizing.reservedQuoteAmount,
        earliestFillAt,
        expiresAt: orderExpiresAt,
        precisionSnapshotJson: asJson({
          tickSize: decimalString(executionProfile.tickSize),
          stepSize: decimalString(executionProfile.stepSize),
          minQuantity: decimalString(executionProfile.minQuantity),
          minNotional: decimalString(executionProfile.minNotional),
          maxQuantity:
            executionProfile.maxQuantity === null
              ? null
              : decimalString(executionProfile.maxQuantity)
        }),
        costModelSnapshotJson: asJson({
          feeBps: executionProfile.feeBps,
          fullSpreadBps: executionProfile.fullSpreadBps,
          slippageBps: executionProfile.slippageBps,
          maxParticipationRate: decimalString(
            executionProfile.maxParticipationRate
          ),
          executionProfileId: executionProfile.id,
          executionProfileSpecificationHash: executionProfile.specificationHash
        })
      },
      select: { id: true }
    });

    const ledgerEntryKey = buildLedgerEntryKey({
      portfolioId: portfolio.id,
      type: "RESERVE",
      causeType: "ShadowOrder",
      causeId: created.id
    });
    const finalReserve = computeReserveEntry({
      state,
      entryKey: ledgerEntryKey,
      reservedQuoteAmount: sizing.reservedQuoteAmount,
      shadowOrderId: created.id,
      occurredAt: input.asOf.toISOString()
    });
    if (!finalReserve.ok || finalReserve.nextState === null) {
      throw new Error(
        `Reservation became invalid inside the transaction: ${finalReserve.reasonCode}`
      );
    }

    await tx.portfolioLedgerEntry.create({
      data: ledgerEntryCreateData(finalReserve.entries[0], portfolio.id)
    });

    const updated = await tx.portfolio.updateMany({
      where: { id: portfolio.id, version: portfolio.version },
      data: {
        availableCash: finalReserve.nextState.availableCash,
        reservedCash: finalReserve.nextState.reservedCash,
        ledgerSequence: finalReserve.nextState.ledgerSequence,
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) {
      throw new Error(
        `Portfolio ${portfolio.id} version conflict while reserving cash.`
      );
    }

    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SHADOW_ORDER_CREATED",
          aggregateType: "ShadowOrder",
          aggregateId: created.id,
          idempotencyKey: buildPayloadHash(candidate.candidateKey)
        }),
        eventType: "SHADOW_ORDER_CREATED",
        aggregateType: "ShadowOrder",
        aggregateId: created.id,
        actorType: TradingActorType.SYSTEM,
        actorId: SHADOW_ORDER_JOB_KEY,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        idempotencyKey: buildPayloadHash(candidate.candidateKey),
        reasonCode: ShadowOrderReasonCode.CREATED,
        tradingSessionId: session.id,
        afterState: asJson({
          shadowOrderId: created.id,
          direction: candidate.direction,
          side: ENTRY_SIDE[candidate.direction],
          syntheticShadowShort: candidate.direction === TradeDirection.SHORT,
          approvedQuantity: sizing.approvedQuantity,
          reservedQuoteAmount: sizing.reservedQuoteAmount,
          earliestFillAt: earliestFillAt.toISOString(),
          expiresAt: orderExpiresAt.toISOString()
        }),
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });

    return created.id;
  });

  return {
    outcome: ShadowOrderOutcome.CREATED,
    reasonCode: ShadowOrderReasonCode.CREATED,
    shadowOrderId: createdOrderId
  };
}

async function recordScaleInAttempt(
  database: PrismaClient,
  tradeCandidateId: string,
  portfolioId: string
): Promise<void> {
  const eventKey = buildRiskEventKey({
    type: RiskEventType.RISK_RULE_BLOCK,
    aggregateType: "TradeCandidate",
    aggregateId: tradeCandidateId,
    inputHash: tradeCandidateId
  });
  await database.riskEvent.upsert({
    where: { eventKey },
    update: {},
    create: {
      eventKey,
      type: RiskEventType.RISK_RULE_BLOCK,
      severity: RiskSeverity.CRITICAL,
      reasonCode: "AVERAGING_OR_SCALE_IN_FORBIDDEN",
      portfolioId,
      tradeCandidateId,
      payloadJson: asJson({ jobKey: SHADOW_ORDER_JOB_KEY }),
      inputHash: tradeCandidateId
    }
  });
}

async function recordExecutionProfileChange(
  database: PrismaClient,
  tradeCandidateId: string,
  portfolioId: string,
  currentExecutionProfileId: string
): Promise<void> {
  const eventKey = buildRiskEventKey({
    type: RiskEventType.EXECUTION_PROFILE_CHANGE,
    aggregateType: "TradeCandidate",
    aggregateId: tradeCandidateId,
    inputHash: currentExecutionProfileId
  });
  await database.riskEvent.upsert({
    where: { eventKey },
    update: {},
    create: {
      eventKey,
      type: RiskEventType.EXECUTION_PROFILE_CHANGE,
      severity: RiskSeverity.WARNING,
      reasonCode: "EXECUTION_PROFILE_CHANGE",
      portfolioId,
      tradeCandidateId,
      payloadJson: asJson({
        jobKey: SHADOW_ORDER_JOB_KEY,
        currentExecutionProfileId
      }),
      inputHash: currentExecutionProfileId
    }
  });
}
