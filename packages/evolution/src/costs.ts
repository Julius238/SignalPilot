/**
 * Cost and instrument model of every evolution backtest.
 *
 * The AI can never change costs, fills, sizing or risk rules: they are fixed
 * here and equal the official forward test's frozen cost profile
 * `BINANCE_SPOT_VIP0_ESTIMATE_V1` (10 bp fee per side, 2 bp full spread, 3 bp
 * slippage per side; docs/trading/research/official-forward-test-v1.md).
 * A candidate that only works with cheaper execution is not a candidate.
 */

import type { ReplayExecutionProfile } from "@signalpilot/shadow-replay";

export const EVOLUTION_COST_MODEL_V1 = Object.freeze({
  key: "BINANCE_SPOT_VIP0_ESTIMATE_V1",
  feeBps: 10,
  fullSpreadBps: 2,
  slippageBps: 3,
  maxParticipationRate: "0.010000000000"
});

/**
 * Cost stress: every execution cost (fees, spread, slippage) multiplied by
 * this factor. Applied analytically to the same simulated trades, see
 * `stressedNetPnl` — it does not re-simulate risk-engine rejections that the
 * higher costs would cause, which can only remove trades.
 */
export const EVOLUTION_COST_STRESS_MULTIPLIER = 2;

/**
 * Instrument grid of the replay. Same values as the shadow bootstrap
 * (`BOOTSTRAP_EXECUTION_PROFILES` in apps/trading-worker/src/jobs/shadowBootstrap.ts);
 * duplicated on purpose so the research worker never imports the trading worker.
 */
export const EVOLUTION_INSTRUMENTS: Readonly<
  Record<string, Pick<ReplayExecutionProfile, "tickSize" | "stepSize" | "minQuantity" | "minNotional" | "maxQuantity">>
> = Object.freeze({
  BTCUSDT: {
    tickSize: "0.010000000000",
    stepSize: "0.000010000000",
    minQuantity: "0.000010000000",
    minNotional: "10.000000000000",
    maxQuantity: null
  },
  ETHUSDT: {
    tickSize: "0.010000000000",
    stepSize: "0.000100000000",
    minQuantity: "0.000100000000",
    minNotional: "10.000000000000",
    maxQuantity: null
  }
});

/** Replay execution profile of a symbol under the frozen cost model. */
export function evolutionExecutionProfile(symbol: string): ReplayExecutionProfile {
  const instrument = EVOLUTION_INSTRUMENTS[symbol];
  if (instrument === undefined) throw new Error(`No evolution instrument profile for ${symbol}.`);
  return {
    ...instrument,
    feeBps: EVOLUTION_COST_MODEL_V1.feeBps,
    fullSpreadBps: EVOLUTION_COST_MODEL_V1.fullSpreadBps,
    slippageBps: EVOLUTION_COST_MODEL_V1.slippageBps,
    maxParticipationRate: EVOLUTION_COST_MODEL_V1.maxParticipationRate
  };
}

/**
 * Round-trip execution cost as a fraction of the entry price: fee and
 * slippage on both sides plus the full spread (half on entry, half on exit).
 */
export function roundTripCostFraction(model: { feeBps: number; fullSpreadBps: number; slippageBps: number } = EVOLUTION_COST_MODEL_V1): number {
  return (2 * model.feeBps + model.fullSpreadBps + 2 * model.slippageBps) / 10_000;
}

/**
 * Smallest stop distance (fraction of entry) for which a plan with gross
 * target `takeProfitR` still clears the risk engine's net 2R minimum
 * (`R-008-MIN-RR`): net RR = (TP·d − c) / (d + c) ≥ 2  ⇔  d ≥ 3c / (TP − 2).
 * Infinity when the gross target itself is at or below 2R.
 */
export function minimumStopDistanceForNet2R(takeProfitR: number, costFraction: number = roundTripCostFraction()): number {
  if (!(takeProfitR > 2)) return Number.POSITIVE_INFINITY;
  return (3 * costFraction) / (takeProfitR - 2);
}

/** Every execution cost of a simulated trade (quote currency). */
export function executionCostOf(trade: { fees: number; spreadCost: number; slippageCost: number }): number {
  return trade.fees + trade.spreadCost + trade.slippageCost;
}

/** Net PnL of the same trade if every execution cost were `multiplier` times higher. */
export function stressedNetPnl(
  trade: { netPnl: number; fees: number; spreadCost: number; slippageCost: number },
  multiplier: number = EVOLUTION_COST_STRESS_MULTIPLIER
): number {
  return trade.netPnl - (multiplier - 1) * executionCostOf(trade);
}
