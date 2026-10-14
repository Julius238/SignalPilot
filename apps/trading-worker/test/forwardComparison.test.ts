/**
 * `getForwardComparison`: champion and challenger side by side, each counted
 * only from its own forward start, with the historical replay kept apart.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@signalpilot/database";

import { getForwardComparison } from "../src/lib/forwardComparison.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");
const CHAMPION_START = new Date("2026-08-05T00:00:00.000Z");
const CHALLENGER_START = new Date("2026-08-07T00:00:00.000Z");
const decimal = (value: string) => new Prisma.Decimal(value);

function seed() {
  const { database, tables } = createFakeExecutionDatabase();
  const asset = tables.get("asset")!.create({ data: { symbol: "BTCUSDT", assetType: "CRYPTO" } });

  const addPortfolio = (key: string, equity: string, startedAt: Date, strategyKey: string) => {
    const portfolio = tables.get("portfolio")!.create({
      data: { key, name: key, status: "ACTIVE", startingCash: decimal("10000"), equity: decimal(equity) }
    });
    tables.get("tradingSession")!.create({
      data: { sessionKey: `${key}-s`, portfolioId: portfolio.id, status: "SHADOW_ACTIVE", killSwitchEngaged: false, startedAt }
    });
    const strategy = tables.get("strategy")!.create({ data: { key: strategyKey } });
    const version = tables.get("strategyVersion")!.create({
      data: { strategyId: strategy.id, version: 1, engineVersion: `${strategyKey}/1.0.0`, specificationHash: `hash-${strategyKey}` }
    });
    const assignment = tables.get("strategyAssignment")!.create({
      data: { strategyId: strategy.id, strategyVersionId: version.id, portfolioId: portfolio.id, assetId: asset.id, enabled: true }
    });
    return { portfolio, version, assignment };
  };
  const champion = addPortfolio("SHADOW_V1", "10140", CHAMPION_START, "CRYPTO_TREND_CORE_LONG_V1");
  const challenger = addPortfolio("SHADOW_CHALLENGER_V1", "10000", CHALLENGER_START, "CRYPTO_REGIME_LONG_V1");

  const closed = (key: string, pnl: string, openedAt: string, closedAt: string, status = "CLOSED") => {
    const order = tables.get("shadowOrder")!.create({
      data: { orderKey: `o-${key}`, portfolioId: champion.portfolio.id, assetId: asset.id }
    });
    return tables.get("shadowPosition")!.create({
      data: {
        positionKey: key,
        portfolioId: champion.portfolio.id,
        assetId: asset.id,
        strategyVersionId: champion.version.id,
        direction: "LONG",
        entryOrderId: order.id,
        status,
        initialQuantity: decimal("1"),
        averageEntryPrice: decimal("100"),
        averageExitPrice: decimal("110"),
        realizedPnl: decimal(pnl),
        feesPaid: decimal("2"),
        openedAt: new Date(openedAt),
        closedAt: new Date(closedAt)
      }
    });
  };
  // Before the champion's forward start: must not count.
  closed("p-before", "500", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z");
  closed("p-win", "200", "2026-08-05T01:00:00.000Z", "2026-08-05T03:00:00.000Z");
  closed("p-lose", "-60", "2026-08-06T01:00:00.000Z", "2026-08-06T02:00:00.000Z", "STOPPED_OUT");

  const openOrder = tables.get("shadowOrder")!.create({
    data: { orderKey: "o-open", portfolioId: challenger.portfolio.id, assetId: asset.id }
  });
  tables.get("shadowPosition")!.create({
    data: {
      positionKey: "p-open",
      portfolioId: challenger.portfolio.id,
      assetId: asset.id,
      strategyVersionId: challenger.version.id,
      direction: "LONG",
      entryOrderId: openOrder.id,
      status: "OPEN",
      initialQuantity: decimal("0.5"),
      openQuantity: decimal("0.5"),
      averageEntryPrice: decimal("100"),
      stopPrice: decimal("90"),
      takeProfitPrice: decimal("140"),
      maxHoldUntil: new Date("2026-09-07T00:00:00.000Z"),
      openedAt: new Date("2026-08-08T00:00:00.000Z")
    }
  });
  tables.get("tradingAuditEvent")!.create({
    data: {
      eventKey: "ev-1",
      eventType: "STRATEGY_EVALUATION_REJECTED",
      aggregateType: "StrategyAssignment",
      aggregateId: challenger.assignment.id,
      reasonCode: "REGIME_NOT_RISK_ON",
      occurredAt: new Date("2026-08-10T11:05:00.000Z")
    }
  });

  tables.get("marketRegimeSnapshot")!.create({
    data: {
      generatedAt: new Date("2026-08-10T00:00:00.000Z"),
      reportJson: { cryptoNative: { cryptoRegime: "RISK_ON", riskMode: "NORMAL", confidence: 75 } }
    }
  });

  const replay = (strategyKey: string, isSynthetic: boolean, createdAt: string) =>
    tables.get("shadowReplayRun")!.create({
      data: {
        label: `${strategyKey} SPEC`,
        strategyKey,
        mode: "SPEC",
        costProfile: "REALISTIC",
        regimePolicy: "CRYPTO_NATIVE_V1",
        isSynthetic,
        engineVersion: "shadow-replay-v1/1.3.0",
        closedTrades: 40,
        startingCash: decimal("10000"),
        finalEquity: decimal("12000"),
        metricsJson: {
          overall: { label: "Gesamt", closedTrades: 40, profitFactor: "1.8" },
          training: { label: "Training", closedTrades: 30, profitFactor: "1.7" },
          test: { label: "Test", closedTrades: 10, profitFactor: "2.1" }
        },
        createdAt: new Date(createdAt)
      }
    });
  replay("CRYPTO_TREND_CORE_LONG_V1", false, "2026-08-04T00:00:00.000Z");
  replay("CRYPTO_TREND_CORE_LONG_V1", true, "2026-08-09T00:00:00.000Z");

  return { database, champion, challenger };
}

describe("getForwardComparison", () => {
  it("counts each portfolio only from its own forward start", async () => {
    const { database, champion } = seed();
    const result = await getForwardComparison(database as never, ASOF);

    const [first, second] = result.forward;
    assert.equal(first!.role, "CHAMPION");
    assert.equal(first!.portfolioId, champion.portfolio.id);
    assert.equal(first!.forwardStartAt, CHAMPION_START.toISOString());
    assert.equal(first!.closedTrades, 2);
    assert.equal(first!.wins, 1);
    assert.equal(first!.losses, 1);
    assert.equal(first!.tradesBeforeForwardStart, 1, "the pre-start trade is reported, never counted");
    assert.ok(first!.profitFactor.value !== null && Number(first!.profitFactor.value).toFixed(4) === (200 / 60).toFixed(4));
    assert.equal(first!.netPnl, "140.00");
    assert.equal(first!.lastTrade?.netPnl, "-60");
    assert.equal(first!.openPosition, null);
    assert.equal(first!.strategies[0]?.strategyKey, "CRYPTO_TREND_CORE_LONG_V1");

    assert.equal(second!.role, "CHALLENGER");
    assert.equal(second!.closedTrades, 0, "the champion's trades never leak into the challenger");
    assert.equal(second!.openPosition?.stopPrice, "90");
    assert.equal(second!.lastEvaluation?.outcome, "NO_CANDIDATE");
    assert.equal(second!.lastEvaluation?.reasonCode, "REGIME_NOT_RISK_ON");
  });

  it("reports the crypto-native regime with the challenger's gate", async () => {
    const { database } = seed();
    const result = await getForwardComparison(database as never, ASOF);
    assert.equal(result.regime?.cryptoRegime, "RISK_ON");
    assert.equal(result.regime?.regimeGateOpen, true);
  });

  it("keeps the historical replay apart and ignores synthetic runs", async () => {
    const { database } = seed();
    const result = await getForwardComparison(database as never, ASOF);
    assert.equal(result.replay.length, 1);
    const [replay] = result.replay;
    assert.equal(replay!.strategyKey, "CRYPTO_TREND_CORE_LONG_V1");
    assert.equal(replay!.createdAt, "2026-08-04T00:00:00.000Z");
    assert.deepEqual(
      replay!.periods.map((period) => [period.label, period.profitFactor]),
      [
        ["Gesamt", "1.8"],
        ["Training", "1.7"],
        ["Test", "2.1"]
      ]
    );
  });

  it("reports a portfolio without a started session as not started", async () => {
    const { database } = createFakeExecutionDatabase();
    const result = await getForwardComparison(database as never, ASOF);
    assert.equal(result.forward.length, 2);
    assert.ok(result.forward.every((entry) => entry.forwardStartAt === null && entry.closedTrades === 0));
    assert.equal(result.regime, null);
    assert.deepEqual(result.replay, []);
  });
});
