import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ExitTrigger,
  SimulationReasonCode,
  resolveCandleExit,
  type CandleSnapshotV1,
  type ExitCandleInputV1
} from "../src/index.js";

const candle = (
  overrides: Partial<CandleSnapshotV1> = {}
): CandleSnapshotV1 => ({
  id: "candle-1",
  openTime: "2026-08-02T10:00:00.000Z",
  closeTime: "2026-08-02T11:00:00.000Z",
  open: "24100",
  high: "24300",
  low: "24000",
  close: "24200",
  volume: "1000",
  ...overrides
});

const basePlan = (
  overrides: Partial<ExitCandleInputV1> = {}
): ExitCandleInputV1 => ({
  direction: "LONG",
  stopPrice: "23600",
  takeProfitPrice: "25300",
  maxHoldUntil: "2026-08-10T00:00:00.000Z",
  candle: candle(),
  ...overrides
});

describe("resolveCandleExit — synthetic SHORT", () => {
  const shortPlan = (
    overrides: Partial<ExitCandleInputV1> = {}
  ): ExitCandleInputV1 => ({
    direction: "SHORT",
    stopPrice: "24600",
    takeProfitPrice: "23000",
    maxHoldUntil: "2026-08-10T00:00:00.000Z",
    candle: candle(),
    ...overrides
  });

  it("uses high for the stop, low for TP and stop-first on conflict", () => {
    const conflict = resolveCandleExit(
      shortPlan({
        candle: candle({
          open: "24100",
          high: "24700",
          low: "22900",
          close: "24000"
        })
      })
    );
    assert.equal(conflict.trigger, ExitTrigger.STOP);
    assert.equal(
      conflict.reasonCode,
      SimulationReasonCode.STOP_AND_TAKE_PROFIT_IN_RANGE_STOP_FIRST
    );
  });

  it("treats a gap up as stop and a gap down as TP capped at target", () => {
    const stopGap = resolveCandleExit(
      shortPlan({
        candle: candle({
          open: "24700",
          high: "24800",
          low: "24650",
          close: "24750"
        })
      })
    );
    assert.equal(stopGap.trigger, ExitTrigger.STOP);
    assert.equal(stopGap.referencePrice, "24700.000000000000");

    const tpGap = resolveCandleExit(
      shortPlan({
        candle: candle({
          open: "22800",
          high: "22900",
          low: "22700",
          close: "22850"
        })
      })
    );
    assert.equal(tpGap.trigger, ExitTrigger.TAKE_PROFIT);
    assert.equal(tpGap.referencePrice, "23000.000000000000");
  });
});

describe("resolveCandleExit — priority order (docs/trading/07)", () => {
  it("1. gap through the stop: open <= stop -> STOP at the (adverse) open", () => {
    const result = resolveCandleExit(
      basePlan({
        candle: candle({
          open: "23500",
          high: "23600",
          low: "23400",
          close: "23550"
        })
      })
    );
    assert.equal(result.triggered, true);
    assert.equal(result.trigger, ExitTrigger.STOP);
    assert.equal(result.referencePrice, "23500.000000000000");
    assert.equal(result.gapIndicator, true);
    assert.equal(result.reasonCode, SimulationReasonCode.STOP_GAP);
  });

  it("2. gap over take profit: open >= TP -> TP capped at the target, no bonus for a better open", () => {
    const result = resolveCandleExit(
      basePlan({
        candle: candle({
          open: "25400",
          high: "25500",
          low: "25350",
          close: "25450"
        })
      })
    );
    assert.equal(result.trigger, ExitTrigger.TAKE_PROFIT);
    assert.equal(result.referencePrice, "25300.000000000000");
    assert.equal(result.gapIndicator, true);
    assert.equal(result.reasonCode, SimulationReasonCode.TAKE_PROFIT_GAP);
  });

  it("3. both thresholds reachable inside the range -> STOP_FIRST regardless of which is closer", () => {
    const result = resolveCandleExit(
      basePlan({
        candle: candle({
          open: "24500",
          high: "25400",
          low: "23500",
          close: "24800"
        })
      })
    );
    assert.equal(result.trigger, ExitTrigger.STOP);
    assert.equal(result.referencePrice, "23600.000000000000");
    assert.equal(result.gapIndicator, false);
    assert.equal(
      result.reasonCode,
      SimulationReasonCode.STOP_AND_TAKE_PROFIT_IN_RANGE_STOP_FIRST
    );
  });

  it("4. only the stop is reachable in range", () => {
    const result = resolveCandleExit(
      basePlan({
        candle: candle({
          open: "24100",
          high: "24300",
          low: "23550",
          close: "24000"
        })
      })
    );
    assert.equal(result.trigger, ExitTrigger.STOP);
    assert.equal(result.referencePrice, "23600.000000000000");
    assert.equal(result.reasonCode, SimulationReasonCode.STOP_IN_RANGE);
  });

  it("5. only the take profit is reachable in range, capped at the target", () => {
    const result = resolveCandleExit(
      basePlan({
        candle: candle({
          open: "24900",
          high: "25400",
          low: "24800",
          close: "25100"
        })
      })
    );
    assert.equal(result.trigger, ExitTrigger.TAKE_PROFIT);
    assert.equal(result.referencePrice, "25300.000000000000");
    assert.equal(result.reasonCode, SimulationReasonCode.TAKE_PROFIT_IN_RANGE);
  });

  it("6. max hold reached with no price exit -> close of the qualifying candle", () => {
    const result = resolveCandleExit(
      basePlan({
        maxHoldUntil: "2026-08-02T10:30:00.000Z",
        candle: candle({ closeTime: "2026-08-02T11:00:00.000Z" })
      })
    );
    assert.equal(result.trigger, ExitTrigger.TIME_EXIT);
    assert.equal(result.referencePrice, "24200.000000000000");
    assert.equal(result.gapIndicator, false);
    assert.equal(result.reasonCode, SimulationReasonCode.MAX_HOLD_REACHED);
  });

  it("no trigger when neither threshold nor max hold applies", () => {
    const result = resolveCandleExit(basePlan());
    assert.equal(result.triggered, false);
    assert.equal(result.trigger, null);
    assert.equal(result.reasonCode, SimulationReasonCode.NO_EXIT_TRIGGER);
  });

  it("never invents a fill from an invalid candle", () => {
    const result = resolveCandleExit(
      basePlan({ candle: candle({ low: "26000" }) })
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reasonCode, SimulationReasonCode.INVALID_CANDLE);
  });

  it("never invents a fill from an invalid exit plan", () => {
    const result = resolveCandleExit(
      basePlan({ stopPrice: "25400", takeProfitPrice: "25300" })
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reasonCode, SimulationReasonCode.INVALID_EXIT_PLAN);
  });
});

describe("resolveCandleExit — entry candle with stop/TP already inside the range", () => {
  it("still resolves STOP_FIRST when both trigger on the very fill candle", () => {
    const result = resolveCandleExit(
      basePlan({
        candle: candle({
          open: "24150",
          high: "25400",
          low: "23500",
          close: "24800"
        })
      })
    );
    assert.equal(result.trigger, ExitTrigger.STOP);
    assert.equal(
      result.reasonCode,
      SimulationReasonCode.STOP_AND_TAKE_PROFIT_IN_RANGE_STOP_FIRST
    );
  });
});
