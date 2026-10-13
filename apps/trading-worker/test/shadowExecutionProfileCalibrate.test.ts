import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@signalpilot/database";

import {
  CALIBRATION_CONFIRMATION,
  runExecutionProfileCalibration
} from "../src/jobs/shadowExecutionProfileCalibrate.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const AS_OF = new Date("2026-10-13T09:00:00.000Z");
const ENV = {
  ENABLE_LIVE_TRADING: "false",
  TRADING_MODE: "SHADOW",
  TRADING_SHADOW_ENABLED: "true",
  TRADING_BOOTSTRAP_ENABLED: "true",
  TRADING_CODE_VERSION: "test-build"
} as const;
const d = (value: string) => new Prisma.Decimal(value);

function seed() {
  const { database, tables } = createFakeExecutionDatabase();
  const asset = tables.get("asset")!.create({
    data: { symbol: "BTCUSDT", assetType: "CRYPTO", createdAt: new Date("2026-01-01T00:00:00.000Z") }
  });
  tables.get("instrumentExecutionProfile")!.create({
    data: {
      assetId: asset.id,
      version: 1,
      status: "ACTIVE",
      tickSize: d("0.01"),
      stepSize: d("0.00001"),
      minQuantity: d("0.00001"),
      minNotional: d("10"),
      maxQuantity: null,
      feeBps: 10,
      fullSpreadBps: 10,
      slippageBps: 10,
      maxParticipationRate: d("0.01"),
      source: "MANUAL_CONSERVATIVE_V1",
      activeAssetKey: `active-${asset.id}`
    }
  });
  return { database, tables };
}

describe("execution profile calibration", () => {
  it("refuses without the exact confirmation and without the bootstrap flag", async () => {
    const { database, tables } = seed();
    const noConfirmation = await runExecutionProfileCalibration(database as never, { asOf: AS_OF, env: ENV });
    assert.equal(noConfirmation.blockReasonCode, "CONFIRMATION_REQUIRED");
    const noFlag = await runExecutionProfileCalibration(database as never, {
      asOf: AS_OF,
      env: { ...ENV, TRADING_BOOTSTRAP_ENABLED: "false" },
      confirmation: CALIBRATION_CONFIRMATION
    });
    assert.equal(noFlag.blocked, true);
    assert.equal(tables.get("instrumentExecutionProfile")!.rows.length, 1);
  });

  it("adds a new active version with the documented costs and retires the placeholder, idempotently", async () => {
    const { database, tables } = seed();
    const first = await runExecutionProfileCalibration(database as never, {
      asOf: AS_OF,
      env: ENV,
      confirmation: CALIBRATION_CONFIRMATION
    });
    assert.equal(first.blocked, false);
    assert.deepEqual(first.results.map((row) => [row.symbol, row.outcome, row.previousVersion, row.activeVersion]), [
      ["BTCUSDT", "CREATED", 1, 2]
    ]);
    const profiles = tables.get("instrumentExecutionProfile")!.rows.sort((a, b) => Number(a.version) - Number(b.version));
    assert.deepEqual(
      profiles.map((row) => [row.version, row.status, row.feeBps, row.fullSpreadBps, row.slippageBps]),
      [
        [1, "RETIRED", 10, 10, 10],
        [2, "ACTIVE", 10, 2, 3]
      ]
    );
    assert.equal(profiles[0]!.activeAssetKey, null);
    assert.equal(profiles[1]!.tickSize, "0.010000000000");
    assert.equal(profiles[1]!.source, "BINANCE_SPOT_VIP0_ESTIMATE_V1");
    assert.equal(
      tables.get("tradingAuditEvent")!.rows.filter((row) => row.eventType === "EXECUTION_PROFILE_CALIBRATED").length,
      1
    );

    const second = await runExecutionProfileCalibration(database as never, {
      asOf: new Date(AS_OF.getTime() + 60_000),
      env: ENV,
      confirmation: CALIBRATION_CONFIRMATION
    });
    assert.equal(second.results[0]!.outcome, "UNCHANGED");
    assert.equal(tables.get("instrumentExecutionProfile")!.rows.length, 2);
  });
});
