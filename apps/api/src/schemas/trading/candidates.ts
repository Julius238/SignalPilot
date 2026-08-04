import { decimalToString, toIso, toIsoOrNull } from "./common.js";

export interface RiskRuleResultRow {
  readonly id: string;
  readonly ruleCode: string;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly severity: string;
}

export interface TradeDecisionRow {
  readonly id: string;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly decidedAt: Date;
}

export interface TradeCandidateRow {
  readonly id: string;
  readonly candidateKey: string;
  readonly portfolioId: string;
  readonly assetId: string;
  readonly asset?: { readonly symbol: string } | null;
  readonly direction: string;
  readonly strategyAssignmentId: string;
  readonly strategyVersionId: string;
  readonly strategyVersion?: {
    readonly id: string;
    readonly version: number;
    readonly engineVersion: string;
    readonly codeVersion: string;
    readonly specificationHash: string;
    readonly strategy?: { readonly key: string; readonly name: string } | null;
  } | null;
  readonly entryType: string;
  readonly status: string;
  readonly referenceEntryPrice: unknown;
  readonly stopPrice: unknown;
  readonly takeProfitPrice: unknown;
  readonly minimumRewardRisk: unknown;
  readonly plannedRewardRisk: unknown;
  readonly stopDistance: unknown;
  readonly stopDistancePct: unknown;
  readonly plannedEntryMinimum: unknown;
  readonly plannedEntryMaximum: unknown;
  readonly maximumEntryGapDistance: unknown;
  readonly invalidReasonCode: string | null;
  readonly cancelReasonCode: string | null;
  readonly validFrom: Date | null;
  readonly earliestFillAt: Date | null;
  readonly maxHoldHours: number | null;
  readonly strategyReasonCodes: unknown;
  readonly dataAsOf: Date;
  readonly decisionTime: Date;
  readonly expiresAt: Date;
  readonly riskAssessments?: readonly RiskAssessmentRow[];
}

export function toCandidateListItem(candidate: TradeCandidateRow) {
  return {
    id: candidate.id,
    candidateKey: candidate.candidateKey,
    portfolioId: candidate.portfolioId,
    assetId: candidate.assetId,
    symbol: candidate.asset?.symbol ?? null,
    direction: candidate.direction,
    syntheticShadowShort: candidate.direction === "SHORT",
    exchangePosition: false,
    strategyAssignmentId: candidate.strategyAssignmentId,
    strategyVersionId: candidate.strategyVersionId,
    strategyKey: candidate.strategyVersion?.strategy?.key ?? null,
    strategyName: candidate.strategyVersion?.strategy?.name ?? null,
    strategyVersion: candidate.strategyVersion?.version ?? null,
    strategyEngineVersion: candidate.strategyVersion?.engineVersion ?? null,
    strategyCodeVersion: candidate.strategyVersion?.codeVersion ?? null,
    strategySpecificationHash:
      candidate.strategyVersion?.specificationHash ?? null,
    entryType: candidate.entryType,
    status: candidate.status,
    referenceEntryPrice: decimalToString(candidate.referenceEntryPrice),
    stopPrice: decimalToString(candidate.stopPrice),
    takeProfitPrice: decimalToString(candidate.takeProfitPrice),
    minimumRewardRisk: decimalToString(candidate.minimumRewardRisk),
    plannedRewardRisk: decimalToString(candidate.plannedRewardRisk),
    invalidReasonCode: candidate.invalidReasonCode,
    cancelReasonCode: candidate.cancelReasonCode,
    dataAsOf: toIso(candidate.dataAsOf),
    decisionTime: toIso(candidate.decisionTime),
    expiresAt: toIso(candidate.expiresAt)
  };
}

export function toCandidateDetail(candidate: TradeCandidateRow) {
  return {
    ...toCandidateListItem(candidate),
    stopDistance: decimalToString(candidate.stopDistance),
    stopDistancePct: decimalToString(candidate.stopDistancePct),
    plannedEntryMinimum: decimalToString(candidate.plannedEntryMinimum),
    plannedEntryMaximum: decimalToString(candidate.plannedEntryMaximum),
    maximumEntryGapDistance: decimalToString(candidate.maximumEntryGapDistance),
    validFrom: toIsoOrNull(candidate.validFrom),
    earliestFillAt: toIsoOrNull(candidate.earliestFillAt),
    maxHoldHours: candidate.maxHoldHours,
    strategyReasonCodes: candidate.strategyReasonCodes,
    latestRiskAssessment:
      candidate.riskAssessments === undefined ||
      candidate.riskAssessments.length === 0
        ? null
        : toRiskAssessment(candidate.riskAssessments[0]!)
  };
}

export interface RiskAssessmentRow {
  readonly id: string;
  readonly tradeCandidateId: string;
  readonly portfolioId: string;
  readonly status: string;
  readonly ruleSetVersion: string;
  readonly equity: unknown;
  readonly availableCash: unknown;
  readonly reservedCash: unknown;
  readonly dailyPnl: unknown;
  readonly openPositionCount: number;
  readonly newTradesToday: number;
  readonly consecutiveLosses: number;
  readonly grossExposure: unknown;
  readonly assetExposure: unknown;
  readonly correlatedExposure: unknown;
  readonly requestedQuantity: unknown;
  readonly approvedQuantity: unknown;
  readonly riskAmount: unknown;
  readonly tradingDateUtc: Date;
  readonly assessedAt: Date;
  readonly ruleResults?: readonly RiskRuleResultRow[];
  readonly decision?: TradeDecisionRow | null;
}

export function toRiskAssessment(assessment: RiskAssessmentRow) {
  return {
    id: assessment.id,
    tradeCandidateId: assessment.tradeCandidateId,
    portfolioId: assessment.portfolioId,
    status: assessment.status,
    ruleSetVersion: assessment.ruleSetVersion,
    equity: decimalToString(assessment.equity),
    availableCash: decimalToString(assessment.availableCash),
    reservedCash: decimalToString(assessment.reservedCash),
    dailyPnl: decimalToString(assessment.dailyPnl),
    openPositionCount: assessment.openPositionCount,
    newTradesToday: assessment.newTradesToday,
    consecutiveLosses: assessment.consecutiveLosses,
    grossExposure: decimalToString(assessment.grossExposure),
    assetExposure: decimalToString(assessment.assetExposure),
    correlatedExposure: decimalToString(assessment.correlatedExposure),
    requestedQuantity: decimalToString(assessment.requestedQuantity),
    approvedQuantity: decimalToString(assessment.approvedQuantity),
    riskAmount: decimalToString(assessment.riskAmount),
    tradingDateUtc: toIso(assessment.tradingDateUtc),
    assessedAt: toIso(assessment.assessedAt),
    ruleResults: (assessment.ruleResults ?? []).map((rule) => ({
      id: rule.id,
      ruleCode: rule.ruleCode,
      outcome: rule.outcome,
      reasonCode: rule.reasonCode,
      severity: rule.severity
    })),
    decision:
      assessment.decision === null || assessment.decision === undefined
        ? null
        : {
            id: assessment.decision.id,
            outcome: assessment.decision.outcome,
            reasonCode: assessment.decision.reasonCode,
            decidedAt: toIso(assessment.decision.decidedAt)
          }
  };
}
