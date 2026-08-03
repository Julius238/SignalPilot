-- Work package 8: shadow performance snapshots, alert outbox.
--
-- Specification: P8 task, "2. Persistenz" and "4. Alert-Outbox".
--
-- Additive by design: no column and no row is dropped anywhere, and no
-- business trading table (TradeCandidate, RiskAssessment, ShadowOrder,
-- ShadowFill, ShadowPosition, PortfolioLedgerEntry, PortfolioSnapshot,
-- TradingAuditEvent) is touched at all.
--
-- Two deliberate exceptions to "purely additive", both required and both
-- widening rather than narrowing:
--
--   1. StrategyPerformance."strategyVersionId" drops its NOT NULL. A segment
--      by asset, market regime or exit reason aggregates across strategy
--      versions and has no single version to point at. Dropping NOT NULL
--      never invalidates an existing row.
--   2. The unique index (strategyVersionId, portfolioId, window, asOf) is
--      replaced by a unique "snapshotKey". The old key cannot hold once one
--      window carries several segments, and re-running a changed engine
--      version must create a new row instead of overwriting a historical
--      result (P8: "Keine historischen Ergebnisse überschreiben, wenn sich
--      Berechnungslogik oder Version ändert"). Existing rows keep their data
--      and are backfilled with their own id as snapshotKey, which is unique
--      by construction.

-- ── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "StrategyPerformanceSegment" AS ENUM (
  'OVERALL',
  'STRATEGY_VERSION',
  'ASSET',
  'MARKET_REGIME',
  'EXIT_REASON'
);

CREATE TYPE "TradingAlertOutboxStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'DEAD'
);

CREATE TYPE "TradingAlertEventType" AS ENUM (
  'SESSION_ERROR_LOCKED',
  'KILL_SWITCH_ENGAGED',
  'RECONCILIATION_FAILED',
  'CRITICAL_RISK_EVENT',
  'POSITION_WITHOUT_SAFE_EXIT',
  'CIRCUIT_BREAKER_OPEN',
  'WORKER_HEARTBEAT_STALE',
  'POSITION_MONITOR_STALE',
  'DAILY_LOSS_LIMIT_REACHED',
  'PORTFOLIO_LEDGER_CONFLICT'
);

-- ── StrategyPerformance ────────────────────────────────────────────────────

ALTER TABLE "StrategyPerformance"
  ADD COLUMN "snapshotKey" TEXT,
  ADD COLUMN "segmentType" "StrategyPerformanceSegment" NOT NULL DEFAULT 'OVERALL',
  ADD COLUMN "segmentKey" TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN "segmentLabel" TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN "winRatePct" DECIMAL(30,12),
  ADD COLUMN "grossProfit" DECIMAL(30,12) NOT NULL DEFAULT 0,
  ADD COLUMN "grossLoss" DECIMAL(30,12) NOT NULL DEFAULT 0,
  ADD COLUMN "simulatedExecutionCost" DECIMAL(30,12) NOT NULL DEFAULT 0,
  ADD COLUMN "averageWin" DECIMAL(30,12),
  ADD COLUMN "averageLoss" DECIMAL(30,12),
  ADD COLUMN "cumulativeR" DECIMAL(30,12),
  ADD COLUMN "tradesWithPlannedRisk" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxWinStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxLossStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxDrawdownAmount" DECIMAL(30,12),
  ADD COLUMN "recoveryFactor" DECIMAL(30,12),
  ADD COLUMN "exposureMinutes" DECIMAL(30,12) NOT NULL DEFAULT 0,
  ADD COLUMN "exposurePct" DECIMAL(30,12),
  ADD COLUMN "averageMaePct" DECIMAL(30,12),
  ADD COLUMN "averageMfePct" DECIMAL(30,12),
  ADD COLUMN "sharpeRatio" DECIMAL(30,12),
  ADD COLUMN "sortinoRatio" DECIMAL(30,12),
  ADD COLUMN "returnObservations" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "assessedCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "riskRejectedCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invalidCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expiredCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "riskRejectionRatePct" DECIMAL(30,12),
  ADD COLUMN "metricsJson" JSONB,
  ADD COLUMN "engineVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "codeVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "dataThroughAt" TIMESTAMP(3),
  ADD COLUMN "computedAt" TIMESTAMP(3),
  ADD COLUMN "outputHash" TEXT NOT NULL DEFAULT '';

-- Existing rows predate segmentation and carry no engine identity; their own
-- primary key is a unique, stable snapshot key.
UPDATE "StrategyPerformance" SET "snapshotKey" = "id" WHERE "snapshotKey" IS NULL;

ALTER TABLE "StrategyPerformance" ALTER COLUMN "snapshotKey" SET NOT NULL;
ALTER TABLE "StrategyPerformance" ALTER COLUMN "strategyVersionId" DROP NOT NULL;

DROP INDEX IF EXISTS "StrategyPerformance_strategyVersionId_portfolioId_window_as_key";

CREATE UNIQUE INDEX "StrategyPerformance_snapshotKey_key" ON "StrategyPerformance"("snapshotKey");
CREATE INDEX "StrategyPerformance_portfolioId_segmentType_segmentKey_asOf_idx"
  ON "StrategyPerformance"("portfolioId", "segmentType", "segmentKey", "asOf");
CREATE INDEX "StrategyPerformance_strategyVersionId_window_asOf_idx"
  ON "StrategyPerformance"("strategyVersionId", "window", "asOf");
CREATE INDEX "StrategyPerformance_outputHash_idx" ON "StrategyPerformance"("outputHash");
CREATE INDEX "StrategyPerformance_engineVersion_asOf_idx" ON "StrategyPerformance"("engineVersion", "asOf");

-- ── Alert outbox ───────────────────────────────────────────────────────────

CREATE TABLE "TradingAlertOutbox" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "eventType" "TradingAlertEventType" NOT NULL,
  "severity" "RiskSeverity" NOT NULL,
  "status" "TradingAlertOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "portfolioId" TEXT,
  "tradingSessionId" TEXT,
  "reasonCode" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "claimedBy" TEXT,
  "claimedAt" TIMESTAMP(3),
  "claimExpiresAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "alertId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TradingAlertOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradingAlertOutbox_idempotencyKey_key" ON "TradingAlertOutbox"("idempotencyKey");
CREATE INDEX "TradingAlertOutbox_status_nextAttemptAt_idx" ON "TradingAlertOutbox"("status", "nextAttemptAt");
CREATE INDEX "TradingAlertOutbox_severity_createdAt_idx" ON "TradingAlertOutbox"("severity", "createdAt");
CREATE INDEX "TradingAlertOutbox_eventType_createdAt_idx" ON "TradingAlertOutbox"("eventType", "createdAt");
CREATE INDEX "TradingAlertOutbox_portfolioId_createdAt_idx" ON "TradingAlertOutbox"("portfolioId", "createdAt");
CREATE INDEX "TradingAlertOutbox_claimExpiresAt_idx" ON "TradingAlertOutbox"("claimExpiresAt");

CREATE TABLE "TradingAlertOutboxAttempt" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "TradingAlertOutboxStatus" NOT NULL,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TradingAlertOutboxAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradingAlertOutboxAttempt_outboxId_attempt_key"
  ON "TradingAlertOutboxAttempt"("outboxId", "attempt");
CREATE INDEX "TradingAlertOutboxAttempt_outboxId_createdAt_idx"
  ON "TradingAlertOutboxAttempt"("outboxId", "createdAt");
CREATE INDEX "TradingAlertOutboxAttempt_status_createdAt_idx"
  ON "TradingAlertOutboxAttempt"("status", "createdAt");

-- Attempts are the one alert-related row that retention may prune, so they
-- cascade with their parent rather than blocking its deletion.
ALTER TABLE "TradingAlertOutboxAttempt"
  ADD CONSTRAINT "TradingAlertOutboxAttempt_outboxId_fkey"
  FOREIGN KEY ("outboxId") REFERENCES "TradingAlertOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
