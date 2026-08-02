import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_PORTFOLIO_STATE,
  applyLedgerEntry,
  replayLedger,
  type LedgerEntryDraftV1
} from "../src/index.js";

const emptyRefs = { shadowOrderIds: new Set<string>(), shadowFillIds: new Set<string>(), shadowPositionIds: new Set<string>() };

function entry(overrides: Partial<LedgerEntryDraftV1>): LedgerEntryDraftV1 {
  return {
    entryKey: "k",
    sequence: 1,
    type: "INITIAL_CASH",
    availableCashDelta: "0.000000000000",
    reservedCashDelta: "0.000000000000",
    realizedPnlDelta: "0.000000000000",
    feeDelta: "0.000000000000",
    shadowOrderId: null,
    shadowFillId: null,
    shadowPositionId: null,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: "2026-08-02T00:00:00.000Z",
    ...overrides
  };
}

describe("replayLedger — reproduces the exact cache state", () => {
  it("folds a sequence of entries deterministically", () => {
    const entries: LedgerEntryDraftV1[] = [
      entry({ entryKey: "e1", sequence: 1, type: "INITIAL_CASH", availableCashDelta: "10000.000000000000" }),
      entry({ entryKey: "e2", sequence: 2, type: "RESERVE", availableCashDelta: "-2415.000000000000", reservedCashDelta: "2415.000000000000" }),
      entry({ entryKey: "e3", sequence: 3, type: "RELEASE", availableCashDelta: "966.000000000000", reservedCashDelta: "-966.000000000000" })
    ];

    const report = replayLedger(entries, emptyRefs);
    assert.equal(report.orphanReferenceCount, 0);
    assert.equal(report.sequenceGapCount, 0);
    assert.equal(report.duplicateEntryKeyCount, 0);
    assert.equal(report.state.availableCash, "8551.000000000000");
    assert.equal(report.state.reservedCash, "1449.000000000000");
    assert.equal(report.state.ledgerSequence, 3);
  });

  it("is order-independent given the entries' own sequence numbers", () => {
    const entries: LedgerEntryDraftV1[] = [
      entry({ entryKey: "e2", sequence: 2, type: "RESERVE", availableCashDelta: "-100.000000000000", reservedCashDelta: "100.000000000000" }),
      entry({ entryKey: "e1", sequence: 1, type: "INITIAL_CASH", availableCashDelta: "1000.000000000000" })
    ];
    const report = replayLedger(entries, emptyRefs);
    assert.equal(report.state.availableCash, "900.000000000000");
    assert.equal(report.sequenceGapCount, 0);
  });

  it("counts a duplicate entryKey once and does not double-apply it", () => {
    const single = entry({ entryKey: "e1", sequence: 1, type: "INITIAL_CASH", availableCashDelta: "500.000000000000" });
    const report = replayLedger([single, { ...single }], emptyRefs);
    assert.equal(report.duplicateEntryKeyCount, 1);
    assert.equal(report.state.availableCash, "500.000000000000");
  });

  it("detects a sequence gap", () => {
    const entries: LedgerEntryDraftV1[] = [
      entry({ entryKey: "e1", sequence: 1 }),
      entry({ entryKey: "e3", sequence: 3 })
    ];
    const report = replayLedger(entries, emptyRefs);
    assert.equal(report.sequenceGapCount, 1);
  });

  it("detects an orphan reference to an unknown order", () => {
    const entries: LedgerEntryDraftV1[] = [entry({ entryKey: "e1", sequence: 1, shadowOrderId: "unknown-order" })];
    const report = replayLedger(entries, emptyRefs);
    assert.equal(report.orphanReferenceCount, 1);
  });

  it("accepts a reference to a known order without flagging it", () => {
    const entries: LedgerEntryDraftV1[] = [entry({ entryKey: "e1", sequence: 1, shadowOrderId: "order-1" })];
    const report = replayLedger(entries, { ...emptyRefs, shadowOrderIds: new Set(["order-1"]) });
    assert.equal(report.orphanReferenceCount, 0);
  });

  it("replaying the same entries twice yields byte-identical caches", () => {
    const entries: LedgerEntryDraftV1[] = [
      entry({ entryKey: "e1", sequence: 1, availableCashDelta: "10000.000000000000" }),
      entry({ entryKey: "e2", sequence: 2, type: "FEE", availableCashDelta: "-1.500000000000", feeDelta: "1.500000000000" })
    ];
    const first = replayLedger(entries, emptyRefs);
    const second = replayLedger(entries, emptyRefs);
    assert.deepEqual(first.state, second.state);
  });

  it("applyLedgerEntry composes the same way replayLedger does", () => {
    const e1 = entry({ entryKey: "e1", sequence: 1, availableCashDelta: "10.000000000000" });
    const e2 = entry({ entryKey: "e2", sequence: 2, availableCashDelta: "5.000000000000" });
    const stepwise = applyLedgerEntry(applyLedgerEntry(EMPTY_PORTFOLIO_STATE, e1), e2);
    const replayed = replayLedger([e1, e2], emptyRefs).state;
    assert.deepEqual(stepwise, replayed);
  });
});
