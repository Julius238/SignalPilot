-- CreateEnum
CREATE TYPE "RadarEventType" AS ENUM ('MOVEMENT_SPIKE', 'VOLUME_SPIKE', 'VOLATILITY_SPIKE', 'SCORE_CHANGE', 'REGIME_CHANGE');

-- CreateEnum
CREATE TYPE "RadarEventSeverity" AS ENUM ('INFO', 'WATCH', 'IMPORTANT', 'CRITICAL');

-- CreateTable
CREATE TABLE "RadarEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "symbol" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "eventType" "RadarEventType" NOT NULL,
    "severity" "RadarEventSeverity" NOT NULL,
    "timeframe" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "movePercent" DOUBLE PRECISION,
    "relativeVolume" DOUBLE PRECISION,
    "rangePercent" DOUBLE PRECISION,
    "shortMessage" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadarEvent_symbol_createdAt_idx" ON "RadarEvent"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "RadarEvent_assetType_createdAt_idx" ON "RadarEvent"("assetType", "createdAt");

-- CreateIndex
CREATE INDEX "RadarEvent_eventType_createdAt_idx" ON "RadarEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "RadarEvent_severity_createdAt_idx" ON "RadarEvent"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "RadarEvent_createdAt_idx" ON "RadarEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "RadarEvent" ADD CONSTRAINT "RadarEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
