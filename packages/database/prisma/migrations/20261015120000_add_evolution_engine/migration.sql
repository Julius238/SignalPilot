-- Evolution Engine V1 (docs/trading/20-evolution-engine.md, ADR 0016).
-- Purely additive: new Evolution* enums and tables only. No existing table,
-- column, index or constraint is touched, and no foreign key points from or
-- to a trading, portfolio or arena table.

-- CreateEnum
CREATE TYPE "EvolutionAgentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'PAUSED_BUDGET', 'DISABLED');

-- CreateEnum
CREATE TYPE "EvolutionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "EvolutionCandidateStatus" AS ENUM ('GENERATED', 'INVALID', 'DUPLICATE', 'TECHNICAL_FAILED', 'REJECTED', 'RESERVE', 'PROPOSED', 'APPROVED_FOR_FORWARD_TEST', 'REJECTED_BY_OPERATOR');

-- CreateEnum
CREATE TYPE "EvolutionAiCallStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUSED', 'BLOCKED_BUDGET');

-- CreateTable
CREATE TABLE "EvolutionAgentState" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "EvolutionAgentStatus" NOT NULL DEFAULT 'PAUSED',
    "statusReason" TEXT,
    "pausedUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionAgentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionRun" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "EvolutionRunStatus" NOT NULL,
    "providerName" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "splitKey" TEXT NOT NULL,
    "splitHash" TEXT NOT NULL,
    "dataManifestJson" JSONB NOT NULL,
    "contextHash" TEXT,
    "analysisJson" JSONB,
    "aiSummary" TEXT,
    "reviewJson" JSONB,
    "reportMarkdown" TEXT,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "hypothesesRequested" INTEGER NOT NULL DEFAULT 0,
    "candidatesGenerated" INTEGER NOT NULL DEFAULT 0,
    "candidatesRejected" INTEGER NOT NULL DEFAULT 0,
    "candidatesProposed" INTEGER NOT NULL DEFAULT 0,
    "aiInputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiCacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "aiCacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "aiCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "backtestCount" INTEGER NOT NULL DEFAULT 0,
    "backtestMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionAiCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "task" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "servedModel" TEXT,
    "status" "EvolutionAiCallStatus" NOT NULL,
    "billable" BOOLEAN NOT NULL,
    "budgetMonth" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "requestHash" TEXT NOT NULL,
    "promptChars" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "worstCaseUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "usageJson" JSONB NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "requestId" TEXT,
    "errorKind" TEXT,
    "errorMessage" TEXT,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionAiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionHypothesis" (
    "id" TEXT NOT NULL,
    "hypothesisKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "aiCallId" TEXT,
    "title" TEXT NOT NULL,
    "marketObservation" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "expectedEffect" TEXT NOT NULL,
    "falsificationCriterion" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "parentKey" TEXT NOT NULL,
    "changesJson" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "outcomeReasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionCandidate" (
    "id" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "parentKey" TEXT NOT NULL,
    "parentCandidateId" TEXT,
    "rootStrategyKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "genomeJson" JSONB NOT NULL,
    "genomeHash" TEXT NOT NULL,
    "changesJson" JSONB NOT NULL,
    "status" "EvolutionCandidateStatus" NOT NULL,
    "statusReasons" TEXT[],
    "technicalJson" JSONB,
    "gatesJson" JSONB,
    "metricsJson" JSONB,
    "scoreJson" JSONB,
    "researchScore" DECIMAL(8,2),
    "evidenceGrade" TEXT,
    "windowsSeen" TEXT[],
    "holdoutEvaluated" BOOLEAN NOT NULL DEFAULT false,
    "reportMarkdown" TEXT,
    "proposedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionBacktest" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "candidateId" TEXT,
    "role" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "replayEngineVersion" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "dataFingerprint" TEXT NOT NULL,
    "costModel" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "outputHash" TEXT NOT NULL,
    "invariantViolations" INTEGER NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionBacktest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionDataExposure" (
    "id" TEXT NOT NULL,
    "exposureKey" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "candidateId" TEXT,
    "runId" TEXT,
    "symbol" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionDataExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionAuditEvent" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "previousHash" TEXT,
    "hash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionAgentState_key_key" ON "EvolutionAgentState"("key");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionRun_runKey_key" ON "EvolutionRun"("runKey");

-- CreateIndex
CREATE INDEX "EvolutionRun_startedAt_idx" ON "EvolutionRun"("startedAt");

-- CreateIndex
CREATE INDEX "EvolutionRun_status_startedAt_idx" ON "EvolutionRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "EvolutionAiCall_budgetMonth_billable_idx" ON "EvolutionAiCall"("budgetMonth", "billable");

-- CreateIndex
CREATE INDEX "EvolutionAiCall_runId_idx" ON "EvolutionAiCall"("runId");

-- CreateIndex
CREATE INDEX "EvolutionAiCall_createdAt_idx" ON "EvolutionAiCall"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionHypothesis_hypothesisKey_key" ON "EvolutionHypothesis"("hypothesisKey");

-- CreateIndex
CREATE INDEX "EvolutionHypothesis_runId_idx" ON "EvolutionHypothesis"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionCandidate_candidateKey_key" ON "EvolutionCandidate"("candidateKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionCandidate_hypothesisId_key" ON "EvolutionCandidate"("hypothesisId");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionCandidate_genomeHash_key" ON "EvolutionCandidate"("genomeHash");

-- CreateIndex
CREATE INDEX "EvolutionCandidate_status_createdAt_idx" ON "EvolutionCandidate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EvolutionCandidate_runId_idx" ON "EvolutionCandidate"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionCandidate_family_sequence_key" ON "EvolutionCandidate"("family", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionBacktest_cacheKey_key" ON "EvolutionBacktest"("cacheKey");

-- CreateIndex
CREATE INDEX "EvolutionBacktest_subjectKey_windowKey_idx" ON "EvolutionBacktest"("subjectKey", "windowKey");

-- CreateIndex
CREATE INDEX "EvolutionBacktest_candidateId_idx" ON "EvolutionBacktest"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionDataExposure_exposureKey_key" ON "EvolutionDataExposure"("exposureKey");

-- CreateIndex
CREATE INDEX "EvolutionDataExposure_windowKey_purpose_idx" ON "EvolutionDataExposure"("windowKey", "purpose");

-- CreateIndex
CREATE INDEX "EvolutionDataExposure_subjectKey_idx" ON "EvolutionDataExposure"("subjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionAuditEvent_sequence_key" ON "EvolutionAuditEvent"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionAuditEvent_eventKey_key" ON "EvolutionAuditEvent"("eventKey");

-- CreateIndex
CREATE INDEX "EvolutionAuditEvent_aggregateType_aggregateId_occurredAt_idx" ON "EvolutionAuditEvent"("aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE INDEX "EvolutionAuditEvent_eventType_occurredAt_idx" ON "EvolutionAuditEvent"("eventType", "occurredAt");

-- AddForeignKey
ALTER TABLE "EvolutionAiCall" ADD CONSTRAINT "EvolutionAiCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvolutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionHypothesis" ADD CONSTRAINT "EvolutionHypothesis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvolutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionCandidate" ADD CONSTRAINT "EvolutionCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvolutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionCandidate" ADD CONSTRAINT "EvolutionCandidate_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "EvolutionHypothesis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionCandidate" ADD CONSTRAINT "EvolutionCandidate_parentCandidateId_fkey" FOREIGN KEY ("parentCandidateId") REFERENCES "EvolutionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionBacktest" ADD CONSTRAINT "EvolutionBacktest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "EvolutionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

