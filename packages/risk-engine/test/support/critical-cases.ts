/**
 * The fixture-backed overall cases from docs/trading/06, "Risk-Engine-Goldenfälle",
 * plus the reward/risk conflict the pinned strategy plan runs into.
 */

import { RiskEvaluationOutcome, RiskReasonCode, type RiskInputSnapshotV1 } from "../../src/index.js";

import {
  STRATEGY_V1_TAKE_PROFIT,
  buildApprovableSnapshot,
  clone,
  openPosition,
  type DeepMutable
} from "./build-risk-snapshot.js";

type MutableSnapshot = DeepMutable<RiskInputSnapshotV1>;

const build = (change: (snapshot: MutableSnapshot) => void) => (): RiskInputSnapshotV1 => {
  const snapshot = clone(buildApprovableSnapshot());
  change(snapshot);
  return snapshot as RiskInputSnapshotV1;
};

export interface CriticalCase {
  readonly name: string;
  readonly expectedOutcome: RiskEvaluationOutcome;
  readonly expectedReasonCode: RiskReasonCode;
  readonly build: () => RiskInputSnapshotV1;
}

export const CRITICAL_CASES: readonly CriticalCase[] = Object.freeze([
  {
    name: "strategy-v1-2r-take-profit",
    expectedOutcome: RiskEvaluationOutcome.REJECTED,
    expectedReasonCode: RiskReasonCode.REWARD_RISK_BELOW_MINIMUM,
    build: build((next) => {
      next.candidate.takeProfitPrice = STRATEGY_V1_TAKE_PROFIT;
    })
  },
  {
    name: "daily-loss-exactly-one-percent",
    expectedOutcome: RiskEvaluationOutcome.REJECTED,
    expectedReasonCode: RiskReasonCode.DAILY_LOSS_LIMIT_REACHED,
    build: build((next) => {
      next.portfolio.equity = "9900.000000000000";
      next.portfolio.availableCash = "9900.000000000000";
      next.ledgerReplay.availableCash = "9900.000000000000";
      next.dailyCounters.dailyPnl = "-100.000000000000";
    })
  },
  {
    name: "ledger-drift-beyond-tolerance",
    expectedOutcome: RiskEvaluationOutcome.ERROR,
    expectedReasonCode: RiskReasonCode.PORTFOLIO_INCONSISTENT,
    build: build((next) => {
      next.ledgerReplay.availableCash = "9998.000000000000";
    })
  },
  {
    name: "correlated-exposure-capped-then-below-minimum-notional",
    expectedOutcome: RiskEvaluationOutcome.REJECTED,
    expectedReasonCode: RiskReasonCode.BELOW_INSTRUMENT_MINIMUM,
    build: build((next) => {
      // 30 % of equity minus the existing correlated exposure leaves about
      // 30 USDT of headroom, so the size is capped far below the 50 USDT
      // minimum notional and the trade is rejected rather than shrunk to a
      // meaningless order (docs/trading/06, golden case 3).
      next.openPositions = [
        openPosition({ assetId: "asset-eth", symbol: "ETHUSDT", marketValue: "4243.000000000000" })
      ];
      next.portfolio.equity = "14243.000000000000";
      next.startOfDay!.equity = "14243.000000000000";
      next.executionProfile!.minNotional = "50.000000000000";
    })
  },
  {
    name: "missing-execution-profile",
    expectedOutcome: RiskEvaluationOutcome.ERROR,
    expectedReasonCode: RiskReasonCode.EXECUTION_PROFILE_MISSING,
    build: build((next) => {
      next.executionProfile = null;
    })
  },
  {
    name: "missing-regime-snapshot",
    expectedOutcome: RiskEvaluationOutcome.ERROR,
    expectedReasonCode: RiskReasonCode.REGIME_MISSING,
    build: build((next) => {
      next.marketRegime = null;
    })
  },
  {
    name: "post-loss-risk-multiplier",
    expectedOutcome: RiskEvaluationOutcome.ERROR,
    expectedReasonCode: RiskReasonCode.NON_DETERMINISTIC_SIZE_OVERRIDE,
    build: build((next) => {
      next.sizeOverride.riskMultiplier = "2.000000000000";
    })
  },
  {
    name: "kill-switch-engaged",
    expectedOutcome: RiskEvaluationOutcome.REJECTED,
    expectedReasonCode: RiskReasonCode.SESSION_KILL_SWITCH_ENGAGED,
    build: build((next) => {
      next.session!.killSwitchEngaged = true;
    })
  },
  {
    name: "three-consecutive-losses",
    expectedOutcome: RiskEvaluationOutcome.REJECTED,
    expectedReasonCode: RiskReasonCode.CONSECUTIVE_LOSS_LIMIT,
    build: build((next) => {
      next.dailyCounters.consecutiveLosses = 3;
    })
  },
  {
    name: "assessment-hash-conflict",
    expectedOutcome: RiskEvaluationOutcome.ERROR,
    expectedReasonCode: RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
    build: build((next) => {
      next.existingAssessment = {
        assessmentKey: "risk-assessment.v1|trade-candidate-1|risk-limit-set-1|stale",
        inputHash: "9".repeat(64),
        status: "PASS"
      };
    })
  }
]);
