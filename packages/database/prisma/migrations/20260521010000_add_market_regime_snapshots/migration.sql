CREATE TABLE "MarketRegimeSnapshot" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "equityRegime" TEXT NOT NULL,
    "cryptoRegime" TEXT NOT NULL,
    "overallRegime" TEXT NOT NULL,
    "riskMode" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "riskNote" TEXT NOT NULL,
    "reportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRegimeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketRegimeSnapshot_generatedAt_idx" ON "MarketRegimeSnapshot"("generatedAt");
CREATE INDEX "MarketRegimeSnapshot_overallRegime_idx" ON "MarketRegimeSnapshot"("overallRegime");
CREATE INDEX "MarketRegimeSnapshot_riskMode_idx" ON "MarketRegimeSnapshot"("riskMode");
