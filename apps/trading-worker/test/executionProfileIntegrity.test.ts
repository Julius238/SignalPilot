/**
 * Integrity of the stored execution profile (ADR 0023, option W): the pinned
 * reference, the one comparison every read path shares, and the risk job,
 * which must refuse and lock instead of pricing with an unapproved profile.
 * Eligibility, session activation, order, fill, post-fill, exit, valuation
 * and calibration are covered next to their existing tests.
 *
 * Every manipulation keeps the stored hash text of the approved profile
 * unless the hash itself is the manipulation, so a refusal can only come from
 * the values.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus, Prisma } from "@signalpilot/database";
import { buildSpecificationHash } from "@signalpilot/trading-domain";

import { runShadowAssessRisk } from "../src/jobs/shadowAssessRisk.js";
import { BOOTSTRAP_EXECUTION_PROFILES } from "../src/jobs/shadowBootstrap.js";
import { EXECUTION_COST_ESTIMATES } from "../src/jobs/shadowExecutionProfileCalibrate.js";
import {
  APPROVED_EXECUTION_PROFILES_V1,
  EXECUTION_PROFILE_INTEGRITY_VIOLATION,
  activeExecutionProfileDeviations,
  approvedExecutionProfileByHash,
  approvedExecutionProfileHash,
  currentApprovedExecutionProfile,
  executionProfileDeviations,
  riskReducingExecutionProfile,
  type ExecutionProfileRow
} from "../src/lib/executionProfileIntegrity.js";

import { approvedExecutionProfileRow } from "./support/executionProfileRows.js";
import {
  AS_OF,
  RISK_ENABLED_ENV,
  buildRiskWorld,
  createFakeRiskDatabase
} from "./support/shadowRiskFixtures.js";

const OFFICIAL_V1_BTCUSDT_HASH =
  "0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13";
const d = (value: string) => new Prisma.Decimal(value);
const BTC = currentApprovedExecutionProfile("BTCUSDT")!;

const row = (overrides: Record<string, unknown> = {}): ExecutionProfileRow =>
  approvedExecutionProfileRow("BTCUSDT", {
    id: "execution-profile-btc",
    assetId: "asset-btc",
    ...overrides
  }) as unknown as ExecutionProfileRow;

const deviationsOf = (overrides: Record<string, unknown>) =>
  executionProfileDeviations(row(overrides), BTC, { assetId: "asset-btc" });

/**
 * Every manipulation the ADR 0023 probe demonstrated, plus the remaining
 * execution-relevant fields — each must be named on its own.
 */
const MANIPULATIONS: ReadonlyArray<
  readonly [string, Record<string, unknown>, string]
> = [
  ["fee 0 bp", { feeBps: 0 }, "feeBps"],
  ["fee 25 bp (stricter)", { feeBps: 25 }, "feeBps"],
  ["spread 0 bp", { fullSpreadBps: 0 }, "fullSpreadBps"],
  ["spread 20 bp (at the R-018 cap)", { fullSpreadBps: 20 }, "fullSpreadBps"],
  ["slippage 0 bp", { slippageBps: 0 }, "slippageBps"],
  ["slippage 15 bp (at the R-019 cap)", { slippageBps: 15 }, "slippageBps"],
  ["tick size 1e-12", { tickSize: d("0.000000000001") }, "tickSize"],
  ["tick size 1", { tickSize: d("1") }, "tickSize"],
  ["step size 0.001", { stepSize: d("0.001") }, "stepSize"],
  ["minimum quantity 1e-12", { minQuantity: d("0.000000000001") }, "minQuantity"],
  ["minimum notional 1e-12", { minNotional: d("0.000000000001") }, "minNotional"],
  ["minimum notional 1 000 000", { minNotional: d("1000000") }, "minNotional"],
  ["a quantity cap", { maxQuantity: d("0.01") }, "maxQuantity"],
  ["participation 100 %", { maxParticipationRate: d("1") }, "maxParticipationRate"],
  ["a hash text that is no hash", { specificationHash: "not-a-hash" }, "specificationHash"],
  ["another 64-hex hash", { specificationHash: "f".repeat(64) }, "specificationHash"],
  ["version 99", { version: 99 }, "version"],
  ["the bootstrap version 1", { version: 1 }, "version"],
  ["another source", { source: "MANUAL_CONSERVATIVE_V1" }, "source"],
  ["a retired row", { status: "RETIRED" }, "status"],
  ["another asset's row", { assetId: "asset-eth" }, "assetId"]
];

describe("the approved execution profiles", () => {
  it("pin the OFFICIAL_V1 BTCUSDT hash and recompute every pinned hash from the values", () => {
    assert.equal(BTC.specificationHash, OFFICIAL_V1_BTCUSDT_HASH);
    assert.equal(BTC.version, 2);
    for (const profile of APPROVED_EXECUTION_PROFILES_V1)
      assert.equal(approvedExecutionProfileHash(profile), profile.specificationHash, profile.symbol);
  });

  it("are the bootstrap filters plus BINANCE_SPOT_VIP0_ESTIMATE_V1, exactly what calibration writes", () => {
    const estimate = EXECUTION_COST_ESTIMATES.BINANCE_SPOT_VIP0_ESTIMATE_V1;
    for (const profile of APPROVED_EXECUTION_PROFILES_V1) {
      const filters = BOOTSTRAP_EXECUTION_PROFILES[profile.symbol]!;
      assert.equal(
        buildSpecificationHash({ symbol: profile.symbol, version: 2, ...filters, ...estimate }),
        profile.specificationHash,
        profile.symbol
      );
    }
  });

  it("do not approve the bootstrap placeholder MANUAL_CONSERVATIVE_V1", () => {
    const filters = BOOTSTRAP_EXECUTION_PROFILES.BTCUSDT!;
    const placeholder = {
      ...filters,
      version: 1,
      feeBps: 10,
      fullSpreadBps: 10,
      slippageBps: 10,
      maxParticipationRate: "0.010000000000",
      source: "MANUAL_CONSERVATIVE_V1"
    };
    const placeholderRow = {
      ...placeholder,
      status: "ACTIVE",
      specificationHash: buildSpecificationHash({ symbol: "BTCUSDT", ...placeholder })
    };
    assert.deepEqual(executionProfileDeviations(placeholderRow, BTC), [
      "version",
      "source",
      "fullSpreadBps",
      "slippageBps",
      "specificationHash"
    ]);
  });

  it("are found by symbol and by hash, nothing else", () => {
    assert.equal(currentApprovedExecutionProfile("SOLUSDT"), null);
    assert.equal(currentApprovedExecutionProfile(null), null);
    assert.equal(approvedExecutionProfileByHash("BTCUSDT", OFFICIAL_V1_BTCUSDT_HASH), BTC);
    assert.equal(approvedExecutionProfileByHash("BTCUSDT", "f".repeat(64)), null);
    const eth = currentApprovedExecutionProfile("ETHUSDT")!;
    assert.equal(approvedExecutionProfileByHash("BTCUSDT", eth.specificationHash), null);
  });
});

describe("executionProfileDeviations", () => {
  it("accepts the approved profile in every stored form", () => {
    assert.deepEqual(deviationsOf({}), []);
    for (const overrides of [
      {
        tickSize: "0.010000000000",
        stepSize: "0.000010000000",
        minQuantity: "0.000010000000",
        minNotional: "10.000000000000",
        maxParticipationRate: "0.010000000000"
      },
      {
        tickSize: "0.01",
        stepSize: "0.00001",
        minQuantity: "0.00001",
        minNotional: "10",
        maxParticipationRate: "0.01"
      },
      { tickSize: d("0.0100"), minNotional: d("10.0") }
    ])
      assert.deepEqual(deviationsOf(overrides), [], JSON.stringify(overrides));
  });

  for (const [label, overrides, field] of MANIPULATIONS) {
    it(`names ${label} on its own`, () => {
      assert.deepEqual(deviationsOf(overrides), [field]);
    });
  }

  it("refuses every unreadable decimal instead of defaulting it", () => {
    for (const value of ["", "abc", "1e-2", " 0.01", "0,01", "0.0100000000001", null, undefined, {}, Number.NaN])
      assert.deepEqual(deviationsOf({ tickSize: value }), ["tickSize"], String(value));
    assert.deepEqual(deviationsOf({ feeBps: "10" }), ["feeBps"]);
  });

  it("names a symbol without any approved profile", () => {
    assert.deepEqual(executionProfileDeviations(row(), currentApprovedExecutionProfile("SOLUSDT")), ["symbol"]);
  });

  it("checks the order snapshot shape by values and hash alone", () => {
    const snapshot = {
      id: "execution-profile-btc",
      tickSize: "0.010000000000",
      stepSize: "0.000010000000",
      minQuantity: "0.000010000000",
      minNotional: "10.000000000000",
      maxQuantity: null,
      feeBps: 10,
      fullSpreadBps: 2,
      slippageBps: 3,
      maxParticipationRate: "0.010000000000",
      specificationHash: OFFICIAL_V1_BTCUSDT_HASH
    };
    assert.deepEqual(executionProfileDeviations(snapshot, BTC), []);
    assert.deepEqual(executionProfileDeviations({ ...snapshot, feeBps: 0, slippageBps: 0 }, BTC), [
      "feeBps",
      "slippageBps"
    ]);
  });
});

describe("activeExecutionProfileDeviations / riskReducingExecutionProfile", () => {
  it("names a second ACTIVE row and a missing one", () => {
    assert.deepEqual(activeExecutionProfileDeviations({ row: row(), activeCount: 1 }, "BTCUSDT", "asset-btc"), []);
    assert.deepEqual(activeExecutionProfileDeviations({ row: row(), activeCount: 2 }, "BTCUSDT", "asset-btc"), [
      "activeProfileCount"
    ]);
    assert.deepEqual(activeExecutionProfileDeviations({ row: null, activeCount: 0 }, "BTCUSDT", "asset-btc"), [
      "activeProfileCount"
    ]);
  });

  it("prices an approved row exactly as before", () => {
    const resolved = riskReducingExecutionProfile({ row: row(), activeCount: 1 }, "BTCUSDT", "asset-btc");
    assert.equal(resolved.substituted, false);
    assert.deepEqual(resolved.deviations, []);
    assert.deepEqual(resolved.values, {
      id: "execution-profile-btc",
      tickSize: "0.010000000000",
      stepSize: "0.000010000000",
      minQuantity: "0.000010000000",
      minNotional: "10.000000000000",
      maxQuantity: null,
      feeBps: 10,
      fullSpreadBps: 2,
      slippageBps: 3,
      maxParticipationRate: "0.010000000000",
      specificationHash: OFFICIAL_V1_BTCUSDT_HASH
    });
  });

  it("replaces a deviating row with the approved profile, never with the row's numbers", () => {
    const approved = riskReducingExecutionProfile({ row: row(), activeCount: 1 }, "BTCUSDT", "asset-btc").values;
    for (const [label, overrides] of MANIPULATIONS) {
      const resolved = riskReducingExecutionProfile({ row: row(overrides), activeCount: 1 }, "BTCUSDT", "asset-btc");
      assert.equal(resolved.substituted, true, label);
      assert.ok(resolved.deviations.length > 0, label);
      assert.deepEqual(resolved.values, approved, label);
    }
    const twoActive = riskReducingExecutionProfile({ row: row({ feeBps: 0 }), activeCount: 2 }, "BTCUSDT", "asset-btc");
    assert.deepEqual(twoActive.deviations, ["feeBps", "activeProfileCount"]);
    assert.deepEqual(twoActive.values, approved);
  });

  it("keeps the row only where no approved profile exists, and still reports it", () => {
    const resolved = riskReducingExecutionProfile({ row: row(), activeCount: 1 }, "SOLUSDT", "asset-btc");
    assert.equal(resolved.substituted, false);
    assert.deepEqual(resolved.deviations, ["symbol"]);
    assert.equal(resolved.values.feeBps, 10);
  });
});

/** A risk world whose stored execution profile rows are exactly `rows`, in this order. */
const worldWith = (rows: readonly Record<string, unknown>[]) => {
  const world = buildRiskWorld();
  world.executionProfiles.splice(0, world.executionProfiles.length, ...rows);
  return { world, ...createFakeRiskDatabase(world) };
};

const runRiskJob = (database: unknown) =>
  runShadowAssessRisk(database as never, {
    asOf: AS_OF,
    env: RISK_ENABLED_ENV,
    correlationId: "correlation-execution-profile"
  });

const assertRefusedAndLocked = (
  setup: ReturnType<typeof worldWith>,
  summary: Awaited<ReturnType<typeof runRiskJob>>,
  fields: readonly string[],
  label: string
) => {
  const { world, writes } = setup;
  assert.equal(summary.approved, 0, label);
  assert.equal(summary.errored, 1, label);
  assert.equal(summary.assemblerFailures, 0, `${label}: never skipped as an assembler failure`);
  assert.equal(summary.results[0]!.evaluationOutcome, "EXECUTION_PROFILE_INVALID", label);
  assert.equal(writes.botRunUpdates.at(-1)?.status, BotRunStatus.FAILED, label);
  assert.equal(writes.riskAssessments.length, 0, `${label}: nothing is assessed`);
  assert.equal(writes.tradeDecisions.length, 0, `${label}: nothing is decided`);

  const event = writes.riskEvents.find((entry) => entry.reasonCode === EXECUTION_PROFILE_INTEGRITY_VIOLATION);
  assert.equal(event?.severity, "CRITICAL", label);
  assert.equal(event?.type, "CONFIGURATION_INVALID", label);
  assert.deepEqual((event?.payloadJson as { deviations: string[] }).deviations, [...fields], label);

  const session = world.sessions[0]! as Record<string, unknown>;
  assert.equal(session.status, "ERROR_LOCKED", label);
  assert.equal(session.killSwitchEngaged, true, label);
  assert.equal(session.killReasonCode, EXECUTION_PROFILE_INTEGRITY_VIOLATION, label);
  assert.equal(world.portfolios[0]!.status, "ERROR_LOCKED", label);
  const lockAudit = writes.auditEvents.filter((entry) => entry.eventType === "SESSION_ERROR_LOCKED");
  assert.equal(lockAudit.length, 1, label);
  assert.deepEqual((lockAudit[0]!.metadataJson as { deviations: string[] }).deviations, [...fields], label);
  assert.deepEqual(writes.forbiddenWrites, [], label);
};

describe("shadowAssessRisk with a deviating execution profile", () => {
  const riskRow = (overrides: Record<string, unknown> = {}) =>
    approvedExecutionProfileRow("BTCUSDT", { id: "execution-profile-btc", assetId: "asset-btc", ...overrides });

  // The risk snapshot carries no `source` (the hash binds it there), and the
  // assembler's own query already filters status and asset.
  const riskCases = MANIPULATIONS.filter(
    ([, , field]) => field !== "source" && field !== "status" && field !== "assetId"
  );
  for (const [label, overrides, field] of riskCases) {
    it(`refuses ${label} without assessing, with a critical risk event and a lock`, async () => {
      const setup = worldWith([riskRow(overrides)]);
      const summary = await runRiskJob(setup.database);
      assertRefusedAndLocked(setup, summary, [field], label);
    });
  }

  it("refuses a column the assembler cannot read instead of pricing it as zero", async () => {
    const setup = worldWith([riskRow({ stepSize: "0.00001" })]);
    const summary = await runRiskJob(setup.database);
    assertRefusedAndLocked(setup, summary, ["stepSize"], "plain-string column");
  });

  it("refuses a second ACTIVE row, even when the newest one is the approved profile", async () => {
    const setup = worldWith([riskRow(), riskRow({ id: "execution-profile-intruder", version: 1, feeBps: 0 })]);
    const summary = await runRiskJob(setup.database);
    assertRefusedAndLocked(setup, summary, ["activeProfileCount"], "second ACTIVE row");
  });

  it("approves the approved profile in every Prisma decimal form with the same size, and locks nothing", async () => {
    const reference = worldWith([riskRow()]);
    const referenceSummary = await runRiskJob(reference.database);
    assert.equal(referenceSummary.approved, 1);
    const referenceQuantity = reference.writes.riskAssessments[0]!.approvedQuantity;

    const { world, database, writes } = worldWith([
      riskRow({ tickSize: d("0.0100"), stepSize: d("0.000010"), minNotional: d("10.0") })
    ]);
    const summary = await runRiskJob(database);
    assert.equal(summary.approved, 1);
    assert.equal(writes.riskAssessments[0]!.approvedQuantity, referenceQuantity);
    assert.equal(world.sessions[0]!.status, "SHADOW_ACTIVE");
    assert.equal(world.portfolios[0]!.status, "ACTIVE");
    assert.equal(writes.riskEvents.some((entry) => entry.reasonCode === EXECUTION_PROFILE_INTEGRITY_VIOLATION), false);
  });

  it("leaves a missing profile to the engine's own CRITICAL finding", async () => {
    const setup = worldWith([]);
    const summary = await runRiskJob(setup.database);
    assert.equal(summary.approved, 0);
    assert.equal(setup.writes.riskAssessments[0]!.status, "ERROR");
    assert.equal(setup.writes.riskEvents.some((entry) => entry.reasonCode === EXECUTION_PROFILE_INTEGRITY_VIOLATION), false);
  });
});
