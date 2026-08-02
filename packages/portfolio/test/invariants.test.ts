import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkPortfolioInvariants, EMPTY_PORTFOLIO_STATE, PortfolioReasonCode } from "../src/index.js";

const baseInput = () => ({
  cache: { ...EMPTY_PORTFOLIO_STATE, availableCash: "9000.000000000000", reservedCash: "1000.000000000000" },
  cacheEquity: "10000.000000000000",
  replayed: { ...EMPTY_PORTFOLIO_STATE, availableCash: "9000.000000000000", reservedCash: "1000.000000000000" },
  openReservations: [{ shadowOrderId: "order-1", reservedQuoteAmount: "1000.000000000000" }],
  marketValue: "0.000000000000",
  orphanReferenceCount: 0,
  sequenceGapCount: 0,
  duplicateAssetScopeCount: 0,
  toleranceUnscaled: "0.00000001"
});

describe("checkPortfolioInvariants — the consistent case", () => {
  it("reports no violations when cache, replay, reservations and equity all agree", () => {
    const result = checkPortfolioInvariants(baseInput());
    assert.equal(result.consistent, true);
    assert.deepEqual(result.violations, []);
  });
});

describe("checkPortfolioInvariants — each violation family", () => {
  it("flags negative cash", () => {
    const result = checkPortfolioInvariants({
      ...baseInput(),
      cache: { ...baseInput().cache, availableCash: "-1.000000000000" }
    });
    assert.equal(result.consistent, false);
    assert.ok(result.violations.includes(PortfolioReasonCode.NEGATIVE_CASH));
  });

  it("flags an orphan ledger reference", () => {
    const result = checkPortfolioInvariants({ ...baseInput(), orphanReferenceCount: 1 });
    assert.ok(result.violations.includes(PortfolioReasonCode.ORPHAN_LEDGER_REFERENCE));
  });

  it("flags a sequence gap", () => {
    const result = checkPortfolioInvariants({ ...baseInput(), sequenceGapCount: 1 });
    assert.ok(result.violations.includes(PortfolioReasonCode.SEQUENCE_NOT_CONTIGUOUS));
  });

  it("flags a cache-vs-replay mismatch beyond tolerance", () => {
    const input = baseInput();
    const result = checkPortfolioInvariants({
      ...input,
      replayed: { ...input.replayed, availableCash: "9001.000000000000" }
    });
    assert.ok(result.violations.includes(PortfolioReasonCode.CACHE_MISMATCH_LEDGER_REPLAY));
  });

  it("tolerates a difference at or under the configured tolerance", () => {
    const input = baseInput();
    const result = checkPortfolioInvariants({
      ...input,
      replayed: { ...input.replayed, availableCash: "9000.000000005000" }
    });
    assert.equal(result.consistent, true);
  });

  it("flags a reservation sum that does not match reservedCash", () => {
    const result = checkPortfolioInvariants({
      ...baseInput(),
      openReservations: [{ shadowOrderId: "order-1", reservedQuoteAmount: "500.000000000000" }]
    });
    assert.ok(result.violations.includes(PortfolioReasonCode.RESERVATION_MISMATCH));
  });

  it("flags an equity mismatch against availableCash + reservedCash + marketValue", () => {
    const result = checkPortfolioInvariants({ ...baseInput(), cacheEquity: "20000.000000000000" });
    assert.ok(result.violations.includes(PortfolioReasonCode.EQUITY_MISMATCH));
  });

  it("flags a duplicate open-position scope", () => {
    const result = checkPortfolioInvariants({ ...baseInput(), duplicateAssetScopeCount: 1 });
    assert.ok(result.violations.includes(PortfolioReasonCode.DUPLICATE_ASSET_POSITION_SCOPE));
  });
});
