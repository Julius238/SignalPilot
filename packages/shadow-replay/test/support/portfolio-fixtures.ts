import type { StrategyEvaluationResultV1, StrategyInputSnapshotV1 } from "@signalpilot/strategy-engine";

import type { PortfolioMemberConfig, PortfolioReplayConfig } from "../../src/index.js";
import { BTC_PROFILE, ETH_PROFILE } from "./regression-matrix.js";

export type TradedSymbol = "BTCUSDT" | "ETHUSDT";

const PROFILES: Readonly<Record<TradedSymbol, PortfolioMemberConfig["symbols"][number]["executionProfile"]>> = {
  BTCUSDT: BTC_PROFILE,
  ETHUSDT: ETH_PROFILE
};

/** A strategy portfolio of the long breakout family whose strategy step is a test double. */
export function memberOf(
  key: string,
  symbols: readonly TradedSymbol[],
  evaluate: (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1,
  overrides: Partial<PortfolioMemberConfig> = {}
): PortfolioMemberConfig {
  return {
    key,
    strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1",
    startingCash: "10000",
    symbols: symbols.map((symbol) => ({ symbol, executionProfile: PROFILES[symbol] })),
    hooks: { evaluate },
    ...overrides
  };
}

export function portfolioConfig(members: readonly PortfolioMemberConfig[], overrides: Partial<PortfolioReplayConfig> = {}): PortfolioReplayConfig {
  return {
    members,
    reserveCash: "0",
    regimePolicy: "CRYPTO_ONLY",
    groupRisk: "GROUP_RISK_V1",
    codeVersion: "test",
    ...overrides
  };
}

/** Wraps a strategy double so that its candidates carry another strategy key (for example an unapproved one). */
export function withStrategyKey(
  evaluate: (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1,
  strategyKey: string
): (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1 {
  return (snapshot) => {
    const result = evaluate(snapshot);
    if (result.outcome !== "CANDIDATE") return result;
    return { ...result, strategyKey, candidate: { ...result.candidate, strategyKey } } as StrategyEvaluationResultV1;
  };
}
