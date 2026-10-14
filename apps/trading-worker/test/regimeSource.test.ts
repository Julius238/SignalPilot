import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CRYPTO_NATIVE_REGIME_SOURCE } from "@signalpilot/strategy-engine";

import { regimeSourceOf, selectRegimeForStrategy } from "../src/lib/regimeSource.js";

const stored = {
  id: "regime-1",
  generatedAt: new Date("2026-10-14T12:00:00.000Z"),
  equityRegime: "UNKNOWN",
  cryptoRegime: "RISK_ON",
  overallRegime: "NEUTRAL",
  riskMode: "NORMAL",
  confidence: 38,
  reportJson: {
    cryptoNative: { equityRegime: "UNKNOWN", cryptoRegime: "RISK_ON", overallRegime: "RISK_ON", riskMode: "AGGRESSIVE", confidence: 90 }
  }
};

describe("regime selection per strategy version", () => {
  it("reads the declared regime model from the version parameters", () => {
    assert.equal(regimeSourceOf({ direction: "LONG" }), null);
    assert.equal(regimeSourceOf({ regimeSource: CRYPTO_NATIVE_REGIME_SOURCE }), CRYPTO_NATIVE_REGIME_SOURCE);
    assert.equal(regimeSourceOf(null), null);
  });

  it("gives the production columns to a strategy without a declared model", () => {
    const regime = selectRegimeForStrategy(stored, null);
    assert.equal(regime?.confidence, 38);
    assert.equal(regime?.source, undefined);
  });

  it("gives the stored crypto-native report, labelled with its source, to a crypto-native strategy", () => {
    const regime = selectRegimeForStrategy(stored, CRYPTO_NATIVE_REGIME_SOURCE);
    assert.equal(regime?.confidence, 90);
    assert.equal(regime?.riskMode, "AGGRESSIVE");
    assert.equal(regime?.source, CRYPTO_NATIVE_REGIME_SOURCE);
    assert.equal(regime?.generatedAt, stored.generatedAt);
  });

  it("fails closed for a missing report or an unknown model", () => {
    assert.equal(selectRegimeForStrategy({ ...stored, reportJson: {} }, CRYPTO_NATIVE_REGIME_SOURCE), null);
    assert.equal(selectRegimeForStrategy(stored, "some-other-regime/1.0.0"), null);
    assert.equal(selectRegimeForStrategy(null, null), null);
  });
});
