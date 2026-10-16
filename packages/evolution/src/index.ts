/**
 * @signalpilot/evolution — pure core of the SignalPilot Evolution Engine V1
 * (docs/trading/20-evolution-engine.md).
 *
 * Research only: candidate genomes, the pre-registered data split, metrics,
 * gates, walk-forward, market-condition analysis, the AI research context,
 * prompts and parsing, pricing and budget rules and a deterministic mock
 * provider. No database, network, clock, `process.env` or trading path: the
 * worker app (apps/evolution-worker) owns I/O, the trading worker never
 * imports this package.
 */

export const EVOLUTION_ENGINE_VERSION = "evolution-engine-v1/1.0.0";

export * from "./ai.js";
export * from "./analysis.js";
export * from "./context.js";
export * from "./costs.js";
export * from "./decision.js";
export * from "./gate-versions.js";
export * from "./gates.js";
export * from "./gates-v2.js";
export * from "./gates-v3.js";
export * from "./gates-v4.js";
export * from "./family-regime-pullback.js";
export * from "./genome.js";
export * from "./lineage.js";
export * from "./metrics.js";
export * from "./mock-provider.js";
export * from "./paired.js";
export * from "./portfolio.js";
export * from "./portfolio-metrics.js";
export * from "./prompt.js";
export * from "./report.js";
export * from "./sandbox.js";
export * from "./split.js";
export * from "./walk-forward.js";
