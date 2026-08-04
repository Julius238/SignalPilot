-- Shadow Short: separate long and short strategies.
--
-- Specification: docs/trading/decisions/0011-separate-long-and-short-strategies.md,
-- 0012-synthetic-unleveraged-shadow-shorts.md, 0013-no-simultaneous-long-and-short-exposure.md
--
-- Strictly additive: one enum member and three nullable/defaulted columns.
-- No column is dropped, no constraint is loosened, and no legacy Paper* model
-- is touched. Every pre-existing row keeps its exact direction because both
-- new direction columns default to LONG. Active legacy entry orders receive
-- the same direction-free scope key new code would have created, so the unique
-- constraint protects an in-flight rollout immediately rather than only new
-- rows. Any pre-existing duplicate aborts the migration fail-closed.

-- ── SHORT direction ────────────────────────────────────────────────────────
-- A synthetic, unleveraged shadow direction only. There is no borrow, funding,
-- liquidation or margin anywhere in this system, and no exchange adapter
-- exists (ADR 0012).
ALTER TYPE "TradeDirection" ADD VALUE 'SHORT';

-- ── ShadowOrder ────────────────────────────────────────────────────────────
ALTER TABLE "ShadowOrder"
  ADD COLUMN "openEntryScopeKey" TEXT,
  ADD COLUMN "direction" "TradeDirection" NOT NULL DEFAULT 'LONG';

UPDATE "ShadowOrder"
SET "openEntryScopeKey" =
  'open-order.v1|' || "portfolioId" || '|' || "assetId" || '|ENTRY'
WHERE "purpose" = 'ENTRY'
  AND "status" IN ('ACCEPTED', 'WAITING_FOR_ENTRY', 'PARTIALLY_FILLED');

-- The order-level half of the long/short exclusivity guarantee (ADR 0013).
--
-- `entryCandidateKey` is unique per CANDIDATE and therefore only prevents a
-- duplicate order for the same candidate. It does NOT prevent two concurrent
-- entry orders for the same portfolio and asset originating from different
-- candidates — for example one long and one short. This index closes that gap.
--
-- The key is deliberately direction-free (`buildOpenEntryOrderScopeKey`), so a
-- short entry order collides with an existing long entry order on this very
-- index. NULL means "this order is terminal", and PostgreSQL treats NULLs as
-- distinct, so terminal orders never collide with each other.
CREATE UNIQUE INDEX "ShadowOrder_openEntryScopeKey_key" ON "ShadowOrder"("openEntryScopeKey");

-- ── ShadowPosition ─────────────────────────────────────────────────────────
-- Drives the PnL sign and which side of the price triggers stop vs. take
-- profit. `ShadowPosition.openScopeKey` already carries the position-level half
-- of the exclusivity guarantee and is likewise direction-free — it is
-- deliberately NOT changed here.
ALTER TABLE "ShadowPosition"
  ADD COLUMN "direction" "TradeDirection" NOT NULL DEFAULT 'LONG';

CREATE INDEX "ShadowPosition_direction_closedAt_idx" ON "ShadowPosition"("direction", "closedAt");
