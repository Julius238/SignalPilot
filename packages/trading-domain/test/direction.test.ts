import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue, RoundingMode } from "../src/decimal.js";
import {
  ENTRY_SIDE,
  EXIT_SIDE,
  checkPricePlanOrdering,
  grossPnl,
  isStopTriggered,
  isTakeProfitTriggered,
  stopDistance,
  takeProfitDistance
} from "../src/direction.js";
import {
  TradeDirection,
  TradingReasonCode,
  isTradeDirection
} from "../src/types.js";

const d = (value: string) => DecimalValue.fromString(value);

describe("TradeDirection", () => {
  it("knows exactly LONG and SHORT", () => {
    assert.equal(isTradeDirection("LONG"), true);
    assert.equal(isTradeDirection("SHORT"), true);
    assert.equal(isTradeDirection("BOTH"), false);
    assert.equal(isTradeDirection(""), false);
    assert.equal(isTradeDirection(undefined), false);
  });
});

describe("checkPricePlanOrdering — LONG", () => {
  const base = {
    direction: TradeDirection.LONG,
    entryPrice: "100",
    stopPrice: "97",
    takeProfitPrice: "107.5"
  };

  it("accepts takeProfit > entry > stop", () => {
    assert.equal(checkPricePlanOrdering(base).ok, true);
  });

  it("refuses a stop above the entry", () => {
    const result = checkPricePlanOrdering({ ...base, stopPrice: "103" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, TradingReasonCode.PRICE_PLAN_NOT_ORDERED);
  });

  it("refuses a take profit below the entry", () => {
    assert.equal(
      checkPricePlanOrdering({ ...base, takeProfitPrice: "99" }).ok,
      false
    );
  });

  it("refuses equal prices — a zero-width plan is not tradeable", () => {
    assert.equal(
      checkPricePlanOrdering({ ...base, stopPrice: "100" }).ok,
      false
    );
    assert.equal(
      checkPricePlanOrdering({ ...base, takeProfitPrice: "100" }).ok,
      false
    );
  });
});

describe("checkPricePlanOrdering — SHORT", () => {
  const base = {
    direction: TradeDirection.SHORT,
    entryPrice: "100",
    stopPrice: "103",
    takeProfitPrice: "92.5"
  };

  it("accepts stop > entry > takeProfit", () => {
    assert.equal(checkPricePlanOrdering(base).ok, true);
  });

  it("refuses a LONG-shaped plan given a SHORT direction", () => {
    const result = checkPricePlanOrdering({
      direction: TradeDirection.SHORT,
      entryPrice: "100",
      stopPrice: "97",
      takeProfitPrice: "107.5"
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, TradingReasonCode.PRICE_PLAN_NOT_ORDERED);
  });

  it("refuses a stop below the entry", () => {
    assert.equal(
      checkPricePlanOrdering({ ...base, stopPrice: "99" }).ok,
      false
    );
  });

  it("refuses a take profit above the entry", () => {
    assert.equal(
      checkPricePlanOrdering({ ...base, takeProfitPrice: "101" }).ok,
      false
    );
  });
});

describe("checkPricePlanOrdering — invalid input", () => {
  it("refuses an unknown direction instead of guessing", () => {
    const result = checkPricePlanOrdering({
      direction: "BOTH" as never,
      entryPrice: "100",
      stopPrice: "97",
      takeProfitPrice: "107"
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reasonCode, TradingReasonCode.DIRECTION_UNKNOWN);
  });

  it("refuses a non-positive or non-decimal price", () => {
    for (const bad of ["0", "-5", "abc", "1e5"]) {
      const result = checkPricePlanOrdering({
        direction: TradeDirection.LONG,
        entryPrice: bad,
        stopPrice: "97",
        takeProfitPrice: "107"
      });
      assert.equal(result.ok, false, bad);
      if (result.ok) return;
      assert.equal(
        result.reasonCode,
        TradingReasonCode.PRICE_PLAN_NOT_POSITIVE,
        bad
      );
    }
  });
});

describe("distances are direction-aware and always positive", () => {
  it("measures the long plan", () => {
    const plan = {
      direction: TradeDirection.LONG,
      entryPrice: "100",
      stopPrice: "96",
      takeProfitPrice: "110"
    };
    assert.equal(stopDistance(plan)?.toString(), "4.000000000000");
    assert.equal(takeProfitDistance(plan)?.toString(), "10.000000000000");
  });

  it("measures the mirrored short plan identically", () => {
    const plan = {
      direction: TradeDirection.SHORT,
      entryPrice: "100",
      stopPrice: "104",
      takeProfitPrice: "90"
    };
    assert.equal(stopDistance(plan)?.toString(), "4.000000000000");
    assert.equal(takeProfitDistance(plan)?.toString(), "10.000000000000");
  });
});

describe("trigger sides", () => {
  it("triggers a long stop on a falling price and a long target on a rising one", () => {
    assert.equal(
      isStopTriggered(TradeDirection.LONG, d("96"), d("95.9")),
      true
    );
    assert.equal(
      isStopTriggered(TradeDirection.LONG, d("96"), d("96.1")),
      false
    );
    assert.equal(
      isTakeProfitTriggered(TradeDirection.LONG, d("110"), d("110.1")),
      true
    );
    assert.equal(
      isTakeProfitTriggered(TradeDirection.LONG, d("110"), d("109.9")),
      false
    );
  });

  it("triggers a short stop on a rising price and a short target on a falling one", () => {
    assert.equal(
      isStopTriggered(TradeDirection.SHORT, d("104"), d("104.1")),
      true
    );
    assert.equal(
      isStopTriggered(TradeDirection.SHORT, d("104"), d("103.9")),
      false
    );
    assert.equal(
      isTakeProfitTriggered(TradeDirection.SHORT, d("90"), d("89.9")),
      true
    );
    assert.equal(
      isTakeProfitTriggered(TradeDirection.SHORT, d("90"), d("90.1")),
      false
    );
  });

  it("treats touching the level exactly as triggered, in both directions", () => {
    assert.equal(isStopTriggered(TradeDirection.LONG, d("96"), d("96")), true);
    assert.equal(
      isStopTriggered(TradeDirection.SHORT, d("104"), d("104")),
      true
    );
    assert.equal(
      isTakeProfitTriggered(TradeDirection.LONG, d("110"), d("110")),
      true
    );
    assert.equal(
      isTakeProfitTriggered(TradeDirection.SHORT, d("90"), d("90")),
      true
    );
  });
});

describe("grossPnl", () => {
  it("is positive for a long that rose and a short that fell", () => {
    assert.equal(
      grossPnl(
        TradeDirection.LONG,
        d("100"),
        d("110"),
        d("2"),
        RoundingMode.FLOOR
      ).toString(),
      "20.000000000000"
    );
    assert.equal(
      grossPnl(
        TradeDirection.SHORT,
        d("100"),
        d("90"),
        d("2"),
        RoundingMode.FLOOR
      ).toString(),
      "20.000000000000"
    );
  });

  it("is negative for a long that fell and a short that rose", () => {
    assert.equal(
      grossPnl(
        TradeDirection.LONG,
        d("100"),
        d("90"),
        d("2"),
        RoundingMode.FLOOR
      ).toString(),
      "-20.000000000000"
    );
    assert.equal(
      grossPnl(
        TradeDirection.SHORT,
        d("100"),
        d("110"),
        d("2"),
        RoundingMode.FLOOR
      ).toString(),
      "-20.000000000000"
    );
  });
});

describe("order sides", () => {
  it("opens long with BUY and short with SELL, and closes with the opposite", () => {
    assert.equal(ENTRY_SIDE.LONG, "BUY");
    assert.equal(EXIT_SIDE.LONG, "SELL");
    assert.equal(ENTRY_SIDE.SHORT, "SELL");
    assert.equal(EXIT_SIDE.SHORT, "BUY");
  });
});
