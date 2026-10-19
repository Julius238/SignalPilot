import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@signalpilot/database";

import {
  CALIBRATION_CONFIRMATION,
  runExecutionProfileCalibration
} from "../src/jobs/shadowExecutionProfileCalibrate.js";
import { currentApprovedExecutionProfile } from "../src/lib/executionProfileIntegrity.js";
import { approvedExecutionProfileRow } from "./support/executionProfileRows.js";
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

function seed(placeholderOverrides: Record<string, unknown> = {}) {
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
      activeAssetKey: `active-${asset.id}`,
      ...placeholderOverrides
    }
  });
  return { database, tables, asset };
}

const calibrate = (database: unknown, minutes = 0) =>
  runExecutionProfileCalibration(database as never, {
    asOf: new Date(AS_OF.getTime() + minutes * 60_000),
    env: ENV,
    confirmation: CALIBRATION_CONFIRMATION
  });
const APPROVED = currentApprovedExecutionProfile("BTCUSDT")!;

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

  it("writes exactly the approved profile, hash included", async () => {
    const { database, tables } = seed();
    await calibrate(database);
    const created = tables.get("instrumentExecutionProfile")!.rows.find((row) => row.version === 2)!;
    assert.equal(created.specificationHash, APPROVED.specificationHash);
    assert.equal(created.specificationHash, "0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13");
  });

  it("takes the filters from the approved profile, never from a deviating placeholder row", async () => {
    const { database, tables } = seed({ tickSize: d("1"), stepSize: d("0.001") });
    const result = await calibrate(database);
    assert.equal(result.results[0]!.outcome, "CREATED");
    const created = tables.get("instrumentExecutionProfile")!.rows.find((row) => row.version === 2)!;
    assert.equal(created.tickSize, APPROVED.tickSize);
    assert.equal(created.stepSize, APPROVED.stepSize);
    assert.equal(created.specificationHash, APPROVED.specificationHash);
  });

  it("refuses a deviating row of the approved version instead of stacking a version on it", async () => {
    const { database, tables, asset } = seed();
    await calibrate(database);
    const active = tables.get("instrumentExecutionProfile")!.rows.find((row) => row.version === 2)!;
    Object.assign(active, { feeBps: 0 });
    const result = await calibrate(database, 1);
    assert.equal(result.status, "FAILED");
    assert.equal(result.blockReasonCode, "EXECUTION_PROFILE_CONFLICT");
    assert.deepEqual(
      result.results.map((row) => [row.symbol, row.outcome, row.deviations]),
      [["BTCUSDT", "REFUSED", ["feeBps"]]]
    );
    const rows = tables.get("instrumentExecutionProfile")!.rows.filter((row) => row.assetId === asset.id);
    assert.equal(rows.length, 2, "nothing written");
    assert.equal(active.status, "ACTIVE");
  });

  it("refuses two ACTIVE rows", async () => {
    const { database, tables, asset } = seed();
    tables.get("instrumentExecutionProfile")!.create({
      data: approvedExecutionProfileRow("BTCUSDT", { assetId: asset.id })
    });
    const result = await calibrate(database);
    assert.equal(result.results[0]!.outcome, "REFUSED");
    assert.equal(tables.get("instrumentExecutionProfile")!.rows.length, 2);
  });

  it("leaves an already approved active profile untouched", async () => {
    const { database, tables, asset } = seed({ status: "RETIRED", activeAssetKey: null });
    tables.get("instrumentExecutionProfile")!.create({
      data: approvedExecutionProfileRow("BTCUSDT", { assetId: asset.id })
    });
    const result = await calibrate(database);
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.results[0]!.outcome, "UNCHANGED");
    assert.equal(tables.get("instrumentExecutionProfile")!.rows.length, 2);
  });
});
