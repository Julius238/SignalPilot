import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_TRADING_REASON_CODES,
  ExitPlanStatus,
  KillSwitchAction,
  PortfolioStatus,
  RiskAssessmentStatus,
  ShadowFillTriggerType,
  ShadowOrderPurpose,
  ShadowOrderStatus,
  ShadowPositionStatus,
  TRADING_SAFE_DEFAULTS,
  TRADING_STATE_MACHINES,
  TradeCandidateStatus,
  TradeDecisionOutcome,
  TradingActorType,
  TradingBuildCapability,
  TradingDomainError,
  TradingMode,
  TradingReasonCode,
  TradingSessionStatus,
  assertCandidateTransition,
  assertOrderTransition,
  assertPositionTransition,
  assertSessionTransition,
  candidateStatusForRiskStatus,
  carriesExposure,
  checkCandidateTransition,
  checkDecision,
  checkEntryAllowed,
  checkExitPlanTransition,
  checkKillSwitchTransition,
  checkNoScaleIn,
  checkOrderModification,
  checkOrderTransition,
  checkPositionTransition,
  checkRiskAssessment,
  checkSessionTransition,
  checkShadowOnlyCapability,
  isTerminalCandidateStatus,
  isTerminalExitPlanStatus,
  isTerminalOrderStatus,
  isTerminalPositionStatus,
  isTerminalSessionStatus,
  sessionCapabilities,
  type CandidateTransitionContext,
  type GuardResult,
  type OrderTransitionContext,
  type PositionTransitionContext,
  type SessionActivationContext,
  type SessionTransitionContext
} from "../src/index.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

const activeSession = sessionCapabilities({
  status: TradingSessionStatus.SHADOW_ACTIVE,
  killSwitchEngaged: false
});
const killedSession = sessionCapabilities({
  status: TradingSessionStatus.KILLED,
  killSwitchEngaged: true
});

const validCapability = {
  buildCapability: TradingBuildCapability.SHADOW_ONLY,
  tradingMode: TradingMode.SHADOW,
  enableLiveTrading: false,
  shadowMasterFlagEnabled: true
};

const validActivation: SessionActivationContext = {
  capability: validCapability,
  killSwitchEngaged: false,
  portfolioStatus: PortfolioStatus.ACTIVE,
  reconcileSucceeded: true,
  reconcileFresh: true,
  activeRiskLimitSetCount: 1,
  validExecutionProfilesPresent: true,
  activeAssignmentCount: 1,
  assignmentScopeAllowed: true,
  unacknowledgedCriticalRiskEventCount: 0,
  expiredClaimCount: 0,
  unknownOpenAggregateCount: 0,
  actorType: TradingActorType.ADMIN,
  idempotencyKey: "activate-1"
};

const validUnlock = {
  killCauseResolved: true,
  riskEventsAcknowledged: true,
  reconcileSucceeded: true,
  unclearOrderCount: 0,
  actorType: TradingActorType.ADMIN,
  idempotencyKey: "unlock-1"
};

const validClose = { openExposureCount: 0, openOrderCount: 0, actorType: TradingActorType.ADMIN };

const permissiveCandidateContext: CandidateTransitionContext = {
  session: activeSession,
  claimed: true,
  snapshotComplete: true,
  invalidReasonCode: "STRATEGY_INPUT_INVALID",
  cancelReasonCode: "ASSIGNMENT_DISABLED",
  riskAssessmentStatus: RiskAssessmentStatus.PASS,
  decisionPresent: true,
  isExpired: true,
  hasEntryOrder: false
};

const permissiveOrderContext: OrderTransitionContext = {
  purpose: ShadowOrderPurpose.ENTRY,
  session: activeSession,
  reservationSucceeded: true,
  portfolioConsistent: true,
  earliestFillAtSet: true,
  rejectionReasonCode: "BELOW_INSTRUMENT_MINIMUM",
  cancelReasonCode: "KILL_SWITCH_ENGAGED",
  remainingQuantityIsZero: false
};

const permissivePositionContext: PositionTransitionContext = {
  exitPlanPresent: true,
  entryOrderSettled: true,
  openQuantityIsZero: false,
  openQuantityIsPositive: true,
  finalTrigger: null
};

const permissiveSessionContext: SessionTransitionContext = {
  activation: validActivation,
  unlock: validUnlock,
  close: validClose,
  killReasonCode: "ADMIN_COMMAND",
  lockReasonCode: "PORTFOLIO_INCONSISTENT"
};

const reason = (result: GuardResult): string => (result.ok ? "OK" : result.reasonCode);

// ── Generic properties that must hold for every machine ────────────────────

describe("state machines — structural properties", () => {
  const machines: Record<string, { states: readonly string[]; transitions: Readonly<Record<string, readonly string[]>>; terminal: ReadonlySet<string> }> =
    TRADING_STATE_MACHINES as never;

  for (const [name, machine] of Object.entries(machines)) {
    it(`${name}: terminal states have no outgoing edge`, () => {
      for (const state of machine.terminal) {
        assert.deepEqual(machine.transitions[state], [], `${state} must not have outgoing transitions`);
      }
    });

    it(`${name}: every target state is a declared state`, () => {
      for (const state of machine.states) {
        for (const target of machine.transitions[state]) {
          assert.ok(machine.states.includes(target), `${state} -> ${target} targets an unknown state`);
        }
      }
    });

    it(`${name}: every non-terminal state can still be left`, () => {
      for (const state of machine.states) {
        if (machine.terminal.has(state)) continue;
        assert.ok(machine.transitions[state].length > 0, `${state} is a dead end but not marked terminal`);
      }
    });
  }
});

describe("reason codes", () => {
  it("are unique, SCREAMING_SNAKE_CASE and self-identical", () => {
    const values = Object.entries(TradingReasonCode);
    const seen = new Set<string>();
    for (const [key, value] of values) {
      assert.equal(key, value, `${key} must equal its value so the persisted code stays stable`);
      assert.match(value, /^[A-Z][A-Z0-9_]*$/);
      assert.equal(seen.has(value), false, `duplicate reason code ${value}`);
      seen.add(value);
    }
    assert.equal(ALL_TRADING_REASON_CODES.length, seen.size);
  });
});

describe("fail-closed defaults", () => {
  it("start every structure disabled with the kill switch on", () => {
    assert.equal(TRADING_SAFE_DEFAULTS.tradingMode, TradingMode.DISABLED);
    assert.equal(TRADING_SAFE_DEFAULTS.strategyAssignmentEnabled, false);
    assert.equal(TRADING_SAFE_DEFAULTS.sessionStatus, TradingSessionStatus.STOPPED);
    assert.equal(TRADING_SAFE_DEFAULTS.killSwitchEngaged, true);
    assert.equal(TRADING_SAFE_DEFAULTS.portfolioStatus, PortfolioStatus.DRAFT);
  });
});

// ── Trade candidate ────────────────────────────────────────────────────────

describe("trade candidate transitions", () => {
  const allowed: ReadonlyArray<[TradeCandidateStatus, TradeCandidateStatus]> = [
    [TradeCandidateStatus.CREATED, TradeCandidateStatus.VALIDATING],
    [TradeCandidateStatus.CREATED, TradeCandidateStatus.EXPIRED],
    [TradeCandidateStatus.CREATED, TradeCandidateStatus.CANCELLED],
    [TradeCandidateStatus.VALIDATING, TradeCandidateStatus.READY_FOR_RISK],
    [TradeCandidateStatus.VALIDATING, TradeCandidateStatus.INVALID],
    [TradeCandidateStatus.VALIDATING, TradeCandidateStatus.EXPIRED],
    [TradeCandidateStatus.VALIDATING, TradeCandidateStatus.CANCELLED],
    [TradeCandidateStatus.READY_FOR_RISK, TradeCandidateStatus.APPROVED_FOR_SHADOW],
    [TradeCandidateStatus.READY_FOR_RISK, TradeCandidateStatus.RISK_REJECTED],
    [TradeCandidateStatus.READY_FOR_RISK, TradeCandidateStatus.EXPIRED],
    [TradeCandidateStatus.READY_FOR_RISK, TradeCandidateStatus.CANCELLED]
  ];

  it("accepts every documented edge", () => {
    for (const [from, to] of allowed) {
      assert.doesNotThrow(
        () => assertCandidateTransition(from, to, permissiveCandidateContext),
        `${from} -> ${to} should be allowed`
      );
    }
  });

  it("refuses every edge that is not documented", () => {
    const states = Object.values(TradeCandidateStatus);
    for (const from of states) {
      for (const to of states) {
        if (allowed.some(([a, b]) => a === from && b === to)) continue;
        const result = checkCandidateTransition(from, to, permissiveCandidateContext);
        assert.equal(result.ok, false, `${from} -> ${to} must be refused`);
        assert.ok(
          [
            TradingReasonCode.TRANSITION_NOT_ALLOWED,
            TradingReasonCode.TERMINAL_STATE_IMMUTABLE
          ].includes(reason(result) as never),
          `${from} -> ${to} produced ${reason(result)}`
        );
      }
    }
  });

  it("marks the five terminal states", () => {
    for (const status of [
      TradeCandidateStatus.APPROVED_FOR_SHADOW,
      TradeCandidateStatus.INVALID,
      TradeCandidateStatus.RISK_REJECTED,
      TradeCandidateStatus.EXPIRED,
      TradeCandidateStatus.CANCELLED
    ]) {
      assert.equal(isTerminalCandidateStatus(status), true);
      assert.equal(
        reason(checkCandidateTransition(status, TradeCandidateStatus.VALIDATING, permissiveCandidateContext)),
        TradingReasonCode.TERMINAL_STATE_IMMUTABLE
      );
    }
    assert.equal(isTerminalCandidateStatus(TradeCandidateStatus.CREATED), false);
  });

  it("requires a worker claim before validation", () => {
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.CREATED, TradeCandidateStatus.VALIDATING, {
          ...permissiveCandidateContext,
          claimed: false
        })
      ),
      TradingReasonCode.CANDIDATE_CLAIM_REQUIRED
    );
  });

  it("requires invalidReasonCode and cancelReasonCode", () => {
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.VALIDATING, TradeCandidateStatus.INVALID, {
          ...permissiveCandidateContext,
          invalidReasonCode: "   "
        })
      ),
      TradingReasonCode.CANDIDATE_INVALID_REASON_CODE_REQUIRED
    );
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.CREATED, TradeCandidateStatus.CANCELLED, {
          ...permissiveCandidateContext,
          cancelReasonCode: null
        })
      ),
      TradingReasonCode.CANDIDATE_CANCEL_REASON_CODE_REQUIRED
    );
  });

  it("requires a complete snapshot before risk", () => {
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.VALIDATING, TradeCandidateStatus.READY_FOR_RISK, {
          ...permissiveCandidateContext,
          snapshotComplete: false
        })
      ),
      TradingReasonCode.CANDIDATE_SNAPSHOT_INCOMPLETE
    );
  });

  it("only approves on a PASS assessment together with a decision", () => {
    for (const status of [RiskAssessmentStatus.FAIL, RiskAssessmentStatus.ERROR, null]) {
      assert.equal(
        reason(
          checkCandidateTransition(
            TradeCandidateStatus.READY_FOR_RISK,
            TradeCandidateStatus.APPROVED_FOR_SHADOW,
            { ...permissiveCandidateContext, riskAssessmentStatus: status }
          )
        ),
        TradingReasonCode.CANDIDATE_RISK_NOT_PASSED
      );
    }
    assert.equal(
      reason(
        checkCandidateTransition(
          TradeCandidateStatus.READY_FOR_RISK,
          TradeCandidateStatus.APPROVED_FOR_SHADOW,
          { ...permissiveCandidateContext, decisionPresent: false }
        )
      ),
      TradingReasonCode.CANDIDATE_DECISION_REQUIRED
    );
  });

  it("only expires an unexpired candidate that has no entry order", () => {
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.CREATED, TradeCandidateStatus.EXPIRED, {
          ...permissiveCandidateContext,
          isExpired: false
        })
      ),
      TradingReasonCode.CANDIDATE_NOT_EXPIRED
    );
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.READY_FOR_RISK, TradeCandidateStatus.EXPIRED, {
          ...permissiveCandidateContext,
          hasEntryOrder: true
        })
      ),
      TradingReasonCode.CANDIDATE_HAS_ENTRY_ORDER
    );
  });

  it("lets a blocked session only cancel or expire, never advance", () => {
    const blocked = { ...permissiveCandidateContext, session: killedSession };
    assert.equal(
      reason(checkCandidateTransition(TradeCandidateStatus.CREATED, TradeCandidateStatus.VALIDATING, blocked)),
      TradingReasonCode.SESSION_BLOCKS_CANDIDATE
    );
    assert.equal(
      reason(
        checkCandidateTransition(TradeCandidateStatus.VALIDATING, TradeCandidateStatus.READY_FOR_RISK, blocked)
      ),
      TradingReasonCode.SESSION_BLOCKS_CANDIDATE
    );
    assert.equal(
      reason(
        checkCandidateTransition(
          TradeCandidateStatus.READY_FOR_RISK,
          TradeCandidateStatus.APPROVED_FOR_SHADOW,
          blocked
        )
      ),
      TradingReasonCode.SESSION_BLOCKS_RISK_APPROVAL
    );
    assert.equal(
      checkCandidateTransition(TradeCandidateStatus.VALIDATING, TradeCandidateStatus.CANCELLED, blocked).ok,
      true
    );
    assert.equal(
      checkCandidateTransition(TradeCandidateStatus.CREATED, TradeCandidateStatus.EXPIRED, blocked).ok,
      true
    );
  });

  it("throws a TradingDomainError carrying the reason code", () => {
    assert.throws(
      () =>
        assertCandidateTransition(
          TradeCandidateStatus.CREATED,
          TradeCandidateStatus.APPROVED_FOR_SHADOW,
          permissiveCandidateContext
        ),
      (error: unknown) => {
        assert.ok(error instanceof TradingDomainError);
        assert.equal(error.reasonCode, TradingReasonCode.TRANSITION_NOT_ALLOWED);
        return true;
      }
    );
  });
});

// ── Trade decision ─────────────────────────────────────────────────────────

describe("trade decision", () => {
  const base = {
    candidateStatus: TradeCandidateStatus.READY_FOR_RISK,
    riskAssessmentStatus: RiskAssessmentStatus.PASS,
    outcome: TradeDecisionOutcome.APPROVE_SHADOW,
    reasonCode: "RISK_PASS",
    existingDecisionOutcome: null
  };

  it("maps each risk status to exactly one outcome", () => {
    assert.equal(checkDecision(base).ok, true);
    assert.equal(
      checkDecision({
        ...base,
        riskAssessmentStatus: RiskAssessmentStatus.FAIL,
        outcome: TradeDecisionOutcome.REJECT
      }).ok,
      true
    );
    assert.equal(
      checkDecision({
        ...base,
        riskAssessmentStatus: RiskAssessmentStatus.ERROR,
        outcome: TradeDecisionOutcome.ERROR
      }).ok,
      true
    );
    assert.equal(
      reason(checkDecision({ ...base, riskAssessmentStatus: RiskAssessmentStatus.FAIL })),
      TradingReasonCode.DECISION_OUTCOME_MISMATCH
    );
  });

  it("refuses a second final decision for the same candidate", () => {
    assert.equal(
      reason(checkDecision({ ...base, existingDecisionOutcome: TradeDecisionOutcome.REJECT })),
      TradingReasonCode.DECISION_ALREADY_FINAL
    );
  });

  it("requires a reason code and a risk assessment", () => {
    assert.equal(
      reason(checkDecision({ ...base, reasonCode: "" })),
      TradingReasonCode.DECISION_REASON_CODE_REQUIRED
    );
    assert.equal(
      reason(checkDecision({ ...base, riskAssessmentStatus: null })),
      TradingReasonCode.DECISION_RISK_ASSESSMENT_REQUIRED
    );
  });

  it("requires READY_FOR_RISK for a risk outcome but not for expiry or cancellation", () => {
    assert.equal(
      reason(checkDecision({ ...base, candidateStatus: TradeCandidateStatus.CREATED })),
      TradingReasonCode.DECISION_CANDIDATE_NOT_READY
    );
    assert.equal(
      checkDecision({
        ...base,
        candidateStatus: TradeCandidateStatus.CREATED,
        riskAssessmentStatus: null,
        outcome: TradeDecisionOutcome.EXPIRE,
        reasonCode: "CANDIDATE_EXPIRED"
      }).ok,
      true
    );
  });

  it("derives the candidate status a completed assessment leads to", () => {
    assert.equal(
      candidateStatusForRiskStatus(RiskAssessmentStatus.PASS),
      TradeCandidateStatus.APPROVED_FOR_SHADOW
    );
    assert.equal(
      candidateStatusForRiskStatus(RiskAssessmentStatus.FAIL),
      TradeCandidateStatus.RISK_REJECTED
    );
    assert.equal(
      candidateStatusForRiskStatus(RiskAssessmentStatus.ERROR),
      TradeCandidateStatus.RISK_REJECTED
    );
  });
});

// ── Risk assessment ────────────────────────────────────────────────────────

describe("risk assessment", () => {
  it("is written once and never rewritten", () => {
    assert.equal(
      checkRiskAssessment({
        existingStatus: null,
        incomingStatus: RiskAssessmentStatus.PASS,
        ruleCodes: ["R-001-SHADOW-MODE", "R-002-SESSION"]
      }).ok,
      true
    );
    assert.equal(
      reason(
        checkRiskAssessment({
          existingStatus: RiskAssessmentStatus.FAIL,
          incomingStatus: RiskAssessmentStatus.PASS,
          ruleCodes: []
        })
      ),
      TradingReasonCode.RISK_ASSESSMENT_IMMUTABLE
    );
  });

  it("refuses duplicate rule results", () => {
    assert.equal(
      reason(
        checkRiskAssessment({
          existingStatus: null,
          incomingStatus: RiskAssessmentStatus.FAIL,
          ruleCodes: ["R-009-RISK-PER-TRADE", "R-009-RISK-PER-TRADE"]
        })
      ),
      TradingReasonCode.RISK_RULE_RESULT_DUPLICATE
    );
  });
});

// ── Shadow order ───────────────────────────────────────────────────────────

describe("shadow order transitions", () => {
  const allowed: ReadonlyArray<[ShadowOrderStatus, ShadowOrderStatus]> = [
    [ShadowOrderStatus.PROPOSED, ShadowOrderStatus.ACCEPTED],
    [ShadowOrderStatus.PROPOSED, ShadowOrderStatus.REJECTED],
    [ShadowOrderStatus.ACCEPTED, ShadowOrderStatus.WAITING_FOR_ENTRY],
    [ShadowOrderStatus.ACCEPTED, ShadowOrderStatus.CANCELLED],
    [ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.PARTIALLY_FILLED],
    [ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.FILLED],
    [ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.CANCELLED],
    [ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.EXPIRED],
    [ShadowOrderStatus.PARTIALLY_FILLED, ShadowOrderStatus.PARTIALLY_FILLED],
    [ShadowOrderStatus.PARTIALLY_FILLED, ShadowOrderStatus.FILLED],
    [ShadowOrderStatus.PARTIALLY_FILLED, ShadowOrderStatus.CANCELLED],
    [ShadowOrderStatus.PARTIALLY_FILLED, ShadowOrderStatus.EXPIRED]
  ];

  const contextFor = (to: ShadowOrderStatus): OrderTransitionContext => ({
    ...permissiveOrderContext,
    remainingQuantityIsZero: to === ShadowOrderStatus.FILLED
  });

  it("accepts every documented edge", () => {
    for (const [from, to] of allowed) {
      assert.doesNotThrow(
        () => assertOrderTransition(from, to, contextFor(to)),
        `${from} -> ${to} should be allowed`
      );
    }
  });

  it("refuses every edge that is not documented", () => {
    const states = Object.values(ShadowOrderStatus);
    for (const from of states) {
      for (const to of states) {
        if (allowed.some(([a, b]) => a === from && b === to)) continue;
        const result = checkOrderTransition(from, to, contextFor(to));
        assert.equal(result.ok, false, `${from} -> ${to} must be refused`);
      }
    }
  });

  it("keeps ACCEPTED out of EXPIRED — only a waiting order can expire", () => {
    assert.equal(
      reason(checkOrderTransition(ShadowOrderStatus.ACCEPTED, ShadowOrderStatus.EXPIRED, permissiveOrderContext)),
      TradingReasonCode.TRANSITION_NOT_ALLOWED
    );
  });

  it("marks the four terminal states", () => {
    for (const status of [
      ShadowOrderStatus.FILLED,
      ShadowOrderStatus.REJECTED,
      ShadowOrderStatus.CANCELLED,
      ShadowOrderStatus.EXPIRED
    ]) {
      assert.equal(isTerminalOrderStatus(status), true);
      assert.equal(
        reason(checkOrderTransition(status, ShadowOrderStatus.ACCEPTED, permissiveOrderContext)),
        TradingReasonCode.TERMINAL_STATE_IMMUTABLE
      );
    }
  });

  it("never accepts an entry order without a complete reservation", () => {
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.PROPOSED, ShadowOrderStatus.ACCEPTED, {
          ...permissiveOrderContext,
          reservationSucceeded: false
        })
      ),
      TradingReasonCode.ORDER_RESERVATION_REQUIRED
    );
  });

  it("blocks entry acceptance and entry fills while the session is killed", () => {
    const blocked: OrderTransitionContext = { ...permissiveOrderContext, session: killedSession };
    assert.equal(
      reason(checkOrderTransition(ShadowOrderStatus.PROPOSED, ShadowOrderStatus.ACCEPTED, blocked)),
      TradingReasonCode.SESSION_BLOCKS_ENTRY
    );
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.PARTIALLY_FILLED, blocked)
      ),
      TradingReasonCode.SESSION_BLOCKS_ENTRY
    );
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.FILLED, {
          ...blocked,
          remainingQuantityIsZero: true
        })
      ),
      TradingReasonCode.SESSION_BLOCKS_ENTRY
    );
  });

  it("still lets a risk-reducing exit order proceed while the session is killed", () => {
    const exit: OrderTransitionContext = {
      ...permissiveOrderContext,
      purpose: ShadowOrderPurpose.EXIT,
      session: killedSession
    };
    assert.equal(checkOrderTransition(ShadowOrderStatus.PROPOSED, ShadowOrderStatus.ACCEPTED, exit).ok, true);
    assert.equal(
      checkOrderTransition(ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.FILLED, {
        ...exit,
        remainingQuantityIsZero: true
      }).ok,
      true
    );
  });

  it("requires a consistent portfolio for an exit order", () => {
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.PROPOSED, ShadowOrderStatus.ACCEPTED, {
          ...permissiveOrderContext,
          purpose: ShadowOrderPurpose.EXIT,
          portfolioConsistent: false
        })
      ),
      TradingReasonCode.PORTFOLIO_INCONSISTENT
    );
  });

  it("distinguishes partial from full fills by the remaining quantity", () => {
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.FILLED, {
          ...permissiveOrderContext,
          remainingQuantityIsZero: false
        })
      ),
      TradingReasonCode.ORDER_REMAINING_QUANTITY_MISMATCH
    );
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.WAITING_FOR_ENTRY, ShadowOrderStatus.PARTIALLY_FILLED, {
          ...permissiveOrderContext,
          remainingQuantityIsZero: true
        })
      ),
      TradingReasonCode.ORDER_REMAINING_QUANTITY_MISMATCH
    );
  });

  it("requires earliestFillAt, rejection and cancel reason codes", () => {
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.ACCEPTED, ShadowOrderStatus.WAITING_FOR_ENTRY, {
          ...permissiveOrderContext,
          earliestFillAtSet: false
        })
      ),
      TradingReasonCode.ORDER_EARLIEST_FILL_AT_REQUIRED
    );
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.PROPOSED, ShadowOrderStatus.REJECTED, {
          ...permissiveOrderContext,
          rejectionReasonCode: null
        })
      ),
      TradingReasonCode.ORDER_REJECTION_REASON_CODE_REQUIRED
    );
    assert.equal(
      reason(
        checkOrderTransition(ShadowOrderStatus.ACCEPTED, ShadowOrderStatus.CANCELLED, {
          ...permissiveOrderContext,
          cancelReasonCode: ""
        })
      ),
      TradingReasonCode.ORDER_CANCEL_REASON_CODE_REQUIRED
    );
  });

  it("has no order amendment in v1", () => {
    assert.equal(reason(checkOrderModification()), TradingReasonCode.ORDER_MODIFICATION_FORBIDDEN);
  });
});

// ── Shadow position ────────────────────────────────────────────────────────

describe("shadow position transitions", () => {
  const allowed: ReadonlyArray<[ShadowPositionStatus, ShadowPositionStatus]> = [
    [ShadowPositionStatus.OPENING, ShadowPositionStatus.OPEN],
    [ShadowPositionStatus.OPENING, ShadowPositionStatus.ERROR],
    [ShadowPositionStatus.OPEN, ShadowPositionStatus.PARTIALLY_CLOSED],
    [ShadowPositionStatus.OPEN, ShadowPositionStatus.CLOSED],
    [ShadowPositionStatus.OPEN, ShadowPositionStatus.STOPPED_OUT],
    [ShadowPositionStatus.OPEN, ShadowPositionStatus.INVALIDATED],
    [ShadowPositionStatus.OPEN, ShadowPositionStatus.ERROR],
    [ShadowPositionStatus.PARTIALLY_CLOSED, ShadowPositionStatus.PARTIALLY_CLOSED],
    [ShadowPositionStatus.PARTIALLY_CLOSED, ShadowPositionStatus.CLOSED],
    [ShadowPositionStatus.PARTIALLY_CLOSED, ShadowPositionStatus.STOPPED_OUT],
    [ShadowPositionStatus.PARTIALLY_CLOSED, ShadowPositionStatus.INVALIDATED],
    [ShadowPositionStatus.PARTIALLY_CLOSED, ShadowPositionStatus.ERROR]
  ];

  const contextFor = (to: ShadowPositionStatus): PositionTransitionContext => {
    const closingTrigger: Partial<Record<ShadowPositionStatus, ShadowFillTriggerType>> = {
      CLOSED: ShadowFillTriggerType.TAKE_PROFIT,
      STOPPED_OUT: ShadowFillTriggerType.STOP,
      INVALIDATED: ShadowFillTriggerType.INVALIDATION
    };
    const trigger = closingTrigger[to] ?? null;
    return {
      ...permissivePositionContext,
      openQuantityIsZero: trigger !== null,
      openQuantityIsPositive: trigger === null,
      finalTrigger: trigger
    };
  };

  it("accepts every documented edge", () => {
    for (const [from, to] of allowed) {
      assert.doesNotThrow(
        () => assertPositionTransition(from, to, contextFor(to)),
        `${from} -> ${to} should be allowed`
      );
    }
  });

  it("refuses every edge that is not documented", () => {
    const states = Object.values(ShadowPositionStatus);
    for (const from of states) {
      for (const to of states) {
        if (allowed.some(([a, b]) => a === from && b === to)) continue;
        assert.equal(
          checkPositionTransition(from, to, contextFor(to)).ok,
          false,
          `${from} -> ${to} must be refused`
        );
      }
    }
  });

  it("never opens without an exit plan", () => {
    assert.equal(
      reason(
        checkPositionTransition(ShadowPositionStatus.OPENING, ShadowPositionStatus.OPEN, {
          ...permissivePositionContext,
          exitPlanPresent: false
        })
      ),
      TradingReasonCode.POSITION_EXIT_PLAN_REQUIRED
    );
  });

  it("requires a settled entry order and a positive quantity to open", () => {
    assert.equal(
      reason(
        checkPositionTransition(ShadowPositionStatus.OPENING, ShadowPositionStatus.OPEN, {
          ...permissivePositionContext,
          entryOrderSettled: false
        })
      ),
      TradingReasonCode.POSITION_ENTRY_NOT_SETTLED
    );
    assert.equal(
      reason(
        checkPositionTransition(ShadowPositionStatus.OPENING, ShadowPositionStatus.OPEN, {
          ...permissivePositionContext,
          openQuantityIsPositive: false
        })
      ),
      TradingReasonCode.POSITION_OPEN_QUANTITY_MUST_BE_POSITIVE
    );
  });

  it("matches the final trigger to the terminal state", () => {
    assert.equal(
      reason(
        checkPositionTransition(ShadowPositionStatus.OPEN, ShadowPositionStatus.CLOSED, {
          ...contextFor(ShadowPositionStatus.CLOSED),
          finalTrigger: ShadowFillTriggerType.STOP
        })
      ),
      TradingReasonCode.POSITION_FINAL_TRIGGER_MISMATCH
    );
    assert.equal(
      reason(
        checkPositionTransition(ShadowPositionStatus.OPEN, ShadowPositionStatus.STOPPED_OUT, {
          ...contextFor(ShadowPositionStatus.STOPPED_OUT),
          finalTrigger: ShadowFillTriggerType.TAKE_PROFIT
        })
      ),
      TradingReasonCode.POSITION_FINAL_TRIGGER_MISMATCH
    );
    for (const trigger of [
      ShadowFillTriggerType.TAKE_PROFIT,
      ShadowFillTriggerType.TIME_EXIT,
      ShadowFillTriggerType.MANUAL_RISK_CLOSE
    ]) {
      assert.equal(
        checkPositionTransition(ShadowPositionStatus.OPEN, ShadowPositionStatus.CLOSED, {
          ...contextFor(ShadowPositionStatus.CLOSED),
          finalTrigger: trigger
        }).ok,
        true
      );
    }
  });

  it("requires a zero quantity for every terminal close", () => {
    for (const to of [
      ShadowPositionStatus.CLOSED,
      ShadowPositionStatus.STOPPED_OUT,
      ShadowPositionStatus.INVALIDATED
    ]) {
      assert.equal(
        reason(
          checkPositionTransition(ShadowPositionStatus.OPEN, to, {
            ...contextFor(to),
            openQuantityIsZero: false
          })
        ),
        TradingReasonCode.POSITION_OPEN_QUANTITY_MUST_BE_ZERO
      );
    }
  });

  it("allows ERROR from any non-terminal state without further conditions", () => {
    for (const from of [
      ShadowPositionStatus.OPENING,
      ShadowPositionStatus.OPEN,
      ShadowPositionStatus.PARTIALLY_CLOSED
    ]) {
      assert.equal(
        checkPositionTransition(from, ShadowPositionStatus.ERROR, { exitPlanPresent: false }).ok,
        true
      );
    }
  });

  it("keeps counting an ERROR position with quantity as exposure", () => {
    assert.equal(carriesExposure(ShadowPositionStatus.ERROR, true), true);
    assert.equal(carriesExposure(ShadowPositionStatus.OPENING, false), true);
    assert.equal(carriesExposure(ShadowPositionStatus.PARTIALLY_CLOSED, false), true);
    assert.equal(carriesExposure(ShadowPositionStatus.CLOSED, false), false);
    assert.equal(carriesExposure(ShadowPositionStatus.ERROR, false), false);
    assert.equal(isTerminalPositionStatus(ShadowPositionStatus.ERROR), true);
  });

  it("forbids scale-in while a position or entry order is live", () => {
    assert.equal(reason(checkNoScaleIn(true)), TradingReasonCode.POSITION_SCALE_IN_FORBIDDEN);
    assert.equal(checkNoScaleIn(false).ok, true);
  });
});

// ── Exit plan ──────────────────────────────────────────────────────────────

describe("exit plan transitions", () => {
  const full = {
    triggeredBy: ShadowFillTriggerType.STOP,
    sourceCandleId: "candle-1",
    positionTerminal: true,
    openExitFillsRemaining: false,
    positionHasExposure: false
  };

  it("accepts the documented edges only", () => {
    assert.equal(checkExitPlanTransition(ExitPlanStatus.ACTIVE, ExitPlanStatus.TRIGGERED, full).ok, true);
    assert.equal(checkExitPlanTransition(ExitPlanStatus.TRIGGERED, ExitPlanStatus.COMPLETED, full).ok, true);
    assert.equal(checkExitPlanTransition(ExitPlanStatus.ACTIVE, ExitPlanStatus.CANCELLED, full).ok, true);
    assert.equal(
      reason(checkExitPlanTransition(ExitPlanStatus.TRIGGERED, ExitPlanStatus.ACTIVE, full)),
      TradingReasonCode.TRANSITION_NOT_ALLOWED
    );
    assert.equal(
      reason(checkExitPlanTransition(ExitPlanStatus.ACTIVE, ExitPlanStatus.COMPLETED, full)),
      TradingReasonCode.TRANSITION_NOT_ALLOWED
    );
    for (const terminal of [ExitPlanStatus.COMPLETED, ExitPlanStatus.CANCELLED]) {
      assert.equal(isTerminalExitPlanStatus(terminal), true);
      assert.equal(
        reason(checkExitPlanTransition(terminal, ExitPlanStatus.ACTIVE, full)),
        TradingReasonCode.TERMINAL_STATE_IMMUTABLE
      );
    }
  });

  it("requires exactly one trigger and its source candle", () => {
    assert.equal(
      reason(
        checkExitPlanTransition(ExitPlanStatus.ACTIVE, ExitPlanStatus.TRIGGERED, {
          ...full,
          triggeredBy: null
        })
      ),
      TradingReasonCode.EXIT_PLAN_TRIGGER_REQUIRED
    );
    assert.equal(
      reason(
        checkExitPlanTransition(ExitPlanStatus.ACTIVE, ExitPlanStatus.TRIGGERED, {
          ...full,
          sourceCandleId: null
        })
      ),
      TradingReasonCode.EXIT_PLAN_SOURCE_CANDLE_REQUIRED
    );
  });

  it("only completes once the position is terminal and all exits are booked", () => {
    assert.equal(
      reason(
        checkExitPlanTransition(ExitPlanStatus.TRIGGERED, ExitPlanStatus.COMPLETED, {
          ...full,
          positionTerminal: false
        })
      ),
      TradingReasonCode.EXIT_PLAN_POSITION_NOT_TERMINAL
    );
    assert.equal(
      reason(
        checkExitPlanTransition(ExitPlanStatus.TRIGGERED, ExitPlanStatus.COMPLETED, {
          ...full,
          openExitFillsRemaining: true
        })
      ),
      TradingReasonCode.EXIT_PLAN_OPEN_EXITS_PRESENT
    );
  });

  it("only cancels a plan whose position carries no exposure", () => {
    assert.equal(
      reason(
        checkExitPlanTransition(ExitPlanStatus.ACTIVE, ExitPlanStatus.CANCELLED, {
          ...full,
          positionHasExposure: true
        })
      ),
      TradingReasonCode.EXIT_PLAN_EXPOSURE_PRESENT
    );
  });
});

// ── Session, kill switch and locks ─────────────────────────────────────────

describe("trading session transitions", () => {
  const allowed: ReadonlyArray<[TradingSessionStatus, TradingSessionStatus]> = [
    [TradingSessionStatus.STOPPED, TradingSessionStatus.SHADOW_ACTIVE],
    [TradingSessionStatus.STOPPED, TradingSessionStatus.KILLED],
    [TradingSessionStatus.STOPPED, TradingSessionStatus.ERROR_LOCKED],
    [TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.PAUSED],
    [TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.KILLED],
    [TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.ERROR_LOCKED],
    [TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.CLOSED],
    [TradingSessionStatus.PAUSED, TradingSessionStatus.SHADOW_ACTIVE],
    [TradingSessionStatus.PAUSED, TradingSessionStatus.KILLED],
    [TradingSessionStatus.PAUSED, TradingSessionStatus.ERROR_LOCKED],
    [TradingSessionStatus.PAUSED, TradingSessionStatus.CLOSED],
    [TradingSessionStatus.KILLED, TradingSessionStatus.STOPPED],
    [TradingSessionStatus.KILLED, TradingSessionStatus.CLOSED],
    [TradingSessionStatus.ERROR_LOCKED, TradingSessionStatus.STOPPED],
    [TradingSessionStatus.ERROR_LOCKED, TradingSessionStatus.CLOSED]
  ];

  it("accepts every documented edge", () => {
    for (const [from, to] of allowed) {
      assert.doesNotThrow(
        () => assertSessionTransition(from, to, permissiveSessionContext),
        `${from} -> ${to} should be allowed`
      );
    }
  });

  it("refuses every edge that is not documented", () => {
    const states = Object.values(TradingSessionStatus);
    for (const from of states) {
      for (const to of states) {
        if (allowed.some(([a, b]) => a === from && b === to)) continue;
        assert.equal(
          checkSessionTransition(from, to, permissiveSessionContext).ok,
          false,
          `${from} -> ${to} must be refused`
        );
      }
    }
  });

  it("never lets a killed or locked session activate in one step", () => {
    for (const from of [TradingSessionStatus.KILLED, TradingSessionStatus.ERROR_LOCKED]) {
      assert.equal(
        reason(checkSessionTransition(from, TradingSessionStatus.SHADOW_ACTIVE, permissiveSessionContext)),
        TradingReasonCode.TRANSITION_NOT_ALLOWED
      );
    }
  });

  it("treats CLOSED as terminal and read-only", () => {
    assert.equal(isTerminalSessionStatus(TradingSessionStatus.CLOSED), true);
    for (const to of Object.values(TradingSessionStatus)) {
      if (to === TradingSessionStatus.CLOSED) continue;
      assert.equal(
        reason(checkSessionTransition(TradingSessionStatus.CLOSED, to, permissiveSessionContext)),
        TradingReasonCode.TERMINAL_STATE_IMMUTABLE
      );
    }
  });

  it("enforces every activation guard from the specification", () => {
    const cases: ReadonlyArray<[Partial<SessionActivationContext>, string]> = [
      [{ killSwitchEngaged: true }, TradingReasonCode.SESSION_KILL_SWITCH_ENGAGED],
      [{ portfolioStatus: PortfolioStatus.DRAFT }, TradingReasonCode.SESSION_PORTFOLIO_NOT_ACTIVE],
      [{ reconcileSucceeded: false }, TradingReasonCode.SESSION_RECONCILE_REQUIRED],
      [{ reconcileFresh: false }, TradingReasonCode.SESSION_RECONCILE_STALE],
      [{ activeRiskLimitSetCount: 0 }, TradingReasonCode.SESSION_RISK_LIMIT_SET_REQUIRED],
      [{ activeRiskLimitSetCount: 2 }, TradingReasonCode.SESSION_RISK_LIMIT_SET_REQUIRED],
      [{ validExecutionProfilesPresent: false }, TradingReasonCode.SESSION_EXECUTION_PROFILE_REQUIRED],
      [{ activeAssignmentCount: 0 }, TradingReasonCode.SESSION_ASSIGNMENT_REQUIRED],
      [{ assignmentScopeAllowed: false }, TradingReasonCode.SESSION_ASSIGNMENT_SCOPE_NOT_ALLOWED],
      [
        { unacknowledgedCriticalRiskEventCount: 1 },
        TradingReasonCode.SESSION_UNACKNOWLEDGED_CRITICAL_RISK_EVENT
      ],
      [{ expiredClaimCount: 1 }, TradingReasonCode.SESSION_EXPIRED_CLAIMS_PRESENT],
      [{ unknownOpenAggregateCount: 1 }, TradingReasonCode.SESSION_UNKNOWN_OPEN_AGGREGATES],
      [{ actorType: TradingActorType.SYSTEM }, TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED],
      [{ idempotencyKey: null }, TradingReasonCode.SESSION_IDEMPOTENCY_KEY_REQUIRED],
      [
        { capability: { ...validCapability, tradingMode: TradingMode.DISABLED } },
        TradingReasonCode.MODE_NOT_SHADOW
      ],
      [
        { capability: { ...validCapability, tradingMode: "LIVE" } },
        TradingReasonCode.CONFIG_INVALID
      ],
      [
        { capability: { ...validCapability, enableLiveTrading: true } },
        TradingReasonCode.LIVE_TRADING_FORBIDDEN
      ],
      [
        { capability: { ...validCapability, buildCapability: "FULL" } },
        TradingReasonCode.BUILD_CAPABILITY_NOT_SHADOW_ONLY
      ],
      [
        { capability: { ...validCapability, shadowMasterFlagEnabled: false } },
        TradingReasonCode.SHADOW_MASTER_FLAG_DISABLED
      ]
    ];

    for (const [override, expected] of cases) {
      const result = checkSessionTransition(
        TradingSessionStatus.STOPPED,
        TradingSessionStatus.SHADOW_ACTIVE,
        { activation: { ...validActivation, ...override } }
      );
      assert.equal(reason(result), expected, `override ${JSON.stringify(override)}`);
    }
  });

  it("applies the same guards when resuming from PAUSED", () => {
    assert.equal(
      reason(
        checkSessionTransition(TradingSessionStatus.PAUSED, TradingSessionStatus.SHADOW_ACTIVE, {
          activation: { ...validActivation, killSwitchEngaged: true }
        })
      ),
      TradingReasonCode.SESSION_KILL_SWITCH_ENGAGED
    );
  });

  it("enforces every unlock guard", () => {
    const cases: ReadonlyArray<[Partial<typeof validUnlock>, string]> = [
      [{ killCauseResolved: false }, TradingReasonCode.SESSION_KILL_CAUSE_UNRESOLVED],
      [{ riskEventsAcknowledged: false }, TradingReasonCode.SESSION_RISK_EVENT_NOT_ACKNOWLEDGED],
      [{ reconcileSucceeded: false }, TradingReasonCode.SESSION_RECONCILE_REQUIRED],
      [{ unclearOrderCount: 1 }, TradingReasonCode.SESSION_UNCLEAR_ORDERS_PRESENT],
      [{ actorType: TradingActorType.RECOVERY }, TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED],
      [{ idempotencyKey: null }, TradingReasonCode.SESSION_IDEMPOTENCY_KEY_REQUIRED]
    ];
    for (const [override, expected] of cases) {
      assert.equal(
        reason(
          checkSessionTransition(TradingSessionStatus.KILLED, TradingSessionStatus.STOPPED, {
            unlock: { ...validUnlock, ...override }
          })
        ),
        expected
      );
    }
  });

  it("requires reason codes for kill and error lock", () => {
    assert.equal(
      reason(
        checkSessionTransition(TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.KILLED, {})
      ),
      TradingReasonCode.SESSION_KILL_REASON_CODE_REQUIRED
    );
    assert.equal(
      reason(
        checkSessionTransition(TradingSessionStatus.SHADOW_ACTIVE, TradingSessionStatus.ERROR_LOCKED, {})
      ),
      TradingReasonCode.SESSION_LOCK_REASON_CODE_REQUIRED
    );
  });

  it("only closes a session without exposure or open orders", () => {
    assert.equal(
      reason(
        checkSessionTransition(TradingSessionStatus.KILLED, TradingSessionStatus.CLOSED, {
          close: { ...validClose, openExposureCount: 1 }
        })
      ),
      TradingReasonCode.SESSION_OPEN_EXPOSURE_PRESENT
    );
    assert.equal(
      reason(
        checkSessionTransition(TradingSessionStatus.KILLED, TradingSessionStatus.CLOSED, {
          close: { ...validClose, openOrderCount: 2 }
        })
      ),
      TradingReasonCode.SESSION_OPEN_ORDERS_PRESENT
    );
    assert.equal(
      reason(
        checkSessionTransition(TradingSessionStatus.KILLED, TradingSessionStatus.CLOSED, {
          close: { ...validClose, actorType: TradingActorType.SYSTEM }
        })
      ),
      TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED
    );
  });
});

describe("session capability matrix", () => {
  it("matches docs/trading/04 row by row", () => {
    const expected: Record<
      string,
      [boolean, boolean, boolean, boolean, boolean, boolean]
    > = {
      // status: [candidates, approve, entryFills, monitor, reconcile, readOnly]
      STOPPED: [false, false, false, true, true, false],
      SHADOW_ACTIVE: [true, true, true, true, true, false],
      PAUSED: [false, false, false, true, true, false],
      KILLED: [false, false, false, true, true, false],
      ERROR_LOCKED: [false, false, false, true, true, false],
      CLOSED: [false, false, false, false, false, true]
    };

    for (const [status, row] of Object.entries(expected)) {
      const capabilities = sessionCapabilities({
        status: status as TradingSessionStatus,
        killSwitchEngaged: status === TradingSessionStatus.KILLED
      });
      assert.deepEqual(
        [
          capabilities.canCreateCandidates,
          capabilities.canApproveAndReserve,
          capabilities.canFillEntries,
          capabilities.canMonitorPositions,
          capabilities.canReconcile,
          capabilities.isReadOnly
        ],
        row,
        `capability row for ${status}`
      );
    }
  });

  it("cancels open entry orders in every blocked-but-live state", () => {
    for (const status of [
      TradingSessionStatus.PAUSED,
      TradingSessionStatus.KILLED,
      TradingSessionStatus.ERROR_LOCKED
    ]) {
      assert.equal(sessionCapabilities({ status, killSwitchEngaged: false }).mustCancelOpenEntryOrders, true);
    }
    assert.equal(
      sessionCapabilities({ status: TradingSessionStatus.STOPPED, killSwitchEngaged: true })
        .mustCancelOpenEntryOrders,
      false
    );
  });

  it("makes reconciliation mandatory only under ERROR_LOCKED", () => {
    assert.equal(
      sessionCapabilities({ status: TradingSessionStatus.ERROR_LOCKED, killSwitchEngaged: false })
        .reconcileRequired,
      true
    );
    assert.equal(
      sessionCapabilities({ status: TradingSessionStatus.PAUSED, killSwitchEngaged: false }).reconcileRequired,
      false
    );
  });

  it("degrades an active session with an engaged kill switch to blocked", () => {
    const degraded = sessionCapabilities({
      status: TradingSessionStatus.SHADOW_ACTIVE,
      killSwitchEngaged: true
    });
    assert.equal(degraded.canCreateCandidates, false);
    assert.equal(degraded.canApproveAndReserve, false);
    assert.equal(degraded.canFillEntries, false);
    assert.equal(degraded.canMonitorPositions, true);
    assert.equal(degraded.canExecuteRiskReducingExit, true);
    assert.equal(reason(checkEntryAllowed(degraded)), TradingReasonCode.SESSION_BLOCKS_ENTRY);
    assert.equal(checkEntryAllowed(activeSession).ok, true);
  });

  it("keeps monitoring and risk reduction alive in every blocked state", () => {
    for (const status of [
      TradingSessionStatus.STOPPED,
      TradingSessionStatus.PAUSED,
      TradingSessionStatus.KILLED,
      TradingSessionStatus.ERROR_LOCKED
    ]) {
      const capabilities = sessionCapabilities({ status, killSwitchEngaged: true });
      assert.equal(capabilities.canMonitorPositions, true, status);
      assert.equal(capabilities.canExecuteRiskReducingExit, true, status);
      assert.equal(capabilities.canCancelOrders, true, status);
    }
  });
});

describe("kill switch", () => {
  it("can always be engaged with a reason, except on a closed session", () => {
    for (const status of [
      TradingSessionStatus.STOPPED,
      TradingSessionStatus.SHADOW_ACTIVE,
      TradingSessionStatus.PAUSED,
      TradingSessionStatus.KILLED,
      TradingSessionStatus.ERROR_LOCKED
    ]) {
      assert.equal(
        checkKillSwitchTransition(
          { status, killSwitchEngaged: false },
          {
            action: KillSwitchAction.ENGAGE,
            reasonCode: "DAILY_LOSS_LIMIT_REACHED",
            actorType: TradingActorType.SYSTEM
          }
        ).ok,
        true,
        status
      );
    }
    assert.equal(
      reason(
        checkKillSwitchTransition(
          { status: TradingSessionStatus.CLOSED, killSwitchEngaged: false },
          {
            action: KillSwitchAction.ENGAGE,
            reasonCode: "ADMIN_COMMAND",
            actorType: TradingActorType.ADMIN
          }
        )
      ),
      TradingReasonCode.SESSION_CLOSED_READ_ONLY
    );
  });

  it("requires a reason code to engage", () => {
    assert.equal(
      reason(
        checkKillSwitchTransition(
          { status: TradingSessionStatus.SHADOW_ACTIVE, killSwitchEngaged: false },
          { action: KillSwitchAction.ENGAGE, reasonCode: null, actorType: TradingActorType.ADMIN }
        )
      ),
      TradingReasonCode.SESSION_KILL_REASON_CODE_REQUIRED
    );
  });

  it("only releases from STOPPED, by an admin, after a successful reconcile", () => {
    const release = {
      action: KillSwitchAction.RELEASE,
      actorType: TradingActorType.ADMIN,
      reconcileSucceeded: true
    };
    assert.equal(
      checkKillSwitchTransition({ status: TradingSessionStatus.STOPPED, killSwitchEngaged: true }, release).ok,
      true
    );
    for (const status of [
      TradingSessionStatus.KILLED,
      TradingSessionStatus.ERROR_LOCKED,
      TradingSessionStatus.PAUSED,
      TradingSessionStatus.SHADOW_ACTIVE
    ]) {
      assert.equal(
        reason(checkKillSwitchTransition({ status, killSwitchEngaged: true }, release)),
        TradingReasonCode.SESSION_KILL_SWITCH_RELEASE_NOT_ALLOWED,
        status
      );
    }
    assert.equal(
      reason(
        checkKillSwitchTransition(
          { status: TradingSessionStatus.STOPPED, killSwitchEngaged: true },
          { ...release, actorType: TradingActorType.SYSTEM }
        )
      ),
      TradingReasonCode.SESSION_ADMIN_ACTOR_REQUIRED
    );
    assert.equal(
      reason(
        checkKillSwitchTransition(
          { status: TradingSessionStatus.STOPPED, killSwitchEngaged: true },
          { ...release, reconcileSucceeded: false }
        )
      ),
      TradingReasonCode.SESSION_RECONCILE_REQUIRED
    );
  });
});

describe("shadow-only capability", () => {
  it("passes only for a shadow-only build in shadow mode with the master flag on", () => {
    assert.equal(checkShadowOnlyCapability(validCapability).ok, true);
    assert.equal(
      reason(checkShadowOnlyCapability({ ...validCapability, tradingMode: "PAPER" })),
      TradingReasonCode.CONFIG_INVALID
    );
    assert.equal(
      reason(checkShadowOnlyCapability({ ...validCapability, enableLiveTrading: true })),
      TradingReasonCode.LIVE_TRADING_FORBIDDEN
    );
  });

  it("offers no LIVE trading mode at all", () => {
    assert.deepEqual(Object.keys(TradingMode).sort(), ["DISABLED", "SHADOW"]);
  });
});
