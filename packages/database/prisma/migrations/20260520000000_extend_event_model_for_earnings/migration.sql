-- AlterTable: extend Event model for earnings/events intelligence
ALTER TABLE "Event" ADD COLUMN "assetId" TEXT;
ALTER TABLE "Event" ADD COLUMN "symbol" TEXT;
ALTER TABLE "Event" ADD COLUMN "description" TEXT;
ALTER TABLE "Event" ADD COLUMN "eventDate" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "eventTime" TEXT;
ALTER TABLE "Event" ADD COLUMN "fiscalQuarter" TEXT;
ALTER TABLE "Event" ADD COLUMN "fiscalYear" INTEGER;
ALTER TABLE "Event" ADD COLUMN "epsEstimate" DECIMAL(20,6);
ALTER TABLE "Event" ADD COLUMN "epsActual" DECIMAL(20,6);
ALTER TABLE "Event" ADD COLUMN "revenueEstimate" DECIMAL(30,6);
ALTER TABLE "Event" ADD COLUMN "revenueActual" DECIMAL(30,6);
ALTER TABLE "Event" ADD COLUMN "importance" TEXT;
ALTER TABLE "Event" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- Make publishedAt and rawJson nullable
ALTER TABLE "Event" ALTER COLUMN "publishedAt" DROP NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "rawJson" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Event_symbol_idx" ON "Event"("symbol");
CREATE INDEX "Event_eventType_idx" ON "Event"("eventType");
CREATE INDEX "Event_eventDate_idx" ON "Event"("eventDate");
CREATE INDEX "Event_assetId_idx" ON "Event"("assetId");
