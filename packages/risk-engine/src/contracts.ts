/**
 * Input and output contracts of the risk engine.
 *
 * Specification:
 *   docs/trading/06-risk-engine-specification.md, "Vertrag"
 *   docs/trading/03-domain-model.md, RiskAssessment / RiskRuleResult / TradeDecision
 *   docs/trading/decisions/0003-deterministic-versioned-engines.md
 *
 * Everything crossing this boundary is plain JSON: ISO-8601 UTC strings and
 * canonical fixed-scale decimal strings. No `Date`, no `number` for a monetary
 * value, no class instance — so `evaluateRisk` is byte-reproducible and the
 * snapshot can be stored verbatim in `RiskAssessment.inputsJson`.
 *
 * Nothing in here reads a database, a clock, the network or `process.env`.
 * The caller supplies every value, including `asOf`.
 */

import type { DecimalString } from "@signalpilot/trading-domain";

import type { RiskEvaluationOutcome, RiskReasonCode, RiskRuleCode } from "./reason-codes.js";

export type IsoDateTimeString = string;
/** Calendar day in UTC, `YYYY-MM-DD` — the business date for daily limits. */
export type UtcDateString = string;

export const RISK_INPUT_SNAPSHOT_VERSION = "RISK_INPUT_SNAPSHOT_V1";

// ───────────────────────────────────────────────────────────────────────────
// Snapshot parts
// ───────────────────────────────────────────────────────────────────────────

/** Build and configuration capability, assembled outside this package. */
export interface RiskCapabilityInputV1 {
  readonly buildCapability: string;
  readonly tradingMode: string;
  readonly enableLiveTrading: boolean;
  readonly shadowMasterFlagEnabled: boolean;
  readonly riskJobEnabled: boolean;
}

/**
 * The candidate under assessment. Every price is the strategy's own plan; the
 * risk engine never recomputes a strategy decision, it only checks it.
 *
 * The nullable plan fields exist because `TradeCandidate` gained them in an
 * additive migration. A null is never tolerated: `R-026` refuses the
 * assessment with `CANDIDATE_PLAN_INCOMPLETE` rather than assuming a value.
 */
export interface RiskCandidateInputV1 {
  readonly id: string;
  readonly candidateKey: string;
  readonly status: string;
  readonly direction: string;
  readonly entryType: string;
  readonly symbol: string;
  readonly assetId: string;
  readonly portfolioId: string;
  readonly strategyAssignmentId: string;
  readonly strategyVersionId: string;
  readonly strategyVersionStatus: string;
  readonly strategyKey: string;
  readonly assignmentEnabled: boolean;
  readonly anchorCandleId: string;

  readonly referenceEntryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly takeProfitPrice: DecimalString;
  readonly minimumRewardRisk: DecimalString;

  readonly stopDistance: DecimalString | null;
  readonly stopDistancePct: DecimalString | null;
  readonly plannedRewardRisk: DecimalString | null;
  readonly plannedEntryMinimum: DecimalString | null;
  readonly plannedEntryMaximum: DecimalString | null;
  readonly maximumEntryGapDistance: DecimalString | null;
  readonly validFrom: IsoDateTimeString | null;
  readonly earliestFillAt: IsoDateTimeString | null;
  readonly maxHoldHours: number | null;

  readonly dataAsOf: IsoDateTimeString;
  readonly decisionTime: IsoDateTimeString;
  readonly expiresAt: IsoDateTimeString;

  readonly inputHash: string;
  readonly strategyOutputHash: string | null;
  readonly strategySpecificationHash: string | null;
  readonly strategyEngineVersion: string | null;

  /** Whether a final `TradeDecision` already exists for this candidate. */
  readonly hasFinalDecision: boolean;
}

export interface RiskAssetInputV1 {
  readonly id: string;
  readonly symbol: string;
  readonly assetType: string;
  readonly quoteCurrency: string | null;
  readonly isTradable: boolean;
  readonly isActive: boolean;
  readonly isLeveraged: boolean;
  readonly isInverse: boolean;
  readonly isStablecoin: boolean;
  readonly instrumentStatus: string;
}

export interface RiskSessionInputV1 {
  readonly id: string;
  readonly sessionKey: string;
  readonly portfolioId: string;
  readonly mode: string;
  readonly status: string;
  readonly killSwitchEngaged: boolean;
  readonly reconciledAt: IsoDateTimeString | null;
  readonly heartbeatAt: IsoDateTimeString | null;
  readonly version: number;
}

export interface RiskPortfolioInputV1 {
  readonly id: string;
  readonly key: string;
  readonly status: string;
  readonly baseCurrency: string;
  readonly startingCash: DecimalString;
  readonly availableCash: DecimalString;
  readonly reservedCash: DecimalString;
  readonly realizedPnl: DecimalString;
  readonly feesPaid: DecimalString;
  readonly equity: DecimalString;
  readonly highWaterMark: DecimalString;
  readonly ledgerSequence: number;
  readonly lastReconciledAt: IsoDateTimeString | null;
  readonly version: number;
}

/**
 * Result of replaying `PortfolioLedgerEntry` up to `sequence`. `R-003` compares
 * it against the portfolio caches instead of trusting either side
 * (docs/trading/06, "Portfolio-Konsistenz und Toleranz").
 */
export interface RiskLedgerReplayInputV1 {
  readonly sequence: number;
  readonly entryCount: number;
  readonly availableCash: DecimalString;
  readonly reservedCash: DecimalString;
  readonly realizedPnl: DecimalString;
  readonly feesPaid: DecimalString;
  /** Ledger rows pointing at an order, fill or position that does not exist. */
  readonly orphanReferenceCount: number;
  /** Gaps in the `(portfolioId, sequence)` chain. */
  readonly sequenceGapCount: number;
}

/** One exposure-carrying position. `ERROR` positions count as open. */
export interface RiskOpenPositionInputV1 {
  readonly id: string;
  readonly positionKey: string;
  readonly assetId: string;
  readonly symbol: string;
  readonly status: string;
  readonly openQuantity: DecimalString;
  readonly averageEntryPrice: DecimalString;
  /** Conservative bid mark × open quantity (docs/trading/07). */
  readonly marketValue: DecimalString;
}

/** Cash reserved by a non-terminal order. Counts towards exposure. */
export interface RiskReservationInputV1 {
  readonly shadowOrderId: string;
  readonly assetId: string;
  readonly symbol: string;
  readonly status: string;
  readonly reservedQuoteAmount: DecimalString;
}

export interface RiskDailyCountersInputV1 {
  readonly tradingDateUtc: UtcDateString;
  /** Entry orders with at least one fill today. Partial fills count once. */
  readonly filledEntryOrdersToday: number;
  /** Chronological net-negative closed trades; break-even does not reset. */
  readonly consecutiveLosses: number;
  /** `currentEquity - startOfDayEquity`, negative when losing. */
  readonly dailyPnl: DecimalString;
  /** Last closed-trade sequence the counters were derived from. */
  readonly closedTradeSequence: number;
}

export interface RiskStartOfDayInputV1 {
  readonly asOf: IsoDateTimeString;
  readonly sourceLedgerSequence: number;
  readonly equity: DecimalString;
}

export interface RiskExecutionProfileInputV1 {
  readonly id: string;
  readonly assetId: string;
  readonly version: number;
  readonly status: string;
  readonly tickSize: DecimalString;
  readonly stepSize: DecimalString;
  readonly minQuantity: DecimalString;
  readonly minNotional: DecimalString;
  /** Optional venue cap. `null` when the profile does not declare one. */
  readonly maxQuantity: DecimalString | null;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: DecimalString;
  readonly sourceObservedAt: IsoDateTimeString;
  readonly specificationHash: string;
}

export interface RiskLimitSetInputV1 {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly status: string;
  readonly scope: string;
  readonly maxRiskPerTradePct: DecimalString;
  readonly maxDailyLossPct: DecimalString;
  readonly minRewardRisk: DecimalString;
  readonly maxOpenPositions: number;
  readonly maxNewTradesPerDay: number;
  readonly maxConsecutiveLosses: number;
  readonly maxGrossExposurePct: DecimalString;
  readonly maxAssetExposurePct: DecimalString;
  readonly maxCorrelatedExposurePct: DecimalString;
  readonly maxSpreadBps: number;
  readonly maxSlippageBps: number;
  readonly specificationHash: string;
}

/** Freshness ages in milliseconds, measured against `asOf` by the assembler. */
export interface RiskDataFreshnessInputV1 {
  readonly candleAgeMs: Readonly<Record<"1h" | "4h" | "1d", number | null>>;
  readonly dataQualityAgeMs: number | null;
  readonly regimeAgeMs: number | null;
  readonly portfolioSnapshotAgeMs: number | null;
  /** True when any referenced source carries a timestamp after `asOf`. */
  readonly hasFutureTimestamp: boolean;
}

export interface RiskDataQualityInputV1 {
  readonly minimumClosedCandles: Readonly<Record<"1h" | "4h" | "1d", number | null>>;
  readonly gapCount: Readonly<Record<"1h" | "4h" | "1d", number | null>>;
  readonly providerErrorCount: Readonly<Record<"1h" | "4h" | "1d", number | null>>;
  readonly ohlcContradiction: boolean;
}

export interface RiskRegimeInputV1 {
  readonly id: string;
  readonly generatedAt: IsoDateTimeString;
  readonly cryptoRegime: string;
  readonly riskMode: string;
  readonly confidence: number;
}

/** Fixed correlation group. v1 assigns BTC and ETH deterministically. */
export interface RiskCorrelationGroupInputV1 {
  readonly key: string;
  readonly memberSymbols: readonly string[];
}

/**
 * Anything that could make the size non-deterministic. All of it must be
 * absent; a present value is a `R-023` critical finding, never an input to the
 * formula (docs/trading/06, `R-023-NO-MARTINGALE`).
 */
export interface RiskSizeOverrideInputV1 {
  readonly manualQuantity: DecimalString | null;
  readonly riskMultiplier: DecimalString | null;
  readonly requestedBy: string | null;
}

/** Previous approved sizing, used by `R-024-NO-POST-LOSS-INCREASE`. */
export interface RiskPreviousApprovalInputV1 {
  readonly assessedAt: IsoDateTimeString;
  readonly equity: DecimalString;
  readonly riskAmount: DecimalString;
}

/** Existing assessment for the same key — the idempotency probe for `R-026`. */
export interface RiskExistingAssessmentInputV1 {
  readonly assessmentKey: string;
  readonly inputHash: string;
  readonly status: string;
}

export interface RiskPolicyVersionsInputV1 {
  readonly riskEngineVersion: string;
  readonly ruleSetVersion: string;
  readonly sizingPolicyVersion: string;
  readonly costPolicyVersion: string;
  readonly inputAssemblerVersion: string;
  /** Git commit or immutable build identifier of the evaluating worker. */
  readonly codeVersion: string;
}

/** The complete, immutable decision input (docs/trading/06, "Vertrag"). */
export interface RiskInputSnapshotV1 {
  readonly snapshotVersion: typeof RISK_INPUT_SNAPSHOT_VERSION;
  readonly asOf: IsoDateTimeString;
  readonly tradingDateUtc: UtcDateString;
  readonly capability: RiskCapabilityInputV1;
  readonly candidate: RiskCandidateInputV1;
  readonly asset: RiskAssetInputV1;
  readonly session: RiskSessionInputV1 | null;
  readonly portfolio: RiskPortfolioInputV1;
  readonly ledgerReplay: RiskLedgerReplayInputV1;
  readonly startOfDay: RiskStartOfDayInputV1 | null;
  readonly openPositions: readonly RiskOpenPositionInputV1[];
  readonly reservations: readonly RiskReservationInputV1[];
  readonly dailyCounters: RiskDailyCountersInputV1;
  readonly executionProfile: RiskExecutionProfileInputV1 | null;
  readonly riskLimitSet: RiskLimitSetInputV1 | null;
  readonly freshness: RiskDataFreshnessInputV1;
  readonly dataQuality: RiskDataQualityInputV1;
  readonly marketRegime: RiskRegimeInputV1 | null;
  readonly correlationGroup: RiskCorrelationGroupInputV1 | null;
  readonly sizeOverride: RiskSizeOverrideInputV1;
  readonly previousApproval: RiskPreviousApprovalInputV1 | null;
  readonly existingAssessment: RiskExistingAssessmentInputV1 | null;
  readonly policyVersions: RiskPolicyVersionsInputV1;
}

// ───────────────────────────────────────────────────────────────────────────
// Output
// ───────────────────────────────────────────────────────────────────────────

/** Draft of one `RiskRuleResult` row (docs/trading/03). */
export interface RiskRuleResultDraftV1 {
  readonly ruleCode: RiskRuleCode;
  readonly ruleVersion: string;
  readonly outcome: "PASS" | "FAIL" | "WARN" | "ERROR";
  readonly severity: "INFO" | "WARNING" | "BLOCKER" | "CRITICAL";
  readonly reasonCode: RiskReasonCode;
  /** Safe for display; never contains a secret or a raw provider payload. */
  readonly message: string;
  readonly actualValue: DecimalString | null;
  readonly limitValue: DecimalString | null;
  readonly unit: string | null;
  readonly inputJson: Readonly<Record<string, unknown>>;
  readonly evaluatedAt: IsoDateTimeString;
}

/** Which limit, if any, capped the raw quantity. */
export const SizingCap = {
  NONE: "NONE",
  RISK_BUDGET: "RISK_BUDGET",
  AVAILABLE_CASH: "AVAILABLE_CASH",
  GROSS_EXPOSURE: "GROSS_EXPOSURE",
  ASSET_EXPOSURE: "ASSET_EXPOSURE",
  CORRELATED_EXPOSURE: "CORRELATED_EXPOSURE",
  INSTRUMENT_MAXIMUM: "INSTRUMENT_MAXIMUM"
} as const;
export type SizingCap = (typeof SizingCap)[keyof typeof SizingCap];

/**
 * Full cost and sizing bridge. Every number is derived, in order, from the
 * inputs above so an auditor can recompute it by hand.
 */
export interface RiskSizingResultV1 {
  readonly computable: boolean;
  readonly riskBudget: DecimalString;
  readonly fullSpreadRate: DecimalString;
  readonly slippageRate: DecimalString;
  readonly feeRate: DecimalString;
  readonly worstEntryPrice: DecimalString;
  readonly worstStopFillPrice: DecimalString;
  readonly worstTakeProfitFillPrice: DecimalString;
  readonly entryFeePerUnit: DecimalString;
  readonly stopExitFeePerUnit: DecimalString;
  readonly roundTripFeesPerUnit: DecimalString;
  readonly perUnitRisk: DecimalString;
  readonly rawQuantity: DecimalString;
  readonly cashCapQuantity: DecimalString;
  readonly grossExposureCapQuantity: DecimalString;
  readonly assetExposureCapQuantity: DecimalString;
  readonly correlatedExposureCapQuantity: DecimalString;
  readonly instrumentMaximumQuantity: DecimalString | null;
  readonly cappedBy: SizingCap;
  readonly approvedQuantity: DecimalString;
  readonly notional: DecimalString;
  readonly entryFeeTotal: DecimalString;
  readonly reservedQuoteAmount: DecimalString;
  readonly riskAmount: DecimalString;
  /** `(TP - worstEntry) / perUnitRisk` — the `R-008` measure. */
  readonly netRewardRisk: DecimalString;
  /**
   * Stricter variant that also charges the adverse take-profit fill and its
   * exit fee. Reported for transparency; `R-008` does not block on it.
   */
  readonly conservativeRewardRisk: DecimalString;
  readonly postTradeGrossExposure: DecimalString;
  readonly postTradeAssetExposure: DecimalString;
  readonly postTradeCorrelatedExposure: DecimalString;
}

/** Draft of the `RiskAssessment` row (docs/trading/03). */
export interface RiskAssessmentDraftV1 {
  readonly assessmentKey: string;
  readonly tradeCandidateId: string;
  readonly portfolioId: string;
  readonly riskLimitSetId: string | null;
  readonly status: "PASS" | "FAIL" | "ERROR";
  readonly ruleSetVersion: string;
  readonly equity: DecimalString;
  readonly availableCash: DecimalString;
  readonly reservedCash: DecimalString;
  readonly dailyPnl: DecimalString;
  readonly openPositionCount: number;
  readonly newTradesToday: number;
  readonly consecutiveLosses: number;
  readonly grossExposure: DecimalString;
  readonly assetExposure: DecimalString;
  readonly correlatedExposure: DecimalString;
  readonly requestedQuantity: DecimalString;
  readonly approvedQuantity: DecimalString;
  readonly riskAmount: DecimalString;
  readonly tradingDateUtc: UtcDateString;
  readonly portfolioSnapshotAsOf: IsoDateTimeString;
  readonly marketDataAsOf: IsoDateTimeString;
  readonly sizing: RiskSizingResultV1;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly assessedAt: IsoDateTimeString;
}

/** Draft of the single final `TradeDecision` (docs/trading/03). */
export interface TradeDecisionDraftV1 {
  readonly decisionKey: string;
  readonly tradeCandidateId: string;
  readonly outcome: "APPROVE_SHADOW" | "REJECT" | "EXPIRE" | "CANCEL" | "ERROR";
  readonly reasonCode: RiskReasonCode;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly decidedAt: IsoDateTimeString;
}

export interface RiskEvaluationResultV1 {
  readonly outcome: RiskEvaluationOutcome;
  /** Session-level directive; orchestration applies it, the engine never does. */
  readonly directive: "NONE" | "BLOCK_NEW" | "ENGAGE_KILL_SWITCH" | "ERROR_LOCK";
  readonly primaryReasonCode: RiskReasonCode;
  /** All 26 results in `RISK_RULE_ORDER`, PASS results included. */
  readonly ruleResults: readonly RiskRuleResultDraftV1[];
  readonly assessment: RiskAssessmentDraftV1;
  readonly decision: TradeDecisionDraftV1;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly policyHash: string;
  readonly engineVersion: string;
  readonly ruleSetVersion: string;
  readonly evaluatedAt: IsoDateTimeString;
}
