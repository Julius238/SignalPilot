import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue, buildSpecificationHash } from "@signalpilot/trading-domain";

import {
  CRYPTO_NATIVE_REGIME_SOURCE,
  CRYPTO_REGIME_LONG_V1_ENGINE_VERSION,
  CRYPTO_REGIME_LONG_V1_KEY,
  CRYPTO_REGIME_LONG_V1_PARAMETERS,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH,
  REGIME_EXIT_POLICY,
  StrategyReasonCode,
  averageTrueRange,
  evaluateStrategy,
  regimeGateOpen,
  type RegimeStrategyIndicatorSnapshotV1,
  type StrategyCandidateResultV1,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { buildPassingSnapshot, clone } from "./support/build-snapshot.js";

type Mutable = { -readonly [K in keyof StrategyInputSnapshotV1]: StrategyInputSnapshotV1[K] };
const dec = (value: string) => DecimalValue.fromString(value);

function asRegimeLong(snapshot: StrategyInputSnapshotV1, regimeSource: string | null = CRYPTO_NATIVE_REGIME_SOURCE): Mutable {
  const next = clone(snapshot) as Mutable;
  next.strategy = {
    ...next.strategy,
    strategyKey: CRYPTO_REGIME_LONG_V1_KEY,
    engineVersion: CRYPTO_REGIME_LONG_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH
  };
  const { source: _ignored, ...regime } = next.marketRegime!;
  void _ignored;
  next.marketRegime = regimeSource === null ? regime : { ...regime, source: regimeSource };
  return next;
}

describe("CRYPTO_REGIME_LONG_V1", () => {
  it("is its own versioned identity with the regime exit in its hashed parameters", () => {
    assert.equal(CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH, buildSpecificationHash(CRYPTO_REGIME_LONG_V1_PARAMETERS));
    assert.notEqual(CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH, CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH);
    assert.equal(CRYPTO_REGIME_LONG_V1_PARAMETERS.exitPolicy, REGIME_EXIT_POLICY);
    assert.equal(CRYPTO_REGIME_LONG_V1_PARAMETERS.regimeSource, CRYPTO_NATIVE_REGIME_SOURCE);
    // No breakout, momentum, volume or signal rule is part of the specification.
    for (const key of ["rsiMinimum", "relativeVolumeMinimum", "breakoutLookback", "signalDirection1h", "stopDistanceCapPct"]) {
      assert.equal(key in CRYPTO_REGIME_LONG_V1_PARAMETERS, false, key);
    }
  });

  it("enters on an open regime gate with a 2 × ATR(1d) stop and a 4R target on the tick grid", () => {
    const snapshot = asRegimeLong(buildPassingSnapshot());
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "CANDIDATE", result.reasonCodes.join(","));
    const { candidate } = result as StrategyCandidateResultV1;
    assert.equal(candidate.strategyKey, CRYPTO_REGIME_LONG_V1_KEY);
    assert.equal(candidate.maxHoldHours, 720);

    const indicators = candidate.indicators as RegimeStrategyIndicatorSnapshotV1;
    assert.equal(indicators.regimeSource, CRYPTO_NATIVE_REGIME_SOURCE);
    const atr1d = dec(indicators.atr14_1d);
    const entry = dec(candidate.referenceEntryPrice);
    const stop = dec(candidate.stopPrice);
    // Stop on the tick grid, at least 2 × ATR(1d) and less than one tick more below the entry.
    assert.ok(stop.isMultipleOf(dec("0.01")));
    const rawStop = entry.sub(dec("2").mul(atr1d));
    assert.ok(stop.lte(rawStop));
    assert.ok(rawStop.sub(stop).lt(dec("0.01")));
    const target = entry.add(dec("4").mul(dec(candidate.stopDistance)));
    assert.ok(dec(candidate.takeProfitPrice).lte(target));
    assert.ok(target.sub(dec(candidate.takeProfitPrice)).lt(dec("0.01")));
    // ATR of the daily candles the snapshot carries.
    assert.equal(
      atr1d.toString(),
      averageTrueRange(
        snapshot.series["1d"].candles.map((candle) => ({
          high: dec(candle.high),
          low: dec(candle.low),
          close: dec(candle.close)
        })) as never,
        14
      )!.toString()
    );
  });

  it("needs no breakout, trend or signal confirmation", () => {
    const snapshot = asRegimeLong(buildPassingSnapshot());
    snapshot.signals = { ...snapshot.signals, "1h": { ...snapshot.signals["1h"]!, direction: "BEARISH" } };
    assert.equal(evaluateStrategy(snapshot).outcome, "CANDIDATE");
  });

  for (const [label, change, code] of [
    ["crypto regime MIXED", { cryptoRegime: "MIXED" }, StrategyReasonCode.REGIME_NOT_RISK_ON],
    ["risk mode DEFENSIVE", { riskMode: "DEFENSIVE" }, StrategyReasonCode.REGIME_RISK_MODE_BLOCKED],
    ["confidence 59", { confidence: 59 }, StrategyReasonCode.REGIME_CONFIDENCE_BELOW_MINIMUM]
  ] as const) {
    it(`stays flat when the gate is closed: ${label}`, () => {
      const snapshot = asRegimeLong(buildPassingSnapshot());
      snapshot.marketRegime = { ...snapshot.marketRegime!, ...change };
      const result = evaluateStrategy(snapshot);
      assert.equal(result.outcome, "NO_CANDIDATE");
      assert.ok(result.reasonCodes.includes(code), result.reasonCodes.join(","));
    });
  }

  it("refuses the equity-dependent production regime", () => {
    const result = evaluateStrategy(asRegimeLong(buildPassingSnapshot(), null));
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REGIME_SOURCE_MISMATCH));
  });

  it("uses one gate definition for entry and exit", () => {
    assert.equal(regimeGateOpen({ cryptoRegime: "RISK_ON", riskMode: "NORMAL", confidence: 90 }), true);
    assert.equal(regimeGateOpen({ cryptoRegime: "RISK_ON", riskMode: "AGGRESSIVE", confidence: 60 }), true);
    assert.equal(regimeGateOpen({ cryptoRegime: "RISK_ON", riskMode: "DEFENSIVE", confidence: 90 }), false);
    assert.equal(regimeGateOpen({ cryptoRegime: "NEUTRAL", riskMode: "NORMAL", confidence: 90 }), false);
    assert.equal(regimeGateOpen({ cryptoRegime: "RISK_ON", riskMode: "NORMAL", confidence: Number.NaN }), false);
  });
});
