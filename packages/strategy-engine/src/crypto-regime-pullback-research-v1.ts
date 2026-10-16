/**
 * RESEARCH:REGIME_PULLBACK_LONG_V1 — entry evaluator of the independent
 * evolution family REGIME_PULLBACK_LONG ("Regime-Rücksetzer"). Replay only.
 *
 * Pre-registration: docs/trading/research/2026-10-16-evolution-family-regime-pullback-preregistration.md.
 *
 * The family buys a temporary weakness and is out again after at most three
 * days. Entry at the close of a 1h candle C0:
 *   E1  (highest high of the `pullbackLookbackHours` 1h candles before C0 − close C0)
 *       ÷ ATR(14, 1d) ≥ `pullbackDepthAtr1d`;
 *   E2  if `requireReversalCandle`: close C0 > open C0 and close C0 > close C−1;
 *   E3  if `capitulationVolumeMinimum` > 0: the highest relative volume of the
 *       last 6 closed 1h candles (C0 included, each against the mean of the 20
 *       candles before it) ≥ the minimum;
 *   E4  a critical bearish context event blocks (as for every long strategy);
 *   E5  validity 2 h, entry gap ≤ 0.5 × ATR(14, 1h) (standard of every long strategy).
 * Price plan and exits are fixed for the whole family: stop 2 × ATR(14, 1d)
 * below the entry, target 4 × the stop distance, minimum reward/risk 2, time
 * exit after 72 h, no regime exit.
 *
 * Deliberately not here:
 *   - no regime rule. The evaluator never reads the regime for its decision;
 *     R-020 of the unchanged risk engine alone restricts entries to RISK_ON,
 *     exactly as for every other long candidate;
 *   - no call into another strategy's evaluator and no regime gate
 *     (`regimeGateOpen`); only the shared input validation, evidence, pinned
 *     indicator formulas and tick alignment are reused;
 *   - no registry entry and no StrategyVersion: the live pipeline cannot run it.
 *
 * Identity: the replay and R-005 need a registered, approved strategy key, so
 * the identity carries the challenger's key, engine version and specification
 * hash as a technical replay hull — the snapshot is validated against it and
 * the candidate's strategy key is the hull key. Everything this evaluator
 * decides is labelled with its own research identity: the engine version and
 * specification hash of every result and draft, and the research fields of the
 * indicator snapshot. A replay hull is never a forward approval.
 */

import {
  DecimalValue,
  RoundingMode,
  buildCandidateKey,
  buildInputHash,
  buildOutputHash
} from "@signalpilot/trading-domain";

import type {
  PullbackResearchIndicatorSnapshotV1,
  StrategyCheckV1,
  StrategyEvaluationResultV1,
  StrategyInputSnapshotV1,
  TradeCandidateDraftV1
} from "./contracts.js";
import { buildEvidence, refuse, type BreakoutIdentityV1 } from "./crypto-mtf-breakout-v1.js";
import {
  INDICATOR_ROUNDING,
  averageTrueRange,
  priorAverageVolume,
  priorPeriodHigh,
  relativeVolume,
  type PinnedCandle
} from "./indicators-v1.js";
import { alignStopToTick, alignTakeProfitToTick, usableTickSize } from "./price-plan.js";
import { StrategyCheckStage, StrategyEvaluationOutcome, StrategyReasonCode } from "./reason-codes.js";
import { createCheckLog, validateStrategyInput } from "./validate-input.js";

/** Research identity of the family; never a registered strategy key. */
export const REGIME_PULLBACK_RESEARCH_V1_KEY = "RESEARCH:REGIME_PULLBACK_LONG_V1";
export const REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION = "crypto-regime-pullback-research-v1/1.0.0";

const HOUR_MS = 3_600_000;

/**
 * Fixed rules of the family (not searchable). Part of the family's
 * pre-registration hash; E4/E5 equal the standard of every long strategy.
 */
export const REGIME_PULLBACK_RESEARCH_V1_RULES = Object.freeze({
  /** E1: unit of the pullback depth, and the stop distance. */
  atrPeriod1d: 14,
  /** E3: candles inspected for capitulation volume (C0 included) and the average period of each. */
  capitulationVolumeWindow: 6,
  capitulationVolumeAveragePeriod: 20,
  /** E4. */
  blockingContextSeverities: Object.freeze(["CRITICAL"] as const),
  /** E5. */
  candidateTtlMs: 2 * HOUR_MS,
  atrPeriod1h: 14,
  entryGapAtrMultiple: "0.5",
  /** Price plan and exits. */
  stopAtrMultiple1d: "2",
  takeProfitRMultiple: "4",
  minimumRewardRisk: "2",
  maxHoldHours: 72,
  regimeExit: false
});

const RULES = REGIME_PULLBACK_RESEARCH_V1_RULES;
const ENTRY = StrategyCheckStage.ENTRY;
const PRICE_PLAN = StrategyCheckStage.PRICE_PLAN;
const STOP_ATR_MULTIPLE = DecimalValue.fromString(RULES.stopAtrMultiple1d);
const TAKE_PROFIT_R = DecimalValue.fromString(RULES.takeProfitRMultiple);
const MINIMUM_REWARD_RISK = DecimalValue.fromString(RULES.minimumRewardRisk);
const ENTRY_GAP_ATR_MULTIPLE = DecimalValue.fromString(RULES.entryGapAtrMultiple);

/** The searchable entry parameters (the family genome). */
export interface RegimePullbackResearchParameters {
  readonly pullbackLookbackHours: number;
  readonly pullbackDepthAtr1d: string;
  readonly requireReversalCandle: boolean;
  /** "0" switches E3 off. */
  readonly capitulationVolumeMinimum: string;
}

export interface PullbackResearchIdentity {
  readonly key: string;
  readonly engineVersion: string;
  readonly specificationHash: string;
}

/** Replay-hull identity plus the family's own research identity and genome. Only ever exists inside a replay. */
export interface RegimePullbackResearchIdentityV1 extends BreakoutIdentityV1 {
  readonly pullbackResearch: RegimePullbackResearchParameters;
  readonly researchIdentity: PullbackResearchIdentity;
}

interface PullbackRules {
  readonly lookbackHours: number;
  readonly depth: DecimalValue;
  readonly requireReversalCandle: boolean;
  readonly volumeMinimum: DecimalValue;
}

function compilePullbackRules(parameters: RegimePullbackResearchParameters): PullbackRules {
  if (!Number.isSafeInteger(parameters.pullbackLookbackHours) || parameters.pullbackLookbackHours < 1) {
    throw new Error(`pullbackLookbackHours must be a positive integer, got ${String(parameters.pullbackLookbackHours)}.`);
  }
  const depth = DecimalValue.fromString(parameters.pullbackDepthAtr1d);
  const volumeMinimum = DecimalValue.fromString(parameters.capitulationVolumeMinimum);
  if (!depth.isPositive()) throw new Error(`pullbackDepthAtr1d must be positive, got ${parameters.pullbackDepthAtr1d}.`);
  if (volumeMinimum.isNegative()) throw new Error(`capitulationVolumeMinimum must not be negative, got ${parameters.capitulationVolumeMinimum}.`);
  return { lookbackHours: parameters.pullbackLookbackHours, depth, requireReversalCandle: parameters.requireReversalCandle === true, volumeMinimum };
}

/**
 * Highest relative volume among the last `window` candles (the newest
 * included), each measured against the mean volume of the `period` candles
 * before it; null when no candle of the window has a usable average.
 */
export function peakRelativeVolume(candles: readonly PinnedCandle[], window = 6, period = 20): DecimalValue | null {
  let peak: DecimalValue | null = null;
  for (let offset = 0; offset < window; offset += 1) {
    const end = candles.length - offset;
    if (end < period + 1) break;
    const slice = candles.slice(end - period - 1, end);
    const value = relativeVolume(slice[slice.length - 1]!.volume, priorAverageVolume(slice, period));
    if (value !== null && (peak === null || value.gt(peak))) peak = value;
  }
  return peak;
}

export function evaluateRegimePullbackResearchV1(snapshot: StrategyInputSnapshotV1, identity: RegimePullbackResearchIdentityV1): StrategyEvaluationResultV1 {
  const research = identity.researchIdentity;
  if (research?.key !== REGIME_PULLBACK_RESEARCH_V1_KEY || research.engineVersion !== REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION || !/^[0-9a-f]{64}$/.test(research.specificationHash)) {
    throw new Error("evaluateRegimePullbackResearchV1 needs the family's research identity (key, engine version, specification hash).");
  }
  const rules = compilePullbackRules(identity.pullbackResearch);
  // Results carry the research identity; the key stays the replay hull's (registry, R-005).
  const labelled: BreakoutIdentityV1 = { ...identity, engineVersion: research.engineVersion, specificationHash: research.specificationHash };
  const inputHash = buildInputHash(snapshot);
  const evaluatedAt = typeof snapshot?.asOf === "string" ? snapshot.asOf : "1970-01-01T00:00:00.000Z";

  // The snapshot is built from the registered hull, so it is validated against the hull.
  const validation = validateStrategyInput(snapshot, identity);
  if (!validation.ok) {
    return refuse(labelled, StrategyEvaluationOutcome.INVALID_INPUT, validation.checks, validation.failures, inputHash, evaluatedAt);
  }
  const validated = validation.validated;
  const log = createCheckLog();
  const hourly = validated.series["1h"].candles;
  const anchor = validated.series["1h"].anchor;
  const previous = hourly[hourly.length - 2]!;
  const close = anchor.close;
  const atr1d = averageTrueRange(validated.series["1d"].candles, RULES.atrPeriod1d);
  const atr1h = averageTrueRange(hourly, RULES.atrPeriod1h);

  // ── E1: pullback depth in daily volatility ───────────────────────────────
  const pullbackHigh = priorPeriodHigh(hourly, rules.lookbackHours);
  let depth: DecimalValue | null = null;
  if (pullbackHigh === null || atr1d === null || !atr1d.isPositive()) {
    log.fail("PULLBACK_DEPTH", ENTRY, StrategyReasonCode.PULLBACK_REFERENCE_UNAVAILABLE, null, rules.depth.toString());
  } else {
    depth = pullbackHigh.sub(close).div(atr1d, INDICATOR_ROUNDING);
    if (depth.gte(rules.depth)) log.pass("PULLBACK_DEPTH", ENTRY, StrategyReasonCode.PULLBACK_DEPTH_CONFIRMED, depth.toString(), rules.depth.toString());
    else log.fail("PULLBACK_DEPTH", ENTRY, StrategyReasonCode.PULLBACK_DEPTH_BELOW_MINIMUM, depth.toString(), rules.depth.toString());
  }

  // ── E2: reversal candle ──────────────────────────────────────────────────
  if (!rules.requireReversalCandle) {
    log.pass("REVERSAL_CANDLE", ENTRY, StrategyReasonCode.REVERSAL_CANDLE_NOT_REQUIRED);
  } else if (close.gt(anchor.open) && close.gt(previous.close)) {
    log.pass("REVERSAL_CANDLE", ENTRY, StrategyReasonCode.REVERSAL_CANDLE_CONFIRMED, close.toString(), DecimalValue.max(anchor.open, previous.close).toString());
  } else {
    log.fail("REVERSAL_CANDLE", ENTRY, StrategyReasonCode.REVERSAL_CANDLE_MISSING, close.toString(), DecimalValue.max(anchor.open, previous.close).toString());
  }

  // ── E3: capitulation volume ──────────────────────────────────────────────
  const peakVolume = peakRelativeVolume(hourly, RULES.capitulationVolumeWindow, RULES.capitulationVolumeAveragePeriod);
  if (rules.volumeMinimum.isZero()) {
    log.pass("CAPITULATION_VOLUME", ENTRY, StrategyReasonCode.CAPITULATION_VOLUME_NOT_REQUIRED, peakVolume?.toString() ?? null, "0");
  } else if (peakVolume === null) {
    log.fail("CAPITULATION_VOLUME", ENTRY, StrategyReasonCode.CAPITULATION_VOLUME_UNAVAILABLE, null, rules.volumeMinimum.toString());
  } else if (peakVolume.gte(rules.volumeMinimum)) {
    log.pass("CAPITULATION_VOLUME", ENTRY, StrategyReasonCode.CAPITULATION_VOLUME_CONFIRMED, peakVolume.toString(), rules.volumeMinimum.toString());
  } else {
    log.fail("CAPITULATION_VOLUME", ENTRY, StrategyReasonCode.CAPITULATION_VOLUME_BELOW_MINIMUM, peakVolume.toString(), rules.volumeMinimum.toString());
  }

  // ── E4: critical bearish context events ──────────────────────────────────
  const blocking = validated.contextEvents.filter(
    (event) => event.directionalBias === "BEARISH" && RULES.blockingContextSeverities.includes(event.severity as never)
  );
  if (blocking.length > 0) {
    log.fail("CONTEXT_EVENTS", ENTRY, StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT, blocking.map((event) => event.id).sort().join(","), "0");
  } else {
    log.pass("CONTEXT_EVENTS", ENTRY, StrategyReasonCode.CONTEXT_NO_BLOCKING_EVENT, "0", "0");
  }

  // ── E5: candidate validity window ────────────────────────────────────────
  const expiresAtMs = anchor.closeTimeMs + RULES.candidateTtlMs;
  if (expiresAtMs <= validated.asOfMs) {
    log.fail("CANDIDATE_VALIDITY", ENTRY, StrategyReasonCode.CANDIDATE_ALREADY_EXPIRED, new Date(expiresAtMs).toISOString(), snapshot.asOf);
  } else {
    log.pass("CANDIDATE_VALIDITY", ENTRY, StrategyReasonCode.CANDIDATE_WITHIN_VALIDITY_WINDOW, new Date(expiresAtMs).toISOString(), snapshot.asOf);
  }

  // ── Price plan: stop 2 × ATR(1d), target 4R, both on the tick grid ───────
  const tick = usableTickSize(validated.executionProfile.tickSize);
  if (tick === null) {
    log.fail("PRICE_TICK_ALIGNMENT", PRICE_PLAN, StrategyReasonCode.PRICE_TICK_SIZE_INVALID, String(validated.executionProfile.tickSize), "> 0");
  } else {
    log.pass("PRICE_TICK_ALIGNMENT", PRICE_PLAN, StrategyReasonCode.PRICE_PLAN_TICK_ALIGNED, tick.toString());
  }
  let stopPrice: DecimalValue | null = null;
  let takeProfitPrice: DecimalValue | null = null;
  let plannedRewardRisk: DecimalValue | null = null;
  if (atr1d === null || !atr1d.isPositive() || atr1h === null || !atr1h.isPositive()) {
    log.fail("ATR_1D", PRICE_PLAN, StrategyReasonCode.ATR_UNAVAILABLE);
  } else if (tick !== null) {
    log.pass("ATR_1D", PRICE_PLAN, StrategyReasonCode.STOP_DISTANCE_ATR_APPLIED, atr1d.toString(), RULES.stopAtrMultiple1d);
    stopPrice = alignStopToTick("LONG", close.sub(STOP_ATR_MULTIPLE.mul(atr1d, RoundingMode.CEIL)), tick);
    if (!stopPrice.isPositive()) {
      log.fail("STOP_PRICE", PRICE_PLAN, StrategyReasonCode.STOP_PRICE_NOT_POSITIVE, stopPrice.toString(), "0.000000000000");
    } else {
      log.pass("STOP_PRICE", PRICE_PLAN, StrategyReasonCode.PRICE_PLAN_VALID, stopPrice.toString());
      const stopDistance = close.sub(stopPrice);
      takeProfitPrice = alignTakeProfitToTick("LONG", close.add(TAKE_PROFIT_R.mul(stopDistance, RoundingMode.FLOOR)), tick);
      plannedRewardRisk = takeProfitPrice.sub(close).div(stopDistance, RoundingMode.FLOOR);
      if (plannedRewardRisk.lt(MINIMUM_REWARD_RISK)) {
        log.fail("REWARD_RISK", PRICE_PLAN, StrategyReasonCode.REWARD_RISK_BELOW_MINIMUM, plannedRewardRisk.toString(), MINIMUM_REWARD_RISK.toString());
      } else {
        log.pass("REWARD_RISK", PRICE_PLAN, StrategyReasonCode.REWARD_RISK_CONFIRMED, plannedRewardRisk.toString(), MINIMUM_REWARD_RISK.toString());
      }
    }
  }

  const checks: readonly StrategyCheckV1[] = Object.freeze([...validation.checks, ...log.checks]);
  if (
    log.hasFailure ||
    atr1d === null ||
    atr1h === null ||
    pullbackHigh === null ||
    depth === null ||
    stopPrice === null ||
    takeProfitPrice === null ||
    plannedRewardRisk === null
  ) {
    return refuse(labelled, StrategyEvaluationOutcome.NO_CANDIDATE, checks, log.failures, inputHash, evaluatedAt);
  }

  // ── Candidate draft ──────────────────────────────────────────────────────
  const stopDistance = close.sub(stopPrice);
  const maximumEntryGap = ENTRY_GAP_ATR_MULTIPLE.mul(atr1h, RoundingMode.FLOOR);
  const indicators: PullbackResearchIndicatorSnapshotV1 = {
    close1h: close.toString(),
    open1h: anchor.open.toString(),
    previousClose1h: previous.close.toString(),
    atr14_1h: atr1h.toString(),
    close1d: validated.series["1d"].anchor.close.toString(),
    atr14_1d: atr1d.toString(),
    pullbackLookbackHours: rules.lookbackHours,
    pullbackHigh_1h: pullbackHigh.toString(),
    pullbackDepthAtr1d: depth.toString(),
    peakRelativeVolume6_1h: peakVolume?.toString() ?? null,
    researchKey: research.key,
    researchEngineVersion: research.engineVersion,
    researchSpecificationHash: research.specificationHash
  };
  const reasonCodes = Object.freeze([...new Set(log.checks.filter((check) => check.passed).map((check) => check.reasonCode))].sort());

  const draftWithoutOutputHash = {
    candidateKey: buildCandidateKey({
      strategyAssignmentId: validated.snapshot.assignment.id,
      strategyVersionId: validated.snapshot.strategy.strategyVersionId,
      assetId: validated.snapshot.asset.id,
      anchorCandleId: anchor.id
    }),
    strategyKey: identity.key,
    strategyVersionId: validated.snapshot.strategy.strategyVersionId,
    strategyAssignmentId: validated.snapshot.assignment.id,
    portfolioId: validated.snapshot.assignment.portfolioId,
    assetId: validated.snapshot.asset.id,
    symbol: validated.snapshot.asset.symbol,
    anchorCandleId: anchor.id,
    anchorSignalId: validated.signals["1h"].id,
    direction: "LONG",
    entryType: "MARKET",
    status: "CREATED",
    dataAsOf: snapshot.asOf,
    decisionTime: snapshot.asOf,
    validFrom: anchor.closeTime,
    earliestFillAt: anchor.closeTime,
    expiresAt: new Date(expiresAtMs).toISOString(),
    referenceEntryPrice: close.toString(),
    plannedEntryMinimum: stopPrice.toString(),
    plannedEntryMaximum: close.add(maximumEntryGap).toString(),
    maximumEntryGapDistance: maximumEntryGap.toString(),
    stopPrice: stopPrice.toString(),
    stopDistance: stopDistance.toString(),
    stopDistancePct: stopDistance.div(close, RoundingMode.CEIL).toString(),
    takeProfitPrice: takeProfitPrice.toString(),
    minimumRewardRisk: MINIMUM_REWARD_RISK.toString(),
    plannedRewardRisk: plannedRewardRisk.toString(),
    maxHoldHours: RULES.maxHoldHours,
    indicators,
    evidence: buildEvidence(validated),
    reasonCodes,
    engineVersion: labelled.engineVersion,
    specificationHash: labelled.specificationHash,
    inputHash
  } as const;

  const core = {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: labelled.key,
    engineVersion: labelled.engineVersion,
    specificationHash: labelled.specificationHash,
    inputHash,
    reasonCodes,
    checks,
    candidate: draftWithoutOutputHash
  };
  const outputHash = buildOutputHash(core);
  const candidate: TradeCandidateDraftV1 = Object.freeze({ ...draftWithoutOutputHash, outputHash });

  return {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: labelled.key,
    engineVersion: labelled.engineVersion,
    specificationHash: labelled.specificationHash,
    inputHash,
    outputHash,
    evaluatedAt,
    reasonCodes,
    checks,
    candidate
  };
}
