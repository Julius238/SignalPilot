CREATE TABLE "SignalRuleApplication" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "originalScore" DOUBLE PRECISION NOT NULL,
    "adjustedScore" DOUBLE PRECISION NOT NULL,
    "originalStatus" "SignalStatus" NOT NULL,
    "adjustedStatus" "SignalStatus" NOT NULL,
    "finalRiskLevel" "RiskLevel" NOT NULL,
    "adjustmentsJson" JSONB NOT NULL,
    "warningsJson" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalRuleApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignalRuleApplication_signalId_key" ON "SignalRuleApplication"("signalId");
CREATE INDEX "SignalRuleApplication_adjustedStatus_idx" ON "SignalRuleApplication"("adjustedStatus");
CREATE INDEX "SignalRuleApplication_createdAt_idx" ON "SignalRuleApplication"("createdAt");

ALTER TABLE "SignalRuleApplication" ADD CONSTRAINT "SignalRuleApplication_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
