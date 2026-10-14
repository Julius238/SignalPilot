import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH
} from "@signalpilot/strategy-engine";
import { buildSpecificationHash } from "@signalpilot/trading-domain";

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
  tables
    .get("portfolio")!
    .create({ data: { key: "SHADOW_CHALLENGER_V1", status: "DRAFT" } });
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
  it("creates legacy/current/trend-core/challenger long and short assignments disabled and idempotently", async () => {
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
    assert.equal(tables.get("strategy")!.rows.length, 5);
    assert.equal(tables.get("strategyVersion")!.rows.length, 5);
    assert.equal(tables.get("strategyAssignment")!.rows.length, 8);
    assert.ok(
      tables
        .get("strategyAssignment")!
        .rows.every((row) => row.enabled === false)
    );
    assert.deepEqual(
      first.entries.map((entry) => entry.direction),
      ["LONG", "LONG", "LONG", "LONG", "SHORT"]
    );
    // The challenger trades BTC only, in its own portfolio.
    const challenger = first.entries.find((entry) => entry.strategyKey === "CRYPTO_REGIME_LONG_V1");
    assert.ok(challenger !== undefined);
    assert.equal(challenger.portfolioKey, "SHADOW_CHALLENGER_V1");
    assert.equal(challenger.specificationHash, CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH);
    assert.deepEqual(
      challenger.assignments.map((assignment) => [assignment.symbol, assignment.enabled]),
      [["BTCUSDT", false]]
    );
    const challengerPortfolio = tables.get("portfolio")!.rows.find((row) => row.key === "SHADOW_CHALLENGER_V1")!;
    const challengerAssignment = tables
      .get("strategyAssignment")!
      .rows.find((row) => row.id === challenger.assignments[0]!.strategyAssignmentId)!;
    assert.equal(challengerAssignment.portfolioId, challengerPortfolio.id);
    assert.ok(
      first.entries
        .filter((entry) => entry.strategyKey !== "CRYPTO_REGIME_LONG_V1")
        .every((entry) => entry.portfolioKey === "SHADOW_V1")
    );
    const trendCore = first.entries.find((entry) => entry.strategyKey === "CRYPTO_TREND_CORE_LONG_V1");
    assert.ok(trendCore !== undefined);
    assert.deepEqual(
      trendCore.assignments.map((assignment) => [assignment.symbol, assignment.enabled]),
      [
        ["BTCUSDT", false],
        ["ETHUSDT", false]
      ]
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
    assert.equal(tables.get("strategy")!.rows.length, 5);
    assert.equal(tables.get("strategyVersion")!.rows.length, 5);
    assert.equal(tables.get("strategyAssignment")!.rows.length, 8);
    assert.equal(tables.get("tradingAuditEvent")!.rows.length, 8);
  });

  it("supersedes a changed specification with a new immutable version and re-pins disabled assignments", async () => {
    const { database, tables } = seedPrerequisites();
    const first = await runShadowStrategySetup(database as never, { asOf: AS_OF, env: ENV });
    assert.equal(first.blocked, false);

    // Simulate a database set up by an earlier build, whose LONG version still
    // carried the 1.0.0 (untick-aligned) specification.
    const strategyRow = tables
      .get("strategy")!
      .rows.find((row) => row.key === CRYPTO_MTF_BREAKOUT_LONG_V1_KEY)!;
    const oldParameters = { ...CRYPTO_MTF_BREAKOUT_V1_PARAMETERS, key: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY };
    const versionRow = tables
      .get("strategyVersion")!
      .rows.find((row) => row.strategyId === strategyRow.id)!;
    versionRow.engineVersion = "crypto-mtf-breakout-v1/1.0.0";
    versionRow.parametersJson = oldParameters;
    versionRow.specificationHash = buildSpecificationHash(oldParameters);

    const second = await runShadowStrategySetup(database as never, {
      asOf: new Date(AS_OF.getTime() + 1_000),
      env: ENV
    });
    assert.equal(second.blocked, false, String(second.blockReasonCode));
    const longVersions = tables
      .get("strategyVersion")!
      .rows.filter((row) => row.strategyId === strategyRow.id)
      .sort((a, b) => Number(a.version) - Number(b.version));
    assert.deepEqual(
      longVersions.map((row) => [row.version, row.status]),
      [
        [1, "RETIRED"],
        [2, "ACTIVE"]
      ]
    );
    assert.equal(longVersions[1]!.specificationHash, CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH);
    const longAssignments = tables
      .get("strategyAssignment")!
      .rows.filter((row) => row.strategyId === strategyRow.id);
    assert.equal(longAssignments.length, 2);
    for (const row of longAssignments) {
      assert.equal(row.strategyVersionId, longVersions[1]!.id);
      assert.equal(row.enabled, false);
    }
    assert.equal(
      tables
        .get("tradingAuditEvent")!
        .rows.filter((row) => row.eventType === "SHADOW_STRATEGY_ASSIGNMENT_REPINNED").length,
      2
    );
  });

  it("refuses without the challenger portfolio and names the bootstrap that creates it", async () => {
    const { database, tables } = seedPrerequisites();
    const rows = tables.get("portfolio")!.rows;
    rows.splice(rows.findIndex((row) => row.key === "SHADOW_CHALLENGER_V1"), 1);
    const result = await runShadowStrategySetup(database as never, { asOf: AS_OF, env: ENV });
    assert.equal(result.blocked, true);
    assert.equal(result.blockReasonCode, "SHADOW_PORTFOLIO_MISSING");
    assert.equal(tables.get("strategy")!.rows.length, 0);
  });

  it("leaves an assignment enabled during a forward test exactly as it is", async () => {
    const { database, tables } = seedPrerequisites();
    const first = await runShadowStrategySetup(database as never, { asOf: AS_OF, env: ENV });
    const trendCoreBtc = first.entries
      .find((entry) => entry.strategyKey === "CRYPTO_TREND_CORE_LONG_V1")!
      .assignments.find((assignment) => assignment.symbol === "BTCUSDT")!;
    const row = tables.get("strategyAssignment")!.rows.find((entry) => entry.id === trendCoreBtc.strategyAssignmentId)!;
    row.enabled = true;
    const before = { ...row };

    const second = await runShadowStrategySetup(database as never, {
      asOf: new Date(AS_OF.getTime() + 1_000),
      env: ENV
    });
    assert.equal(second.blocked, false, String(second.blockReasonCode));
    assert.deepEqual({ ...row }, before);
    assert.equal(
      second.entries
        .find((entry) => entry.strategyKey === "CRYPTO_TREND_CORE_LONG_V1")!
        .assignments.find((assignment) => assignment.symbol === "BTCUSDT")!.enabled,
      true
    );
  });

  it("refuses to re-pin an enabled assignment of a superseded version", async () => {
    const { database, tables } = seedPrerequisites();
    await runShadowStrategySetup(database as never, { asOf: AS_OF, env: ENV });
    const strategyRow = tables
      .get("strategy")!
      .rows.find((row) => row.key === CRYPTO_MTF_BREAKOUT_LONG_V1_KEY)!;
    const oldParameters = { ...CRYPTO_MTF_BREAKOUT_V1_PARAMETERS, key: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY };
    const versionRow = tables.get("strategyVersion")!.rows.find((row) => row.strategyId === strategyRow.id)!;
    versionRow.engineVersion = "crypto-mtf-breakout-v1/1.0.0";
    versionRow.parametersJson = oldParameters;
    versionRow.specificationHash = buildSpecificationHash(oldParameters);
    tables.get("strategyAssignment")!.rows.find((row) => row.strategyId === strategyRow.id)!.enabled = true;

    const second = await runShadowStrategySetup(database as never, {
      asOf: new Date(AS_OF.getTime() + 1_000),
      env: ENV
    });
    assert.equal(second.blocked, true);
    assert.equal(second.blockReasonCode, "ASSIGNMENT_ALREADY_ENABLED");
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

  it("reuses an immutable version under a later build and reports the build it was created with", async () => {
    const { database, tables } = seedPrerequisites();
    const first = await runShadowStrategySetup(database as never, {
      asOf: AS_OF,
      env: ENV
    });
    assert.equal(first.blocked, false);

    const second = await runShadowStrategySetup(database as never, {
      asOf: new Date(AS_OF.getTime() + 1_000),
      env: { ...ENV, TRADING_CODE_VERSION: "different-build" }
    });
    assert.equal(second.blocked, false);
    // Same engine and specification hash: no new version, the original build stays recorded.
    assert.equal(tables.get("strategyVersion")!.rows.length, 5);
    assert.ok(second.entries.every((entry) => entry.versionCodeVersion === ENV.TRADING_CODE_VERSION));
  });

  it("still refuses a version whose stored parameters no longer match its hash", async () => {
    const { database, tables } = seedPrerequisites();
    assert.equal((await runShadowStrategySetup(database as never, { asOf: AS_OF, env: ENV })).blocked, false);
    const version = tables.get("strategyVersion")!.rows.find((row) => row.engineVersion === "crypto-mtf-breakout-v1/1.2.0")!;
    version.parametersJson = { ...(version.parametersJson as Record<string, unknown>), takeProfitRMultiple: "4" };
    const second = await runShadowStrategySetup(database as never, { asOf: new Date(AS_OF.getTime() + 1_000), env: ENV });
    assert.equal(second.blocked, true);
    assert.equal(second.blockReasonCode, "STRATEGY_VERSION_CONFLICT");
  });
});
