/**
 * `CRYPTO_MTF_BREAKDOWN_SHORT_V1` — the separate short strategy.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md ("Short-Variante"),
 * ADR 0011 (separate long and short strategies) and ADR 0012 (synthetic,
 * unleveraged shadow shorts).
 *
 * Crypto spot, BTCUSDT and ETHUSDT, decision on the newest closed 1h candle
 * with 4h and 1d confirmation, only in an explicitly bearish `RISK_OFF`
 * regime. No leverage, no margin, no futures, no borrow, no funding, no
 * liquidation, no LLM. Pure: same snapshot in, byte-identical result and hash
 * out (ADR 0003).
 *
 * This is a **separate implementation**, not the long engine with inverted
 * signs. The two share the pre-validation, the pinned indicator formulas and
 * the check-log shape, because those are genuinely direction-neutral. Every
 * comparison that expresses a market opinion is written out for the short side
 * so it can be read and reviewed on its own terms — a sign flip is exactly the
 * kind of change that looks right and is wrong.
 *
 * The engine proposes prices only. Quantity, equity and risk budget belong to
 * the risk engine.
 */

import {
  DecimalValue,
  RoundingMode,
  TradeDirection,
  buildCandidateKey,
  buildInputHash,
  buildOutputHash,
  checkPricePlanOrdering
} from "@signalpilot/trading-domain";

import type {
  StrategyCheckV1,
  StrategyEvaluationResultV1,
  StrategyIndicatorSnapshotV1,
  StrategyInputSnapshotV1,
  StrategyTimeframe,
  TradeCandidateDraftV1
} from "./contracts.js";
import {
  atrToCloseRatio,
  averageTrueRange,
  priorAverageVolume,
  priorPeriodLow,
  relativeStrengthIndex,
  relativeVolume,
  simpleMovingAverage
} from "./indicators-v1.js";
import {
  StrategyCheckStage,
  StrategyEvaluationOutcome,
  StrategyReasonCode
} from "./reason-codes.js";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH
} from "./specification-v1.js";
import {
  createCheckLog,
  parseDecimalString,
  validateStrategyInput,
  type ParsedSeriesV1,
  type StrategyCheckLog,
  type ValidatedSnapshotV1
} from "./validate-input.js";

const PARAMS = CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS;
const ENTRY = StrategyCheckStage.ENTRY;
const PRICE_PLAN = StrategyCheckStage.PRICE_PLAN;

const RSI_MINIMUM = DecimalValue.fromString(PARAMS.rsiMinimum);
const RSI_MAXIMUM = DecimalValue.fromString(PARAMS.rsiMaximum);
const RELATIVE_VOLUME_MINIMUM = DecimalValue.fromString(
  PARAMS.relativeVolumeMinimum
);
const ATR_RATIO_MINIMUM = DecimalValue.fromString(PARAMS.atrToCloseMinimum);
const ATR_RATIO_MAXIMUM = DecimalValue.fromString(PARAMS.atrToCloseMaximum);
const MTF_MINIMUM_ALIGNMENT = DecimalValue.fromString(
  PARAMS.multiTimeframeMinimumAlignmentScore
);
const STOP_ATR_MULTIPLE = DecimalValue.fromString(PARAMS.stopAtrMultiple);
const STOP_FLOOR_PCT = DecimalValue.fromString(PARAMS.stopDistanceFloorPct);
const STOP_CAP_PCT = DecimalValue.fromString(PARAMS.stopDistanceCapPct);
const TAKE_PROFIT_R_MULTIPLE = DecimalValue.fromString(
  PARAMS.takeProfitRMultiple
);
const MINIMUM_REWARD_RISK = DecimalValue.fromString(PARAMS.minimumRewardRisk);
const ENTRY_GAP_ATR_MULTIPLE = DecimalValue.fromString(
  PARAMS.entryGapAtrMultiple
);

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

function effectiveStatus(signal: { readonly status: string }): string {
  return signal.status;
}

const toIso = (ms: number): string => new Date(ms).toISOString();

function sortedUnique(
  codes: readonly StrategyReasonCode[]
): readonly StrategyReasonCode[] {
  return Object.freeze([...new Set(codes)].sort());
}

function refuse(
  outcome:
    | typeof StrategyEvaluationOutcome.NO_CANDIDATE
    | typeof StrategyEvaluationOutcome.INVALID_INPUT,
  checks: readonly StrategyCheckV1[],
  failures: readonly StrategyReasonCode[],
  inputHash: string,
  evaluatedAt: string
): StrategyEvaluationResultV1 {
  const reasonCodes = sortedUnique(failures);
  const core = {
    outcome,
    strategyKey: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
    inputHash,
    reasonCodes,
    checks,
    candidate: null
  };
  const base = {
    strategyKey: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
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
// Entry conditions — every comparison written for the short side
// ───────────────────────────────────────────────────────────────────────────

function evaluateBearishTrend(
  log: StrategyCheckLog,
  validated: ValidatedSnapshotV1
): {
  readonly one: TimeframeIndicators;
  readonly four: TimeframeIndicators;
  readonly day: TimeframeIndicators;
} {
  const one = timeframeIndicators(validated.series["1h"]);
  const four = timeframeIndicators(validated.series["4h"]);
  const day = timeframeIndicators(validated.series["1d"]);

  // Bearish stack on 1h: close < SMA20 < SMA50 < SMA200.
  if (one.sma20 === null || one.sma50 === null || one.sma200 === null) {
    log.fail(
      "TREND_1H",
      ENTRY,
      StrategyReasonCode.TREND_INDICATOR_UNAVAILABLE,
      "1h"
    );
  } else if (
    one.close.lt(one.sma20) &&
    one.sma20.lt(one.sma50) &&
    one.sma50.lt(one.sma200)
  ) {
    log.pass(
      "TREND_1H",
      ENTRY,
      StrategyReasonCode.TREND_FILTER_1H_PASSED,
      one.close.toString(),
      one.sma20.toString()
    );
  } else {
    log.fail(
      "TREND_1H",
      ENTRY,
      StrategyReasonCode.TREND_FILTER_1H_FAILED,
      one.close.toString(),
      one.sma20.toString()
    );
  }

  // Bearish confirmation on 4h and 1d: close < SMA50 < SMA200.
  for (const [label, indicators, passCode, failCode] of [
    [
      "TREND_4H",
      four,
      StrategyReasonCode.TREND_FILTER_4H_PASSED,
      StrategyReasonCode.TREND_FILTER_4H_FAILED
    ],
    [
      "TREND_1D",
      day,
      StrategyReasonCode.TREND_FILTER_1D_PASSED,
      StrategyReasonCode.TREND_FILTER_1D_FAILED
    ]
  ] as const) {
    if (indicators.sma50 === null || indicators.sma200 === null) {
      log.fail(
        label,
        ENTRY,
        StrategyReasonCode.TREND_INDICATOR_UNAVAILABLE,
        label
      );
      continue;
    }
    if (
      indicators.close.lt(indicators.sma50) &&
      indicators.sma50.lt(indicators.sma200)
    ) {
      log.pass(
        label,
        ENTRY,
        passCode,
        indicators.close.toString(),
        indicators.sma50.toString()
      );
    } else {
      log.fail(
        label,
        ENTRY,
        failCode,
        indicators.close.toString(),
        indicators.sma50.toString()
      );
    }
  }

  return { one, four, day };
}

function evaluateBearishSignals(
  log: StrategyCheckLog,
  validated: ValidatedSnapshotV1
): void {
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
  } else if (
    PARAMS.signalForbiddenRiskLevels.includes(signal1h.riskLevel as never)
  ) {
    log.fail(
      "SIGNAL_1H",
      ENTRY,
      StrategyReasonCode.SIGNAL_1H_RISK_LEVEL_TOO_HIGH,
      signal1h.riskLevel,
      "LOW,MEDIUM"
    );
  } else {
    log.pass(
      "SIGNAL_1H",
      ENTRY,
      StrategyReasonCode.SIGNAL_1H_CONFIRMED,
      String(signal1h.adjustedScore)
    );
  }

  const higher: readonly [
    StrategyTimeframe,
    string,
    StrategyReasonCode,
    StrategyReasonCode
  ][] = [
    [
      "4h",
      "HIGHER_TIMEFRAME_4H",
      StrategyReasonCode.HIGHER_TIMEFRAME_4H_CONFIRMED,
      StrategyReasonCode.HIGHER_TIMEFRAME_4H_CONFLICT
    ],
    [
      "1d",
      "HIGHER_TIMEFRAME_1D",
      StrategyReasonCode.HIGHER_TIMEFRAME_1D_CONFIRMED,
      StrategyReasonCode.HIGHER_TIMEFRAME_1D_CONFLICT
    ]
  ];

  for (const [timeframe, checkId, passCode, failCode] of higher) {
    const signal = validated.signals[timeframe];
    const status = effectiveStatus(signal);
    if (signal.direction !== PARAMS.higherTimeframeDirection) {
      log.fail(
        checkId,
        ENTRY,
        failCode,
        signal.direction,
        PARAMS.higherTimeframeDirection
      );
      continue;
    }
    if (PARAMS.higherTimeframeForbiddenStatuses.includes(status as never)) {
      log.fail(
        checkId,
        ENTRY,
        failCode,
        status,
        `NOT ${PARAMS.higherTimeframeForbiddenStatuses.join("/")}`
      );
      continue;
    }
    if (PARAMS.signalForbiddenRiskLevels.includes(signal.riskLevel as never)) {
      log.fail(checkId, ENTRY, failCode, signal.riskLevel, "LOW,MEDIUM");
      continue;
    }
    log.pass(checkId, ENTRY, passCode, status);
  }
}

function evaluateBearishContext(
  log: StrategyCheckLog,
  validated: ValidatedSnapshotV1
): void {
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
    log.fail(
      "MTF_ALIGNMENT",
      ENTRY,
      StrategyReasonCode.MTF_MISSING,
      "alignmentScore"
    );
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

  // The short strategy trades only in an explicitly bearish regime. A neutral
  // or missing regime is not "close enough" — it is a refusal.
  const regime = validated.marketRegime;
  if (regime.cryptoRegime !== PARAMS.regimeRequiredCryptoRegime) {
    log.fail(
      "REGIME",
      ENTRY,
      StrategyReasonCode.REGIME_NOT_RISK_OFF,
      regime.cryptoRegime,
      PARAMS.regimeRequiredCryptoRegime
    );
  } else if (
    PARAMS.regimeForbiddenRiskModes.includes(regime.riskMode as never)
  ) {
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
    log.pass(
      "REGIME",
      ENTRY,
      StrategyReasonCode.REGIME_RISK_OFF,
      String(regime.confidence)
    );
  }

  const blocking = validated.contextEvents.filter((event) =>
    PARAMS.blockingContextSeverities.includes(event.severity as never)
  );
  if (blocking.length > 0) {
    log.fail(
      "CONTEXT_EVENTS",
      ENTRY,
      StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT,
      blocking
        .map((event) => event.id)
        .sort()
        .join(","),
      "0"
    );
  } else {
    log.pass(
      "CONTEXT_EVENTS",
      ENTRY,
      StrategyReasonCode.CONTEXT_NO_BLOCKING_EVENT,
      "0",
      "0"
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Evaluation
// ───────────────────────────────────────────────────────────────────────────

export function evaluateCryptoMtfBreakdownShortV1(
  snapshot: StrategyInputSnapshotV1
): StrategyEvaluationResultV1 {
  const inputHash = buildInputHash(snapshot);
  const evaluatedAt =
    typeof snapshot?.asOf === "string"
      ? snapshot.asOf
      : "1970-01-01T00:00:00.000Z";

  const validation = validateStrategyInput(snapshot, {
    key: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH
  });
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

  const trend = evaluateBearishTrend(log, validated);
  const series1h = validated.series["1h"];
  const anchor = series1h.anchor;
  const closes1h = series1h.candles.map((candle) => candle.close);

  // ── Breakdown: close(C0) < lowest low of the 20 candles BEFORE C0 ────────
  // `priorPeriodLow` excludes the anchor from its own reference window; a
  // candle compared against a window containing itself would confirm a
  // breakdown whenever it merely printed the window low.
  const priorLow = priorPeriodLow(series1h.candles, PARAMS.breakdownLookback);
  if (priorLow === null) {
    log.fail(
      "BREAKDOWN_PRIOR_LOW",
      ENTRY,
      StrategyReasonCode.BREAKDOWN_REFERENCE_UNAVAILABLE
    );
  } else if (anchor.close.lt(priorLow)) {
    log.pass(
      "BREAKDOWN_PRIOR_LOW",
      ENTRY,
      StrategyReasonCode.BREAKDOWN_CONFIRMED,
      anchor.close.toString(),
      priorLow.toString()
    );
  } else {
    log.fail(
      "BREAKDOWN_PRIOR_LOW",
      ENTRY,
      StrategyReasonCode.BREAKDOWN_NOT_CONFIRMED,
      anchor.close.toString(),
      priorLow.toString()
    );
  }

  // ── Bearish RSI band ─────────────────────────────────────────────────────
  const rsi = relativeStrengthIndex(closes1h, PARAMS.rsiPeriod);
  if (rsi === null) {
    log.fail("RSI_1H", ENTRY, StrategyReasonCode.RSI_UNAVAILABLE);
  } else if (rsi.gte(RSI_MINIMUM) && rsi.lte(RSI_MAXIMUM)) {
    log.pass(
      "RSI_1H",
      ENTRY,
      StrategyReasonCode.RSI_IN_RANGE,
      rsi.toString(),
      `${PARAMS.rsiMinimum}..${PARAMS.rsiMaximum}`
    );
  } else {
    log.fail(
      "RSI_1H",
      ENTRY,
      StrategyReasonCode.RSI_OUT_OF_RANGE,
      rsi.toString(),
      `${PARAMS.rsiMinimum}..${PARAMS.rsiMaximum}`
    );
  }

  // ── Volume confirmation ──────────────────────────────────────────────────
  const averageVolume = priorAverageVolume(
    series1h.candles,
    PARAMS.volumeLookback
  );
  const relative = relativeVolume(anchor.volume, averageVolume);
  if (relative === null) {
    log.fail(
      "RELATIVE_VOLUME_1H",
      ENTRY,
      StrategyReasonCode.RELATIVE_VOLUME_UNAVAILABLE
    );
  } else if (relative.gte(RELATIVE_VOLUME_MINIMUM)) {
    log.pass(
      "RELATIVE_VOLUME_1H",
      ENTRY,
      StrategyReasonCode.RELATIVE_VOLUME_CONFIRMED,
      relative.toString(),
      RELATIVE_VOLUME_MINIMUM.toString()
    );
  } else {
    log.fail(
      "RELATIVE_VOLUME_1H",
      ENTRY,
      StrategyReasonCode.RELATIVE_VOLUME_BELOW_MINIMUM,
      relative.toString(),
      RELATIVE_VOLUME_MINIMUM.toString()
    );
  }

  // ── Volatility corridor ──────────────────────────────────────────────────
  const atr = averageTrueRange(series1h.candles, PARAMS.atrPeriod);
  const atrRatio = atrToCloseRatio(atr, anchor.close);
  if (atr === null || atrRatio === null) {
    log.fail("ATR_1H", ENTRY, StrategyReasonCode.ATR_UNAVAILABLE);
  } else if (
    atrRatio.gte(ATR_RATIO_MINIMUM) &&
    atrRatio.lte(ATR_RATIO_MAXIMUM)
  ) {
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

  evaluateBearishSignals(log, validated);
  evaluateBearishContext(log, validated);

  // ── Candidate validity ───────────────────────────────────────────────────
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

  // ── Price plan — mirrored: stop ABOVE, take profit BELOW ─────────────────
  // Stop distance rounds CEIL exactly as on the long side, so an
  // unrepresentable value widens the stop and makes the 3 % cap check
  // stricter, never looser.
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

    // Short: the stop sits ABOVE the entry.
    stopPrice = referenceEntry.add(stopDistance);
    // Short: the target sits BELOW the entry, 2.5R away.
    takeProfitPrice = referenceEntry.sub(
      TAKE_PROFIT_R_MULTIPLE.mul(stopDistance, RoundingMode.FLOOR)
    );

    const shortStop = stopPrice;
    if (!takeProfitPrice.isPositive()) {
      // A 2.5R target below a low-priced asset can cross zero; that plan is
      // refused rather than clamped.
      log.fail(
        "TAKE_PROFIT_PRICE",
        PRICE_PLAN,
        StrategyReasonCode.STOP_PRICE_NOT_POSITIVE,
        takeProfitPrice.toString(),
        "0.000000000000"
      );
      takeProfitPrice = null;
    } else {
      log.pass(
        "TAKE_PROFIT_PRICE",
        PRICE_PLAN,
        StrategyReasonCode.PRICE_PLAN_VALID,
        takeProfitPrice.toString()
      );

      const shortTakeProfit = takeProfitPrice;
      plannedRewardRisk = referenceEntry
        .sub(shortTakeProfit)
        .div(shortStop.sub(referenceEntry), RoundingMode.FLOOR);

      const rewardRisk = plannedRewardRisk;
      if (rewardRisk.lt(MINIMUM_REWARD_RISK)) {
        log.fail(
          "REWARD_RISK",
          PRICE_PLAN,
          StrategyReasonCode.REWARD_RISK_BELOW_MINIMUM,
          rewardRisk.toString(),
          MINIMUM_REWARD_RISK.toString()
        );
      } else {
        log.pass(
          "REWARD_RISK",
          PRICE_PLAN,
          StrategyReasonCode.REWARD_RISK_CONFIRMED,
          rewardRisk.toString(),
          MINIMUM_REWARD_RISK.toString()
        );
      }
    }

    // Shared, direction-aware ordering guard: stop > entry > takeProfit.
    // Belt and braces on top of the construction above — the ordering rule is
    // defined once in the domain package so it cannot drift per call site.
    if (takeProfitPrice !== null) {
      const ordering = checkPricePlanOrdering({
        direction: TradeDirection.SHORT,
        entryPrice: referenceEntry.toString(),
        stopPrice: shortStop.toString(),
        takeProfitPrice: takeProfitPrice.toString()
      });
      if (ordering.ok) {
        log.pass(
          "PRICE_PLAN_ORDERING",
          PRICE_PLAN,
          StrategyReasonCode.PRICE_PLAN_VALID,
          "stop>entry>tp"
        );
      } else {
        log.fail(
          "PRICE_PLAN_ORDERING",
          PRICE_PLAN,
          StrategyReasonCode.PRICE_PLAN_ORDER_INVALID,
          ordering.reasonCode
        );
      }
    }

    maximumEntryGap = ENTRY_GAP_ATR_MULTIPLE.mul(atr, RoundingMode.FLOOR);
  }

  const checks: readonly StrategyCheckV1[] = Object.freeze([
    ...validation.checks,
    ...log.checks
  ]);

  if (
    log.hasFailure ||
    atr === null ||
    atrRatio === null ||
    priorLow === null ||
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
    return refuse(
      StrategyEvaluationOutcome.NO_CANDIDATE,
      checks,
      log.failures,
      inputHash,
      evaluatedAt
    );
  }

  // ── Candidate draft ──────────────────────────────────────────────────────
  // Distance is reported as a positive magnitude of the confirming move:
  // `priorLow − close` for a breakdown.
  const breakdownDistance = priorLow.sub(anchor.close);
  const indicators: StrategyIndicatorSnapshotV1 = {
    close1h: anchor.close.toString(),
    sma20_1h: trend.one.sma20.toString(),
    sma50_1h: trend.one.sma50.toString(),
    sma200_1h: trend.one.sma200.toString(),
    rsi14_1h: rsi.toString(),
    atr14_1h: atr.toString(),
    atrToClose1h: atrRatio.toString(),
    priorLow20_1h: priorLow.toString(),
    breakoutDistance: breakdownDistance.toString(),
    breakoutDistancePct: breakdownDistance
      .div(priorLow, RoundingMode.FLOOR)
      .toString(),
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
    strategyKey: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    strategyVersionId: validated.snapshot.strategy.strategyVersionId,
    strategyAssignmentId: validated.snapshot.assignment.id,
    portfolioId: validated.snapshot.assignment.portfolioId,
    assetId: validated.snapshot.asset.id,
    symbol: validated.snapshot.asset.symbol,
    anchorCandleId: anchor.id,
    anchorSignalId: validated.signals["1h"].id,
    direction: TradeDirection.SHORT,
    entryType: "MARKET",
    status: "CREATED",
    dataAsOf: snapshot.asOf,
    decisionTime: snapshot.asOf,
    validFrom: anchor.closeTime,
    // Entry no earlier than the next permitted 1h period — identical rule to
    // the long side.
    earliestFillAt: anchor.closeTime,
    expiresAt: toIso(expiresAtMs),
    referenceEntryPrice: referenceEntry.toString(),
    // Mirrored acceptable entry band: a short may be entered slightly below
    // the reference (better) down to the gap limit, and never at or above the
    // stop.
    plannedEntryMinimum: referenceEntry.sub(maximumEntryGap).toString(),
    plannedEntryMaximum: stopPrice.toString(),
    maximumEntryGapDistance: maximumEntryGap.toString(),
    stopPrice: stopPrice.toString(),
    stopDistance: stopDistance.toString(),
    stopDistancePct: stopDistancePct.toString(),
    takeProfitPrice: takeProfitPrice.toString(),
    minimumRewardRisk: MINIMUM_REWARD_RISK.toString(),
    plannedRewardRisk: plannedRewardRisk.toString(),
    maxHoldHours: PARAMS.maxHoldHours,
    indicators,
    evidence: [],
    reasonCodes,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
    inputHash
  } as const;

  const core = {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
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
    strategyKey: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
    inputHash,
    outputHash,
    evaluatedAt,
    reasonCodes,
    checks,
    candidate
  };
}
