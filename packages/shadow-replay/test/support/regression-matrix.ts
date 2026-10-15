import { canonicalHash } from "@signalpilot/trading-domain";

import {
  generateBreakoutScenario,
  generateSyntheticSeries,
  type ReplayConfig,
  type ReplayHooks,
  type ReplayMarketData,
  type ReplayResult
} from "../../src/index.js";
import { forcedCandidates } from "./forced-candidates.js";

/**
 * Fixed single-strategy replays whose results were recorded before the replay
 * was split into the reusable portfolio book (`portfolio-book.ts`). Every
 * case must keep its exact output hash and full-result hash: the refactor and
 * the portfolio replay may not change a single existing backtest.
 */

const START = Date.UTC(2024, 0, 1);
const START_V = Date.UTC(2025, 0, 1);
const DAY = 86_400_000;

export const BTC_PROFILE = {
  tickSize: "0.01",
  stepSize: "0.00001",
  minQuantity: "0.00001",
  minNotional: "10",
  maxQuantity: null,
  feeBps: 10,
  fullSpreadBps: 2,
  slippageBps: 3,
  maxParticipationRate: "0.01"
} as const;

export const ETH_PROFILE = { ...BTC_PROFILE, stepSize: "0.0001", minQuantity: "0.0001" } as const;

export function syntheticMarket(days: number, btcSeed = 7, ethSeed = 11): ReplayMarketData {
  return {
    origin: "SYNTHETIC",
    synthetic: true,
    series: [
      generateSyntheticSeries({ symbol: "BTCUSDT", startMs: START, hours: days * 24, startPrice: 40000, seed: btcSeed, baseVolume: 900 }),
      generateSyntheticSeries({ symbol: "ETHUSDT", startMs: START, hours: days * 24, startPrice: 2300, seed: ethSeed, baseVolume: 9000 })
    ]
  };
}

function breakoutMarket(): ReplayMarketData {
  const scenario = (symbol: string, startPrice: number, assetType: "CRYPTO" | "ETF", seed: number) =>
    generateBreakoutScenario({
      symbol,
      assetType,
      startMs: START_V,
      startPrice,
      seed,
      events: [{ breakoutAtMs: START_V + 230 * DAY + 8 * 3_600_000, outcome: "WIN" }]
    });
  return {
    origin: "SYNTHETIC",
    synthetic: true,
    series: [
      scenario("BTCUSDT", 60000, "CRYPTO", 1),
      scenario("ETHUSDT", 3000, "CRYPTO", 2),
      scenario("SPY", 560, "ETF", 3),
      scenario("QQQ", 480, "ETF", 4),
      scenario("IWM", 220, "ETF", 5)
    ]
  };
}

export function baseConfig(overrides: Partial<ReplayConfig> = {}): ReplayConfig {
  return {
    symbol: "BTCUSDT",
    strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1",
    mode: "SIGNAL_EDGE",
    regimePolicy: "CRYPTO_ONLY",
    startingCash: "10000",
    executionProfile: BTC_PROFILE,
    codeVersion: "test",
    ...overrides
  };
}

export const everyThirdMorning = forcedCandidates({
  every: (closeMs) => new Date(closeMs + 1).getUTCHours() === 9 && Math.floor(closeMs / DAY) % 3 === 0,
  stopPct: "0.022"
});

export const twiceDaily = forcedCandidates({ every: (closeMs) => [9, 21].includes(new Date(closeMs + 1).getUTCHours()), stopPct: "0.022" });

export interface RegressionCase {
  readonly key: string;
  readonly market: () => ReplayMarketData;
  readonly config: ReplayConfig;
  readonly hooks: ReplayHooks;
}

let standard: ReplayMarketData | null = null;
let streaky: ReplayMarketData | null = null;
let breakout: ReplayMarketData | null = null;
const standardMarket = () => (standard ??= syntheticMarket(245));
const streakyMarket = () => (streaky ??= syntheticMarket(245, 29, 33));
const breakoutScenario = () => (breakout ??= breakoutMarket());

export const REGRESSION_CASES: readonly RegressionCase[] = [
  { key: "R1-signal-edge-forced", market: standardMarket, config: baseConfig(), hooks: { evaluate: everyThirdMorning } },
  { key: "R2-spec-forced", market: standardMarket, config: baseConfig({ mode: "SPEC" }), hooks: { evaluate: everyThirdMorning } },
  { key: "R3-spec-kill-switch", market: streakyMarket, config: baseConfig({ mode: "SPEC" }), hooks: { evaluate: twiceDaily } },
  {
    key: "R4-spec-regime-exit-shut",
    market: standardMarket,
    config: baseConfig({ mode: "SPEC" }),
    hooks: { evaluate: everyThirdMorning, regimeExit: { enabled: true, gateOpen: () => false } }
  },
  {
    key: "R5-spec-eth-profile",
    market: standardMarket,
    config: baseConfig({ mode: "SPEC", symbol: "ETHUSDT", executionProfile: ETH_PROFILE }),
    hooks: { evaluate: everyThirdMorning }
  },
  {
    key: "R6-spec-regime-long-native",
    market: standardMarket,
    config: baseConfig({ mode: "SPEC", strategyKey: "CRYPTO_REGIME_LONG_V1", regimePolicy: "CRYPTO_NATIVE_V1" }),
    hooks: {}
  },
  {
    key: "R7-spec-trend-core-native",
    market: standardMarket,
    config: baseConfig({ mode: "SPEC", strategyKey: "CRYPTO_TREND_CORE_LONG_V1", regimePolicy: "CRYPTO_NATIVE_V1" }),
    hooks: {}
  },
  {
    key: "R8-spec-variant-price-only",
    market: breakoutScenario,
    config: baseConfig({ mode: "SPEC", regimePolicy: "AS_SPECIFIED", from: new Date(START_V + 228 * DAY).toISOString(), variant: "PRICE_ONLY" }),
    hooks: {}
  },
  {
    key: "R9-spec-window-and-split",
    market: standardMarket,
    config: baseConfig({
      mode: "SPEC",
      from: new Date(START + 215 * DAY).toISOString(),
      to: new Date(START + 240 * DAY).toISOString(),
      trainTestSplitAt: new Date(START + 230 * DAY).toISOString()
    }),
    hooks: { evaluate: everyThirdMorning }
  },
  {
    key: "R10-spec-bootstrap-costs-all-rejected",
    market: standardMarket,
    config: baseConfig({ mode: "SPEC", executionProfile: { ...BTC_PROFILE, fullSpreadBps: 10, slippageBps: 10 } }),
    hooks: { evaluate: everyThirdMorning }
  }
];

/** Hash over every field of a replay result, not only the trades the output hash covers. */
export const fullResultHash = (result: ReplayResult): string => canonicalHash(result);
