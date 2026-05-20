/*
  Warnings:

  - You are about to drop the column `summary` on the `Event` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Event" DROP COLUMN "summary",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NewsItem" ALTER COLUMN "symbol" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;
