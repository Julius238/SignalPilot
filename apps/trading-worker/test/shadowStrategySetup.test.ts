import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH } from "@signalpilot/strategy-engine";

import { runShadowStrategySetup } from "../src/jobs/shadowStrategySetup.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const AS_OF = new Date("2026-08-03T12:00:00.000Z");
const ENV = {
  ENABLE_LIVE_TRADING: "false",
  TRADING_MODE: "SHADOW",
  TRADING_SHADOW_ENABLED: "true",
  TRADING_BOOTSTRAP_ENABLED: "true",
  TRADING_CODE_VERSION: "739edfb-test"
} as const;

function seedPrerequisites() {
  const { database, tables } = createFakeExecutionDatabase();
  tables
    .get("portfolio")!
    .create({ data: { key: "SHADOW_V1", status: "DRAFT" } });
  tables.get("asset")!.create({
    data: {
      symbol: "BTCUSDT",
      assetType: "CRYPTO",
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  tables.get("asset")!.create({
    data: {
      symbol: "ETHUSDT",
      assetType: "CRYPTO",
      createdAt: new Date("2026-01-01T00:00:01.000Z")
    }
  });
  return { database, tables };
}

describe("runShadowStrategySetup", () => {
  it("creates legacy/current long and short BTC/ETH assignments disabled and idempotently", async () => {
    const { database, tables } = seedPrerequisites();

    const first = await runShadowStrategySetup(database as never, {
      asOf: AS_OF,
      env: ENV,
      correlationId: "strategy-setup-1"
    });
    assert.equal(first.blocked, false);
    assert.equal(first.assignmentEnabled, false);
    assert.equal(
      first.specificationHash,
      CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
    );
    assert.equal(tables.get("strategy")!.rows.length, 3);
    assert.equal(tables.get("strategyVersion")!.rows.length, 3);
    assert.equal(tables.get("strategyAssignment")!.rows.length, 5);
    assert.ok(
      tables
        .get("strategyAssignment")!
        .rows.every((row) => row.enabled === false)
    );
    assert.deepEqual(
      first.entries.map((entry) => entry.direction),
      ["LONG", "LONG", "SHORT"]
    );
    assert.equal(
      tables.get("tradingSession")!.rows.length,
      0,
      "strategy setup must not touch a session"
    );

    const second = await runShadowStrategySetup(database as never, {
      asOf: new Date(AS_OF.getTime() + 1_000),
      env: ENV,
      correlationId: "strategy-setup-2"
    });
    assert.equal(second.blocked, false);
    assert.equal(tables.get("strategy")!.rows.length, 3);
    assert.equal(tables.get("strategyVersion")!.rows.length, 3);
    assert.equal(tables.get("strategyAssignment")!.rows.length, 5);
    assert.equal(tables.get("tradingAuditEvent")!.rows.length, 5);
  });

  it("fails closed without the dedicated bootstrap flag", async () => {
    const { database, tables } = seedPrerequisites();
    const result = await runShadowStrategySetup(database as never, {
      asOf: AS_OF,
      env: { ...ENV, TRADING_BOOTSTRAP_ENABLED: "false" }
    });
    assert.equal(result.blocked, true);
    assert.equal(tables.get("strategy")!.rows.length, 0);
    assert.equal(tables.get("strategyAssignment")!.rows.length, 0);
  });

  it("refuses to reuse an immutable version from a different code build", async () => {
    const { database } = seedPrerequisites();
    const first = await runShadowStrategySetup(database as never, {
      asOf: AS_OF,
      env: ENV
    });
    assert.equal(first.blocked, false);

    const second = await runShadowStrategySetup(database as never, {
      asOf: new Date(AS_OF.getTime() + 1_000),
      env: { ...ENV, TRADING_CODE_VERSION: "different-build" }
    });
    assert.equal(second.blocked, true);
    assert.equal(second.blockReasonCode, "STRATEGY_VERSION_CONFLICT");
  });
});
