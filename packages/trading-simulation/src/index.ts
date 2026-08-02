/**
 * @signalpilot/trading-simulation — pure market-fill and exit simulation for
 * SignalPilot Shadow Trading v1.
 *
 * Boundary rule (docs/trading/02-shadow-trading-target-architecture.md, module
 * table): this package must never call a provider/exchange, mutate a
 * portfolio directly, or use randomness without a stored seed. It has no
 * database, network, `process.env` or system-clock dependency; every
 * timestamp it reasons about arrives inside a candle or a plan.
 */

export * from "./contracts.js";
export * from "./reason-codes.js";
export * from "./rounding.js";
export * from "./market-fill-v1.js";
export * from "./exit-resolution-v1.js";
