import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  EMPTY_POSITION_STATE,
  EMPTY_PORTFOLIO_STATE,
  applyEntryFillLedger,
  applyEntryFillToPosition,
  applyExitFillLedger,
  applyExitFillToPosition,
  computeReleaseReservation,
  computeReserveEntry
} from "../src/index.js";

const d = (value: string): DecimalValue => DecimalValue.fromString(value);

describe("reserve -> partial release -> entry fill -> exit fill — one full round trip", () => {
  it("keeps availableCash + reservedCash + realizedPnl consistent at every step", () => {
    const start = { ...EMPTY_PORTFOLIO_STATE, availableCash: "10000.000000000000" };

    // 1. Reserve worst-case cost for 0.1 units.
    const reserve = computeReserveEntry({
      state: start,
      entryKey: "reserve-1",
      reservedQuoteAmount: "2415.000000000000",
      shadowOrderId: "order-1",
      occurredAt: "2026-08-02T10:00:00.000Z"
    });
    assert.equal(reserve.ok, true);
    assert.equal(reserve.nextState?.availableCash, "7585.000000000000");
    assert.equal(reserve.nextState?.reservedCash, "2415.000000000000");

    // 2. Only 0.06 of the 0.1 fills this candle (liquidity cap); release the
    //    reserve tied to the other 0.04 units proportionally.
    const release = computeReleaseReservation({
      state: reserve.nextState!,
      entryKey: "release-1",
      releaseAmount: "966.000000000000",
      shadowOrderId: "order-1",
      occurredAt: "2026-08-02T11:00:00.000Z"
    });
    assert.equal(release.ok, true);
    assert.equal(release.nextState?.availableCash, "8551.000000000000");
    assert.equal(release.nextState?.reservedCash, "1449.000000000000");

    // 3. Entry fill for the 0.06 units actually filled.
    const entryFill = { quantity: "0.06", fillPrice: "24102.41", notional: "1446.1446000000", feeAmount: "1.4461446" };
    const entryLedger = applyEntryFillLedger({
      state: release.nextState!,
      notionalEntryKey: "entry-notional-1",
      feeEntryKey: "entry-fee-1",
      reservedForFill: "1449.000000000000",
      fill: entryFill,
      shadowOrderId: "order-1",
      shadowFillId: "fill-1",
      shadowPositionId: "position-1",
      occurredAt: "2026-08-02T11:00:00.000Z"
    });
    assert.equal(entryLedger.ok, true);
    assert.equal(entryLedger.entries.length, 2);
    // availableCash increases by the reserve minus the actual cost.
    const expectedAvailableAfterEntry = d("8551")
      .add(d("1449").sub(d(entryFill.notional)).sub(d(entryFill.feeAmount)))
      .toString();
    assert.equal(entryLedger.nextState?.availableCash, expectedAvailableAfterEntry);
    assert.equal(entryLedger.nextState?.reservedCash, "0.000000000000");
    assert.equal(entryLedger.nextState?.feesPaid, d(entryFill.feeAmount).toString());

    const entryPosition = applyEntryFillToPosition(EMPTY_POSITION_STATE, entryFill);
    assert.equal(entryPosition.ok, true);
    assert.equal(entryPosition.position?.openQuantity, "0.060000000000");
    assert.equal(entryPosition.position?.initialQuantity, "0.060000000000");

    // 4. Exit fill closes the entire position at a profit.
    const exitFill = { quantity: "0.06", fillPrice: "24800.00", notional: "1488.0000000000", feeAmount: "1.488" };
    const exitPosition = applyExitFillToPosition(
      entryPosition.position!,
      exitFill,
      entryPosition.position!.feesPaid
    );
    assert.equal(exitPosition.ok, true);
    assert.equal(exitPosition.position?.openQuantity, "0.000000000000");
    assert.equal(exitPosition.position?.closedQuantity, "0.060000000000");
    // Full close: all entry fees are attributed exactly once.
    assert.equal(exitPosition.position?.allocatedEntryFees, entryPosition.position?.feesPaid);

    const exitLedger = applyExitFillLedger({
      state: entryLedger.nextState!,
      proceedsEntryKey: "exit-notional-1",
      feeEntryKey: "exit-fee-1",
      pnlEntryKey: "exit-pnl-1",
      fill: exitFill,
      realizedPnlDelta: exitPosition.realizedPnlDelta!,
      shadowOrderId: "order-exit-1",
      shadowFillId: "fill-exit-1",
      shadowPositionId: "position-1",
      occurredAt: "2026-08-02T20:00:00.000Z"
    });
    assert.equal(exitLedger.ok, true);
    assert.equal(exitLedger.entries.length, 3);
    assert.equal(exitLedger.nextState?.realizedPnl, exitPosition.realizedPnlDelta);

    // Net P&L equals the price move on the quantity, minus every fee paid.
    const grossPnl = d(exitFill.fillPrice).sub(d(entryPosition.position!.averageEntryPrice)).mul(d("0.06"), "FLOOR");
    const totalFees = d(entryFill.feeAmount).add(d(exitFill.feeAmount));
    assert.equal(exitPosition.realizedPnlDelta, grossPnl.sub(totalFees).toString());

    // The final available cash reflects exactly: starting cash - entry cost - exit fee + exit proceeds.
    const expectedFinalAvailable = d("10000")
      .sub(d(entryFill.notional))
      .sub(d(entryFill.feeAmount))
      .add(d(exitFill.notional))
      .sub(d(exitFill.feeAmount));
    assert.equal(exitLedger.nextState?.availableCash, expectedFinalAvailable.toString());
    assert.equal(exitLedger.nextState?.reservedCash, "0.000000000000");
  });
});

describe("reservation and reserve-consuming guards", () => {
  it("refuses to reserve more than available cash", () => {
    const result = computeReserveEntry({
      state: { ...EMPTY_PORTFOLIO_STATE, availableCash: "100.000000000000" },
      entryKey: "reserve-2",
      reservedQuoteAmount: "200.000000000000",
      shadowOrderId: "order-2",
      occurredAt: "2026-08-02T10:00:00.000Z"
    });
    assert.equal(result.ok, false);
  });

  it("refuses to release more than is currently reserved", () => {
    const result = computeReleaseReservation({
      state: { ...EMPTY_PORTFOLIO_STATE, reservedCash: "10.000000000000" },
      entryKey: "release-2",
      releaseAmount: "20.000000000000",
      shadowOrderId: "order-2",
      occurredAt: "2026-08-02T10:00:00.000Z"
    });
    assert.equal(result.ok, false);
  });

  it("refuses an entry fill whose actual cost would exceed its tied reserve", () => {
    const result = applyEntryFillLedger({
      state: { ...EMPTY_PORTFOLIO_STATE, reservedCash: "100.000000000000" },
      notionalEntryKey: "n",
      feeEntryKey: "f",
      reservedForFill: "50.000000000000",
      fill: { quantity: "1", fillPrice: "60", notional: "60", feeAmount: "1" },
      shadowOrderId: "order-3",
      shadowFillId: "fill-3",
      shadowPositionId: "position-3",
      occurredAt: "2026-08-02T10:00:00.000Z"
    });
    assert.equal(result.ok, false);
  });

  it("refuses an exit fill quantity larger than the open position", () => {
    const result = applyExitFillToPosition(
      { ...EMPTY_POSITION_STATE, initialQuantity: "1", openQuantity: "1", averageEntryPrice: "100" },
      { quantity: "2", fillPrice: "110", notional: "220", feeAmount: "0.2" },
      "0"
    );
    assert.equal(result.ok, false);
  });
});

describe("partial exit fees are allocated proportionally, final close absorbs the remainder", () => {
  it("allocates entry fees across two exit fills without losing or double-counting any", () => {
    const entered = applyEntryFillToPosition(EMPTY_POSITION_STATE, {
      quantity: "0.09",
      fillPrice: "100",
      notional: "9",
      feeAmount: "0.03"
    });
    assert.equal(entered.ok, true);

    const firstExit = applyExitFillToPosition(
      entered.position!,
      { quantity: "0.03", fillPrice: "110", notional: "3.3", feeAmount: "0.01" },
      entered.position!.feesPaid
    );
    assert.equal(firstExit.ok, true);
    assert.ok(d(firstExit.allocatedEntryFeesDelta!).isPositive());

    const secondExit = applyExitFillToPosition(
      firstExit.position!,
      { quantity: "0.06", fillPrice: "120", notional: "7.2", feeAmount: "0.02" },
      entered.position!.feesPaid
    );
    assert.equal(secondExit.ok, true);
    assert.equal(secondExit.position?.openQuantity, "0.000000000000");
    // The two allocations together must equal the total entry fee exactly.
    assert.equal(secondExit.position?.allocatedEntryFees, entered.position?.feesPaid);
  });
});
