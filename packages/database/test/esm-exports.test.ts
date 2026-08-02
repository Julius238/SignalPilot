import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Import all enum constants that were previously broken in Docker ESM builds.
// These come from dist/index.js → runtime-values.js (createRequire),
// NOT from static named re-exports of @prisma/client.
import {
  AlertChannel,
  AlertStatus,
  AssetType,
  BacktestOutcome,
  BacktestOutcomeStatus,
  BacktestRunStatus,
  BotRunStatus,
  ExitPlanStatus,
  InstrumentExecutionProfileStatus,
  IntrabarConflictPolicy,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  PaperExpectedMoveDirection,
  PaperOrderSide,
  PaperOrderStatus,
  PaperPositionStatus,
  PortfolioLedgerEntryType,
  PortfolioStatus,
  Prisma,
  RiskAssessmentStatus,
  RiskEventType,
  RiskLevel,
  RiskLimitScope,
  RiskLimitSetStatus,
  RiskRuleOutcome,
  RiskSeverity,
  ShadowFillTriggerType,
  ShadowOrderPurpose,
  ShadowOrderSide,
  ShadowOrderStatus,
  ShadowOrderTimeInForce,
  ShadowOrderType,
  ShadowPositionEventType,
  ShadowPositionStatus,
  SignalDirection,
  SignalStatus,
  SignalType,
  StrategyComparisonStatus,
  StrategyPerformanceWindow,
  StrategyStatus,
  StrategyVersionStatus,
  TradeCandidateStatus,
  TradeDecisionOutcome,
  TradeDirection,
  TradeEntryType,
  TradeEvidenceType,
  TradingActorType,
  TradingSessionMode,
  TradingSessionStatus,
  WatchlistPriority,
  prisma
} from "../src/index.js";

describe("database package ESM exports", () => {
  it("exports AlertChannel enum values at runtime", () => {
    assert.equal(AlertChannel.TELEGRAM, "TELEGRAM");
    assert.equal(AlertChannel.EMAIL, "EMAIL");
    assert.equal(AlertChannel.DISCORD, "DISCORD");
    assert.equal(AlertChannel.WEBHOOK, "WEBHOOK");
  });

  it("exports AlertStatus enum values at runtime", () => {
    assert.equal(AlertStatus.PENDING, "PENDING");
    assert.equal(AlertStatus.SENT, "SENT");
    assert.equal(AlertStatus.FAILED, "FAILED");
  });

  it("exports AssetType enum values at runtime", () => {
    assert.equal(AssetType.STOCK, "STOCK");
    assert.equal(AssetType.ETF, "ETF");
    assert.equal(AssetType.CRYPTO, "CRYPTO");
  });

  it("exports SignalStatus enum values at runtime", () => {
    assert.equal(SignalStatus.STRONG_WATCH, "STRONG_WATCH");
    assert.equal(SignalStatus.WATCH, "WATCH");
    assert.equal(SignalStatus.WAIT, "WAIT");
    assert.equal(SignalStatus.AVOID, "AVOID");
    assert.equal(SignalStatus.NO_EDGE, "NO_EDGE");
  });

  it("exports BotRunStatus enum values at runtime", () => {
    assert.equal(BotRunStatus.SUCCESS, "SUCCESS");
    assert.equal(BotRunStatus.FAILED, "FAILED");
    assert.equal(BotRunStatus.RUNNING, "RUNNING");
  });

  it("exports all other enum constants without throwing", () => {
    assert.ok(typeof BacktestOutcome === "object");
    assert.ok(typeof BacktestOutcomeStatus === "object");
    assert.ok(typeof BacktestRunStatus === "object");
    assert.ok(typeof PaperEvaluationKind === "object");
    assert.ok(typeof PaperEvaluationOutcome === "object");
    assert.ok(typeof PaperEvaluationStatus === "object");
    assert.ok(typeof PaperExpectedMoveDirection === "object");
    assert.ok(typeof PaperOrderSide === "object");
    assert.ok(typeof PaperOrderStatus === "object");
    assert.ok(typeof PaperPositionStatus === "object");
    assert.ok(typeof RiskLevel === "object");
    assert.ok(typeof SignalDirection === "object");
    assert.ok(typeof SignalType === "object");
    assert.ok(typeof StrategyComparisonStatus === "object");
    assert.ok(typeof WatchlistPriority === "object");
  });

  it("exports Prisma namespace with PrismaClientKnownRequestError", () => {
    assert.ok(typeof Prisma === "object");
    assert.ok(typeof Prisma.PrismaClientKnownRequestError === "function");
  });

  it("exports the shadow trading enums at runtime", () => {
    assert.equal(TradeCandidateStatus.READY_FOR_RISK, "READY_FOR_RISK");
    assert.equal(TradeCandidateStatus.APPROVED_FOR_SHADOW, "APPROVED_FOR_SHADOW");
    assert.equal(ShadowOrderStatus.WAITING_FOR_ENTRY, "WAITING_FOR_ENTRY");
    assert.equal(ShadowPositionStatus.STOPPED_OUT, "STOPPED_OUT");
    assert.equal(TradingSessionStatus.SHADOW_ACTIVE, "SHADOW_ACTIVE");
    assert.equal(TradingSessionStatus.ERROR_LOCKED, "ERROR_LOCKED");
    assert.equal(PortfolioLedgerEntryType.SELL_NOTIONAL, "SELL_NOTIONAL");
    assert.equal(RiskSeverity.CRITICAL, "CRITICAL");
  });

  it("exposes no live trading and no limit order enum member", () => {
    assert.deepEqual(Object.values(TradingSessionMode), ["SHADOW"]);
    assert.deepEqual(Object.values(ShadowOrderType), ["MARKET"]);
    assert.deepEqual(Object.values(TradeDirection), ["LONG"]);
    assert.deepEqual(Object.values(TradeEntryType), ["MARKET"]);
  });

  it("exports the remaining shadow trading enum constants without throwing", () => {
    for (const enumObject of [
      ExitPlanStatus,
      InstrumentExecutionProfileStatus,
      IntrabarConflictPolicy,
      PortfolioStatus,
      RiskAssessmentStatus,
      RiskEventType,
      RiskLimitScope,
      RiskLimitSetStatus,
      RiskRuleOutcome,
      ShadowFillTriggerType,
      ShadowOrderPurpose,
      ShadowOrderSide,
      ShadowOrderTimeInForce,
      ShadowPositionEventType,
      StrategyPerformanceWindow,
      StrategyStatus,
      StrategyVersionStatus,
      TradeDecisionOutcome,
      TradeEvidenceType,
      TradingActorType
    ]) {
      assert.ok(typeof enumObject === "object" && Object.keys(enumObject).length > 0);
    }
  });

  it("exports prisma singleton with $connect method", () => {
    assert.ok(prisma !== null && prisma !== undefined);
    assert.ok(typeof prisma.$connect === "function");
    assert.ok(typeof prisma.$disconnect === "function");
  });
});
