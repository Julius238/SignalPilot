-- Dynamic discovery is additive. Existing assets, watchlists, signals and alert settings are retained.
CREATE TYPE "AssetUniverseRole" AS ENUM ('CORE', 'DISCOVERY', 'ACTIVE', 'INACTIVE');
CREATE TYPE "AssetUniverseSource" AS ENUM ('CORE', 'PINNED', 'AUTO_DISCOVERED', 'MANUAL', 'EXCLUDED', 'INACTIVE');
CREATE TYPE "AssetDiscoveryRunKind" AS ENUM ('UNIVERSE_REFRESH', 'DISCOVERY_SCAN', 'ACTIVE_SELECTION', 'RECONCILIATION', 'FULL_PIPELINE');
CREATE TYPE "AssetDiscoveryCandidateStatus" AS ENUM ('ELIGIBLE', 'EXCLUDED', 'SELECTED', 'RETAINED', 'REMOVED', 'ERROR');
CREATE TYPE "AssetDiscoveryAction" AS ENUM ('ADD', 'REMOVE', 'KEEP', 'NONE');

ALTER TABLE "Asset"
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "sector" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerSymbol" TEXT,
  ADD COLUMN "providerMetadataJson" JSONB,
  ADD COLUMN "instrumentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "isTradable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isLeveraged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isInverse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isStablecoin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastUniverseRefreshAt" TIMESTAMP(3);

CREATE TABLE "AssetUniversePreference" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "isExcluded" BOOLEAN NOT NULL DEFAULT false,
  "manualActive" BOOLEAN NOT NULL DEFAULT false,
  "observeOnly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetUniversePreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetDiscoveryRun" (
  "id" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "kind" "AssetDiscoveryRunKind" NOT NULL,
  "status" "BotRunStatus" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "policyVersion" TEXT NOT NULL,
  "checkedAssetCount" INTEGER NOT NULL DEFAULT 0,
  "excludedAssetCount" INTEGER NOT NULL DEFAULT 0,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "proposedAdditionCount" INTEGER NOT NULL DEFAULT 0,
  "proposedRemovalCount" INTEGER NOT NULL DEFAULT 0,
  "activatedCount" INTEGER NOT NULL DEFAULT 0,
  "deactivatedCount" INTEGER NOT NULL DEFAULT 0,
  "providerRequestCount" INTEGER NOT NULL DEFAULT 0,
  "estimatedApiUnits" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "exclusionReasonsJson" JSONB,
  "metricsJson" JSONB,
  "errorJson" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetDiscoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetUniverseMembership" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "role" "AssetUniverseRole" NOT NULL,
  "source" "AssetUniverseSource" NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "discoveryRunId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "deactivatedAt" TIMESTAMP(3),
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" TIMESTAMP(3),
  "cooldownUntil" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetUniverseMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetDiscoveryCandidate" (
  "id" TEXT NOT NULL,
  "discoveryRunId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "status" "AssetDiscoveryCandidateStatus" NOT NULL,
  "proposedAction" "AssetDiscoveryAction" NOT NULL DEFAULT 'NONE',
  "score" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "dataQuality" DOUBLE PRECISION NOT NULL,
  "liquidity" DOUBLE PRECISION NOT NULL,
  "rank" INTEGER,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "reasonsJson" JSONB NOT NULL,
  "exclusionReasonsJson" JSONB NOT NULL,
  "metricsJson" JSONB,
  "providerMetadataJson" JSONB,
  "subsequentReturn1d" DOUBLE PRECISION,
  "subsequentReturn7d" DOUBLE PRECISION,
  "subsequentReturn30d" DOUBLE PRECISION,
  "evaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetDiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryScoreSnapshot" (
  "id" TEXT NOT NULL,
  "discoveryRunId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "rawScore" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "dataQuality" DOUBLE PRECISION NOT NULL,
  "liquidity" DOUBLE PRECISION NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "componentsJson" JSONB NOT NULL,
  "weightsJson" JSONB NOT NULL,
  "metricsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoveryScoreSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetUniversePreference_assetId_key" ON "AssetUniversePreference"("assetId");
CREATE INDEX "AssetUniversePreference_isPinned_idx" ON "AssetUniversePreference"("isPinned");
CREATE INDEX "AssetUniversePreference_isExcluded_idx" ON "AssetUniversePreference"("isExcluded");
CREATE INDEX "AssetUniversePreference_manualActive_idx" ON "AssetUniversePreference"("manualActive");
CREATE UNIQUE INDEX "AssetDiscoveryRun_runKey_key" ON "AssetDiscoveryRun"("runKey");
CREATE INDEX "AssetDiscoveryRun_kind_startedAt_idx" ON "AssetDiscoveryRun"("kind", "startedAt");
CREATE INDEX "AssetDiscoveryRun_status_startedAt_idx" ON "AssetDiscoveryRun"("status", "startedAt");
CREATE INDEX "AssetDiscoveryRun_policyVersion_idx" ON "AssetDiscoveryRun"("policyVersion");
CREATE INDEX "AssetUniverseMembership_assetId_isCurrent_idx" ON "AssetUniverseMembership"("assetId", "isCurrent");
CREATE UNIQUE INDEX "AssetUniverseMembership_one_current_per_asset_key"
  ON "AssetUniverseMembership"("assetId") WHERE "isCurrent" = true;
CREATE INDEX "AssetUniverseMembership_role_isCurrent_idx" ON "AssetUniverseMembership"("role", "isCurrent");
CREATE INDEX "AssetUniverseMembership_source_isCurrent_idx" ON "AssetUniverseMembership"("source", "isCurrent");
CREATE INDEX "AssetUniverseMembership_cooldownUntil_idx" ON "AssetUniverseMembership"("cooldownUntil");
CREATE INDEX "AssetUniverseMembership_discoveryRunId_idx" ON "AssetUniverseMembership"("discoveryRunId");
CREATE UNIQUE INDEX "AssetDiscoveryCandidate_discoveryRunId_assetId_key" ON "AssetDiscoveryCandidate"("discoveryRunId", "assetId");
CREATE INDEX "AssetDiscoveryCandidate_status_score_idx" ON "AssetDiscoveryCandidate"("status", "score");
CREATE INDEX "AssetDiscoveryCandidate_assetId_createdAt_idx" ON "AssetDiscoveryCandidate"("assetId", "createdAt");
CREATE INDEX "AssetDiscoveryCandidate_proposedAction_createdAt_idx" ON "AssetDiscoveryCandidate"("proposedAction", "createdAt");
CREATE UNIQUE INDEX "DiscoveryScoreSnapshot_candidateId_key" ON "DiscoveryScoreSnapshot"("candidateId");
CREATE INDEX "DiscoveryScoreSnapshot_assetId_createdAt_idx" ON "DiscoveryScoreSnapshot"("assetId", "createdAt");
CREATE INDEX "DiscoveryScoreSnapshot_discoveryRunId_score_idx" ON "DiscoveryScoreSnapshot"("discoveryRunId", "score");
CREATE INDEX "DiscoveryScoreSnapshot_policyVersion_idx" ON "DiscoveryScoreSnapshot"("policyVersion");
CREATE INDEX "Asset_provider_providerSymbol_idx" ON "Asset"("provider", "providerSymbol");
CREATE INDEX "Asset_instrumentStatus_isTradable_idx" ON "Asset"("instrumentStatus", "isTradable");

ALTER TABLE "AssetUniversePreference"
  ADD CONSTRAINT "AssetUniversePreference_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetUniverseMembership"
  ADD CONSTRAINT "AssetUniverseMembership_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetUniverseMembership"
  ADD CONSTRAINT "AssetUniverseMembership_discoveryRunId_fkey"
  FOREIGN KEY ("discoveryRunId") REFERENCES "AssetDiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetDiscoveryCandidate"
  ADD CONSTRAINT "AssetDiscoveryCandidate_discoveryRunId_fkey"
  FOREIGN KEY ("discoveryRunId") REFERENCES "AssetDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetDiscoveryCandidate"
  ADD CONSTRAINT "AssetDiscoveryCandidate_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryScoreSnapshot"
  ADD CONSTRAINT "DiscoveryScoreSnapshot_discoveryRunId_fkey"
  FOREIGN KEY ("discoveryRunId") REFERENCES "AssetDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryScoreSnapshot"
  ADD CONSTRAINT "DiscoveryScoreSnapshot_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "AssetDiscoveryCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryScoreSnapshot"
  ADD CONSTRAINT "DiscoveryScoreSnapshot_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve all previous automatic-analysis behavior. Benchmarks become protected CORE;
-- every other currently active seed is recorded as MANUAL and therefore is not removable.
INSERT INTO "AssetUniversePreference" (
  "id", "assetId", "manualActive", "createdAt", "updatedAt"
)
SELECT
  'pref_' || "id",
  "id",
  CASE WHEN "symbol" IN ('SPY', 'QQQ', 'IWM', 'BTCUSDT', 'ETHUSDT') THEN false ELSE true END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Asset";

INSERT INTO "AssetUniverseMembership" (
  "id", "assetId", "role", "source", "isCurrent", "reason", "policyVersion",
  "activatedAt", "validFrom", "createdAt", "updatedAt"
)
SELECT
  'membership_' || "id",
  "id",
  CASE
    WHEN "symbol" IN ('SPY', 'QQQ', 'IWM', 'BTCUSDT', 'ETHUSDT') THEN 'CORE'::"AssetUniverseRole"
    WHEN "isActive" = true THEN 'ACTIVE'::"AssetUniverseRole"
    ELSE 'INACTIVE'::"AssetUniverseRole"
  END,
  CASE
    WHEN "symbol" IN ('SPY', 'QQQ', 'IWM', 'BTCUSDT', 'ETHUSDT') THEN 'CORE'::"AssetUniverseSource"
    WHEN "isActive" = true THEN 'MANUAL'::"AssetUniverseSource"
    ELSE 'INACTIVE'::"AssetUniverseSource"
  END,
  true,
  'MIGRATED_EXISTING_ASSET',
  'discovery-v1.0.0',
  CASE WHEN "isActive" = true THEN CURRENT_TIMESTAMP ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Asset";
