-- CreateEnum
CREATE TYPE "BacktestRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BacktestOutcomeStatus" AS ENUM ('OPEN', 'EVALUATED', 'EXPIRED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BacktestOutcome" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'INVALIDATED', 'TARGET_REACHED');

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" "AssetType",
    "symbols" JSONB,
    "timeframes" JSONB NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "status" "BacktestRunStatus" NOT NULL,
    "configJson" JSONB NOT NULL,
    "summaryJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestSignal" (
    "id" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "timeframe" TEXT NOT NULL,
    "signalTime" TIMESTAMP(3) NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "status" "SignalStatus" NOT NULL,
    "direction" "SignalDirection" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "originalScore" DOUBLE PRECISION,
    "adjustedScore" DOUBLE PRECISION,
    "entryPrice" DECIMAL(30,12) NOT NULL,
    "targetPrice" DECIMAL(30,12),
    "invalidationPrice" DECIMAL(30,12),
    "outcome" "BacktestOutcome",
    "outcomeStatus" "BacktestOutcomeStatus" NOT NULL DEFAULT 'OPEN',
    "evaluatedAt" TIMESTAMP(3),
    "returnAfter1h" DOUBLE PRECISION,
    "returnAfter4h" DOUBLE PRECISION,
    "returnAfter1d" DOUBLE PRECISION,
    "returnAfter3d" DOUBLE PRECISION,
    "maxFavorableMove" DOUBLE PRECISION,
    "maxAdverseMove" DOUBLE PRECISION,
    "contextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacktestRun_status_idx" ON "BacktestRun"("status");

-- CreateIndex
CREATE INDEX "BacktestRun_startedAt_idx" ON "BacktestRun"("startedAt");

-- CreateIndex
CREATE INDEX "BacktestSignal_backtestRunId_idx" ON "BacktestSignal"("backtestRunId");

-- CreateIndex
CREATE INDEX "BacktestSignal_symbol_idx" ON "BacktestSignal"("symbol");

-- CreateIndex
CREATE INDEX "BacktestSignal_timeframe_idx" ON "BacktestSignal"("timeframe");

-- CreateIndex
CREATE INDEX "BacktestSignal_signalTime_idx" ON "BacktestSignal"("signalTime");

-- CreateIndex
CREATE INDEX "BacktestSignal_outcome_idx" ON "BacktestSignal"("outcome");

-- CreateIndex
CREATE INDEX "BacktestSignal_status_idx" ON "BacktestSignal"("status");

-- CreateIndex
CREATE INDEX "BacktestSignal_signalType_idx" ON "BacktestSignal"("signalType");

-- AddForeignKey
ALTER TABLE "BacktestSignal" ADD CONSTRAINT "BacktestSignal_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestSignal" ADD CONSTRAINT "BacktestSignal_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
