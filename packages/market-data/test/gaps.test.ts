import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectCandleGaps } from "../src/gaps.js";

describe("candle gap detection", () => {
  it("detects a continuous gap and reports it repaired after the missing candle is added", () => {
    const now = new Date("2026-01-01T05:00:00.000Z");
    const candles = [candle(0), candle(1), candle(3), candle(4)];
    const before = detectCandleGaps(candles, {
      timeframe: "1h",
      marketKind: "CONTINUOUS",
      now
    });

    assert.equal(before.gapCount, 1);
    assert.equal(before.missingCandleCount, 1);
    assert.equal(before.gaps[0].from.toISOString(), "2026-01-01T02:00:00.000Z");

    const after = detectCandleGaps([...candles, candle(2)], {
      timeframe: "1h",
      marketKind: "CONTINUOUS",
      now
    });
    assert.equal(after.gapCount, 0);
    assert.equal(after.expectedCandleCount, 5);
  });

  it("does not treat the overnight equity session as an hourly gap", () => {
    const audit = detectCandleGaps(
      [
        {
          openTime: new Date("2026-01-05T20:00:00.000Z"),
          closeTime: new Date("2026-01-05T21:00:00.000Z")
        },
        {
          openTime: new Date("2026-01-06T14:00:00.000Z"),
          closeTime: new Date("2026-01-06T15:00:00.000Z")
        }
      ],
      {
        timeframe: "1h",
        marketKind: "SESSION",
        now: new Date("2026-01-06T16:00:00.000Z")
      }
    );

    assert.equal(audit.gapCount, 0);
  });
});

function candle(hour: number) {
  const openTime = new Date("2026-01-01T00:00:00.000Z");
  openTime.setUTCHours(hour);
  const closeTime = new Date(openTime.getTime() + 60 * 60 * 1000);
  return { openTime, closeTime };
}
