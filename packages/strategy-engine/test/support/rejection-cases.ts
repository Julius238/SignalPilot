/**
 * Named rejection scenarios for `CRYPTO_MTF_BREAKOUT_V1`.
 *
 * Each case starts from the passing ETHUSDT snapshot and changes exactly one
 * aspect, following docs/trading/12-test-and-acceptance-plan.md, "Strategy-v1-Testmatrix":
 * "jeweils nur ein Merkmal variieren". Where one physical change necessarily
 * trips a second condition (a stale series also shifts its anchor), the case
 * documents the expected code it must contain rather than the full set.
 */

import {
  TIMEFRAME_INTERVAL_MS,
  type SnapshotCandleV1,
  type StrategyInputSnapshotV1,
  type StrategyTimeframe
} from "../../src/index.js";
import { StrategyEvaluationOutcome, StrategyReasonCode } from "../../src/reason-codes.js";

import { BTC_1H_SHAPE, buildCandles, buildPassingSnapshot, clone } from "./build-snapshot.js";

export interface RejectionCase {
  readonly name: string;
  readonly expectedOutcome: typeof StrategyEvaluationOutcome.NO_CANDIDATE | typeof StrategyEvaluationOutcome.INVALID_INPUT;
  readonly expectedReasonCode: StrategyReasonCode;
  readonly mutate: (snapshot: StrategyInputSnapshotV1) => StrategyInputSnapshotV1;
}

const iso = (epochMs: number): string => new Date(epochMs).toISOString();

function withSeries(
  snapshot: StrategyInputSnapshotV1,
  timeframe: StrategyTimeframe,
  candles: readonly SnapshotCandleV1[]
): StrategyInputSnapshotV1 {
  const next = clone(snapshot);
  next.series[timeframe].candles = clone(candles);
  return next;
}

function shiftTimeframe(
  snapshot: StrategyInputSnapshotV1,
  timeframe: StrategyTimeframe,
  deltaMs: number
): StrategyInputSnapshotV1 {
  const next = clone(snapshot);
  const series = next.series[timeframe];
  const shifted = series.candles.map((candle) => ({
    ...candle,
    openTime: iso(Date.parse(candle.openTime) + deltaMs),
    closeTime: iso(Date.parse(candle.closeTime) + deltaMs)
  }));
  const signal = next.signals[timeframe];
  return {
    ...next,
    series: { ...next.series, [timeframe]: { ...series, candles: shifted } },
    signals:
      signal === null
        ? next.signals
        : {
            ...next.signals,
            [timeframe]: { ...signal, createdAt: iso(Date.parse(signal.createdAt) + deltaMs) }
          }
  };
}

/** Lift the oldest closes so `SMA50 > SMA200` no longer holds. */
function raiseOldCandles(
  snapshot: StrategyInputSnapshotV1,
  timeframe: StrategyTimeframe,
  count: number,
  factor: number
): StrategyInputSnapshotV1 {
  const next = clone(snapshot);
  const series = next.series[timeframe];
  const scaled = series.candles.map((candle, index) => {
    if (index >= count) return candle;
    const scale = (value: string): string => (Number(value) * factor).toFixed(6);
    return {
      ...candle,
      open: scale(candle.open),
      high: scale(candle.high),
      low: scale(candle.low),
      close: scale(candle.close)
    };
  });
  return { ...next, series: { ...next.series, [timeframe]: { ...series, candles: scaled } } };
}

export const REJECTION_CASES: readonly RejectionCase[] = Object.freeze([
  // ── Scope (docs/trading/05, "Vorvalidierung" 1–2) ─────────────────────────
  {
    name: "asset-symbol-not-allowed",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.ASSET_NOT_ALLOWED,
    mutate: (snapshot) => ({ ...clone(snapshot), asset: { ...snapshot.asset, symbol: "SOLUSDT" } })
  },
  {
    name: "asset-not-tradable",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.ASSET_NOT_TRADABLE,
    mutate: (snapshot) => ({ ...clone(snapshot), asset: { ...snapshot.asset, isTradable: false } })
  },
  {
    name: "asset-quote-currency-not-usdt",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.ASSET_QUOTE_CURRENCY_NOT_USDT,
    mutate: (snapshot) => ({ ...clone(snapshot), asset: { ...snapshot.asset, quoteCurrency: "USDC" } })
  },
  {
    name: "asset-leveraged",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.ASSET_LEVERAGED_FORBIDDEN,
    mutate: (snapshot) => ({ ...clone(snapshot), asset: { ...snapshot.asset, isLeveraged: true } })
  },
  {
    name: "assignment-disabled",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.ASSIGNMENT_DISABLED,
    mutate: (snapshot) => ({ ...clone(snapshot), assignment: { ...snapshot.assignment, enabled: false } })
  },
  {
    name: "strategy-version-not-active",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.STRATEGY_VERSION_NOT_ACTIVE,
    mutate: (snapshot) => ({ ...clone(snapshot), strategy: { ...snapshot.strategy, status: "APPROVED" } })
  },
  {
    name: "execution-profile-missing",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.EXECUTION_PROFILE_MISSING,
    mutate: (snapshot) => ({ ...clone(snapshot), executionProfile: null })
  },

  // ── Candle integrity and history (items 3–4) ──────────────────────────────
  {
    name: "insufficient-history",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.CANDLES_INSUFFICIENT_HISTORY,
    mutate: (snapshot) => withSeries(snapshot, "1h", snapshot.series["1h"].candles.slice(-199))
  },
  {
    name: "anchor-candle-not-closed",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.CANDLE_NOT_CLOSED,
    mutate: (snapshot) => {
      const candles = clone(snapshot.series["1h"].candles);
      const anchor = candles[candles.length - 1];
      candles[candles.length - 1] = { ...anchor, closeTime: iso(Date.parse(snapshot.asOf) + 60_000) };
      return withSeries(snapshot, "1h", candles);
    }
  },
  {
    name: "candle-series-gap",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.CANDLE_SERIES_GAP,
    mutate: (snapshot) => {
      const candles = clone(snapshot.series["1h"].candles);
      candles.splice(candles.length - 100, 1);
      return withSeries(snapshot, "1h", candles);
    }
  },
  {
    name: "candle-duplicate-open-time",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.CANDLE_OPEN_TIME_DUPLICATE,
    mutate: (snapshot) => {
      const candles = clone(snapshot.series["1h"].candles);
      candles[100] = {
        ...candles[100],
        openTime: candles[99].openTime,
        closeTime: candles[99].closeTime
      };
      return withSeries(snapshot, "1h", candles);
    }
  },
  {
    name: "candle-ohlc-invariant-violated",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.CANDLE_OHLC_INVARIANT_VIOLATED,
    mutate: (snapshot) => {
      const candles = clone(snapshot.series["1h"].candles);
      candles[10] = { ...candles[10], low: (Number(candles[10].high) + 1).toFixed(6) };
      return withSeries(snapshot, "1h", candles);
    }
  },
  {
    name: "candle-source-unknown",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.CANDLE_SOURCE_UNKNOWN,
    mutate: (snapshot) => {
      const candles = clone(snapshot.series["1h"].candles);
      candles[5] = { ...candles[5], source: "UNKNOWN" };
      return withSeries(snapshot, "1h", candles);
    }
  },

  // ── Freshness and data quality (items 5–7) ────────────────────────────────
  {
    name: "stale-1h-candles",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.DATA_STALE_CANDLES_1H,
    mutate: (snapshot) => shiftTimeframe(snapshot, "1h", -3 * TIMEFRAME_INTERVAL_MS["1h"])
  },
  {
    name: "stale-market-regime",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.DATA_STALE_REGIME,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      marketRegime: { ...snapshot.marketRegime!, generatedAt: "2026-07-31T00:00:00.000Z" }
    })
  },
  {
    name: "data-quality-gap-reported",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.DATA_QUALITY_INSUFFICIENT,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.series["1h"].dataQuality = { ...next.series["1h"].dataQuality!, gapCount: 2 };
      return next;
    }
  },
  {
    name: "data-quality-missing",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.DATA_QUALITY_MISSING,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.series["4h"].dataQuality = null;
      return next;
    }
  },
  {
    name: "signal-1h-missing",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.SIGNAL_MISSING_1H,
    mutate: (snapshot) => ({ ...clone(snapshot), signals: { ...clone(snapshot.signals), "1h": null } })
  },
  {
    name: "signal-1h-not-anchored",
    expectedOutcome: StrategyEvaluationOutcome.INVALID_INPUT,
    expectedReasonCode: StrategyReasonCode.SIGNAL_NOT_ANCHORED_TO_CANDLE,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.signals["1h"] = { ...next.signals["1h"]!, createdAt: "2026-08-02T05:02:00.000Z" };
      return next;
    }
  },

  // ── Entry conditions (docs/trading/05, "Entry-Voraussetzungen") ───────────
  {
    name: "no-breakout-above-prior-high",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.BREAKOUT_NOT_CONFIRMED,
    mutate: (snapshot) =>
      withSeries(
        snapshot,
        "1h",
        buildCandles("1h", { ...BTC_1H_SHAPE, anchorMove: 20 }, { idPrefix: snapshot.asset.symbol.toLowerCase() })
      )
  },
  {
    name: "relative-volume-below-minimum",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.RELATIVE_VOLUME_BELOW_MINIMUM,
    mutate: (snapshot) =>
      withSeries(
        snapshot,
        "1h",
        buildCandles("1h", { ...BTC_1H_SHAPE, anchorVolume: 120 }, { idPrefix: snapshot.asset.symbol.toLowerCase() })
      )
  },
  {
    name: "relative-volume-unavailable",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.RELATIVE_VOLUME_UNAVAILABLE,
    mutate: (snapshot) =>
      withSeries(
        snapshot,
        "1h",
        buildCandles(
          "1h",
          { ...BTC_1H_SHAPE, volume: 0 },
          { idPrefix: snapshot.asset.symbol.toLowerCase() }
        )
      )
  },
  {
    name: "rsi-above-maximum",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.RSI_OUT_OF_RANGE,
    mutate: (snapshot) =>
      withSeries(
        snapshot,
        "1h",
        buildCandles(
          "1h",
          { ...BTC_1H_SHAPE, waveAmplitude: 0 },
          { idPrefix: snapshot.asset.symbol.toLowerCase() }
        )
      )
  },
  {
    name: "atr-ratio-below-minimum",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.ATR_RATIO_OUT_OF_RANGE,
    mutate: (snapshot) =>
      withSeries(
        snapshot,
        "1h",
        buildCandles(
          "1h",
          { ...BTC_1H_SHAPE, halfRange: 3, waveAmplitude: 12 },
          { idPrefix: snapshot.asset.symbol.toLowerCase() }
        )
      )
  },
  {
    name: "trend-1h-broken",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.TREND_FILTER_1H_FAILED,
    mutate: (snapshot) => raiseOldCandles(snapshot, "1h", 150, 1.3)
  },
  {
    name: "trend-1d-broken",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.TREND_FILTER_1D_FAILED,
    mutate: (snapshot) => raiseOldCandles(snapshot, "1d", 150, 1.9)
  },
  {
    name: "signal-1h-status-not-allowed",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.SIGNAL_1H_STATUS_NOT_ALLOWED,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.signals["1h"] = { ...next.signals["1h"]!, status: "WAIT", adjustedStatus: "WAIT" };
      return next;
    }
  },
  {
    name: "signal-1h-score-below-minimum",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.SIGNAL_1H_SCORE_BELOW_MINIMUM,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.signals["1h"] = { ...next.signals["1h"]!, adjustedScore: 69 };
      return next;
    }
  },
  {
    name: "signal-1h-risk-level-high",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.SIGNAL_1H_RISK_LEVEL_TOO_HIGH,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.signals["1h"] = { ...next.signals["1h"]!, riskLevel: "HIGH" };
      return next;
    }
  },
  {
    name: "higher-timeframe-4h-conflict",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.HIGHER_TIMEFRAME_4H_CONFLICT,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.signals["4h"] = { ...next.signals["4h"]!, direction: "BEARISH" };
      return next;
    }
  },
  {
    name: "higher-timeframe-1d-conflict",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.HIGHER_TIMEFRAME_1D_CONFLICT,
    mutate: (snapshot) => {
      const next = clone(snapshot);
      next.signals["1d"] = { ...next.signals["1d"]!, status: "AVOID", adjustedStatus: "AVOID" };
      return next;
    }
  },
  {
    name: "mtf-not-bullish-aligned",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.MTF_NOT_BULLISH_ALIGNED,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      multiTimeframe: { ...snapshot.multiTimeframe!, alignment: "HIGHER_TIMEFRAME_CONFIRMATION" }
    })
  },
  {
    name: "mtf-alignment-score-below-minimum",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.MTF_ALIGNMENT_SCORE_BELOW_MINIMUM,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      multiTimeframe: {
        ...snapshot.multiTimeframe!,
        alignmentScore: "0.640000000000",
        alignmentScoreRaw: 64
      }
    })
  },
  {
    name: "regime-not-risk-on",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.REGIME_NOT_RISK_ON,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      marketRegime: { ...snapshot.marketRegime!, cryptoRegime: "NEUTRAL" }
    })
  },
  {
    name: "regime-risk-mode-defensive",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.REGIME_RISK_MODE_BLOCKED,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      marketRegime: { ...snapshot.marketRegime!, riskMode: "DEFENSIVE" }
    })
  },
  {
    name: "regime-confidence-below-minimum",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.REGIME_CONFIDENCE_BELOW_MINIMUM,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      marketRegime: { ...snapshot.marketRegime!, confidence: 59 }
    })
  },
  {
    name: "critical-bearish-context-event",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT,
    mutate: (snapshot) => ({
      ...clone(snapshot),
      contextEvents: [
        {
          kind: "MARKET_EVENT",
          id: "market-event-1",
          observedAt: "2026-08-02T08:30:00.000Z",
          eventType: "RISK_SENTIMENT",
          severity: "CRITICAL",
          directionalBias: "BEARISH",
          summary: "Deterministically classified risk-off shock"
        }
      ]
    })
  },

  // ── Price plan (docs/trading/05, "Candidate-Preisplan") ───────────────────
  {
    name: "stop-distance-above-cap",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.STOP_DISTANCE_ABOVE_MAXIMUM,
    mutate: (snapshot) =>
      withSeries(
        snapshot,
        "1h",
        buildCandles(
          "1h",
          { ...BTC_1H_SHAPE, halfRange: 230, anchorMove: 700 },
          { idPrefix: snapshot.asset.symbol.toLowerCase() }
        )
      )
  },
  {
    name: "candidate-already-expired",
    expectedOutcome: StrategyEvaluationOutcome.NO_CANDIDATE,
    expectedReasonCode: StrategyReasonCode.CANDIDATE_ALREADY_EXPIRED,
    mutate: (snapshot) => {
      // `expiresAt` is anchorClose + 2 h while 1h candles stay fresh for 2 h 15,
      // so an `asOf` 2 h 05 after the anchor expires the candidate without
      // tripping any freshness rule. Only the observation times move with it.
      const next = clone(snapshot);
      const anchorCloseMs = Date.parse(next.series["1h"].candles.at(-1)!.closeTime);
      const asOfMs = anchorCloseMs + 2 * TIMEFRAME_INTERVAL_MS["1h"] + 5 * 60_000;
      const observedAt = iso(asOfMs - 60_000);
      for (const timeframe of ["1h", "4h", "1d"] as const) {
        const quality = next.series[timeframe].dataQuality;
        if (quality !== null) next.series[timeframe].dataQuality = { ...quality, observedAt };
      }
      return {
        ...next,
        asOf: iso(asOfMs),
        marketRegime: { ...next.marketRegime!, generatedAt: observedAt }
      };
    }
  }
]);

/** ETH base snapshot every rejection case starts from. */
export const ETH_BASE_SNAPSHOT = (): StrategyInputSnapshotV1 =>
  buildPassingSnapshot({ symbol: "ETHUSDT", assetId: "asset-eth" });
