-- CreateTable
CREATE TABLE "ShadowReplayRun" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "regimePolicy" TEXT NOT NULL,
    "costProfile" TEXT NOT NULL,
    "dataOrigin" TEXT NOT NULL,
    "isSynthetic" BOOLEAN NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "firstAnchorAt" TIMESTAMP(3),
    "lastAnchorAt" TIMESTAMP(3),
    "cycles" INTEGER NOT NULL,
    "candidates" INTEGER NOT NULL,
    "closedTrades" INTEGER NOT NULL,
    "startingCash" DECIMAL(30,12) NOT NULL,
    "finalEquity" DECIMAL(30,12) NOT NULL,
    "outputHash" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "configJson" JSONB NOT NULL,
    "funnelJson" JSONB NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "tradesJson" JSONB NOT NULL,
    "equityCurveJson" JSONB NOT NULL,
    "notesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowReplayRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShadowReplayRun_createdAt_idx" ON "ShadowReplayRun"("createdAt");

-- CreateIndex
CREATE INDEX "ShadowReplayRun_symbol_mode_idx" ON "ShadowReplayRun"("symbol", "mode");

