/**
 * The virtual shadow portfolios: the champion's and the challenger's.
 *
 * Each strategy under forward test trades in its own portfolio with its own
 * ledger, session, kill switch and performance, from the same starting cash
 * and against the same market data, execution profiles and risk limit set.
 * Nothing in one portfolio's state can block, size or close the other's
 * trades (docs/trading/research/2026-10-14-challenger-regime-long-v1.md).
 */

export const SHADOW_PORTFOLIO_KEY = "SHADOW_V1";
export const SHADOW_CHALLENGER_PORTFOLIO_KEY = "SHADOW_CHALLENGER_V1";

export const SHADOW_PORTFOLIO_KEYS = Object.freeze([
  SHADOW_PORTFOLIO_KEY,
  SHADOW_CHALLENGER_PORTFOLIO_KEY
] as const);
export type ShadowPortfolioKey = (typeof SHADOW_PORTFOLIO_KEYS)[number];

export const SHADOW_PORTFOLIO_NAMES: Readonly<Record<ShadowPortfolioKey, string>> = Object.freeze({
  SHADOW_V1: "SignalPilot Shadow Portfolio v1",
  SHADOW_CHALLENGER_V1: "SignalPilot Shadow Challenger Portfolio v1"
});

export function isShadowPortfolioKey(value: string): value is ShadowPortfolioKey {
  return (SHADOW_PORTFOLIO_KEYS as readonly string[]).includes(value);
}
