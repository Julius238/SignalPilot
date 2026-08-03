import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_SEGMENT_KEY,
  MetricNullReason,
  SHADOW_PERFORMANCE_ENGINE_VERSION,
  ShadowPerformanceSegment,
  UNKNOWN_SEGMENT_KEY,
  computeShadowPerformance,
  type ClosedShadowTradeInput,
  type ComputeShadowPerformanceInput,
  type PortfolioEquityPointInput,
  type ShadowPerformanceSegmentResult
} from "../src/shadow/index.js";

const WINDOW = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-08-01T00:00:00.000Z",
  asOf: "2026-08-01T00:00:00.000Z"
};

const EMPTY_FUNNEL = {
  assessedCandidates: 0,
  riskRejectedCandidates: 0,
  invalidCandidates: 0,
  expiredCandidates: 0
};

function trade(overrides: Partial<ClosedShadowTradeInput> & { positionId: string }): ClosedShadowTradeInput {
  return {
    portfolioId: "pf-1",
    strategyVersionId: "sv-1",
    assetId: "asset-btc",
    symbol: "BTCUSDT",
    marketRegime: "RISK_ON",
    exitReason: "TAKE_PROFIT",
    openedAt: "2026-07-10T00:00:00.000Z",
    closedAt: "2026-07-10T02:00:00.000Z",
    initialQuantity: "1.000000000000",
    averageEntryPrice: "100.000000000000",
    netPnl: "0.000000000000",
    fees: "0.000000000000",
    simulatedExecutionCost: "0.000000000000",
    plannedRiskAmount: null,
    maxAdversePrice: null,
    maxFavorablePrice: null,
    ...overrides
  };
}

function input(overrides: Partial<ComputeShadowPerformanceInput> = {}): ComputeShadowPerformanceInput {
  return {
    portfolioId: "pf-1",
    window: WINDOW,
    equityBase: "10000.000000000000",
    trades: [],
    equityCurve: [],
    riskFunnel: EMPTY_FUNNEL,
    sourceThroughPositionEventId: null,
    dataThroughAt: null,
    ...overrides
  };
}

function segment(
  report: { segments: readonly ShadowPerformanceSegmentResult[] },
  type: ShadowPerformanceSegment,
  key: string
): ShadowPerformanceSegmentResult {
  const found = report.segments.find((entry) => entry.segmentType === type && entry.segmentKey === key);
  assert.ok(found, `expected segment ${type}/${key}`);
  return found;
}

function overall(report: { segments: readonly ShadowPerformanceSegmentResult[] }) {
  return segment(report, ShadowPerformanceSegment.OVERALL, ALL_SEGMENT_KEY).metrics;
}

test("empty data set reports zero counts and null ratios with reasons", () => {
  const report = computeShadowPerformance(input());
  const metrics = overall(report);

  assert.equal(report.engineVersion, SHADOW_PERFORMANCE_ENGINE_VERSION);
  assert.equal(report.segments.length, 1, "no segment axis has a bucket without trades");
  assert.equal(metrics.closedTrades, 0);
  assert.equal(metrics.wins, 0);
  assert.equal(metrics.losses, 0);
  assert.equal(metrics.netPnl, "0.000000000000");
  assert.equal(metrics.grossPnl, "0.000000000000");

  assert.deepEqual(metrics.winRatePct, { value: null, reason: MetricNullReason.NO_CLOSED_TRADES });
  assert.deepEqual(metrics.expectancy, { value: null, reason: MetricNullReason.NO_CLOSED_TRADES });
  assert.deepEqual(metrics.profitFactor, { value: null, reason: MetricNullReason.NO_CLOSED_TRADES });
  assert.deepEqual(metrics.averageWin, { value: null, reason: MetricNullReason.NO_WINNING_TRADES });
  assert.deepEqual(metrics.averageLoss, { value: null, reason: MetricNullReason.NO_LOSING_TRADES });
  assert.deepEqual(metrics.averageR, { value: null, reason: MetricNullReason.NO_CLOSED_TRADES });
  assert.deepEqual(metrics.maxDrawdownAmount, { value: null, reason: MetricNullReason.NO_CLOSED_TRADES });
  assert.deepEqual(metrics.averageHoldMinutes, { value: null, reason: MetricNullReason.NO_CLOSED_TRADES });
});

test("winners and losers produce exact counts, win rate, PnL and fee split", () => {
  const report = computeShadowPerformance(
    input({
      trades: [
        trade({ positionId: "p1", netPnl: "100.000000000000", fees: "2.000000000000" }),
        trade({ positionId: "p2", netPnl: "-40.000000000000", fees: "1.000000000000" }),
        trade({ positionId: "p3", netPnl: "60.000000000000", fees: "3.000000000000" }),
        trade({ positionId: "p4", netPnl: "0.000000000000", fees: "0.500000000000" })
      ]
    })
  );
  const metrics = overall(report);

  assert.equal(metrics.closedTrades, 4);
  assert.equal(metrics.wins, 2);
  assert.equal(metrics.losses, 1);
  assert.equal(metrics.breakeven, 1);
  assert.equal(metrics.winRatePct.value, "50.000000000000");

  assert.equal(metrics.netPnl, "120.000000000000");
  assert.equal(metrics.fees, "6.500000000000");
  // Gross = net + fees, per trade and therefore in aggregate.
  assert.equal(metrics.grossPnl, "126.500000000000");
  assert.equal(metrics.grossProfit, "160.000000000000");
  assert.equal(metrics.grossLoss, "40.000000000000");
});

test("profit factor, expectancy, average win and average loss", () => {
  const report = computeShadowPerformance(
    input({
      trades: [
        trade({ positionId: "p1", netPnl: "150.000000000000" }),
        trade({ positionId: "p2", netPnl: "50.000000000000" }),
        trade({ positionId: "p3", netPnl: "-50.000000000000" }),
        trade({ positionId: "p4", netPnl: "-30.000000000000" })
      ]
    })
  );
  const metrics = overall(report);

  assert.equal(metrics.profitFactor.value, "2.500000000000"); // 200 / 80
  assert.equal(metrics.expectancy.value, "30.000000000000"); // 120 / 4
  assert.equal(metrics.averageWin.value, "100.000000000000");
  assert.equal(metrics.averageLoss.value, "-40.000000000000");
});

test("profit factor is null with a reason when there is no gross loss", () => {
  const report = computeShadowPerformance(
    input({ trades: [trade({ positionId: "p1", netPnl: "10.000000000000" })] })
  );
  assert.deepEqual(overall(report).profitFactor, {
    value: null,
    reason: MetricNullReason.NO_GROSS_LOSS
  });
});

test("R metrics only use trades with a persisted planned risk amount", () => {
  const report = computeShadowPerformance(
    input({
      trades: [
        trade({ positionId: "p1", netPnl: "200.000000000000", plannedRiskAmount: "100.000000000000" }),
        trade({ positionId: "p2", netPnl: "-100.000000000000", plannedRiskAmount: "100.000000000000" }),
        trade({ positionId: "p3", netPnl: "500.000000000000", plannedRiskAmount: null })
      ]
    })
  );
  const metrics = overall(report);

  assert.equal(metrics.tradesWithPlannedRisk, 2);
  assert.equal(metrics.cumulativeR.value, "1.000000000000"); // +2R and -1R
  assert.equal(metrics.averageR.value, "0.500000000000");
});

test("R metrics are null with NO_PLANNED_RISK when no trade carries a risk amount", () => {
  const report = computeShadowPerformance(
    input({ trades: [trade({ positionId: "p1", netPnl: "10.000000000000" })] })
  );
  assert.deepEqual(overall(report).averageR, {
    value: null,
    reason: MetricNullReason.NO_PLANNED_RISK
  });
  assert.deepEqual(overall(report).cumulativeR, {
    value: null,
    reason: MetricNullReason.NO_PLANNED_RISK
  });
});

test("drawdown, recovery factor and streaks follow the trade close order", () => {
  const report = computeShadowPerformance(
    input({
      equityBase: "1000.000000000000",
      trades: [
        trade({ positionId: "p1", netPnl: "100.000000000000", closedAt: "2026-07-01T01:00:00.000Z" }),
        trade({ positionId: "p2", netPnl: "-50.000000000000", closedAt: "2026-07-02T01:00:00.000Z" }),
        trade({ positionId: "p3", netPnl: "-150.000000000000", closedAt: "2026-07-03T01:00:00.000Z" }),
        trade({ positionId: "p4", netPnl: "300.000000000000", closedAt: "2026-07-04T01:00:00.000Z" })
      ]
    })
  );
  const metrics = overall(report);

  // Equity path 1000 → 1100 → 1050 → 900 → 1200; peak 1100, trough 900.
  assert.equal(metrics.maxDrawdownAmount.value, "200.000000000000");
  // 200 / 1100 × 100
  assert.equal(metrics.maxDrawdownPct.value, "18.181818181818");
  // net 200 / drawdown 200
  assert.equal(metrics.recoveryFactor.value, "1.000000000000");
  assert.equal(metrics.maxWinStreak, 1);
  assert.equal(metrics.maxLossStreak, 2);
});

test("drawdown percentage is null without an equity base, the amount stays exact", () => {
  const report = computeShadowPerformance(
    input({
      equityBase: null,
      trades: [
        trade({ positionId: "p1", netPnl: "100.000000000000", closedAt: "2026-07-01T01:00:00.000Z" }),
        trade({ positionId: "p2", netPnl: "-30.000000000000", closedAt: "2026-07-02T01:00:00.000Z" })
      ]
    })
  );
  const metrics = overall(report);
  assert.equal(metrics.maxDrawdownAmount.value, "30.000000000000");
  assert.deepEqual(metrics.maxDrawdownPct, { value: null, reason: MetricNullReason.NO_EQUITY_BASE });
});

test("recovery factor is null with NO_DRAWDOWN when the curve never draws down", () => {
  const report = computeShadowPerformance(
    input({ trades: [trade({ positionId: "p1", netPnl: "10.000000000000" })] })
  );
  assert.deepEqual(overall(report).recoveryFactor, {
    value: null,
    reason: MetricNullReason.NO_DRAWDOWN
  });
});

test("hold duration, exposure minutes and exposure share", () => {
  const report = computeShadowPerformance(
    input({
      window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-01T10:00:00.000Z", asOf: WINDOW.asOf },
      trades: [
        trade({
          positionId: "p1",
          openedAt: "2026-07-01T00:00:00.000Z",
          closedAt: "2026-07-01T01:00:00.000Z"
        }),
        trade({
          positionId: "p2",
          openedAt: "2026-07-01T02:00:00.000Z",
          closedAt: "2026-07-01T05:00:00.000Z"
        })
      ]
    })
  );
  const metrics = overall(report);

  assert.equal(metrics.averageHoldMinutes.value, "120.000000000000"); // (60 + 180) / 2
  assert.equal(metrics.exposureMinutes, "240.000000000000");
  assert.equal(metrics.exposurePct.value, "40.000000000000"); // 240 of 600 window minutes
});

test("MAE and MFE only use trades with observed price extremes", () => {
  const report = computeShadowPerformance(
    input({
      trades: [
        trade({
          positionId: "p1",
          averageEntryPrice: "100.000000000000",
          maxAdversePrice: "90.000000000000",
          maxFavorablePrice: "130.000000000000"
        }),
        trade({ positionId: "p2", maxAdversePrice: null, maxFavorablePrice: null })
      ]
    })
  );
  const metrics = overall(report);

  assert.equal(metrics.tradesWithPriceExtremes, 1);
  assert.equal(metrics.averageMaePct.value, "10.000000000000");
  assert.equal(metrics.averageMfePct.value, "30.000000000000");
});

test("MAE and MFE are null with NO_PRICE_EXTREMES when nothing is derivable", () => {
  const report = computeShadowPerformance(
    input({ trades: [trade({ positionId: "p1" })] })
  );
  assert.deepEqual(overall(report).averageMaePct, {
    value: null,
    reason: MetricNullReason.NO_PRICE_EXTREMES
  });
});

test("Sharpe and Sortino stay null below the minimum observation count", () => {
  const equityCurve: PortfolioEquityPointInput[] = Array.from({ length: 5 }, (_value, index) => ({
    asOf: `2026-07-0${index + 1}T00:00:00.000Z`,
    tradingDateUtc: `2026-07-0${index + 1}`,
    equity: `${1000 + index * 10}.000000000000`
  }));

  const report = computeShadowPerformance(input({ equityCurve }));
  const metrics = overall(report);

  assert.deepEqual(metrics.sharpeRatio, {
    value: null,
    reason: MetricNullReason.INSUFFICIENT_RETURN_OBSERVATIONS
  });
  assert.deepEqual(metrics.sortinoRatio, {
    value: null,
    reason: MetricNullReason.INSUFFICIENT_RETURN_OBSERVATIONS
  });
  assert.equal(metrics.returnObservations, 4);
});

test("Sharpe is reported once enough observations exist, Sortino needs a downside day", () => {
  // 30 strictly rising days: enough observations, but no negative return.
  const equityCurve: PortfolioEquityPointInput[] = Array.from({ length: 30 }, (_value, index) => {
    const day = String(index + 1).padStart(2, "0");
    return {
      asOf: `2026-07-${day}T00:00:00.000Z`,
      tradingDateUtc: `2026-07-${day}`,
      equity: `${1000 + index * 10}.000000000000`
    };
  });

  const metrics = overall(computeShadowPerformance(input({ equityCurve })));

  assert.equal(metrics.returnObservations, 29);
  assert.ok(metrics.sharpeRatio.value !== null, "Sharpe is computed with 29 observations");
  assert.deepEqual(metrics.sortinoRatio, {
    value: null,
    reason: MetricNullReason.NO_DOWNSIDE_RETURNS
  });
});

test("risk rejection statistics come from the funnel and need assessed candidates", () => {
  const withFunnel = overall(
    computeShadowPerformance(
      input({
        riskFunnel: {
          assessedCandidates: 40,
          riskRejectedCandidates: 10,
          invalidCandidates: 3,
          expiredCandidates: 2
        }
      })
    )
  );
  assert.equal(withFunnel.riskRejectedCandidates, 10);
  assert.equal(withFunnel.riskRejectionRatePct.value, "25.000000000000");

  const withoutFunnel = overall(computeShadowPerformance(input()));
  assert.deepEqual(withoutFunnel.riskRejectionRatePct, {
    value: null,
    reason: MetricNullReason.NO_ASSESSED_CANDIDATES
  });
});

test("segments by strategy version, asset, market regime and exit reason", () => {
  const report = computeShadowPerformance(
    input({
      trades: [
        trade({
          positionId: "p1",
          strategyVersionId: "sv-1",
          assetId: "asset-btc",
          symbol: "BTCUSDT",
          marketRegime: "RISK_ON",
          exitReason: "TAKE_PROFIT",
          netPnl: "100.000000000000"
        }),
        trade({
          positionId: "p2",
          strategyVersionId: "sv-2",
          assetId: "asset-eth",
          symbol: "ETHUSDT",
          marketRegime: "RISK_OFF",
          exitReason: "STOP",
          netPnl: "-40.000000000000"
        }),
        trade({
          positionId: "p3",
          strategyVersionId: "sv-1",
          assetId: "asset-btc",
          symbol: "BTCUSDT",
          marketRegime: null,
          exitReason: null,
          netPnl: "20.000000000000"
        })
      ]
    })
  );

  const btc = segment(report, ShadowPerformanceSegment.ASSET, "asset-btc").metrics;
  assert.equal(btc.closedTrades, 2);
  assert.equal(btc.netPnl, "120.000000000000");
  assert.equal(segment(report, ShadowPerformanceSegment.ASSET, "asset-btc").segmentLabel, "BTCUSDT");

  const sv1 = segment(report, ShadowPerformanceSegment.STRATEGY_VERSION, "sv-1");
  assert.equal(sv1.metrics.closedTrades, 2);
  assert.equal(sv1.strategyVersionId, "sv-1");

  const riskOff = segment(report, ShadowPerformanceSegment.MARKET_REGIME, "RISK_OFF").metrics;
  assert.equal(riskOff.closedTrades, 1);
  assert.equal(riskOff.netPnl, "-40.000000000000");

  const unknownRegime = segment(report, ShadowPerformanceSegment.MARKET_REGIME, UNKNOWN_SEGMENT_KEY).metrics;
  assert.equal(unknownRegime.closedTrades, 1);

  const stopExits = segment(report, ShadowPerformanceSegment.EXIT_REASON, "STOP").metrics;
  assert.equal(stopExits.closedTrades, 1);
  assert.equal(stopExits.wins, 0);
  assert.equal(stopExits.losses, 1);
});

test("portfolio-level ratios and the risk funnel are not attributed to a segment", () => {
  const report = computeShadowPerformance(
    input({
      riskFunnel: {
        assessedCandidates: 10,
        riskRejectedCandidates: 4,
        invalidCandidates: 0,
        expiredCandidates: 0
      },
      trades: [trade({ positionId: "p1", netPnl: "5.000000000000" })]
    })
  );

  const asset = segment(report, ShadowPerformanceSegment.ASSET, "asset-btc").metrics;
  assert.deepEqual(asset.sharpeRatio, { value: null, reason: MetricNullReason.NOT_DEFINED_FOR_SEGMENT });
  assert.deepEqual(asset.riskRejectionRatePct, {
    value: null,
    reason: MetricNullReason.NOT_DEFINED_FOR_SEGMENT
  });
  assert.equal(asset.assessedCandidates, 0);
  assert.equal(overall(report).assessedCandidates, 10);
});

test("the report is deterministic and order independent", () => {
  const trades = [
    trade({ positionId: "p1", netPnl: "10.000000000000", closedAt: "2026-07-01T00:00:00.000Z" }),
    trade({ positionId: "p2", netPnl: "-4.000000000000", closedAt: "2026-07-02T00:00:00.000Z" }),
    trade({ positionId: "p3", netPnl: "7.000000000000", closedAt: "2026-07-03T00:00:00.000Z" })
  ];

  const first = computeShadowPerformance(input({ trades }));
  const second = computeShadowPerformance(input({ trades: [...trades].reverse() }));

  assert.equal(first.inputHash, second.inputHash);
  assert.equal(first.outputHash, second.outputHash);
  assert.deepEqual(first.segments, second.segments);
});

test("a different data cut produces a different input hash", () => {
  const base = input({ trades: [trade({ positionId: "p1", netPnl: "10.000000000000" })] });
  const changed = input({
    trades: [trade({ positionId: "p1", netPnl: "11.000000000000" })]
  });

  assert.notEqual(computeShadowPerformance(base).inputHash, computeShadowPerformance(changed).inputHash);
  assert.notEqual(computeShadowPerformance(base).outputHash, computeShadowPerformance(changed).outputHash);
});
