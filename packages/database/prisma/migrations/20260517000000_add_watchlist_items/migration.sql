-- CreateEnum
CREATE TYPE "WatchlistPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "priority" "WatchlistPriority" NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "alertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_assetId_key" ON "WatchlistItem"("assetId");

-- CreateIndex
CREATE INDEX "WatchlistItem_symbol_idx" ON "WatchlistItem"("symbol");

-- CreateIndex
CREATE INDEX "WatchlistItem_priority_idx" ON "WatchlistItem"("priority");

-- CreateIndex
CREATE INDEX "WatchlistItem_alertEnabled_idx" ON "WatchlistItem"("alertEnabled");

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
