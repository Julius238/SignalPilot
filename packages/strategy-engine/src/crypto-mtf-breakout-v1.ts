/**
 * `CRYPTO_MTF_BREAKOUT_V1` — the only strategy of shadow trading v1.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md in full
 * ("Entry-Voraussetzungen", "Candidate-Preisplan", "Candidate-Gültigkeit").
 *
 * Crypto spot, long only, USDT quote, BTCUSDT and ETHUSDT only, decision on the
 * newest closed 1h candle with 4h and 1d confirmation. No leverage, no margin,
 * no futures, no LLM. The function is pure: same snapshot in, byte-identical
 * result and hash out (docs/trading/decisions/0003-deterministic-versioned-engines.md).
 *
 * The engine proposes prices only. Quantity, equity and risk budget belong to
 * the risk engine (docs/trading/05, "Positionsgrößenformel").
 */

import {
  DecimalValue,
  RoundingMode,
  buildCandidateKey,
  buildEvidenceSourceKey,
  buildInputHash,
  buildOutputHash,
  buildPayloadHash
} from "@signalpilot/trading-domain";

import {
  STRATEGY_TIMEFRAMES,
  type SnapshotSignalV1,
  type StrategyCheckV1,
  type StrategyEvaluationResultV1,
  type StrategyEvidenceDraftV1,
  type StrategyIndicatorSnapshotV1,
  type StrategyInputSnapshotV1,
  type StrategyTimeframe,
  type TradeCandidateDraftV1
} from "./contracts.js";
import {
  atrToCloseRatio,
  averageTrueRange,
  priorAverageVolume,
  priorPeriodHigh,
  relativeStrengthIndex,
  relativeVolume,
  simpleMovingAverage
} from "./indicators-v1.js";
import { StrategyCheckStage, StrategyEvaluationOutcome, StrategyReasonCode } from "./reason-codes.js";
import {
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
} from "./specification-v1.js";
import {
  createCheckLog,
  parseDecimalString,
  validateStrategyInput,
  type ParsedSeriesV1,
  type StrategyCheckLog,
  type ValidatedSnapshotV1
} from "./validate-input.js";

const PARAMS = CRYPTO_MTF_BREAKOUT_V1_PARAMETERS;
const ENTRY = StrategyCheckStage.ENTRY;
const PRICE_PLAN = StrategyCheckStage.PRICE_PLAN;

const RSI_MINIMUM = DecimalValue.fromString(PARAMS.rsiMinimum);
const RSI_MAXIMUM = DecimalValue.fromString(PARAMS.rsiMaximum);
const RELATIVE_VOLUME_MINIMUM = DecimalValue.fromString(PARAMS.relativeVolumeMinimum);
const ATR_RATIO_MINIMUM = DecimalValue.fromString(PARAMS.atrToCloseMinimum);
const ATR_RATIO_MAXIMUM = DecimalValue.fromString(PARAMS.atrToCloseMaximum);
const MTF_MINIMUM_ALIGNMENT = DecimalValue.fromString(PARAMS.multiTimeframeMinimumAlignmentScore);
const STOP_ATR_MULTIPLE = DecimalValue.fromString(PARAMS.stopAtrMultiple);
const STOP_FLOOR_PCT = DecimalValue.fromString(PARAMS.stopDistanceFloorPct);
const STOP_CAP_PCT = DecimalValue.fromString(PARAMS.stopDistanceCapPct);
const TAKE_PROFIT_R_MULTIPLE = DecimalValue.fromString(PARAMS.takeProfitRMultiple);
const MINIMUM_REWARD_RISK = DecimalValue.fromString(PARAMS.minimumRewardRisk);
const ENTRY_GAP_ATR_MULTIPLE = DecimalValue.fromString(PARAMS.entryGapAtrMultiple);

/** Indicator bundle of one timeframe, computed from the pinned formulas. */
interface TimeframeIndicators {
  readonly close: DecimalValue;
  readonly sma20: DecimalValue | null;
  readonly sma50: DecimalValue | null;
  readonly sma200: DecimalValue | null;
}

function timeframeIndicators(series: ParsedSeriesV1): TimeframeIndicators {
  const closes = series.candles.map((candle) => candle.close);
  return {
    close: series.anchor.close,
    sma20: simpleMovingAverage(closes, PARAMS.smaFastPeriod),
    sma50: simpleMovingAverage(closes, PARAMS.smaMediumPeriod),
    sma200: simpleMovingAverage(closes, PARAMS.smaSlowPeriod)
  };
}

/** `SignalRuleApplication.adjustedStatus` wins over the raw signal status. */
const effectiveStatus = (signal: SnapshotSignalV1): string => signal.adjustedStatus ?? signal.status;

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// ───────────────────────────────────────────────────────────────────────────
// Evidence
// ───────────────────────────────────────────────────────────────────────────

function evidence(
  type: StrategyEvidenceDraftV1["type"],
  sourceType: string,
  sourceId: string | null,
  observedAt: string,
  capturedAt: string,
  required: boolean,
  payload: Readonly<Record<string, unknown>>
): StrategyEvidenceDraftV1 {
  return {
    type,
    sourceType,
    sourceId,
    sourceKey: buildEvidenceSourceKey({ type, sourceType, sourceId }),
    observedAt,
    capturedAt,
    required,
    payload,
    payloadHash: buildPayloadHash(payload)
  };
}

function buildEvidence(validated: ValidatedSnapshotV1): readonly StrategyEvidenceDraftV1[] {
  const capturedAt = validated.snapshot.asOf;
  const drafts: StrategyEvidenceDraftV1[] = [];

  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const series = validated.series[timeframe];
    const anchor = series.anchor;
    drafts.push(
      evidence("CANDLE", "Candle", anchor.id, anchor.closeTime, capturedAt, true, {
        timeframe,
        candleCount: series.candles.length,
        openTime: anchor.openTime,
        closeTime: anchor.closeTime,
        open: anchor.open.toString(),
        high: anchor.high.toString(),
        low: anchor.low.toString(),
        close: anchor.close.toString(),
        volume: anchor.volume.toString(),
        source: anchor.source,
        firstOpenTime: series.candles[0].openTime
      })
    );
  }

  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const quality = validated.snapshot.series[timeframe].dataQuality;
    if (quality === null) continue;
    drafts.push(
      evidence("DATA_QUALITY", "CandleDataQuality", quality.id, quality.observedAt, capturedAt, true, {
        timeframe,
        provider: quality.provider,
        candleCount: quality.candleCount,
        expectedCandleCount: quality.expectedCandleCount,
        gapCount: quality.gapCount,
        missingCandleCount: quality.missingCandleCount,
        providerErrorCount: quality.providerErrorCount,
        lastErrorKind: quality.lastErrorKind
      })
    );
  }

  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const signal = validated.signals[timeframe];
    drafts.push(
      evidence("SIGNAL", "Signal", signal.id, signal.createdAt, capturedAt, true, {
        timeframe,
        signalType: signal.signalType,
        status: signal.status,
        adjustedStatus: signal.adjustedStatus,
        direction: signal.direction,
        riskLevel: signal.riskLevel,
        baseScore: signal.baseScore,
        adjustedScore: signal.adjustedScore,
        adjustedScoreSource: signal.adjustedScoreSource,
        ruleApplicationId: signal.ruleApplicationId
      })
    );
  }

  const mtf = validated.multiTimeframe;
  drafts.push(
    evidence("MTF", "MultiTimeframeSummary", null, validated.snapshot.asOf, capturedAt, true, {
      version: mtf.version,
      alignment: mtf.alignment,
      alignmentScore: mtf.alignmentScore,
      alignmentScoreRaw: mtf.alignmentScoreRaw,
      primaryTimeframe: mtf.primaryTimeframe,
      confirmingTimeframes: [...mtf.confirmingTimeframes],
      conflictingTimeframes: [...mtf.conflictingTimeframes],
      riskLevel: mtf.riskLevel,
      sourceSignalIds: [...mtf.sourceSignalIds]
    })
  );

  const regime = validated.marketRegime;
  drafts.push(
    evidence("REGIME", "MarketRegimeSnapshot", regime.id, regime.generatedAt, capturedAt, true, {
      cryptoRegime: regime.cryptoRegime,
      overallRegime: regime.overallRegime,
      equityRegime: regime.equityRegime,
      riskMode: regime.riskMode,
      confidence: regime.confidence
    })
  );

  const profile = validated.executionProfile;
  drafts.push(
    evidence(
      "EXECUTION_PROFILE",
      "InstrumentExecutionProfile",
      profile.id,
      profile.sourceObservedAt,
      capturedAt,
      true,
      {
        version: profile.version,
        tickSize: profile.tickSize,
        stepSize: profile.stepSize,
        minQuantity: profile.minQuantity,
        minNotional: profile.minNotional,
        feeBps: profile.feeBps,
        fullSpreadBps: profile.fullSpreadBps,
        slippageBps: profile.slippageBps,
        specificationHash: profile.specificationHash
      }
    )
  );

  const contextKinds = { RADAR: "RADAR", NEWS: "NEWS", MARKET_EVENT: "EVENT" } as const;
  const sortedContext = [...validated.contextEvents].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  for (const event of sortedContext) {
    drafts.push(
      evidence(contextKinds[event.kind], event.kind, event.id, event.observedAt, capturedAt, false, {
        eventType: event.eventType,
        severity: event.severity,
        directionalBias: event.directionalBias,
        summary: event.summary
      })
    );
  }

  return Object.freeze(drafts);
}

// ───────────────────────────────────────────────────────────────────────────
// Result assembly
// ───────────────────────────────────────────────────────────────────────────

function sortedUnique(codes: readonly StrategyReasonCode[]): readonly StrategyReasonCode[] {
  return Object.freeze([...new Set(codes)].sort());
}

function refuse(
  outcome: typeof StrategyEvaluationOutcome.NO_CANDIDATE | typeof StrategyEvaluationOutcome.INVALID_INPUT,
  checks: readonly StrategyCheckV1[],
  failures: readonly StrategyReasonCode[],
  inputHash: string,
  evaluatedAt: string
): StrategyEvaluationResultV1 {
  const reasonCodes = sortedUnique(failures);
  const core = {
    outcome,
    strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash,
    reasonCodes,
    checks,
    candidate: null
  };
  const base = {
    strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash,
    outputHash: buildOutputHash(core),
    evaluatedAt,
    reasonCodes,
    checks,
    primaryReasonCode: failures[0] ?? StrategyReasonCode.SNAPSHOT_MALFORMED,
    candidate: null
  } as const;

  return outcome === StrategyEvaluationOutcome.INVALID_INPUT
    ? { ...base, outcome: StrategyEvaluationOutcome.INVALID_INPUT }
    : { ...base, outcome: StrategyEvaluationOutcome.NO_CANDIDATE };
}

// ───────────────────────────────────────────────────────────────────────────
// Entry conditions
// ───────────────────────────────────────────────────────────────────────────

function evaluateTrend(log: StrategyCheckLog, validated: ValidatedSnapshotV1): {
  readonly one: TimeframeIndicators;
  readonly four: TimeframeIndicators;
  readonly day: TimeframeIndicators;
} {
  const one = timeframeIndicators(validated.series["1h"]);
  const four = timeframeIndicators(validated.series["4h"]);
  const day = timeframeIndicators(validated.series["1d"]);

  // close(C0) > SMA20 > SMA50 > SMA200 on 1h (docs/trading/05).
  if (one.sma20 === null || one.sma50 === null || one.sma200 === null) {
    log.fail("TREND_1H", ENTRY, StrategyReasonCode.TREND_INDICATOR_UNAVAILABLE, "1h");
  } else if (one.close.gt(one.sma20) && one.sma20.gt(one.sma50) && one.sma50.gt(one.sma200)) {
    log.pass("TREND_1H", ENTRY, StrategyReasonCode.TREND_FILTER_1H_PASSED, one.close.toString(), one.sma20.toString());
  } else {
    log.fail("TREND_1H", ENTRY, StrategyReasonCode.TREND_FILTER_1H_FAILED, one.close.toString(), one.sma20.toString());
  }

  for (const [label, indicators, passCode, failCode] of [
    ["TREND_4H", four, StrategyReasonCode.TREND_FILTER_4H_PASSED, StrategyReasonCode.TREND_FILTER_4H_FAILED],
    ["TREND_1D", day, StrategyReasonCode.TREND_FILTER_1D_PASSED, StrategyReasonCode.TREND_FILTER_1D_FAILED]
  ] as const) {
    if (indicators.sma50 === null || indicators.sma200 === null) {
      log.fail(label, ENTRY, StrategyReasonCode.TREND_INDICATOR_UNAVAILABLE, label);
      continue;
    }
    if (indicators.close.gt(indicators.sma50) && indicators.sma50.gt(indicators.sma200)) {
      log.pass(label, ENTRY, passCode, indicators.close.toString(), indicators.sma50.toString());
    } else {
      log.fail(label, ENTRY, failCode, indicators.close.toString(), indicators.sma50.toString());
    }
  }

  return { one, four, day };
}

function evaluateSignals(log: StrategyCheckLog, validated: ValidatedSnapshotV1): void {
  const signal1h = validated.signals["1h"];
  const status1h = effectiveStatus(signal1h);

  if (signal1h.direction !== PARAMS.signalDirection1h) {
    log.fail(
      "SIGNAL_1H",
      ENTRY,
      StrategyReasonCode.SIGNAL_1H_DIRECTION_NOT_BULLISH,
      signal1h.direction,
      PARAMS.signalDirection1h
    );
  } else if (!PARAMS.signalAllowedStatuses1h.includes(status1h as never)) {
    log.fail(
      "SIGNAL_1H",
      ENTRY,
      StrategyReasonCode.SIGNAL_1H_STATUS_NOT_ALLOWED,
      status1h,
      PARAMS.signalAllowedStatuses1h.join(",")
    );
  } else if (signal1h.adjustedScore < PARAMS.signalMinimumAdjustedScore1h) {
    log.fail(
      "SIGNAL_1H",
      ENTRY,
      StrategyReasonCode.SIGNAL_1H_SCORE_BELOW_MINIMUM,
      String(signal1h.adjustedScore),
      String(PARAMS.signalMinimumAdjustedScore1h)
    );
  } else if (PARAMS.signalForbiddenRiskLevels.includes(signal1h.riskLevel as never)) {
    log.fail("SIGNAL_1H", ENTRY, StrategyReasonCode.SIGNAL_1H_RISK_LEVEL_TOO_HIGH, signal1h.riskLevel, "LOW,MEDIUM");
  } else {
    log.pass("SIGNAL_1H", ENTRY, StrategyReasonCode.SIGNAL_1H_CONFIRMED, String(signal1h.adjustedScore));
  }

  const higher: readonly [StrategyTimeframe, string, StrategyReasonCode, StrategyReasonCode][] = [
    ["4h", "HIGHER_TIMEFRAME_4H", StrategyReasonCode.HIGHER_TIMEFRAME_4H_CONFIRMED, StrategyReasonCode.HIGHER_TIMEFRAME_4H_CONFLICT],
    ["1d", "HIGHER_TIMEFRAME_1D", StrategyReasonCode.HIGHER_TIMEFRAME_1D_CONFIRMED, StrategyReasonCode.HIGHER_TIMEFRAME_1D_CONFLICT]
  ];

  for (const [timeframe, checkId, passCode, failCode] of higher) {
    const signal = validated.signals[timeframe];
    const status = effectiveStatus(signal);
    if (signal.direction !== PARAMS.higherTimeframeDirection) {
      log.fail(checkId, ENTRY, failCode, signal.direction, PARAMS.higherTimeframeDirection);
      continue;
    }
    if (PARAMS.higherTimeframeForbiddenStatuses.includes(status as never)) {
      log.fail(checkId, ENTRY, failCode, status, `NOT ${PARAMS.higherTimeframeForbiddenStatuses.join("/")}`);
      continue;
    }
    if (PARAMS.signalForbiddenRiskLevels.includes(signal.riskLevel as never)) {
      log.fail(checkId, ENTRY, failCode, signal.riskLevel, "LOW,MEDIUM");
      continue;
    }
    log.pass(checkId, ENTRY, passCode, status);
  }
}

function evaluateContext(log: StrategyCheckLog, validated: ValidatedSnapshotV1): void {
  const mtf = validated.multiTimeframe;
  const alignmentScore = parseDecimalString(mtf.alignmentScore);
  if (mtf.alignment !== PARAMS.multiTimeframeRequiredAlignment) {
    log.fail(
      "MTF_ALIGNMENT",
      ENTRY,
      StrategyReasonCode.MTF_NOT_BULLISH_ALIGNED,
      mtf.alignment,
      PARAMS.multiTimeframeRequiredAlignment
    );
  } else if (alignmentScore === null) {
    log.fail("MTF_ALIGNMENT", ENTRY, StrategyReasonCode.MTF_MISSING, "alignmentScore");
  } else if (alignmentScore.lt(MTF_MINIMUM_ALIGNMENT)) {
    log.fail(
      "MTF_ALIGNMENT",
      ENTRY,
      StrategyReasonCode.MTF_ALIGNMENT_SCORE_BELOW_MINIMUM,
      alignmentScore.toString(),
      MTF_MINIMUM_ALIGNMENT.toString()
    );
  } else {
    log.pass(
      "MTF_ALIGNMENT",
      ENTRY,
      StrategyReasonCode.MTF_BULLISH_ALIGNED,
      alignmentScore.toString(),
      MTF_MINIMUM_ALIGNMENT.toString()
    );
  }

  const regime = validated.marketRegime;
  if (regime.cryptoRegime !== PARAMS.regimeRequiredCryptoRegime) {
    log.fail(
      "REGIME",
      ENTRY,
      StrategyReasonCode.REGIME_NOT_RISK_ON,
      regime.cryptoRegime,
      PARAMS.regimeRequiredCryptoRegime
    );
  } else if (PARAMS.regimeForbiddenRiskModes.includes(regime.riskMode as never)) {
    log.fail(
      "REGIME",
      ENTRY,
      StrategyReasonCode.REGIME_RISK_MODE_BLOCKED,
      regime.riskMode,
      `NOT ${PARAMS.regimeForbiddenRiskModes.join("/")}`
    );
  } else if (regime.confidence < PARAMS.regimeMinimumConfidence) {
    log.fail(
      "REGIME",
      ENTRY,
      StrategyReasonCode.REGIME_CONFIDENCE_BELOW_MINIMUM,
      String(regime.confidence),
      String(PARAMS.regimeMinimumConfidence)
    );
  } else {
    log.pass("REGIME", ENTRY, StrategyReasonCode.REGIME_RISK_ON, String(regime.confidence));
  }

  // Empty or neutral context is never a bonus; an explicit critical bearish
  // context blocks (docs/trading/05, "Bestehende Signal- und Kontextbestätigung").
  const blocking = validated.contextEvents.filter(
    (event) =>
      event.directionalBias === "BEARISH" &&
      PARAMS.blockingContextSeverities.includes(event.severity as never)
  );
  if (blocking.length > 0) {
    log.fail(
      "CONTEXT_EVENTS",
      ENTRY,
      StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT,
      blocking.map((event) => event.id).sort().join(","),
      "0"
    );
  } else {
    log.pass("CONTEXT_EVENTS", ENTRY, StrategyReasonCode.CONTEXT_NO_BLOCKING_EVENT, "0", "0");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Public evaluation
// ───────────────────────────────────────────────────────────────────────────

export function evaluateCryptoMtfBreakoutV1(
  snapshot: StrategyInputSnapshotV1
): StrategyEvaluationResultV1 {
  const inputHash = buildInputHash(snapshot);
  const validation = validateStrategyInput(snapshot);
  const evaluatedAt = typeof snapshot?.asOf === "string" ? snapshot.asOf : "1970-01-01T00:00:00.000Z";

  if (!validation.ok) {
    return refuse(
      StrategyEvaluationOutcome.INVALID_INPUT,
      validation.checks,
      validation.failures,
      inputHash,
      evaluatedAt
    );
  }

  const validated = validation.validated;
  const log = createCheckLog();

  // ── Trend, breakout, momentum, volume, volatility ────────────────────────
  const trend = evaluateTrend(log, validated);
  const series1h = validated.series["1h"];
  const anchor = series1h.anchor;
  const closes1h = series1h.candles.map((candle) => candle.close);

  const priorHigh = priorPeriodHigh(series1h.candles, PARAMS.breakoutLookback);
  if (priorHigh === null) {
    log.fail("BREAKOUT_PRIOR_HIGH", ENTRY, StrategyReasonCode.BREAKOUT_REFERENCE_UNAVAILABLE);
  } else if (anchor.close.gt(priorHigh)) {
    log.pass(
      "BREAKOUT_PRIOR_HIGH",
      ENTRY,
      StrategyReasonCode.BREAKOUT_CONFIRMED,
      anchor.close.toString(),
      priorHigh.toString()
    );
  } else {
    log.fail(
      "BREAKOUT_PRIOR_HIGH",
      ENTRY,
      StrategyReasonCode.BREAKOUT_NOT_CONFIRMED,
      anchor.close.toString(),
      priorHigh.toString()
    );
  }

  const rsi = relativeStrengthIndex(closes1h, PARAMS.rsiPeriod);
  if (rsi === null) {
    log.fail("RSI_1H", ENTRY, StrategyReasonCode.RSI_UNAVAILABLE);
  } else if (rsi.gte(RSI_MINIMUM) && rsi.lte(RSI_MAXIMUM)) {
    log.pass("RSI_1H", ENTRY, StrategyReasonCode.RSI_IN_RANGE, rsi.toString(), `${PARAMS.rsiMinimum}..${PARAMS.rsiMaximum}`);
  } else {
    log.fail(
      "RSI_1H",
      ENTRY,
      StrategyReasonCode.RSI_OUT_OF_RANGE,
      rsi.toString(),
      `${PARAMS.rsiMinimum}..${PARAMS.rsiMaximum}`
    );
  }

  const averageVolume = priorAverageVolume(series1h.candles, PARAMS.volumeLookback);
  const relative = averageVolume === null ? null : relativeVolume(anchor.volume, averageVolume);
  if (relative === null) {
    log.fail("RELATIVE_VOLUME_1H", ENTRY, StrategyReasonCode.RELATIVE_VOLUME_UNAVAILABLE);
  } else if (relative.gte(RELATIVE_VOLUME_MINIMUM)) {
    log.pass(
      "RELATIVE_VOLUME_1H",
      ENTRY,
      StrategyReasonCode.RELATIVE_VOLUME_CONFIRMED,
      relative.toString(),
      PARAMS.relativeVolumeMinimum
    );
  } else {
    log.fail(
      "RELATIVE_VOLUME_1H",
      ENTRY,
      StrategyReasonCode.RELATIVE_VOLUME_BELOW_MINIMUM,
      relative.toString(),
      PARAMS.relativeVolumeMinimum
    );
  }

  const atr = averageTrueRange(series1h.candles, PARAMS.atrPeriod);
  const atrRatio = atrToCloseRatio(atr, anchor.close);
  if (atr === null || atrRatio === null || !atr.isPositive()) {
    log.fail("ATR_1H", ENTRY, StrategyReasonCode.ATR_UNAVAILABLE);
  } else if (atrRatio.gte(ATR_RATIO_MINIMUM) && atrRatio.lte(ATR_RATIO_MAXIMUM)) {
    log.pass(
      "ATR_1H",
      ENTRY,
      StrategyReasonCode.ATR_RATIO_IN_RANGE,
      atrRatio.toString(),
      `${PARAMS.atrToCloseMinimum}..${PARAMS.atrToCloseMaximum}`
    );
  } else {
    log.fail(
      "ATR_1H",
      ENTRY,
      StrategyReasonCode.ATR_RATIO_OUT_OF_RANGE,
      atrRatio.toString(),
      `${PARAMS.atrToCloseMinimum}..${PARAMS.atrToCloseMaximum}`
    );
  }

  evaluateSignals(log, validated);
  evaluateContext(log, validated);

  // ── Candidate validity window (docs/trading/05, "Candidate-Gültigkeit") ──
  const earliestFillAtMs = anchor.closeTimeMs;
  const expiresAtMs = earliestFillAtMs + PARAMS.candidateTtlMs;
  if (expiresAtMs <= validated.asOfMs) {
    log.fail(
      "CANDIDATE_VALIDITY",
      ENTRY,
      StrategyReasonCode.CANDIDATE_ALREADY_EXPIRED,
      toIso(expiresAtMs),
      snapshot.asOf
    );
  } else {
    log.pass(
      "CANDIDATE_VALIDITY",
      ENTRY,
      StrategyReasonCode.CANDIDATE_WITHIN_VALIDITY_WINDOW,
      toIso(expiresAtMs),
      snapshot.asOf
    );
  }

  // ── Price plan (docs/trading/05, "Candidate-Preisplan") ──────────────────
  // Rounding is CEIL for the stop distance so a value that cannot be
  // represented exactly widens the stop; that makes the 3 % cap check stricter
  // rather than looser, which is the fail-closed direction.
  const referenceEntry = anchor.close;
  let stopDistance: DecimalValue | null = null;
  let stopPrice: DecimalValue | null = null;
  let takeProfitPrice: DecimalValue | null = null;
  let stopDistancePct: DecimalValue | null = null;
  let plannedRewardRisk: DecimalValue | null = null;
  let maximumEntryGap: DecimalValue | null = null;

  if (atr !== null && atr.isPositive()) {
    const atrDistance = STOP_ATR_MULTIPLE.mul(atr, RoundingMode.CEIL);
    const floorDistance = STOP_FLOOR_PCT.mul(referenceEntry, RoundingMode.CEIL);
    stopDistance = DecimalValue.max(atrDistance, floorDistance);
    stopDistancePct = stopDistance.div(referenceEntry, RoundingMode.CEIL);

    if (atrDistance.gte(floorDistance)) {
      log.pass(
        "STOP_DISTANCE_BASIS",
        PRICE_PLAN,
        StrategyReasonCode.STOP_DISTANCE_ATR_APPLIED,
        atrDistance.toString(),
        floorDistance.toString()
      );
    } else {
      log.pass(
        "STOP_DISTANCE_BASIS",
        PRICE_PLAN,
        StrategyReasonCode.STOP_DISTANCE_FLOOR_APPLIED,
        floorDistance.toString(),
        atrDistance.toString()
      );
    }

    if (stopDistancePct.gt(STOP_CAP_PCT)) {
      log.fail(
        "STOP_DISTANCE_CAP",
        PRICE_PLAN,
        StrategyReasonCode.STOP_DISTANCE_ABOVE_MAXIMUM,
        stopDistancePct.toString(),
        STOP_CAP_PCT.toString()
      );
    } else {
      log.pass(
        "STOP_DISTANCE_CAP",
        PRICE_PLAN,
        StrategyReasonCode.PRICE_PLAN_VALID,
        stopDistancePct.toString(),
        STOP_CAP_PCT.toString()
      );
    }

    stopPrice = referenceEntry.sub(stopDistance);
    if (!stopPrice.isPositive()) {
      log.fail(
        "STOP_PRICE",
        PRICE_PLAN,
        StrategyReasonCode.STOP_PRICE_NOT_POSITIVE,
        stopPrice.toString(),
        "0.000000000000"
      );
    } else {
      log.pass("STOP_PRICE", PRICE_PLAN, StrategyReasonCode.PRICE_PLAN_VALID, stopPrice.toString());

      takeProfitPrice = referenceEntry.add(TAKE_PROFIT_R_MULTIPLE.mul(stopDistance, RoundingMode.FLOOR));
      plannedRewardRisk = takeProfitPrice
        .sub(referenceEntry)
        .div(referenceEntry.sub(stopPrice), RoundingMode.FLOOR);

      if (plannedRewardRisk.lt(MINIMUM_REWARD_RISK)) {
        log.fail(
          "REWARD_RISK",
          PRICE_PLAN,
          StrategyReasonCode.REWARD_RISK_BELOW_MINIMUM,
          plannedRewardRisk.toString(),
          MINIMUM_REWARD_RISK.toString()
        );
      } else {
        log.pass(
          "REWARD_RISK",
          PRICE_PLAN,
          StrategyReasonCode.REWARD_RISK_CONFIRMED,
          plannedRewardRisk.toString(),
          MINIMUM_REWARD_RISK.toString()
        );
      }
    }

    maximumEntryGap = ENTRY_GAP_ATR_MULTIPLE.mul(atr, RoundingMode.FLOOR);
  }

  const checks: readonly StrategyCheckV1[] = Object.freeze([...validation.checks, ...log.checks]);

  if (
    log.hasFailure ||
    atr === null ||
    atrRatio === null ||
    priorHigh === null ||
    rsi === null ||
    relative === null ||
    averageVolume === null ||
    stopDistance === null ||
    stopDistancePct === null ||
    stopPrice === null ||
    takeProfitPrice === null ||
    plannedRewardRisk === null ||
    maximumEntryGap === null ||
    trend.one.sma20 === null ||
    trend.one.sma50 === null ||
    trend.one.sma200 === null ||
    trend.four.sma50 === null ||
    trend.four.sma200 === null ||
    trend.day.sma50 === null ||
    trend.day.sma200 === null
  ) {
    return refuse(StrategyEvaluationOutcome.NO_CANDIDATE, checks, log.failures, inputHash, evaluatedAt);
  }

  // ── Candidate draft ──────────────────────────────────────────────────────
  const breakoutDistance = anchor.close.sub(priorHigh);
  const indicators: StrategyIndicatorSnapshotV1 = {
    close1h: anchor.close.toString(),
    sma20_1h: trend.one.sma20.toString(),
    sma50_1h: trend.one.sma50.toString(),
    sma200_1h: trend.one.sma200.toString(),
    rsi14_1h: rsi.toString(),
    atr14_1h: atr.toString(),
    atrToClose1h: atrRatio.toString(),
    priorHigh20_1h: priorHigh.toString(),
    breakoutDistance: breakoutDistance.toString(),
    breakoutDistancePct: breakoutDistance.div(priorHigh, RoundingMode.FLOOR).toString(),
    averageVolume20_1h: averageVolume.toString(),
    relativeVolume1h: relative.toString(),
    close4h: trend.four.close.toString(),
    sma50_4h: trend.four.sma50.toString(),
    sma200_4h: trend.four.sma200.toString(),
    close1d: trend.day.close.toString(),
    sma50_1d: trend.day.sma50.toString(),
    sma200_1d: trend.day.sma200.toString()
  };

  const reasonCodes = sortedUnique(
    log.checks.filter((check) => check.passed).map((check) => check.reasonCode)
  );

  const draftWithoutOutputHash = {
    candidateKey: buildCandidateKey({
      strategyAssignmentId: validated.snapshot.assignment.id,
      strategyVersionId: validated.snapshot.strategy.strategyVersionId,
      assetId: validated.snapshot.asset.id,
      anchorCandleId: anchor.id
    }),
    strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
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
    expiresAt: toIso(expiresAtMs),
    referenceEntryPrice: referenceEntry.toString(),
    plannedEntryMinimum: stopPrice.toString(),
    plannedEntryMaximum: referenceEntry.add(maximumEntryGap).toString(),
    maximumEntryGapDistance: maximumEntryGap.toString(),
    stopPrice: stopPrice.toString(),
    stopDistance: stopDistance.toString(),
    stopDistancePct: stopDistancePct.toString(),
    takeProfitPrice: takeProfitPrice.toString(),
    minimumRewardRisk: MINIMUM_REWARD_RISK.toString(),
    plannedRewardRisk: plannedRewardRisk.toString(),
    maxHoldHours: PARAMS.maxHoldHours,
    indicators,
    evidence: buildEvidence(validated),
    reasonCodes,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash
  } as const;

  const core = {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash,
    reasonCodes,
    checks,
    candidate: draftWithoutOutputHash
  };
  const outputHash = buildOutputHash(core);

  const candidate: TradeCandidateDraftV1 = Object.freeze({
    ...draftWithoutOutputHash,
    outputHash
  });

  return {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: CRYPTO_MTF_BREAKOUT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash,
    outputHash,
    evaluatedAt,
    reasonCodes,
    checks,
    candidate
  };
}
