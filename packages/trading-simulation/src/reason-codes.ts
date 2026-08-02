/**
 * Stable, machine-readable reason codes for the fill and exit simulation.
 *
 * Specification: docs/trading/07-shadow-execution-model.md.
 *
 * Append-only, like the other engine reason-code catalogues in this repo
 * (packages/trading-domain/src/types.ts, `TradingReasonCode`): never rename or
 * reuse a code, because it is persisted in `ShadowFill.assumptionsJson` and in
 * `TradingAuditEvent`.
 */

export const SimulationReasonCode = {
  // ── Market fill ───────────────────────────────────────────────────────────
  FILLED: "SIMULATION_FILLED",
  NO_LIQUIDITY: "SIMULATION_NO_LIQUIDITY",
  BELOW_MIN_QUANTITY: "SIMULATION_BELOW_MIN_QUANTITY",
  BELOW_MIN_NOTIONAL: "SIMULATION_BELOW_MIN_NOTIONAL",
  ABOVE_MAX_QUANTITY: "SIMULATION_ABOVE_MAX_QUANTITY",
  RESERVE_EXCEEDED: "SIMULATION_RESERVE_EXCEEDED",
  SELL_EXCEEDS_OPEN_QUANTITY: "SIMULATION_SELL_EXCEEDS_OPEN_QUANTITY",
  ENTRY_GAP_TOO_LARGE: "ENTRY_GAP_TOO_LARGE",
  INVALID_CANDLE: "SIMULATION_INVALID_CANDLE",
  INVALID_EXECUTION_PROFILE: "SIMULATION_INVALID_EXECUTION_PROFILE",
  INVALID_REQUESTED_QUANTITY: "SIMULATION_INVALID_REQUESTED_QUANTITY",
  ARITHMETIC_ERROR: "SIMULATION_ARITHMETIC_ERROR",

  // ── Exit resolution ──────────────────────────────────────────────────────
  STOP_GAP: "EXIT_STOP_GAP",
  TAKE_PROFIT_GAP: "EXIT_TAKE_PROFIT_GAP",
  STOP_AND_TAKE_PROFIT_IN_RANGE_STOP_FIRST: "EXIT_STOP_AND_TP_IN_RANGE_STOP_FIRST",
  STOP_IN_RANGE: "EXIT_STOP_IN_RANGE",
  TAKE_PROFIT_IN_RANGE: "EXIT_TAKE_PROFIT_IN_RANGE",
  MAX_HOLD_REACHED: "EXIT_MAX_HOLD_REACHED",
  NO_EXIT_TRIGGER: "EXIT_NO_TRIGGER",
  INVALID_EXIT_PLAN: "EXIT_INVALID_PLAN"
} as const;
export type SimulationReasonCode = (typeof SimulationReasonCode)[keyof typeof SimulationReasonCode];
