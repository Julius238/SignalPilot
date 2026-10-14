import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue, buildSpecificationHash } from "@signalpilot/trading-domain";

import {
  CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_NATIVE_REGIME_SOURCE,
  CRYPTO_TREND_CORE_LONG_V1_ENGINE_VERSION,
  CRYPTO_TREND_CORE_LONG_V1_KEY,
  CRYPTO_TREND_CORE_LONG_V1_PARAMETERS,
  CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH,
  StrategyReasonCode,
  evaluateStrategy,
  type StrategyCandidateResultV1,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { buildPassingSnapshot, clone } from "./support/build-snapshot.js";

const dec = (value: string) => DecimalValue.fromString(value);

function asTrendCore(snapshot: StrategyInputSnapshotV1, regimeSource: string | null = CRYPTO_NATIVE_REGIME_SOURCE) {
  const next = clone(snapshot) as { -readonly [K in keyof StrategyInputSnapshotV1]: StrategyInputSnapshotV1[K] };
  next.strategy = {
    ...next.strategy,
    strategyKey: CRYPTO_TREND_CORE_LONG_V1_KEY,
    engineVersion: CRYPTO_TREND_CORE_LONG_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH
  };
  const { source: _ignored, ...regime } = next.marketRegime!;
  void _ignored;
  next.marketRegime = regimeSource === null ? regime : { ...regime, source: regimeSource };
  return next as StrategyInputSnapshotV1;
}

describe("CRYPTO_TREND_CORE_LONG_V1", () => {
  it("is its own versioned identity with a hash over its parameters", () => {
    assert.equal(CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH, buildSpecificationHash(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS));
    assert.notEqual(CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH, CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH);
    assert.equal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.regimeSource, CRYPTO_NATIVE_REGIME_SOURCE);
    assert.equal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.direction, "LONG");
  });

  it("evaluates under its own identity with a 3R target on the tick grid", () => {
    const result = evaluateStrategy(asTrendCore(buildPassingSnapshot()));
    assert.equal(result.outcome, "CANDIDATE", result.reasonCodes.join(","));
    const { candidate } = result as StrategyCandidateResultV1;
    assert.equal(candidate.strategyKey, CRYPTO_TREND_CORE_LONG_V1_KEY);
    assert.equal(candidate.specificationHash, CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH);
    assert.ok(dec(candidate.stopDistancePct).gte(dec("0.0175")), candidate.stopDistancePct);
    const fullTarget = dec(candidate.referenceEntryPrice).add(dec("3").mul(dec(candidate.stopDistance)));
    assert.ok(dec(candidate.takeProfitPrice).lte(fullTarget));
    assert.ok(fullTarget.sub(dec(candidate.takeProfitPrice)).lt(dec("0.01")));
  });

  it("takes a setup that LONG_V1 refuses only for the signal-engine confirmation", () => {
    const snapshot = clone(buildPassingSnapshot()) as { -readonly [K in keyof StrategyInputSnapshotV1]: StrategyInputSnapshotV1[K] };
    snapshot.signals = { ...snapshot.signals, "1h": { ...snapshot.signals["1h"]!, direction: "NEUTRAL" } };
    const longV1 = clone(snapshot as StrategyInputSnapshotV1) as typeof snapshot;
    longV1.strategy = {
      ...longV1.strategy,
      strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
      engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
      specificationHash: CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH
    };
    const refused = evaluateStrategy(longV1 as StrategyInputSnapshotV1);
    assert.equal(refused.outcome, "NO_CANDIDATE");
    assert.ok(refused.reasonCodes.includes(StrategyReasonCode.SIGNAL_1H_DIRECTION_NOT_BULLISH));

    const taken = evaluateStrategy(asTrendCore(snapshot as StrategyInputSnapshotV1));
    assert.equal(taken.outcome, "CANDIDATE", taken.reasonCodes.join(","));
  });

  it("refuses the equity-dependent production regime instead of falling back to it", () => {
    const result = evaluateStrategy(asTrendCore(buildPassingSnapshot(), null));
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REGIME_SOURCE_MISMATCH));
  });

  it("still requires a crypto RISK_ON regime", () => {
    const snapshot = asTrendCore(buildPassingSnapshot()) as { -readonly [K in keyof StrategyInputSnapshotV1]: StrategyInputSnapshotV1[K] };
    snapshot.marketRegime = { ...snapshot.marketRegime!, cryptoRegime: "NEUTRAL" };
    const result = evaluateStrategy(snapshot as StrategyInputSnapshotV1);
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REGIME_NOT_RISK_ON));
  });

  it("leaves LONG_V1 on the production regime: a crypto-native report is refused there", () => {
    const snapshot = clone(buildPassingSnapshot()) as { -readonly [K in keyof StrategyInputSnapshotV1]: StrategyInputSnapshotV1[K] };
    snapshot.strategy = {
      ...snapshot.strategy,
      strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
      engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
      specificationHash: CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH
    };
    snapshot.marketRegime = { ...snapshot.marketRegime!, source: CRYPTO_NATIVE_REGIME_SOURCE };
    const result = evaluateStrategy(snapshot as StrategyInputSnapshotV1);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REGIME_SOURCE_MISMATCH));
  });
});
