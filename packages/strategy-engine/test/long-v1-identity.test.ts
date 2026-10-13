import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
  StrategyReasonCode,
  evaluateStrategy,
  type StrategyCandidateResultV1,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { buildPassingSnapshot, clone } from "./support/build-snapshot.js";

function asLongV1(snapshot: StrategyInputSnapshotV1): StrategyInputSnapshotV1 {
  const next = clone(snapshot);
  next.strategy = {
    ...next.strategy,
    strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH
  };
  return next;
}

function withTick(snapshot: StrategyInputSnapshotV1, tickSize: string): StrategyInputSnapshotV1 {
  const next = clone(snapshot);
  next.executionProfile = { ...next.executionProfile!, tickSize };
  return next;
}

const dec = (value: string) => DecimalValue.fromString(value);

describe("CRYPTO_MTF_BREAKOUT_LONG_V1 — identity", () => {
  it("evaluates a snapshot declaring the LONG identity and stamps that identity", () => {
    const result = evaluateStrategy(asLongV1(buildPassingSnapshot()));
    assert.equal(result.outcome, "CANDIDATE", result.reasonCodes.join(","));
    const { candidate } = result as StrategyCandidateResultV1;
    assert.equal(result.strategyKey, CRYPTO_MTF_BREAKOUT_LONG_V1_KEY);
    assert.equal(candidate.strategyKey, CRYPTO_MTF_BREAKOUT_LONG_V1_KEY);
    assert.equal(candidate.engineVersion, CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION);
    assert.equal(candidate.specificationHash, CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH);
  });

  it("stamps refusals with the LONG identity too", () => {
    const snapshot = clone(asLongV1(buildPassingSnapshot()));
    snapshot.marketRegime = { ...snapshot.marketRegime!, cryptoRegime: "RISK_OFF" };
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.equal(result.strategyKey, CRYPTO_MTF_BREAKOUT_LONG_V1_KEY);
  });

  it("still refuses a LONG snapshot carrying the legacy engine version", () => {
    const snapshot = clone(asLongV1(buildPassingSnapshot()));
    snapshot.strategy = { ...snapshot.strategy, engineVersion: "crypto-mtf-breakout-v1/1.0.0" };
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.STRATEGY_ENGINE_VERSION_MISMATCH));
  });
});

describe("CRYPTO_MTF_BREAKOUT_LONG_V1 — tick-aligned price plan", () => {
  for (const tickSize of ["0.010000000000", "0.100000000000", "1.000000000000", "5.000000000000"]) {
    it(`puts stop and take profit on the ${tickSize} grid, conservatively`, () => {
      const legacy = evaluateStrategy(withTick(buildPassingSnapshot(), tickSize));
      const current = evaluateStrategy(asLongV1(withTick(buildPassingSnapshot(), tickSize)));
      assert.equal(legacy.outcome, "CANDIDATE");
      assert.equal(current.outcome, "CANDIDATE", current.reasonCodes.join(","));
      const before = (legacy as StrategyCandidateResultV1).candidate;
      const after = (current as StrategyCandidateResultV1).candidate;
      const tick = dec(tickSize);

      assert.ok(dec(after.stopPrice).isMultipleOf(tick), after.stopPrice);
      assert.ok(dec(after.takeProfitPrice).isMultipleOf(tick), after.takeProfitPrice);
      // The stop only ever moves away from the entry, by less than one tick.
      assert.ok(dec(after.stopPrice).lte(dec(before.stopPrice)));
      assert.ok(dec(before.stopPrice).sub(dec(after.stopPrice)).lt(tick));
      // The target is 2.5R of the distance actually traded, rounded towards the entry.
      const fullTarget = dec(after.referenceEntryPrice).add(dec("2.5").mul(dec(after.stopDistance)));
      assert.ok(dec(after.takeProfitPrice).lte(fullTarget));
      assert.ok(fullTarget.sub(dec(after.takeProfitPrice)).lt(tick));
      // The plan stays internally consistent and above the strategy floor.
      assert.equal(
        dec(after.referenceEntryPrice).sub(dec(after.stopPrice)).toString(),
        dec(after.stopDistance).toString()
      );
      assert.ok(dec(after.plannedRewardRisk).gte(dec("2")));
    });
  }

  it("refuses the plan when the execution profile carries no usable tick", () => {
    const result = evaluateStrategy(asLongV1(withTick(buildPassingSnapshot(), "0.000000000000")));
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.PRICE_TICK_SIZE_INVALID));
  });
});
