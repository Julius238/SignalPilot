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

export const CRYPTO_MTF_BREAKOUT_V1_KEY = "CRYPTO_MTF_BREAKOUT_V1";

/** Semantic version of the engine implementation, not of the parameters. */
export const CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION = "crypto-mtf-breakout-v1/1.0.0";

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
  higherTimeframeForbiddenStatuses: Object.freeze(["AVOID", "NO_EDGE"] as const),
  multiTimeframeRequiredAlignment: "BULLISH_ALIGNED",
  multiTimeframeMinimumAlignmentScore: "0.65",
  regimeRequiredCryptoRegime: "RISK_ON",
  regimeForbiddenRiskModes: Object.freeze(["DEFENSIVE", "HIGH_RISK", "UNKNOWN"] as const),
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

export type CryptoMtfBreakoutV1Parameters = typeof CRYPTO_MTF_BREAKOUT_V1_PARAMETERS;

/**
 * SHA-256 over the canonical specification. Written to every candidate and
 * compared against `StrategyVersion.specificationHash` before evaluation.
 */
export const CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH = buildSpecificationHash(
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS
);
