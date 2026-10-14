-- CreateEnum
CREATE TYPE "ArenaParticipantStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'PROBATION', 'PROVEN', 'CHAMPION', 'RETIRED');

-- CreateEnum
CREATE TYPE "ArenaEvidenceStatus" AS ENUM ('PROVISIONAL', 'SUFFICIENT');

-- CreateEnum
CREATE TYPE "ArenaRecommendation" AS ENUM ('HOLD', 'PROBATION', 'RETIRE', 'REINSTATE', 'PROMOTE_PROVEN', 'PROMOTE_CHAMPION', 'DEMOTE_CHAMPION');

-- CreateEnum
CREATE TYPE "ArenaPostMortemStatus" AS ENUM ('OPEN', 'HYPOTHESIS_RECORDED', 'SUCCESSOR_REGISTERED', 'CLOSED');

-- CreateTable
CREATE TABLE "ArenaCohort" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "policyVersion" TEXT NOT NULL,
    "policyJson" JSONB NOT NULL,
    "policyHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaParticipant" (
    "id" TEXT NOT NULL,
    "participantKey" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "specificationHash" TEXT NOT NULL,
    "status" "ArenaParticipantStatus" NOT NULL,
    "initialCapital" DECIMAL(30,12) NOT NULL,
    "forwardStartAt" TIMESTAMP(3),
    "parentParticipantId" TEXT,
    "registeredBy" TEXT NOT NULL,
    "statusChangedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaParticipantEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" "ArenaParticipantStatus",
    "toStatus" "ArenaParticipantStatus" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "actorType" "TradingActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArenaParticipantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaEvaluation" (
    "id" TEXT NOT NULL,
    "evaluationKey" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "status" "ArenaParticipantStatus" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "evidenceStatus" "ArenaEvidenceStatus" NOT NULL,
    "evidenceProgress" DECIMAL(30,12) NOT NULL,
    "forwardDays" DECIMAL(30,12) NOT NULL,
    "closedTrades" INTEGER NOT NULL,
    "initialCapital" DECIMAL(30,12) NOT NULL,
    "equity" DECIMAL(30,12) NOT NULL,
    "netPnl" DECIMAL(30,12) NOT NULL,
    "returnPct" DECIMAL(30,12) NOT NULL,
    "logGrowth" DECIMAL(30,12),
    "maxDrawdownPct" DECIMAL(30,12) NOT NULL,
    "profitFactor" DECIMAL(30,12),
    "averageR" DECIMAL(30,12),
    "winRatePct" DECIMAL(30,12),
    "maxLossStreak" INTEGER NOT NULL,
    "costs" DECIMAL(30,12) NOT NULL,
    "exposurePct" DECIMAL(30,12),
    "rawFitness" DECIMAL(30,12) NOT NULL,
    "fitness" DECIMAL(30,12) NOT NULL,
    "rank" INTEGER,
    "survivalFloorBreached" BOOLEAN NOT NULL,
    "hardStop" BOOLEAN NOT NULL,
    "recommendation" "ArenaRecommendation" NOT NULL,
    "recommendedStatus" "ArenaParticipantStatus",
    "reasonCodes" TEXT[],
    "componentsJson" JSONB NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "previousOutputHash" TEXT,
    "outputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArenaEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaPostMortem" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "triggerStatus" "ArenaParticipantStatus" NOT NULL,
    "triggerEvaluationId" TEXT,
    "status" "ArenaPostMortemStatus" NOT NULL DEFAULT 'OPEN',
    "dossierVersion" TEXT NOT NULL,
    "dossierJson" JSONB NOT NULL,
    "dossierHash" TEXT NOT NULL,
    "hypothesis" TEXT,
    "hypothesisAuthor" TEXT,
    "hypothesisRecordedAt" TIMESTAMP(3),
    "proposedStrategyKey" TEXT,
    "proposedSpecificationHash" TEXT,
    "successorParticipantId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaPostMortem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArenaCohort_key_key" ON "ArenaCohort"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaParticipant_participantKey_key" ON "ArenaParticipant"("participantKey");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaParticipant_portfolioId_key" ON "ArenaParticipant"("portfolioId");

-- CreateIndex
CREATE INDEX "ArenaParticipant_cohortId_status_idx" ON "ArenaParticipant"("cohortId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaParticipantEvent_eventKey_key" ON "ArenaParticipantEvent"("eventKey");

-- CreateIndex
CREATE INDEX "ArenaParticipantEvent_participantId_occurredAt_idx" ON "ArenaParticipantEvent"("participantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaEvaluation_evaluationKey_key" ON "ArenaEvaluation"("evaluationKey");

-- CreateIndex
CREATE INDEX "ArenaEvaluation_participantId_asOf_idx" ON "ArenaEvaluation"("participantId", "asOf");

-- CreateIndex
CREATE INDEX "ArenaEvaluation_cohortId_asOf_idx" ON "ArenaEvaluation"("cohortId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaPostMortem_caseKey_key" ON "ArenaPostMortem"("caseKey");

-- CreateIndex
CREATE INDEX "ArenaPostMortem_participantId_createdAt_idx" ON "ArenaPostMortem"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "ArenaPostMortem_status_idx" ON "ArenaPostMortem"("status");

-- AddForeignKey
ALTER TABLE "ArenaParticipant" ADD CONSTRAINT "ArenaParticipant_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "ArenaCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaParticipant" ADD CONSTRAINT "ArenaParticipant_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaParticipant" ADD CONSTRAINT "ArenaParticipant_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaParticipant" ADD CONSTRAINT "ArenaParticipant_parentParticipantId_fkey" FOREIGN KEY ("parentParticipantId") REFERENCES "ArenaParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaParticipantEvent" ADD CONSTRAINT "ArenaParticipantEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ArenaParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaEvaluation" ADD CONSTRAINT "ArenaEvaluation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ArenaParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaEvaluation" ADD CONSTRAINT "ArenaEvaluation_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "ArenaCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaPostMortem" ADD CONSTRAINT "ArenaPostMortem_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ArenaParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

