/**
 * Wiring shared by the CLI and the scheduler: provider, backtest pool and
 * the snapshot market of a cycle.
 */

import { EVOLUTION_DATA_SPLIT_V1, MockResearchProvider, type ResearchAiProvider } from "@signalpilot/evolution";

import { AnthropicResearchProvider } from "./ai/anthropicProvider.js";
import { ChildProcessBacktestPool } from "./backtest/pool.js";
import type { EvolutionWorkerConfig } from "./config.js";
import type { MarketInfo } from "./cycle/researchCycle.js";
import { dailyBars, loadEvolutionMarket } from "./market/snapshots.js";

export function createProvider(config: EvolutionWorkerConfig): ResearchAiProvider {
  if (config.provider === "mock") return new MockResearchProvider();
  return new AnthropicResearchProvider({
    apiKey: config.anthropicApiKey ?? undefined,
    maxRetries: config.aiMaxRetries,
    timeoutMs: config.aiTimeoutMs,
    refusalFallback: config.refusalFallback
  });
}

export function createBacktestPool(config: EvolutionWorkerConfig) {
  return new ChildProcessBacktestPool({
    snapshotDir: config.snapshotDir,
    concurrency: config.backtestConcurrency,
    timeoutMs: config.backtestTimeoutMs,
    maxOldSpaceMb: config.backtestMaxOldSpaceMb
  });
}

/** Loads the snapshot once in the main process for its fingerprint and the discovery-window daily bars. */
export async function loadMarketInfo(config: EvolutionWorkerConfig): Promise<MarketInfo> {
  const snapshot = await loadEvolutionMarket(config.snapshotDir, EVOLUTION_DATA_SPLIT_V1);
  const lastDay = EVOLUTION_DATA_SPLIT_V1.windows.DISCOVERY.to.slice(0, 10);
  return {
    dir: snapshot.dir,
    fingerprint: snapshot.fingerprint,
    cutoffAt: snapshot.cutoffAt,
    files: snapshot.files,
    discoveryBars: Object.fromEntries(EVOLUTION_DATA_SPLIT_V1.symbols.map((symbol) => [symbol, dailyBars(snapshot.market, symbol, lastDay)]))
  };
}
