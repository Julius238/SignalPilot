/**
 * The 26 deterministic pre-trade rules.
 *
 * Specification: docs/trading/06-risk-engine-specification.md, "Regelkatalog".
 * One function per row, evaluated in `RISK_RULE_ORDER`, each producing exactly
 * one `RiskRuleResultDraftV1` — PASS results included, because docs/trading/03
 * requires every rule to be persisted.
 *
 * Evaluation semantics (docs/trading/06, "Auswertungssemantik"):
 *   - a CRITICAL ERROR makes the whole assessment `ERROR` and locks the session;
 *   - one BLOCKER FAIL makes it `FAIL`;
 *   - a WARNING can never overrule a BLOCKER;
 *   - a mandatory rule whose input is missing returns ERROR, never PASS.
 *
 * No rule reads a clock, an environment variable or a database. Everything
 * comes from the already-parsed context.
 */

import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

import type {
  RiskInputSnapshotV1,
  RiskRuleResultDraftV1,
  RiskSizingResultV1
} from "./contracts.js";
import {
  CRYPTO_MAJOR_GROUP_KEY,
  PORTFOLIO_TOLERANCE,
  RISK_ASSET_SCOPE,
  RISK_FRESHNESS_LIMITS_MS,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RISK_MINIMUM_CANDLES,
  RISK_REGIME_POLICY,
  RISK_RULE_SET_VERSION
} from "./policy-v1.js";
import { RiskReasonCode, RiskRuleCode } from "./reason-codes.js";

export type RiskDirective =
  | "NONE"
  | "BLOCK_NEW"
  | "ENGAGE_KILL_SWITCH"
  | "ERROR_LOCK";

export interface RuleVerdict {
  readonly outcome: "PASS" | "FAIL" | "WARN" | "ERROR";
  readonly severity: "INFO" | "WARNING" | "BLOCKER" | "CRITICAL";
  readonly reasonCode: RiskReasonCode;
  readonly message: string;
  readonly actualValue?: string | null;
  readonly limitValue?: string | null;
  readonly unit?: string | null;
  readonly inputJson: Readonly<Record<string, unknown>>;
  readonly directive?: RiskDirective;
}

/** Parsed, validated view the rules operate on. */
export interface RiskEvaluationContext {
  readonly snapshot: RiskInputSnapshotV1;
  readonly asOfMs: number;
  readonly sizing: RiskSizingResultV1;
  readonly equity: DecimalValue;
  readonly availableCash: DecimalValue;
  readonly reservedCash: DecimalValue;
  readonly dailyPnl: DecimalValue;
  readonly grossExposure: DecimalValue;
  readonly assetExposure: DecimalValue;
  readonly correlatedExposure: DecimalValue;
  readonly openPositionCount: number;
  readonly postTradeOpenPositionCount: number;
  readonly assetAlreadyOpen: boolean;
  readonly totalReserved: DecimalValue;
  readonly marketValue: DecimalValue;
  readonly equityContribution: DecimalValue;
  /** Assessment input hash, computed without the `existingAssessment` probe. */
  readonly inputHash: string;
}

const TOLERANCE = DecimalValue.fromString(PORTFOLIO_TOLERANCE);

const pass = (
  reasonCode: RiskReasonCode,
  message: string,
  extras: Partial<RuleVerdict> = {}
): RuleVerdict => ({
  outcome: "PASS",
  severity: "INFO",
  reasonCode,
  message,
  inputJson: {},
  ...extras
});

const block = (
  reasonCode: RiskReasonCode,
  message: string,
  extras: Partial<RuleVerdict> = {}
): RuleVerdict => ({
  outcome: "FAIL",
  severity: "BLOCKER",
  reasonCode,
  message,
  inputJson: {},
  ...extras
});

const critical = (
  reasonCode: RiskReasonCode,
  message: string,
  extras: Partial<RuleVerdict> = {}
): RuleVerdict => ({
  outcome: "ERROR",
  severity: "CRITICAL",
  reasonCode,
  message,
  inputJson: {},
  directive: "ERROR_LOCK",
  ...extras
});

const decimal = (value: string | null | undefined): DecimalValue | null => {
  if (
    value === null ||
    value === undefined ||
    !DecimalValue.isDecimalString(value)
  )
    return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
};

const withinTolerance = (left: DecimalValue, right: DecimalValue): boolean =>
  left.sub(right).abs().lte(TOLERANCE);

// ───────────────────────────────────────────────────────────────────────────
// R-001 … R-006 — mode, session, portfolio, instrument, direction, leverage
// ───────────────────────────────────────────────────────────────────────────

function ruleShadowMode(ctx: RiskEvaluationContext): RuleVerdict {
  const capability = ctx.snapshot.capability;
  const inputJson = { ...capability };

  if (capability.buildCapability !== "SHADOW_ONLY") {
    return critical(
      RiskReasonCode.BUILD_CAPABILITY_NOT_SHADOW_ONLY,
      "Build capability is not SHADOW_ONLY.",
      { inputJson }
    );
  }
  if (capability.enableLiveTrading) {
    return critical(
      RiskReasonCode.LIVE_TRADING_FORBIDDEN,
      "ENABLE_LIVE_TRADING is true.",
      {
        inputJson
      }
    );
  }
  if (capability.tradingMode === "DISABLED") {
    return critical(
      RiskReasonCode.MODE_NOT_SHADOW,
      "TRADING_MODE is DISABLED.",
      { inputJson }
    );
  }
  if (capability.tradingMode !== "SHADOW") {
    return critical(
      RiskReasonCode.CONFIG_INVALID,
      `Unknown TRADING_MODE: ${capability.tradingMode}.`,
      { inputJson }
    );
  }
  if (!capability.shadowMasterFlagEnabled) {
    return block(
      RiskReasonCode.MODE_NOT_SHADOW,
      "TRADING_SHADOW_ENABLED is off.",
      { inputJson }
    );
  }
  if (!capability.riskJobEnabled) {
    return block(
      RiskReasonCode.RISK_JOB_DISABLED,
      "TRADING_RISK_V1_ENABLED is off.",
      {
        inputJson
      }
    );
  }
  for (const [key, value] of Object.entries({
    strategyLongV1Enabled: capability.strategyLongV1Enabled,
    strategyShortV1Enabled: capability.strategyShortV1Enabled,
    shadowShortEnabled: capability.shadowShortEnabled,
    exchangeExecutionEnabled: capability.exchangeExecutionEnabled,
    marginTradingEnabled: capability.marginTradingEnabled,
    futuresTradingEnabled: capability.futuresTradingEnabled
  })) {
    if (typeof value !== "boolean") {
      return critical(
        RiskReasonCode.CONFIG_INVALID,
        `${key} is not a strict boolean.`,
        {
          inputJson
        }
      );
    }
  }
  return pass(
    RiskReasonCode.SHADOW_MODE_OK,
    "Shadow-only capability confirmed.",
    { inputJson }
  );
}

function ruleSession(ctx: RiskEvaluationContext): RuleVerdict {
  const session = ctx.snapshot.session;
  if (session === null) {
    return block(
      RiskReasonCode.SESSION_MISSING,
      "No trading session for this portfolio.",
      {
        inputJson: {},
        directive: "BLOCK_NEW"
      }
    );
  }

  const inputJson = {
    sessionId: session.id,
    status: session.status,
    killSwitchEngaged: session.killSwitchEngaged,
    reconciledAt: session.reconciledAt
  };

  if (session.killSwitchEngaged) {
    return block(
      RiskReasonCode.SESSION_KILL_SWITCH_ENGAGED,
      "Kill switch is engaged.",
      {
        inputJson,
        directive: "BLOCK_NEW"
      }
    );
  }
  if (session.status !== "SHADOW_ACTIVE") {
    return block(
      RiskReasonCode.SESSION_BLOCKS_ENTRY,
      `Session status ${session.status} blocks new entries.`,
      { inputJson, directive: "BLOCK_NEW" }
    );
  }
  if (session.reconciledAt === null) {
    return block(
      RiskReasonCode.SESSION_RECONCILE_STALE,
      "Session was never reconciled.",
      {
        inputJson,
        directive: "BLOCK_NEW"
      }
    );
  }
  return pass(
    RiskReasonCode.SESSION_OK,
    "Session is SHADOW_ACTIVE with the kill switch off.",
    {
      inputJson
    }
  );
}

function rulePortfolioConsistency(ctx: RiskEvaluationContext): RuleVerdict {
  const { portfolio, ledgerReplay, openPositions } = ctx.snapshot;
  const replayAvailable = decimal(ledgerReplay.availableCash);
  const replayReserved = decimal(ledgerReplay.reservedCash);
  const replayRealized = decimal(ledgerReplay.realizedPnl);
  const replayFees = decimal(ledgerReplay.feesPaid);
  const realizedPnl = decimal(portfolio.realizedPnl);
  const feesPaid = decimal(portfolio.feesPaid);

  const inputJson = {
    portfolioStatus: portfolio.status,
    ledgerSequence: portfolio.ledgerSequence,
    replaySequence: ledgerReplay.sequence,
    orphanReferenceCount: ledgerReplay.orphanReferenceCount,
    sequenceGapCount: ledgerReplay.sequenceGapCount,
    tolerance: PORTFOLIO_TOLERANCE
  };

  if (
    replayAvailable === null ||
    replayReserved === null ||
    replayRealized === null ||
    replayFees === null ||
    realizedPnl === null ||
    feesPaid === null
  ) {
    return critical(
      RiskReasonCode.PORTFOLIO_INCONSISTENT,
      "Portfolio or ledger value unreadable.",
      {
        inputJson
      }
    );
  }

  if (portfolio.status !== "ACTIVE") {
    return block(
      RiskReasonCode.PORTFOLIO_NOT_ACTIVE,
      `Portfolio is ${portfolio.status}.`,
      {
        inputJson
      }
    );
  }
  if (ctx.availableCash.isNegative() || ctx.reservedCash.isNegative()) {
    return critical(
      RiskReasonCode.PORTFOLIO_NEGATIVE_CASH,
      "Cash or reserve is negative.",
      {
        inputJson
      }
    );
  }
  if (ledgerReplay.orphanReferenceCount > 0) {
    return critical(
      RiskReasonCode.PORTFOLIO_ORPHAN_LEDGER_REFERENCE,
      "Ledger references an unknown order, fill or position.",
      { inputJson, actualValue: null, limitValue: null }
    );
  }
  if (
    ledgerReplay.sequenceGapCount > 0 ||
    ledgerReplay.sequence !== portfolio.ledgerSequence
  ) {
    return critical(
      RiskReasonCode.PORTFOLIO_INCONSISTENT,
      "Ledger sequence does not match the portfolio cache.",
      { inputJson }
    );
  }

  const cacheMismatch =
    !withinTolerance(ctx.availableCash, replayAvailable) ||
    !withinTolerance(ctx.reservedCash, replayReserved) ||
    !withinTolerance(realizedPnl, replayRealized) ||
    !withinTolerance(feesPaid, replayFees);
  if (cacheMismatch) {
    return critical(
      RiskReasonCode.PORTFOLIO_INCONSISTENT,
      "Portfolio caches differ from the ledger replay beyond tolerance.",
      { inputJson, limitValue: PORTFOLIO_TOLERANCE, unit: "USDT" }
    );
  }

  if (!withinTolerance(ctx.totalReserved, ctx.reservedCash)) {
    return critical(
      RiskReasonCode.PORTFOLIO_RESERVATION_MISMATCH,
      "Sum of order reservations differs from reservedCash.",
      {
        inputJson,
        actualValue: ctx.totalReserved.toString(),
        limitValue: ctx.reservedCash.toString(),
        unit: "USDT"
      }
    );
  }

  const expectedEquity = ctx.availableCash
    .add(ctx.reservedCash)
    .add(ctx.equityContribution);
  if (!withinTolerance(ctx.equity, expectedEquity)) {
    return critical(
      RiskReasonCode.PORTFOLIO_INCONSISTENT,
      "Equity does not equal availableCash + reservedCash + directional position value.",
      {
        inputJson,
        actualValue: ctx.equity.toString(),
        limitValue: expectedEquity.toString(),
        unit: "USDT"
      }
    );
  }

  const scopes = new Set<string>();
  for (const position of openPositions) {
    const collateral = decimal(position.reservedCollateral);
    if (
      (position.direction !== "LONG" && position.direction !== "SHORT") ||
      collateral === null ||
      collateral.isNegative() ||
      (position.direction === "LONG" && !collateral.isZero()) ||
      (position.direction === "SHORT" &&
        decimal(position.openQuantity)?.isPositive() === true &&
        !collateral.isPositive())
    ) {
      return critical(
        RiskReasonCode.PORTFOLIO_INCONSISTENT,
        "Position direction or synthetic-short collateral is inconsistent.",
        { inputJson }
      );
    }
    const scope = `${position.assetId}`;
    if (scopes.has(scope)) {
      return critical(
        RiskReasonCode.PORTFOLIO_DUPLICATE_POSITION_SCOPE,
        "More than one non-terminal position for the same asset.",
        { inputJson }
      );
    }
    scopes.add(scope);
  }

  return pass(
    RiskReasonCode.PORTFOLIO_CONSISTENT,
    "Portfolio matches the ledger replay.",
    {
      inputJson,
      limitValue: PORTFOLIO_TOLERANCE,
      unit: "USDT"
    }
  );
}

function ruleAssetScope(ctx: RiskEvaluationContext): RuleVerdict {
  const { asset, candidate } = ctx.snapshot;
  const inputJson = {
    symbol: asset.symbol,
    assetType: asset.assetType,
    quoteCurrency: asset.quoteCurrency,
    assignmentEnabled: candidate.assignmentEnabled
  };

  if (!RISK_ASSET_SCOPE.allowedSymbols.includes(asset.symbol as never)) {
    return block(
      RiskReasonCode.ASSET_NOT_ALLOWED,
      `${asset.symbol} is not an approved symbol.`,
      {
        inputJson,
        actualValue: null,
        limitValue: null
      }
    );
  }
  if (
    asset.assetType !== RISK_ASSET_SCOPE.assetType ||
    asset.quoteCurrency !== RISK_ASSET_SCOPE.quoteCurrency ||
    asset.isLeveraged ||
    asset.isInverse ||
    asset.isStablecoin
  ) {
    return block(
      RiskReasonCode.NOT_SPOT_USDT,
      "Instrument is not a plain USDT spot asset.",
      {
        inputJson
      }
    );
  }
  if (
    !asset.isTradable ||
    !asset.isActive ||
    asset.instrumentStatus !== "ACTIVE"
  ) {
    return block(
      RiskReasonCode.ASSET_NOT_ALLOWED,
      "Instrument is not tradable.",
      { inputJson }
    );
  }
  if (!candidate.assignmentEnabled) {
    return block(
      RiskReasonCode.ASSIGNMENT_NOT_ACTIVE,
      "Strategy assignment is not enabled.",
      {
        inputJson
      }
    );
  }
  return pass(
    RiskReasonCode.ASSET_SCOPE_OK,
    "Approved BTC/ETH spot USDT instrument.",
    {
      inputJson
    }
  );
}

function ruleLongOnly(ctx: RiskEvaluationContext): RuleVerdict {
  const candidate = ctx.snapshot.candidate;
  const capability = ctx.snapshot.capability;
  const {
    direction,
    entryType,
    strategyDirection,
    assignmentDirection,
    strategyKey
  } = candidate;
  const inputJson = {
    direction,
    entryType,
    strategyDirection,
    assignmentDirection,
    strategyKey,
    strategyLongV1Enabled: capability.strategyLongV1Enabled,
    strategyShortV1Enabled: capability.strategyShortV1Enabled,
    shadowShortEnabled: capability.shadowShortEnabled,
    exchangeExecutionEnabled: capability.exchangeExecutionEnabled,
    marginTradingEnabled: capability.marginTradingEnabled,
    futuresTradingEnabled: capability.futuresTradingEnabled
  };
  if (direction !== "LONG" && direction !== "SHORT") {
    return critical(
      RiskReasonCode.SIDE_NOT_ALLOWED,
      `Unknown direction ${direction}.`,
      {
        inputJson
      }
    );
  }
  if (entryType !== "MARKET") {
    return block(
      RiskReasonCode.SIDE_NOT_ALLOWED,
      "Only deterministic shadow market entries are allowed.",
      {
        inputJson
      }
    );
  }
  if (strategyDirection !== direction || assignmentDirection !== direction) {
    return critical(
      RiskReasonCode.STRATEGY_DIRECTION_MISMATCH,
      "Candidate, StrategyVersion and Assignment do not declare the same direction.",
      { inputJson }
    );
  }
  if (direction === "LONG") {
    if (
      strategyKey !== "CRYPTO_MTF_BREAKOUT_V1" &&
      strategyKey !== "CRYPTO_MTF_BREAKOUT_LONG_V1"
    ) {
      return critical(
        RiskReasonCode.STRATEGY_DIRECTION_MISMATCH,
        "LONG candidate references an unapproved strategy identity.",
        { inputJson }
      );
    }
    if (!capability.strategyLongV1Enabled) {
      return block(
        RiskReasonCode.SIDE_NOT_ALLOWED,
        "TRADING_STRATEGY_LONG_V1_ENABLED is not true.",
        {
          inputJson
        }
      );
    }
    return pass(
      RiskReasonCode.LONG_ONLY_OK,
      "Long shadow market entry is explicitly enabled.",
      {
        inputJson
      }
    );
  }

  if (strategyKey !== "CRYPTO_MTF_BREAKDOWN_SHORT_V1") {
    return critical(
      RiskReasonCode.STRATEGY_DIRECTION_MISMATCH,
      "SHORT candidate references an unapproved strategy identity.",
      { inputJson }
    );
  }
  if (
    capability.exchangeExecutionEnabled ||
    capability.marginTradingEnabled ||
    capability.futuresTradingEnabled ||
    capability.enableLiveTrading ||
    capability.buildCapability !== "SHADOW_ONLY"
  ) {
    return critical(
      RiskReasonCode.EXCHANGE_SHORT_CAPABILITY_FORBIDDEN,
      "Synthetic shorts cannot coexist with exchange, live, margin or futures capability.",
      { inputJson }
    );
  }
  if (!capability.shadowShortEnabled || !capability.strategyShortV1Enabled) {
    return block(
      RiskReasonCode.SHORT_FLAGS_DISABLED,
      "Synthetic short requires both shadow-short and short-strategy flags.",
      { inputJson }
    );
  }
  return pass(
    RiskReasonCode.DIRECTION_ALLOWED,
    "Synthetic unleveraged shadow short is explicitly enabled without exchange capability.",
    { inputJson }
  );
}

function ruleNoLeverage(ctx: RiskEvaluationContext): RuleVerdict {
  const { asset } = ctx.snapshot;
  const inputJson = {
    isLeveraged: asset.isLeveraged,
    isInverse: asset.isInverse,
    requestedLeverage: 1,
    marginEnabled: false,
    borrowedAmount: "0"
  };
  if (asset.isLeveraged || asset.isInverse) {
    return critical(
      RiskReasonCode.LEVERAGE_OR_MARGIN_FORBIDDEN,
      "Leveraged or inverse instrument reached the risk engine.",
      { inputJson }
    );
  }
  // Sizing is funded from availableCash only; there is no borrow path in v1.
  return pass(
    RiskReasonCode.NO_LEVERAGE_OK,
    "Spot cash sizing, leverage 1, no margin.",
    {
      inputJson
    }
  );
}

// ───────────────────────────────────────────────────────────────────────────
// R-007 … R-009 — price plan and per-trade risk
// ───────────────────────────────────────────────────────────────────────────

function ruleStopRequired(ctx: RiskEvaluationContext): RuleVerdict {
  const { candidate, executionProfile } = ctx.snapshot;
  const entry = decimal(candidate.referenceEntryPrice);
  const stop = decimal(candidate.stopPrice);
  const tick =
    executionProfile === null ? null : decimal(executionProfile.tickSize);
  const inputJson = {
    referenceEntryPrice: candidate.referenceEntryPrice,
    stopPrice: candidate.stopPrice,
    tickSize: executionProfile?.tickSize ?? null
  };

  if (entry === null || stop === null) {
    return block(
      RiskReasonCode.STOP_MISSING_OR_INVALID,
      "Entry or stop price unreadable.",
      {
        inputJson
      }
    );
  }
  if (!stop.isPositive()) {
    return block(
      RiskReasonCode.STOP_MISSING_OR_INVALID,
      "Stop price must be greater than zero.",
      {
        inputJson,
        actualValue: stop.toString(),
        limitValue: "0.000000000000",
        unit: "USDT"
      }
    );
  }
  const invalidOrdering =
    candidate.direction === "LONG"
      ? stop.gte(entry)
      : candidate.direction === "SHORT"
        ? stop.lte(entry)
        : true;
  if (invalidOrdering) {
    return block(
      RiskReasonCode.STOP_MISSING_OR_INVALID,
      `Stop price is on the wrong side of the ${candidate.direction} reference entry.`,
      {
        inputJson,
        actualValue: stop.toString(),
        limitValue: entry.toString(),
        unit: "USDT"
      }
    );
  }
  const worstEntry = decimal(ctx.sizing.worstEntryPrice);
  const invalidAgainstWorst =
    worstEntry !== null &&
    worstEntry.isPositive() &&
    (candidate.direction === "LONG"
      ? stop.gte(worstEntry)
      : stop.lte(worstEntry));
  if (invalidAgainstWorst) {
    return block(
      RiskReasonCode.STOP_MISSING_OR_INVALID,
      "Stop price is not on the adverse side of the worst-case entry fill.",
      {
        inputJson,
        actualValue: stop.toString(),
        limitValue: worstEntry.toString(),
        unit: "USDT"
      }
    );
  }
  if (tick !== null && tick.isPositive() && !stop.isMultipleOf(tick)) {
    return block(
      RiskReasonCode.STOP_MISSING_OR_INVALID,
      "Stop price is not tick conformant.",
      {
        inputJson,
        actualValue: stop.toString(),
        limitValue: tick.toString(),
        unit: "USDT"
      }
    );
  }
  return pass(
    RiskReasonCode.STOP_VALID,
    "Stop is present, positive and directionally valid.",
    {
      inputJson,
      actualValue: stop.toString(),
      limitValue: entry.toString(),
      unit: "USDT"
    }
  );
}

function ruleMinRewardRisk(ctx: RiskEvaluationContext): RuleVerdict {
  const { candidate, riskLimitSet } = ctx.snapshot;
  const minimum = decimal(riskLimitSet?.minRewardRisk ?? null);
  const takeProfit = decimal(candidate.takeProfitPrice);
  const entry = decimal(candidate.referenceEntryPrice);
  const actual = decimal(ctx.sizing.netRewardRisk);

  const inputJson = {
    takeProfitPrice: candidate.takeProfitPrice,
    referenceEntryPrice: candidate.referenceEntryPrice,
    worstEntryPrice: ctx.sizing.worstEntryPrice,
    worstStopFillPrice: ctx.sizing.worstStopFillPrice,
    roundTripFeesPerUnit: ctx.sizing.roundTripFeesPerUnit,
    perUnitRisk: ctx.sizing.perUnitRisk,
    conservativeRewardRisk: ctx.sizing.conservativeRewardRisk
  };

  // An unusable price plan is a business rejection, not an engine error, so the
  // TP-above-entry check runs before the cost model is consulted.
  const invalidTakeProfit =
    takeProfit !== null &&
    entry !== null &&
    (candidate.direction === "LONG"
      ? takeProfit.lte(entry)
      : takeProfit.gte(entry));
  if (invalidTakeProfit) {
    return block(
      RiskReasonCode.REWARD_RISK_BELOW_MINIMUM,
      "Take profit is on the wrong side of the entry.",
      {
        inputJson,
        actualValue: takeProfit.toString(),
        limitValue: entry.toString(),
        unit: "USDT"
      }
    );
  }
  if (
    minimum === null ||
    takeProfit === null ||
    entry === null ||
    !ctx.sizing.computable
  ) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.REWARD_RISK_BELOW_MINIMUM,
      message:
        "Reward/risk cannot be evaluated without limits, prices and a cost model.",
      inputJson,
      actualValue: null,
      limitValue: minimum?.toString() ?? null,
      unit: "R"
    };
  }
  if (actual === null || actual.lt(minimum)) {
    return block(
      RiskReasonCode.REWARD_RISK_BELOW_MINIMUM,
      "Net reward/risk after spread, slippage and round-trip fees is below the minimum.",
      {
        inputJson,
        actualValue: actual?.toString() ?? null,
        limitValue: minimum.toString(),
        unit: "R"
      }
    );
  }
  return pass(
    RiskReasonCode.REWARD_RISK_OK,
    "Net reward/risk meets the minimum.",
    {
      inputJson,
      actualValue: actual.toString(),
      limitValue: minimum.toString(),
      unit: "R"
    }
  );
}

function ruleRiskPerTrade(ctx: RiskEvaluationContext): RuleVerdict {
  const riskAmount = decimal(ctx.sizing.riskAmount);
  const riskBudget = decimal(ctx.sizing.riskBudget);
  const inputJson = {
    equity: ctx.equity.toString(),
    maxRiskPerTradePct: ctx.snapshot.riskLimitSet?.maxRiskPerTradePct ?? null,
    approvedQuantity: ctx.sizing.approvedQuantity,
    perUnitRisk: ctx.sizing.perUnitRisk
  };

  if (!ctx.equity.isPositive()) {
    return block(
      RiskReasonCode.EQUITY_NOT_POSITIVE,
      "Equity is not positive.",
      {
        inputJson,
        actualValue: ctx.equity.toString(),
        limitValue: "0.000000000000",
        unit: "USDT"
      }
    );
  }
  if (!ctx.sizing.computable || riskAmount === null || riskBudget === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.TRADE_RISK_NOT_COMPUTABLE,
      message: "Position size could not be computed from the given inputs.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: "USDT"
    };
  }
  if (riskAmount.gt(riskBudget)) {
    return block(
      RiskReasonCode.TRADE_RISK_EXCEEDS_25BP,
      "Worst-case loss including fees exceeds the per-trade risk budget.",
      {
        inputJson,
        actualValue: riskAmount.toString(),
        limitValue: riskBudget.toString(),
        unit: "USDT"
      }
    );
  }
  return pass(
    RiskReasonCode.TRADE_RISK_WITHIN_LIMIT,
    "Worst-case loss is inside the budget.",
    {
      inputJson,
      actualValue: riskAmount.toString(),
      limitValue: riskBudget.toString(),
      unit: "USDT"
    }
  );
}

// ───────────────────────────────────────────────────────────────────────────
// R-010 … R-015 — portfolio-level limits
// ───────────────────────────────────────────────────────────────────────────

function ruleDailyLoss(ctx: RiskEvaluationContext): RuleVerdict {
  const { startOfDay, riskLimitSet } = ctx.snapshot;
  const maxLossPct = decimal(riskLimitSet?.maxDailyLossPct ?? null);
  const inputJson = {
    dailyPnl: ctx.dailyPnl.toString(),
    startOfDayEquity: startOfDay?.equity ?? null,
    tradingDateUtc: ctx.snapshot.tradingDateUtc
  };

  if (startOfDay === null) {
    return block(
      RiskReasonCode.START_OF_DAY_SNAPSHOT_MISSING,
      "No reconciled start-of-day snapshot; new trades are blocked.",
      { inputJson, directive: "BLOCK_NEW" }
    );
  }
  const startEquity = decimal(startOfDay.equity);
  if (
    maxLossPct === null ||
    startEquity === null ||
    !startEquity.isPositive()
  ) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.START_OF_DAY_SNAPSHOT_MISSING,
      message: "Start-of-day equity or daily loss limit is unreadable.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: "USDT"
    };
  }

  // The limit is a loss, so compare magnitudes against a negative threshold.
  const lossLimit = startEquity.mul(maxLossPct, RoundingMode.FLOOR).negate();
  if (ctx.dailyPnl.lte(lossLimit)) {
    return {
      outcome: "FAIL",
      severity: "CRITICAL",
      reasonCode: RiskReasonCode.DAILY_LOSS_LIMIT_REACHED,
      message:
        "Daily loss limit reached; new entries stop until the next UTC day and a review.",
      inputJson,
      actualValue: ctx.dailyPnl.toString(),
      limitValue: lossLimit.toString(),
      unit: "USDT",
      directive: "ENGAGE_KILL_SWITCH"
    };
  }
  return pass(
    RiskReasonCode.DAILY_LOSS_WITHIN_LIMIT,
    "Daily loss is inside the limit.",
    {
      inputJson,
      actualValue: ctx.dailyPnl.toString(),
      limitValue: lossLimit.toString(),
      unit: "USDT"
    }
  );
}

function ruleOpenPositions(ctx: RiskEvaluationContext): RuleVerdict {
  const limit = ctx.snapshot.riskLimitSet?.maxOpenPositions ?? null;
  const inputJson = {
    openPositionCount: ctx.openPositionCount,
    postTradeOpenPositionCount: ctx.postTradeOpenPositionCount,
    assetAlreadyOpen: ctx.assetAlreadyOpen
  };
  if (limit === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.MAX_OPEN_POSITIONS,
      message: "No active risk limit set; open-position limit unknown.",
      inputJson,
      actualValue: String(ctx.postTradeOpenPositionCount),
      limitValue: null,
      unit: "count"
    };
  }
  if (ctx.postTradeOpenPositionCount > limit) {
    return block(
      RiskReasonCode.MAX_OPEN_POSITIONS,
      "The planned fill would exceed the maximum number of open positions.",
      {
        inputJson,
        actualValue: String(ctx.postTradeOpenPositionCount),
        limitValue: String(limit),
        unit: "count"
      }
    );
  }
  return pass(
    RiskReasonCode.OPEN_POSITIONS_WITHIN_LIMIT,
    "Open-position count stays in range.",
    {
      inputJson,
      actualValue: String(ctx.postTradeOpenPositionCount),
      limitValue: String(limit),
      unit: "count"
    }
  );
}

function ruleTradesPerDay(ctx: RiskEvaluationContext): RuleVerdict {
  const limit = ctx.snapshot.riskLimitSet?.maxNewTradesPerDay ?? null;
  const today = ctx.snapshot.dailyCounters.filledEntryOrdersToday;
  const inputJson = {
    filledEntryOrdersToday: today,
    tradingDateUtc: ctx.snapshot.dailyCounters.tradingDateUtc
  };
  if (limit === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.MAX_DAILY_TRADES,
      message: "No active risk limit set; daily trade limit unknown.",
      inputJson,
      actualValue: String(today),
      limitValue: null,
      unit: "count"
    };
  }
  if (today >= limit) {
    return block(
      RiskReasonCode.MAX_DAILY_TRADES,
      "Daily filled-entry limit reached.",
      {
        inputJson,
        actualValue: String(today),
        limitValue: String(limit),
        unit: "count"
      }
    );
  }
  return pass(
    RiskReasonCode.DAILY_TRADES_WITHIN_LIMIT,
    "Daily entry count stays in range.",
    {
      inputJson,
      actualValue: String(today),
      limitValue: String(limit),
      unit: "count"
    }
  );
}

function exposureRule(
  ctx: RiskEvaluationContext,
  args: {
    readonly current: DecimalValue;
    readonly postTrade: string;
    readonly capPct: string | null | undefined;
    readonly failCode: RiskReasonCode;
    readonly passCode: RiskReasonCode;
    readonly label: string;
  }
): RuleVerdict {
  const capPct = decimal(args.capPct ?? null);
  const postTrade = decimal(args.postTrade);
  const inputJson = {
    currentExposure: args.current.toString(),
    postTradeExposure: args.postTrade,
    equity: ctx.equity.toString(),
    capPct: args.capPct ?? null
  };

  if (capPct === null || postTrade === null || !ctx.equity.isPositive()) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: args.failCode,
      message: `${args.label} exposure cannot be evaluated without equity and an active limit set.`,
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: "USDT"
    };
  }

  const limit = ctx.equity.mul(capPct, RoundingMode.FLOOR);
  if (postTrade.gt(limit)) {
    return block(
      args.failCode,
      `${args.label} exposure would exceed the cap.`,
      {
        inputJson,
        actualValue: postTrade.toString(),
        limitValue: limit.toString(),
        unit: "USDT"
      }
    );
  }
  return pass(args.passCode, `${args.label} exposure stays inside the cap.`, {
    inputJson,
    actualValue: postTrade.toString(),
    limitValue: limit.toString(),
    unit: "USDT"
  });
}

function ruleGrossExposure(ctx: RiskEvaluationContext): RuleVerdict {
  return exposureRule(ctx, {
    current: ctx.grossExposure,
    postTrade: ctx.sizing.postTradeGrossExposure,
    capPct: ctx.snapshot.riskLimitSet?.maxGrossExposurePct,
    failCode: RiskReasonCode.MAX_GROSS_EXPOSURE,
    passCode: RiskReasonCode.GROSS_EXPOSURE_WITHIN_LIMIT,
    label: "Gross"
  });
}

function ruleAssetExposure(ctx: RiskEvaluationContext): RuleVerdict {
  if (ctx.assetAlreadyOpen) {
    return block(
      RiskReasonCode.DUPLICATE_ASSET_POSITION,
      "A non-terminal position for this asset already exists.",
      {
        inputJson: {
          assetId: ctx.snapshot.candidate.assetId,
          assetAlreadyOpen: true
        },
        actualValue: null,
        limitValue: null
      }
    );
  }
  return exposureRule(ctx, {
    current: ctx.assetExposure,
    postTrade: ctx.sizing.postTradeAssetExposure,
    capPct: ctx.snapshot.riskLimitSet?.maxAssetExposurePct,
    failCode: RiskReasonCode.MAX_ASSET_EXPOSURE,
    passCode: RiskReasonCode.ASSET_EXPOSURE_WITHIN_LIMIT,
    label: "Asset"
  });
}

function ruleCorrelation(ctx: RiskEvaluationContext): RuleVerdict {
  const group = ctx.snapshot.correlationGroup;
  if (group === null || group.key !== CRYPTO_MAJOR_GROUP_KEY) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.CORRELATION_GROUP_MISSING,
      message: "The fixed CRYPTO_MAJOR correlation group is missing.",
      inputJson: { group },
      actualValue: null,
      limitValue: null,
      unit: null
    };
  }
  if (!group.memberSymbols.includes(ctx.snapshot.asset.symbol)) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.CORRELATION_GROUP_MISSING,
      message:
        "The candidate symbol is not part of the fixed correlation group.",
      inputJson: { group, symbol: ctx.snapshot.asset.symbol },
      actualValue: null,
      limitValue: null,
      unit: null
    };
  }
  return exposureRule(ctx, {
    current: ctx.correlatedExposure,
    postTrade: ctx.sizing.postTradeCorrelatedExposure,
    capPct: ctx.snapshot.riskLimitSet?.maxCorrelatedExposurePct,
    failCode: RiskReasonCode.MAX_CORRELATED_EXPOSURE,
    passCode: RiskReasonCode.CORRELATED_EXPOSURE_WITHIN_LIMIT,
    label: "Correlated CRYPTO_MAJOR"
  });
}

// ───────────────────────────────────────────────────────────────────────────
// R-016 … R-020 — data and execution profile
// ───────────────────────────────────────────────────────────────────────────

function ruleDataFreshness(ctx: RiskEvaluationContext): RuleVerdict {
  const { freshness, candidate } = ctx.snapshot;
  const inputJson = {
    candleAgeMs: freshness.candleAgeMs,
    dataQualityAgeMs: freshness.dataQualityAgeMs,
    regimeAgeMs: freshness.regimeAgeMs,
    portfolioSnapshotAgeMs: freshness.portfolioSnapshotAgeMs,
    candidateExpiresAt: candidate.expiresAt
  };

  if (freshness.hasFutureTimestamp) {
    return block(
      RiskReasonCode.DATA_TIMESTAMP_IN_FUTURE,
      "A source timestamp lies after asOf.",
      {
        inputJson
      }
    );
  }

  const checks: readonly (readonly [
    number | null,
    number,
    RiskReasonCode,
    string
  ])[] = [
    [
      freshness.candleAgeMs["1h"],
      RISK_FRESHNESS_LIMITS_MS.candle1h,
      RiskReasonCode.DATA_STALE_CANDLES_1H,
      "1h candles"
    ],
    [
      freshness.candleAgeMs["4h"],
      RISK_FRESHNESS_LIMITS_MS.candle4h,
      RiskReasonCode.DATA_STALE_CANDLES_4H,
      "4h candles"
    ],
    [
      freshness.candleAgeMs["1d"],
      RISK_FRESHNESS_LIMITS_MS.candle1d,
      RiskReasonCode.DATA_STALE_CANDLES_1D,
      "1d candles"
    ],
    [
      freshness.dataQualityAgeMs,
      RISK_FRESHNESS_LIMITS_MS.dataQuality,
      RiskReasonCode.DATA_STALE_DATA_QUALITY,
      "data quality"
    ],
    [
      freshness.regimeAgeMs,
      RISK_FRESHNESS_LIMITS_MS.regime,
      RiskReasonCode.DATA_STALE_REGIME,
      "market regime"
    ],
    [
      freshness.portfolioSnapshotAgeMs,
      RISK_FRESHNESS_LIMITS_MS.portfolioSnapshot,
      RiskReasonCode.DATA_STALE_PORTFOLIO_SNAPSHOT,
      "portfolio snapshot"
    ]
  ];

  for (const [age, limit, reasonCode, label] of checks) {
    if (age === null) {
      return {
        outcome: "ERROR",
        severity: "BLOCKER",
        reasonCode,
        message: `Freshness of ${label} is unknown; a missing age never passes.`,
        inputJson,
        actualValue: null,
        limitValue: String(limit),
        unit: "ms"
      };
    }
    if (age > limit) {
      return block(reasonCode, `${label} is stale.`, {
        inputJson,
        actualValue: String(age),
        limitValue: String(limit),
        unit: "ms"
      });
    }
  }

  // A candidate outside its own validity window can never be approved
  // (docs/trading/04: `now >= expiresAt` sends it to EXPIRED).
  const expiresAtMs = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.CANDIDATE_EXPIRED,
      message: "Candidate expiry timestamp is unreadable.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: null
    };
  }
  if (ctx.asOfMs >= expiresAtMs) {
    return block(
      RiskReasonCode.CANDIDATE_EXPIRED,
      "Candidate validity window has passed.",
      {
        inputJson,
        actualValue: String(ctx.asOfMs),
        limitValue: String(expiresAtMs),
        unit: "epochMs"
      }
    );
  }
  if (candidate.status !== "CREATED" && candidate.status !== "READY_FOR_RISK") {
    return block(
      RiskReasonCode.CANDIDATE_NOT_READY,
      `Candidate status ${candidate.status} is not assessable.`,
      { inputJson }
    );
  }

  return pass(
    RiskReasonCode.DATA_FRESH,
    "Every source is inside its freshness limit.",
    {
      inputJson
    }
  );
}

function ruleDataQuality(ctx: RiskEvaluationContext): RuleVerdict {
  const quality = ctx.snapshot.dataQuality;
  const inputJson = { ...quality, minimumCandles: RISK_MINIMUM_CANDLES };

  if (quality.ohlcContradiction) {
    return critical(
      RiskReasonCode.DATA_QUALITY_CONTRADICTORY,
      "Contradictory OHLC data reached the risk engine.",
      { inputJson }
    );
  }
  for (const timeframe of ["1h", "4h", "1d"] as const) {
    const closed = quality.minimumClosedCandles[timeframe];
    const gaps = quality.gapCount[timeframe];
    const providerErrors = quality.providerErrorCount[timeframe];
    if (closed === null || gaps === null || providerErrors === null) {
      return {
        outcome: "ERROR",
        severity: "BLOCKER",
        reasonCode: RiskReasonCode.DATA_QUALITY_INSUFFICIENT,
        message: `Data quality for ${timeframe} is unknown.`,
        inputJson,
        actualValue: null,
        limitValue: String(RISK_MINIMUM_CANDLES),
        unit: "count"
      };
    }
    if (closed < RISK_MINIMUM_CANDLES || gaps > 0 || providerErrors > 0) {
      return block(
        RiskReasonCode.DATA_QUALITY_INSUFFICIENT,
        `Data quality for ${timeframe} is insufficient.`,
        {
          inputJson,
          actualValue: String(closed),
          limitValue: String(RISK_MINIMUM_CANDLES),
          unit: "count"
        }
      );
    }
  }
  return pass(
    RiskReasonCode.DATA_QUALITY_OK,
    "Candle coverage and provider status are clean.",
    {
      inputJson
    }
  );
}

function ruleSpread(ctx: RiskEvaluationContext): RuleVerdict {
  const profile = ctx.snapshot.executionProfile;
  const limit = ctx.snapshot.riskLimitSet?.maxSpreadBps ?? null;
  const inputJson = {
    executionProfileId: profile?.id ?? null,
    fullSpreadBps: profile?.fullSpreadBps ?? null,
    status: profile?.status ?? null
  };

  if (profile === null) {
    return critical(
      RiskReasonCode.EXECUTION_PROFILE_MISSING,
      "No execution profile for the asset.",
      {
        inputJson
      }
    );
  }
  if (profile.status !== "ACTIVE") {
    return critical(
      RiskReasonCode.EXECUTION_PROFILE_NOT_ACTIVE,
      `Execution profile is ${profile.status}.`,
      { inputJson }
    );
  }
  if (
    !Number.isSafeInteger(profile.fullSpreadBps) ||
    profile.fullSpreadBps < 0
  ) {
    return critical(
      RiskReasonCode.EXECUTION_PROFILE_INVALID,
      "Full spread is negative or unusable.",
      {
        inputJson
      }
    );
  }
  if (limit === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.SPREAD_LIMIT_EXCEEDED,
      message: "No active risk limit set; spread limit unknown.",
      inputJson,
      actualValue: String(profile.fullSpreadBps),
      limitValue: null,
      unit: "bp"
    };
  }
  if (profile.fullSpreadBps > limit) {
    return block(
      RiskReasonCode.SPREAD_LIMIT_EXCEEDED,
      "Modelled full spread exceeds the limit.",
      {
        inputJson,
        actualValue: String(profile.fullSpreadBps),
        limitValue: String(limit),
        unit: "bp"
      }
    );
  }
  return pass(
    RiskReasonCode.SPREAD_WITHIN_LIMIT,
    "Modelled full spread is inside the limit.",
    {
      inputJson,
      actualValue: String(profile.fullSpreadBps),
      limitValue: String(limit),
      unit: "bp"
    }
  );
}

function ruleSlippage(ctx: RiskEvaluationContext): RuleVerdict {
  const profile = ctx.snapshot.executionProfile;
  const limit = ctx.snapshot.riskLimitSet?.maxSlippageBps ?? null;
  const inputJson = {
    slippageBps: profile?.slippageBps ?? null,
    slippageRate: ctx.sizing.slippageRate,
    pricedIntoSizing: ctx.sizing.computable
  };

  if (profile === null) {
    return critical(
      RiskReasonCode.EXECUTION_PROFILE_MISSING,
      "No execution profile for the asset.",
      {
        inputJson
      }
    );
  }
  if (!Number.isSafeInteger(profile.slippageBps) || profile.slippageBps < 0) {
    return critical(
      RiskReasonCode.EXECUTION_PROFILE_INVALID,
      "Slippage is negative or unusable.",
      {
        inputJson
      }
    );
  }
  if (limit === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.SLIPPAGE_LIMIT_EXCEEDED,
      message: "No active risk limit set; slippage limit unknown.",
      inputJson,
      actualValue: String(profile.slippageBps),
      limitValue: null,
      unit: "bp"
    };
  }
  if (profile.slippageBps > limit) {
    return block(
      RiskReasonCode.SLIPPAGE_LIMIT_EXCEEDED,
      "Modelled slippage exceeds the limit.",
      {
        inputJson,
        actualValue: String(profile.slippageBps),
        limitValue: String(limit),
        unit: "bp"
      }
    );
  }
  if (profile.slippageBps > 0 && !ctx.sizing.computable) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.SLIPPAGE_NOT_PRICED_IN,
      message: "Slippage is configured but was not priced into the sizing.",
      inputJson,
      actualValue: String(profile.slippageBps),
      limitValue: String(limit),
      unit: "bp"
    };
  }
  return pass(
    RiskReasonCode.SLIPPAGE_WITHIN_LIMIT,
    "Slippage is inside the limit and priced in.",
    {
      inputJson,
      actualValue: String(profile.slippageBps),
      limitValue: String(limit),
      unit: "bp"
    }
  );
}

function ruleRegime(ctx: RiskEvaluationContext): RuleVerdict {
  const regime = ctx.snapshot.marketRegime;
  const inputJson = {
    regimeId: regime?.id ?? null,
    cryptoRegime: regime?.cryptoRegime ?? null,
    riskMode: regime?.riskMode ?? null,
    confidence: regime?.confidence ?? null
  };
  if (regime === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.REGIME_MISSING,
      message: "No market regime snapshot; a missing regime never passes.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: null
    };
  }
  const requiredRegime =
    ctx.snapshot.candidate.direction === "LONG"
      ? RISK_REGIME_POLICY.requiredCryptoRegimeByDirection.LONG
      : ctx.snapshot.candidate.direction === "SHORT"
        ? RISK_REGIME_POLICY.requiredCryptoRegimeByDirection.SHORT
        : null;
  if (requiredRegime === null || regime.cryptoRegime !== requiredRegime) {
    return block(
      RiskReasonCode.MARKET_REGIME_CONFLICT,
      `Crypto regime is not ${requiredRegime ?? "known"}.`,
      {
        inputJson,
        actualValue: null,
        limitValue: null,
        unit: null
      }
    );
  }
  if (
    RISK_REGIME_POLICY.forbiddenRiskModes.includes(regime.riskMode as never)
  ) {
    return block(
      RiskReasonCode.MARKET_REGIME_CONFLICT,
      `Risk mode ${regime.riskMode} blocks entries.`,
      {
        inputJson,
        actualValue: null,
        limitValue: null,
        unit: null
      }
    );
  }
  if (
    !Number.isFinite(regime.confidence) ||
    regime.confidence < RISK_REGIME_POLICY.minimumConfidence
  ) {
    return block(
      RiskReasonCode.MARKET_REGIME_CONFLICT,
      "Regime confidence is below the minimum.",
      {
        inputJson,
        actualValue: String(regime.confidence),
        limitValue: String(RISK_REGIME_POLICY.minimumConfidence),
        unit: "score"
      }
    );
  }
  return pass(
    RiskReasonCode.REGIME_OK,
    `Crypto regime is ${requiredRegime} with sufficient confidence.`,
    {
      inputJson,
      actualValue: String(regime.confidence),
      limitValue: String(RISK_REGIME_POLICY.minimumConfidence),
      unit: "score"
    }
  );
}

// ───────────────────────────────────────────────────────────────────────────
// R-021 … R-026 — streaks, structural prohibitions, minimums, versions
// ───────────────────────────────────────────────────────────────────────────

function ruleLossStreak(ctx: RiskEvaluationContext): RuleVerdict {
  const limit = ctx.snapshot.riskLimitSet?.maxConsecutiveLosses ?? null;
  const actual = ctx.snapshot.dailyCounters.consecutiveLosses;
  const inputJson = {
    consecutiveLosses: actual,
    closedTradeSequence: ctx.snapshot.dailyCounters.closedTradeSequence
  };
  if (limit === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.CONSECUTIVE_LOSS_LIMIT,
      message: "No active risk limit set; loss streak limit unknown.",
      inputJson,
      actualValue: String(actual),
      limitValue: null,
      unit: "count"
    };
  }
  if (actual >= limit) {
    return {
      outcome: "FAIL",
      severity: "CRITICAL",
      reasonCode: RiskReasonCode.CONSECUTIVE_LOSS_LIMIT,
      message:
        "Consecutive net losses reached the limit; new entries stop until a review.",
      inputJson,
      actualValue: String(actual),
      limitValue: String(limit),
      unit: "count",
      directive: "ENGAGE_KILL_SWITCH"
    };
  }
  return pass(
    RiskReasonCode.LOSS_STREAK_WITHIN_LIMIT,
    "Loss streak is inside the limit.",
    {
      inputJson,
      actualValue: String(actual),
      limitValue: String(limit),
      unit: "count"
    }
  );
}

function ruleNoScaleIn(ctx: RiskEvaluationContext): RuleVerdict {
  const assetId = ctx.snapshot.candidate.assetId;
  const openForAsset = ctx.snapshot.openPositions.filter(
    (position) => position.assetId === assetId
  );
  const reservedForAsset = ctx.snapshot.reservations.filter(
    (reservation) =>
      reservation.assetId === assetId && reservation.purpose === "ENTRY"
  );
  const inputJson = {
    assetId,
    openPositionsForAsset: openForAsset.length,
    openEntryOrdersForAsset: reservedForAsset.length,
    entryType: ctx.snapshot.candidate.entryType
  };

  if (openForAsset.length > 0 || reservedForAsset.length > 0) {
    return {
      outcome: "FAIL",
      severity: "CRITICAL",
      reasonCode: RiskReasonCode.AVERAGING_OR_SCALE_IN_FORBIDDEN,
      message:
        "A non-terminal position or entry order for this asset already exists.",
      inputJson,
      actualValue: String(openForAsset.length + reservedForAsset.length),
      limitValue: "0",
      unit: "count",
      directive: "ERROR_LOCK"
    };
  }
  return pass(
    RiskReasonCode.NO_SCALE_IN_OK,
    "No existing exposure or entry order for the asset.",
    {
      inputJson,
      actualValue: "0",
      limitValue: "0",
      unit: "count"
    }
  );
}

function ruleNoMartingale(ctx: RiskEvaluationContext): RuleVerdict {
  const override = ctx.snapshot.sizeOverride;
  const inputJson = {
    manualQuantity: override.manualQuantity,
    riskMultiplier: override.riskMultiplier,
    requestedBy: override.requestedBy,
    sizingPolicyVersion: ctx.snapshot.policyVersions.sizingPolicyVersion
  };

  if (override.manualQuantity !== null || override.requestedBy !== null) {
    return critical(
      RiskReasonCode.NON_DETERMINISTIC_SIZE_OVERRIDE,
      "A manual size override was supplied; sizing must come from the formula only.",
      { inputJson }
    );
  }
  if (override.riskMultiplier !== null) {
    const multiplier = decimal(override.riskMultiplier);
    if (multiplier === null || !multiplier.eq(DecimalValue.ONE)) {
      return critical(
        RiskReasonCode.NON_DETERMINISTIC_SIZE_OVERRIDE,
        "A risk multiplier other than 1 is forbidden.",
        {
          inputJson,
          actualValue: override.riskMultiplier,
          limitValue: "1.000000000000"
        }
      );
    }
  }
  return pass(
    RiskReasonCode.DETERMINISTIC_SIZE_OK,
    "Size comes from the pinned formula only.",
    {
      inputJson
    }
  );
}

function ruleNoPostLossIncrease(ctx: RiskEvaluationContext): RuleVerdict {
  const previous = ctx.snapshot.previousApproval;
  const riskAmount = decimal(ctx.sizing.riskAmount);
  const riskBudget = decimal(ctx.sizing.riskBudget);
  const inputJson = {
    previousEquity: previous?.equity ?? null,
    previousRiskAmount: previous?.riskAmount ?? null,
    currentEquity: ctx.equity.toString(),
    currentRiskAmount: ctx.sizing.riskAmount
  };

  if (riskAmount === null || riskBudget === null) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.RISK_INCREASE_AFTER_LOSS,
      message:
        "Risk amount is not computable, so a post-loss increase cannot be excluded.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: "USDT"
    };
  }
  if (riskAmount.gt(riskBudget)) {
    return block(
      RiskReasonCode.RISK_INCREASE_AFTER_LOSS,
      "Approved risk exceeds the current per-trade budget.",
      {
        inputJson,
        actualValue: riskAmount.toString(),
        limitValue: riskBudget.toString(),
        unit: "USDT"
      }
    );
  }
  if (previous !== null) {
    const previousEquity = decimal(previous.equity);
    const previousRisk = decimal(previous.riskAmount);
    if (previousEquity === null || previousRisk === null) {
      return {
        outcome: "ERROR",
        severity: "BLOCKER",
        reasonCode: RiskReasonCode.RISK_INCREASE_AFTER_LOSS,
        message: "Previous approval values are unreadable.",
        inputJson,
        actualValue: null,
        limitValue: null,
        unit: "USDT"
      };
    }
    // Equity fell since the last approval, so the risk must not have grown.
    if (ctx.equity.lt(previousEquity) && riskAmount.gt(previousRisk)) {
      return {
        outcome: "FAIL",
        severity: "CRITICAL",
        reasonCode: RiskReasonCode.RISK_INCREASE_AFTER_LOSS,
        message: "Equity fell but the approved risk grew.",
        inputJson,
        actualValue: riskAmount.toString(),
        limitValue: previousRisk.toString(),
        unit: "USDT",
        directive: "ERROR_LOCK"
      };
    }
  }
  return pass(
    RiskReasonCode.RISK_NOT_INCREASED_AFTER_LOSS,
    "Risk did not grow after a loss.",
    {
      inputJson,
      actualValue: riskAmount.toString(),
      limitValue: riskBudget.toString(),
      unit: "USDT"
    }
  );
}

function ruleInstrumentMinimums(ctx: RiskEvaluationContext): RuleVerdict {
  const profile = ctx.snapshot.executionProfile;
  const inputJson = {
    approvedQuantity: ctx.sizing.approvedQuantity,
    notional: ctx.sizing.notional,
    reservedQuoteAmount: ctx.sizing.reservedQuoteAmount,
    stepSize: profile?.stepSize ?? null,
    minQuantity: profile?.minQuantity ?? null,
    minNotional: profile?.minNotional ?? null,
    maxQuantity: profile?.maxQuantity ?? null,
    availableCash: ctx.availableCash.toString(),
    cappedBy: ctx.sizing.cappedBy
  };

  if (profile === null || !ctx.sizing.computable) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.BELOW_INSTRUMENT_MINIMUM,
      message:
        "Instrument minimums cannot be checked without a computable size.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: null
    };
  }

  const quantity = decimal(ctx.sizing.approvedQuantity);
  const notional = decimal(ctx.sizing.notional);
  const reserved = decimal(ctx.sizing.reservedQuoteAmount);
  const step = decimal(profile.stepSize);
  const minQuantity = decimal(profile.minQuantity);
  const minNotional = decimal(profile.minNotional);
  const maxQuantity = decimal(profile.maxQuantity);

  if (
    quantity === null ||
    notional === null ||
    reserved === null ||
    step === null ||
    minQuantity === null ||
    minNotional === null
  ) {
    return {
      outcome: "ERROR",
      severity: "BLOCKER",
      reasonCode: RiskReasonCode.BELOW_INSTRUMENT_MINIMUM,
      message: "Execution profile values are unreadable.",
      inputJson,
      actualValue: null,
      limitValue: null,
      unit: null
    };
  }

  if (!quantity.isPositive()) {
    return block(
      RiskReasonCode.QUANTITY_NOT_POSITIVE,
      "Rounded quantity is zero or negative.",
      {
        inputJson,
        actualValue: quantity.toString(),
        limitValue: "0.000000000000",
        unit: "base"
      }
    );
  }
  if (!step.isPositive() || !quantity.isMultipleOf(step)) {
    return block(
      RiskReasonCode.BELOW_INSTRUMENT_MINIMUM,
      "Quantity is not a multiple of the step size.",
      {
        inputJson,
        actualValue: quantity.toString(),
        limitValue: step.toString(),
        unit: "base"
      }
    );
  }
  if (quantity.lt(minQuantity)) {
    return block(
      RiskReasonCode.BELOW_INSTRUMENT_MINIMUM,
      "Quantity is below the instrument minimum.",
      {
        inputJson,
        actualValue: quantity.toString(),
        limitValue: minQuantity.toString(),
        unit: "base"
      }
    );
  }
  if (maxQuantity !== null && quantity.gt(maxQuantity)) {
    return block(
      RiskReasonCode.QUANTITY_ABOVE_INSTRUMENT_MAXIMUM,
      "Quantity exceeds the instrument maximum.",
      {
        inputJson,
        actualValue: quantity.toString(),
        limitValue: maxQuantity.toString(),
        unit: "base"
      }
    );
  }
  if (notional.lt(minNotional)) {
    return block(
      RiskReasonCode.BELOW_INSTRUMENT_MINIMUM,
      "Notional is below the instrument minimum.",
      {
        inputJson,
        actualValue: notional.toString(),
        limitValue: minNotional.toString(),
        unit: "USDT"
      }
    );
  }
  if (reserved.gt(ctx.availableCash)) {
    return block(
      RiskReasonCode.INSUFFICIENT_CASH,
      "Reserve including fee exceeds available cash.",
      {
        inputJson,
        actualValue: reserved.toString(),
        limitValue: ctx.availableCash.toString(),
        unit: "USDT"
      }
    );
  }
  return pass(
    RiskReasonCode.INSTRUMENT_MINIMUMS_OK,
    "Quantity, notional and cash all satisfy the instrument.",
    {
      inputJson,
      actualValue: quantity.toString(),
      limitValue: minQuantity.toString(),
      unit: "base"
    }
  );
}

function ruleIdempotencyVersion(ctx: RiskEvaluationContext): RuleVerdict {
  const { candidate, riskLimitSet, existingAssessment, executionProfile } =
    ctx.snapshot;
  const inputJson = {
    candidateKey: candidate.candidateKey,
    candidateInputHash: candidate.inputHash,
    assessmentInputHash: ctx.inputHash,
    existingAssessmentHash: existingAssessment?.inputHash ?? null,
    strategyVersionStatus: candidate.strategyVersionStatus,
    riskLimitSetStatus: riskLimitSet?.status ?? null,
    executionProfileStatus: executionProfile?.status ?? null
  };

  if (candidate.hasFinalDecision) {
    return critical(
      RiskReasonCode.CANDIDATE_ALREADY_DECIDED,
      "The candidate already carries a final decision; v1 allows exactly one.",
      { inputJson }
    );
  }
  if (
    candidate.stopDistance === null ||
    candidate.stopDistancePct === null ||
    candidate.plannedRewardRisk === null ||
    candidate.plannedEntryMinimum === null ||
    candidate.plannedEntryMaximum === null ||
    candidate.maximumEntryGapDistance === null ||
    candidate.validFrom === null ||
    candidate.earliestFillAt === null ||
    candidate.maxHoldHours === null ||
    candidate.strategySpecificationHash === null ||
    candidate.strategyEngineVersion === null
  ) {
    return critical(
      RiskReasonCode.CANDIDATE_PLAN_INCOMPLETE,
      "The candidate is missing typed plan fields; no value is substituted.",
      { inputJson }
    );
  }
  if (candidate.strategyVersionStatus !== "ACTIVE") {
    return critical(
      RiskReasonCode.STRATEGY_VERSION_RETIRED,
      `Strategy version is ${candidate.strategyVersionStatus}.`,
      { inputJson }
    );
  }
  if (riskLimitSet === null) {
    return critical(
      RiskReasonCode.RISK_LIMIT_SET_NOT_ACTIVE,
      "No risk limit set was supplied.",
      {
        inputJson
      }
    );
  }
  if (riskLimitSet.status !== "ACTIVE") {
    return critical(
      RiskReasonCode.RISK_LIMIT_SET_NOT_ACTIVE,
      `Risk limit set is ${riskLimitSet.status}.`,
      { inputJson }
    );
  }
  if (riskLimitSet.specificationHash !== RISK_LIMIT_SET_SPECIFICATION_HASH) {
    return critical(
      RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      "The stored risk limit set does not match the pinned v1 specification hash.",
      { inputJson }
    );
  }
  const limitsMatchPolicy =
    riskLimitSet.maxOpenPositions === RISK_LIMIT_SET_V1.maxOpenPositions &&
    riskLimitSet.maxNewTradesPerDay === RISK_LIMIT_SET_V1.maxNewTradesPerDay &&
    riskLimitSet.maxConsecutiveLosses ===
      RISK_LIMIT_SET_V1.maxConsecutiveLosses &&
    riskLimitSet.maxSpreadBps === RISK_LIMIT_SET_V1.maxSpreadBps &&
    riskLimitSet.maxSlippageBps === RISK_LIMIT_SET_V1.maxSlippageBps;
  if (!limitsMatchPolicy) {
    return critical(
      RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      "The stored risk limit set contradicts the pinned v1 numbers.",
      { inputJson }
    );
  }
  if (
    existingAssessment !== null &&
    existingAssessment.inputHash !== ctx.inputHash
  ) {
    return critical(
      RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      "An assessment with the same key already exists with a different input hash.",
      { inputJson }
    );
  }
  return pass(
    RiskReasonCode.VERSIONS_CONSISTENT,
    "Versions, hashes and plan fields are consistent.",
    {
      inputJson
    }
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Registry
// ───────────────────────────────────────────────────────────────────────────

export type RiskRule = (ctx: RiskEvaluationContext) => RuleVerdict;

/** The rule registry — exactly one implementation per documented rule code. */
export const RISK_RULES: Readonly<Record<string, RiskRule>> = Object.freeze({
  [RiskRuleCode.SHADOW_MODE]: ruleShadowMode,
  [RiskRuleCode.SESSION]: ruleSession,
  [RiskRuleCode.PORTFOLIO_CONSISTENCY]: rulePortfolioConsistency,
  [RiskRuleCode.ASSET_SCOPE]: ruleAssetScope,
  [RiskRuleCode.LONG_ONLY]: ruleLongOnly,
  [RiskRuleCode.NO_LEVERAGE]: ruleNoLeverage,
  [RiskRuleCode.STOP_REQUIRED]: ruleStopRequired,
  [RiskRuleCode.MIN_RR]: ruleMinRewardRisk,
  [RiskRuleCode.RISK_PER_TRADE]: ruleRiskPerTrade,
  [RiskRuleCode.DAILY_LOSS]: ruleDailyLoss,
  [RiskRuleCode.OPEN_POSITIONS]: ruleOpenPositions,
  [RiskRuleCode.TRADES_PER_DAY]: ruleTradesPerDay,
  [RiskRuleCode.GROSS_EXPOSURE]: ruleGrossExposure,
  [RiskRuleCode.ASSET_EXPOSURE]: ruleAssetExposure,
  [RiskRuleCode.CORRELATION]: ruleCorrelation,
  [RiskRuleCode.DATA_FRESHNESS]: ruleDataFreshness,
  [RiskRuleCode.DATA_QUALITY]: ruleDataQuality,
  [RiskRuleCode.SPREAD]: ruleSpread,
  [RiskRuleCode.SLIPPAGE]: ruleSlippage,
  [RiskRuleCode.REGIME]: ruleRegime,
  [RiskRuleCode.LOSS_STREAK]: ruleLossStreak,
  [RiskRuleCode.NO_SCALE_IN]: ruleNoScaleIn,
  [RiskRuleCode.NO_MARTINGALE]: ruleNoMartingale,
  [RiskRuleCode.NO_POST_LOSS_INCREASE]: ruleNoPostLossIncrease,
  [RiskRuleCode.INSTRUMENT_MINIMUMS]: ruleInstrumentMinimums,
  [RiskRuleCode.IDEMPOTENCY_VERSION]: ruleIdempotencyVersion
});

/** Turn a verdict into the persisted draft row. */
export function toRuleResult(
  ruleCode: string,
  verdict: RuleVerdict,
  evaluatedAt: string
): RiskRuleResultDraftV1 {
  return {
    ruleCode: ruleCode as RiskRuleResultDraftV1["ruleCode"],
    ruleVersion: RISK_RULE_SET_VERSION,
    outcome: verdict.outcome,
    severity: verdict.severity,
    reasonCode: verdict.reasonCode,
    message: verdict.message,
    actualValue: verdict.actualValue ?? null,
    limitValue: verdict.limitValue ?? null,
    unit: verdict.unit ?? null,
    inputJson: verdict.inputJson,
    evaluatedAt
  };
}
