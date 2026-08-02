/**
 * Pure transition guards for the shadow trading aggregates.
 *
 * Specification: docs/trading/04-state-machines.md. Only the transitions listed
 * there are allowed; terminal states are immutable; every refusal carries a
 * stable reason code. These functions never touch a database, a clock or a
 * flag — the caller passes the already-loaded state as context.
 */

import {
  ExitPlanStatus,
  PortfolioStatus,
  RiskAssessmentStatus,
  ShadowFillTriggerType,
  ShadowOrderPurpose,
  ShadowOrderStatus,
  ShadowPositionStatus,
  TradeCandidateStatus,
  TradeDecisionOutcome,
  TradingActorType,
  TradingBuildCapability,
  TradingDomainError,
  TradingMode,
  TradingReasonCode,
  TradingSessionStatus,
  guardFail,
  guardOk,
  type CandidateTransitionContext,
  type DecisionContext,
  type ExitPlanTransitionContext,
  type GuardResult,
  type OrderTransitionContext,
  type PositionTransitionContext,
  type SessionActivationContext,
  type SessionCapabilities,
  type SessionCloseContext,
  type SessionStateContext,
  type SessionUnlockContext,
  type TradingCapabilityContext
} from "./types.js";

// ───────────────────────────────────────────────────────────────────────────
// Shared helpers
// ───────────────────────────────────────────────────────────────────────────

type TransitionTable<TState extends string> = Readonly<Record<TState, readonly TState[]>>;

function checkTable<TState extends string>(
  table: TransitionTable<TState>,
  terminal: ReadonlySet<TState>,
  from: TState,
  to: TState,
  aggregate: string
): GuardResult {
  const allowed = table[from];
  if (allowed === undefined) {
    return guardFail(TradingReasonCode.UNKNOWN_STATE, `${aggregate}: unknown source state ${from}.`);
  }
  if (table[to] === undefined) {
    return guardFail(TradingReasonCode.UNKNOWN_STATE, `${aggregate}: unknown target state ${to}.`);
  }
  if (terminal.has(from)) {
    return guardFail(
      TradingReasonCode.TERMINAL_STATE_IMMUTABLE,
      `${aggregate}: ${from} is terminal and cannot transition to ${to}.`
    );
  }
  if (!allowed.includes(to)) {
    return guardFail(
      TradingReasonCode.TRANSITION_NOT_ALLOWED,
      `${aggregate}: ${from} -> ${to} is not a defined transition.`
    );
  }
  return guardOk();
}

function toAssertion(name: string): (result: GuardResult) => void {
  return (result: GuardResult) => {
    if (!result.ok) {
      throw new TradingDomainError(result.reasonCode, `${name}: ${result.message}`);
    }
  };
}

function requireText(
  value: string | null | undefined,
  reasonCode: TradingReasonCode,
  message: string
): GuardResult {
  return value !== null && value !== undefined && value.trim() !== ""
    ? guardOk()
    : guardFail(reasonCode, message);
}

// ───────────────────────────────────────────────────────────────────────────
// Trading session and kill switch (docs/trading/04, "Trading Session und Kill Switch")
// ───────────────────────────────────────────────────────────────────────────

const SESSION_TRANSITIONS: TransitionTable<TradingSessionStatus> = Object.freeze({
  STOPPED: [TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.KILLED, TradingSessionStatus.ERROR_LOCKED],
  SHADOW_ACTIVE: [
    TradingSessionStatus.PAUSED,
    TradingSessionStatus.KILLED,
    TradingSessionStatus.ERROR_LOCKED,
    TradingSessionStatus.CLOSED
  ],
  PAUSED: [
    TradingSessionStatus.SHADOW_ACTIVE,
    TradingSessionStatus.KILLED,
    TradingSessionStatus.ERROR_LOCKED,
    TradingSessionStatus.CLOSED
  ],
  KILLED: [TradingSessionStatus.STOPPED, TradingSessionStatus.CLOSED],
  ERROR_LOCKED: [TradingSessionStatus.STOPPED, TradingSessionStatus.CLOSED],
  CLOSED: []
});

/** `CLOSED` is the only terminal session state (docs/trading/04). */
export const TERMINAL_SESSION_STATUSES: ReadonlySet<TradingSessionStatus> = Object.freeze(
  new Set<TradingSessionStatus>([TradingSessionStatus.CLOSED])
);

export const isTerminalSessionStatus = (status: TradingSessionStatus): boolean =>
  TERMINAL_SESSION_STATUSES.has(status);

/**
 * Build capability and configuration must be shadow-only before any trading
 * structure may leave its safe default (docs/trading/06, R-001-SHADOW-MODE).
 */
export function checkShadowOnlyCapability(capability: TradingCapabilityContext): GuardResult {
  if (capability.buildCapability !== TradingBuildCapability.SHADOW_ONLY) {
    return guardFail(
      TradingReasonCode.BUILD_CAPABILITY_NOT_SHADOW_ONLY,
      `Build capability must be ${TradingBuildCapability.SHADOW_ONLY}.`
    );
  }
  if (capability.enableLiveTrading) {
    return guardFail(
      TradingReasonCode.LIVE_TRADING_FORBIDDEN,
      "ENABLE_LIVE_TRADING must not be true in shadow v1."
    );
  }
  if (capability.tradingMode === TradingMode.DISABLED) {
    return guardFail(TradingReasonCode.MODE_NOT_SHADOW, "TRADING_MODE is DISABLED.");
  }
  if (capability.tradingMode !== TradingMode.SHADOW) {
    return guardFail(
      TradingReasonCode.CONFIG_INVALID,
      `Unknown TRADING_MODE: ${capability.tradingMode}.`
    );
  }
  if (!capability.shadowMasterFlagEnabled) {
    return guardFail(
      TradingReasonCode.SHADOW_MASTER_FLAG_DISABLED,
      "TRADING_SHADOW_ENABLED master flag is off."
    );
  }
  return guardOk();
}

export const assertShadowOnlyCapability = (capability: TradingCapabilityContext): void =>
  toAssertion("shadow capability")(checkShadowOnlyCapability(capability));

const BLOCKED_CAPABILITIES: SessionCapabilities = Object.freeze({
  canCreateCandidates: false,
  canApproveAndReserve: false,
  canFillEntries: false,
  canMonitorPositions: true,
  canExecuteRiskReducingExit: true,
  mustCancelOpenEntryOrders: true,
  canReconcile: true,
  reconcileRequired: false,
  canCancelOrders: true,
  isReadOnly: false
});

/**
 * The capability matrix of docs/trading/04. An engaged kill switch degrades
 * `SHADOW_ACTIVE` to the blocked row, so a stale status alone can never permit
 * new exposure (ADR 0006, redundant fail-closed barrier).
 */
export function sessionCapabilities(session: SessionStateContext): SessionCapabilities {
  switch (session.status) {
    case TradingSessionStatus.SHADOW_ACTIVE:
      if (session.killSwitchEngaged) return BLOCKED_CAPABILITIES;
      return Object.freeze({
        canCreateCandidates: true,
        canApproveAndReserve: true,
        canFillEntries: true,
        canMonitorPositions: true,
        canExecuteRiskReducingExit: true,
        mustCancelOpenEntryOrders: false,
        canReconcile: true,
        reconcileRequired: false,
        canCancelOrders: true,
        isReadOnly: false
      });
    case TradingSessionStatus.STOPPED:
      return Object.freeze({ ...BLOCKED_CAPABILITIES, mustCancelOpenEntryOrders: false });
    case TradingSessionStatus.PAUSED:
    case TradingSessionStatus.KILLED:
      return BLOCKED_CAPABILITIES;
    case TradingSessionStatus.ERROR_LOCKED:
      // Monitoring stays on, but only risk-reducing action is permitted and
      // reconciliation is mandatory rather than merely allowed.
      return Object.freeze({ ...BLOCKED_CAPABILITIES, reconcileRequired: true });
    case TradingSessionStatus.CLOSED:
      return Object.freeze({
        canCreateCandidates: false,
        canApproveAndReserve: false,
        canFillEntries: false,
        canMonitorPositions: false,
        canExecuteRiskReducingExit: false,
        mustCancelOpenEntryOrders: false,
        canReconcile: false,
        reconcileRequired: false,
        canCancelOrders: false,
        isReadOnly: true
      });
    default:
      throw new TradingDomainError(
        TradingReasonCode.UNKNOWN_STATE,
        `Unknown session status: ${String(session.status)}`
      );
  }
}

function checkSessionActivation(context: SessionActivationContext): GuardResult {
  const capability = checkShadowOnlyCapability(context.capability);
  if (!capability.ok) return capability;

  if (context.killSwitchEngaged) {
    return guardFail(
      TradingReasonCode.SESSION_KILL_SWITCH_ENGAGED,
      "SHADOW_ACTIVE requires killSwitchEngaged=false."
    );
  }
  if (context.portfolioStatus !== PortfolioStatus.ACTIVE) {
    return guardFail(
      TradingReasonCode.SESSION_PORTFOLIO_NOT_ACTIVE,
      `Portfolio must be ACTIVE, is ${context.portfolioStatus}.`
    );
  }
  if (!context.reconcileSucceeded) {
    return guardFail(
      TradingReasonCode.SESSION_RECONCILE_REQUIRED,
      "A successful reconciliation is required before activation."
    );
  }
  if (!context.reconcileFresh) {
    return guardFail(TradingReasonCode.SESSION_RECONCILE_STALE, "reconciledAt is not fresh.");
  }
  if (context.activeRiskLimitSetCount !== 1) {
    return guardFail(
      TradingReasonCode.SESSION_RISK_LIMIT_SET_REQUIRED,
      `Exactly one active RiskLimitSet is required, found ${context.activeRiskLimitSetCount}.`
    );
  }
  if (!context.validExecutionProfilesPresent) {
    return guardFail(
      TradingReasonCode.SESSION_EXECUTION_PROFILE_REQUIRED,
      "Valid instrument execution profiles are required."
    );
  }
  if (context.activeAssignmentCount < 1) {
    return guardFail(
      TradingReasonCode.SESSION_ASSIGNMENT_REQUIRED,
      "At least one enabled strategy assignment is required."
    );
  }
  if (!context.assignmentScopeAllowed) {
    return guardFail(
      TradingReasonCode.SESSION_ASSIGNMENT_SCOPE_NOT_ALLOWED,
      "Only the explicitly permitted BTC/ETH assignments may be active."
    );
  }
  if (context.unacknowledgedCriticalRiskEventCount > 0) {
    return guardFail(
      TradingReasonCode.SESSION_UNACKNOWLEDGED_CRITICAL_RISK_EVENT,
      `${context.unacknowledgedCriticalRiskEventCount} critical risk events are unacknowledged.`
    );
  }
  if (context.expiredClaimCount > 0) {
    return guardFail(
      TradingReasonCode.SESSION_EXPIRED_CLAIMS_PRESENT,
      `${context.expiredClaimCount} expired worker claims must be recovered first.`
    );
  }
  if (context.unknownOpenAggregateCount > 0) {
    return guardFail(
      TradingReasonCode.SESSION_UNKNOWN_OPEN_AGGREGATES,
      `${context.unknownOpenAggregateCount} unknown open aggregates must be resolved first.`
    );
  }
  if (context.actorType !== TradingActorType.ADMIN) {
    return guardFail(
      TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED,
      "Activation requires an explicit admin action."
    );
  }
  return requireText(
    context.idempotencyKey,
    TradingReasonCode.SESSION_IDEMPOTENCY_KEY_REQUIRED,
    "Activation requires an idempotency key."
  );
}

function checkSessionUnlock(context: SessionUnlockContext): GuardResult {
  if (!context.killCauseResolved) {
    return guardFail(
      TradingReasonCode.SESSION_KILL_CAUSE_UNRESOLVED,
      "The cause of the kill or error lock must be resolved first."
    );
  }
  if (!context.riskEventsAcknowledged) {
    return guardFail(
      TradingReasonCode.SESSION_RISK_EVENT_NOT_ACKNOWLEDGED,
      "All related risk events must be acknowledged."
    );
  }
  if (!context.reconcileSucceeded) {
    return guardFail(
      TradingReasonCode.SESSION_RECONCILE_REQUIRED,
      "Unlocking requires a successful reconciliation."
    );
  }
  if (context.unclearOrderCount > 0) {
    return guardFail(
      TradingReasonCode.SESSION_UNCLEAR_ORDERS_PRESENT,
      `${context.unclearOrderCount} orders are still in an unclear state.`
    );
  }
  if (context.actorType !== TradingActorType.ADMIN) {
    return guardFail(
      TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED,
      "Unlocking requires an explicit admin action."
    );
  }
  return requireText(
    context.idempotencyKey,
    TradingReasonCode.SESSION_IDEMPOTENCY_KEY_REQUIRED,
    "Unlocking requires an idempotency key."
  );
}

/** Extra input the session guard needs, depending on the target state. */
export interface SessionTransitionContext {
  readonly activation?: SessionActivationContext;
  readonly unlock?: SessionUnlockContext;
  readonly close?: SessionCloseContext;
  readonly killReasonCode?: string | null;
  readonly lockReasonCode?: string | null;
}

export function checkSessionTransition(
  from: TradingSessionStatus,
  to: TradingSessionStatus,
  context: SessionTransitionContext = {}
): GuardResult {
  const structural = checkTable(
    SESSION_TRANSITIONS,
    TERMINAL_SESSION_STATUSES,
    from,
    to,
    "TradingSession"
  );
  if (!structural.ok) return structural;

  switch (to) {
    case TradingSessionStatus.SHADOW_ACTIVE: {
      if (context.activation === undefined) {
        return guardFail(
          TradingReasonCode.SESSION_RECONCILE_REQUIRED,
          "Activation context is required to enter SHADOW_ACTIVE."
        );
      }
      return checkSessionActivation(context.activation);
    }
    case TradingSessionStatus.STOPPED: {
      // Only reachable from KILLED / ERROR_LOCKED, and unlocking must never
      // activate in the same step (docs/trading/04).
      if (context.unlock === undefined) {
        return guardFail(
          TradingReasonCode.SESSION_RECONCILE_REQUIRED,
          "Unlock context is required to return to STOPPED."
        );
      }
      return checkSessionUnlock(context.unlock);
    }
    case TradingSessionStatus.KILLED:
      return requireText(
        context.killReasonCode,
        TradingReasonCode.SESSION_KILL_REASON_CODE_REQUIRED,
        "A kill requires killReasonCode."
      );
    case TradingSessionStatus.ERROR_LOCKED:
      return requireText(
        context.lockReasonCode,
        TradingReasonCode.SESSION_LOCK_REASON_CODE_REQUIRED,
        "An error lock requires a reason code."
      );
    case TradingSessionStatus.CLOSED: {
      const close = context.close;
      if (close === undefined) {
        return guardFail(
          TradingReasonCode.SESSION_OPEN_EXPOSURE_PRESENT,
          "Close context is required to close a session."
        );
      }
      if (close.openExposureCount > 0) {
        return guardFail(
          TradingReasonCode.SESSION_OPEN_EXPOSURE_PRESENT,
          `${close.openExposureCount} positions still carry exposure.`
        );
      }
      if (close.openOrderCount > 0) {
        return guardFail(
          TradingReasonCode.SESSION_OPEN_ORDERS_PRESENT,
          `${close.openOrderCount} orders are still open.`
        );
      }
      if (close.actorType !== TradingActorType.ADMIN) {
        return guardFail(
          TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED,
          "Closing requires an explicit admin action."
        );
      }
      return guardOk();
    }
    case TradingSessionStatus.PAUSED:
      return guardOk();
    default:
      return guardFail(
        TradingReasonCode.UNKNOWN_STATE,
        `TradingSession: unknown target state ${String(to)}.`
      );
  }
}

export const assertSessionTransition = (
  from: TradingSessionStatus,
  to: TradingSessionStatus,
  context: SessionTransitionContext = {}
): void => toAssertion("session transition")(checkSessionTransition(from, to, context));

/** Engaging or releasing the redundant kill switch (docs/trading/04, ADR 0006). */
export const KillSwitchAction = {
  ENGAGE: "ENGAGE",
  RELEASE: "RELEASE"
} as const;
export type KillSwitchAction = (typeof KillSwitchAction)[keyof typeof KillSwitchAction];

export interface KillSwitchContext {
  readonly action: KillSwitchAction;
  readonly reasonCode?: string | null;
  readonly actorType: TradingActorType;
  readonly reconcileSucceeded?: boolean;
}

/**
 * Engaging is always permitted except on a closed session. Releasing is only
 * permitted from `STOPPED` by an admin after a successful reconcile, so a
 * single command can never unlock and re-arm trading at once.
 */
export function checkKillSwitchTransition(
  session: SessionStateContext,
  context: KillSwitchContext
): GuardResult {
  if (session.status === TradingSessionStatus.CLOSED) {
    return guardFail(
      TradingReasonCode.SESSION_CLOSED_READ_ONLY,
      "A closed session is read-only."
    );
  }

  if (context.action === KillSwitchAction.ENGAGE) {
    return requireText(
      context.reasonCode,
      TradingReasonCode.SESSION_KILL_REASON_CODE_REQUIRED,
      "Engaging the kill switch requires a reason code."
    );
  }

  if (session.status !== TradingSessionStatus.STOPPED) {
    return guardFail(
      TradingReasonCode.SESSION_KILL_SWITCH_RELEASE_NOT_ALLOWED,
      `The kill switch may only be released from STOPPED, session is ${session.status}.`
    );
  }
  if (context.actorType !== TradingActorType.ADMIN) {
    return guardFail(
      TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED,
      "Releasing the kill switch requires an explicit admin action."
    );
  }
  if (context.reconcileSucceeded !== true) {
    return guardFail(
      TradingReasonCode.SESSION_RECONCILE_REQUIRED,
      "Releasing the kill switch requires a successful reconciliation."
    );
  }
  return guardOk();
}

export const assertKillSwitchTransition = (
  session: SessionStateContext,
  context: KillSwitchContext
): void => toAssertion("kill switch")(checkKillSwitchTransition(session, context));

/** Guard for anything that would create new exposure. */
export function checkEntryAllowed(session: SessionCapabilities): GuardResult {
  return session.canFillEntries
    ? guardOk()
    : guardFail(TradingReasonCode.SESSION_BLOCKS_ENTRY, "The session does not permit entry fills.");
}

export const assertEntryAllowed = (session: SessionCapabilities): void =>
  toAssertion("entry")(checkEntryAllowed(session));

// ───────────────────────────────────────────────────────────────────────────
// Trade candidate (docs/trading/04, "Trade Candidate")
// ───────────────────────────────────────────────────────────────────────────

const CANDIDATE_TRANSITIONS: TransitionTable<TradeCandidateStatus> = Object.freeze({
  CREATED: [
    TradeCandidateStatus.VALIDATING,
    TradeCandidateStatus.EXPIRED,
    TradeCandidateStatus.CANCELLED
  ],
  VALIDATING: [
    TradeCandidateStatus.READY_FOR_RISK,
    TradeCandidateStatus.INVALID,
    TradeCandidateStatus.EXPIRED,
    TradeCandidateStatus.CANCELLED
  ],
  READY_FOR_RISK: [
    TradeCandidateStatus.APPROVED_FOR_SHADOW,
    TradeCandidateStatus.RISK_REJECTED,
    TradeCandidateStatus.EXPIRED,
    TradeCandidateStatus.CANCELLED
  ],
  APPROVED_FOR_SHADOW: [],
  INVALID: [],
  RISK_REJECTED: [],
  EXPIRED: [],
  CANCELLED: []
});

export const TERMINAL_CANDIDATE_STATUSES: ReadonlySet<TradeCandidateStatus> = Object.freeze(
  new Set<TradeCandidateStatus>([
    TradeCandidateStatus.APPROVED_FOR_SHADOW,
    TradeCandidateStatus.INVALID,
    TradeCandidateStatus.RISK_REJECTED,
    TradeCandidateStatus.EXPIRED,
    TradeCandidateStatus.CANCELLED
  ])
);

export const isTerminalCandidateStatus = (status: TradeCandidateStatus): boolean =>
  TERMINAL_CANDIDATE_STATUSES.has(status);

export function checkCandidateTransition(
  from: TradeCandidateStatus,
  to: TradeCandidateStatus,
  context: CandidateTransitionContext
): GuardResult {
  const structural = checkTable(
    CANDIDATE_TRANSITIONS,
    TERMINAL_CANDIDATE_STATUSES,
    from,
    to,
    "TradeCandidate"
  );
  if (!structural.ok) return structural;

  switch (to) {
    case TradeCandidateStatus.VALIDATING: {
      if (context.claimed !== true) {
        return guardFail(
          TradingReasonCode.CANDIDATE_CLAIM_REQUIRED,
          "A worker claim is required before validation."
        );
      }
      return context.session.canCreateCandidates
        ? guardOk()
        : guardFail(
            TradingReasonCode.SESSION_BLOCKS_CANDIDATE,
            "The session does not permit candidate processing."
          );
    }
    case TradeCandidateStatus.INVALID:
      return requireText(
        context.invalidReasonCode,
        TradingReasonCode.CANDIDATE_INVALID_REASON_CODE_REQUIRED,
        "invalidReasonCode is mandatory."
      );
    case TradeCandidateStatus.READY_FOR_RISK: {
      // A blocked session may only move a candidate to CANCELLED or EXPIRED.
      if (!context.session.canCreateCandidates) {
        return guardFail(
          TradingReasonCode.SESSION_BLOCKS_CANDIDATE,
          "A blocked session may only cancel or expire a candidate."
        );
      }
      return context.snapshotComplete === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.CANDIDATE_SNAPSHOT_INCOMPLETE,
            "Snapshot, hash and price plan must be formally valid."
          );
    }
    case TradeCandidateStatus.APPROVED_FOR_SHADOW: {
      if (!context.session.canApproveAndReserve) {
        return guardFail(
          TradingReasonCode.SESSION_BLOCKS_RISK_APPROVAL,
          "The session does not permit risk approval or cash reservation."
        );
      }
      if (context.riskAssessmentStatus !== RiskAssessmentStatus.PASS) {
        return guardFail(
          TradingReasonCode.CANDIDATE_RISK_NOT_PASSED,
          "Approval requires a PASS risk assessment."
        );
      }
      return context.decisionPresent === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.CANDIDATE_DECISION_REQUIRED,
            "Decision and reserved order must be written in the same transaction."
          );
    }
    case TradeCandidateStatus.RISK_REJECTED:
      return context.decisionPresent === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.CANDIDATE_DECISION_REQUIRED,
            "A rejection requires a persisted decision."
          );
    case TradeCandidateStatus.EXPIRED: {
      if (context.isExpired !== true) {
        return guardFail(
          TradingReasonCode.CANDIDATE_NOT_EXPIRED,
          "Expiry requires now >= expiresAt."
        );
      }
      return context.hasEntryOrder === true
        ? guardFail(
            TradingReasonCode.CANDIDATE_HAS_ENTRY_ORDER,
            "A candidate with an entry order cannot expire."
          )
        : guardOk();
    }
    case TradeCandidateStatus.CANCELLED:
      return requireText(
        context.cancelReasonCode,
        TradingReasonCode.CANDIDATE_CANCEL_REASON_CODE_REQUIRED,
        "cancelReasonCode is mandatory."
      );
    default:
      return guardFail(
        TradingReasonCode.UNKNOWN_STATE,
        `TradeCandidate: unknown target state ${String(to)}.`
      );
  }
}

export const assertCandidateTransition = (
  from: TradeCandidateStatus,
  to: TradeCandidateStatus,
  context: CandidateTransitionContext
): void => toAssertion("candidate transition")(checkCandidateTransition(from, to, context));

// ───────────────────────────────────────────────────────────────────────────
// Trade decision (docs/trading/03, "V1 erlaubt genau eine finale Decision")
// ───────────────────────────────────────────────────────────────────────────

/** Which decision outcome each risk result may produce. */
const OUTCOME_FOR_RISK_STATUS: Readonly<Record<RiskAssessmentStatus, TradeDecisionOutcome>> =
  Object.freeze({
    PASS: TradeDecisionOutcome.APPROVE_SHADOW,
    FAIL: TradeDecisionOutcome.REJECT,
    ERROR: TradeDecisionOutcome.ERROR
  });

export function checkDecision(context: DecisionContext): GuardResult {
  if (context.existingDecisionOutcome !== null) {
    return guardFail(
      TradingReasonCode.DECISION_ALREADY_FINAL,
      `A final decision (${context.existingDecisionOutcome}) already exists; re-evaluation needs a new candidate.`
    );
  }

  const reason = requireText(
    context.reasonCode,
    TradingReasonCode.DECISION_REASON_CODE_REQUIRED,
    "A decision requires a primary reason code."
  );
  if (!reason.ok) return reason;

  if (
    context.outcome === TradeDecisionOutcome.EXPIRE ||
    context.outcome === TradeDecisionOutcome.CANCEL
  ) {
    return guardOk();
  }

  if (context.candidateStatus !== TradeCandidateStatus.READY_FOR_RISK) {
    return guardFail(
      TradingReasonCode.DECISION_CANDIDATE_NOT_READY,
      `A risk decision requires READY_FOR_RISK, candidate is ${context.candidateStatus}.`
    );
  }
  if (context.riskAssessmentStatus === null) {
    return guardFail(
      TradingReasonCode.DECISION_RISK_ASSESSMENT_REQUIRED,
      "A risk decision requires a persisted risk assessment."
    );
  }
  const expected = OUTCOME_FOR_RISK_STATUS[context.riskAssessmentStatus];
  if (expected !== context.outcome) {
    return guardFail(
      TradingReasonCode.DECISION_OUTCOME_MISMATCH,
      `Risk assessment ${context.riskAssessmentStatus} implies ${expected}, not ${context.outcome}.`
    );
  }
  return guardOk();
}

export const assertDecision = (context: DecisionContext): void =>
  toAssertion("trade decision")(checkDecision(context));

/** The candidate status a completed risk assessment must lead to. */
export function candidateStatusForRiskStatus(
  status: RiskAssessmentStatus
): TradeCandidateStatus {
  return status === RiskAssessmentStatus.PASS
    ? TradeCandidateStatus.APPROVED_FOR_SHADOW
    : TradeCandidateStatus.RISK_REJECTED;
}

// ───────────────────────────────────────────────────────────────────────────
// Risk assessment (created final, never rewritten)
// ───────────────────────────────────────────────────────────────────────────

export interface RiskAssessmentContext {
  readonly existingStatus: RiskAssessmentStatus | null;
  readonly incomingStatus: RiskAssessmentStatus;
  readonly ruleCodes: readonly string[];
}

/**
 * A risk assessment is written once with its final status and its complete rule
 * result set — including PASS results (docs/trading/03, RiskRuleResult).
 */
export function checkRiskAssessment(context: RiskAssessmentContext): GuardResult {
  if (context.existingStatus !== null) {
    return guardFail(
      TradingReasonCode.RISK_ASSESSMENT_IMMUTABLE,
      `Risk assessment is already ${context.existingStatus} and cannot be rewritten.`
    );
  }
  const seen = new Set<string>();
  for (const ruleCode of context.ruleCodes) {
    if (seen.has(ruleCode)) {
      return guardFail(
        TradingReasonCode.RISK_RULE_RESULT_DUPLICATE,
        `Duplicate rule result for ${ruleCode}.`
      );
    }
    seen.add(ruleCode);
  }
  return guardOk();
}

export const assertRiskAssessment = (context: RiskAssessmentContext): void =>
  toAssertion("risk assessment")(checkRiskAssessment(context));

// ───────────────────────────────────────────────────────────────────────────
// Shadow order (docs/trading/04, "Shadow Order")
// ───────────────────────────────────────────────────────────────────────────

const ORDER_TRANSITIONS: TransitionTable<ShadowOrderStatus> = Object.freeze({
  PROPOSED: [ShadowOrderStatus.ACCEPTED, ShadowOrderStatus.REJECTED],
  ACCEPTED: [ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.CANCELLED],
  WAITING_FOR_ENTRY: [
    ShadowOrderStatus.PARTIALLY_FILLED,
    ShadowOrderStatus.FILLED,
    ShadowOrderStatus.CANCELLED,
    ShadowOrderStatus.EXPIRED
  ],
  PARTIALLY_FILLED: [
    ShadowOrderStatus.PARTIALLY_FILLED,
    ShadowOrderStatus.FILLED,
    ShadowOrderStatus.CANCELLED,
    ShadowOrderStatus.EXPIRED
  ],
  FILLED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: []
});

export const TERMINAL_ORDER_STATUSES: ReadonlySet<ShadowOrderStatus> = Object.freeze(
  new Set<ShadowOrderStatus>([
    ShadowOrderStatus.FILLED,
    ShadowOrderStatus.REJECTED,
    ShadowOrderStatus.CANCELLED,
    ShadowOrderStatus.EXPIRED
  ])
);

export const isTerminalOrderStatus = (status: ShadowOrderStatus): boolean =>
  TERMINAL_ORDER_STATUSES.has(status);

export function checkOrderTransition(
  from: ShadowOrderStatus,
  to: ShadowOrderStatus,
  context: OrderTransitionContext
): GuardResult {
  const structural = checkTable(ORDER_TRANSITIONS, TERMINAL_ORDER_STATUSES, from, to, "ShadowOrder");
  if (!structural.ok) return structural;

  const isEntry = context.purpose === ShadowOrderPurpose.ENTRY;

  switch (to) {
    case ShadowOrderStatus.ACCEPTED: {
      if (isEntry) {
        if (!context.session.canApproveAndReserve) {
          return guardFail(
            TradingReasonCode.SESSION_BLOCKS_ENTRY,
            "The session does not permit accepting an entry order."
          );
        }
        return context.reservationSucceeded === true
          ? guardOk()
          : guardFail(
              TradingReasonCode.ORDER_RESERVATION_REQUIRED,
              "An entry order without a complete cash reservation must not be accepted."
            );
      }
      // A risk-reducing exit may be accepted even while the session is blocked,
      // provided the portfolio is consistent (docs/trading/04).
      if (!context.session.canExecuteRiskReducingExit) {
        return guardFail(
          TradingReasonCode.SESSION_CLOSED_READ_ONLY,
          "The session does not permit any order handling."
        );
      }
      return context.portfolioConsistent === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.PORTFOLIO_INCONSISTENT,
            "An exit order requires a consistent portfolio."
          );
    }
    case ShadowOrderStatus.REJECTED:
      return requireText(
        context.rejectionReasonCode,
        TradingReasonCode.ORDER_REJECTION_REASON_CODE_REQUIRED,
        "rejectionReasonCode is mandatory."
      );
    case ShadowOrderStatus.WAITING_FOR_ENTRY:
      return context.earliestFillAtSet === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.ORDER_EARLIEST_FILL_AT_REQUIRED,
            "earliestFillAt must be set; no fill inside the signal candle."
          );
    case ShadowOrderStatus.PARTIALLY_FILLED: {
      if (isEntry && !context.session.canFillEntries) {
        return guardFail(
          TradingReasonCode.SESSION_BLOCKS_ENTRY,
          "The session does not permit entry fills."
        );
      }
      return context.remainingQuantityIsZero === true
        ? guardFail(
            TradingReasonCode.ORDER_REMAINING_QUANTITY_MISMATCH,
            "A fully filled order must become FILLED, not PARTIALLY_FILLED."
          )
        : guardOk();
    }
    case ShadowOrderStatus.FILLED: {
      if (isEntry && !context.session.canFillEntries) {
        return guardFail(
          TradingReasonCode.SESSION_BLOCKS_ENTRY,
          "The session does not permit entry fills."
        );
      }
      return context.remainingQuantityIsZero === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.ORDER_REMAINING_QUANTITY_MISMATCH,
            "FILLED requires a remaining quantity of zero."
          );
    }
    case ShadowOrderStatus.CANCELLED:
      return requireText(
        context.cancelReasonCode,
        TradingReasonCode.ORDER_CANCEL_REASON_CODE_REQUIRED,
        "cancelReasonCode is mandatory."
      );
    case ShadowOrderStatus.EXPIRED:
      return guardOk();
    default:
      return guardFail(
        TradingReasonCode.UNKNOWN_STATE,
        `ShadowOrder: unknown target state ${String(to)}.`
      );
  }
}

export const assertOrderTransition = (
  from: ShadowOrderStatus,
  to: ShadowOrderStatus,
  context: OrderTransitionContext
): void => toAssertion("order transition")(checkOrderTransition(from, to, context));

/** v1 replaces instead of amending an order (docs/trading/04). */
export function checkOrderModification(): GuardResult {
  return guardFail(
    TradingReasonCode.ORDER_MODIFICATION_FORBIDDEN,
    "v1 has no order amendment; cancel and create a new order with a causal reference."
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Shadow position (docs/trading/04, "Shadow Position")
// ───────────────────────────────────────────────────────────────────────────

const POSITION_TRANSITIONS: TransitionTable<ShadowPositionStatus> = Object.freeze({
  OPENING: [ShadowPositionStatus.OPEN, ShadowPositionStatus.ERROR],
  OPEN: [
    ShadowPositionStatus.PARTIALLY_CLOSED,
    ShadowPositionStatus.CLOSED,
    ShadowPositionStatus.STOPPED_OUT,
    ShadowPositionStatus.INVALIDATED,
    ShadowPositionStatus.ERROR
  ],
  PARTIALLY_CLOSED: [
    ShadowPositionStatus.PARTIALLY_CLOSED,
    ShadowPositionStatus.CLOSED,
    ShadowPositionStatus.STOPPED_OUT,
    ShadowPositionStatus.INVALIDATED,
    ShadowPositionStatus.ERROR
  ],
  CLOSED: [],
  STOPPED_OUT: [],
  INVALIDATED: [],
  ERROR: []
});

export const TERMINAL_POSITION_STATUSES: ReadonlySet<ShadowPositionStatus> = Object.freeze(
  new Set<ShadowPositionStatus>([
    ShadowPositionStatus.CLOSED,
    ShadowPositionStatus.STOPPED_OUT,
    ShadowPositionStatus.INVALIDATED,
    ShadowPositionStatus.ERROR
  ])
);

export const isTerminalPositionStatus = (status: ShadowPositionStatus): boolean =>
  TERMINAL_POSITION_STATUSES.has(status);

/**
 * `ERROR` is terminal but does not mean the exposure disappeared: monitoring
 * and reconciliation keep counting such a position as open and maximally risky
 * (docs/trading/04).
 */
export const carriesExposure = (
  status: ShadowPositionStatus,
  openQuantityIsPositive: boolean
): boolean =>
  openQuantityIsPositive ||
  status === ShadowPositionStatus.OPENING ||
  status === ShadowPositionStatus.OPEN ||
  status === ShadowPositionStatus.PARTIALLY_CLOSED;

const FINAL_TRIGGER_FOR_STATUS: Readonly<
  Partial<Record<ShadowPositionStatus, readonly ShadowFillTriggerType[]>>
> = Object.freeze({
  CLOSED: [
    ShadowFillTriggerType.TAKE_PROFIT,
    ShadowFillTriggerType.TIME_EXIT,
    ShadowFillTriggerType.MANUAL_RISK_CLOSE
  ],
  STOPPED_OUT: [ShadowFillTriggerType.STOP],
  INVALIDATED: [ShadowFillTriggerType.INVALIDATION]
});

export function checkPositionTransition(
  from: ShadowPositionStatus,
  to: ShadowPositionStatus,
  context: PositionTransitionContext
): GuardResult {
  const structural = checkTable(
    POSITION_TRANSITIONS,
    TERMINAL_POSITION_STATUSES,
    from,
    to,
    "ShadowPosition"
  );
  if (!structural.ok) return structural;

  if (to === ShadowPositionStatus.ERROR) {
    // An unresolvable invariant may always lock the position.
    return guardOk();
  }

  if (context.exitPlanPresent !== true) {
    return guardFail(
      TradingReasonCode.POSITION_EXIT_PLAN_REQUIRED,
      "A position must always be covered by an exit plan."
    );
  }

  switch (to) {
    case ShadowPositionStatus.OPEN: {
      if (context.entryOrderSettled !== true) {
        return guardFail(
          TradingReasonCode.POSITION_ENTRY_NOT_SETTLED,
          "OPEN requires a fully filled or terminal entry order."
        );
      }
      return context.openQuantityIsPositive === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.POSITION_OPEN_QUANTITY_MUST_BE_POSITIVE,
            "OPEN requires a positive filled quantity."
          );
    }
    case ShadowPositionStatus.PARTIALLY_CLOSED:
      return context.openQuantityIsPositive === true
        ? guardOk()
        : guardFail(
            TradingReasonCode.POSITION_OPEN_QUANTITY_MUST_BE_POSITIVE,
            "PARTIALLY_CLOSED requires a positive remaining quantity."
          );
    case ShadowPositionStatus.CLOSED:
    case ShadowPositionStatus.STOPPED_OUT:
    case ShadowPositionStatus.INVALIDATED: {
      if (context.openQuantityIsZero !== true) {
        return guardFail(
          TradingReasonCode.POSITION_OPEN_QUANTITY_MUST_BE_ZERO,
          `${to} requires an open quantity of zero.`
        );
      }
      const allowedTriggers = FINAL_TRIGGER_FOR_STATUS[to] ?? [];
      const trigger = context.finalTrigger ?? null;
      return trigger !== null && allowedTriggers.includes(trigger)
        ? guardOk()
        : guardFail(
            TradingReasonCode.POSITION_FINAL_TRIGGER_MISMATCH,
            `${to} requires a final trigger out of ${allowedTriggers.join(", ")}, got ${String(trigger)}.`
          );
    }
    default:
      return guardFail(
        TradingReasonCode.UNKNOWN_STATE,
        `ShadowPosition: unknown target state ${String(to)}.`
      );
  }
}

export const assertPositionTransition = (
  from: ShadowPositionStatus,
  to: ShadowPositionStatus,
  context: PositionTransitionContext
): void => toAssertion("position transition")(checkPositionTransition(from, to, context));

/**
 * v1 forbids averaging down, pyramiding and re-opening the same aggregate
 * (docs/trading/04, docs/trading/06 R-022/R-023).
 */
export function checkNoScaleIn(hasNonTerminalPositionOrEntryOrder: boolean): GuardResult {
  return hasNonTerminalPositionOrEntryOrder
    ? guardFail(
        TradingReasonCode.POSITION_SCALE_IN_FORBIDDEN,
        "A non-terminal position or entry order already exists for this portfolio and asset."
      )
    : guardOk();
}

// ───────────────────────────────────────────────────────────────────────────
// Exit plan (docs/trading/04, "ExitPlan")
// ───────────────────────────────────────────────────────────────────────────

const EXIT_PLAN_TRANSITIONS: TransitionTable<ExitPlanStatus> = Object.freeze({
  ACTIVE: [ExitPlanStatus.TRIGGERED, ExitPlanStatus.CANCELLED],
  TRIGGERED: [ExitPlanStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: []
});

export const TERMINAL_EXIT_PLAN_STATUSES: ReadonlySet<ExitPlanStatus> = Object.freeze(
  new Set<ExitPlanStatus>([ExitPlanStatus.COMPLETED, ExitPlanStatus.CANCELLED])
);

export const isTerminalExitPlanStatus = (status: ExitPlanStatus): boolean =>
  TERMINAL_EXIT_PLAN_STATUSES.has(status);

export function checkExitPlanTransition(
  from: ExitPlanStatus,
  to: ExitPlanStatus,
  context: ExitPlanTransitionContext
): GuardResult {
  const structural = checkTable(
    EXIT_PLAN_TRANSITIONS,
    TERMINAL_EXIT_PLAN_STATUSES,
    from,
    to,
    "ExitPlan"
  );
  if (!structural.ok) return structural;

  switch (to) {
    case ExitPlanStatus.TRIGGERED: {
      if (context.triggeredBy === null || context.triggeredBy === undefined) {
        return guardFail(
          TradingReasonCode.EXIT_PLAN_TRIGGER_REQUIRED,
          "Exactly one conservatively prioritised exit reason is required."
        );
      }
      return requireText(
        context.sourceCandleId,
        TradingReasonCode.EXIT_PLAN_SOURCE_CANDLE_REQUIRED,
        "The triggering source candle must be recorded."
      );
    }
    case ExitPlanStatus.COMPLETED: {
      if (context.positionTerminal !== true) {
        return guardFail(
          TradingReasonCode.EXIT_PLAN_POSITION_NOT_TERMINAL,
          "COMPLETED requires a terminal position."
        );
      }
      return context.openExitFillsRemaining === true
        ? guardFail(
            TradingReasonCode.EXIT_PLAN_OPEN_EXITS_PRESENT,
            "All exit fills must be booked before completion."
          )
        : guardOk();
    }
    case ExitPlanStatus.CANCELLED:
      return context.positionHasExposure === true
        ? guardFail(
            TradingReasonCode.EXIT_PLAN_EXPOSURE_PRESENT,
            "An exit plan may only be cancelled for a position without exposure."
          )
        : guardOk();
    default:
      return guardFail(
        TradingReasonCode.UNKNOWN_STATE,
        `ExitPlan: unknown target state ${String(to)}.`
      );
  }
}

export const assertExitPlanTransition = (
  from: ExitPlanStatus,
  to: ExitPlanStatus,
  context: ExitPlanTransitionContext
): void => toAssertion("exit plan transition")(checkExitPlanTransition(from, to, context));

// ───────────────────────────────────────────────────────────────────────────
// Machine catalogue — used by the acceptance tests to enumerate every edge
// ───────────────────────────────────────────────────────────────────────────

export const TRADING_STATE_MACHINES = Object.freeze({
  candidate: Object.freeze({
    states: Object.freeze(Object.keys(CANDIDATE_TRANSITIONS) as TradeCandidateStatus[]),
    transitions: CANDIDATE_TRANSITIONS,
    terminal: TERMINAL_CANDIDATE_STATUSES
  }),
  order: Object.freeze({
    states: Object.freeze(Object.keys(ORDER_TRANSITIONS) as ShadowOrderStatus[]),
    transitions: ORDER_TRANSITIONS,
    terminal: TERMINAL_ORDER_STATUSES
  }),
  position: Object.freeze({
    states: Object.freeze(Object.keys(POSITION_TRANSITIONS) as ShadowPositionStatus[]),
    transitions: POSITION_TRANSITIONS,
    terminal: TERMINAL_POSITION_STATUSES
  }),
  exitPlan: Object.freeze({
    states: Object.freeze(Object.keys(EXIT_PLAN_TRANSITIONS) as ExitPlanStatus[]),
    transitions: EXIT_PLAN_TRANSITIONS,
    terminal: TERMINAL_EXIT_PLAN_STATUSES
  }),
  session: Object.freeze({
    states: Object.freeze(Object.keys(SESSION_TRANSITIONS) as TradingSessionStatus[]),
    transitions: SESSION_TRANSITIONS,
    terminal: TERMINAL_SESSION_STATUSES
  })
});
