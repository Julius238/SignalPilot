/**
 * @signalpilot/shadow-replay — deterministic, look-ahead-free historical
 * replay of the shadow trading chain over stored candles. Pure: no database,
 * network, clock or `process.env`. Callers load candles and persist results.
 */

export * from "./contracts.js";
export * from "./research.js";
export * from "./replay.js";
export * from "./portfolio-replay.js";
export * from "./group-risk.js";
export * from "./synthetic.js";
export * from "./variants.js";
