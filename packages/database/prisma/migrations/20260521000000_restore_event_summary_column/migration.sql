-- Preserve legacy Event summary data and repair databases where the column was dropped.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "summary" TEXT;
