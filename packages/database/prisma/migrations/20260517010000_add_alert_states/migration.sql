CREATE TABLE "AlertState" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "status" "SignalStatus" NOT NULL,
    "direction" "SignalDirection" NOT NULL,
    "lastSignalId" TEXT,
    "lastAlertId" TEXT,
    "lastScore" DOUBLE PRECISION NOT NULL,
    "lastRiskLevel" "RiskLevel" NOT NULL,
    "lastAlignment" TEXT,
    "lastAlignmentScore" DOUBLE PRECISION,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertState_assetId_timeframe_signalType_status_key" ON "AlertState"("assetId", "timeframe", "signalType", "status");
CREATE INDEX "AlertState_symbol_idx" ON "AlertState"("symbol");
CREATE INDEX "AlertState_lastSentAt_idx" ON "AlertState"("lastSentAt");
CREATE INDEX "AlertState_status_idx" ON "AlertState"("status");
