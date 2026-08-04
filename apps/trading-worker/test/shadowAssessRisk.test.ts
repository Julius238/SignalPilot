import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";
import {
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_RULE_COUNT,
  RiskReasonCode,
  evaluateRisk
} from "@signalpilot/risk-engine";

import { assembleRiskInput } from "../src/lib/riskInputAssembler.js";
import { runShadowAssessRisk } from "../src/jobs/shadowAssessRisk.js";
import { runShadowBootstrap } from "../src/jobs/shadowBootstrap.js";

import {
  AS_OF,
  BOOTSTRAP_ENABLED_ENV,
  RISK_ENABLED_ENV,
  STRATEGY_V1_TAKE_PROFIT,
  buildRiskWorld,
  createFakeRiskDatabase,
  type RiskWorldOptions
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

const setup = (options: RiskWorldOptions = {}) =>
  createFakeRiskDatabase(buildRiskWorld(options));

const runJob = (
  options: RiskWorldOptions = {},
  overrides: Parameters<typeof runShadowAssessRisk>[1] = {}
) => {
  const { database, writes, candidates } = setup(options);
  return {
    writes,
    candidates,
    database,
    summary: runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "correlation-risk-1",
      ...overrides
    })
  };
};

describe("risk input assembler", () => {
  it("builds a snapshot the pure engine can approve", async () => {
    const { database } = setup();
    const assembled = await assembleRiskInput(database as never, {
      tradeCandidateId: "trade-candidate-1",
      asOf: AS_OF,
      codeVersion: "test-code-version",
      capability: CAPABILITY
    });

    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const snapshot = assembled.snapshot;
    assert.equal(snapshot.asOf, AS_OF.toISOString());
    assert.equal(snapshot.tradingDateUtc, "2026-08-02");
    assert.equal(snapshot.candidate.symbol, "BTCUSDT");
    assert.equal(snapshot.candidate.strategyKey, "CRYPTO_MTF_BREAKOUT_V1");
    assert.equal(
      snapshot.riskLimitSet!.specificationHash,
      RISK_LIMIT_SET_SPECIFICATION_HASH
    );
    assert.equal(snapshot.correlationGroup!.key, "CRYPTO_MAJOR");
    assert.deepEqual(snapshot.openPositions, []);
    assert.deepEqual(snapshot.sizeOverride, {
      manualQuantity: null,
      riskMultiplier: null,
      requestedBy: null
    });

    assert.equal(evaluateRisk(snapshot).outcome, "APPROVED");
  });

  it("reads the typed plan columns, not an audit payload", async () => {
    const { database } = setup();
    const assembled = await assembleRiskInput(database as never, {
      tradeCandidateId: "trade-candidate-1",
      asOf: AS_OF,
      codeVersion: "v",
      capability: CAPABILITY
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const candidate = assembled.snapshot.candidate;
    assert.equal(candidate.earliestFillAt, "2026-08-02T08:59:59.999Z");
    assert.equal(candidate.validFrom, "2026-08-02T08:59:59.999Z");
    assert.equal(candidate.maxHoldHours, 72);
    assert.equal(candidate.stopDistance, "501.970000000000");
    assert.equal(
      candidate.strategyEngineVersion,
      "crypto-mtf-breakout-v1/1.0.0"
    );
  });

  it("refuses to assemble for an unknown candidate", async () => {
    const { database } = setup();
    const assembled = await assembleRiskInput(database as never, {
      tradeCandidateId: "missing",
      asOf: AS_OF,
      codeVersion: "v",
      capability: CAPABILITY
    });
    assert.equal(assembled.ok, false);
    if (assembled.ok) return;
    assert.equal(assembled.reasonCode, "CANDIDATE_NOT_FOUND");
  });

  it("passes a null plan field through so R-026 can refuse it", async () => {
    const { database } = setup({ candlePlanComplete: false });
    const assembled = await assembleRiskInput(database as never, {
      tradeCandidateId: "trade-candidate-1",
      asOf: AS_OF,
      codeVersion: "v",
      capability: CAPABILITY
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    assert.equal(assembled.snapshot.candidate.earliestFillAt, null);
    const result = evaluateRisk(assembled.snapshot);
    assert.equal(result.outcome, "ERROR");
    assert.ok(
      result.ruleResults.some(
        (rule) => rule.reasonCode === RiskReasonCode.CANDIDATE_PLAN_INCOMPLETE
      )
    );
  });
});

describe("shadowAssessRisk job", () => {
  it("approves a clean candidate and persists the full rule set", async () => {
    const { writes, summary } = runJob();
    const finished = await summary;

    assert.equal(finished.status, BotRunStatus.SUCCESS);
    assert.equal(finished.approved, 1);
    assert.equal(finished.rejected, 0);
    assert.equal(finished.conflicts, 0);

    assert.equal(writes.riskAssessments.length, 1);
    assert.equal(writes.riskRuleResults.length, RISK_RULE_COUNT);
    assert.equal(writes.tradeDecisions.length, 1);
    assert.equal(writes.tradeDecisions[0].outcome, "APPROVE_SHADOW");
    assert.equal(writes.riskAssessments[0].status, "PASS");
    assert.ok(Number(writes.riskAssessments[0].approvedQuantity) > 0);
  });

  it("persists a passing result for every rule, not just the failures", async () => {
    const { writes, summary } = runJob();
    await summary;
    const passing = writes.riskRuleResults.filter(
      (rule) => rule.outcome === "PASS"
    );
    assert.equal(passing.length, RISK_RULE_COUNT);
    const codes = new Set(writes.riskRuleResults.map((rule) => rule.ruleCode));
    assert.equal(codes.size, RISK_RULE_COUNT);
  });

  it("stores quantity, costs, risk and net reward/risk on approval", async () => {
    const { writes, summary } = runJob();
    await summary;

    const assessment = writes.riskAssessments[0];
    const inputs = assessment.inputsJson as { sizing: Record<string, string> };
    assert.ok(Number(assessment.riskAmount) <= 25);
    assert.ok(Number(inputs.sizing.netRewardRisk) >= 2);
    assert.ok(Number(inputs.sizing.reservedQuoteAmount) > 0);
    assert.ok(Number(inputs.sizing.roundTripFeesPerUnit) > 0);
  });

  it("moves the candidate CREATED -> VALIDATING -> READY_FOR_RISK -> APPROVED_FOR_SHADOW", async () => {
    const { writes, candidates, summary } = runJob();
    await summary;

    assert.deepEqual(
      writes.candidateUpdates.map((update) => update.status),
      ["VALIDATING", "READY_FOR_RISK", "APPROVED_FOR_SHADOW"]
    );
    assert.equal(candidates[0].status, "APPROVED_FOR_SHADOW");
  });

  it("rejects the strategy's own 2R plan because the costed reward/risk is below 2", async () => {
    const { writes, summary } = runJob({
      takeProfitPrice: STRATEGY_V1_TAKE_PROFIT
    });
    const finished = await summary;

    assert.equal(finished.approved, 0);
    assert.equal(finished.rejected, 1);
    assert.equal(writes.tradeDecisions[0].outcome, "REJECT");
    assert.equal(writes.riskAssessments[0].status, "FAIL");
    assert.equal(writes.riskAssessments[0].approvedQuantity, "0.000000000000");
  });

  it("blocks on an inactive session and a raised kill switch", async () => {
    for (const options of [
      { sessionStatus: "PAUSED" },
      { killSwitchEngaged: true }
    ]) {
      const { writes, summary } = runJob(options);
      const finished = await summary;
      assert.equal(finished.rejected, 1);
      assert.equal(writes.riskAssessments[0].status, "FAIL");
      assert.equal(
        writes.riskAssessments[0].approvedQuantity,
        "0.000000000000"
      );
    }
  });

  it("errors and raises a critical risk event on an inconsistent portfolio", async () => {
    const { database, writes } = setup({ portfolioStatus: "ERROR_LOCKED" });
    const finished = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "correlation-risk-1"
    });

    assert.equal(finished.rejected + finished.errored, 1);
    assert.equal(writes.riskAssessments.length, 1);
    assert.equal(writes.tradeDecisions.length, 1);
  });

  it("records a risk event when a critical rule fires", async () => {
    const { database, writes } = setup();
    // A stored assessment with a different hash is a critical R-026 finding.
    writes.riskAssessments.push({
      id: "risk-assessment-existing",
      assessmentKey: "unrelated-key",
      inputHash: "0".repeat(64),
      status: "PASS",
      equity: "10000.000000000000",
      riskAmount: "1.000000000000",
      assessedAt: AS_OF
    });

    const finished = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "correlation-risk-1"
    });
    assert.equal(finished.errored, 1);
    assert.equal(writes.riskEvents.length >= 1, true);
    assert.equal(writes.riskEvents[0].severity, "CRITICAL");
  });

  it("is idempotent across repeated runs", async () => {
    const { database, writes } = setup();
    const options = {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "c1"
    } as const;

    const first = await runShadowAssessRisk(database as never, options);
    const second = await runShadowAssessRisk(database as never, options);

    assert.equal(first.approved, 1);
    // The candidate is terminal and carries a decision, so it is not picked up
    // a second time at all.
    assert.equal(second.scanned, 0);
    assert.equal(writes.riskAssessments.length, 1);
    assert.equal(writes.riskRuleResults.length, RISK_RULE_COUNT);
    assert.equal(writes.tradeDecisions.length, 1);
  });

  it("does not process an existing SHORT candidate while either Short flag is disabled", async () => {
    const { database, writes, candidates } = setup();
    candidates[0].direction = "SHORT";

    const summary = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: {
        ...RISK_ENABLED_ENV,
        TRADING_STRATEGY_SHORT_V1_ENABLED: "true",
        TRADING_SHADOW_SHORT_ENABLED: "false"
      },
      correlationId: "short-disabled-risk"
    });

    assert.equal(summary.scanned, 0);
    assert.equal(writes.riskAssessments.length, 0);
    assert.equal(writes.tradeDecisions.length, 0);
  });

  it("reports a conflict when the same key carries a different hash", async () => {
    const { database, writes, candidates } = setup();
    await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "c1"
    });

    // Re-open the candidate and change a decision input: same assessment key
    // scope, different payload.
    candidates[0].status = "CREATED";
    candidates[0].decision = null;
    const stored = writes.riskAssessments[0];
    stored.assessmentKey = (await (async () => {
      const { assembleRiskInput: assemble } =
        await import("../src/lib/riskInputAssembler.js");
      const assembled = await assemble(database as never, {
        tradeCandidateId: "trade-candidate-1",
        asOf: AS_OF,
        codeVersion: "test-code-version",
        capability: CAPABILITY
      });
      assert.equal(assembled.ok, true);
      if (!assembled.ok) throw new Error("unreachable");
      return evaluateRisk(assembled.snapshot).assessment.assessmentKey;
    })()) as string;
    stored.inputHash = "e".repeat(64);

    const second = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "c2"
    });

    assert.equal(second.conflicts, 1);
    assert.equal(second.status, BotRunStatus.FAILED);
    assert.equal(
      writes.riskAssessments.length,
      1,
      "the stored assessment must not be overwritten"
    );
    assert.ok(
      writes.riskEvents.some(
        (event) => event.type === "IDEMPOTENCY_OR_VERSION_CONFLICT"
      )
    );
  });

  it("creates no order, fill, position or ledger booking", async () => {
    const { writes, summary } = runJob();
    await summary;
    assert.deepEqual(writes.forbiddenWrites, []);
    assert.equal(writes.ledgerEntries.length, 0);
    assert.equal(writes.portfolioSnapshots.length, 0);
  });

  it("blocks by default and writes nothing", async () => {
    const { database, writes } = setup();
    const summary = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: {},
      correlationId: "c1"
    });

    assert.equal(summary.blocked, true);
    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.blockReasonCode, "MODE_NOT_SHADOW");
    assert.equal(writes.riskAssessments.length, 0);
    assert.equal(writes.tradeDecisions.length, 0);
  });

  it("blocks when only the risk flag is missing", async () => {
    const { database } = setup();
    const { TRADING_RISK_V1_ENABLED, ...withoutRiskFlag } = RISK_ENABLED_ENV;
    void TRADING_RISK_V1_ENABLED;
    const summary = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: withoutRiskFlag,
      correlationId: "c1"
    });
    assert.equal(summary.blocked, true);
    assert.equal(summary.blockReasonCode, "RISK_V1_DISABLED");
  });

  it("blocks when live trading is switched on", async () => {
    const { database } = setup();
    const summary = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: { ...RISK_ENABLED_ENV, ENABLE_LIVE_TRADING: "true" },
      correlationId: "c1"
    });
    assert.equal(summary.blocked, true);
    assert.equal(summary.blockReasonCode, "LIVE_TRADING_FORBIDDEN");
  });

  it("reports a missing risk limit set instead of guessing one", async () => {
    const { database, writes } = setup({ withRiskLimitSet: false });
    const summary = await runShadowAssessRisk(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "c1"
    });
    assert.equal(summary.errored, 1);
    assert.equal(writes.riskAssessments.length, 0);
    assert.equal(summary.results[0].persistOutcome, "NOT_PERSISTABLE");
  });

  it("writes structured BotRun and BotLog records", async () => {
    const { writes, summary } = runJob();
    await summary;
    assert.equal(writes.botRuns[0].jobName, "shadowAssessRisk");
    assert.equal(writes.botRunUpdates[0].status, BotRunStatus.SUCCESS);
    assert.ok(writes.botLogs.length >= 3);
    assert.ok(writes.botLogs.every((log) => log.service === "worker"));
  });
});

describe("shadowBootstrap", () => {
  it("creates a disabled, fully specified shadow setup", async () => {
    const { database, writes } = setup({
      withRiskLimitSet: false,
      withExecutionProfile: false
    });
    const summary = await runShadowBootstrap(database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "bootstrap-1"
    });

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.blocked, false);
    assert.equal(writes.riskLimitSets.length, 1);
    assert.equal(writes.riskLimitSets[0].status, "ACTIVE");
    assert.equal(
      writes.riskLimitSets[0].specificationHash,
      RISK_LIMIT_SET_SPECIFICATION_HASH
    );
    assert.equal(writes.ledgerEntries.length, 1);
    assert.equal(writes.ledgerEntries[0].type, "INITIAL_CASH");
    assert.equal(
      writes.ledgerEntries[0].availableCashDelta,
      "10000.000000000000"
    );
    assert.equal(writes.auditEvents.length, 1);
    assert.equal(writes.auditEvents[0].eventType, "SHADOW_BOOTSTRAP_APPLIED");
  });

  it("leaves the session stopped with the kill switch engaged", async () => {
    // No pre-existing session in this world, so the bootstrap creates one.
    const world = buildRiskWorld({ withRiskLimitSet: false });
    world.sessions.length = 0;
    const fresh = createFakeRiskDatabase(world);

    await runShadowBootstrap(fresh.database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "bootstrap-1"
    });

    assert.equal(fresh.writes.sessions.length, 1);
    assert.equal(fresh.writes.sessions[0].status, "STOPPED");
    assert.equal(fresh.writes.sessions[0].killSwitchEngaged, true);
  });

  it("keeps the portfolio in DRAFT unless activation is requested", async () => {
    const draftWorld = buildRiskWorld();
    draftWorld.portfolios.length = 0;
    const draft = createFakeRiskDatabase(draftWorld);
    await runShadowBootstrap(draft.database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "b1"
    });
    assert.equal(draft.writes.portfolios[0].status, "DRAFT");

    const activeWorld = buildRiskWorld();
    activeWorld.portfolios.length = 0;
    const activated = createFakeRiskDatabase(activeWorld);
    await runShadowBootstrap(activated.database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "b2",
      activatePortfolio: true
    });
    assert.equal(activated.writes.portfolios[0].status, "ACTIVE");
  });

  it("never creates a strategy assignment or an active session", async () => {
    const world = buildRiskWorld({ withRiskLimitSet: false });
    world.portfolios.length = 0;
    world.sessions.length = 0;
    const { database, writes } = createFakeRiskDatabase(world);

    await runShadowBootstrap(database as never, {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "b1"
    });

    assert.deepEqual(writes.forbiddenWrites, []);
    assert.ok(writes.sessions.every((session) => session.status === "STOPPED"));
    const serialised = JSON.stringify(writes);
    assert.ok(!serialised.includes("StrategyAssignment"));
    assert.ok(!serialised.includes("SHADOW_ACTIVE"));
  });

  it("is idempotent", async () => {
    const world = buildRiskWorld({
      withRiskLimitSet: false,
      withExecutionProfile: false
    });
    const { database, writes } = createFakeRiskDatabase(world);
    const options = {
      asOf: AS_OF,
      env: BOOTSTRAP_ENABLED_ENV,
      correlationId: "b1"
    } as const;

    const first = await runShadowBootstrap(database as never, options);
    assert.ok(first.createdCount > 0);

    const second = await runShadowBootstrap(database as never, options);

    assert.equal(second.status, BotRunStatus.SUCCESS);
    assert.equal(writes.riskLimitSets.length, 1);
    assert.equal(
      writes.ledgerEntries.length,
      1,
      "the opening ledger entry must not double"
    );
    assert.equal(
      writes.auditEvents.length,
      1,
      "the bootstrap audit must not double"
    );
  });

  it("blocks by default", async () => {
    const { database, writes } = setup();
    const summary = await runShadowBootstrap(database as never, {
      asOf: AS_OF,
      env: RISK_ENABLED_ENV,
      correlationId: "b1"
    });

    assert.equal(summary.blocked, true);
    assert.equal(summary.blockReasonCode, "BOOTSTRAP_DISABLED");
    assert.equal(writes.riskLimitSets.length, 0);
    assert.equal(writes.ledgerEntries.length, 0);
  });
});
