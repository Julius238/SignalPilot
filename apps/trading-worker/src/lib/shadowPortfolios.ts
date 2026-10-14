/**
 * The virtual shadow portfolios.
 *
 * Each strategy under forward test trades in its own portfolio with its own
 * ledger, session, kill switch and performance, from the same starting cash
 * and against the same market data, execution profiles and risk limit set.
 * Nothing in one portfolio's state can block, size or close the other's
 * trades (docs/trading/research/2026-10-14-challenger-regime-long-v1.md).
 *
 * A *portfolio set* says where each forward-tested strategy trades in one
 * deployment. The strategy versions are identical in every set; only the
 * portfolio — and with it the capital history — differs:
 *
 *   - LOCAL_SHAKEDOWN: the development-machine system test (SHADOW_V1,
 *     SHADOW_CHALLENGER_V1), never an official result;
 *   - OFFICIAL_V1: the official 24/7 forward test on the server, in two
 *     portfolios that have never held anything else, so it starts at exactly
 *     10 000 USDT whatever an older deployment left behind.
 */

export const SHADOW_PORTFOLIO_KEY = "SHADOW_V1";
export const SHADOW_CHALLENGER_PORTFOLIO_KEY = "SHADOW_CHALLENGER_V1";
export const OFFICIAL_TREND_CORE_PORTFOLIO_KEY = "OFFICIAL_TREND_CORE_LONG_V1";
export const OFFICIAL_REGIME_LONG_PORTFOLIO_KEY = "OFFICIAL_REGIME_LONG_V1";

export const SHADOW_PORTFOLIO_KEYS = Object.freeze([
  SHADOW_PORTFOLIO_KEY,
  SHADOW_CHALLENGER_PORTFOLIO_KEY,
  OFFICIAL_TREND_CORE_PORTFOLIO_KEY,
  OFFICIAL_REGIME_LONG_PORTFOLIO_KEY
] as const);
export type ShadowPortfolioKey = (typeof SHADOW_PORTFOLIO_KEYS)[number];

export const SHADOW_PORTFOLIO_NAMES: Readonly<Record<ShadowPortfolioKey, string>> = Object.freeze({
  SHADOW_V1: "SignalPilot Shadow Portfolio v1",
  SHADOW_CHALLENGER_V1: "SignalPilot Shadow Challenger Portfolio v1",
  OFFICIAL_TREND_CORE_LONG_V1: "Official forward test: CRYPTO_TREND_CORE_LONG_V1",
  OFFICIAL_REGIME_LONG_V1: "Official forward test: CRYPTO_REGIME_LONG_V1"
});

export function isShadowPortfolioKey(value: string): value is ShadowPortfolioKey {
  return (SHADOW_PORTFOLIO_KEYS as readonly string[]).includes(value);
}

export const PORTFOLIO_SETS = Object.freeze({
  LOCAL_SHAKEDOWN: Object.freeze({
    CRYPTO_TREND_CORE_LONG_V1: SHADOW_PORTFOLIO_KEY,
    CRYPTO_REGIME_LONG_V1: SHADOW_CHALLENGER_PORTFOLIO_KEY
  }),
  OFFICIAL_V1: Object.freeze({
    CRYPTO_TREND_CORE_LONG_V1: OFFICIAL_TREND_CORE_PORTFOLIO_KEY,
    CRYPTO_REGIME_LONG_V1: OFFICIAL_REGIME_LONG_PORTFOLIO_KEY
  })
} as const satisfies Record<string, Record<string, ShadowPortfolioKey>>);
export type PortfolioSetKey = keyof typeof PORTFOLIO_SETS;
export type ForwardTestStrategyKey = keyof (typeof PORTFOLIO_SETS)["OFFICIAL_V1"];

export function isPortfolioSetKey(value: string): value is PortfolioSetKey {
  return Object.prototype.hasOwnProperty.call(PORTFOLIO_SETS, value);
}

/**
 * `TRADING_PORTFOLIO_SET` from the environment; LOCAL_SHAKEDOWN when unset so
 * an existing local installation keeps its portfolios. An unknown value is
 * refused rather than guessed.
 */
export function resolvePortfolioSet(
  env: Readonly<Record<string, string | undefined>> = process.env
): PortfolioSetKey {
  const raw = (env.TRADING_PORTFOLIO_SET ?? "").trim();
  if (raw === "") return "LOCAL_SHAKEDOWN";
  if (!isPortfolioSetKey(raw)) {
    throw new Error(`TRADING_PORTFOLIO_SET must be one of ${Object.keys(PORTFOLIO_SETS).join(", ")}, got ${JSON.stringify(raw)}.`);
  }
  return raw;
}
