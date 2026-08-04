/**
 * Input and output contracts of the strategy engine.
 *
 * Specification:
 *   docs/trading/05-strategy-v1-specification.md, "Eingangsdaten-Snapshot"
 *   docs/trading/02-shadow-trading-target-architecture.md, module table
 *   docs/trading/decisions/0003-deterministic-versioned-engines.md
 *
 * Every value crossing this boundary is plain JSON: timestamps are ISO-8601 UTC
 * strings and money/price/quantity/rate values are canonical decimal strings.
 * There is no `Date`, no `number` for a monetary value and no class instance, so
 * a snapshot serialises byte-identically on every host and can be stored in
 * `TradeCandidate.inputSnapshotJson` without a conversion step.
 */

import type { DecimalString } from "@signalpilot/trading-domain";

import type {
  StrategyCheckStage,
  StrategyEvaluationOutcome,
  StrategyReasonCode
} from "./reason-codes.js";

/** ISO-8601 UTC instant with millisecond precision, e.g. `2026-08-02T09:00:00.000Z`. */
export type IsoDateTimeString = string;

export const STRATEGY_INPUT_SNAPSHOT_VERSION = "STRATEGY_INPUT_SNAPSHOT_V1";

export const STRATEGY_TIMEFRAMES = ["1h", "4h", "1d"] as const;
export type StrategyTimeframe = (typeof STRATEGY_TIMEFRAMES)[number];

/** Interval length of each supported timeframe in milliseconds. */
export const TIMEFRAME_INTERVAL_MS: Readonly<
  Record<StrategyTimeframe, number>
> = Object.freeze({
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
});

// ───────────────────────────────────────────────────────────────────────────
// Snapshot parts
// ───────────────────────────────────────────────────────────────────────────

/** One closed candle exactly as persisted (docs/trading/05, snapshot fields). */
export interface SnapshotCandleV1 {
  readonly id: string;
  readonly openTime: IsoDateTimeString;
  readonly closeTime: IsoDateTimeString;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly close: DecimalString;
  readonly volume: DecimalString;
  readonly source: string;
}

/** `CandleDataQuality` for one timeframe, including its own observation time. */
export interface SnapshotDataQualityV1 {
  readonly id: string;
  readonly provider: string;
  readonly timeframe: StrategyTimeframe;
  readonly observedAt: IsoDateTimeString;
  readonly latestClosedCandle: IsoDateTimeString | null;
  readonly candleCount: number;
  readonly expectedCandleCount: number;
  readonly gapCount: number;
  readonly missingCandleCount: number;
  readonly providerErrorCount: number;
  readonly rateLimitCount: number;
  readonly entitlementErrorCount: number;
  readonly noDataCount: number;
  readonly lastErrorKind: string | null;
}

/** Closed candle history plus its data-quality snapshot for one timeframe. */
export interface SnapshotSeriesV1 {
  readonly timeframe: StrategyTimeframe;
  /** Ascending by `openTime`, all closed, newest last. */
  readonly candles: readonly SnapshotCandleV1[];
  readonly dataQuality: SnapshotDataQualityV1 | null;
}

/**
 * An exactly referenced existing signal. `baseScore` is `Signal.score`,
 * `adjustedScore` comes from `SignalRuleApplication.adjustedScore` and falls
 * back to the base score only when no rule application exists — the fallback is
 * recorded in `adjustedScoreSource` so it stays visible in the hash.
 */
export interface SnapshotSignalV1 {
  readonly id: string;
  readonly timeframe: StrategyTimeframe;
  readonly signalType: string;
  readonly status: string;
  readonly direction: string;
  readonly riskLevel: string;
  readonly baseScore: number;
  readonly adjustedScore: number;
  readonly adjustedScoreSource: "RULE_APPLICATION" | "BASE_SCORE";
  readonly adjustedStatus: string | null;
  readonly riskScore: number;
  readonly ruleApplicationId: string | null;
  readonly outputId: string | null;
  readonly createdAt: IsoDateTimeString;
}

/**
 * Deterministic multi-timeframe summary derived from the referenced signals.
 * `alignmentScore` is normalised to `[0, 1]`; `alignmentScoreRaw` keeps the
 * 0–100 integer that `@signalpilot/multi-timeframe` returns.
 */
export interface SnapshotMultiTimeframeV1 {
  readonly version: string;
  readonly alignment: string;
  readonly alignmentScore: DecimalString;
  readonly alignmentScoreRaw: number;
  readonly primaryTimeframe: string | null;
  readonly confirmingTimeframes: readonly string[];
  readonly conflictingTimeframes: readonly string[];
  readonly riskLevel: string;
  readonly sourceSignalIds: readonly string[];
}

export interface SnapshotMarketRegimeV1 {
  readonly id: string;
  readonly generatedAt: IsoDateTimeString;
  readonly equityRegime: string;
  readonly cryptoRegime: string;
  readonly overallRegime: string;
  readonly riskMode: string;
  readonly confidence: number;
}

export interface SnapshotAssetV1 {
  readonly id: string;
  readonly symbol: string;
  readonly assetType: string;
  readonly exchange: string;
  readonly provider: string | null;
  readonly baseCurrency: string | null;
  readonly quoteCurrency: string | null;
  readonly instrumentStatus: string;
  readonly isActive: boolean;
  readonly isTradable: boolean;
  readonly isLeveraged: boolean;
  readonly isInverse: boolean;
  readonly isStablecoin: boolean;
}

export interface SnapshotStrategyVersionV1 {
  readonly strategyId: string;
  readonly strategyKey: string;
  readonly strategyVersionId: string;
  readonly version: number;
  readonly status: string;
  readonly engineVersion: string;
  readonly codeVersion: string;
  readonly specificationHash: string;
}

export interface SnapshotAssignmentV1 {
  readonly id: string;
  readonly portfolioId: string;
  readonly timeframe: string;
  readonly enabled: boolean;
  readonly validFrom: IsoDateTimeString | null;
  readonly validTo: IsoDateTimeString | null;
}

export interface SnapshotExecutionProfileV1 {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly tickSize: DecimalString;
  readonly stepSize: DecimalString;
  readonly minQuantity: DecimalString;
  readonly minNotional: DecimalString;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: DecimalString;
  readonly source: string;
  readonly sourceObservedAt: IsoDateTimeString;
  readonly specificationHash: string;
}

/**
 * Radar, news and market-event context inside its defined window. The list is
 * mandatory but may be empty; empty or neutral never counts as confirmation
 * (docs/trading/05, "News/Event ist optionaler Evidenzkontext").
 */
export interface SnapshotContextEventV1 {
  readonly kind: "RADAR" | "NEWS" | "MARKET_EVENT";
  readonly id: string;
  readonly observedAt: IsoDateTimeString;
  readonly eventType: string;
  readonly severity: string;
  /** `BEARISH`, `BULLISH` or `NEUTRAL` — derived deterministically, never by an LLM. */
  readonly directionalBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  readonly summary: string;
}

/** Versions of every calculation the snapshot depends on. */
export interface SnapshotPolicyVersionsV1 {
  readonly inputAssemblerVersion: string;
  readonly indicatorVersion: string;
  readonly multiTimeframeVersion: string;
  readonly breakoutPolicyVersion: string;
  readonly freshnessPolicyVersion: string;
}

/**
 * Complete, immutable decision input (docs/trading/05, "Eingangsdaten-Snapshot").
 * A reference to "latest" without an id and `asOf` is not permitted, so every
 * referenced source carries its own id and observation time.
 */
export interface StrategyInputSnapshotV1 {
  readonly snapshotVersion: typeof STRATEGY_INPUT_SNAPSHOT_VERSION;
  readonly asOf: IsoDateTimeString;
  readonly asset: SnapshotAssetV1;
  readonly strategy: SnapshotStrategyVersionV1;
  readonly assignment: SnapshotAssignmentV1;
  readonly series: Readonly<Record<StrategyTimeframe, SnapshotSeriesV1>>;
  readonly signals: Readonly<
    Record<StrategyTimeframe, SnapshotSignalV1 | null>
  >;
  readonly multiTimeframe: SnapshotMultiTimeframeV1 | null;
  readonly marketRegime: SnapshotMarketRegimeV1 | null;
  readonly executionProfile: SnapshotExecutionProfileV1 | null;
  readonly contextEvents: readonly SnapshotContextEventV1[];
  readonly policyVersions: SnapshotPolicyVersionsV1;
}

// ───────────────────────────────────────────────────────────────────────────
// Output
// ───────────────────────────────────────────────────────────────────────────

/** One evaluated condition, kept for both pass and fail so the audit is complete. */
export interface StrategyCheckV1 {
  /** Stable identifier of the condition, e.g. `BREAKOUT_PRIOR_HIGH`. */
  readonly checkId: string;
  readonly stage: StrategyCheckStage;
  readonly passed: boolean;
  /** Pass code when `passed`, refusal code otherwise. */
  readonly reasonCode: StrategyReasonCode;
  /** Compared value as a canonical decimal string, when the check is scalar. */
  readonly actual: string | null;
  /** Threshold the value was compared against, when the check is scalar. */
  readonly limit: string | null;
}

/** Evidence draft for `TradeCandidateEvidence` (docs/trading/03). */
export interface StrategyEvidenceDraftV1 {
  readonly type:
    | "CANDLE"
    | "SIGNAL"
    | "MTF"
    | "REGIME"
    | "DATA_QUALITY"
    | "RADAR"
    | "NEWS"
    | "EVENT"
    | "DISCOVERY"
    | "EXECUTION_PROFILE";
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly sourceKey: string;
  readonly observedAt: IsoDateTimeString;
  readonly capturedAt: IsoDateTimeString;
  readonly required: boolean;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
}

/**
 * Indicator values the decision used, carried into the candidate for review.
 * Every value is a canonical decimal string computed with `indicators-v1`.
 */
export interface StrategyIndicatorSnapshotV1 {
  readonly close1h: DecimalString;
  readonly sma20_1h: DecimalString;
  readonly sma50_1h: DecimalString;
  readonly sma200_1h: DecimalString;
  readonly rsi14_1h: DecimalString;
  readonly atr14_1h: DecimalString;
  readonly atrToClose1h: DecimalString;
  /** Long breakout reference. Absent on a short candidate. */
  readonly priorHigh20_1h?: DecimalString;
  /** Short breakdown reference. Absent on a long candidate. */
  readonly priorLow20_1h?: DecimalString;
  /**
   * Signed distance of the anchor close beyond its reference level, always
   * expressed as a positive magnitude of the move that confirmed the setup:
   * `close − priorHigh` for a breakout, `priorLow − close` for a breakdown.
   */
  readonly breakoutDistance: DecimalString;
  readonly breakoutDistancePct: DecimalString;
  readonly averageVolume20_1h: DecimalString;
  readonly relativeVolume1h: DecimalString;
  readonly close4h: DecimalString;
  readonly sma50_4h: DecimalString;
  readonly sma200_4h: DecimalString;
  readonly close1d: DecimalString;
  readonly sma50_1d: DecimalString;
  readonly sma200_1d: DecimalString;
}

/**
 * Complete candidate draft. It is a proposal only: no quantity, no risk budget
 * and no order — sizing belongs to the risk engine (docs/trading/05,
 * "Positionsgrößenformel").
 */
export interface TradeCandidateDraftV1 {
  readonly candidateKey: string;
  readonly strategyKey: string;
  readonly strategyVersionId: string;
  readonly strategyAssignmentId: string;
  readonly portfolioId: string;
  readonly assetId: string;
  readonly symbol: string;
  readonly anchorCandleId: string;
  readonly anchorSignalId: string | null;
  /**
   * `LONG` for `CRYPTO_MTF_BREAKOUT_LONG_V1`, `SHORT` for
   * `CRYPTO_MTF_BREAKDOWN_SHORT_V1`. A short is a synthetic, unleveraged
   * shadow simulation only (ADR 0012).
   */
  readonly direction: "LONG" | "SHORT";
  readonly entryType: "MARKET";
  /** Draft status; the worker persists the candidate in exactly this state. */
  readonly status: "CREATED";
  readonly dataAsOf: IsoDateTimeString;
  readonly decisionTime: IsoDateTimeString;
  readonly validFrom: IsoDateTimeString;
  readonly earliestFillAt: IsoDateTimeString;
  readonly expiresAt: IsoDateTimeString;
  readonly referenceEntryPrice: DecimalString;
  readonly plannedEntryMinimum: DecimalString;
  readonly plannedEntryMaximum: DecimalString;
  readonly maximumEntryGapDistance: DecimalString;
  readonly stopPrice: DecimalString;
  readonly stopDistance: DecimalString;
  readonly stopDistancePct: DecimalString;
  readonly takeProfitPrice: DecimalString;
  readonly minimumRewardRisk: DecimalString;
  readonly plannedRewardRisk: DecimalString;
  readonly maxHoldHours: number;
  readonly indicators: StrategyIndicatorSnapshotV1;
  readonly evidence: readonly StrategyEvidenceDraftV1[];
  readonly reasonCodes: readonly StrategyReasonCode[];
  readonly engineVersion: string;
  readonly specificationHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

interface StrategyEvaluationBaseV1 {
  readonly strategyKey: string;
  readonly engineVersion: string;
  readonly specificationHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly evaluatedAt: IsoDateTimeString;
  /** Sorted, de-duplicated. Pass codes on success, refusal codes otherwise. */
  readonly reasonCodes: readonly StrategyReasonCode[];
  /** Every evaluated condition in a stable order, passing and failing alike. */
  readonly checks: readonly StrategyCheckV1[];
}

export interface StrategyCandidateResultV1 extends StrategyEvaluationBaseV1 {
  readonly outcome: typeof StrategyEvaluationOutcome.CANDIDATE;
  readonly candidate: TradeCandidateDraftV1;
}

export interface StrategyNoCandidateResultV1 extends StrategyEvaluationBaseV1 {
  readonly outcome: typeof StrategyEvaluationOutcome.NO_CANDIDATE;
  /** First refusal code in evaluation order — the primary persisted reason. */
  readonly primaryReasonCode: StrategyReasonCode;
  readonly candidate: null;
}

export interface StrategyInvalidInputResultV1 extends StrategyEvaluationBaseV1 {
  readonly outcome: typeof StrategyEvaluationOutcome.INVALID_INPUT;
  readonly primaryReasonCode: StrategyReasonCode;
  readonly candidate: null;
}

export type StrategyEvaluationResultV1 =
  | StrategyCandidateResultV1
  | StrategyNoCandidateResultV1
  | StrategyInvalidInputResultV1;

/**
 * A registered, immutable strategy. The registry never calls a clock, a
 * database or the network; `evaluate` is a pure function of its snapshot.
 */
export interface StrategyDefinitionV1 {
  readonly key: string;
  readonly engineVersion: string;
  readonly specificationHash: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly evaluate: (
    snapshot: StrategyInputSnapshotV1
  ) => StrategyEvaluationResultV1;
}
