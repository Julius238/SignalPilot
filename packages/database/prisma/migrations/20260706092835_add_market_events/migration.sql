-- CreateEnum
CREATE TYPE "MarketEventType" AS ENUM ('MACRO', 'CENTRAL_BANK', 'INFLATION', 'LABOR_MARKET', 'RATES', 'GEOPOLITICAL', 'SANCTIONS', 'CONFLICT', 'ENERGY_COMMODITY', 'SUPPLY_CHAIN', 'CORPORATE', 'RISK_SENTIMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketEventSeverity" AS ENUM ('INFO', 'WATCH', 'IMPORTANT', 'CRITICAL');

-- CreateTable
CREATE TABLE "MarketEvent" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "eventType" "MarketEventType" NOT NULL,
    "severity" "MarketEventSeverity" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "region" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "affectedAssetClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedSectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "positiveImpact" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negativeImpact" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasoning" TEXT,
    "publishedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alertSentAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketEvent_dedupKey_key" ON "MarketEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "MarketEvent_eventType_detectedAt_idx" ON "MarketEvent"("eventType", "detectedAt");

-- CreateIndex
CREATE INDEX "MarketEvent_severity_detectedAt_idx" ON "MarketEvent"("severity", "detectedAt");

-- CreateIndex
CREATE INDEX "MarketEvent_detectedAt_idx" ON "MarketEvent"("detectedAt");

-- CreateIndex
CREATE INDEX "MarketEvent_publishedAt_idx" ON "MarketEvent"("publishedAt");
