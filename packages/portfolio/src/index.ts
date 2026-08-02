/**
 * @signalpilot/portfolio — pure ledger, reservation, position and valuation
 * arithmetic for SignalPilot Shadow Trading v1.
 *
 * Boundary rule (docs/trading/02-shadow-trading-target-architecture.md, module
 * table): this package must never decide a strategy, create an order or own a
 * database transaction. It only folds confirmed domain events into ledger
 * drafts and cache projections; the caller (the worker) commits them
 * atomically.
 */

export * from "./contracts.js";
export * from "./ledger.js";
export * from "./reservations.js";
export * from "./positions.js";
export * from "./valuation.js";
export * from "./invariants.js";
