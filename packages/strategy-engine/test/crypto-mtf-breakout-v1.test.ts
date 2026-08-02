import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  StrategyReasonCode,
  evaluateCryptoMtfBreakoutV1,
  evaluateStrategy,
  getStrategy,
  REGISTERED_STRATEGY_KEYS,
  type StrategyCandidateResultV1,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { BTC_1H_SHAPE, buildCandles, buildPassingSnapshot, clone } from "./support/build-snapshot.js";
import { ETH_BASE_SNAPSHOT, REJECTION_CASES } from "./support/rejection-cases.js";

const PARAMS = CRYPTO_MTF_BREAKOUT_V1_PARAMETERS;

function candidateOf(snapshot: StrategyInputSnapshotV1): StrategyCandidateResultV1 {
  const result = evaluateCryptoMtfBreakoutV1(snapshot);
  assert.equal(result.outcome, "CANDIDATE", `expected a candidate, got ${result.reasonCodes.join(",")}`);
  return result as StrategyCandidateResultV1;
}

function withOneHourShape(
  snapshot: StrategyInputSnapshotV1,
  shape: Partial<typeof BTC_1H_SHAPE>
): StrategyInputSnapshotV1 {
  const next = clone(snapshot);
  next.series["1h"] = {
    ...next.series["1h"],
    candles: buildCandles("1h", { ...BTC_1H_SHAPE, ...shape }, { idPrefix: "btcusdt" })
  };
  return next;
}

describe("CRYPTO_MTF_BREAKOUT_V1 — happy path", () => {
  const result = candidateOf(buildPassingSnapshot());
  const candidate = result.candidate;

  it("produces exactly one long market candidate in CREATED", () => {
    assert.equal(candidate.direction, "LONG");
    assert.equal(candidate.entryType, "MARKET");
    assert.equal(candidate.status, "CREATED");
    assert.equal(candidate.symbol, "BTCUSDT");
    assert.equal(candidate.strategyKey, CRYPTO_MTF_BREAKOUT_V1_KEY);
    assert.equal(candidate.specificationHash, CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH);
  });

  it("anchors on the newest closed 1h candle and its signal", () => {
    assert.equal(candidate.anchorCandleId, "btcusdt-1h-249");
    assert.equal(candidate.anchorSignalId, "signal-1h");
    assert.equal(candidate.validFrom, candidate.earliestFillAt);
    assert.equal(candidate.earliestFillAt, "2026-08-02T08:59:59.999Z");
  });

  it("builds a stable candidate key from assignment, version, asset and anchor", () => {
    assert.equal(
      candidate.candidateKey,
      "candidate.v1|assignment-btcusdt|strategy-version-1|asset-btc|btcusdt-1h-249"
    );
  });

  it("expires two hours after the anchor close and well inside 72 hours", () => {
    const earliest = Date.parse(candidate.earliestFillAt);
    const expires = Date.parse(candidate.expiresAt);
    assert.equal(expires - earliest, PARAMS.candidateTtlMs);
    assert.ok(expires - earliest <= PARAMS.maxHoldHours * 60 * 60 * 1000);
    assert.equal(candidate.maxHoldHours, 72);
  });

  it("uses close(C0) as reference entry", () => {
    const anchorClose = buildPassingSnapshot().series["1h"].candles.at(-1)!.close;
    assert.equal(
      DecimalValue.fromString(candidate.referenceEntryPrice).toString(),
      DecimalValue.fromString(anchorClose).toString()
    );
  });

  it("keeps the stop at least 1.5 ATR and at least 0.75 % away", () => {
    const reference = DecimalValue.fromString(candidate.referenceEntryPrice);
    const atr = DecimalValue.fromString(candidate.indicators.atr14_1h);
    const stopDistance = DecimalValue.fromString(candidate.stopDistance);

    assert.ok(stopDistance.gte(DecimalValue.fromString("1.5").mul(atr, "FLOOR")));
    assert.ok(stopDistance.gte(DecimalValue.fromString("0.0075").mul(reference, "FLOOR")));
    assert.equal(reference.sub(stopDistance).toString(), candidate.stopPrice);
  });

  it("caps the stop distance at 3 %", () => {
    assert.ok(DecimalValue.fromString(candidate.stopDistancePct).lte(DecimalValue.fromString("0.03")));
  });

  it("raises the stop to the greater of the ATR term and the 0.75 % floor", () => {
    // `rawStopDistance = max(1.5 * ATR, 0.0075 * referenceEntry)`
    // (docs/trading/05, "Candidate-Preisplan"). Because the pinned ATR gate
    // requires `ATR/close >= 0.005`, the ATR term is at least `0.0075 * close`,
    // so the floor is a redundant safety net rather than a binding limit — the
    // assertion checks both halves of the maximum regardless.
    const reference = DecimalValue.fromString(candidate.referenceEntryPrice);
    const atr = DecimalValue.fromString(candidate.indicators.atr14_1h);
    const atrTerm = DecimalValue.fromString("1.5").mul(atr, "CEIL");
    const floorTerm = DecimalValue.fromString("0.0075").mul(reference, "CEIL");
    const expected = DecimalValue.max(atrTerm, floorTerm);

    assert.equal(candidate.stopDistance, expected.toString());
    assert.ok(DecimalValue.fromString(candidate.indicators.atrToClose1h).gte(DecimalValue.fromString("0.005")));
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.STOP_DISTANCE_ATR_APPLIED));
  });

  it("places the take profit at exactly 2.5R gross", () => {
    // Gross take-profit is 2.5R (docs/trading/decisions/0008-strategy-take-profit-2-5r-gross.md);
    // the risk engine's independent net-of-cost minimum stays 2.0R and is not
    // asserted here.
    const reference = DecimalValue.fromString(candidate.referenceEntryPrice);
    const stopDistance = DecimalValue.fromString(candidate.stopDistance);
    const rMultiple = DecimalValue.fromString("2.5");
    assert.equal(
      candidate.takeProfitPrice,
      reference.add(rMultiple.mul(stopDistance, "FLOOR")).toString()
    );
    assert.equal(candidate.plannedRewardRisk, "2.500000000000");
    assert.equal(candidate.minimumRewardRisk, "2.000000000000");
  });

  it("limits the planned entry range by 0.5 ATR above the reference", () => {
    const reference = DecimalValue.fromString(candidate.referenceEntryPrice);
    const atr = DecimalValue.fromString(candidate.indicators.atr14_1h);
    assert.equal(candidate.maximumEntryGapDistance, DecimalValue.fromString("0.5").mul(atr, "FLOOR").toString());
    assert.equal(
      candidate.plannedEntryMaximum,
      reference.add(DecimalValue.fromString(candidate.maximumEntryGapDistance)).toString()
    );
    assert.equal(candidate.plannedEntryMinimum, candidate.stopPrice);
  });

  it("proposes no quantity, no risk budget and no order", () => {
    // Sizing belongs to the risk engine (docs/trading/05, "Positionsgrößenformel").
    const { evidence, indicators, ...plan } = candidate;
    void evidence;
    void indicators;
    const serialised = JSON.stringify(plan);
    for (const forbidden of [
      "quantity",
      "riskBudget",
      "equity",
      "orderKey",
      "positionKey",
      "leverage",
      "margin"
    ]) {
      assert.ok(!serialised.includes(forbidden), `candidate must not carry ${forbidden}`);
    }
  });

  it("carries required evidence for every mandatory source", () => {
    const byType = new Map<string, number>();
    for (const item of candidate.evidence) {
      byType.set(item.type, (byType.get(item.type) ?? 0) + 1);
      assert.equal(item.capturedAt, candidate.dataAsOf);
      assert.ok(item.payloadHash.length === 64);
    }
    assert.equal(byType.get("CANDLE"), 3);
    assert.equal(byType.get("DATA_QUALITY"), 3);
    assert.equal(byType.get("SIGNAL"), 3);
    assert.equal(byType.get("MTF"), 1);
    assert.equal(byType.get("REGIME"), 1);
    assert.equal(byType.get("EXECUTION_PROFILE"), 1);

    const keys = candidate.evidence.map((item) => `${item.type}|${item.sourceType}|${item.sourceKey}`);
    assert.equal(new Set(keys).size, keys.length, "evidence keys must be unique");
  });

  it("reports sorted, de-duplicated pass reason codes", () => {
    assert.deepEqual([...result.reasonCodes], [...result.reasonCodes].sort());
    assert.equal(new Set(result.reasonCodes).size, result.reasonCodes.length);
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.BREAKOUT_CONFIRMED));
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REGIME_RISK_ON));
  });
});

describe("CRYPTO_MTF_BREAKOUT_V1 — breakout window", () => {
  it("ignores the anchor candle's own high when computing the prior 20-candle high", () => {
    const snapshot = buildPassingSnapshot();
    const anchor = snapshot.series["1h"].candles.at(-1)!;
    const candidate = candidateOf(snapshot).candidate;

    // The anchor's own high sits above the reference; only exclusion of C0 from
    // the window makes the breakout comparison meaningful at all.
    assert.ok(
      DecimalValue.fromString(anchor.high).gt(
        DecimalValue.fromString(candidate.indicators.priorHigh20_1h)
      )
    );

    // Raising the previous candle's high does move the reference.
    const raised = clone(snapshot);
    const candles = [...raised.series["1h"].candles];
    const previous = candles[candles.length - 2];
    candles[candles.length - 2] = {
      ...previous,
      high: DecimalValue.fromString(previous.high).add(DecimalValue.fromSafeInteger(50)).toString()
    };
    raised.series["1h"] = { ...raised.series["1h"], candles };
    assert.notEqual(
      candidateOf(raised).candidate.indicators.priorHigh20_1h,
      candidate.indicators.priorHigh20_1h
    );
  });

  it("refuses when the close only equals the prior high", () => {
    const snapshot = clone(buildPassingSnapshot());
    const candles = [...snapshot.series["1h"].candles];
    const priorHigh = candidateOf(buildPassingSnapshot()).candidate.indicators.priorHigh20_1h;
    const anchor = candles[candles.length - 1];
    candles[candles.length - 1] = {
      ...anchor,
      close: DecimalValue.fromString(priorHigh).toString(),
      high: DecimalValue.fromString(priorHigh).add(DecimalValue.fromSafeInteger(1)).toString()
    };
    snapshot.series["1h"] = { ...snapshot.series["1h"], candles };

    const result = evaluateCryptoMtfBreakoutV1(snapshot);
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.BREAKOUT_NOT_CONFIRMED));
  });
});

describe("CRYPTO_MTF_BREAKOUT_V1 — boundaries", () => {
  it("accepts relative volume of exactly 1.50 and refuses 1.49", () => {
    const onBoundary = withOneHourShape(buildPassingSnapshot(), { volume: 100, anchorVolume: 150 });
    const boundaryCandidate = candidateOf(onBoundary).candidate;
    assert.equal(boundaryCandidate.indicators.relativeVolume1h, "1.500000000000");

    const below = withOneHourShape(buildPassingSnapshot(), { volume: 100, anchorVolume: 149 });
    const result = evaluateCryptoMtfBreakoutV1(below);
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.RELATIVE_VOLUME_BELOW_MINIMUM));
  });

  it("accepts an adjusted score of exactly 70 and refuses 69", () => {
    const onBoundary = clone(buildPassingSnapshot());
    onBoundary.signals["1h"] = { ...onBoundary.signals["1h"]!, adjustedScore: 70 };
    assert.equal(candidateOf(onBoundary).outcome, "CANDIDATE");

    const below = clone(buildPassingSnapshot());
    below.signals["1h"] = { ...below.signals["1h"]!, adjustedScore: 69 };
    assert.ok(
      evaluateCryptoMtfBreakoutV1(below).reasonCodes.includes(
        StrategyReasonCode.SIGNAL_1H_SCORE_BELOW_MINIMUM
      )
    );
  });

  it("accepts an alignment score of exactly 0.65 and refuses one tick below", () => {
    const onBoundary = clone(buildPassingSnapshot());
    onBoundary.multiTimeframe = { ...onBoundary.multiTimeframe!, alignmentScore: "0.650000000000" };
    assert.equal(candidateOf(onBoundary).outcome, "CANDIDATE");

    const below = clone(buildPassingSnapshot());
    below.multiTimeframe = { ...below.multiTimeframe!, alignmentScore: "0.649999999999" };
    assert.ok(
      evaluateCryptoMtfBreakoutV1(below).reasonCodes.includes(
        StrategyReasonCode.MTF_ALIGNMENT_SCORE_BELOW_MINIMUM
      )
    );
  });

  it("accepts regime confidence of exactly 60 and refuses 59", () => {
    const onBoundary = clone(buildPassingSnapshot());
    onBoundary.marketRegime = { ...onBoundary.marketRegime!, confidence: 60 };
    assert.equal(candidateOf(onBoundary).outcome, "CANDIDATE");

    const below = clone(buildPassingSnapshot());
    below.marketRegime = { ...below.marketRegime!, confidence: 59 };
    assert.ok(
      evaluateCryptoMtfBreakoutV1(below).reasonCodes.includes(
        StrategyReasonCode.REGIME_CONFIDENCE_BELOW_MINIMUM
      )
    );
  });

  it("refuses HIGHER_TIMEFRAME_CONFIRMATION, which is not enough in v1", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.multiTimeframe = {
      ...snapshot.multiTimeframe!,
      alignment: "HIGHER_TIMEFRAME_CONFIRMATION"
    };
    assert.ok(
      evaluateCryptoMtfBreakoutV1(snapshot).reasonCodes.includes(
        StrategyReasonCode.MTF_NOT_BULLISH_ALIGNED
      )
    );
  });

  it("gives no bonus for an empty or neutral context, and blocks a critical bearish one", () => {
    const neutral = clone(buildPassingSnapshot());
    neutral.contextEvents = [
      {
        kind: "NEWS",
        id: "news-1",
        observedAt: "2026-08-02T08:00:00.000Z",
        eventType: "MACRO",
        severity: "INFO",
        directionalBias: "NEUTRAL",
        summary: "neutral"
      }
    ];
    assert.equal(candidateOf(neutral).outcome, "CANDIDATE");

    const bearish = clone(neutral);
    bearish.contextEvents = [
      { ...neutral.contextEvents[0], severity: "CRITICAL", directionalBias: "BEARISH" }
    ];
    assert.ok(
      evaluateCryptoMtfBreakoutV1(bearish).reasonCodes.includes(
        StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT
      )
    );
  });
});

describe("CRYPTO_MTF_BREAKOUT_V1 — determinism and purity", () => {
  it("returns byte-identical output for the same snapshot", () => {
    const first = evaluateCryptoMtfBreakoutV1(buildPassingSnapshot());
    const second = evaluateCryptoMtfBreakoutV1(buildPassingSnapshot());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.inputHash, second.inputHash);
    assert.equal(first.outputHash, second.outputHash);
  });

  it("changes the input hash when any decision value changes", () => {
    const base = evaluateCryptoMtfBreakoutV1(buildPassingSnapshot());
    const changed = clone(buildPassingSnapshot());
    changed.marketRegime = { ...changed.marketRegime!, confidence: 71 };
    assert.notEqual(evaluateCryptoMtfBreakoutV1(changed).inputHash, base.inputHash);
  });

  it("is independent of object key order", () => {
    const snapshot = buildPassingSnapshot();
    const reordered = Object.fromEntries(
      Object.entries(snapshot).reverse()
    ) as unknown as StrategyInputSnapshotV1;
    assert.notEqual(Object.keys(reordered)[0], Object.keys(snapshot)[0]);
    assert.equal(
      evaluateCryptoMtfBreakoutV1(reordered).inputHash,
      evaluateCryptoMtfBreakoutV1(snapshot).inputHash
    );
  });

  it("never mutates the snapshot", () => {
    const snapshot = buildPassingSnapshot();
    const before = JSON.stringify(snapshot);
    evaluateCryptoMtfBreakoutV1(snapshot);
    assert.equal(JSON.stringify(snapshot), before);
  });

  it("derives evaluatedAt from asOf, never from the system clock", () => {
    const snapshot = buildPassingSnapshot();
    assert.equal(evaluateCryptoMtfBreakoutV1(snapshot).evaluatedAt, snapshot.asOf);
  });
});

describe("CRYPTO_MTF_BREAKOUT_V1 — rejections", () => {
  for (const testCase of REJECTION_CASES) {
    it(`refuses: ${testCase.name}`, () => {
      const result = evaluateStrategy(testCase.mutate(ETH_BASE_SNAPSHOT()));
      assert.equal(result.outcome, testCase.expectedOutcome);
      assert.equal(result.candidate, null);
      assert.ok(
        result.reasonCodes.includes(testCase.expectedReasonCode),
        `expected ${testCase.expectedReasonCode}, got ${result.reasonCodes.join(",")}`
      );
    });
  }

  it("produces an ETH candidate from the unmutated base snapshot", () => {
    const candidate = candidateOf(ETH_BASE_SNAPSHOT()).candidate;
    assert.equal(candidate.symbol, "ETHUSDT");
    assert.equal(candidate.assetId, "asset-eth");
  });
});

describe("strategy registry", () => {
  it("exposes exactly one strategy in v1", () => {
    assert.deepEqual([...REGISTERED_STRATEGY_KEYS], [CRYPTO_MTF_BREAKOUT_V1_KEY]);
    assert.notEqual(getStrategy(CRYPTO_MTF_BREAKOUT_V1_KEY), null);
    assert.equal(getStrategy("SOME_OTHER_STRATEGY"), null);
  });

  it("refuses an unregistered strategy key", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.strategy = { ...snapshot.strategy, strategyKey: "CRYPTO_MTF_BREAKOUT_V2" };
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.deepEqual([...result.reasonCodes], [StrategyReasonCode.STRATEGY_KEY_UNKNOWN]);
  });

  it("refuses a strategy version whose engine version drifted", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.strategy = { ...snapshot.strategy, engineVersion: "crypto-mtf-breakout-v1/1.1.0" };
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.STRATEGY_ENGINE_VERSION_MISMATCH));
  });

  it("refuses a strategy version whose specification hash drifted", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.strategy = { ...snapshot.strategy, specificationHash: "f".repeat(64) };
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.STRATEGY_SPECIFICATION_HASH_MISMATCH));
  });

  it("refuses a strategy version without a code version", () => {
    const snapshot = clone(buildPassingSnapshot());
    snapshot.strategy = { ...snapshot.strategy, codeVersion: "  " };
    const result = evaluateStrategy(snapshot);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.STRATEGY_CODE_VERSION_MISSING));
  });

  it("pins the specification hash", () => {
    assert.equal(CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH.length, 64);
    assert.equal(PARAMS.allowedSymbols.length, 2);
    assert.deepEqual([...PARAMS.allowedSymbols], ["BTCUSDT", "ETHUSDT"]);
    assert.equal(PARAMS.leverageAllowed, false);
    assert.equal(PARAMS.marginAllowed, false);
    assert.equal(PARAMS.futuresAllowed, false);
    assert.equal(PARAMS.llmUsed, false);
    assert.equal(PARAMS.direction, "LONG");
  });
});
