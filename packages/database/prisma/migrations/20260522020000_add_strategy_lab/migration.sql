CREATE TYPE "StrategyComparisonStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StrategyComparisonRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StrategyComparisonStatus" NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "symbols" JSONB,
    "assetType" "AssetType",
    "timeframes" JSONB NOT NULL,
    "configJson" JSONB NOT NULL,
    "summaryJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyComparisonRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StrategyBacktestResult" (
    "id" TEXT NOT NULL,
    "comparisonRunId" TEXT NOT NULL,
    "strategyConfigId" TEXT NOT NULL,
    "backtestRunId" TEXT,
    "totalSignals" INTEGER NOT NULL,
    "evaluatedCount" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION,
    "avgReturnAfter1d" DOUBLE PRECISION,
    "targetReachedCount" INTEGER NOT NULL,
    "invalidatedCount" INTEGER NOT NULL,
    "positiveCount" INTEGER NOT NULL,
    "negativeCount" INTEGER NOT NULL,
    "neutralCount" INTEGER NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyBacktestResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StrategyConfig_name_idx" ON "StrategyConfig"("name");
CREATE INDEX "StrategyComparisonRun_status_idx" ON "StrategyComparisonRun"("status");
CREATE INDEX "StrategyComparisonRun_startedAt_idx" ON "StrategyComparisonRun"("startedAt");
CREATE INDEX "StrategyBacktestResult_comparisonRunId_idx" ON "StrategyBacktestResult"("comparisonRunId");
CREATE INDEX "StrategyBacktestResult_strategyConfigId_idx" ON "StrategyBacktestResult"("strategyConfigId");
CREATE INDEX "StrategyBacktestResult_rank_idx" ON "StrategyBacktestResult"("rank");

ALTER TABLE "StrategyBacktestResult" ADD CONSTRAINT "StrategyBacktestResult_comparisonRunId_fkey" FOREIGN KEY ("comparisonRunId") REFERENCES "StrategyComparisonRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategyBacktestResult" ADD CONSTRAINT "StrategyBacktestResult_strategyConfigId_fkey" FOREIGN KEY ("strategyConfigId") REFERENCES "StrategyConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategyBacktestResult" ADD CONSTRAINT "StrategyBacktestResult_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
