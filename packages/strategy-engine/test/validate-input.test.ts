import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STRATEGY_INPUT_SNAPSHOT_VERSION,
  StrategyReasonCode,
  validateStrategyInput,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { AS_OF, buildPassingSnapshot, clone } from "./support/build-snapshot.js";
import { ETH_BASE_SNAPSHOT, REJECTION_CASES } from "./support/rejection-cases.js";

const failureCodes = (snapshot: StrategyInputSnapshotV1): readonly StrategyReasonCode[] => {
  const result = validateStrategyInput(snapshot);
  return result.ok ? [] : result.failures;
};

describe("validateStrategyInput", () => {
  it("accepts the pinned passing snapshot", () => {
    const result = validateStrategyInput(buildPassingSnapshot());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.validated.series["1h"].candles.length, 250);
    assert.equal(result.validated.series["1h"].anchor.id, "btcusdt-1h-249");
    assert.ok(result.checks.every((check) => check.passed));
  });

  it("rejects an unsupported snapshot version", () => {
    const snapshot = { ...buildPassingSnapshot(), snapshotVersion: "STRATEGY_INPUT_SNAPSHOT_V2" };
    assert.deepEqual(failureCodes(snapshot as unknown as StrategyInputSnapshotV1), [
      StrategyReasonCode.SNAPSHOT_VERSION_UNSUPPORTED
    ]);
    assert.equal(STRATEGY_INPUT_SNAPSHOT_VERSION, "STRATEGY_INPUT_SNAPSHOT_V1");
  });

  it("rejects a non-ISO timestamp instead of guessing a locale", () => {
    const snapshot = { ...buildPassingSnapshot(), asOf: "2026-08-02 09:05:00" };
    assert.deepEqual(failureCodes(snapshot as StrategyInputSnapshotV1), [
      StrategyReasonCode.SNAPSHOT_TIMESTAMP_MALFORMED
    ]);
  });

  it("accepts exactly 200 candles and refuses 199", () => {
    const base = buildPassingSnapshot();

    const with200 = clone(base);
    with200.series["1h"] = {
      ...with200.series["1h"],
      candles: base.series["1h"].candles.slice(-200)
    };
    assert.ok(!failureCodes(with200).includes(StrategyReasonCode.CANDLES_INSUFFICIENT_HISTORY));

    const with199 = clone(base);
    with199.series["1h"] = {
      ...with199.series["1h"],
      candles: base.series["1h"].candles.slice(-199)
    };
    assert.ok(failureCodes(with199).includes(StrategyReasonCode.CANDLES_INSUFFICIENT_HISTORY));
  });

  it("treats a candle closing after asOf as not closed", () => {
    const snapshot = clone(buildPassingSnapshot());
    const candles = [...snapshot.series["1h"].candles];
    const anchor = candles[candles.length - 1];
    candles[candles.length - 1] = {
      ...anchor,
      closeTime: new Date(Date.parse(AS_OF) + 1).toISOString()
    };
    snapshot.series["1h"] = { ...snapshot.series["1h"], candles };

    assert.ok(failureCodes(snapshot).includes(StrategyReasonCode.CANDLE_NOT_CLOSED));
  });

  it("accepts a 1h candle exactly at the 2h15 freshness boundary and refuses 1 ms later", () => {
    const base = buildPassingSnapshot();
    const anchorCloseMs = Date.parse(base.series["1h"].candles.at(-1)!.closeTime);
    const boundaryMs = 2 * 60 * 60 * 1000 + 15 * 60 * 1000;

    const onBoundary = clone(base);
    // Only the observation time moves; the data quality snapshot follows so the
    // candle freshness rule is the one under test.
    const atBoundary = new Date(anchorCloseMs + boundaryMs).toISOString();
    onBoundary.asOf = atBoundary;
    for (const timeframe of ["1h", "4h", "1d"] as const) {
      onBoundary.series[timeframe].dataQuality = {
        ...onBoundary.series[timeframe].dataQuality!,
        observedAt: atBoundary
      };
    }
    onBoundary.marketRegime = { ...onBoundary.marketRegime!, generatedAt: atBoundary };
    assert.ok(!failureCodes(onBoundary).includes(StrategyReasonCode.DATA_STALE_CANDLES_1H));

    const pastBoundary = clone(onBoundary);
    const oneMsLater = new Date(anchorCloseMs + boundaryMs + 1).toISOString();
    pastBoundary.asOf = oneMsLater;
    assert.ok(failureCodes(pastBoundary).includes(StrategyReasonCode.DATA_STALE_CANDLES_1H));
  });

  it("refuses a data quality snapshot older than two hours", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.series["1h"].dataQuality = {
      ...snapshot.series["1h"].dataQuality!,
      observedAt: "2026-08-02T06:00:00.000Z"
    };
    assert.ok(failureCodes(snapshot).includes(StrategyReasonCode.DATA_STALE_DATA_QUALITY));
  });

  it("refuses a provider error in the data quality snapshot", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.series["4h"].dataQuality = {
      ...snapshot.series["4h"].dataQuality!,
      providerErrorCount: 1
    };
    assert.ok(failureCodes(snapshot).includes(StrategyReasonCode.DATA_QUALITY_PROVIDER_ERROR));
  });

  it("refuses a signal created after asOf", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.signals["4h"] = { ...snapshot.signals["4h"]!, createdAt: "2026-08-02T09:06:00.000Z" };
    assert.ok(failureCodes(snapshot).includes(StrategyReasonCode.SIGNAL_TIMESTAMP_AFTER_AS_OF));
  });

  it("requires the 1h signal to belong to the anchor candle", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.signals["1h"] = { ...snapshot.signals["1h"]!, createdAt: "2026-08-02T07:30:00.000Z" };
    assert.ok(failureCodes(snapshot).includes(StrategyReasonCode.SIGNAL_NOT_ANCHORED_TO_CANDLE));
  });

  it("requires the context event list, even when empty", () => {
    const snapshot = clone(buildPassingSnapshot()) as Record<string, unknown>;
    delete snapshot.contextEvents;
    assert.ok(
      failureCodes(snapshot as unknown as StrategyInputSnapshotV1).includes(
        StrategyReasonCode.SNAPSHOT_MALFORMED
      )
    );
  });

  it("never mutates the snapshot it validates", () => {
    const snapshot = buildPassingSnapshot();
    const before = JSON.stringify(snapshot);
    validateStrategyInput(snapshot);
    assert.equal(JSON.stringify(snapshot), before);
  });

  it("covers every documented pre-validation refusal", () => {
    const preValidationCases = REJECTION_CASES.filter(
      (testCase) => testCase.expectedOutcome === "INVALID_INPUT"
    );
    assert.ok(preValidationCases.length >= 15);

    for (const testCase of preValidationCases) {
      const codes = failureCodes(testCase.mutate(ETH_BASE_SNAPSHOT()));
      assert.ok(
        codes.includes(testCase.expectedReasonCode),
        `${testCase.name} expected ${testCase.expectedReasonCode}, got ${codes.join(",")}`
      );
    }
  });
});
