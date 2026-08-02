/**
 * @signalpilot/strategy-engine — deterministic strategy evaluation for
 * SignalPilot Shadow Trading v1.
 *
 * The package evaluates a complete, immutable `StrategyInputSnapshotV1` and
 * returns either a `TradeCandidateDraftV1` or a structured refusal. It must
 * never read a database, call the network, read `process.env`, look at the
 * system clock or consult an LLM (docs/trading/02-shadow-trading-target-architecture.md,
 * module table; docs/trading/decisions/0003-deterministic-versioned-engines.md).
 *
 * It also never sizes a position: quantity, equity and risk budget belong to the
 * risk engine (docs/trading/05, "Positionsgrößenformel").
 */

export * from "./contracts.js";
export * from "./reason-codes.js";
export * from "./specification-v1.js";
export * from "./indicators-v1.js";
export * from "./validate-input.js";
export * from "./crypto-mtf-breakout-v1.js";
export * from "./registry.js";
