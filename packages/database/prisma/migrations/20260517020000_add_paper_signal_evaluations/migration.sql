CREATE TYPE "PaperEvaluationStatus" AS ENUM ('OPEN', 'EVALUATED', 'EXPIRED', 'SKIPPED');
CREATE TYPE "PaperEvaluationOutcome" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'INVALIDATED', 'TARGET_REACHED');

CREATE TABLE "PaperSignalEvaluation" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "direction" "SignalDirection" NOT NULL,
    "status" "SignalStatus" NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "entryPrice" DECIMAL(30,12) NOT NULL,
    "invalidationPrice" DECIMAL(30,12),
    "targetPrice" DECIMAL(30,12),
    "evaluationStatus" "PaperEvaluationStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedAt" TIMESTAMP(3),
    "priceAfter1h" DECIMAL(30,12),
    "priceAfter4h" DECIMAL(30,12),
    "priceAfter1d" DECIMAL(30,12),
    "priceAfter3d" DECIMAL(30,12),
    "returnAfter1h" DOUBLE PRECISION,
    "returnAfter4h" DOUBLE PRECISION,
    "returnAfter1d" DOUBLE PRECISION,
    "returnAfter3d" DOUBLE PRECISION,
    "maxFavorableMove" DOUBLE PRECISION,
    "maxAdverseMove" DOUBLE PRECISION,
    "outcome" "PaperEvaluationOutcome",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperSignalEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaperSignalEvaluation_signalId_key" ON "PaperSignalEvaluation"("signalId");
CREATE INDEX "PaperSignalEvaluation_symbol_idx" ON "PaperSignalEvaluation"("symbol");
CREATE INDEX "PaperSignalEvaluation_timeframe_idx" ON "PaperSignalEvaluation"("timeframe");
CREATE INDEX "PaperSignalEvaluation_status_idx" ON "PaperSignalEvaluation"("status");
CREATE INDEX "PaperSignalEvaluation_signalType_idx" ON "PaperSignalEvaluation"("signalType");
CREATE INDEX "PaperSignalEvaluation_evaluationStatus_idx" ON "PaperSignalEvaluation"("evaluationStatus");
CREATE INDEX "PaperSignalEvaluation_openedAt_idx" ON "PaperSignalEvaluation"("openedAt");

ALTER TABLE "PaperSignalEvaluation" ADD CONSTRAINT "PaperSignalEvaluation_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
