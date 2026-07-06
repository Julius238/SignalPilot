-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RadarEventType" ADD VALUE 'BREAKOUT_PROXIMITY';
ALTER TYPE "RadarEventType" ADD VALUE 'SR_PROXIMITY';
ALTER TYPE "RadarEventType" ADD VALUE 'MOMENTUM_SHIFT';
ALTER TYPE "RadarEventType" ADD VALUE 'CONFLUENCE';
