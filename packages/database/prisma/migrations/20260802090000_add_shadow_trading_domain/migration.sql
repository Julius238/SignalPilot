-- Shadow Trading v1 domain model (docs/trading/03-domain-model.md, package P1).
--
-- This migration is strictly additive:
--   * it creates 30 new enum types and 23 new tables with their indexes and
--     foreign keys;
--   * it does not drop, rename or alter a single pre-existing table, column,
--     enum value, index or constraint;
--   * it inserts no rows, so no strategy, assignment, portfolio, session,
--     candidate, order, position or ledger entry exists after deployment;
--   * the legacy PaperAccount, PaperOrder, PaperPosition and the active
--     PaperSignalEvaluation models are left completely untouched (ADR 0002).
--
-- Every trading structure is fail-closed by default: Strategy, StrategyVersion,
-- InstrumentExecutionProfile, RiskLimitSet and Portfolio start as DRAFT,
-- StrategyAssignment."enabled" starts false, TradingSession starts STOPPED with
-- "killSwitchEngaged" true, and ShadowOrderType has no LIMIT member.
--
-- Rollback: drop the new tables and types; no down-migration is provided
-- because the additive tables are empty and harmless (docs/trading/10, P1).

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "StrategyVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('LONG');

-- CreateEnum
CREATE TYPE "TradeEntryType" AS ENUM ('MARKET');

-- CreateEnum
CREATE TYPE "TradeCandidateStatus" AS ENUM ('CREATED', 'VALIDATING', 'READY_FOR_RISK', 'APPROVED_FOR_SHADOW', 'INVALID', 'RISK_REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeEvidenceType" AS ENUM ('CANDLE', 'SIGNAL', 'MTF', 'REGIME', 'DATA_QUALITY', 'RADAR', 'NEWS', 'EVENT', 'DISCOVERY', 'EXECUTION_PROFILE');

-- CreateEnum
CREATE TYPE "TradeDecisionOutcome" AS ENUM ('APPROVE_SHADOW', 'REJECT', 'EXPIRE', 'CANCEL', 'ERROR');

-- CreateEnum
CREATE TYPE "RiskAssessmentStatus" AS ENUM ('PASS', 'FAIL', 'ERROR');

-- CreateEnum
CREATE TYPE "RiskRuleOutcome" AS ENUM ('PASS', 'FAIL', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKER', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskLimitSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RiskLimitScope" AS ENUM ('PORTFOLIO');

-- CreateEnum
CREATE TYPE "RiskEventType" AS ENUM ('RISK_RULE_BLOCK', 'DAILY_LOSS_LIMIT', 'CONSECUTIVE_LOSS_LIMIT', 'PORTFOLIO_INCONSISTENCY', 'IDEMPOTENCY_OR_VERSION_CONFLICT', 'CONFIGURATION_INVALID', 'DATA_STALE', 'DATA_QUALITY', 'EXECUTION_PROFILE_CHANGE', 'SIMULATION_ERROR', 'WORKER_ERROR', 'RECONCILIATION_FINDING', 'ADMIN_ACTION');

-- CreateEnum
CREATE TYPE "InstrumentExecutionProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ShadowOrderPurpose" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "ShadowOrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ShadowOrderType" AS ENUM ('MARKET');

-- CreateEnum
CREATE TYPE "ShadowOrderTimeInForce" AS ENUM ('NEXT_BARS');

-- CreateEnum
CREATE TYPE "ShadowOrderStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'WAITING_FOR_ENTRY', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShadowFillTriggerType" AS ENUM ('ENTRY', 'STOP', 'TAKE_PROFIT', 'TIME_EXIT', 'INVALIDATION', 'MANUAL_RISK_CLOSE');

-- CreateEnum
CREATE TYPE "ShadowPositionStatus" AS ENUM ('OPENING', 'OPEN', 'PARTIALLY_CLOSED', 'CLOSED', 'STOPPED_OUT', 'INVALIDATED', 'ERROR');

-- CreateEnum
CREATE TYPE "ShadowPositionEventType" AS ENUM ('OPENING', 'OPENED', 'PARTIAL_CLOSE', 'CLOSED', 'STOPPED_OUT', 'INVALIDATED', 'MARKED', 'ERROR');

-- CreateEnum
CREATE TYPE "ExitPlanStatus" AS ENUM ('ACTIVE', 'TRIGGERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntrabarConflictPolicy" AS ENUM ('STOP_FIRST');

-- CreateEnum
CREATE TYPE "PortfolioStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR_LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PortfolioLedgerEntryType" AS ENUM ('INITIAL_CASH', 'RESERVE', 'RELEASE', 'BUY_NOTIONAL', 'SELL_NOTIONAL', 'FEE', 'PNL_ADJUSTMENT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "TradingSessionMode" AS ENUM ('SHADOW');

-- CreateEnum
CREATE TYPE "TradingSessionStatus" AS ENUM ('STOPPED', 'SHADOW_ACTIVE', 'PAUSED', 'KILLED', 'ERROR_LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "StrategyPerformanceWindow" AS ENUM ('DAILY', 'ROLLING_30D', 'ALL_TIME');

-- CreateEnum
CREATE TYPE "TradingActorType" AS ENUM ('SYSTEM', 'ADMIN', 'RECOVERY');

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StrategyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "engineVersion" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "parametersJson" JSONB NOT NULL,
    "specificationHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyAssignment" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "assignmentConfigJson" JSONB NOT NULL,
    "activeScopeKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentExecutionProfile" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "InstrumentExecutionProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "tickSize" DECIMAL(30,12) NOT NULL,
    "stepSize" DECIMAL(30,12) NOT NULL,
    "minQuantity" DECIMAL(30,12) NOT NULL,
    "minNotional" DECIMAL(30,12) NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "fullSpreadBps" INTEGER NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "maxParticipationRate" DECIMAL(30,12) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceObservedAt" TIMESTAMP(3) NOT NULL,
    "specificationHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "activeAssetKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstrumentExecutionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeCandidate" (
    "id" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "strategyAssignmentId" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "anchorCandleId" TEXT NOT NULL,
    "anchorSignalId" TEXT,
    "direction" "TradeDirection" NOT NULL DEFAULT 'LONG',
    "entryType" "TradeEntryType" NOT NULL DEFAULT 'MARKET',
    "status" "TradeCandidateStatus" NOT NULL DEFAULT 'CREATED',
    "referenceEntryPrice" DECIMAL(30,12) NOT NULL,
    "stopPrice" DECIMAL(30,12) NOT NULL,
    "takeProfitPrice" DECIMAL(30,12) NOT NULL,
    "minimumRewardRisk" DECIMAL(30,12) NOT NULL,
    "dataAsOf" TIMESTAMP(3) NOT NULL,
    "decisionTime" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inputSnapshotJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "strategyReasonCodes" JSONB NOT NULL,
    "invalidReasonCode" TEXT,
    "cancelReasonCode" TEXT,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeCandidateEvidence" (
    "id" TEXT NOT NULL,
    "tradeCandidateId" TEXT NOT NULL,
    "type" "TradeEvidenceType" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "payloadJson" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeCandidateEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeDecision" (
    "id" TEXT NOT NULL,
    "tradeCandidateId" TEXT NOT NULL,
    "riskAssessmentId" TEXT,
    "decisionKey" TEXT NOT NULL,
    "outcome" "TradeDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "tradeCandidateId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "riskLimitSetId" TEXT NOT NULL,
    "assessmentKey" TEXT NOT NULL,
    "status" "RiskAssessmentStatus" NOT NULL,
    "ruleSetVersion" TEXT NOT NULL,
    "equity" DECIMAL(30,12) NOT NULL,
    "availableCash" DECIMAL(30,12) NOT NULL,
    "reservedCash" DECIMAL(30,12) NOT NULL,
    "dailyPnl" DECIMAL(30,12) NOT NULL,
    "openPositionCount" INTEGER NOT NULL,
    "newTradesToday" INTEGER NOT NULL,
    "consecutiveLosses" INTEGER NOT NULL,
    "grossExposure" DECIMAL(30,12) NOT NULL,
    "assetExposure" DECIMAL(30,12) NOT NULL,
    "correlatedExposure" DECIMAL(30,12) NOT NULL,
    "requestedQuantity" DECIMAL(30,12) NOT NULL,
    "approvedQuantity" DECIMAL(30,12) NOT NULL,
    "riskAmount" DECIMAL(30,12) NOT NULL,
    "tradingDateUtc" DATE NOT NULL,
    "portfolioSnapshotAsOf" TIMESTAMP(3) NOT NULL,
    "marketDataAsOf" TIMESTAMP(3) NOT NULL,
    "inputsJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRuleResult" (
    "id" TEXT NOT NULL,
    "riskAssessmentId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "outcome" "RiskRuleOutcome" NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actualValue" DECIMAL(30,12),
    "limitValue" DECIMAL(30,12),
    "unit" TEXT,
    "inputJson" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskRuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskLimitSet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RiskLimitSetStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" "RiskLimitScope" NOT NULL DEFAULT 'PORTFOLIO',
    "maxRiskPerTradePct" DECIMAL(30,12) NOT NULL,
    "maxDailyLossPct" DECIMAL(30,12) NOT NULL,
    "minRewardRisk" DECIMAL(30,12) NOT NULL,
    "maxOpenPositions" INTEGER NOT NULL,
    "maxNewTradesPerDay" INTEGER NOT NULL,
    "maxConsecutiveLosses" INTEGER NOT NULL,
    "maxGrossExposurePct" DECIMAL(30,12) NOT NULL,
    "maxAssetExposurePct" DECIMAL(30,12) NOT NULL,
    "maxCorrelatedExposurePct" DECIMAL(30,12) NOT NULL,
    "maxSpreadBps" INTEGER NOT NULL,
    "maxSlippageBps" INTEGER NOT NULL,
    "parametersJson" JSONB NOT NULL,
    "specificationHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "activeScopeKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskLimitSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" "RiskEventType" NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tradeCandidateId" TEXT,
    "shadowOrderId" TEXT,
    "shadowPositionId" TEXT,
    "tradingSessionId" TEXT,
    "riskRuleResultId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowOrder" (
    "id" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "tradeCandidateId" TEXT,
    "tradeDecisionId" TEXT,
    "shadowPositionId" TEXT,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tradingSessionId" TEXT NOT NULL,
    "executionProfileId" TEXT NOT NULL,
    "entryCandidateKey" TEXT,
    "purpose" "ShadowOrderPurpose" NOT NULL,
    "side" "ShadowOrderSide" NOT NULL,
    "orderType" "ShadowOrderType" NOT NULL DEFAULT 'MARKET',
    "timeInForce" "ShadowOrderTimeInForce" NOT NULL DEFAULT 'NEXT_BARS',
    "status" "ShadowOrderStatus" NOT NULL DEFAULT 'PROPOSED',
    "requestedQuantity" DECIMAL(30,12) NOT NULL,
    "filledQuantity" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "remainingQuantity" DECIMAL(30,12) NOT NULL,
    "referencePrice" DECIMAL(30,12) NOT NULL,
    "reservedQuoteAmount" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "earliestFillAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "precisionSnapshotJson" JSONB NOT NULL,
    "costModelSnapshotJson" JSONB NOT NULL,
    "lastProcessedCandleId" TEXT,
    "rejectionReasonCode" TEXT,
    "cancelReasonCode" TEXT,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShadowOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowFill" (
    "id" TEXT NOT NULL,
    "fillKey" TEXT NOT NULL,
    "shadowOrderId" TEXT NOT NULL,
    "shadowPositionId" TEXT,
    "assetId" TEXT NOT NULL,
    "sourceCandleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "side" "ShadowOrderSide" NOT NULL,
    "quantity" DECIMAL(30,12) NOT NULL,
    "referencePrice" DECIMAL(30,12) NOT NULL,
    "spreadAmount" DECIMAL(30,12) NOT NULL,
    "slippageAmount" DECIMAL(30,12) NOT NULL,
    "fillPrice" DECIMAL(30,12) NOT NULL,
    "notional" DECIMAL(30,12) NOT NULL,
    "feeAmount" DECIMAL(30,12) NOT NULL,
    "feeAsset" TEXT NOT NULL,
    "liquidityAvailable" DECIMAL(30,12) NOT NULL,
    "participationRate" DECIMAL(30,12) NOT NULL,
    "triggerType" "ShadowFillTriggerType" NOT NULL,
    "simulationVersion" TEXT NOT NULL,
    "assumptionsJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowPosition" (
    "id" TEXT NOT NULL,
    "positionKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "strategyAssignmentId" TEXT NOT NULL,
    "entryOrderId" TEXT NOT NULL,
    "status" "ShadowPositionStatus" NOT NULL DEFAULT 'OPENING',
    "openScopeKey" TEXT,
    "initialQuantity" DECIMAL(30,12) NOT NULL,
    "openQuantity" DECIMAL(30,12) NOT NULL,
    "closedQuantity" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "averageEntryPrice" DECIMAL(30,12) NOT NULL,
    "averageExitPrice" DECIMAL(30,12),
    "grossEntryNotional" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "grossExitNotional" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "feesPaid" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "stopPrice" DECIMAL(30,12) NOT NULL,
    "takeProfitPrice" DECIMAL(30,12) NOT NULL,
    "maxHoldUntil" TIMESTAMP(3) NOT NULL,
    "activeExitPlanVersion" INTEGER,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastValuationAt" TIMESTAMP(3),
    "lastProcessedCandleId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShadowPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowPositionEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "shadowPositionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "ShadowPositionEventType" NOT NULL,
    "sourceOrderId" TEXT,
    "sourceFillId" TEXT,
    "sourceCandleId" TEXT,
    "quantity" DECIMAL(30,12),
    "price" DECIMAL(30,12),
    "realizedPnlDelta" DECIMAL(30,12),
    "payloadJson" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowPositionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitPlan" (
    "id" TEXT NOT NULL,
    "shadowPositionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ExitPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "stopPrice" DECIMAL(30,12) NOT NULL,
    "takeProfitPrice" DECIMAL(30,12) NOT NULL,
    "maxHoldUntil" TIMESTAMP(3) NOT NULL,
    "intrabarConflictPolicy" "IntrabarConflictPolicy" NOT NULL DEFAULT 'STOP_FIRST',
    "triggeredBy" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "specificationJson" JSONB NOT NULL,
    "specificationHash" TEXT NOT NULL,
    "activePositionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USDT',
    "status" "PortfolioStatus" NOT NULL DEFAULT 'DRAFT',
    "startingCash" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "availableCash" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "reservedCash" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "feesPaid" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "equity" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "highWaterMark" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "ledgerSequence" INTEGER NOT NULL DEFAULT 0,
    "lastReconciledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioLedgerEntry" (
    "id" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "PortfolioLedgerEntryType" NOT NULL,
    "availableCashDelta" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "reservedCashDelta" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "realizedPnlDelta" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "feeDelta" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "shadowOrderId" TEXT,
    "shadowFillId" TEXT,
    "shadowPositionId" TEXT,
    "correctionOfId" TEXT,
    "balanceAfterJson" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "tradingDateUtc" DATE NOT NULL,
    "sourceLedgerSequence" INTEGER NOT NULL,
    "availableCash" DECIMAL(30,12) NOT NULL,
    "reservedCash" DECIMAL(30,12) NOT NULL,
    "marketValue" DECIMAL(30,12) NOT NULL,
    "equity" DECIMAL(30,12) NOT NULL,
    "realizedPnl" DECIMAL(30,12) NOT NULL,
    "unrealizedPnl" DECIMAL(30,12) NOT NULL,
    "feesPaid" DECIMAL(30,12) NOT NULL,
    "dailyPnl" DECIMAL(30,12) NOT NULL,
    "highWaterMark" DECIMAL(30,12) NOT NULL,
    "drawdownAmount" DECIMAL(30,12) NOT NULL,
    "drawdownPct" DECIMAL(30,12) NOT NULL,
    "grossExposure" DECIMAL(30,12) NOT NULL,
    "openPositionCount" INTEGER NOT NULL,
    "valuationJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingSession" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "mode" "TradingSessionMode" NOT NULL DEFAULT 'SHADOW',
    "status" "TradingSessionStatus" NOT NULL DEFAULT 'STOPPED',
    "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT true,
    "killReasonCode" TEXT,
    "killNote" TEXT,
    "activePortfolioKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "killedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "lastChangedBy" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyPerformance" (
    "id" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "window" "StrategyPerformanceWindow" NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "closedTrades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "breakeven" INTEGER NOT NULL DEFAULT 0,
    "grossPnl" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "netPnl" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "fees" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "averageR" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "profitFactor" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "maxDrawdownPct" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "averageHoldMinutes" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "expectancy" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "sourceThroughPositionEventId" TEXT,
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingAuditEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "actorType" "TradingActorType" NOT NULL,
    "actorId" TEXT,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "tradingSessionId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadataJson" JSONB,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "engineVersion" TEXT,
    "codeVersion" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingJobCursor" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "lastCandleId" TEXT,
    "lastProcessedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "inputHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingJobCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_key_key" ON "Strategy"("key");

-- CreateIndex
CREATE INDEX "Strategy_status_idx" ON "Strategy"("status");

-- CreateIndex
CREATE INDEX "StrategyVersion_status_idx" ON "StrategyVersion"("status");

-- CreateIndex
CREATE INDEX "StrategyVersion_specificationHash_idx" ON "StrategyVersion"("specificationHash");

-- CreateIndex
CREATE INDEX "StrategyVersion_effectiveFrom_effectiveTo_idx" ON "StrategyVersion"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_strategyId_version_key" ON "StrategyVersion"("strategyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyAssignment_activeScopeKey_key" ON "StrategyAssignment"("activeScopeKey");

-- CreateIndex
CREATE INDEX "StrategyAssignment_portfolioId_enabled_idx" ON "StrategyAssignment"("portfolioId", "enabled");

-- CreateIndex
CREATE INDEX "StrategyAssignment_assetId_enabled_idx" ON "StrategyAssignment"("assetId", "enabled");

-- CreateIndex
CREATE INDEX "StrategyAssignment_strategyVersionId_idx" ON "StrategyAssignment"("strategyVersionId");

-- CreateIndex
CREATE INDEX "StrategyAssignment_validFrom_validTo_idx" ON "StrategyAssignment"("validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentExecutionProfile_activeAssetKey_key" ON "InstrumentExecutionProfile"("activeAssetKey");

-- CreateIndex
CREATE INDEX "InstrumentExecutionProfile_status_idx" ON "InstrumentExecutionProfile"("status");

-- CreateIndex
CREATE INDEX "InstrumentExecutionProfile_specificationHash_idx" ON "InstrumentExecutionProfile"("specificationHash");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentExecutionProfile_assetId_version_key" ON "InstrumentExecutionProfile"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TradeCandidate_candidateKey_key" ON "TradeCandidate"("candidateKey");

-- CreateIndex
CREATE INDEX "TradeCandidate_status_createdAt_idx" ON "TradeCandidate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradeCandidate_portfolioId_status_idx" ON "TradeCandidate"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "TradeCandidate_assetId_decisionTime_idx" ON "TradeCandidate"("assetId", "decisionTime");

-- CreateIndex
CREATE INDEX "TradeCandidate_expiresAt_idx" ON "TradeCandidate"("expiresAt");

-- CreateIndex
CREATE INDEX "TradeCandidate_claimExpiresAt_idx" ON "TradeCandidate"("claimExpiresAt");

-- CreateIndex
CREATE INDEX "TradeCandidate_inputHash_idx" ON "TradeCandidate"("inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "TradeCandidate_strategyAssignmentId_strategyVersionId_asset_key" ON "TradeCandidate"("strategyAssignmentId", "strategyVersionId", "assetId", "anchorCandleId");

-- CreateIndex
CREATE INDEX "TradeCandidateEvidence_tradeCandidateId_type_idx" ON "TradeCandidateEvidence"("tradeCandidateId", "type");

-- CreateIndex
CREATE INDEX "TradeCandidateEvidence_payloadHash_idx" ON "TradeCandidateEvidence"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "TradeCandidateEvidence_tradeCandidateId_type_sourceType_sou_key" ON "TradeCandidateEvidence"("tradeCandidateId", "type", "sourceType", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDecision_tradeCandidateId_key" ON "TradeDecision"("tradeCandidateId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDecision_riskAssessmentId_key" ON "TradeDecision"("riskAssessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDecision_decisionKey_key" ON "TradeDecision"("decisionKey");

-- CreateIndex
CREATE INDEX "TradeDecision_outcome_decidedAt_idx" ON "TradeDecision"("outcome", "decidedAt");

-- CreateIndex
CREATE INDEX "TradeDecision_outputHash_idx" ON "TradeDecision"("outputHash");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_assessmentKey_key" ON "RiskAssessment"("assessmentKey");

-- CreateIndex
CREATE INDEX "RiskAssessment_tradeCandidateId_assessedAt_idx" ON "RiskAssessment"("tradeCandidateId", "assessedAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_portfolioId_tradingDateUtc_idx" ON "RiskAssessment"("portfolioId", "tradingDateUtc");

-- CreateIndex
CREATE INDEX "RiskAssessment_status_assessedAt_idx" ON "RiskAssessment"("status", "assessedAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_inputHash_idx" ON "RiskAssessment"("inputHash");

-- CreateIndex
CREATE INDEX "RiskRuleResult_ruleCode_outcome_idx" ON "RiskRuleResult"("ruleCode", "outcome");

-- CreateIndex
CREATE INDEX "RiskRuleResult_severity_evaluatedAt_idx" ON "RiskRuleResult"("severity", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRuleResult_riskAssessmentId_ruleCode_key" ON "RiskRuleResult"("riskAssessmentId", "ruleCode");

-- CreateIndex
CREATE UNIQUE INDEX "RiskLimitSet_activeScopeKey_key" ON "RiskLimitSet"("activeScopeKey");

-- CreateIndex
CREATE INDEX "RiskLimitSet_status_idx" ON "RiskLimitSet"("status");

-- CreateIndex
CREATE INDEX "RiskLimitSet_specificationHash_idx" ON "RiskLimitSet"("specificationHash");

-- CreateIndex
CREATE UNIQUE INDEX "RiskLimitSet_key_version_key" ON "RiskLimitSet"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_eventKey_key" ON "RiskEvent"("eventKey");

-- CreateIndex
CREATE INDEX "RiskEvent_portfolioId_createdAt_idx" ON "RiskEvent"("portfolioId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvent_severity_acknowledgedAt_idx" ON "RiskEvent"("severity", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "RiskEvent_type_createdAt_idx" ON "RiskEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvent_tradingSessionId_idx" ON "RiskEvent"("tradingSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowOrder_orderKey_key" ON "ShadowOrder"("orderKey");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowOrder_clientOrderId_key" ON "ShadowOrder"("clientOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowOrder_entryCandidateKey_key" ON "ShadowOrder"("entryCandidateKey");

-- CreateIndex
CREATE INDEX "ShadowOrder_portfolioId_status_idx" ON "ShadowOrder"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "ShadowOrder_assetId_status_idx" ON "ShadowOrder"("assetId", "status");

-- CreateIndex
CREATE INDEX "ShadowOrder_tradingSessionId_createdAt_idx" ON "ShadowOrder"("tradingSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ShadowOrder_status_earliestFillAt_idx" ON "ShadowOrder"("status", "earliestFillAt");

-- CreateIndex
CREATE INDEX "ShadowOrder_claimExpiresAt_idx" ON "ShadowOrder"("claimExpiresAt");

-- CreateIndex
CREATE INDEX "ShadowOrder_expiresAt_idx" ON "ShadowOrder"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowFill_fillKey_key" ON "ShadowFill"("fillKey");

-- CreateIndex
CREATE INDEX "ShadowFill_shadowPositionId_occurredAt_idx" ON "ShadowFill"("shadowPositionId", "occurredAt");

-- CreateIndex
CREATE INDEX "ShadowFill_assetId_occurredAt_idx" ON "ShadowFill"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX "ShadowFill_sourceCandleId_idx" ON "ShadowFill"("sourceCandleId");

-- CreateIndex
CREATE INDEX "ShadowFill_triggerType_occurredAt_idx" ON "ShadowFill"("triggerType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowFill_shadowOrderId_sequence_key" ON "ShadowFill"("shadowOrderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowPosition_positionKey_key" ON "ShadowPosition"("positionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowPosition_entryOrderId_key" ON "ShadowPosition"("entryOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowPosition_openScopeKey_key" ON "ShadowPosition"("openScopeKey");

-- CreateIndex
CREATE INDEX "ShadowPosition_portfolioId_status_idx" ON "ShadowPosition"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "ShadowPosition_assetId_status_idx" ON "ShadowPosition"("assetId", "status");

-- CreateIndex
CREATE INDEX "ShadowPosition_strategyVersionId_closedAt_idx" ON "ShadowPosition"("strategyVersionId", "closedAt");

-- CreateIndex
CREATE INDEX "ShadowPosition_status_openedAt_idx" ON "ShadowPosition"("status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowPositionEvent_eventKey_key" ON "ShadowPositionEvent"("eventKey");

-- CreateIndex
CREATE INDEX "ShadowPositionEvent_shadowPositionId_occurredAt_idx" ON "ShadowPositionEvent"("shadowPositionId", "occurredAt");

-- CreateIndex
CREATE INDEX "ShadowPositionEvent_type_occurredAt_idx" ON "ShadowPositionEvent"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowPositionEvent_shadowPositionId_sequence_key" ON "ShadowPositionEvent"("shadowPositionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ExitPlan_activePositionKey_key" ON "ExitPlan"("activePositionKey");

-- CreateIndex
CREATE INDEX "ExitPlan_status_maxHoldUntil_idx" ON "ExitPlan"("status", "maxHoldUntil");

-- CreateIndex
CREATE INDEX "ExitPlan_specificationHash_idx" ON "ExitPlan"("specificationHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExitPlan_shadowPositionId_version_key" ON "ExitPlan"("shadowPositionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_key_key" ON "Portfolio"("key");

-- CreateIndex
CREATE INDEX "Portfolio_status_idx" ON "Portfolio"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLedgerEntry_entryKey_key" ON "PortfolioLedgerEntry"("entryKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLedgerEntry_correctionOfId_key" ON "PortfolioLedgerEntry"("correctionOfId");

-- CreateIndex
CREATE INDEX "PortfolioLedgerEntry_portfolioId_occurredAt_idx" ON "PortfolioLedgerEntry"("portfolioId", "occurredAt");

-- CreateIndex
CREATE INDEX "PortfolioLedgerEntry_type_occurredAt_idx" ON "PortfolioLedgerEntry"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "PortfolioLedgerEntry_shadowOrderId_idx" ON "PortfolioLedgerEntry"("shadowOrderId");

-- CreateIndex
CREATE INDEX "PortfolioLedgerEntry_shadowFillId_idx" ON "PortfolioLedgerEntry"("shadowFillId");

-- CreateIndex
CREATE INDEX "PortfolioLedgerEntry_shadowPositionId_idx" ON "PortfolioLedgerEntry"("shadowPositionId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLedgerEntry_portfolioId_sequence_key" ON "PortfolioLedgerEntry"("portfolioId", "sequence");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_portfolioId_tradingDateUtc_idx" ON "PortfolioSnapshot"("portfolioId", "tradingDateUtc");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_asOf_idx" ON "PortfolioSnapshot"("asOf");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_portfolioId_asOf_sourceLedgerSequence_key" ON "PortfolioSnapshot"("portfolioId", "asOf", "sourceLedgerSequence");

-- CreateIndex
CREATE UNIQUE INDEX "TradingSession_sessionKey_key" ON "TradingSession"("sessionKey");

-- CreateIndex
CREATE UNIQUE INDEX "TradingSession_activePortfolioKey_key" ON "TradingSession"("activePortfolioKey");

-- CreateIndex
CREATE INDEX "TradingSession_portfolioId_status_idx" ON "TradingSession"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "TradingSession_status_idx" ON "TradingSession"("status");

-- CreateIndex
CREATE INDEX "TradingSession_heartbeatAt_idx" ON "TradingSession"("heartbeatAt");

-- CreateIndex
CREATE INDEX "StrategyPerformance_portfolioId_window_asOf_idx" ON "StrategyPerformance"("portfolioId", "window", "asOf");

-- CreateIndex
CREATE INDEX "StrategyPerformance_inputHash_idx" ON "StrategyPerformance"("inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyPerformance_strategyVersionId_portfolioId_window_as_key" ON "StrategyPerformance"("strategyVersionId", "portfolioId", "window", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "TradingAuditEvent_eventKey_key" ON "TradingAuditEvent"("eventKey");

-- CreateIndex
CREATE INDEX "TradingAuditEvent_aggregateType_aggregateId_occurredAt_idx" ON "TradingAuditEvent"("aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE INDEX "TradingAuditEvent_eventType_occurredAt_idx" ON "TradingAuditEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "TradingAuditEvent_correlationId_idx" ON "TradingAuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "TradingAuditEvent_causationId_idx" ON "TradingAuditEvent"("causationId");

-- CreateIndex
CREATE INDEX "TradingAuditEvent_idempotencyKey_idx" ON "TradingAuditEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TradingAuditEvent_occurredAt_idx" ON "TradingAuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "TradingJobCursor_jobKey_lastProcessedAt_idx" ON "TradingJobCursor"("jobKey", "lastProcessedAt");

-- CreateIndex
CREATE INDEX "TradingJobCursor_claimExpiresAt_idx" ON "TradingJobCursor"("claimExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradingJobCursor_jobKey_scopeKey_key" ON "TradingJobCursor"("jobKey", "scopeKey");

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssignment" ADD CONSTRAINT "StrategyAssignment_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssignment" ADD CONSTRAINT "StrategyAssignment_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssignment" ADD CONSTRAINT "StrategyAssignment_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssignment" ADD CONSTRAINT "StrategyAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentExecutionProfile" ADD CONSTRAINT "InstrumentExecutionProfile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidate" ADD CONSTRAINT "TradeCandidate_strategyAssignmentId_fkey" FOREIGN KEY ("strategyAssignmentId") REFERENCES "StrategyAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidate" ADD CONSTRAINT "TradeCandidate_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidate" ADD CONSTRAINT "TradeCandidate_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidate" ADD CONSTRAINT "TradeCandidate_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidate" ADD CONSTRAINT "TradeCandidate_anchorCandleId_fkey" FOREIGN KEY ("anchorCandleId") REFERENCES "Candle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidate" ADD CONSTRAINT "TradeCandidate_anchorSignalId_fkey" FOREIGN KEY ("anchorSignalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCandidateEvidence" ADD CONSTRAINT "TradeCandidateEvidence_tradeCandidateId_fkey" FOREIGN KEY ("tradeCandidateId") REFERENCES "TradeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDecision" ADD CONSTRAINT "TradeDecision_tradeCandidateId_fkey" FOREIGN KEY ("tradeCandidateId") REFERENCES "TradeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDecision" ADD CONSTRAINT "TradeDecision_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "RiskAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_tradeCandidateId_fkey" FOREIGN KEY ("tradeCandidateId") REFERENCES "TradeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_riskLimitSetId_fkey" FOREIGN KEY ("riskLimitSetId") REFERENCES "RiskLimitSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRuleResult" ADD CONSTRAINT "RiskRuleResult_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "RiskAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_tradeCandidateId_fkey" FOREIGN KEY ("tradeCandidateId") REFERENCES "TradeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_shadowOrderId_fkey" FOREIGN KEY ("shadowOrderId") REFERENCES "ShadowOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_shadowPositionId_fkey" FOREIGN KEY ("shadowPositionId") REFERENCES "ShadowPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_riskRuleResultId_fkey" FOREIGN KEY ("riskRuleResultId") REFERENCES "RiskRuleResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_tradeCandidateId_fkey" FOREIGN KEY ("tradeCandidateId") REFERENCES "TradeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_tradeDecisionId_fkey" FOREIGN KEY ("tradeDecisionId") REFERENCES "TradeDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_shadowPositionId_fkey" FOREIGN KEY ("shadowPositionId") REFERENCES "ShadowPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_executionProfileId_fkey" FOREIGN KEY ("executionProfileId") REFERENCES "InstrumentExecutionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowOrder" ADD CONSTRAINT "ShadowOrder_lastProcessedCandleId_fkey" FOREIGN KEY ("lastProcessedCandleId") REFERENCES "Candle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowFill" ADD CONSTRAINT "ShadowFill_shadowOrderId_fkey" FOREIGN KEY ("shadowOrderId") REFERENCES "ShadowOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowFill" ADD CONSTRAINT "ShadowFill_shadowPositionId_fkey" FOREIGN KEY ("shadowPositionId") REFERENCES "ShadowPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowFill" ADD CONSTRAINT "ShadowFill_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowFill" ADD CONSTRAINT "ShadowFill_sourceCandleId_fkey" FOREIGN KEY ("sourceCandleId") REFERENCES "Candle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPosition" ADD CONSTRAINT "ShadowPosition_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPosition" ADD CONSTRAINT "ShadowPosition_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPosition" ADD CONSTRAINT "ShadowPosition_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPosition" ADD CONSTRAINT "ShadowPosition_strategyAssignmentId_fkey" FOREIGN KEY ("strategyAssignmentId") REFERENCES "StrategyAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPosition" ADD CONSTRAINT "ShadowPosition_entryOrderId_fkey" FOREIGN KEY ("entryOrderId") REFERENCES "ShadowOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPosition" ADD CONSTRAINT "ShadowPosition_lastProcessedCandleId_fkey" FOREIGN KEY ("lastProcessedCandleId") REFERENCES "Candle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPositionEvent" ADD CONSTRAINT "ShadowPositionEvent_shadowPositionId_fkey" FOREIGN KEY ("shadowPositionId") REFERENCES "ShadowPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPositionEvent" ADD CONSTRAINT "ShadowPositionEvent_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "ShadowOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPositionEvent" ADD CONSTRAINT "ShadowPositionEvent_sourceFillId_fkey" FOREIGN KEY ("sourceFillId") REFERENCES "ShadowFill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowPositionEvent" ADD CONSTRAINT "ShadowPositionEvent_sourceCandleId_fkey" FOREIGN KEY ("sourceCandleId") REFERENCES "Candle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitPlan" ADD CONSTRAINT "ExitPlan_shadowPositionId_fkey" FOREIGN KEY ("shadowPositionId") REFERENCES "ShadowPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerEntry" ADD CONSTRAINT "PortfolioLedgerEntry_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerEntry" ADD CONSTRAINT "PortfolioLedgerEntry_shadowOrderId_fkey" FOREIGN KEY ("shadowOrderId") REFERENCES "ShadowOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerEntry" ADD CONSTRAINT "PortfolioLedgerEntry_shadowFillId_fkey" FOREIGN KEY ("shadowFillId") REFERENCES "ShadowFill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerEntry" ADD CONSTRAINT "PortfolioLedgerEntry_shadowPositionId_fkey" FOREIGN KEY ("shadowPositionId") REFERENCES "ShadowPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerEntry" ADD CONSTRAINT "PortfolioLedgerEntry_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "PortfolioLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyPerformance" ADD CONSTRAINT "StrategyPerformance_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyPerformance" ADD CONSTRAINT "StrategyPerformance_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyPerformance" ADD CONSTRAINT "StrategyPerformance_sourceThroughPositionEventId_fkey" FOREIGN KEY ("sourceThroughPositionEventId") REFERENCES "ShadowPositionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingAuditEvent" ADD CONSTRAINT "TradingAuditEvent_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingJobCursor" ADD CONSTRAINT "TradingJobCursor_lastCandleId_fkey" FOREIGN KEY ("lastCandleId") REFERENCES "Candle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

