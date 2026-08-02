import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PortfolioLedgerEntryType,
  ReplayVerdict,
  RiskEventType,
  RiskLimitScope,
  ShadowFillTriggerType,
  ShadowOrderPurpose,
  TradeEvidenceType,
  TradingDomainError,
  TradingReasonCode,
  assertExpectedVersion,
  assertNextSequence,
  assertNoIdempotencyConflict,
  buildActiveAssignmentScopeKey,
  buildActiveExecutionProfileKey,
  buildActiveExitPlanScopeKey,
  buildActiveRiskLimitSetKey,
  buildActiveSessionScopeKey,
  buildAssessmentKey,
  buildAuditEventKey,
  buildCandidateKey,
  buildClientOrderId,
  buildDecisionHash,
  buildDecisionKey,
  buildEntryOrderKey,
  buildEvidenceSourceKey,
  buildExitOrderKey,
  buildFillKey,
  buildInputHash,
  buildJobScopeKey,
  buildLedgerEntryKey,
  buildOpenEntryOrderScopeKey,
  buildOpenPositionScopeKey,
  buildPositionEventKey,
  buildPositionKey,
  buildRiskEventKey,
  buildSessionKey,
  buildSpecificationHash,
  canonicalHash,
  canonicalize,
  checkExpectedVersion,
  checkNextSequence,
  classifyReplay,
  decimal,
  hashCanonicalString,
  nextVersion
} from "../src/index.js";

const expectReason = (reasonCode: string, run: () => unknown): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof TradingDomainError, `expected TradingDomainError, got ${String(error)}`);
    assert.equal(error.reasonCode, reasonCode);
    return true;
  });
};

describe("canonical JSON", () => {
  it("ignores object key order", () => {
    assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
    assert.equal(canonicalHash({ b: 1, a: 2 }), canonicalHash({ a: 2, b: 1 }));
  });

  it("respects array order", () => {
    assert.notEqual(canonicalHash([1, 2]), canonicalHash([2, 1]));
  });

  it("sorts nested keys too", () => {
    assert.equal(canonicalize({ outer: { z: 1, a: [{ y: 1, x: 2 }] } }), '{"outer":{"a":[{"x":2,"y":1}],"z":1}}');
  });

  it("serialises a Date as ISO-8601 UTC", () => {
    const date = new Date(Date.UTC(2026, 7, 1, 12, 30, 15, 250));
    assert.equal(canonicalize({ at: date }), '{"at":"2026-08-01T12:30:15.250Z"}');
  });

  it("serialises a decimal by its fixed-scale string, not as a float", () => {
    assert.equal(canonicalize({ price: decimal("0.1") }), '{"price":"0.100000000000"}');
    assert.notEqual(canonicalHash({ price: decimal("0.1") }), canonicalHash({ price: 0.1 }));
    // Two decimals that are equal in value hash identically.
    assert.equal(canonicalHash(decimal("1.50")), canonicalHash(decimal("1.5")));
  });

  it("drops undefined properties so an absent field hashes like an unset one", () => {
    assert.equal(canonicalHash({ a: 1, b: undefined }), canonicalHash({ a: 1 }));
  });

  it("normalises -0 and rejects non-finite numbers", () => {
    assert.equal(canonicalize({ v: -0 }), '{"v":0}');
    expectReason(TradingReasonCode.CANONICAL_JSON_NON_FINITE_NUMBER, () => canonicalize({ v: Number.NaN }));
    expectReason(TradingReasonCode.CANONICAL_JSON_NON_FINITE_NUMBER, () =>
      canonicalize({ v: Number.POSITIVE_INFINITY })
    );
    expectReason(TradingReasonCode.CANONICAL_JSON_NON_FINITE_NUMBER, () =>
      canonicalize({ at: new Date("nope") })
    );
  });

  it("rejects values without a canonical form", () => {
    expectReason(TradingReasonCode.CANONICAL_JSON_UNSUPPORTED_VALUE, () => canonicalize({ f: () => 1 }));
    expectReason(TradingReasonCode.CANONICAL_JSON_UNSUPPORTED_VALUE, () => canonicalize({ s: Symbol("x") }));
    expectReason(TradingReasonCode.CANONICAL_JSON_UNSUPPORTED_VALUE, () => canonicalize({ m: new Map() }));
    expectReason(TradingReasonCode.CANONICAL_JSON_UNSUPPORTED_VALUE, () => canonicalize({ s: new Set() }));
  });

  it("detects circular references instead of overflowing the stack", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expectReason(TradingReasonCode.CANONICAL_JSON_CIRCULAR_REFERENCE, () => canonicalize(circular));
  });

  it("allows the same object to appear twice without a cycle", () => {
    const shared = { a: 1 };
    assert.equal(canonicalize({ x: shared, y: shared }), '{"x":{"a":1},"y":{"a":1}}');
  });

  it("produces a stable, reproducible SHA-256", () => {
    assert.match(canonicalHash({ a: 1 }), /^[0-9a-f]{64}$/);
    assert.equal(canonicalHash({ a: 1 }), hashCanonicalString('{"a":1}'));
    // Pinned so a future serialisation change cannot silently rewrite history.
    assert.equal(canonicalHash({ a: 1 }), "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862");
  });

  it("serialises bigint as a lossless string", () => {
    assert.equal(canonicalize({ n: 9007199254740993n }), '{"n":"9007199254740993"}');
  });
});

describe("engine hashes", () => {
  const snapshot = { asOf: new Date(Date.UTC(2026, 7, 1)), price: decimal("60000.5"), tf: ["1h", "4h"] };

  it("are deterministic for identical input", () => {
    assert.equal(buildInputHash(snapshot), buildInputHash({ ...snapshot }));
    assert.equal(buildSpecificationHash({ x: 1 }), buildSpecificationHash({ x: 1 }));
  });

  it("change when any input changes", () => {
    assert.notEqual(buildInputHash(snapshot), buildInputHash({ ...snapshot, price: decimal("60000.6") }));
    assert.notEqual(buildInputHash(snapshot), buildInputHash({ ...snapshot, tf: ["4h", "1h"] }));
  });

  it("bind a decision to its inputs and engine versions", () => {
    const base = {
      tradeCandidateId: "cand-1",
      riskAssessmentId: "risk-1",
      outcome: "APPROVE_SHADOW",
      reasonCode: "RISK_PASS",
      inputHash: "abc",
      ruleSetVersion: "risk-v1",
      engineVersion: "strategy-v1",
      codeVersion: "commit-1"
    };
    assert.equal(buildDecisionHash(base), buildDecisionHash({ ...base }));
    assert.notEqual(buildDecisionHash(base), buildDecisionHash({ ...base, codeVersion: "commit-2" }));
    assert.notEqual(buildDecisionHash(base), buildDecisionHash({ ...base, outcome: "REJECT" }));
  });
});

describe("idempotency keys", () => {
  it("build a candidate key from assignment, version, asset and anchor candle", () => {
    const key = buildCandidateKey({
      strategyAssignmentId: "asg-1",
      strategyVersionId: "sv-1",
      assetId: "ast-1",
      anchorCandleId: "cdl-1"
    });
    assert.equal(key, "candidate.v1|asg-1|sv-1|ast-1|cdl-1");
    assert.equal(
      key,
      buildCandidateKey({
        strategyAssignmentId: "asg-1",
        strategyVersionId: "sv-1",
        assetId: "ast-1",
        anchorCandleId: "cdl-1"
      })
    );
  });

  it("keeps different aggregates in different namespaces", () => {
    const parts = { tradeCandidateId: "c1", riskLimitSetId: "l1", inputHash: "h1" };
    assert.notEqual(buildAssessmentKey(parts), buildDecisionKey(parts));
  });

  it("varies with every component", () => {
    const base = { shadowOrderId: "o1", sourceCandleId: "c1", sequence: 1 };
    assert.notEqual(buildFillKey(base), buildFillKey({ ...base, sequence: 2 }));
    assert.notEqual(buildFillKey(base), buildFillKey({ ...base, sourceCandleId: "c2" }));
  });

  it("covers every aggregate that owns a key column", () => {
    const keys = [
      buildCandidateKey({ strategyAssignmentId: "a", strategyVersionId: "b", assetId: "c", anchorCandleId: "d" }),
      buildAssessmentKey({ tradeCandidateId: "a", riskLimitSetId: "b", inputHash: "c" }),
      buildDecisionKey({ tradeCandidateId: "a", riskLimitSetId: "b", inputHash: "c" }),
      buildEntryOrderKey({ tradeDecisionId: "a" }),
      buildExitOrderKey({
        shadowPositionId: "p",
        exitPlanVersion: 1,
        sourceCandleId: "c",
        triggerType: ShadowFillTriggerType.STOP
      }),
      buildFillKey({ shadowOrderId: "o", sourceCandleId: "c", sequence: 0 }),
      buildPositionKey({ portfolioId: "pf", assetId: "as", entryOrderId: "o" }),
      buildPositionEventKey({ shadowPositionId: "p", sequence: 1 }),
      buildLedgerEntryKey({
        portfolioId: "pf",
        type: PortfolioLedgerEntryType.RESERVE,
        causeType: "ShadowOrder",
        causeId: "o"
      }),
      buildRiskEventKey({
        type: RiskEventType.DAILY_LOSS_LIMIT,
        aggregateType: "Portfolio",
        aggregateId: "pf",
        inputHash: "h"
      }),
      buildAuditEventKey({
        eventType: "SESSION_ACTIVATED",
        aggregateType: "TradingSession",
        aggregateId: "s",
        idempotencyKey: "req-1"
      }),
      buildSessionKey({ portfolioId: "pf", sequence: 1 }),
      buildJobScopeKey(["trading:monitor-positions", "pos-1"])
    ];
    assert.equal(new Set(keys).size, keys.length, "all aggregate keys must be distinct");
    for (const key of keys) assert.match(key, /^[a-z-]+(\.[a-z]+)*\.v1\|/);
  });

  it("substitutes a deterministic source key when the evidence source has no id", () => {
    const withId = buildEvidenceSourceKey({
      type: TradeEvidenceType.SIGNAL,
      sourceType: "Signal",
      sourceId: "sig-1"
    });
    assert.equal(withId, "sig-1");
    const withoutId = buildEvidenceSourceKey({
      type: TradeEvidenceType.REGIME,
      sourceType: "MarketRegimeSnapshot",
      sourceId: null
    });
    assert.equal(
      withoutId,
      buildEvidenceSourceKey({
        type: TradeEvidenceType.REGIME,
        sourceType: "MarketRegimeSnapshot",
        sourceId: ""
      })
    );
    assert.notEqual(
      withoutId,
      buildEvidenceSourceKey({ type: TradeEvidenceType.NEWS, sourceType: "MarketRegimeSnapshot", sourceId: null })
    );
  });

  it("derives a stable, venue-safe client order id", () => {
    const orderKey = buildEntryOrderKey({ tradeDecisionId: "dec-1" });
    const clientOrderId = buildClientOrderId(orderKey);
    assert.equal(clientOrderId, buildClientOrderId(orderKey));
    assert.match(clientOrderId, /^sp-[0-9a-f]{32}$/);
    assert.equal(clientOrderId.length, 35);
    assert.notEqual(clientOrderId, buildClientOrderId(buildEntryOrderKey({ tradeDecisionId: "dec-2" })));
  });

  it("rejects key parts that could forge a different key", () => {
    expectReason(TradingReasonCode.IDEMPOTENCY_KEY_PART_EMPTY, () =>
      buildEntryOrderKey({ tradeDecisionId: "" })
    );
    expectReason(TradingReasonCode.IDEMPOTENCY_KEY_PART_INVALID, () =>
      buildEntryOrderKey({ tradeDecisionId: "a|b" })
    );
    expectReason(TradingReasonCode.IDEMPOTENCY_KEY_PART_INVALID, () =>
      buildEntryOrderKey({ tradeDecisionId: "a b" })
    );
    expectReason(TradingReasonCode.IDEMPOTENCY_KEY_PART_INVALID, () =>
      buildEntryOrderKey({ tradeDecisionId: "x".repeat(129) })
    );
  });

  it("rejects a negative or fractional sequence", () => {
    expectReason(TradingReasonCode.SEQUENCE_MUST_BE_POSITIVE, () =>
      buildFillKey({ shadowOrderId: "o", sourceCandleId: "c", sequence: -1 })
    );
    expectReason(TradingReasonCode.SEQUENCE_MUST_BE_POSITIVE, () =>
      buildPositionEventKey({ shadowPositionId: "p", sequence: 1.5 })
    );
  });
});

describe("at-most-one-active scope keys", () => {
  it("are stable per scope and distinct across scopes", () => {
    assert.equal(
      buildActiveAssignmentScopeKey({ portfolioId: "pf", assetId: "as", strategyId: "st" }),
      buildActiveAssignmentScopeKey({ portfolioId: "pf", assetId: "as", strategyId: "st" })
    );
    assert.notEqual(
      buildActiveAssignmentScopeKey({ portfolioId: "pf", assetId: "as", strategyId: "st" }),
      buildActiveAssignmentScopeKey({ portfolioId: "pf", assetId: "as", strategyId: "st2" })
    );
    const distinct = new Set([
      buildActiveExecutionProfileKey({ assetId: "as" }),
      buildActiveRiskLimitSetKey({ scope: RiskLimitScope.PORTFOLIO }),
      buildOpenPositionScopeKey({ portfolioId: "pf", assetId: "as" }),
      buildActiveSessionScopeKey({ portfolioId: "pf" }),
      buildActiveExitPlanScopeKey({ shadowPositionId: "p" }),
      buildOpenEntryOrderScopeKey({ portfolioId: "pf", assetId: "as", purpose: ShadowOrderPurpose.ENTRY })
    ]);
    assert.equal(distinct.size, 6);
  });
});

describe("optimistic concurrency", () => {
  it("accepts the expected version and refuses any other", () => {
    assert.equal(checkExpectedVersion(3, 3).ok, true);
    const conflict = checkExpectedVersion(4, 3);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.ok === false && conflict.reasonCode, TradingReasonCode.VERSION_CONFLICT);
    expectReason(TradingReasonCode.VERSION_CONFLICT, () => assertExpectedVersion(4, 3));
    assert.doesNotThrow(() => assertExpectedVersion(0, 0));
  });

  it("increments the version monotonically", () => {
    assert.equal(nextVersion(0), 1);
    assert.equal(nextVersion(41), 42);
    expectReason(TradingReasonCode.SEQUENCE_MUST_BE_POSITIVE, () => nextVersion(-1));
  });
});

describe("replay classification", () => {
  it("treats an unseen key as fresh work", () => {
    assert.equal(classifyReplay(null, "hash-1"), ReplayVerdict.FRESH);
  });

  it("treats the same key with the same payload as an idempotent retry", () => {
    assert.equal(classifyReplay("hash-1", "hash-1"), ReplayVerdict.IDEMPOTENT_REPLAY);
    assert.equal(
      assertNoIdempotencyConflict("candidate.v1|a", "hash-1", "hash-1"),
      ReplayVerdict.IDEMPOTENT_REPLAY
    );
  });

  it("treats the same key with a different payload as a conflict", () => {
    assert.equal(classifyReplay("hash-1", "hash-2"), ReplayVerdict.CONFLICT);
    expectReason(TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT, () =>
      assertNoIdempotencyConflict("candidate.v1|a", "hash-1", "hash-2")
    );
  });

  it("reports the conflicting hashes without leaking the payload", () => {
    try {
      assertNoIdempotencyConflict("k", "old", "new");
      assert.fail("expected a conflict");
    } catch (error) {
      assert.ok(error instanceof TradingDomainError);
      assert.deepEqual(error.details, { key: "k", existingPayloadHash: "old", incomingPayloadHash: "new" });
    }
  });
});

describe("gapless sequences", () => {
  it("accepts only the immediate successor", () => {
    assert.equal(checkNextSequence(0, 1).ok, true);
    assert.equal(checkNextSequence(7, 8).ok, true);
    assert.doesNotThrow(() => assertNextSequence(7, 8));
    for (const [last, next] of [
      [1, 1],
      [1, 3],
      [5, 4]
    ]) {
      const result = checkNextSequence(last, next);
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reasonCode, TradingReasonCode.SEQUENCE_NOT_CONTIGUOUS);
    }
    expectReason(TradingReasonCode.SEQUENCE_NOT_CONTIGUOUS, () => assertNextSequence(1, 3));
  });
});
