-- Additive migration for work package 3 (risk engine).
--
-- Specification: docs/trading/03-domain-model.md (TradeCandidate,
-- InstrumentExecutionProfile) and docs/trading/06-risk-engine-specification.md
-- (R-007, R-008, R-025, R-026).
--
-- Work package 2 could only keep the strategy's full price plan inside the
-- atomic TradingAuditEvent payload, because TradeCandidate had no columns for
-- it. The risk engine must not read a safety-critical value out of untyped
-- audit JSON, so the plan becomes typed here.
--
-- Every column is nullable on purpose: the shadow trading tables may already
-- hold rows from a work-package-2 run, and a NOT NULL column would either fail
-- the migration or require a fabricated default price. A null is refused by
-- R-026 (CANDIDATE_PLAN_INCOMPLETE) rather than silently interpreted.
--
-- No existing row is written, no column is dropped, no legacy Paper* model is
-- touched.

ALTER TABLE "TradeCandidate"
  ADD COLUMN "stopDistance" DECIMAL(30,12),
  ADD COLUMN "stopDistancePct" DECIMAL(30,12),
  ADD COLUMN "plannedRewardRisk" DECIMAL(30,12),
  ADD COLUMN "plannedEntryMinimum" DECIMAL(30,12),
  ADD COLUMN "plannedEntryMaximum" DECIMAL(30,12),
  ADD COLUMN "maximumEntryGapDistance" DECIMAL(30,12),
  ADD COLUMN "validFrom" TIMESTAMP(3),
  ADD COLUMN "earliestFillAt" TIMESTAMP(3),
  ADD COLUMN "maxHoldHours" INTEGER,
  ADD COLUMN "strategyEngineVersion" TEXT,
  ADD COLUMN "strategySpecificationHash" TEXT,
  ADD COLUMN "strategyOutputHash" TEXT;

-- Optional venue quantity cap; null means the venue declares none.
ALTER TABLE "InstrumentExecutionProfile"
  ADD COLUMN "maxQuantity" DECIMAL(30,12);
