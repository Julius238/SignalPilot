import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTradingApiConfig } from "../src/lib/tradingApiConfig.js";

describe("resolveTradingApiConfig", () => {
  it("disables everything by default with an empty environment", () => {
    const result = resolveTradingApiConfig({});
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.readEnabled, false);
    assert.equal(result.config.operationsEnabled, false);
  });

  it("fails closed on an unrecognised TRADING_API_ENABLED value", () => {
    const result = resolveTradingApiConfig({ TRADING_API_ENABLED: "yes" });
    assert.equal(result.ok, false);
  });

  it("enables reads only when TRADING_API_ENABLED=true and operations flag is unset", () => {
    const result = resolveTradingApiConfig({ TRADING_API_ENABLED: "true" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.readEnabled, true);
    assert.equal(result.config.operationsEnabled, false);
  });

  it("does not enable operations from TRADING_API_OPERATIONS_ENABLED alone without the shadow base gate", () => {
    const result = resolveTradingApiConfig({
      TRADING_API_ENABLED: "true",
      TRADING_API_OPERATIONS_ENABLED: "true"
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.operationsEnabled, false, "shadow base gate (TRADING_MODE etc.) is still required");
  });

  it("enables operations once the full shadow-only base gate also holds", () => {
    const result = resolveTradingApiConfig({
      TRADING_API_ENABLED: "true",
      TRADING_API_OPERATIONS_ENABLED: "true",
      ENABLE_LIVE_TRADING: "false",
      TRADING_MODE: "SHADOW",
      TRADING_SHADOW_ENABLED: "true"
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.readEnabled, true);
    assert.equal(result.config.operationsEnabled, true);
  });

  it("never enables operations when ENABLE_LIVE_TRADING=true", () => {
    const result = resolveTradingApiConfig({
      TRADING_API_ENABLED: "true",
      TRADING_API_OPERATIONS_ENABLED: "true",
      ENABLE_LIVE_TRADING: "true",
      TRADING_MODE: "SHADOW",
      TRADING_SHADOW_ENABLED: "true"
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.operationsEnabled, false);
  });
});
