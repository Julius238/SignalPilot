-- Persist one resumable candle-quality record per asset/provider/timeframe.
CREATE TABLE "CandleDataQuality" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "oldestCandle" TIMESTAMP(3),
    "latestClosedCandle" TIMESTAMP(3),
    "candleCount" INTEGER NOT NULL DEFAULT 0,
    "expectedCandleCount" INTEGER NOT NULL DEFAULT 0,
    "gapCount" INTEGER NOT NULL DEFAULT 0,
    "missingCandleCount" INTEGER NOT NULL DEFAULT 0,
    "latestDataAgeSeconds" INTEGER,
    "providerErrorCount" INTEGER NOT NULL DEFAULT 0,
    "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
    "entitlementErrorCount" INTEGER NOT NULL DEFAULT 0,
    "noDataCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessfulFetchAt" TIMESTAMP(3),
    "lastAuditAt" TIMESTAMP(3),
    "lastErrorKind" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "backfillStart" TIMESTAMP(3),
    "backfillEnd" TIMESTAMP(3),
    "backfillCursor" TIMESTAMP(3),
    "backfillStatus" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandleDataQuality_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandleDataQuality_assetId_provider_timeframe_key"
ON "CandleDataQuality"("assetId", "provider", "timeframe");
CREATE INDEX "CandleDataQuality_provider_timeframe_idx"
ON "CandleDataQuality"("provider", "timeframe");
CREATE INDEX "CandleDataQuality_lastAuditAt_idx"
ON "CandleDataQuality"("lastAuditAt");
CREATE INDEX "CandleDataQuality_lastErrorKind_lastErrorAt_idx"
ON "CandleDataQuality"("lastErrorKind", "lastErrorAt");

ALTER TABLE "CandleDataQuality"
ADD CONSTRAINT "CandleDataQuality_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep existing news rows. Future rows use asset-scoped fingerprints so the same
-- canonical URL can be linked to multiple affected assets.
DROP INDEX IF EXISTS "NewsItem_url_key";
ALTER TABLE "NewsItem" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "transportProvider" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "NewsItem" ADD COLUMN "dashboardOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "NewsItem_assetId_dedupeKey_key"
ON "NewsItem"("assetId", "dedupeKey");
CREATE INDEX "NewsItem_transportProvider_publishedAt_idx"
ON "NewsItem"("transportProvider", "publishedAt");
CREATE INDEX "NewsItem_relevanceScore_publishedAt_idx"
ON "NewsItem"("relevanceScore", "publishedAt");
