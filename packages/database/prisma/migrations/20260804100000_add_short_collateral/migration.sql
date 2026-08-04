-- Typed collateral cache for synthetic, unleveraged shadow shorts.
-- Existing rows are LONG and therefore retain the safe zero default.
ALTER TYPE "StrategyPerformanceSegment" ADD VALUE 'DIRECTION';

ALTER TABLE "ShadowPosition"
ADD COLUMN "reservedCollateral" DECIMAL(30,12) NOT NULL DEFAULT 0;

ALTER TABLE "ShadowPosition"
ADD CONSTRAINT "ShadowPosition_reservedCollateral_non_negative"
CHECK ("reservedCollateral" >= 0);

ALTER TABLE "ShadowPosition"
ADD CONSTRAINT "ShadowPosition_long_has_no_short_collateral"
CHECK ("direction" = 'SHORT' OR "reservedCollateral" = 0);
