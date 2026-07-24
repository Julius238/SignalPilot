import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessCandleSeriesQuality,
  defaultMaxCandleAgeMs,
  isCandleClosed,
  timeframeDurationMs
} from "../src/index.js";

describe("candle quality", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("excludes open candles from analysis", () => {
    const quality = assessCandleSeriesQuality(
      [
        { closeTime: new Date("2026-07-24T10:59:59.999Z"), value: 1 },
        { closeTime: new Date("2026-07-24T11:59:59.999Z"), value: 2 },
        { closeTime: new Date("2026-07-24T12:59:59.999Z"), value: 3 }
      ],
      {
        now,
        timeframe: "1h",
        marketKind: "CONTINUOUS",
        minimumClosedCandles: 2
      }
    );

    assert.equal(quality.reason, "OK");
    assert.equal(quality.openOrInvalidCandleCount, 1);
    assert.deepEqual(quality.closedCandles.map((candle) => candle.value), [1, 2]);
  });

  it("rejects stale continuous data", () => {
    const quality = assessCandleSeriesQuality(
      [{ closeTime: new Date("2026-07-24T08:00:00.000Z") }],
      {
        now,
        timeframe: "1h",
        marketKind: "CONTINUOUS",
        minimumClosedCandles: 1
      }
    );

    assert.equal(quality.reason, "STALE_DATA");
    assert.equal(quality.isFresh, false);
  });

  it("uses a session-aware freshness window for equities", () => {
    assert.equal(defaultMaxCandleAgeMs("1h", "SESSION"), 4 * 24 * 60 * 60 * 1000);
    assert.equal(defaultMaxCandleAgeMs("1d", "SESSION"), 5 * 24 * 60 * 60 * 1000);
    assert.equal(timeframeDurationMs("4h"), 4 * 60 * 60 * 1000);
    assert.equal(isCandleClosed({ closeTime: new Date("2026-07-24T13:00:00.000Z") }, now), false);
  });
});
