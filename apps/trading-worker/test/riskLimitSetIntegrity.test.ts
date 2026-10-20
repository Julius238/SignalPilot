/**
 * Worker side of the limit-set integrity check (ADR 0021, option A): the
 * shared row mapping, the risk job (which must refuse loudly and lock, never
 * skip) and the bootstrap. Eligibility and the post-fill recheck are covered
 * next to their existing tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus, Prisma } from "@signalpilot/database";
import {
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RiskReasonCode,
  evaluateRisk
} from "@signalpilot/risk-engine";

import { runShadowAssessRisk } from "../src/jobs/shadowAssessRisk.js";
import {
  RISK_LIMIT_SET_CONFLICT,
  runShadowBootstrap
} from "../src/jobs/shadowBootstrap.js";
import { assembleRiskInput } from "../src/lib/riskInputAssembler.js";
import {
  riskLimitSetInputFromRow,
  riskLimitSetRowDeviations,
  type RiskLimitSetRow
} from "../src/lib/riskLimitSetIntegrity.js";
import { RISK_LIMIT_SET_INTEGRITY_VIOLATION } from "../src/lib/shadowRiskPersistence.js";

import { pinnedRiskLimitSetRow } from "./support/riskLimitSetRows.js";
import {
  AS_OF,
  BOOTSTRAP_ENABLED_ENV,
  RISK_ENABLED_ENV,
  buildRiskWorld,
  createFakeRiskDatabase
} from "./support/shadowRiskFixtures.js";

const CAPABILITY = {
  buildCapability: "SHADOW_ONLY",
  tradingMode: "SHADOW",
  enableLiveTrading: false,
  shadowMasterFlagEnabled: true,
  riskJobEnabled: true,
  strategyLongV1Enabled: true,
  strategyShortV1Enabled: false,
  shadowShortEnabled: false,
  exchangeExecutionEnabled: false,
  marginTradingEnabled: false,
  futuresTradingEnabled: false
};

const row = (overrides: Record<string, unknown> = {}): RiskLimitSetRow =>
  pinnedRiskLimitSetRow({ id: "risk-limit-set-1", ...overrides }) as unknown as RiskLimitSetRow;

/** A risk world whose stored limit set rows are exactly `rows`, in this order. */
const worldWith = (rows: readonly RiskLimitSetRow[]) => {
  const world = buildRiskWorld();
  const stored = world.riskLimitSets as unknown as RiskLimitSetRow[];
  stored.splice(0, stored.length, ...rows);
  return { world, ...createFakeRiskDatabase(world) };
};

const runRiskJob = (database: unknown) =>
  runShadowAssessRisk(database as never, {
    asOf: AS_OF,
    env: RISK_ENABLED_ENV,
    correlationId: "correlation-limit-set"
  });

describe("riskLimitSetInputFromRow / riskLimitSetRowDeviations", () => {
  it("renders Prisma decimals with 12 places, as the snapshot always carried them", () => {
    const input = riskLimitSetInputFromRow(row());
    assert.equal(input.maxRiskPerTradePct, "0.002500000000");
    assert.equal(input.maxDailyLossPct, "0.010000000000");
    assert.equal(input.minRewardRisk, "2.000000000000");
    assert.equal(input.specificationHash, RISK_LIMIT_SET_SPECIFICATION_HASH);
    assert.deepEqual(riskLimitSetRowDeviations(row()), []);
  });

  it("accepts every decimal form of the pinned values", () => {
    for (const overrides of [
      { maxRiskPerTradePct: new Prisma.Decimal("0.00250") },
      { maxRiskPerTradePct: "0.0025" },
      { maxRiskPerTradePct: "0.002500000000" },
      { minRewardRisk: new Prisma.Decimal("2.000") }
    ]) {
      assert.deepEqual(riskLimitSetRowDeviations(row(overrides)), [], JSON.stringify(overrides));
    }
  });

  it("never turns an unreadable column into a default value", () => {
    for (const value of [null, undefined, {}, "2.5e-3", ""]) {
      const input = riskLimitSetInputFromRow(row({ maxRiskPerTradePct: value }));
      assert.notEqual(input.maxRiskPerTradePct, "0.000000000000");
      assert.deepEqual(
        riskLimitSetRowDeviations(row({ maxRiskPerTradePct: value })),
        ["maxRiskPerTradePct"],
        String(value)
      );
    }
  });

  it("names a raised percentage although the stored hash still matches", () => {
    assert.deepEqual(
      riskLimitSetRowDeviations(row({ maxRiskPerTradePct: new Prisma.Decimal("0.01") })),
      ["maxRiskPerTradePct"]
    );
  });
});

describe("risk input assembler", () => {
  it("passes a deviating set on unchanged instead of filtering or skipping it", async () => {
    const { database } = worldWith([row({ maxRiskPerTradePct: new Prisma.Decimal("0.01") })]);
    const assembled = await assembleRiskInput(database as never, {
      tradeCandidateId: "trade-candidate-1",
      asOf: AS_OF,
      codeVersion: "test-code-version",
      capability: CAPABILITY
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;
    assert.equal(assembled.snapshot.riskLimitSet?.id, "risk-limit-set-1");
    assert.equal(assembled.snapshot.riskLimitSet?.maxRiskPerTradePct, "0.010000000000");
    assert.equal(evaluateRisk(assembled.snapshot).outcome, "ERROR");
  });
});

describe("shadowAssessRisk with a deviating risk limit set", () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
    ["a raised risk per trade", { maxRiskPerTradePct: new Prisma.Decimal("0.01") }, ["maxRiskPerTradePct"]],
    ["a loosened daily loss limit", { maxDailyLossPct: new Prisma.Decimal("0.05") }, ["maxDailyLossPct"]],
    ["a lowered minimum reward/risk", { minRewardRisk: new Prisma.Decimal("1") }, ["minRewardRisk"]],
    ["a foreign key", { key: "SOMETHING_ELSE" }, ["key"]],
    ["a foreign version", { version: 2 }, ["version"]],
    ["a foreign scope", { scope: "STRATEGY" }, ["scope"]],
    ["an unreadable decimal", { maxGrossExposurePct: null }, ["maxGrossExposurePct"]]
  ];

  for (const [label, overrides, fields] of cases) {
    it(`refuses ${label} with ERROR, a critical risk event and an ERROR_LOCK`, async () => {
      const { world, database, writes } = worldWith([row(overrides)]);
      const summary = await runRiskJob(database);

      assert.equal(summary.approved, 0);
      assert.equal(summary.errored, 1);
      assert.equal(summary.assemblerFailures, 0, "never skipped as an assembler failure");
      assert.equal(writes.botRunUpdates.at(-1)?.status, BotRunStatus.FAILED);

      assert.equal(writes.riskAssessments.length, 1);
      assert.equal(writes.riskAssessments[0]!.status, "ERROR");
      assert.equal(writes.riskAssessments[0]!.approvedQuantity, "0.000000000000");
      assert.equal(writes.tradeDecisions[0]!.outcome, "ERROR");

      const r026 = writes.riskRuleResults.find((rule) => rule.ruleCode === "R-026-IDEMPOTENCY-VERSION")!;
      assert.equal(r026.outcome, "ERROR");
      assert.equal(r026.severity, "CRITICAL");
      assert.deepEqual(
        (r026.inputJson as { riskLimitSetDeviations: string[] }).riskLimitSetDeviations,
        [...fields]
      );

      const criticalEvent = writes.riskEvents.find(
        (event) => event.reasonCode === RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT
      );
      assert.equal(criticalEvent?.severity, "CRITICAL");

      const session = world.sessions[0]!;
      assert.equal(session.status, "ERROR_LOCKED");
      assert.equal(session.killSwitchEngaged, true);
      assert.equal(
        (session as Record<string, unknown>).killReasonCode,
        RISK_LIMIT_SET_INTEGRITY_VIOLATION
      );
      assert.equal(world.portfolios[0]!.status, "ERROR_LOCKED");

      const lockAudit = writes.auditEvents.filter((event) => event.eventType === "SESSION_ERROR_LOCKED");
      assert.equal(lockAudit.length, 1);
      assert.deepEqual((lockAudit[0]!.metadataJson as { deviations: string[] }).deviations, [...fields]);
      assert.deepEqual(writes.forbiddenWrites, []);
    });
  }

  it("refuses a second ACTIVE set the assembler picks as the newest version", async () => {
    // The assembler reads the highest ACTIVE PORTFOLIO version; the fake
    // returns the first row, so the intruder stands first.
    const { world, database, writes } = worldWith([
      row({ id: "risk-limit-set-intruder", key: "SHADOW_V1", version: 2 }),
      row()
    ]);
    const summary = await runRiskJob(database);
    assert.equal(summary.approved, 0);
    assert.equal(writes.riskAssessments[0]!.status, "ERROR");
    assert.equal(world.sessions[0]!.status, "ERROR_LOCKED");
  });

  it("approves the authentic set in every database decimal form with the same size, and locks nothing", async () => {
    const reference = worldWith([row()]);
    const referenceSummary = await runRiskJob(reference.database);
    assert.equal(referenceSummary.approved, 1);
    const referenceQuantity = reference.writes.riskAssessments[0]!.approvedQuantity;

    for (const overrides of [
      { maxRiskPerTradePct: new Prisma.Decimal("0.00250"), minRewardRisk: new Prisma.Decimal("2.0") },
      { maxDailyLossPct: "0.01", maxGrossExposurePct: "0.400000000000" }
    ]) {
      const { world, database, writes } = worldWith([row(overrides)]);
      const summary = await runRiskJob(database);
      assert.equal(summary.approved, 1, JSON.stringify(overrides));
      assert.equal(writes.riskAssessments[0]!.approvedQuantity, referenceQuantity);
      assert.equal(world.sessions[0]!.status, "SHADOW_ACTIVE");
      assert.equal(world.portfolios[0]!.status, "ACTIVE");
      assert.equal(writes.auditEvents.some((event) => event.eventType === "SESSION_ERROR_LOCKED"), false);
    }
  });
});

describe("shadowBootstrap with an existing deviating risk limit set", () => {
  it("blocks before any write instead of reusing the row", async () => {
    const { database, writes } = worldWith([row({ maxRiskPerTradePct: new Prisma.Decimal("0.01") })]);
    const summary = await runShadowBootstrap(database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "bootstrap-limit-set"
    });

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.blocked, true);
    assert.equal(summary.blockReasonCode, RISK_LIMIT_SET_CONFLICT);
    assert.equal(summary.riskLimitSetId, "risk-limit-set-1");
    assert.equal(writes.botRunUpdates.at(-1)?.status, BotRunStatus.FAILED);
    for (const table of [
      writes.portfolios,
      writes.ledgerEntries,
      writes.portfolioSnapshots,
      writes.riskLimitSets,
      writes.executionProfiles,
      writes.sessions,
      writes.auditEvents
    ]) {
      assert.equal(table.length, 0);
    }
  });

  it("still reuses the authentic row", async () => {
    const { database, writes } = worldWith([row()]);
    const summary = await runShadowBootstrap(database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "bootstrap-limit-set"
    });
    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.riskLimitSetId, "risk-limit-set-1");
    assert.equal(writes.riskLimitSets.length, 0);
  });
});
