-- CreateTable
CREATE TABLE "PortfolioEquityPoint" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "sourceLedgerSequence" INTEGER NOT NULL,
    "availableCash" DECIMAL(30,12) NOT NULL,
    "reservedCash" DECIMAL(30,12) NOT NULL,
    "marketValue" DECIMAL(30,12) NOT NULL,
    "equity" DECIMAL(30,12) NOT NULL,
    "realizedPnl" DECIMAL(30,12) NOT NULL,
    "unrealizedPnl" DECIMAL(30,12) NOT NULL,
    "highWaterMark" DECIMAL(30,12) NOT NULL,
    "drawdownPct" DECIMAL(30,12) NOT NULL,
    "openPositionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioEquityPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioEquityPoint_asOf_idx" ON "PortfolioEquityPoint"("asOf");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioEquityPoint_portfolioId_asOf_key" ON "PortfolioEquityPoint"("portfolioId", "asOf");

-- AddForeignKey
ALTER TABLE "PortfolioEquityPoint" ADD CONSTRAINT "PortfolioEquityPoint_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

