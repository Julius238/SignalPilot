-- AlterTable: rename title to headline
ALTER TABLE "NewsItem" RENAME COLUMN "title" TO "headline";

-- AlterTable: add symbol (required with empty string default)
ALTER TABLE "NewsItem" ADD COLUMN "symbol" TEXT NOT NULL DEFAULT '';

-- AlterTable: add optional columns
ALTER TABLE "NewsItem" ADD COLUMN "assetId" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "category" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "relatedSymbols" JSONB;
ALTER TABLE "NewsItem" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "relevanceScore" DOUBLE PRECISION;
ALTER TABLE "NewsItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: unique url (allows multiple NULLs in PostgreSQL)
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- CreateIndex: symbol
CREATE INDEX "NewsItem_symbol_idx" ON "NewsItem"("symbol");

-- CreateIndex: source (standalone)
CREATE INDEX "NewsItem_source_idx" ON "NewsItem"("source");

-- DropIndex: old compound index superseded by standalone source index
DROP INDEX IF EXISTS "NewsItem_source_publishedAt_idx";
