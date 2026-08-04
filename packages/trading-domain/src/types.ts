/**
 * Pure domain types, enums and reason codes for SignalPilot Shadow Trading v1.
 *
 * Specification:
 *   docs/trading/03-domain-model.md  (aggregates, fields, constraints)
 *   docs/trading/04-state-machines.md (states, guards, terminal states)
 *   docs/trading/02-shadow-trading-target-architecture.md (module boundary)
 *
 * Boundary rule (docs/trading/02, module table): this package must never import
 * Prisma, network clients, `process.env`, the system clock or a scheduler.
 * Every value here is data or a pure function input.
 */

// ───────────────────────────────────────────────────────────────────────────
// Value transport
// ───────────────────────────────────────────────────────────────────────────

/**
 * Money, price, quantity, rate and P&L crossing a package boundary.
 *
 * Always a canonical fixed-scale decimal string (see `DecimalValue`), never a
 * JavaScript number — docs/trading/02, "Idempotenz und Concurrency".
 */
export type DecimalString = string;

/** Actor behind a state change (docs/trading/03, TradingAuditEvent). */
export const TradingActorType = {
  SYSTEM: "SYSTEM",
  ADMIN: "ADMIN",
  RECOVERY: "RECOVERY"
} as const;
export type TradingActorType =
  (typeof TradingActorType)[keyof typeof TradingActorType];

// ───────────────────────────────────────────────────────────────────────────
// Reason codes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Stable, machine-readable reason codes.
 *
 * These strings are persisted (`invalidReasonCode`, `cancelReasonCode`,
 * `reasonCode`, `killReasonCode`, audit records) and consumed by the dashboard.
 * They are append-only: never rename or reuse a code.
 */
export const TradingReasonCode = {
  // ── Decimal value object ────────────────────────────────────────────────
  DECIMAL_INVALID_FORMAT: "DECIMAL_INVALID_FORMAT",
  DECIMAL_SCALE_EXCEEDED: "DECIMAL_SCALE_EXCEEDED",
  DECIMAL_PRECISION_EXCEEDED: "DECIMAL_PRECISION_EXCEEDED",
  DECIMAL_ROUNDING_REQUIRED: "DECIMAL_ROUNDING_REQUIRED",
  DECIMAL_DIVISION_BY_ZERO: "DECIMAL_DIVISION_BY_ZERO",
  DECIMAL_INVALID_STEP: "DECIMAL_INVALID_STEP",
  DECIMAL_FLOAT_INPUT_FORBIDDEN: "DECIMAL_FLOAT_INPUT_FORBIDDEN",

  // ── Canonical JSON / hashing ────────────────────────────────────────────
  CANONICAL_JSON_UNSUPPORTED_VALUE: "CANONICAL_JSON_UNSUPPORTED_VALUE",
  CANONICAL_JSON_NON_FINITE_NUMBER: "CANONICAL_JSON_NON_FINITE_NUMBER",
  CANONICAL_JSON_CIRCULAR_REFERENCE: "CANONICAL_JSON_CIRCULAR_REFERENCE",

  // ── Idempotency, versioning, sequences ──────────────────────────────────
  IDEMPOTENCY_KEY_PART_EMPTY: "IDEMPOTENCY_KEY_PART_EMPTY",
  IDEMPOTENCY_KEY_PART_INVALID: "IDEMPOTENCY_KEY_PART_INVALID",
  IDEMPOTENCY_OR_VERSION_CONFLICT: "IDEMPOTENCY_OR_VERSION_CONFLICT",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  SEQUENCE_NOT_CONTIGUOUS: "SEQUENCE_NOT_CONTIGUOUS",
  SEQUENCE_MUST_BE_POSITIVE: "SEQUENCE_MUST_BE_POSITIVE",

  // ── Generic transition guard ────────────────────────────────────────────
  TRANSITION_NOT_ALLOWED: "TRANSITION_NOT_ALLOWED",
  TERMINAL_STATE_IMMUTABLE: "TERMINAL_STATE_IMMUTABLE",
  UNKNOWN_STATE: "UNKNOWN_STATE",

  // ── Direction and price plan ────────────────────────────────────────────
  DIRECTION_UNKNOWN: "DIRECTION_UNKNOWN",
  PRICE_PLAN_NOT_ORDERED: "PRICE_PLAN_NOT_ORDERED",
  PRICE_PLAN_NOT_POSITIVE: "PRICE_PLAN_NOT_POSITIVE",

  // ── Trade candidate ─────────────────────────────────────────────────────
  CANDIDATE_INVALID_REASON_CODE_REQUIRED:
    "CANDIDATE_INVALID_REASON_CODE_REQUIRED",
  CANDIDATE_CANCEL_REASON_CODE_REQUIRED:
    "CANDIDATE_CANCEL_REASON_CODE_REQUIRED",
  CANDIDATE_NOT_EXPIRED: "CANDIDATE_NOT_EXPIRED",
  CANDIDATE_HAS_ENTRY_ORDER: "CANDIDATE_HAS_ENTRY_ORDER",
  CANDIDATE_SNAPSHOT_INCOMPLETE: "CANDIDATE_SNAPSHOT_INCOMPLETE",
  CANDIDATE_RISK_NOT_PASSED: "CANDIDATE_RISK_NOT_PASSED",
  CANDIDATE_DECISION_REQUIRED: "CANDIDATE_DECISION_REQUIRED",
  CANDIDATE_CLAIM_REQUIRED: "CANDIDATE_CLAIM_REQUIRED",

  // ── Trade decision ──────────────────────────────────────────────────────
  DECISION_ALREADY_FINAL: "DECISION_ALREADY_FINAL",
  DECISION_OUTCOME_MISMATCH: "DECISION_OUTCOME_MISMATCH",
  DECISION_REASON_CODE_REQUIRED: "DECISION_REASON_CODE_REQUIRED",
  DECISION_RISK_ASSESSMENT_REQUIRED: "DECISION_RISK_ASSESSMENT_REQUIRED",
  DECISION_CANDIDATE_NOT_READY: "DECISION_CANDIDATE_NOT_READY",

  // ── Risk assessment ─────────────────────────────────────────────────────
  RISK_ASSESSMENT_IMMUTABLE: "RISK_ASSESSMENT_IMMUTABLE",
  RISK_RULE_RESULT_DUPLICATE: "RISK_RULE_RESULT_DUPLICATE",

  // ── Shadow order ────────────────────────────────────────────────────────
  ORDER_REJECTION_REASON_CODE_REQUIRED: "ORDER_REJECTION_REASON_CODE_REQUIRED",
  ORDER_CANCEL_REASON_CODE_REQUIRED: "ORDER_CANCEL_REASON_CODE_REQUIRED",
  ORDER_RESERVATION_REQUIRED: "ORDER_RESERVATION_REQUIRED",
  ORDER_EARLIEST_FILL_AT_REQUIRED: "ORDER_EARLIEST_FILL_AT_REQUIRED",
  ORDER_REMAINING_QUANTITY_MISMATCH: "ORDER_REMAINING_QUANTITY_MISMATCH",
  ORDER_TYPE_NOT_SUPPORTED: "ORDER_TYPE_NOT_SUPPORTED",
  ORDER_TIME_IN_FORCE_NOT_SUPPORTED: "ORDER_TIME_IN_FORCE_NOT_SUPPORTED",
  ORDER_DIRECTION_NOT_SUPPORTED: "ORDER_DIRECTION_NOT_SUPPORTED",
  ORDER_MODIFICATION_FORBIDDEN: "ORDER_MODIFICATION_FORBIDDEN",

  // ── Shadow position ─────────────────────────────────────────────────────
  POSITION_EXIT_PLAN_REQUIRED: "POSITION_EXIT_PLAN_REQUIRED",
  POSITION_ENTRY_NOT_SETTLED: "POSITION_ENTRY_NOT_SETTLED",
  POSITION_OPEN_QUANTITY_MUST_BE_ZERO: "POSITION_OPEN_QUANTITY_MUST_BE_ZERO",
  POSITION_OPEN_QUANTITY_MUST_BE_POSITIVE:
    "POSITION_OPEN_QUANTITY_MUST_BE_POSITIVE",
  POSITION_FINAL_TRIGGER_MISMATCH: "POSITION_FINAL_TRIGGER_MISMATCH",
  POSITION_SCALE_IN_FORBIDDEN: "POSITION_SCALE_IN_FORBIDDEN",

  // ── Exit plan ───────────────────────────────────────────────────────────
  EXIT_PLAN_TRIGGER_REQUIRED: "EXIT_PLAN_TRIGGER_REQUIRED",
  EXIT_PLAN_SOURCE_CANDLE_REQUIRED: "EXIT_PLAN_SOURCE_CANDLE_REQUIRED",
  EXIT_PLAN_POSITION_NOT_TERMINAL: "EXIT_PLAN_POSITION_NOT_TERMINAL",
  EXIT_PLAN_OPEN_EXITS_PRESENT: "EXIT_PLAN_OPEN_EXITS_PRESENT",
  EXIT_PLAN_EXPOSURE_PRESENT: "EXIT_PLAN_EXPOSURE_PRESENT",

  // ── Session, kill switch, locks ─────────────────────────────────────────
  SESSION_BLOCKS_CANDIDATE: "SESSION_BLOCKS_CANDIDATE",
  SESSION_BLOCKS_RISK_APPROVAL: "SESSION_BLOCKS_RISK_APPROVAL",
  SESSION_BLOCKS_ENTRY: "SESSION_BLOCKS_ENTRY",
  SESSION_KILL_SWITCH_ENGAGED: "SESSION_KILL_SWITCH_ENGAGED",
  SESSION_KILL_REASON_CODE_REQUIRED: "SESSION_KILL_REASON_CODE_REQUIRED",
  SESSION_LOCK_REASON_CODE_REQUIRED: "SESSION_LOCK_REASON_CODE_REQUIRED",
  SESSION_ADMIN_ACTOR_REQUIRED: "SESSION_ADMIN_ACTOR_REQUIRED",
  SESSION_IDEMPOTENCY_KEY_REQUIRED: "SESSION_IDEMPOTENCY_KEY_REQUIRED",
  SESSION_PORTFOLIO_NOT_ACTIVE: "SESSION_PORTFOLIO_NOT_ACTIVE",
  SESSION_RECONCILE_REQUIRED: "SESSION_RECONCILE_REQUIRED",
  SESSION_RECONCILE_STALE: "SESSION_RECONCILE_STALE",
  SESSION_RISK_LIMIT_SET_REQUIRED: "SESSION_RISK_LIMIT_SET_REQUIRED",
  SESSION_EXECUTION_PROFILE_REQUIRED: "SESSION_EXECUTION_PROFILE_REQUIRED",
  SESSION_ASSIGNMENT_REQUIRED: "SESSION_ASSIGNMENT_REQUIRED",
  SESSION_ASSIGNMENT_SCOPE_NOT_ALLOWED: "SESSION_ASSIGNMENT_SCOPE_NOT_ALLOWED",
  SESSION_UNACKNOWLEDGED_CRITICAL_RISK_EVENT:
    "SESSION_UNACKNOWLEDGED_CRITICAL_RISK_EVENT",
  SESSION_EXPIRED_CLAIMS_PRESENT: "SESSION_EXPIRED_CLAIMS_PRESENT",
  SESSION_UNKNOWN_OPEN_AGGREGATES: "SESSION_UNKNOWN_OPEN_AGGREGATES",
  SESSION_OPEN_EXPOSURE_PRESENT: "SESSION_OPEN_EXPOSURE_PRESENT",
  SESSION_OPEN_ORDERS_PRESENT: "SESSION_OPEN_ORDERS_PRESENT",
  SESSION_KILL_CAUSE_UNRESOLVED: "SESSION_KILL_CAUSE_UNRESOLVED",
  SESSION_RISK_EVENT_NOT_ACKNOWLEDGED: "SESSION_RISK_EVENT_NOT_ACKNOWLEDGED",
  SESSION_UNCLEAR_ORDERS_PRESENT: "SESSION_UNCLEAR_ORDERS_PRESENT",
  SESSION_CLOSED_READ_ONLY: "SESSION_CLOSED_READ_ONLY",
  SESSION_UNLOCK_AND_ACTIVATE_MUST_BE_SEPARATE:
    "SESSION_UNLOCK_AND_ACTIVATE_MUST_BE_SEPARATE",
  SESSION_KILL_SWITCH_RELEASE_NOT_ALLOWED:
    "SESSION_KILL_SWITCH_RELEASE_NOT_ALLOWED",

  // ── Build / configuration capability (fail-closed) ──────────────────────
  BUILD_CAPABILITY_NOT_SHADOW_ONLY: "BUILD_CAPABILITY_NOT_SHADOW_ONLY",
  MODE_NOT_SHADOW: "MODE_NOT_SHADOW",
  CONFIG_INVALID: "CONFIG_INVALID",
  LIVE_TRADING_FORBIDDEN: "LIVE_TRADING_FORBIDDEN",
  SHADOW_MASTER_FLAG_DISABLED: "SHADOW_MASTER_FLAG_DISABLED",

  // ── Portfolio consistency ───────────────────────────────────────────────
  PORTFOLIO_INCONSISTENT: "PORTFOLIO_INCONSISTENT",
  PORTFOLIO_NOT_ACTIVE: "PORTFOLIO_NOT_ACTIVE"
} as const;
export type TradingReasonCode =
  (typeof TradingReasonCode)[keyof typeof TradingReasonCode];

/** Every reason code, sorted, for exhaustiveness and stability tests. */
export const ALL_TRADING_REASON_CODES: readonly TradingReasonCode[] =
  Object.freeze(Object.values(TradingReasonCode).sort());

/** Domain failure carrying a stable, persistable reason code. */
export class TradingDomainError extends Error {
  readonly reasonCode: TradingReasonCode;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    reasonCode: TradingReasonCode,
    message: string,
    details: Readonly<Record<string, string>> = {}
  ) {
    super(message);
    this.name = "TradingDomainError";
    this.reasonCode = reasonCode;
    this.details = Object.freeze({ ...details });
  }
}

/** Result of a pure guard: either allowed, or refused with a stable code. */
export type GuardResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reasonCode: TradingReasonCode;
      readonly message: string;
    };

export const guardOk = (): GuardResult => ({ ok: true });

export const guardFail = (
  reasonCode: TradingReasonCode,
  message: string
): GuardResult => ({
  ok: false,
  reasonCode,
  message
});

// ───────────────────────────────────────────────────────────────────────────
// Strategy
// ───────────────────────────────────────────────────────────────────────────

export const StrategyStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  RETIRED: "RETIRED"
} as const;
export type StrategyStatus =
  (typeof StrategyStatus)[keyof typeof StrategyStatus];

export const StrategyVersionStatus = {
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
  ACTIVE: "ACTIVE",
  RETIRED: "RETIRED"
} as const;
export type StrategyVersionStatus =
  (typeof StrategyVersionStatus)[keyof typeof StrategyVersionStatus];

// ───────────────────────────────────────────────────────────────────────────
// Trade candidate, evidence, decision
// ───────────────────────────────────────────────────────────────────────────

/** v1 is long-only (docs/trading/06, R-005-LONG-ONLY). */
/**
 * Trade direction.
 *
 * `SHORT` is a **synthetic, unleveraged shadow simulation only** — there is no
 * borrow, no funding, no liquidation and no margin anywhere in this system, and
 * no exchange adapter exists at all (ADR 0011, ADR 0012). A real short would
 * require an explicit futures- or margin-capable exchange capability, which the
 * shadow-only build refuses by construction.
 */
export const TradeDirection = {
  LONG: "LONG",
  SHORT: "SHORT"
} as const;
export type TradeDirection =
  (typeof TradeDirection)[keyof typeof TradeDirection];

export function isTradeDirection(value: unknown): value is TradeDirection {
  return value === TradeDirection.LONG || value === TradeDirection.SHORT;
}

/** v1 is market-only (docs/trading/07, "Limit Orders – expliziter späterer Scope"). */
export const TradeEntryType = {
  MARKET: "MARKET"
} as const;
export type TradeEntryType =
  (typeof TradeEntryType)[keyof typeof TradeEntryType];

export const TradeCandidateStatus = {
  CREATED: "CREATED",
  VALIDATING: "VALIDATING",
  READY_FOR_RISK: "READY_FOR_RISK",
  APPROVED_FOR_SHADOW: "APPROVED_FOR_SHADOW",
  INVALID: "INVALID",
  RISK_REJECTED: "RISK_REJECTED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED"
} as const;
export type TradeCandidateStatus =
  (typeof TradeCandidateStatus)[keyof typeof TradeCandidateStatus];

export const TradeEvidenceType = {
  CANDLE: "CANDLE",
  SIGNAL: "SIGNAL",
  MTF: "MTF",
  REGIME: "REGIME",
  DATA_QUALITY: "DATA_QUALITY",
  RADAR: "RADAR",
  NEWS: "NEWS",
  EVENT: "EVENT",
  DISCOVERY: "DISCOVERY",
  EXECUTION_PROFILE: "EXECUTION_PROFILE"
} as const;
export type TradeEvidenceType =
  (typeof TradeEvidenceType)[keyof typeof TradeEvidenceType];

export const TradeDecisionOutcome = {
  APPROVE_SHADOW: "APPROVE_SHADOW",
  REJECT: "REJECT",
  EXPIRE: "EXPIRE",
  CANCEL: "CANCEL",
  ERROR: "ERROR"
} as const;
export type TradeDecisionOutcome =
  (typeof TradeDecisionOutcome)[keyof typeof TradeDecisionOutcome];

// ───────────────────────────────────────────────────────────────────────────
// Risk
// ───────────────────────────────────────────────────────────────────────────

export const RiskAssessmentStatus = {
  PASS: "PASS",
  FAIL: "FAIL",
  ERROR: "ERROR"
} as const;
export type RiskAssessmentStatus =
  (typeof RiskAssessmentStatus)[keyof typeof RiskAssessmentStatus];

export const RiskRuleOutcome = {
  PASS: "PASS",
  FAIL: "FAIL",
  WARN: "WARN",
  ERROR: "ERROR"
} as const;
export type RiskRuleOutcome =
  (typeof RiskRuleOutcome)[keyof typeof RiskRuleOutcome];

export const RiskSeverity = {
  INFO: "INFO",
  WARNING: "WARNING",
  BLOCKER: "BLOCKER",
  CRITICAL: "CRITICAL"
} as const;
export type RiskSeverity = (typeof RiskSeverity)[keyof typeof RiskSeverity];

export const RiskLimitSetStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  RETIRED: "RETIRED"
} as const;
export type RiskLimitSetStatus =
  (typeof RiskLimitSetStatus)[keyof typeof RiskLimitSetStatus];

/** v1 evaluates limits per portfolio only (docs/trading/03, RiskLimitSet). */
export const RiskLimitScope = {
  PORTFOLIO: "PORTFOLIO"
} as const;
export type RiskLimitScope =
  (typeof RiskLimitScope)[keyof typeof RiskLimitScope];

export const RiskEventType = {
  RISK_RULE_BLOCK: "RISK_RULE_BLOCK",
  DAILY_LOSS_LIMIT: "DAILY_LOSS_LIMIT",
  CONSECUTIVE_LOSS_LIMIT: "CONSECUTIVE_LOSS_LIMIT",
  PORTFOLIO_INCONSISTENCY: "PORTFOLIO_INCONSISTENCY",
  IDEMPOTENCY_OR_VERSION_CONFLICT: "IDEMPOTENCY_OR_VERSION_CONFLICT",
  CONFIGURATION_INVALID: "CONFIGURATION_INVALID",
  DATA_STALE: "DATA_STALE",
  DATA_QUALITY: "DATA_QUALITY",
  EXECUTION_PROFILE_CHANGE: "EXECUTION_PROFILE_CHANGE",
  SIMULATION_ERROR: "SIMULATION_ERROR",
  WORKER_ERROR: "WORKER_ERROR",
  RECONCILIATION_FINDING: "RECONCILIATION_FINDING",
  ADMIN_ACTION: "ADMIN_ACTION"
} as const;
export type RiskEventType = (typeof RiskEventType)[keyof typeof RiskEventType];

/**
 * The only session-level directive the risk engine may return
 * (docs/trading/04, "Kill-Switch-Auslöser"). Orchestration — not the engine —
 * applies it.
 */
export const RiskDirective = {
  NONE: "NONE",
  BLOCK_NEW: "BLOCK_NEW",
  ENGAGE_KILL_SWITCH: "ENGAGE_KILL_SWITCH",
  ERROR_LOCK: "ERROR_LOCK"
} as const;
export type RiskDirective = (typeof RiskDirective)[keyof typeof RiskDirective];

// ───────────────────────────────────────────────────────────────────────────
// Instrument execution profile
// ───────────────────────────────────────────────────────────────────────────

export const InstrumentExecutionProfileStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  RETIRED: "RETIRED"
} as const;
export type InstrumentExecutionProfileStatus =
  (typeof InstrumentExecutionProfileStatus)[keyof typeof InstrumentExecutionProfileStatus];

// ───────────────────────────────────────────────────────────────────────────
// Shadow order, fill, position
// ───────────────────────────────────────────────────────────────────────────

export const ShadowOrderPurpose = {
  ENTRY: "ENTRY",
  EXIT: "EXIT"
} as const;
export type ShadowOrderPurpose =
  (typeof ShadowOrderPurpose)[keyof typeof ShadowOrderPurpose];

export const ShadowOrderSide = {
  BUY: "BUY",
  SELL: "SELL"
} as const;
export type ShadowOrderSide =
  (typeof ShadowOrderSide)[keyof typeof ShadowOrderSide];

/**
 * v1 knows market orders only. `LIMIT` is deliberately absent from the enum so
 * that no feature flag, migration or API payload can activate it before the
 * separate limit-order specification exists (docs/trading/07).
 */
export const ShadowOrderType = {
  MARKET: "MARKET"
} as const;
export type ShadowOrderType =
  (typeof ShadowOrderType)[keyof typeof ShadowOrderType];

export const ShadowOrderTimeInForce = {
  NEXT_BARS: "NEXT_BARS"
} as const;
export type ShadowOrderTimeInForce =
  (typeof ShadowOrderTimeInForce)[keyof typeof ShadowOrderTimeInForce];

export const ShadowOrderStatus = {
  PROPOSED: "PROPOSED",
  ACCEPTED: "ACCEPTED",
  WAITING_FOR_ENTRY: "WAITING_FOR_ENTRY",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED"
} as const;
export type ShadowOrderStatus =
  (typeof ShadowOrderStatus)[keyof typeof ShadowOrderStatus];

export const ShadowFillTriggerType = {
  ENTRY: "ENTRY",
  STOP: "STOP",
  TAKE_PROFIT: "TAKE_PROFIT",
  TIME_EXIT: "TIME_EXIT",
  INVALIDATION: "INVALIDATION",
  MANUAL_RISK_CLOSE: "MANUAL_RISK_CLOSE"
} as const;
export type ShadowFillTriggerType =
  (typeof ShadowFillTriggerType)[keyof typeof ShadowFillTriggerType];

export const ShadowPositionStatus = {
  OPENING: "OPENING",
  OPEN: "OPEN",
  PARTIALLY_CLOSED: "PARTIALLY_CLOSED",
  CLOSED: "CLOSED",
  STOPPED_OUT: "STOPPED_OUT",
  INVALIDATED: "INVALIDATED",
  ERROR: "ERROR"
} as const;
export type ShadowPositionStatus =
  (typeof ShadowPositionStatus)[keyof typeof ShadowPositionStatus];

export const ShadowPositionEventType = {
  OPENING: "OPENING",
  OPENED: "OPENED",
  PARTIAL_CLOSE: "PARTIAL_CLOSE",
  CLOSED: "CLOSED",
  STOPPED_OUT: "STOPPED_OUT",
  INVALIDATED: "INVALIDATED",
  MARKED: "MARKED",
  ERROR: "ERROR"
} as const;
export type ShadowPositionEventType =
  (typeof ShadowPositionEventType)[keyof typeof ShadowPositionEventType];

// ───────────────────────────────────────────────────────────────────────────
// Exit plan
// ───────────────────────────────────────────────────────────────────────────

export const ExitPlanStatus = {
  ACTIVE: "ACTIVE",
  TRIGGERED: "TRIGGERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
} as const;
export type ExitPlanStatus =
  (typeof ExitPlanStatus)[keyof typeof ExitPlanStatus];

/** v1 resolves a stop/take-profit collision inside one candle conservatively. */
export const IntrabarConflictPolicy = {
  STOP_FIRST: "STOP_FIRST"
} as const;
export type IntrabarConflictPolicy =
  (typeof IntrabarConflictPolicy)[keyof typeof IntrabarConflictPolicy];

// ───────────────────────────────────────────────────────────────────────────
// Portfolio
// ───────────────────────────────────────────────────────────────────────────

export const PortfolioStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ERROR_LOCKED: "ERROR_LOCKED",
  ARCHIVED: "ARCHIVED"
} as const;
export type PortfolioStatus =
  (typeof PortfolioStatus)[keyof typeof PortfolioStatus];

export const PortfolioLedgerEntryType = {
  INITIAL_CASH: "INITIAL_CASH",
  RESERVE: "RESERVE",
  RELEASE: "RELEASE",
  BUY_NOTIONAL: "BUY_NOTIONAL",
  SELL_NOTIONAL: "SELL_NOTIONAL",
  FEE: "FEE",
  PNL_ADJUSTMENT: "PNL_ADJUSTMENT",
  CORRECTION: "CORRECTION"
} as const;
export type PortfolioLedgerEntryType =
  (typeof PortfolioLedgerEntryType)[keyof typeof PortfolioLedgerEntryType];

// ───────────────────────────────────────────────────────────────────────────
// Trading session
// ───────────────────────────────────────────────────────────────────────────

/** No `LIVE` member exists in v1 (docs/trading/03, TradingSession). */
export const TradingSessionMode = {
  SHADOW: "SHADOW"
} as const;
export type TradingSessionMode =
  (typeof TradingSessionMode)[keyof typeof TradingSessionMode];

export const TradingSessionStatus = {
  STOPPED: "STOPPED",
  SHADOW_ACTIVE: "SHADOW_ACTIVE",
  PAUSED: "PAUSED",
  KILLED: "KILLED",
  ERROR_LOCKED: "ERROR_LOCKED",
  CLOSED: "CLOSED"
} as const;
export type TradingSessionStatus =
  (typeof TradingSessionStatus)[keyof typeof TradingSessionStatus];

// ───────────────────────────────────────────────────────────────────────────
// Performance
// ───────────────────────────────────────────────────────────────────────────

export const StrategyPerformanceWindow = {
  DAILY: "DAILY",
  ROLLING_30D: "ROLLING_30D",
  ALL_TIME: "ALL_TIME"
} as const;
export type StrategyPerformanceWindow =
  (typeof StrategyPerformanceWindow)[keyof typeof StrategyPerformanceWindow];

// ───────────────────────────────────────────────────────────────────────────
// Fail-closed defaults and configuration capability
// ───────────────────────────────────────────────────────────────────────────

/** Allowed values of `TRADING_MODE` in v1 (docs/trading/02, feature flags). */
export const TradingMode = {
  DISABLED: "DISABLED",
  SHADOW: "SHADOW"
} as const;
export type TradingMode = (typeof TradingMode)[keyof typeof TradingMode];

/** Build capability the shadow binary must report (docs/trading/06, R-001). */
export const TradingBuildCapability = {
  SHADOW_ONLY: "SHADOW_ONLY"
} as const;
export type TradingBuildCapability =
  (typeof TradingBuildCapability)[keyof typeof TradingBuildCapability];

/**
 * Every persisted trading structure starts disabled. The migration creates no
 * rows at all; these are the defaults a later package must apply when it
 * eventually creates one (docs/trading/02, "Feature-Flags und sichere Defaults").
 */
export const TRADING_SAFE_DEFAULTS = Object.freeze({
  tradingMode: TradingMode.DISABLED,
  strategyStatus: StrategyStatus.DRAFT,
  strategyVersionStatus: StrategyVersionStatus.DRAFT,
  strategyAssignmentEnabled: false,
  executionProfileStatus: InstrumentExecutionProfileStatus.DRAFT,
  riskLimitSetStatus: RiskLimitSetStatus.DRAFT,
  portfolioStatus: PortfolioStatus.DRAFT,
  sessionStatus: TradingSessionStatus.STOPPED,
  killSwitchEngaged: true
} as const);

/** Snapshot of build and configuration flags, assembled outside this package. */
export interface TradingCapabilityContext {
  readonly buildCapability: string;
  readonly tradingMode: string;
  readonly enableLiveTrading: boolean;
  readonly shadowMasterFlagEnabled: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Guard contexts (docs/trading/04)
// ───────────────────────────────────────────────────────────────────────────

/**
 * What a session currently permits. Derived only from persisted session state,
 * never from a clock or a flag read inside this package.
 */
export interface SessionCapabilities {
  readonly canCreateCandidates: boolean;
  readonly canApproveAndReserve: boolean;
  readonly canFillEntries: boolean;
  readonly canMonitorPositions: boolean;
  readonly canExecuteRiskReducingExit: boolean;
  readonly mustCancelOpenEntryOrders: boolean;
  readonly canReconcile: boolean;
  /** `ERROR_LOCKED` does not merely allow reconciliation, it demands it. */
  readonly reconcileRequired: boolean;
  readonly canCancelOrders: boolean;
  readonly isReadOnly: boolean;
}

export interface SessionStateContext {
  readonly status: TradingSessionStatus;
  readonly killSwitchEngaged: boolean;
}

/** Preconditions for entering `SHADOW_ACTIVE` (docs/trading/04, activation guards). */
export interface SessionActivationContext {
  readonly capability: TradingCapabilityContext;
  readonly killSwitchEngaged: boolean;
  readonly portfolioStatus: PortfolioStatus;
  readonly reconcileSucceeded: boolean;
  readonly reconcileFresh: boolean;
  readonly activeRiskLimitSetCount: number;
  readonly validExecutionProfilesPresent: boolean;
  readonly activeAssignmentCount: number;
  readonly assignmentScopeAllowed: boolean;
  readonly unacknowledgedCriticalRiskEventCount: number;
  readonly expiredClaimCount: number;
  readonly unknownOpenAggregateCount: number;
  readonly actorType: TradingActorType;
  readonly idempotencyKey: string | null;
}

/** Preconditions for `KILLED`/`ERROR_LOCKED -> STOPPED` (docs/trading/04). */
export interface SessionUnlockContext {
  readonly killCauseResolved: boolean;
  readonly riskEventsAcknowledged: boolean;
  readonly reconcileSucceeded: boolean;
  readonly unclearOrderCount: number;
  readonly actorType: TradingActorType;
  readonly idempotencyKey: string | null;
}

/** Preconditions for closing a session (docs/trading/04). */
export interface SessionCloseContext {
  readonly openExposureCount: number;
  readonly openOrderCount: number;
  readonly actorType: TradingActorType;
}

export interface CandidateTransitionContext {
  readonly session: SessionCapabilities;
  readonly claimed?: boolean;
  readonly snapshotComplete?: boolean;
  readonly invalidReasonCode?: string | null;
  readonly cancelReasonCode?: string | null;
  readonly riskAssessmentStatus?: RiskAssessmentStatus | null;
  readonly decisionPresent?: boolean;
  readonly isExpired?: boolean;
  readonly hasEntryOrder?: boolean;
}

export interface OrderTransitionContext {
  readonly purpose: ShadowOrderPurpose;
  readonly session: SessionCapabilities;
  readonly reservationSucceeded?: boolean;
  readonly portfolioConsistent?: boolean;
  readonly earliestFillAtSet?: boolean;
  readonly rejectionReasonCode?: string | null;
  readonly cancelReasonCode?: string | null;
  readonly remainingQuantityIsZero?: boolean;
}

export interface PositionTransitionContext {
  /** A non-cancelled exit plan covers the position. */
  readonly exitPlanPresent?: boolean;
  readonly entryOrderSettled?: boolean;
  readonly openQuantityIsZero?: boolean;
  readonly openQuantityIsPositive?: boolean;
  readonly finalTrigger?: ShadowFillTriggerType | null;
}

export interface ExitPlanTransitionContext {
  readonly triggeredBy?: ShadowFillTriggerType | null;
  readonly sourceCandleId?: string | null;
  readonly positionTerminal?: boolean;
  readonly openExitFillsRemaining?: boolean;
  readonly positionHasExposure?: boolean;
}

export interface DecisionContext {
  readonly candidateStatus: TradeCandidateStatus;
  readonly riskAssessmentStatus: RiskAssessmentStatus | null;
  readonly outcome: TradeDecisionOutcome;
  readonly reasonCode: string | null;
  readonly existingDecisionOutcome: TradeDecisionOutcome | null;
}
