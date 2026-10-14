-- CreateEnum
CREATE TYPE "ArenaCohortPhase" AS ENUM ('UNLABELED', 'LOCAL_SHAKEDOWN', 'OFFICIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TradingAlertEventType" ADD VALUE 'MARKET_DATA_STALE';
ALTER TYPE "TradingAlertEventType" ADD VALUE 'SCHEDULED_JOB_STALE';
ALTER TYPE "TradingAlertEventType" ADD VALUE 'WORKER_RESTARTED';
ALTER TYPE "TradingAlertEventType" ADD VALUE 'OPS_TEST';

-- AlterTable
ALTER TABLE "ArenaCohort" ADD COLUMN     "phase" "ArenaCohortPhase" NOT NULL DEFAULT 'UNLABELED';

