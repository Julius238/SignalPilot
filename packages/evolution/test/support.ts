import type { BacktestSummary, CompactTrade, DailyEquityPoint } from "../src/index.js";

export function trade(overrides: Partial<CompactTrade> & { anchorAt: string; netPnl: number }): CompactTrade {
  const plannedRisk = overrides.plannedRisk ?? 25;
  return {
    symbol: "BTCUSDT",
    openedAt: overrides.anchorAt,
    closedAt: overrides.anchorAt,
    exitReason: overrides.netPnl > 0 ? "TAKE_PROFIT" : "STOP",
    entryPrice: 30000,
    quantity: 0.01,
    plannedRisk,
    grossPnl: overrides.netPnl + 1,
    fees: 0.6,
    spreadCost: 0.1,
    slippageCost: 0.3,
    rMultiple: overrides.netPnl / plannedRisk,
    holdHours: 24,
    marketRegime: "RISK_ON",
    ...overrides
  };
}

/** Daily equity that books every trade's PnL on its anchor day. */
export function equityFromTrades(trades: readonly CompactTrade[], from: string, to: string, start = 10000): DailyEquityPoint[] {
  const byDay = new Map<string, number>();
  for (const entry of trades) byDay.set(entry.anchorAt.slice(0, 10), (byDay.get(entry.anchorAt.slice(0, 10)) ?? 0) + entry.netPnl);
  const points: DailyEquityPoint[] = [];
  let equity = start;
  for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    equity += byDay.get(day) ?? 0;
    points.push({ day, equity });
  }
  return points;
}

export function backtest(symbol: string, trades: readonly CompactTrade[], from: string, to: string, subjectKey = "S"): BacktestSummary {
  const own = trades.filter((entry) => entry.symbol === symbol);
  const dailyEquity = equityFromTrades(own, from, to);
  return {
    subjectKey,
    symbol,
    windowKey: "DISCOVERY_VALIDATION",
    from,
    to,
    startingCash: 10000,
    finalEquity: dailyEquity.at(-1)!.equity,
    trades: own,
    dailyEquity,
    funnel: { cycles: 1, candidates: own.length, riskApproved: own.length, riskRejected: 0, entriesFilled: own.length, topStrategyReasons: [], topRiskReasons: [] },
    periods: {
      overall: { label: "overall", buyAndHoldReturnPct: 50, buyAndHoldMaxDrawdownPct: 40, exposurePct: 20 },
      discovery: { label: "discovery", buyAndHoldReturnPct: 80, buyAndHoldMaxDrawdownPct: 50, exposurePct: 22 },
      validation: { label: "validation", buyAndHoldReturnPct: -10, buyAndHoldMaxDrawdownPct: 30, exposurePct: 18 }
    },
    replayEngineVersion: "test",
    outputHash: "hash",
    invariantViolations: 0,
    firstAnchorAt: from,
    lastAnchorAt: to,
    durationMs: 1
  };
}
