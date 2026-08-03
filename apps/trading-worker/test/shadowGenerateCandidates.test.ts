import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";
import {
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  StrategyReasonCode,
  evaluateStrategy
} from "@signalpilot/strategy-engine";

import { assembleStrategyInput } from "../src/lib/strategyInputAssembler.js";
import {
  PersistOutcome,
  persistStrategyEvaluation
} from "../src/lib/shadowCandidatePersistence.js";
import {
  REQUIRED_STRATEGY_VERSION,
  SHADOW_STRATEGY_SYMBOLS,
  runShadowGenerateCandidates
} from "../src/jobs/shadowGenerateCandidates.js";

import {
  AS_OF,
  ENABLED_ENV,
  buildFakeWorld,
  createFakeDatabase,
  type FakeWorld
} from "./support/shadowTradingFixtures.js";

const btcAndEth = (): FakeWorld[] => [
  buildFakeWorld({ symbol: "BTCUSDT", assetId: "asset-btc" }),
  buildFakeWorld({ symbol: "ETHUSDT", assetId: "asset-eth" })
];

const run = (
  worlds: FakeWorld[],
  overrides: Parameters<typeof runShadowGenerateCandidates>[1] = {}
) => {
  const { database, writes } = createFakeDatabase(worlds);
  return {
    writes,
    database,
    summary: runShadowGenerateCandidates(database as never, {
      asOf: AS_OF,
      env: ENABLED_ENV,
      correlationId: "correlation-1",
      ...overrides
    })
  };
};

describe("strategy input assembler", () => {
  it("builds a snapshot the pure engine accepts", async () => {
    const { database } = createFakeDatabase([buildFakeWorld()]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "test-code-version"
    });

    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const snapshot = assembled.snapshot;
    assert.equal(snapshot.asOf, AS_OF.toISOString());
    assert.equal(snapshot.series["1h"].candles.length, 250);
    assert.equal(snapshot.series["1h"].candles.at(-1)!.closeTime, "2026-08-02T08:59:59.999Z");
    assert.equal(snapshot.strategy.specificationHash, CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH);
    assert.equal(snapshot.strategy.codeVersion, "test-code-version");
    assert.equal(snapshot.signals["1h"]!.adjustedScoreSource, "RULE_APPLICATION");
    assert.equal(snapshot.multiTimeframe!.alignment, "BULLISH_ALIGNED");
    assert.deepEqual(snapshot.contextEvents, []);

    assert.equal(evaluateStrategy(snapshot).outcome, "CANDIDATE");
  });

  it("normalises the alignment score into the 0..1 range the strategy compares", async () => {
    const { database } = createFakeDatabase([buildFakeWorld()]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const raw = assembled.snapshot.multiTimeframe!.alignmentScoreRaw;
    assert.ok(raw > 1 && raw <= 100);
    assert.equal(assembled.snapshot.multiTimeframe!.alignmentScore, (raw / 100).toFixed(12));
  });

  it("refuses to assemble without an enabled assignment", async () => {
    const { database } = createFakeDatabase([buildFakeWorld({ assignmentEnabled: false })]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, false);
    if (assembled.ok) return;
    assert.equal(assembled.reasonCode, StrategyReasonCode.ASSIGNMENT_MISSING);
  });

  it("refuses to assemble for an unknown asset", async () => {
    const { database } = createFakeDatabase([buildFakeWorld()]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "SOLUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, false);
    if (assembled.ok) return;
    assert.equal(assembled.reasonCode, "ASSET_RECORD_MISSING");
  });

  it("only reads candles that are closed at asOf", async () => {
    const { database } = createFakeDatabase([buildFakeWorld()]);
    const earlier = new Date(Date.parse("2026-08-02T07:30:00.000Z"));
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: earlier,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;
    for (const candle of assembled.snapshot.series["1h"].candles) {
      assert.ok(Date.parse(candle.closeTime) <= earlier.getTime());
    }
  });
});

describe("shadow candidate persistence", () => {
  it("stores candidate, evidence and audit in one transaction", async () => {
    const { database, writes } = createFakeDatabase([buildFakeWorld()]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const evaluation = evaluateStrategy(assembled.snapshot);
    const result = await persistStrategyEvaluation(database as never, {
      evaluation,
      snapshot: assembled.snapshot,
      correlationId: "correlation-1",
      codeVersion: "v",
      occurredAt: AS_OF
    });

    assert.equal(result.outcome, PersistOutcome.CREATED);
    assert.equal(writes.tradeCandidates.length, 1);
    assert.equal(writes.evidence.length, 12);
    assert.equal(writes.auditEvents.length, 1);
    assert.equal(writes.riskEvents.length, 0);

    const candidate = writes.tradeCandidates[0];
    assert.equal(candidate.status, "CREATED");
    assert.equal(candidate.direction, "LONG");
    assert.equal(candidate.entryType, "MARKET");
    assert.equal(candidate.minimumRewardRisk, "2.000000000000");
    assert.ok(Array.isArray(candidate.strategyReasonCodes));

    const audit = writes.auditEvents[0];
    assert.equal(audit.eventType, "STRATEGY_CANDIDATE_CREATED");
    assert.equal(audit.aggregateType, "TradeCandidate");
    assert.equal(audit.actorType, "SYSTEM");
    assert.equal(audit.idempotencyKey, evaluation.inputHash);
  });

  it("does not duplicate a candidate for an identical input", async () => {
    const { database, writes } = createFakeDatabase([buildFakeWorld()]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const input = {
      evaluation: evaluateStrategy(assembled.snapshot),
      snapshot: assembled.snapshot,
      correlationId: "correlation-1",
      codeVersion: "v",
      occurredAt: AS_OF
    };

    const first = await persistStrategyEvaluation(database as never, input);
    const second = await persistStrategyEvaluation(database as never, input);

    assert.equal(first.outcome, PersistOutcome.CREATED);
    assert.equal(second.outcome, PersistOutcome.IDEMPOTENT_REPLAY);
    assert.equal(second.tradeCandidateId, first.tradeCandidateId);
    assert.equal(writes.tradeCandidates.length, 1);
    assert.equal(writes.evidence.length, 12);
    assert.equal(writes.auditEvents.length, 1);
  });

  it("raises a critical risk event when the same key carries a different hash", async () => {
    const { database, writes } = createFakeDatabase([buildFakeWorld()]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    await persistStrategyEvaluation(database as never, {
      evaluation: evaluateStrategy(assembled.snapshot),
      snapshot: assembled.snapshot,
      correlationId: "correlation-1",
      codeVersion: "v",
      occurredAt: AS_OF
    });

    // Same anchor candle, different decision input: the candidate key is
    // unchanged but the input hash is not.
    const drifted = JSON.parse(JSON.stringify(assembled.snapshot));
    drifted.marketRegime.confidence = 71;
    const conflictEvaluation = evaluateStrategy(drifted);
    assert.equal(conflictEvaluation.outcome, "CANDIDATE");

    const conflict = await persistStrategyEvaluation(database as never, {
      evaluation: conflictEvaluation,
      snapshot: drifted,
      correlationId: "correlation-2",
      codeVersion: "v",
      occurredAt: AS_OF
    });

    assert.equal(conflict.outcome, PersistOutcome.CONFLICT);
    assert.equal(conflict.reasonCode, StrategyReasonCode.CANDIDATE_INPUT_HASH_CONFLICT);
    assert.equal(writes.tradeCandidates.length, 1, "the stored candidate must not be overwritten");
    assert.equal(writes.riskEvents.length, 1);
    assert.equal(writes.riskEvents[0].severity, "CRITICAL");
    assert.equal(writes.riskEvents[0].type, "IDEMPOTENCY_OR_VERSION_CONFLICT");
  });

  it("records a refusal as an append-only audit event without a candidate", async () => {
    const { database, writes } = createFakeDatabase([
      buildFakeWorld({ cryptoRegime: "RISK_OFF" })
    ]);
    const assembled = await assembleStrategyInput(database as never, {
      symbol: "BTCUSDT",
      asOf: AS_OF,
      codeVersion: "v"
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;

    const evaluation = evaluateStrategy(assembled.snapshot);
    assert.equal(evaluation.outcome, "NO_CANDIDATE");

    const input = {
      evaluation,
      snapshot: assembled.snapshot,
      correlationId: "correlation-1",
      codeVersion: "v",
      occurredAt: AS_OF
    };
    const first = await persistStrategyEvaluation(database as never, input);
    const second = await persistStrategyEvaluation(database as never, input);

    assert.equal(first.outcome, PersistOutcome.REJECTION_RECORDED);
    assert.equal(second.outcome, PersistOutcome.REJECTION_RECORDED);
    assert.equal(first.reasonCode, StrategyReasonCode.REGIME_NOT_RISK_ON);
    assert.equal(writes.tradeCandidates.length, 0);
    assert.equal(writes.auditEvents.length, 1, "an identical refusal must not be written twice");
    assert.equal(writes.auditEvents[0].eventType, "STRATEGY_EVALUATION_REJECTED");
  });
});

describe("shadowGenerateCandidates job", () => {
  it("processes exactly BTCUSDT and ETHUSDT", async () => {
    const { summary } = run(btcAndEth());
    const finished = await summary;

    assert.deepEqual([...finished.symbols], ["BTCUSDT", "ETHUSDT"]);
    assert.deepEqual([...SHADOW_STRATEGY_SYMBOLS], ["BTCUSDT", "ETHUSDT"]);
    assert.equal(finished.status, BotRunStatus.SUCCESS);
    assert.equal(finished.created, 2);
    assert.equal(finished.conflicts, 0);
  });

  it("writes structured BotRun and BotLog records", async () => {
    const { writes, summary } = run(btcAndEth());
    await summary;

    assert.equal(writes.botRuns.length, 1);
    assert.equal(writes.botRuns[0].jobName, "shadowGenerateCandidates");
    assert.equal(writes.botRunUpdates.length, 1);
    assert.equal(writes.botRunUpdates[0].status, BotRunStatus.SUCCESS);
    assert.ok(writes.botLogs.length >= 3);
    assert.ok(writes.botLogs.every((log) => log.service === "worker"));
  });

  it("is idempotent across repeated runs", async () => {
    const { database, writes } = createFakeDatabase(btcAndEth());
    const options = { asOf: AS_OF, env: ENABLED_ENV, correlationId: "correlation-1" } as const;

    const first = await runShadowGenerateCandidates(database as never, options);
    const second = await runShadowGenerateCandidates(database as never, options);

    assert.equal(first.created, 2);
    assert.equal(second.created, 0);
    assert.equal(second.idempotentReplays, 2);
    assert.equal(writes.tradeCandidates.length, 2);
  });

  it("creates no risk assessment, order, fill or position", async () => {
    const { writes, summary } = run(btcAndEth());
    await summary;

    assert.deepEqual(writes.forbiddenWrites, []);
    assert.equal(writes.riskEvents.length, 0);
    assert.equal(writes.auditEvents.length, 2);
    for (const audit of writes.auditEvents) {
      assert.equal(audit.eventType, "STRATEGY_CANDIDATE_CREATED");
    }
  });

  it("blocks by default and reports the reason without touching trading tables", async () => {
    const { database, writes } = createFakeDatabase(btcAndEth());
    const summary = await runShadowGenerateCandidates(database as never, {
      asOf: AS_OF,
      env: {},
      correlationId: "correlation-1"
    });

    assert.equal(summary.blocked, true);
    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.blockReasonCode, "MODE_NOT_SHADOW");
    assert.equal(writes.tradeCandidates.length, 0);
    assert.equal(writes.auditEvents.length, 0);
    assert.equal(writes.botRunUpdates[0].status, BotRunStatus.FAILED);
  });

  it("blocks when live trading is switched on", async () => {
    const { database, writes } = createFakeDatabase(btcAndEth());
    const summary = await runShadowGenerateCandidates(database as never, {
      asOf: AS_OF,
      env: { ...ENABLED_ENV, ENABLE_LIVE_TRADING: "true" },
      correlationId: "correlation-1"
    });

    assert.equal(summary.blocked, true);
    assert.equal(summary.blockReasonCode, "LIVE_TRADING_FORBIDDEN");
    assert.equal(writes.tradeCandidates.length, 0);
  });

  it("records a refusal instead of a candidate when the regime is not RISK_ON", async () => {
    const { writes, summary } = run([
      buildFakeWorld({ symbol: "BTCUSDT", assetId: "asset-btc", cryptoRegime: "MIXED" }),
      buildFakeWorld({ symbol: "ETHUSDT", assetId: "asset-eth", cryptoRegime: "MIXED" })
    ]);
    const finished = await summary;

    assert.equal(finished.created, 0);
    assert.equal(finished.rejections, 2);
    assert.equal(finished.status, BotRunStatus.SUCCESS);
    assert.equal(writes.tradeCandidates.length, 0);
    assert.equal(writes.auditEvents.length, 2);
  });

  it("reports an assembler failure without aborting the other symbol", async () => {
    const { writes, summary } = run([
      buildFakeWorld({ symbol: "BTCUSDT", assetId: "asset-btc" }),
      buildFakeWorld({ symbol: "ETHUSDT", assetId: "asset-eth", assignmentEnabled: false })
    ]);
    const finished = await summary;

    assert.equal(finished.created, 1);
    assert.equal(finished.assemblerFailures, 1);
    assert.equal(writes.tradeCandidates.length, 1);
  });

  it("pins the strategy version values an operator must seed", () => {
    assert.equal(REQUIRED_STRATEGY_VERSION.strategyKey, "CRYPTO_MTF_BREAKOUT_V1");
    assert.equal(
      REQUIRED_STRATEGY_VERSION.specificationHash,
      CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
    );
  });
});
