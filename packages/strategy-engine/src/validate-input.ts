/**
 * Pre-validation of a `StrategyInputSnapshotV1`.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md, "Vorvalidierung"
 * items 1–7. Every listed condition must hold before a single entry rule is
 * evaluated. There are no substitute values and no "neutral" default: a missing,
 * stale or contradictory source produces `INVALID_INPUT` with a stable code
 * (docs/trading/05, "Fehlende oder widersprüchliche Daten").
 *
 * This module is pure. It parses the snapshot once into decimals and epoch
 * milliseconds so the strategy never reparses a string, and it never mutates
 * its input.
 */

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  STRATEGY_INPUT_SNAPSHOT_VERSION,
  STRATEGY_TIMEFRAMES,
  TIMEFRAME_INTERVAL_MS,
  type IsoDateTimeString,
  type SnapshotCandleV1,
  type SnapshotContextEventV1,
  type SnapshotExecutionProfileV1,
  type SnapshotMarketRegimeV1,
  type SnapshotMultiTimeframeV1,
  type SnapshotSignalV1,
  type StrategyCheckV1,
  type StrategyInputSnapshotV1,
  type StrategyTimeframe
} from "./contracts.js";
import type { PinnedCandle } from "./indicators-v1.js";
import { StrategyCheckStage, StrategyReasonCode } from "./reason-codes.js";
import {
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
} from "./specification-v1.js";

const PARAMS = CRYPTO_MTF_BREAKOUT_V1_PARAMETERS;

/** Strict ISO-8601 UTC. Local offsets and missing `Z` are rejected outright. */
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

// ───────────────────────────────────────────────────────────────────────────
// Parsed view
// ───────────────────────────────────────────────────────────────────────────

export interface ParsedCandleV1 extends PinnedCandle {
  readonly id: string;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly openTime: IsoDateTimeString;
  readonly closeTime: IsoDateTimeString;
  readonly source: string;
}

export interface ParsedSeriesV1 {
  readonly timeframe: StrategyTimeframe;
  /** Ascending, closed, gap-free over the pinned window. */
  readonly candles: readonly ParsedCandleV1[];
  /** Newest closed candle of the timeframe. */
  readonly anchor: ParsedCandleV1;
}

/** Snapshot after successful pre-validation — every mandatory source present. */
export interface ValidatedSnapshotV1 {
  readonly snapshot: StrategyInputSnapshotV1;
  readonly asOfMs: number;
  readonly series: Readonly<Record<StrategyTimeframe, ParsedSeriesV1>>;
  readonly signals: Readonly<Record<StrategyTimeframe, SnapshotSignalV1>>;
  readonly multiTimeframe: SnapshotMultiTimeframeV1;
  readonly marketRegime: SnapshotMarketRegimeV1;
  readonly executionProfile: SnapshotExecutionProfileV1;
  readonly contextEvents: readonly SnapshotContextEventV1[];
}

export type ValidateInputResultV1 =
  | {
      readonly ok: true;
      readonly validated: ValidatedSnapshotV1;
      readonly checks: readonly StrategyCheckV1[];
    }
  | {
      readonly ok: false;
      readonly checks: readonly StrategyCheckV1[];
      readonly failures: readonly StrategyReasonCode[];
    };

// ───────────────────────────────────────────────────────────────────────────
// Check collection
// ───────────────────────────────────────────────────────────────────────────

class CheckLog {
  private readonly entries: StrategyCheckV1[] = [];
  private readonly failed: StrategyReasonCode[] = [];

  pass(
    checkId: string,
    stage: StrategyCheckStage,
    reasonCode: StrategyReasonCode,
    actual: string | null = null,
    limit: string | null = null
  ): true {
    this.entries.push({
      checkId,
      stage,
      passed: true,
      reasonCode,
      actual,
      limit
    });
    return true;
  }

  fail(
    checkId: string,
    stage: StrategyCheckStage,
    reasonCode: StrategyReasonCode,
    actual: string | null = null,
    limit: string | null = null
  ): false {
    this.entries.push({
      checkId,
      stage,
      passed: false,
      reasonCode,
      actual,
      limit
    });
    this.failed.push(reasonCode);
    return false;
  }

  get checks(): readonly StrategyCheckV1[] {
    return this.entries;
  }

  get failures(): readonly StrategyReasonCode[] {
    return this.failed;
  }

  get hasFailure(): boolean {
    return this.failed.length > 0;
  }
}

export type StrategyCheckLog = CheckLog;

/** Factory so the strategy can keep appending entry-stage checks. */
export const createCheckLog = (): CheckLog => new CheckLog();

// ───────────────────────────────────────────────────────────────────────────
// Primitive parsing
// ───────────────────────────────────────────────────────────────────────────

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDecimal(value: unknown): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ───────────────────────────────────────────────────────────────────────────
// Series validation
// ───────────────────────────────────────────────────────────────────────────

type SeriesFailure = {
  readonly reasonCode: StrategyReasonCode;
  readonly detail: string;
};

function validateSeries(
  timeframe: StrategyTimeframe,
  candles: readonly SnapshotCandleV1[],
  asOfMs: number
):
  | { readonly ok: true; readonly series: ParsedSeriesV1 }
  | { readonly ok: false; readonly failure: SeriesFailure } {
  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      ok: false,
      failure: {
        reasonCode: StrategyReasonCode.CANDLES_MISSING,
        detail: timeframe
      }
    };
  }

  if (candles.length < PARAMS.minimumCandlesPerTimeframe) {
    return {
      ok: false,
      failure: {
        reasonCode: StrategyReasonCode.CANDLES_INSUFFICIENT_HISTORY,
        detail: String(candles.length)
      }
    };
  }

  const interval = TIMEFRAME_INTERVAL_MS[timeframe];
  const parsed: ParsedCandleV1[] = [];
  const seenOpenTimes = new Set<number>();

  for (const candle of candles) {
    if (
      typeof candle?.id !== "string" ||
      candle.id === "" ||
      typeof candle.source !== "string"
    ) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.SNAPSHOT_MALFORMED,
          detail: timeframe
        }
      };
    }

    const openTimeMs = parseInstant(candle.openTime);
    const closeTimeMs = parseInstant(candle.closeTime);
    if (openTimeMs === null || closeTimeMs === null) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.SNAPSHOT_TIMESTAMP_MALFORMED,
          detail: candle.id
        }
      };
    }

    const open = parseDecimal(candle.open);
    const high = parseDecimal(candle.high);
    const low = parseDecimal(candle.low);
    const close = parseDecimal(candle.close);
    const volume = parseDecimal(candle.volume);
    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.SNAPSHOT_DECIMAL_MALFORMED,
          detail: candle.id
        }
      };
    }

    if (
      PARAMS.forbiddenCandleSources.includes(
        candle.source.trim().toUpperCase() as never
      )
    ) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_SOURCE_UNKNOWN,
          detail: candle.id
        }
      };
    }

    // A candle counts as closed only when its close time is at or before asOf,
    // and its close time must sit inside its own interval.
    if (closeTimeMs > asOfMs) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_NOT_CLOSED,
          detail: candle.id
        }
      };
    }
    if (openTimeMs > asOfMs) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_TIMESTAMP_AFTER_AS_OF,
          detail: candle.id
        }
      };
    }
    if (closeTimeMs <= openTimeMs || closeTimeMs - openTimeMs > interval) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_INTERVAL_MISMATCH,
          detail: candle.id
        }
      };
    }

    // OHLC invariants: low <= open/close <= high (docs/trading/05, item 3).
    if (
      low.gt(high) ||
      open.lt(low) ||
      open.gt(high) ||
      close.lt(low) ||
      close.gt(high) ||
      !close.isPositive() ||
      !open.isPositive() ||
      !high.isPositive() ||
      !low.isPositive()
    ) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_OHLC_INVARIANT_VIOLATED,
          detail: candle.id
        }
      };
    }
    if (volume.isNegative()) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_VOLUME_NEGATIVE,
          detail: candle.id
        }
      };
    }

    if (seenOpenTimes.has(openTimeMs)) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_OPEN_TIME_DUPLICATE,
          detail: candle.openTime
        }
      };
    }
    seenOpenTimes.add(openTimeMs);

    const previous = parsed.at(-1);
    if (previous !== undefined && openTimeMs <= previous.openTimeMs) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_SERIES_NOT_ASCENDING,
          detail: candle.openTime
        }
      };
    }

    parsed.push({
      id: candle.id,
      openTimeMs,
      closeTimeMs,
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      source: candle.source,
      open,
      high,
      low,
      close,
      volume
    });
  }

  // No gap inside the window the indicators and the breakout window need.
  const windowStart = Math.max(0, parsed.length - PARAMS.gapFreeWindow);
  for (let index = windowStart + 1; index < parsed.length; index += 1) {
    if (parsed[index].openTimeMs - parsed[index - 1].openTimeMs !== interval) {
      return {
        ok: false,
        failure: {
          reasonCode: StrategyReasonCode.CANDLE_SERIES_GAP,
          detail: parsed[index].openTime
        }
      };
    }
  }

  return {
    ok: true,
    series: { timeframe, candles: parsed, anchor: parsed[parsed.length - 1] }
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run every pre-validation rule. All groups that can be evaluated safely are
 * evaluated even after an earlier failure, so the persisted audit shows the
 * complete picture rather than only the first problem.
 */
/**
 * Identity a snapshot must declare. Defaults to the legacy long identity so
 * every existing caller keeps its exact behaviour; the long and short
 * registry entries pass their own (ADR 0011).
 */
export interface ExpectedStrategyIdentityV1 {
  readonly key: string;
  readonly engineVersion: string;
  readonly specificationHash: string;
}

export const LEGACY_LONG_IDENTITY: ExpectedStrategyIdentityV1 = Object.freeze({
  key: CRYPTO_MTF_BREAKOUT_V1_KEY,
  engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
});

export function validateStrategyInput(
  snapshot: StrategyInputSnapshotV1,
  expected: ExpectedStrategyIdentityV1 = LEGACY_LONG_IDENTITY
): ValidateInputResultV1 {
  const log = createCheckLog();
  const stage = StrategyCheckStage.PRE_VALIDATION;

  // ── 0. Snapshot shape ────────────────────────────────────────────────────
  if (snapshot === null || typeof snapshot !== "object") {
    log.fail("SNAPSHOT_SHAPE", stage, StrategyReasonCode.SNAPSHOT_MALFORMED);
    return { ok: false, checks: log.checks, failures: log.failures };
  }
  if (snapshot.snapshotVersion !== STRATEGY_INPUT_SNAPSHOT_VERSION) {
    log.fail(
      "SNAPSHOT_VERSION",
      stage,
      StrategyReasonCode.SNAPSHOT_VERSION_UNSUPPORTED,
      String(snapshot.snapshotVersion),
      STRATEGY_INPUT_SNAPSHOT_VERSION
    );
    return { ok: false, checks: log.checks, failures: log.failures };
  }
  log.pass(
    "SNAPSHOT_VERSION",
    stage,
    StrategyReasonCode.SNAPSHOT_VERSION_SUPPORTED
  );

  const asOfMs = parseInstant(snapshot.asOf);
  if (asOfMs === null) {
    log.fail(
      "SNAPSHOT_AS_OF",
      stage,
      StrategyReasonCode.SNAPSHOT_TIMESTAMP_MALFORMED,
      String(snapshot.asOf)
    );
    return { ok: false, checks: log.checks, failures: log.failures };
  }

  // ── 1. Strategy version (docs/trading/05, item 1) ────────────────────────
  const strategy = snapshot.strategy;
  if (strategy?.strategyKey !== expected.key) {
    log.fail(
      "STRATEGY_KEY",
      stage,
      StrategyReasonCode.STRATEGY_KEY_MISMATCH,
      String(strategy?.strategyKey),
      expected.key
    );
  } else if (strategy.status !== "ACTIVE") {
    log.fail(
      "STRATEGY_STATUS",
      stage,
      StrategyReasonCode.STRATEGY_VERSION_NOT_ACTIVE,
      strategy.status,
      "ACTIVE"
    );
  } else if (strategy.engineVersion !== expected.engineVersion) {
    log.fail(
      "STRATEGY_ENGINE_VERSION",
      stage,
      StrategyReasonCode.STRATEGY_ENGINE_VERSION_MISMATCH,
      strategy.engineVersion,
      expected.engineVersion
    );
  } else if (strategy.specificationHash !== expected.specificationHash) {
    log.fail(
      "STRATEGY_SPECIFICATION_HASH",
      stage,
      StrategyReasonCode.STRATEGY_SPECIFICATION_HASH_MISMATCH,
      strategy.specificationHash,
      expected.specificationHash
    );
  } else if (
    typeof strategy.codeVersion !== "string" ||
    strategy.codeVersion.trim() === ""
  ) {
    log.fail(
      "STRATEGY_CODE_VERSION",
      stage,
      StrategyReasonCode.STRATEGY_CODE_VERSION_MISSING
    );
  } else {
    log.pass(
      "STRATEGY_VERSION",
      stage,
      StrategyReasonCode.STRATEGY_VERSION_VALID
    );
  }

  // ── 1b. Assignment (docs/trading/05, item 1) ─────────────────────────────
  const assignment = snapshot.assignment;
  if (
    assignment === null ||
    assignment === undefined ||
    typeof assignment.id !== "string"
  ) {
    log.fail(
      "ASSIGNMENT_PRESENT",
      stage,
      StrategyReasonCode.ASSIGNMENT_MISSING
    );
  } else if (assignment.enabled !== true) {
    log.fail(
      "ASSIGNMENT_ENABLED",
      stage,
      StrategyReasonCode.ASSIGNMENT_DISABLED,
      "false",
      "true"
    );
  } else if (assignment.timeframe !== PARAMS.decisionTimeframe) {
    log.fail(
      "ASSIGNMENT_TIMEFRAME",
      stage,
      StrategyReasonCode.ASSIGNMENT_TIMEFRAME_NOT_ALLOWED,
      assignment.timeframe,
      PARAMS.decisionTimeframe
    );
  } else if (
    !isAssignmentWithinWindow(assignment.validFrom, assignment.validTo, asOfMs)
  ) {
    log.fail(
      "ASSIGNMENT_WINDOW",
      stage,
      StrategyReasonCode.ASSIGNMENT_OUTSIDE_VALIDITY_WINDOW
    );
  } else {
    log.pass("ASSIGNMENT", stage, StrategyReasonCode.ASSIGNMENT_ACTIVE);
  }

  // ── 2. Asset scope (docs/trading/05, item 2) ─────────────────────────────
  const asset = snapshot.asset;
  if (
    asset === null ||
    asset === undefined ||
    typeof asset.symbol !== "string"
  ) {
    log.fail("ASSET_PRESENT", stage, StrategyReasonCode.SNAPSHOT_MALFORMED);
  } else if (!PARAMS.allowedSymbols.includes(asset.symbol as never)) {
    log.fail(
      "ASSET_SYMBOL",
      stage,
      StrategyReasonCode.ASSET_NOT_ALLOWED,
      asset.symbol,
      PARAMS.allowedSymbols.join(",")
    );
  } else if (asset.assetType !== "CRYPTO") {
    log.fail(
      "ASSET_TYPE",
      stage,
      StrategyReasonCode.ASSET_NOT_CRYPTO,
      asset.assetType,
      "CRYPTO"
    );
  } else if (asset.isActive !== true) {
    log.fail(
      "ASSET_ACTIVE",
      stage,
      StrategyReasonCode.ASSET_NOT_ACTIVE,
      "false",
      "true"
    );
  } else if (asset.isTradable !== true) {
    log.fail(
      "ASSET_TRADABLE",
      stage,
      StrategyReasonCode.ASSET_NOT_TRADABLE,
      "false",
      "true"
    );
  } else if (asset.instrumentStatus !== "ACTIVE") {
    log.fail(
      "ASSET_INSTRUMENT_STATUS",
      stage,
      StrategyReasonCode.ASSET_INSTRUMENT_STATUS_NOT_ACTIVE,
      asset.instrumentStatus,
      "ACTIVE"
    );
  } else if (asset.quoteCurrency !== PARAMS.quoteCurrency) {
    log.fail(
      "ASSET_QUOTE_CURRENCY",
      stage,
      StrategyReasonCode.ASSET_QUOTE_CURRENCY_NOT_USDT,
      String(asset.quoteCurrency),
      PARAMS.quoteCurrency
    );
  } else if (asset.isLeveraged === true) {
    log.fail(
      "ASSET_LEVERAGED",
      stage,
      StrategyReasonCode.ASSET_LEVERAGED_FORBIDDEN,
      "true",
      "false"
    );
  } else if (asset.isInverse === true) {
    log.fail(
      "ASSET_INVERSE",
      stage,
      StrategyReasonCode.ASSET_INVERSE_FORBIDDEN,
      "true",
      "false"
    );
  } else if (asset.isStablecoin === true) {
    log.fail(
      "ASSET_STABLECOIN",
      stage,
      StrategyReasonCode.ASSET_STABLECOIN_FORBIDDEN,
      "true",
      "false"
    );
  } else {
    log.pass("ASSET_SCOPE", stage, StrategyReasonCode.ASSET_SCOPE_VALID);
  }

  // ── 2b. Execution profile must be active (docs/trading/05, item 2) ───────
  const executionProfile = snapshot.executionProfile ?? null;
  if (executionProfile === null) {
    log.fail(
      "EXECUTION_PROFILE",
      stage,
      StrategyReasonCode.EXECUTION_PROFILE_MISSING
    );
  } else if (executionProfile.status !== "ACTIVE") {
    log.fail(
      "EXECUTION_PROFILE",
      stage,
      StrategyReasonCode.EXECUTION_PROFILE_NOT_ACTIVE,
      executionProfile.status,
      "ACTIVE"
    );
  } else {
    log.pass(
      "EXECUTION_PROFILE",
      stage,
      StrategyReasonCode.EXECUTION_PROFILE_ACTIVE
    );
  }

  // ── 3./4. Candle integrity and history (docs/trading/05, items 3–4) ──────
  const parsedSeries: Partial<Record<StrategyTimeframe, ParsedSeriesV1>> = {};
  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const series = snapshot.series?.[timeframe];
    const checkId = `CANDLE_SERIES_${timeframe.toUpperCase()}`;
    if (
      series === null ||
      series === undefined ||
      series.timeframe !== timeframe
    ) {
      log.fail(checkId, stage, StrategyReasonCode.CANDLES_MISSING, timeframe);
      continue;
    }
    const result = validateSeries(timeframe, series.candles, asOfMs);
    if (!result.ok) {
      log.fail(
        checkId,
        stage,
        result.failure.reasonCode,
        result.failure.detail,
        String(PARAMS.minimumCandlesPerTimeframe)
      );
      continue;
    }
    parsedSeries[timeframe] = result.series;
    log.pass(
      checkId,
      stage,
      StrategyReasonCode.CANDLE_SERIES_VALID,
      String(result.series.candles.length),
      String(PARAMS.minimumCandlesPerTimeframe)
    );
  }

  // ── 5a. Candle freshness (docs/trading/05, item 5) ───────────────────────
  const staleCandleCodes: Readonly<
    Record<StrategyTimeframe, StrategyReasonCode>
  > = {
    "1h": StrategyReasonCode.DATA_STALE_CANDLES_1H,
    "4h": StrategyReasonCode.DATA_STALE_CANDLES_4H,
    "1d": StrategyReasonCode.DATA_STALE_CANDLES_1D
  };
  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const series = parsedSeries[timeframe];
    if (series === undefined) continue;
    const age = asOfMs - series.anchor.closeTimeMs;
    const maximum = PARAMS.maxCandleAgeMs[timeframe];
    const checkId = `CANDLE_FRESHNESS_${timeframe.toUpperCase()}`;
    if (age > maximum) {
      log.fail(
        checkId,
        stage,
        staleCandleCodes[timeframe],
        String(age),
        String(maximum)
      );
    } else {
      log.pass(
        checkId,
        stage,
        StrategyReasonCode.DATA_FRESHNESS_VALID,
        String(age),
        String(maximum)
      );
    }
  }

  // ── 5b./7. Data quality snapshot per timeframe ───────────────────────────
  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const checkId = `DATA_QUALITY_${timeframe.toUpperCase()}`;
    const quality = snapshot.series?.[timeframe]?.dataQuality ?? null;
    if (quality === null) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.DATA_QUALITY_MISSING,
        timeframe
      );
      continue;
    }
    const observedAtMs = parseInstant(quality.observedAt);
    if (observedAtMs === null) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.SNAPSHOT_TIMESTAMP_MALFORMED,
        quality.id
      );
      continue;
    }
    if (observedAtMs > asOfMs) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.CANDLE_TIMESTAMP_AFTER_AS_OF,
        quality.observedAt,
        snapshot.asOf
      );
      continue;
    }
    const age = asOfMs - observedAtMs;
    if (age > PARAMS.maxDataQualityAgeMs) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.DATA_STALE_DATA_QUALITY,
        String(age),
        String(PARAMS.maxDataQualityAgeMs)
      );
      continue;
    }
    if (
      quality.providerErrorCount > 0 ||
      quality.entitlementErrorCount > 0 ||
      quality.noDataCount > 0 ||
      (quality.lastErrorKind !== null && quality.lastErrorKind !== "")
    ) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.DATA_QUALITY_PROVIDER_ERROR,
        quality.lastErrorKind ?? String(quality.providerErrorCount),
        "0"
      );
      continue;
    }
    if (quality.gapCount > 0 || quality.missingCandleCount > 0) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.DATA_QUALITY_INSUFFICIENT,
        String(quality.gapCount + quality.missingCandleCount),
        "0"
      );
      continue;
    }
    if (quality.candleCount < PARAMS.minimumCandlesPerTimeframe) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.DATA_QUALITY_INSUFFICIENT,
        String(quality.candleCount),
        String(PARAMS.minimumCandlesPerTimeframe)
      );
      continue;
    }
    log.pass(
      checkId,
      stage,
      StrategyReasonCode.DATA_QUALITY_VALID,
      String(age),
      String(PARAMS.maxDataQualityAgeMs)
    );
  }

  // ── 5c. Market regime freshness ──────────────────────────────────────────
  const marketRegime = snapshot.marketRegime ?? null;
  if (marketRegime === null) {
    log.fail("REGIME_PRESENT", stage, StrategyReasonCode.REGIME_MISSING);
  } else {
    const generatedAtMs = parseInstant(marketRegime.generatedAt);
    if (generatedAtMs === null) {
      log.fail(
        "REGIME_PRESENT",
        stage,
        StrategyReasonCode.SNAPSHOT_TIMESTAMP_MALFORMED,
        marketRegime.generatedAt
      );
    } else if (generatedAtMs > asOfMs) {
      log.fail(
        "REGIME_FRESHNESS",
        stage,
        StrategyReasonCode.CANDLE_TIMESTAMP_AFTER_AS_OF,
        marketRegime.generatedAt,
        snapshot.asOf
      );
    } else if (asOfMs - generatedAtMs > PARAMS.maxRegimeAgeMs) {
      log.fail(
        "REGIME_FRESHNESS",
        stage,
        StrategyReasonCode.DATA_STALE_REGIME,
        String(asOfMs - generatedAtMs),
        String(PARAMS.maxRegimeAgeMs)
      );
    } else if (!isFiniteNumber(marketRegime.confidence)) {
      log.fail(
        "REGIME_FRESHNESS",
        stage,
        StrategyReasonCode.SNAPSHOT_MALFORMED,
        "confidence"
      );
    } else {
      log.pass(
        "REGIME_FRESHNESS",
        stage,
        StrategyReasonCode.DATA_FRESHNESS_VALID,
        String(asOfMs - generatedAtMs),
        String(PARAMS.maxRegimeAgeMs)
      );
    }
  }

  // ── 6. Signal references (docs/trading/05, item 6) ───────────────────────
  const missingSignalCodes: Readonly<
    Record<StrategyTimeframe, StrategyReasonCode>
  > = {
    "1h": StrategyReasonCode.SIGNAL_MISSING_1H,
    "4h": StrategyReasonCode.SIGNAL_MISSING_4H,
    "1d": StrategyReasonCode.SIGNAL_MISSING_1D
  };
  const staleSignalCodes: Readonly<
    Record<StrategyTimeframe, StrategyReasonCode>
  > = {
    "1h": StrategyReasonCode.DATA_STALE_SIGNAL_1H,
    "4h": StrategyReasonCode.DATA_STALE_SIGNAL_4H,
    "1d": StrategyReasonCode.DATA_STALE_SIGNAL_1D
  };
  const validatedSignals: Partial<Record<StrategyTimeframe, SnapshotSignalV1>> =
    {};
  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const checkId = `SIGNAL_REFERENCE_${timeframe.toUpperCase()}`;
    const signal = snapshot.signals?.[timeframe] ?? null;
    if (signal === null || typeof signal.id !== "string" || signal.id === "") {
      log.fail(checkId, stage, missingSignalCodes[timeframe], timeframe);
      continue;
    }
    const createdAtMs = parseInstant(signal.createdAt);
    if (createdAtMs === null) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.SNAPSHOT_TIMESTAMP_MALFORMED,
        signal.createdAt
      );
      continue;
    }
    if (createdAtMs > asOfMs) {
      log.fail(
        checkId,
        stage,
        StrategyReasonCode.SIGNAL_TIMESTAMP_AFTER_AS_OF,
        signal.createdAt,
        snapshot.asOf
      );
      continue;
    }
    if (
      !isFiniteNumber(signal.adjustedScore) ||
      !isFiniteNumber(signal.baseScore)
    ) {
      log.fail(checkId, stage, StrategyReasonCode.SNAPSHOT_MALFORMED, "score");
      continue;
    }

    if (timeframe === "1h") {
      // The 1h signal must belong to the anchor candle, not to a later one.
      const anchor = parsedSeries["1h"];
      if (anchor === undefined) {
        // The 1h series already failed; anchoring cannot be judged and must not
        // be reported as a second, misleading refusal reason.
        continue;
      }
      const distance = createdAtMs - anchor.anchor.closeTimeMs;
      if (distance < 0 || distance > TIMEFRAME_INTERVAL_MS["1h"]) {
        log.fail(
          checkId,
          stage,
          StrategyReasonCode.SIGNAL_NOT_ANCHORED_TO_CANDLE,
          String(distance),
          String(TIMEFRAME_INTERVAL_MS["1h"])
        );
        continue;
      }
    } else {
      const age = asOfMs - createdAtMs;
      const maximum = PARAMS.maxSignalAgeMs[timeframe];
      if (age > maximum) {
        log.fail(
          checkId,
          stage,
          staleSignalCodes[timeframe],
          String(age),
          String(maximum)
        );
        continue;
      }
    }

    validatedSignals[timeframe] = signal;
    log.pass(
      checkId,
      stage,
      StrategyReasonCode.SIGNAL_REFERENCES_VALID,
      signal.id
    );
  }

  // ── 6b. Multi-timeframe summary must be present and derived ──────────────
  const multiTimeframe = snapshot.multiTimeframe ?? null;
  if (multiTimeframe === null || typeof multiTimeframe.alignment !== "string") {
    log.fail("MTF_PRESENT", stage, StrategyReasonCode.MTF_MISSING);
  } else if (parseDecimal(multiTimeframe.alignmentScore) === null) {
    log.fail(
      "MTF_PRESENT",
      stage,
      StrategyReasonCode.SNAPSHOT_DECIMAL_MALFORMED,
      "alignmentScore"
    );
  } else {
    log.pass(
      "MTF_PRESENT",
      stage,
      StrategyReasonCode.MTF_SNAPSHOT_PRESENT,
      multiTimeframe.alignment
    );
  }

  // ── Context events list is mandatory, even when empty ────────────────────
  const contextEvents = Array.isArray(snapshot.contextEvents)
    ? snapshot.contextEvents
    : null;
  if (contextEvents === null) {
    log.fail(
      "CONTEXT_EVENTS_PRESENT",
      stage,
      StrategyReasonCode.SNAPSHOT_MALFORMED,
      "contextEvents"
    );
  }

  if (
    log.hasFailure ||
    parsedSeries["1h"] === undefined ||
    parsedSeries["4h"] === undefined ||
    parsedSeries["1d"] === undefined ||
    validatedSignals["1h"] === undefined ||
    validatedSignals["4h"] === undefined ||
    validatedSignals["1d"] === undefined ||
    multiTimeframe === null ||
    marketRegime === null ||
    executionProfile === null ||
    contextEvents === null
  ) {
    return { ok: false, checks: log.checks, failures: log.failures };
  }

  return {
    ok: true,
    checks: log.checks,
    validated: {
      snapshot,
      asOfMs,
      series: {
        "1h": parsedSeries["1h"],
        "4h": parsedSeries["4h"],
        "1d": parsedSeries["1d"]
      },
      signals: {
        "1h": validatedSignals["1h"],
        "4h": validatedSignals["4h"],
        "1d": validatedSignals["1d"]
      },
      multiTimeframe,
      marketRegime,
      executionProfile,
      contextEvents
    }
  };
}

function isAssignmentWithinWindow(
  validFrom: IsoDateTimeString | null,
  validTo: IsoDateTimeString | null,
  asOfMs: number
): boolean {
  if (validFrom !== null) {
    const fromMs = parseInstant(validFrom);
    if (fromMs === null || fromMs > asOfMs) return false;
  }
  if (validTo !== null) {
    const toMs = parseInstant(validTo);
    if (toMs === null || toMs <= asOfMs) return false;
  }
  return true;
}

/** Exported for the strategy module so both share one timestamp parser. */
export const parseIsoInstant = parseInstant;

/** Exported for the strategy module so both share one decimal parser. */
export const parseDecimalString = parseDecimal;
