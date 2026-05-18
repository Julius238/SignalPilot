CREATE TYPE "PaperEvaluationKind" AS ENUM ('DIRECTIONAL_BULLISH', 'DIRECTIONAL_BEARISH', 'RISK_WARNING', 'OBSERVATION', 'SKIPPED');
CREATE TYPE "PaperExpectedMoveDirection" AS ENUM ('UP', 'DOWN', 'ANY', 'NONE');

ALTER TABLE "PaperSignalEvaluation"
ADD COLUMN "evaluationKind" "PaperEvaluationKind" NOT NULL DEFAULT 'SKIPPED',
ADD COLUMN "expectedMoveDirection" "PaperExpectedMoveDirection" NOT NULL DEFAULT 'NONE',
ADD COLUMN "skipReason" TEXT;

CREATE INDEX "PaperSignalEvaluation_evaluationKind_idx" ON "PaperSignalEvaluation"("evaluationKind");
