/**
 * Shadow-trading performance engine (P8).
 *
 * Kept in its own namespace inside `@signalpilot/performance-intelligence`
 * because it shares the package's purpose (deterministic performance
 * reporting) but never its data source: the legacy report at the package root
 * measures `PaperSignalEvaluation`s, this one measures closed
 * `ShadowPosition`s. The two never mix (docs/trading/03,
 * `StrategyPerformance`: "PaperSignalEvaluation is never an input").
 */

export * from "./contracts.js";
export * from "./metrics.js";
