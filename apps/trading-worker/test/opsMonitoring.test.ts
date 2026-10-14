/**
 * 24/7 operations: the shared health model and the restart consistency check.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectOpsHealth } from "../src/lib/opsHealth.js";
import { compareConsistency, type ConsistencySnapshot } from "../src/jobs/opsConsistency.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const NOW = new Date("2026-10-15T12:10:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function seedHealthy() {
  const { database, tables } = createFakeExecutionDatabase();
  for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
    tables.get("candle")!.create({
      data: { symbol, timeframe: "1h", source: "BINANCE", openTime: minutesAgo(70), closeTime: new Date(NOW.getTime() - 10 * 60_000 - 1) }
    });
  }
  for (const [jobName, minutes] of [
    ["fetchCryptoCandles", 10],
    ["calculateMarketRegime", 10],
    ["shadowGenerateCandidates", 5],
    ["shadowAssessRisk", 1],
    ["shadowCreateOrders", 1],
    ["shadowProcessFills", 2],
    ["shadowMonitorPositions", 2],
    ["shadowReconcilePortfolio", 4],
    ["shadowPerformanceRefresh", 55],
    ["arenaEvaluate", 50],
    ["shadowStartTradingDay", 600]
  ] as const) {
    tables.get("botRun")!.create({ data: { jobName, status: "SUCCESS", startedAt: minutesAgo(minutes), finishedAt: minutesAgo(minutes) } });
  }
  const portfolio = tables.get("portfolio")!.create({ data: { key: "OFFICIAL_TREND_CORE_LONG_V1", name: "p", status: "ACTIVE" } });
  const session = tables.get("tradingSession")!.create({
    data: { sessionKey: "s", portfolioId: portfolio.id, status: "SHADOW_ACTIVE", killSwitchEngaged: false, killReasonCode: null }
  });
  return { database, tables, portfolio, session };
}

describe("ops health", () => {
  it("is green when data, every job, sessions and kill switches are in order", async () => {
    const { database } = seedHealthy();
    const health = await collectOpsHealth(database as never, NOW);
    assert.equal(health.ok, true, JSON.stringify(health, null, 2));
  });

  it("flags stale or non-Binance market data, a stalled job and an engaged kill switch", async () => {
    const { database, tables, session } = seedHealthy();
    const btc = tables.get("candle")!.rows.find((row) => row.symbol === "BTCUSDT")!;
    btc.closeTime = minutesAgo(200);
    tables.get("candle")!.rows.find((row) => row.symbol === "ETHUSDT")!.source = "SYNTHETIC";
    tables.get("botRun")!.rows.find((row) => row.jobName === "shadowAssessRisk")!.startedAt = minutesAgo(30);
    session.killSwitchEngaged = true;
    session.killReasonCode = "R-021-CONSECUTIVE_LOSSES";

    const health = await collectOpsHealth(database as never, NOW);
    assert.equal(health.ok, false);
    assert.deepEqual(
      health.marketData.map((entry) => [entry.symbol, entry.problem]),
      [
        ["BTCUSDT", "STALE"],
        ["ETHUSDT", "NOT_BINANCE"]
      ]
    );
    assert.deepEqual(
      health.jobs.filter((job) => !job.ok).map((job) => job.jobName),
      ["shadowAssessRisk"]
    );
    assert.equal(health.sessions[0]?.killReasonCode, "R-021-CONSECUTIVE_LOSSES");
  });

  it("does not report a job that never ran as stalled", async () => {
    const { database, tables } = seedHealthy();
    const rows = tables.get("botRun")!.rows;
    rows.splice(rows.findIndex((row) => row.jobName === "arenaEvaluate"), 1);
    const health = await collectOpsHealth(database as never, NOW);
    const arena = health.jobs.find((job) => job.jobName === "arenaEvaluate")!;
    assert.deepEqual([arena.neverRan, arena.ok], [true, true]);
  });
});

function snapshot(overrides: Partial<ConsistencySnapshot> = {}): ConsistencySnapshot {
  return {
    takenAt: "2026-10-15T12:00:00.000Z",
    portfolios: [
      {
        portfolioKey: "OFFICIAL_TREND_CORE_LONG_V1",
        status: "ACTIVE",
        ledgerSequence: 4,
        ledgerEntries: 4,
        ledgerCash: "9980.000000000000",
        cacheCash: "9980.000000000000",
        equity: "10012.000000000000",
        orders: { FILLED: 1 },
        fills: 1,
        duplicateFillCandles: 0,
        positions: { OPEN: 1 },
        session: { id: "s1", status: "SHADOW_ACTIVE", killSwitchEngaged: false, version: 3 },
        enabledStrategyVersions: ["sv-trend"]
      },
      {
        portfolioKey: "OFFICIAL_REGIME_LONG_V1",
        status: "ACTIVE",
        ledgerSequence: 1,
        ledgerEntries: 1,
        ledgerCash: "10000.000000000000",
        cacheCash: "10000.000000000000",
        equity: "10000.000000000000",
        orders: {},
        fills: 0,
        duplicateFillCandles: 0,
        positions: {},
        session: { id: "s2", status: "SHADOW_ACTIVE", killSwitchEngaged: false, version: 2 },
        enabledStrategyVersions: ["sv-regime"]
      }
    ],
    arena: [{ participantKey: "ARENA_OFFICIAL_V1:CRYPTO_TREND_CORE_LONG_V1:v1", evaluations: 5, chainOk: true, status: "CHAMPION" }],
    candleGaps: { BTCUSDT: [], ETHUSDT: [] },
    ...overrides
  };
}

describe("restart consistency check", () => {
  it("passes when a restart only moved things forward", () => {
    const after = snapshot();
    const verdict = compareConsistency(snapshot(), {
      ...after,
      portfolios: after.portfolios.map((entry, index) =>
        index === 0 ? { ...entry, ledgerSequence: 6, ledgerEntries: 6, fills: 2 } : entry
      ),
      arena: [{ ...after.arena[0]!, evaluations: 6 }]
    });
    assert.equal(verdict.ok, true, JSON.stringify(verdict.checks.filter((check) => !check.ok)));
  });

  it("fails on a ledger/cache split, a double-processed candle, a lost session state, shared versions, a broken chain or a candle gap", () => {
    const before = snapshot();
    const broken = snapshot({
      portfolios: [
        { ...before.portfolios[0]!, cacheCash: "9990.000000000000", duplicateFillCandles: 1 },
        {
          ...before.portfolios[1]!,
          session: { id: "s2", status: "PAUSED", killSwitchEngaged: true, version: 3 },
          enabledStrategyVersions: ["sv-regime", "sv-trend"]
        }
      ],
      arena: [{ ...before.arena[0]!, chainOk: false }],
      candleGaps: { BTCUSDT: ["2026-10-15T09:00:00.000Z"], ETHUSDT: [] }
    });
    const failed = compareConsistency(before, broken)
      .checks.filter((check) => !check.ok)
      .map((check) => check.check);
    assert.deepEqual(failed, [
      "OFFICIAL_TREND_CORE_LONG_V1: Ledger = Cash-Cache",
      "OFFICIAL_TREND_CORE_LONG_V1: keine doppelt verarbeitete Kerze",
      "OFFICIAL_REGIME_LONG_V1: Session und Kill Switch erhalten",
      "OFFICIAL_REGIME_LONG_V1: dieselbe Strategieversion",
      "Teilnehmer getrennt",
      "Arena ARENA_OFFICIAL_V1:CRYPTO_TREND_CORE_LONG_V1:v1: Historie intakt",
      "BTCUSDT: keine Kerzenlücke"
    ]);
  });
});
