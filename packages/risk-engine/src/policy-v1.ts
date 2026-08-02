/**
 * Pinned risk policy of shadow trading v1.
 *
 * Specification:
 *   docs/trading/06-risk-engine-specification.md, "Verbindliches Limitset v1",
 *   "Portfolio-Konsistenz und Toleranz", "Correlation v1"
 *   docs/trading/decisions/0003-deterministic-versioned-engines.md
 *
 * These are the values a `RiskLimitSet` row must carry. The engine still reads
 * the limits from the snapshot — a stored, versioned rule book is the source of
 * truth — but it refuses to run against a set whose numbers contradict this
 * pinned reference, so an edited row cannot silently loosen a limit.
 */

import { buildSpecificationHash } from "@signalpilot/trading-domain";

export const RISK_ENGINE_VERSION = "risk-engine-v1/1.0.0";
export const RISK_RULE_SET_VERSION = "risk-rules-v1/1.0.0";
export const RISK_SIZING_POLICY_VERSION = "risk-sizing-v1/1.0.0";
export const RISK_COST_POLICY_VERSION = "risk-cost-v1/1.0.0";

export const RISK_LIMIT_SET_KEY = "SHADOW_V1";
export const RISK_LIMIT_SET_VERSION = 1;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Comparison tolerance for money invariants (docs/trading/06,
 * "Vergleichstoleranz ist `min(0.00000001 USDT, kleinste im Execution Profile
 * belegte Quote-Einheit)`"). With `Decimal(30,12)` the smallest representable
 * unit is `1e-12`, so `1e-8` is the binding value. It is a comparison
 * threshold only and must never be booked as a P&L correction.
 */
export const PORTFOLIO_TOLERANCE = "0.00000001";

/** Fixed correlation group for v1 (docs/trading/06, "Correlation v1"). */
export const CRYPTO_MAJOR_GROUP_KEY = "CRYPTO_MAJOR";
export const CRYPTO_MAJOR_MEMBERS: readonly string[] = Object.freeze(["BTCUSDT", "ETHUSDT"]);

/**
 * Freshness ceilings for `R-016-DATA-FRESHNESS`. The candle and data-quality
 * values match the strategy's pre-validation so a candidate cannot pass one
 * engine and be stale for the other.
 */
export const RISK_FRESHNESS_LIMITS_MS = Object.freeze({
  candle1h: 2 * HOUR_MS + 15 * MINUTE_MS,
  candle4h: 8 * HOUR_MS + 15 * MINUTE_MS,
  candle1d: 48 * HOUR_MS + 15 * MINUTE_MS,
  dataQuality: 2 * HOUR_MS,
  regime: 26 * HOUR_MS,
  portfolioSnapshot: 5 * MINUTE_MS
});

/** Minimum closed candles per timeframe for `R-017-DATA-QUALITY`. */
export const RISK_MINIMUM_CANDLES = 200;

/** Regime conditions for `R-020-REGIME`. */
export const RISK_REGIME_POLICY = Object.freeze({
  requiredCryptoRegime: "RISK_ON",
  forbiddenRiskModes: Object.freeze(["DEFENSIVE", "HIGH_RISK", "UNKNOWN"] as const),
  minimumConfidence: 60
});

/** Instrument scope for `R-004-ASSET-SCOPE`. */
export const RISK_ASSET_SCOPE = Object.freeze({
  allowedSymbols: Object.freeze(["BTCUSDT", "ETHUSDT"] as const),
  assetType: "CRYPTO",
  quoteCurrency: "USDT"
});

/** The binding limit numbers (docs/trading/06, "Verbindliches Limitset v1"). */
export const RISK_LIMIT_SET_V1 = Object.freeze({
  key: RISK_LIMIT_SET_KEY,
  version: RISK_LIMIT_SET_VERSION,
  scope: "PORTFOLIO",
  maxRiskPerTradePct: "0.0025",
  maxDailyLossPct: "0.01",
  minRewardRisk: "2",
  maxOpenPositions: 2,
  maxNewTradesPerDay: 4,
  maxConsecutiveLosses: 3,
  maxGrossExposurePct: "0.4",
  maxAssetExposurePct: "0.2",
  maxCorrelatedExposurePct: "0.3",
  maxSpreadBps: 20,
  maxSlippageBps: 15
});

/** Everything that changes a verdict, hashed into one policy identity. */
export const RISK_POLICY_V1 = Object.freeze({
  riskEngineVersion: RISK_ENGINE_VERSION,
  ruleSetVersion: RISK_RULE_SET_VERSION,
  sizingPolicyVersion: RISK_SIZING_POLICY_VERSION,
  costPolicyVersion: RISK_COST_POLICY_VERSION,
  limitSet: RISK_LIMIT_SET_V1,
  freshnessLimitsMs: RISK_FRESHNESS_LIMITS_MS,
  minimumCandles: RISK_MINIMUM_CANDLES,
  regime: RISK_REGIME_POLICY,
  assetScope: RISK_ASSET_SCOPE,
  correlationGroup: Object.freeze({ key: CRYPTO_MAJOR_GROUP_KEY, members: CRYPTO_MAJOR_MEMBERS }),
  portfolioTolerance: PORTFOLIO_TOLERANCE,
  direction: "LONG",
  entryType: "MARKET",
  leverageAllowed: false,
  marginAllowed: false,
  llmUsed: false
});

/** SHA-256 over the canonical policy; written to every assessment. */
export const RISK_POLICY_HASH = buildSpecificationHash(RISK_POLICY_V1);

/** Specification hash a stored `RiskLimitSet` row must carry to be accepted. */
export const RISK_LIMIT_SET_SPECIFICATION_HASH = buildSpecificationHash(RISK_LIMIT_SET_V1);
