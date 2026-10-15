import { generateSyntheticSeries, type ReplayMarketData } from "@signalpilot/shadow-replay";
import {
  EVOLUTION_GATES_V1,
  EVOLUTION_GATES_V2,
  EVOLUTION_GATES_V3,
  type DailyBar,
  type EvolutionDataSplit,
  type EvolutionGates,
  type EvolutionGatesV2,
  type EvolutionGatesV3
} from "@signalpilot/evolution";

import { loadEvolutionConfig, type EvolutionWorkerConfig } from "../src/config.js";
import { createEvolutionDatabase, type EvolutionDb } from "../src/database.js";

/**
 * Only a database whose name ends in `_test` is ever touched: the evolution
 * tests delete every Evolution* row, which must never happen on a dev or
 * production database (the root .env points at the dev database).
 */
export function testDatabaseUrl(): string | null {
  const url = process.env.EVOLUTION_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
  if (url === null) return null;
  const name = new URL(url).pathname.replace(/^\//, "");
  return name.endsWith("_test") ? url : null;
}

export const DB_SKIP_REASON = "no *_test database configured (DATABASE_URL=postgresql://postgres@127.0.0.1:55432/signalpilot_test)";

export function testDatabase(): EvolutionDb | null {
  const url = testDatabaseUrl();
  return url === null ? null : createEvolutionDatabase(url);
}

export async function resetEvolutionTables(db: EvolutionDb): Promise<void> {
  await db.evolutionAuditEvent.deleteMany();
  await db.evolutionDataExposure.deleteMany();
  await db.evolutionBacktest.deleteMany();
  await db.evolutionCandidate.updateMany({ data: { parentCandidateId: null } });
  await db.evolutionCandidate.deleteMany();
  await db.evolutionHypothesis.deleteMany();
  await db.evolutionAiCall.deleteMany();
  await db.evolutionRun.deleteMany();
  await db.evolutionAgentState.deleteMany();
}

export function testConfig(overrides: Partial<EvolutionWorkerConfig> = {}): EvolutionWorkerConfig {
  return { ...loadEvolutionConfig({ EVOLUTION_AI_PROVIDER: "mock" }), databaseUrl: testDatabaseUrl(), hypothesesPerRun: 3, ...overrides };
}

/**
 * A compressed split over a synthetic market (all candles synthetic — the
 * test proves the machinery, never real performance).
 */
export const SYNTHETIC_SPLIT: EvolutionDataSplit = {
  key: "evolution-split-test",
  preregisteredOn: "2026-10-15",
  symbols: ["BTCUSDT", "ETHUSDT"],
  windows: {
    DISCOVERY: { key: "DISCOVERY", label: "Entdeckung", from: "2023-08-01T00:00:00.000Z", to: "2023-10-31T23:59:59.999Z", role: "SEARCH", aiVisibility: "METRICS", integrity: "IN_SAMPLE" },
    VALIDATION: { key: "VALIDATION", label: "Validierung", from: "2023-11-01T00:00:00.000Z", to: "2023-11-30T23:59:59.999Z", role: "SELECTION", aiVisibility: "VERDICT_ONLY", integrity: "IN_SAMPLE" },
    HOLDOUT: { key: "HOLDOUT", label: "Holdout", from: "2023-12-01T00:00:00.000Z", to: "2023-12-31T23:59:59.999Z", role: "CONFIRMATION", aiVisibility: "NEVER", integrity: "PREVIOUSLY_ANALYZED" }
  },
  forwardFrom: "2024-01-01T00:00:00.000Z",
  folds: [
    { key: "2023-08", window: "DISCOVERY", from: "2023-08-01T00:00:00.000Z", to: "2023-08-31T23:59:59.999Z" },
    { key: "2023-09", window: "DISCOVERY", from: "2023-09-01T00:00:00.000Z", to: "2023-09-30T23:59:59.999Z" },
    { key: "2023-10", window: "DISCOVERY", from: "2023-10-01T00:00:00.000Z", to: "2023-10-31T23:59:59.999Z" },
    { key: "2023-11", window: "VALIDATION", from: "2023-11-01T00:00:00.000Z", to: "2023-11-30T23:59:59.999Z" }
  ],
  priorExposure: []
};

/** Permissive thresholds so the test also walks through the final stage. */
export const PERMISSIVE_GATES: EvolutionGates = {
  ...EVOLUTION_GATES_V1,
  version: "evolution-gates-test",
  minTradesDiscovery: 0,
  minTradesValidation: 0,
  minProfitFactorDiscovery: 0,
  minAverageRDiscovery: -100,
  minProfitFactorValidation: 0,
  minAverageRValidation: -100,
  minStressedNetPnl: -1e9,
  minDiversifierSharpe: -100,
  minNeighbourAverageR: -100,
  minOutOfSampleAverageR: -100,
  minAverageRHoldout: -100,
  maxDrawdownPct: 100,
  minPositiveFoldRatio: 0,
  maxFoldConcentration: 1,
  maxCorrelationWithExisting: 2,
  diversifierCorrelation: 3,
  minWalkForwardEfficiency: -100,
  minHoldoutTrades: 0,
  minHoldoutProfitFactor: 0,
  maxFinalists: 1,
  neighbourCount: 1
};

/** Permissive v1 thresholds plus the real, pre-registered successor policy of v2. */
export const PERMISSIVE_GATES_V2: EvolutionGatesV2 = { ...PERMISSIVE_GATES, version: "evolution-gates-test-v2", successor: EVOLUTION_GATES_V2.successor };

/** Permissive v1 thresholds plus the real, pre-registered lineage policy of v3 (monthly family budget lifted). */
export const PERMISSIVE_GATES_V3: EvolutionGatesV3 = {
  ...PERMISSIVE_GATES,
  version: "evolution-gates-test-v3",
  lineage: { ...EVOLUTION_GATES_V3.lineage, maxScreeningsPerFamilyPerMonth: 1000 }
};

export function syntheticMarket(split: EvolutionDataSplit = SYNTHETIC_SPLIT): { market: ReplayMarketData; fingerprint: string; discoveryBars: Record<string, DailyBar[]> } {
  const start = Date.UTC(2023, 0, 1);
  const cutoff = Date.parse(split.forwardFrom);
  const hours = Math.floor((cutoff - start) / 3_600_000);
  const raw = [
    generateSyntheticSeries({ symbol: "BTCUSDT", startMs: start, hours, startPrice: 30000, seed: 3, baseVolume: 900 }),
    generateSyntheticSeries({ symbol: "ETHUSDT", startMs: start, hours, startPrice: 1800, seed: 5, baseVolume: 9000 })
  ];
  const series = raw.map((entry) => ({
    ...entry,
    candles: Object.fromEntries(Object.entries(entry.candles).map(([timeframe, candles]) => [timeframe, (candles ?? []).filter((candle) => candle.closeTime < cutoff)]))
  }));
  const lastDay = split.windows.DISCOVERY.to.slice(0, 10);
  const discoveryBars = Object.fromEntries(
    series.map((entry) => [
      entry.symbol,
      (entry.candles["1d"] ?? [])
        .map((candle) => ({ day: new Date(candle.openTime).toISOString().slice(0, 10), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) }))
        .filter((bar) => bar.day <= lastDay)
    ])
  );
  return { market: { origin: "SYNTHETIC", synthetic: true, series }, fingerprint: "synthetic-fingerprint", discoveryBars };
}

export const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined };
