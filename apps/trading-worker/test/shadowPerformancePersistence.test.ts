import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@signalpilot/database";
import { computeShadowPerformance } from "@signalpilot/performance-intelligence/shadow";

import {
  assembleShadowPerformanceInput,
  persistShadowPerformance,
  refreshShadowPerformance,
  resolveWindowBounds
} from "../src/lib/shadowPerformancePersistence.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");

const decimal = (value: string) => new Prisma.Decimal(value);

/**
 * Two closed trades on one asset: a winner exited at take profit and a loser
 * stopped out. Both carry fills so the simulated execution cost is derivable,
 * and one carries a risk assessment so R is derivable for exactly one of them.
 */
function seed() {
  const { database, tables } = createFakeExecutionDatabase();

  const portfolio = tables.get("portfolio")!.create({
    data: {
      key: "pf",
      name: "pf",
      status: "ACTIVE",
      startingCash: decimal("10000")
    }
  });

  const candidate = tables.get("tradeCandidate")!.create({
    data: {
      candidateKey: "cand-1",
      portfolioId: portfolio.id,
      assetId: "asset-btc",
      status: "APPROVED_FOR_SHADOW",
      decisionTime: new Date("2026-08-05T00:00:00.000Z"),
      inputSnapshotJson: { marketRegime: { overallRegime: "RISK_ON" } }
    }
  });
  tables.get("riskAssessment")!.create({
    data: {
      assessmentKey: "ra-1",
      tradeCandidateId: candidate.id,
      portfolioId: portfolio.id,
      status: "PASS",
      riskAmount: decimal("100"),
      assessedAt: new Date("2026-08-05T00:05:00.000Z")
    }
  });

  const winnerOrder = tables.get("shadowOrder")!.create({
    data: {
      orderKey: "o-win",
      tradeCandidateId: candidate.id,
      portfolioId: portfolio.id,
      assetId: "asset-btc"
    }
  });
  const loserOrder = tables.get("shadowOrder")!.create({
    data: {
      orderKey: "o-lose",
      tradeCandidateId: null,
      portfolioId: portfolio.id,
      assetId: "asset-eth"
    }
  });

  const winner = tables.get("shadowPosition")!.create({
    data: {
      positionKey: "p-win",
      portfolioId: portfolio.id,
      assetId: "asset-btc",
      strategyVersionId: "sv-1",
      direction: "LONG",
      entryOrderId: winnerOrder.id,
      status: "CLOSED",
      initialQuantity: decimal("1"),
      averageEntryPrice: decimal("100"),
      realizedPnl: decimal("200"),
      feesPaid: decimal("4"),
      openedAt: new Date("2026-08-05T01:00:00.000Z"),
      closedAt: new Date("2026-08-05T03:00:00.000Z")
    }
  });
  const loser = tables.get("shadowPosition")!.create({
    data: {
      positionKey: "p-lose",
      portfolioId: portfolio.id,
      assetId: "asset-eth",
      strategyVersionId: "sv-1",
      direction: "SHORT",
      entryOrderId: loserOrder.id,
      status: "STOPPED_OUT",
      initialQuantity: decimal("2"),
      averageEntryPrice: decimal("50"),
      realizedPnl: decimal("-60"),
      feesPaid: decimal("2"),
      openedAt: new Date("2026-08-06T01:00:00.000Z"),
      closedAt: new Date("2026-08-06T02:00:00.000Z")
    }
  });

  const fills = tables.get("shadowFill")!;
  fills.create({
    data: {
      fillKey: "f1",
      shadowOrderId: winnerOrder.id,
      shadowPositionId: winner.id,
      assetId: "asset-btc",
      quantity: decimal("1"),
      slippageAmount: decimal("0.5"),
      triggerType: "ENTRY",
      occurredAt: new Date("2026-08-05T01:00:00.000Z")
    }
  });
  fills.create({
    data: {
      fillKey: "f2",
      shadowOrderId: winnerOrder.id,
      shadowPositionId: winner.id,
      assetId: "asset-btc",
      quantity: decimal("1"),
      slippageAmount: decimal("0.5"),
      triggerType: "TAKE_PROFIT",
      occurredAt: new Date("2026-08-05T03:00:00.000Z")
    }
  });
  fills.create({
    data: {
      fillKey: "f3",
      shadowOrderId: loserOrder.id,
      shadowPositionId: loser.id,
      assetId: "asset-eth",
      quantity: decimal("2"),
      slippageAmount: decimal("0.25"),
      triggerType: "STOP",
      occurredAt: new Date("2026-08-06T02:00:00.000Z")
    }
  });

  tables.get("shadowPositionEvent")!.create({
    data: {
      eventKey: "pe-1",
      shadowPositionId: winner.id,
      sequence: 1,
      type: "CLOSED",
      occurredAt: new Date("2026-08-05T03:00:00.000Z")
    }
  });

  return { database, tables, portfolio, winner, loser };
}

describe("resolveWindowBounds", () => {
  it("anchors DAILY at the UTC day start", () => {
    const { from, to } = resolveWindowBounds("DAILY" as never, ASOF);
    assert.equal(from.toISOString(), "2026-08-10T00:00:00.000Z");
    assert.equal(to.toISOString(), ASOF.toISOString());
  });

  it("uses a 30-day lookback for ROLLING_30D", () => {
    const { from } = resolveWindowBounds("ROLLING_30D" as never, ASOF);
    assert.equal(from.toISOString(), "2026-07-11T12:00:00.000Z");
  });
});

describe("assembleShadowPerformanceInput", () => {
  it("flattens closed positions with fees, execution cost, regime and exit reason", async () => {
    const { database, portfolio } = seed();
    const input = await assembleShadowPerformanceInput(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF
    });

    assert.equal(input.trades.length, 2);
    const winner = input.trades.find((trade) => trade.assetId === "asset-btc");
    assert.ok(winner);
    assert.equal(winner.netPnl, "200");
    assert.equal(winner.direction, "LONG");
    assert.equal(winner.fees, "4");
    assert.equal(winner.exitReason, "TAKE_PROFIT");
    assert.equal(winner.marketRegime, "RISK_ON");
    // Two fills at 0.5 per unit on 1 unit each.
    assert.equal(winner.simulatedExecutionCost, "1.000000000000");
    assert.equal(winner.plannedRiskAmount, "100");

    const loser = input.trades.find((trade) => trade.assetId === "asset-eth");
    assert.ok(loser);
    assert.equal(loser.exitReason, "STOP");
    assert.equal(loser.direction, "SHORT");
    assert.equal(
      loser.marketRegime,
      null,
      "no candidate snapshot means no invented regime"
    );
    assert.equal(loser.plannedRiskAmount, null);
    assert.equal(loser.simulatedExecutionCost, "0.500000000000");
  });

  it("binds the result to a concrete data cut", async () => {
    const { database, portfolio } = seed();
    const input = await assembleShadowPerformanceInput(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF
    });

    assert.ok(input.sourceThroughPositionEventId !== null);
    assert.equal(input.dataThroughAt, "2026-08-05T03:00:00.000Z");
    assert.equal(input.equityBase, "10000");
  });

  it("counts the risk funnel for the window", async () => {
    const { database, tables, portfolio } = seed();
    tables.get("riskAssessment")!.create({
      data: {
        assessmentKey: "ra-fail",
        tradeCandidateId: "other",
        portfolioId: portfolio.id,
        status: "FAIL",
        riskAmount: decimal("0"),
        assessedAt: new Date("2026-08-07T00:00:00.000Z")
      }
    });

    const input = await assembleShadowPerformanceInput(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF
    });

    assert.equal(input.riskFunnel.assessedCandidates, 2);
    assert.equal(input.riskFunnel.riskRejectedCandidates, 1);
  });

  it("reports no price extremes unless explicitly asked to derive them", async () => {
    const { database, portfolio } = seed();
    const input = await assembleShadowPerformanceInput(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF
    });

    for (const trade of input.trades) {
      assert.equal(trade.maxAdversePrice, null);
      assert.equal(trade.maxFavorablePrice, null);
    }
  });
});

describe("persistShadowPerformance", () => {
  it("writes one row per segment and is idempotent on the same data cut", async () => {
    const { database, tables, portfolio } = seed();
    const options = {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF,
      codeVersion: "test"
    };

    const first = await refreshShadowPerformance(database as never, options);
    assert.ok(first.written > 0);
    assert.equal(first.unchanged, 0);

    const rows = tables.get("strategyPerformance")!.rows;
    assert.equal(rows.length, first.written);

    const second = await refreshShadowPerformance(database as never, options);
    assert.equal(second.written, 0, "unchanged data writes nothing");
    assert.equal(second.unchanged, first.segments);
    assert.equal(tables.get("strategyPerformance")!.rows.length, first.written);
  });

  it("adds a new row instead of overwriting when the engine version changes", async () => {
    const { database, tables, portfolio } = seed();
    const input = await assembleShadowPerformanceInput(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF
    });
    const report = computeShadowPerformance(input);

    await persistShadowPerformance(database as never, report, {
      window: "ALL_TIME" as never,
      codeVersion: "test",
      asOf: ASOF
    });
    const afterFirst = tables.get("strategyPerformance")!.rows.length;

    const nextVersion = { ...report, engineVersion: "shadow-performance-v3" };
    const second = await persistShadowPerformance(
      database as never,
      nextVersion,
      {
        window: "ALL_TIME" as never,
        codeVersion: "test",
        asOf: ASOF
      }
    );

    assert.equal(
      second.written,
      report.segments.length,
      "a new engine version writes new rows"
    );
    assert.equal(
      tables.get("strategyPerformance")!.rows.length,
      afterFirst * 2
    );
    const versions = new Set(
      tables.get("strategyPerformance")!.rows.map((row) => row.engineVersion)
    );
    assert.deepEqual([...versions].sort(), [
      "shadow-performance-v2",
      "shadow-performance-v3"
    ]);
  });

  it("persists null metrics as null columns with the reason kept in metricsJson", async () => {
    const { database, tables, portfolio } = seed();
    await refreshShadowPerformance(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF,
      codeVersion: "test"
    });

    const overall = tables
      .get("strategyPerformance")!
      .rows.find((row) => row.segmentType === "OVERALL");
    assert.ok(overall);
    // Fewer than 20 daily observations exist, so Sharpe is genuinely unknown.
    assert.equal(overall.sharpeRatio, null);
    const metrics = overall.metricsJson as Record<
      string,
      { value: unknown; reason: string | null }
    >;
    assert.equal(metrics.sharpeRatio.value, null);
    assert.equal(
      metrics.sharpeRatio.reason,
      "INSUFFICIENT_RETURN_OBSERVATIONS"
    );
    // MAE/MFE were not derivable either, and say so.
    assert.equal(overall.averageMaePct, null);
    assert.equal(metrics.averageMaePct.reason, "NO_PRICE_EXTREMES");
  });

  it("records provenance on every row", async () => {
    const { database, tables, portfolio } = seed();
    await refreshShadowPerformance(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF,
      codeVersion: "abc123"
    });

    for (const row of tables.get("strategyPerformance")!.rows) {
      assert.equal(row.engineVersion, "shadow-performance-v2");
      assert.equal(row.codeVersion, "abc123");
      assert.ok(
        typeof row.inputHash === "string" &&
          (row.inputHash as string).length === 64
      );
      assert.ok(
        typeof row.outputHash === "string" &&
          (row.outputHash as string).length === 64
      );
      assert.ok(row.computedAt instanceof Date);
    }
  });

  it("segments by direction, asset, market regime, exit reason and strategy version", async () => {
    const { database, tables, portfolio } = seed();
    await refreshShadowPerformance(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF,
      codeVersion: "test"
    });

    const rows = tables.get("strategyPerformance")!.rows;
    const byType = (type: string) =>
      rows.filter((row) => row.segmentType === type);

    assert.equal(byType("OVERALL").length, 1);
    assert.deepEqual(
      byType("DIRECTION")
        .map((row) => row.segmentKey)
        .sort(),
      ["LONG", "SHORT"]
    );
    assert.equal(byType("ASSET").length, 2);
    assert.equal(byType("STRATEGY_VERSION").length, 1);
    assert.deepEqual(
      byType("MARKET_REGIME")
        .map((row) => row.segmentKey)
        .sort(),
      ["RISK_ON", "UNKNOWN"]
    );
    assert.deepEqual(
      byType("EXIT_REASON")
        .map((row) => row.segmentKey)
        .sort(),
      ["STOP", "TAKE_PROFIT"]
    );

    // Only STRATEGY_VERSION rows point at a single version.
    for (const row of rows) {
      if (row.segmentType === "STRATEGY_VERSION")
        assert.equal(row.strategyVersionId, "sv-1");
      else assert.equal(row.strategyVersionId, null);
    }
  });

  it("never touches an order, position, fill or risk decision", async () => {
    const { database, tables, portfolio } = seed();
    const watched = [
      "shadowOrder",
      "shadowPosition",
      "shadowFill",
      "riskAssessment",
      "tradeCandidate"
    ] as const;
    const before = new Map(
      watched.map(
        (name) => [name, JSON.stringify(tables.get(name)!.rows)] as const
      )
    );

    await refreshShadowPerformance(database as never, {
      portfolioId: portfolio.id,
      window: "ALL_TIME" as never,
      asOf: ASOF,
      codeVersion: "test"
    });

    for (const [name, snapshot] of before) {
      assert.equal(
        JSON.stringify(tables.get(name)!.rows),
        snapshot,
        `${name} was modified`
      );
    }
  });
});
