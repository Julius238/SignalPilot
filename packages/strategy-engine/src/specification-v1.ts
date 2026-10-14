/**
 * Immutable parameter set of `CRYPTO_MTF_BREAKOUT_V1`.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md (every table row
 * and every inequality) and docs/trading/decisions/0003-deterministic-versioned-engines.md
 * ("Ab Freigabe sind StrategyVersion … immutable").
 *
 * Nothing here is read from the environment, a database or a clock. Changing a
 * value changes `CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH` and therefore
 * requires a new `StrategyVersion` — historical candidates keep referring to
 * the hash they were decided with.
 */

import { buildSpecificationHash } from "@signalpilot/trading-domain";

import { INDICATORS_V1_VERSION } from "./indicators-v1.js";

/**
 * Legacy key of the long strategy, kept so historical candidates stay
 * evaluable and reproducible.
 *
 * The strategy is now called `CRYPTO_MTF_BREAKOUT_LONG_V1` (ADR 0011). The key
 * is part of `parametersJson` and therefore part of the specification hash, so
 * renaming it is an identity change: it produces a different hash and needs a
 * new `StrategyVersion` — an in-place edit of an approved version is forbidden
 * (docs/trading/03, ADR 0003).
 *
 * The compatibility path is therefore two registry entries, not a rewrite:
 * this legacy identity keeps the exact parameters and the exact hash that
 * historical rows were decided with, while new assignments use the LONG
 * identity below. The evaluation logic is literally the same function; only
 * the identity differs.
 */
export const CRYPTO_MTF_BREAKOUT_V1_KEY = "CRYPTO_MTF_BREAKOUT_V1";

/** Current key of the long strategy (ADR 0011). */
export const CRYPTO_MTF_BREAKOUT_LONG_V1_KEY = "CRYPTO_MTF_BREAKOUT_LONG_V1";

/** Semantic version of the engine implementation, not of the parameters. */
export const CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION =
  "crypto-mtf-breakout-v1/1.0.0";

export const BREAKOUT_POLICY_VERSION = "breakout-policy-v1/1.0.0";
export const FRESHNESS_POLICY_VERSION = "freshness-policy-v1/1.0.0";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Fully expanded parameters — no environment reference, no "latest" pointer
 * (docs/trading/03, `StrategyVersion.parametersJson`).
 */
export const CRYPTO_MTF_BREAKOUT_V1_PARAMETERS = Object.freeze({
  key: CRYPTO_MTF_BREAKOUT_V1_KEY,
  engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  indicatorVersion: INDICATORS_V1_VERSION,
  breakoutPolicyVersion: BREAKOUT_POLICY_VERSION,
  freshnessPolicyVersion: FRESHNESS_POLICY_VERSION,

  // ── Scope (docs/trading/05, "Empfehlung") ────────────────────────────────
  market: "CRYPTO_SPOT",
  direction: "LONG",
  entryType: "MARKET",
  quoteCurrency: "USDT",
  allowedSymbols: Object.freeze(["BTCUSDT", "ETHUSDT"] as const),
  decisionTimeframe: "1h",
  confirmationTimeframes: Object.freeze(["4h", "1d"] as const),
  leverageAllowed: false,
  marginAllowed: false,
  futuresAllowed: false,
  llmUsed: false,

  // ── History and integrity (docs/trading/05, "Vorvalidierung" 3–4) ────────
  requestedCandlesPerTimeframe: 250,
  minimumCandlesPerTimeframe: 200,
  gapFreeWindow: 200,

  // ── Freshness (docs/trading/05, "Vorvalidierung" 5–6) ────────────────────
  maxCandleAgeMs: Object.freeze({
    "1h": 2 * HOUR_MS + 15 * MINUTE_MS,
    "4h": 8 * HOUR_MS + 15 * MINUTE_MS,
    "1d": 48 * HOUR_MS + 15 * MINUTE_MS
  }),
  maxDataQualityAgeMs: 2 * HOUR_MS,
  maxRegimeAgeMs: 26 * HOUR_MS,
  maxSignalAgeMs: Object.freeze({
    "1h": 2 * HOUR_MS + 15 * MINUTE_MS,
    "4h": 8 * HOUR_MS + 15 * MINUTE_MS,
    "1d": 48 * HOUR_MS + 15 * MINUTE_MS
  }),
  forbiddenCandleSources: Object.freeze(["", "UNKNOWN"] as const),

  // ── Trend, breakout, momentum, volume, volatility ────────────────────────
  smaFastPeriod: 20,
  smaMediumPeriod: 50,
  smaSlowPeriod: 200,
  breakoutLookback: 20,
  volumeLookback: 20,
  relativeVolumeMinimum: "1.5",
  rsiPeriod: 14,
  rsiMinimum: "50",
  rsiMaximum: "72",
  atrPeriod: 14,
  atrToCloseMinimum: "0.005",
  atrToCloseMaximum: "0.04",

  // ── Existing signal and context confirmation ─────────────────────────────
  signalDirection1h: "BULLISH",
  signalAllowedStatuses1h: Object.freeze(["WATCH", "STRONG_WATCH"] as const),
  signalMinimumAdjustedScore1h: 70,
  signalForbiddenRiskLevels: Object.freeze(["HIGH"] as const),
  higherTimeframeDirection: "BULLISH",
  higherTimeframeForbiddenStatuses: Object.freeze([
    "AVOID",
    "NO_EDGE"
  ] as const),
  multiTimeframeRequiredAlignment: "BULLISH_ALIGNED",
  multiTimeframeMinimumAlignmentScore: "0.65",
  regimeRequiredCryptoRegime: "RISK_ON",
  regimeForbiddenRiskModes: Object.freeze([
    "DEFENSIVE",
    "HIGH_RISK",
    "UNKNOWN"
  ] as const),
  regimeMinimumConfidence: 60,
  blockingContextSeverities: Object.freeze(["CRITICAL"] as const),

  // ── Price plan (docs/trading/05, "Candidate-Preisplan") ──────────────────
  //
  // Gross take-profit was 2R until 2026-08-02. Spread, slippage and round-trip
  // fees always eat into the gross reward, so a 2R gross target could never
  // clear the risk engine's 2.0R *net* minimum (`R-008-MIN-RR`,
  // docs/trading/06) once realistic costs were charged — every candidate that
  // reached the risk engine was mathematically unable to pass. Raising the
  // gross target to 2.5R restores headroom for costs without lowering, or
  // otherwise touching, the risk engine's net minimum. 2.5R gross still does
  // not guarantee approval: a candidate with wide spread/slippage/fees can and
  // should still be rejected by `R-008` (docs/trading/decisions/0008-strategy-take-profit-2-5r-gross.md).
  //
  // This is a versioned specification change: it changes
  // `CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH` below, so any `StrategyVersion`
  // row seeded from these parameters must be a new, additional version — never
  // an in-place edit of a previously approved version's `parametersJson`/
  // `specificationHash` (docs/trading/03, "Ab Freigabe sind Parameter/Hashes
  // unveränderlich").
  stopAtrMultiple: "1.5",
  stopDistanceFloorPct: "0.0075",
  stopDistanceCapPct: "0.03",
  takeProfitRMultiple: "2.5",
  // Strategy-level sanity floor on the *gross* planned RR the price plan must
  // clear before a candidate is even proposed. It is deliberately distinct
  // from the risk engine's net-of-cost minimum, which stays 2.0R
  // (docs/trading/06, R-008-MIN-RR) and is not defined in this package.
  minimumRewardRisk: "2",

  // ── Candidate validity (docs/trading/05, "Candidate-Gültigkeit") ─────────
  candidateTtlMs: 2 * HOUR_MS,
  entryGapAtrMultiple: "0.5",
  maxHoldHours: 72
} as const);

export type CryptoMtfBreakoutV1Parameters =
  typeof CRYPTO_MTF_BREAKOUT_V1_PARAMETERS;

/**
 * SHA-256 over the canonical specification. Written to every candidate and
 * compared against `StrategyVersion.specificationHash` before evaluation.
 */
export const CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH = buildSpecificationHash(
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS
);

// ───────────────────────────────────────────────────────────────────────────
// CRYPTO_MTF_BREAKOUT_LONG_V1 — the renamed long identity
// ───────────────────────────────────────────────────────────────────────────

/**
 * Price-plan tick policy: stop and take profit are snapped to the instrument's
 * tick size in the conservative direction — the stop moves away from the entry
 * (more risk per unit, so a smaller position), the target moves towards it
 * (less reward). Without it a computed stop almost never sits on the tick grid
 * and the risk engine refuses the plan (R-007 "Stop price is not tick
 * conformant"), so no candidate could ever be executed.
 */
export const PRICE_TICK_POLICY_VERSION = "price-tick-policy-v1/1.0.0";

/** 1.1.0 = 1.0.0 rules + tick-aligned price plan + own identity on every result. */
export const CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION =
  "crypto-mtf-breakout-v1/1.1.0";

/**
 * Identical to `CRYPTO_MTF_BREAKOUT_V1_PARAMETERS` in every entry rule (ADR
 * 0011): same breakout lookback, same volume, RSI, ATR and confirmation
 * thresholds, same RISK_ON requirement, same 2.5R gross target and same 2.0R
 * strategy-level floor. It differs in `key`, `engineVersion` and the
 * tick-aligned price plan (`priceTickPolicyVersion`); the legacy identity keeps
 * its unaligned plan so historical decisions stay reproducible.
 */
export const CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS = Object.freeze({
  ...CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  key: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
  priceTickPolicyVersion: PRICE_TICK_POLICY_VERSION
} as const);

export const CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH =
  buildSpecificationHash(CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS);

// ───────────────────────────────────────────────────────────────────────────
// CRYPTO_TREND_CORE_LONG_V1 — the real-data research candidate (K2)
// ───────────────────────────────────────────────────────────────────────────

export const CRYPTO_TREND_CORE_LONG_V1_KEY = "CRYPTO_TREND_CORE_LONG_V1";

/** 1.2.0 = the 1.1.0 breakout evaluator with a specified (not research) rule set. */
export const CRYPTO_TREND_CORE_LONG_V1_ENGINE_VERSION =
  "crypto-mtf-breakout-v1/1.2.0";

/**
 * Regime model the strategy is specified against. Equals
 * `CRYPTO_NATIVE_REGIME_VERSION` of `@signalpilot/market-regime` (the shadow
 * replay tests assert it); kept as a literal so the strategy engine does not
 * depend on the regime package.
 */
export const CRYPTO_NATIVE_REGIME_SOURCE = "crypto-native-regime-v1/1.0.0";

/**
 * Research variant TREND_CORE_3R under the CRYPTO_NATIVE_V1 regime, promoted
 * as its own versioned identity after the pre-registered real-data check
 * (docs/trading/research/2026-10-14-*): training 2018–2023 PF 1.42 / avg R
 * +0.26 over 73 BTC trades, untouched test 2024–2026 PF 1.12 / avg R +0.08
 * over 49 — plausible, not proven. Same entry engine as LONG_V1; it keeps the
 * conditions that carried a forward-return spread on training data (SMA trend
 * stacks on 1h/4h/1d, breakout, regime) and drops the signal-engine
 * confirmations, the relative-volume, RSI and ATR filters; stop cap 6 %, stop
 * floor 1.75 % (net 2R after costs), target 3R. Its regime is the
 * crypto-native report, never the equity-dependent production one.
 */
export const CRYPTO_TREND_CORE_LONG_V1_PARAMETERS = Object.freeze({
  ...CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS,
  key: CRYPTO_TREND_CORE_LONG_V1_KEY,
  engineVersion: CRYPTO_TREND_CORE_LONG_V1_ENGINE_VERSION,
  requireSignalConfirmation1h: false,
  requireHigherTimeframeSignals: false,
  relativeVolumeMinimum: "0",
  rsiMinimum: "0",
  rsiMaximum: "100",
  atrToCloseMinimum: "0",
  atrToCloseMaximum: "1",
  stopDistanceCapPct: "0.06",
  stopDistanceFloorPct: "0.0175",
  takeProfitRMultiple: "3",
  regimeSource: CRYPTO_NATIVE_REGIME_SOURCE
} as const);

export const CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH =
  buildSpecificationHash(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS);

// ───────────────────────────────────────────────────────────────────────────
// CRYPTO_MTF_BREAKDOWN_SHORT_V1 — the separate short strategy
// ───────────────────────────────────────────────────────────────────────────

export const CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY =
  "CRYPTO_MTF_BREAKDOWN_SHORT_V1";

/** 1.1.0 = 1.0.0 rules + tick-aligned price plan (`PRICE_TICK_POLICY_VERSION`). */
export const CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION =
  "crypto-mtf-breakdown-short-v1/1.1.0";

export const BREAKDOWN_POLICY_VERSION = "breakdown-policy-v1/1.0.0";

/**
 * Parameters of the short strategy.
 *
 * A separate parameter set, not a mirrored long one (ADR 0011). Where a value
 * is genuinely direction-neutral — history depth, freshness windows, ATR
 * bounds, stop model, 2.5R gross target, 72 h max hold — it deliberately
 * matches the long strategy so the two remain comparable. Where the market
 * behaves differently, the value is chosen for the short side and the reason
 * is written next to it.
 *
 * `direction: "SHORT"` marks a **synthetic, unleveraged** shadow short: no
 * borrow, no funding, no liquidation, no margin (ADR 0012). `leverageAllowed`,
 * `marginAllowed` and `futuresAllowed` stay false exactly as for long.
 */
export const CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS = Object.freeze({
  key: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  indicatorVersion: INDICATORS_V1_VERSION,
  breakdownPolicyVersion: BREAKDOWN_POLICY_VERSION,
  freshnessPolicyVersion: FRESHNESS_POLICY_VERSION,
  priceTickPolicyVersion: PRICE_TICK_POLICY_VERSION,

  // ── Scope ────────────────────────────────────────────────────────────────
  market: "CRYPTO_SPOT",
  direction: "SHORT",
  entryType: "MARKET",
  quoteCurrency: "USDT",
  allowedSymbols: Object.freeze(["BTCUSDT", "ETHUSDT"] as const),
  decisionTimeframe: "1h",
  confirmationTimeframes: Object.freeze(["4h", "1d"] as const),
  /** Synthetic simulation only — never a real short (ADR 0012). */
  syntheticShadowShort: true,
  leverageAllowed: false,
  marginAllowed: false,
  futuresAllowed: false,
  borrowModelled: false,
  fundingModelled: false,
  liquidationModelled: false,
  llmUsed: false,

  // ── History and integrity — same depth as long ───────────────────────────
  requestedCandlesPerTimeframe: 250,
  minimumCandlesPerTimeframe: 200,
  gapFreeWindow: 200,

  // ── Freshness — same windows as long ─────────────────────────────────────
  maxCandleAgeMs: Object.freeze({
    "1h": 2 * HOUR_MS + 15 * MINUTE_MS,
    "4h": 8 * HOUR_MS + 15 * MINUTE_MS,
    "1d": 48 * HOUR_MS + 15 * MINUTE_MS
  }),
  maxDataQualityAgeMs: 2 * HOUR_MS,
  maxRegimeAgeMs: 26 * HOUR_MS,
  maxSignalAgeMs: Object.freeze({
    "1h": 2 * HOUR_MS + 15 * MINUTE_MS,
    "4h": 8 * HOUR_MS + 15 * MINUTE_MS,
    "1d": 48 * HOUR_MS + 15 * MINUTE_MS
  }),
  forbiddenCandleSources: Object.freeze(["", "UNKNOWN"] as const),

  // ── Trend, breakdown, momentum, volume, volatility ───────────────────────
  smaFastPeriod: 20,
  smaMediumPeriod: 50,
  smaSlowPeriod: 200,
  /** Lowest low of the 20 closed candles BEFORE the signal candle. */
  breakdownLookback: 20,
  volumeLookback: 20,
  /**
   * Same 1.5x threshold as long. Capitulation candles are usually at least as
   * well supported by volume as breakouts, so there is no evidence-based
   * reason to demand more, and demanding less would weaken the filter.
   */
  relativeVolumeMinimum: "1.5",
  rsiPeriod: 14,
  /**
   * Bearish RSI band, the deliberate mirror of long's 50–72.
   *
   * Upper bound 50: momentum must not still be bullish.
   * Lower bound 28 (not 0): below roughly 30 the move is already extended and
   * a short entry there is chasing capitulation into likely mean reversion.
   * The long side applies the same idea at its own extreme with its 72 cap, so
   * both strategies refuse to enter an exhausted move.
   */
  rsiMinimum: "28",
  rsiMaximum: "50",
  atrPeriod: 14,
  /** Same volatility corridor as long: too quiet is noise, too wild is untradeable. */
  atrToCloseMinimum: "0.005",
  atrToCloseMaximum: "0.04",

  // ── Existing signal and context confirmation ─────────────────────────────
  signalDirection1h: "BEARISH",
  signalAllowedStatuses1h: Object.freeze(["WATCH", "STRONG_WATCH"] as const),
  signalMinimumAdjustedScore1h: 70,
  signalForbiddenRiskLevels: Object.freeze(["HIGH"] as const),
  higherTimeframeDirection: "BEARISH",
  higherTimeframeForbiddenStatuses: Object.freeze([
    "AVOID",
    "NO_EDGE"
  ] as const),
  multiTimeframeRequiredAlignment: "BEARISH_ALIGNED",
  multiTimeframeMinimumAlignmentScore: "0.65",
  /** Short trades only in an explicitly bearish regime. */
  regimeRequiredCryptoRegime: "RISK_OFF",
  regimeForbiddenRiskModes: Object.freeze([
    "DEFENSIVE",
    "HIGH_RISK",
    "UNKNOWN"
  ] as const),
  regimeMinimumConfidence: 60,
  blockingContextSeverities: Object.freeze(["CRITICAL"] as const),

  // ── Price plan — mirrored, same magnitudes as long ───────────────────────
  //
  //   stopPrice       = entry + stopDistance   (ABOVE the entry)
  //   takeProfitPrice = entry − 2.5 × stopDistance (BELOW the entry)
  //
  // Same ATR multiple, same floor and the same hard 3 % cap as long. The 2.5R
  // gross target exists for the same reason as on the long side (ADR 0008):
  // costs eat into gross reward, and a 2R gross target could never clear the
  // risk engine's 2.0R NET minimum.
  stopAtrMultiple: "1.5",
  stopDistanceFloorPct: "0.0075",
  stopDistanceCapPct: "0.03",
  takeProfitRMultiple: "2.5",
  minimumRewardRisk: "2",

  // ── Candidate validity ───────────────────────────────────────────────────
  candidateTtlMs: 2 * HOUR_MS,
  entryGapAtrMultiple: "0.5",
  maxHoldHours: 72
} as const);

export type CryptoMtfBreakdownShortV1Parameters =
  typeof CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS;

export const CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH =
  buildSpecificationHash(CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS);

// ───────────────────────────────────────────────────────────────────────────
// CRYPTO_REGIME_LONG_V1 — challenger: the crypto-native regime as the strategy
// ───────────────────────────────────────────────────────────────────────────

export const CRYPTO_REGIME_LONG_V1_KEY = "CRYPTO_REGIME_LONG_V1";
export const CRYPTO_REGIME_LONG_V1_ENGINE_VERSION = "crypto-regime-long-v1/1.0.0";
/** Fills the snapshot's directional-policy slot (`policyVersions.breakoutPolicyVersion`). */
export const REGIME_ENTRY_POLICY_VERSION = "regime-entry-policy-v1/1.0.0";
/**
 * Exit while the position is open: a market exit as soon as the regime gate
 * (crypto RISK_ON, allowed risk mode, confidence ≥ minimum) is closed in the
 * newest regime snapshot generated by the close of the monitored candle.
 * This is the strategy's own rule, applied only to versions that declare it.
 */
export const REGIME_EXIT_POLICY = "EXIT_ON_REGIME_GATE_CLOSED";

const LONG = CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS;

/**
 * Challenger to CRYPTO_TREND_CORE_LONG_V1, specified 2026-10-14 before its
 * first forward trade (docs/trading/research/2026-10-14-challenger-regime-long-v1.md).
 * Hypothesis: the crypto-native regime itself is the robust part of the
 * research — holding BTC only while its gate is open beat buy-and-hold
 * risk-adjusted in training and test — not the breakout entry conditions.
 *
 * Deliberately simple, no fitted value:
 * - entry: the regime gate is open (same three conditions as every long
 *   strategy: crypto RISK_ON, risk mode not DEFENSIVE/HIGH_RISK/UNKNOWN,
 *   confidence ≥ 60); no trend, breakout, momentum, volume or signal rule;
 * - protective stop: 2 × ATR(14) of the daily candles below the entry,
 *   tick-aligned — wide enough for normal daily swings;
 * - target: 4R, far enough that the regime exit decides most trades and
 *   R-008 (net 2R) holds after costs;
 * - exit on regime: `REGIME_EXIT_POLICY`;
 * - time backstop: 720 h (30 days); a still-open gate re-enters at the next
 *   scan.
 * Input validation, freshness, scope and candidate validity are LONG_V1's.
 */
export const CRYPTO_REGIME_LONG_V1_PARAMETERS = Object.freeze({
  key: CRYPTO_REGIME_LONG_V1_KEY,
  engineVersion: CRYPTO_REGIME_LONG_V1_ENGINE_VERSION,
  indicatorVersion: LONG.indicatorVersion,
  breakoutPolicyVersion: REGIME_ENTRY_POLICY_VERSION,
  freshnessPolicyVersion: LONG.freshnessPolicyVersion,
  priceTickPolicyVersion: LONG.priceTickPolicyVersion,
  // ── Scope ────────────────────────────────────────────────────────────────
  market: LONG.market,
  direction: LONG.direction,
  entryType: LONG.entryType,
  quoteCurrency: LONG.quoteCurrency,
  allowedSymbols: LONG.allowedSymbols,
  decisionTimeframe: LONG.decisionTimeframe,
  leverageAllowed: false,
  marginAllowed: false,
  futuresAllowed: false,
  llmUsed: false,
  // ── Input history and freshness (LONG_V1's validation) ─────────────────
  requestedCandlesPerTimeframe: LONG.requestedCandlesPerTimeframe,
  minimumCandlesPerTimeframe: LONG.minimumCandlesPerTimeframe,
  gapFreeWindow: LONG.gapFreeWindow,
  maxCandleAgeMs: LONG.maxCandleAgeMs,
  maxDataQualityAgeMs: LONG.maxDataQualityAgeMs,
  maxRegimeAgeMs: LONG.maxRegimeAgeMs,
  maxSignalAgeMs: LONG.maxSignalAgeMs,
  forbiddenCandleSources: LONG.forbiddenCandleSources,
  // ── Entry: the regime gate ───────────────────────────────────────────────
  regimeSource: CRYPTO_NATIVE_REGIME_SOURCE,
  regimeRequiredCryptoRegime: LONG.regimeRequiredCryptoRegime,
  regimeForbiddenRiskModes: LONG.regimeForbiddenRiskModes,
  regimeMinimumConfidence: LONG.regimeMinimumConfidence,
  blockingContextSeverities: LONG.blockingContextSeverities,
  // ── Price plan ───────────────────────────────────────────────────────────
  stopAtrPeriod1d: 14,
  stopAtrMultiple1d: "2",
  takeProfitRMultiple: "4",
  minimumRewardRisk: LONG.minimumRewardRisk,
  atrPeriod: LONG.atrPeriod,
  entryGapAtrMultiple: LONG.entryGapAtrMultiple,
  candidateTtlMs: LONG.candidateTtlMs,
  // ── Exit ─────────────────────────────────────────────────────────────────
  exitPolicy: REGIME_EXIT_POLICY,
  maxHoldHours: 720
} as const);

export const CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH = buildSpecificationHash(
  CRYPTO_REGIME_LONG_V1_PARAMETERS
);
