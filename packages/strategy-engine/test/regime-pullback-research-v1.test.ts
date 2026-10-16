import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS,
  CRYPTO_NATIVE_REGIME_SOURCE,
  CRYPTO_REGIME_LONG_V1_ENGINE_VERSION,
  CRYPTO_REGIME_LONG_V1_KEY,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
  INDICATOR_ROUNDING,
  REGIME_LONG_V1_IDENTITY,
  REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
  REGIME_PULLBACK_RESEARCH_V1_KEY,
  REGIME_PULLBACK_RESEARCH_V1_RULES,
  StrategyReasonCode,
  averageTrueRange,
  evaluateRegimePullbackResearchV1,
  getStrategy,
  peakRelativeVolume,
  priorPeriodHigh,
  type PullbackResearchIndicatorSnapshotV1,
  type RegimePullbackResearchIdentityV1,
  type RegimePullbackResearchParameters,
  type StrategyCandidateResultV1,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { buildPassingSnapshot, clone } from "./support/build-snapshot.js";

type Mutable = { -readonly [K in keyof StrategyInputSnapshotV1]: StrategyInputSnapshotV1[K] };
const dec = (value: string) => DecimalValue.fromString(value);
const money = (value: number): string => (Math.round(value * 1e6) / 1e6).toFixed(6);

const RESEARCH = Object.freeze({ key: REGIME_PULLBACK_RESEARCH_V1_KEY, engineVersion: REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION, specificationHash: "a".repeat(64) });
const SEED: RegimePullbackResearchParameters = { pullbackLookbackHours: 72, pullbackDepthAtr1d: "1.5", requireReversalCandle: true, capitulationVolumeMinimum: "0" };

const identity = (overrides: Partial<RegimePullbackResearchParameters> = {}): RegimePullbackResearchIdentityV1 => ({
  ...REGIME_LONG_V1_IDENTITY,
  pullbackResearch: { ...SEED, ...overrides },
  researchIdentity: RESEARCH
});

/** The replay builds the snapshot from the registered hull (the challenger). */
function asHull(snapshot: StrategyInputSnapshotV1): Mutable {
  const next = clone(snapshot) as Mutable;
  next.strategy = { ...next.strategy, strategyKey: CRYPTO_REGIME_LONG_V1_KEY, engineVersion: CRYPTO_REGIME_LONG_V1_ENGINE_VERSION, specificationHash: CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH };
  next.marketRegime = { ...next.marketRegime!, source: CRYPTO_NATIVE_REGIME_SOURCE };
  return next;
}

/** Rewrites the 1h closes and volumes; open = previous close, high/low ± 110 around the body. */
function withHourly(snapshot: StrategyInputSnapshotV1, mutate: (closes: number[], volumes: number[]) => void): Mutable {
  const next = clone(snapshot) as Mutable;
  const candles = next.series["1h"].candles as unknown as { open: string; high: string; low: string; close: string; volume: string }[];
  const closes = candles.map((candle) => Number(candle.close));
  const volumes = candles.map(() => 100);
  mutate(closes, volumes);
  candles.forEach((candle, index) => {
    const open = index === 0 ? Number(candle.open) : closes[index - 1]!;
    const close = closes[index]!;
    candle.open = money(open);
    candle.close = money(close);
    candle.high = money(Math.max(open, close) + 110);
    candle.low = money(Math.min(open, close) - 110);
    candle.volume = money(volumes[index]!);
  });
  return next;
}

/** A 19-hour slide of 120 per hour, then an anchor candle that closes `anchorMove` above the previous close. */
const pullback = (anchorMove = 60) =>
  withHourly(asHull(buildPassingSnapshot()), (closes) => {
    const last = closes.length - 1;
    for (let index = last - 19; index < last; index += 1) closes[index] = closes[last - 20]! - (index - (last - 20)) * 120;
    closes[last] = closes[last - 1]! + anchorMove;
  });

const pinned = (snapshot: StrategyInputSnapshotV1, timeframe: "1h" | "1d") =>
  snapshot.series[timeframe].candles.map((candle) => ({ open: dec(candle.open), high: dec(candle.high), low: dec(candle.low), close: dec(candle.close), volume: dec(candle.volume) }));

describe("RESEARCH:REGIME_PULLBACK_LONG_V1 — the family's own entry evaluator", () => {
  it("is a research identity of its own: never registered, fixed exits, E4/E5 as every long strategy", () => {
    assert.equal(REGIME_PULLBACK_RESEARCH_V1_KEY, "RESEARCH:REGIME_PULLBACK_LONG_V1");
    assert.equal(REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION, "crypto-regime-pullback-research-v1/1.0.0");
    assert.equal(getStrategy(REGIME_PULLBACK_RESEARCH_V1_KEY), null, "no registry entry: the live pipeline cannot run it");
    assert.ok(Object.isFrozen(REGIME_PULLBACK_RESEARCH_V1_RULES));
    const rules = REGIME_PULLBACK_RESEARCH_V1_RULES;
    assert.deepEqual({ stop: rules.stopAtrMultiple1d, target: rules.takeProfitRMultiple, hold: rules.maxHoldHours, regimeExit: rules.regimeExit }, { stop: "2", target: "4", hold: 72, regimeExit: false });
    const LONG = CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS;
    assert.deepEqual([...rules.blockingContextSeverities], [...LONG.blockingContextSeverities]);
    assert.equal(rules.candidateTtlMs, LONG.candidateTtlMs);
    assert.equal(rules.entryGapAtrMultiple, LONG.entryGapAtrMultiple);
    assert.equal(rules.minimumRewardRisk, LONG.minimumRewardRisk);
    assert.equal(rules.atrPeriod1h, LONG.atrPeriod);
  });

  it("enters a pullback of at least 1.5 × ATR(1d) with a reversal candle, stop 2 × ATR(1d), target 4R, 72 h", () => {
    const snapshot = pullback();
    const result = evaluateRegimePullbackResearchV1(snapshot, identity());
    assert.equal(result.outcome, "CANDIDATE", result.reasonCodes.join(","));
    const { candidate } = result as StrategyCandidateResultV1;

    // The key is the replay hull's (registry, R-005); everything decided carries the research identity.
    assert.equal(candidate.strategyKey, CRYPTO_REGIME_LONG_V1_KEY);
    assert.equal(result.engineVersion, REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION);
    assert.equal(candidate.engineVersion, REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION);
    assert.equal(candidate.specificationHash, RESEARCH.specificationHash);
    assert.notEqual(candidate.specificationHash, CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH);
    const indicators = candidate.indicators as PullbackResearchIndicatorSnapshotV1;
    assert.equal(indicators.researchKey, REGIME_PULLBACK_RESEARCH_V1_KEY);
    assert.equal(indicators.researchEngineVersion, REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION);
    assert.equal(indicators.pullbackLookbackHours, 72);

    // E1 with the pinned formulas: the 72 candles before C0, C0 excluded.
    const hourly = pinned(snapshot, "1h");
    const atr1d = averageTrueRange(pinned(snapshot, "1d"), 14)!;
    const high = priorPeriodHigh(hourly, 72)!;
    const close = hourly.at(-1)!.close;
    assert.equal(indicators.atr14_1d, atr1d.toString());
    assert.equal(indicators.pullbackHigh_1h, high.toString());
    assert.equal(indicators.pullbackDepthAtr1d, high.sub(close).div(atr1d, INDICATOR_ROUNDING).toString());
    assert.ok(dec(indicators.pullbackDepthAtr1d).gte(dec("1.5")));
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.PULLBACK_DEPTH_CONFIRMED));
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REVERSAL_CANDLE_CONFIRMED));
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.CAPITULATION_VOLUME_NOT_REQUIRED));

    // Price plan on the tick grid, conservative in both directions.
    const entry = dec(candidate.referenceEntryPrice);
    const stop = dec(candidate.stopPrice);
    const rawStop = entry.sub(dec("2").mul(atr1d));
    assert.ok(stop.isMultipleOf(dec("0.01")) && stop.lte(rawStop) && rawStop.sub(stop).lt(dec("0.01")));
    const target = entry.add(dec("4").mul(dec(candidate.stopDistance)));
    assert.ok(dec(candidate.takeProfitPrice).lte(target) && target.sub(dec(candidate.takeProfitPrice)).lt(dec("0.01")));
    assert.ok(dec(candidate.plannedRewardRisk).gte(dec("2")));
    assert.equal(candidate.maxHoldHours, 72);
    assert.equal(candidate.direction, "LONG");
  });

  it("stays flat without a pullback (a rising market)", () => {
    const result = evaluateRegimePullbackResearchV1(asHull(buildPassingSnapshot()), identity());
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.PULLBACK_DEPTH_BELOW_MINIMUM), result.reasonCodes.join(","));
  });

  it("measures the depth over the configured window and against the configured bar", () => {
    const snapshot = pullback();
    const depthOf = (lookback: number) =>
      Number(((evaluateRegimePullbackResearchV1(snapshot, identity({ pullbackLookbackHours: lookback, pullbackDepthAtr1d: "0.25" })) as StrategyCandidateResultV1).candidate.indicators as PullbackResearchIndicatorSnapshotV1).pullbackDepthAtr1d);
    // The slide began 20 hours before C0: every window from 24 h on sees its top; a longer window can only see more.
    assert.ok(depthOf(24) > 1.5);
    assert.ok(depthOf(168) >= depthOf(24));
    const depth = depthOf(72);
    const bar = (Math.floor(depth * 4) / 4 + 0.25).toFixed(2);
    const deeper = evaluateRegimePullbackResearchV1(snapshot, identity({ pullbackDepthAtr1d: bar }));
    assert.equal(deeper.outcome, "NO_CANDIDATE");
    assert.ok(deeper.reasonCodes.includes(StrategyReasonCode.PULLBACK_DEPTH_BELOW_MINIMUM));
  });

  it("waits for the reversal candle unless the genome switches it off", () => {
    const falling = pullback(-30);
    const result = evaluateRegimePullbackResearchV1(falling, identity());
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.REVERSAL_CANDLE_MISSING), result.reasonCodes.join(","));
    const without = evaluateRegimePullbackResearchV1(falling, identity({ requireReversalCandle: false }));
    assert.equal(without.outcome, "CANDIDATE", without.reasonCodes.join(","));
    assert.ok(without.reasonCodes.includes(StrategyReasonCode.REVERSAL_CANDLE_NOT_REQUIRED));
  });

  it("requires capitulation volume among the last 6 candles when the filter is on", () => {
    const flat = pullback();
    const refused = evaluateRegimePullbackResearchV1(flat, identity({ capitulationVolumeMinimum: "2" }));
    assert.equal(refused.outcome, "NO_CANDIDATE");
    assert.ok(refused.reasonCodes.includes(StrategyReasonCode.CAPITULATION_VOLUME_BELOW_MINIMUM), refused.reasonCodes.join(","));

    const spikeAt = (offset: number) =>
      withHourly(pullback(), (_closes, volumes) => {
        volumes[volumes.length - 1 - offset] = 500;
      });
    // C−5 is the oldest candle of the window, C−6 is outside it.
    const inside = evaluateRegimePullbackResearchV1(spikeAt(5), identity({ capitulationVolumeMinimum: "3" }));
    assert.equal(inside.outcome, "CANDIDATE", inside.reasonCodes.join(","));
    assert.ok(inside.reasonCodes.includes(StrategyReasonCode.CAPITULATION_VOLUME_CONFIRMED));
    const outside = evaluateRegimePullbackResearchV1(spikeAt(6), identity({ capitulationVolumeMinimum: "3" }));
    assert.equal(outside.outcome, "NO_CANDIDATE");
    assert.equal(peakRelativeVolume(pinned(spikeAt(5), "1h"), 6, 20)!.toString(), dec("5").toString());
  });

  it("knows no regime: it decides identically in RISK_OFF (R-020 of the risk engine alone keeps it out)", () => {
    const riskOn = pullback();
    const riskOff = clone(riskOn) as Mutable;
    riskOff.marketRegime = { ...riskOff.marketRegime!, cryptoRegime: "RISK_OFF", riskMode: "DEFENSIVE", confidence: 10 };
    const on = evaluateRegimePullbackResearchV1(riskOn, identity());
    const off = evaluateRegimePullbackResearchV1(riskOff, identity());
    assert.equal(off.outcome, "CANDIDATE");
    assert.equal(off.reasonCodes.join(","), on.reasonCodes.join(","));
    assert.ok(!off.reasonCodes.some((code) => code.startsWith("REGIME_")), off.reasonCodes.join(","));
  });

  it("blocks on a critical bearish context event", () => {
    const event = { kind: "NEWS", id: "event-1", observedAt: "2026-08-02T08:30:00.000Z", eventType: "EXCHANGE_HACK", summary: "test", directionalBias: "NEUTRAL", severity: "CRITICAL" } as const;
    const neutral = pullback();
    neutral.contextEvents = [event];
    assert.equal(evaluateRegimePullbackResearchV1(neutral, identity()).outcome, "CANDIDATE");
    const bearish = pullback();
    bearish.contextEvents = [{ ...event, directionalBias: "BEARISH" }];
    const result = evaluateRegimePullbackResearchV1(bearish, identity());
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(result.reasonCodes.includes(StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT));
  });

  it("is deterministic and refuses an identity that is not the family's", () => {
    const snapshot = pullback();
    assert.deepEqual(evaluateRegimePullbackResearchV1(snapshot, identity()), evaluateRegimePullbackResearchV1(snapshot, identity()));
    assert.notEqual(
      evaluateRegimePullbackResearchV1(snapshot, identity()).outputHash,
      evaluateRegimePullbackResearchV1(snapshot, { ...identity(), researchIdentity: { ...RESEARCH, specificationHash: "b".repeat(64) } }).outputHash
    );
    assert.throws(() => evaluateRegimePullbackResearchV1(snapshot, { ...identity(), researchIdentity: { ...RESEARCH, engineVersion: CRYPTO_REGIME_LONG_V1_ENGINE_VERSION } }), /research identity/);
    assert.throws(() => evaluateRegimePullbackResearchV1(snapshot, { ...identity(), researchIdentity: { ...RESEARCH, key: CRYPTO_REGIME_LONG_V1_KEY } }), /research identity/);
    assert.throws(() => evaluateRegimePullbackResearchV1(snapshot, identity({ pullbackLookbackHours: 0 })), /pullbackLookbackHours/);
  });

  it("calls no other strategy's evaluator and no regime gate (import graph)", () => {
    const source = readFileSync(new URL("../src/crypto-regime-pullback-research-v1.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["crypto-regime-long-v1", "crypto-mtf-breakdown-short-v1", "registry", "regimeGateOpen", "evaluateCryptoRegimeLongV1", "evaluateCryptoMtfBreakoutV1", "evaluateCryptoMtfBreakdownShortV1", "evaluateStrategy", "marketRegime"]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
    // From the breakout module only the shared refusal and evidence helpers.
    assert.match(code, /import \{ buildEvidence, refuse, type BreakoutIdentityV1 \} from "\.\/crypto-mtf-breakout-v1\.js";/);
    // The challenger's evaluator stays untouched by the family.
    const challenger = readFileSync(new URL("../src/crypto-regime-long-v1.ts", import.meta.url), "utf8");
    assert.equal(challenger.includes("pullback"), false);
  });
});
