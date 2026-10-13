// Research probe: does the unchanged strategy fire on the synthetic breakout scenario?
import { buildIndicatorSnapshot } from "@signalpilot/indicators";
import { scoreSignal } from "@signalpilot/scoring-engine";
import { generateBreakoutScenario, runShadowReplay, type ReplayConfig, type ReplayMarketData } from "../src/index.js";

const START = Date.UTC(2025, 0, 1);
const BREAKOUT_HOUR = Number(process.env.HOUR ?? 8);
const EVENTS = [230, 240, 250].map((day, index) => ({
  breakoutAtMs: START + day * 86_400_000 + (BREAKOUT_HOUR + (process.env.SAME_HOUR ? 0 : index)) * 3_600_000,
  outcome: (index === 1 ? "LOSS" : "WIN") as "WIN" | "LOSS"
}));
const series = (symbol: string, startPrice: number, assetType: "CRYPTO" | "ETF", seed: number) =>
  generateBreakoutScenario({ symbol, assetType, startMs: START, startPrice, events: EVENTS, seed });

const market: ReplayMarketData = {
  origin: "SYNTHETIC",
  synthetic: true,
  series: [
    series("BTCUSDT", 60000, "CRYPTO", 1),
    series("ETHUSDT", 3000, "CRYPTO", 2),
    series("SPY", 560, "ETF", 3),
    series("QQQ", 480, "ETF", 4),
    series("IWM", 220, "ETF", 5)
  ]
};
const config: ReplayConfig = {
  symbol: "BTCUSDT",
  strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1",
  mode: (process.env.MODE as "SPEC" | "SIGNAL_EDGE") ?? "SPEC",
  regimePolicy: "AS_SPECIFIED",
  startingCash: "10000",
  executionProfile: {
    tickSize: "0.010000000000", stepSize: "0.000010000000", minQuantity: "0.000010000000",
    minNotional: "10.000000000000", maxQuantity: null, feeBps: Number(process.env.FEE ?? 10), fullSpreadBps: Number(process.env.SPREAD ?? 2), slippageBps: Number(process.env.SLIP ?? 3),
    maxParticipationRate: "0.010000000000"
  },
  from: new Date(START + 225 * 86_400_000).toISOString(),
  codeVersion: "probe"
};
const eventHours = new Set(EVENTS.map((event) => event.breakoutAtMs + 3_600_000 - 1));
const result = runShadowReplay(market, config, {
  onEvaluation: (anchorAt, evaluation) => {
    if (!eventHours.has(Date.parse(anchorAt))) return;
    const failed = evaluation.checks.filter((check) => !check.passed).map((check) => `${check.checkId}:${check.reasonCode} (${check.actual} vs ${check.limit})`);
    console.log(anchorAt, evaluation.outcome, failed.join(" | "));
    const btc = market.series[0]!;
    for (const tf of ["1h", "4h", "1d"] as const) {
      const closed = (btc.candles[tf] ?? []).filter((candle) => candle.closeTime <= Date.parse(anchorAt));
      const ind = buildIndicatorSnapshot(closed.slice(-250).map((c) => ({ high: c.high, low: c.low, close: c.close, volume: c.volume })));
      const d = scoreSignal({ asset: { symbol: "BTCUSDT", assetType: "crypto" }, timeframe: tf, indicators: ind });
      console.log(`   ${tf} dir=${d.direction} status=${d.status} score=${d.score} trend=${d.trendScore} mom=${d.momentumScore} vol=${d.volumeScore} risk=${d.riskScore}/${d.riskLevel} rsi=${ind.rsi14?.toFixed(1)} relVol=${ind.relativeVolume?.toFixed(2)} atr%=${((ind.atr14 ?? 0) / (ind.lastClose ?? 1) * 100).toFixed(2)}`);
    }
  }
});
console.log(JSON.stringify({ funnel: { ...result.funnel, strategyReasons: undefined }, trades: result.trades.map((t) => `${t.anchorAt} entry=${t.entryPrice} stop=${t.stopPrice} tp=${t.takeProfitPrice} exit=${t.exitPrice} ${t.exitReason} qty=${t.quantity} net=${t.netPnl} R=${t.rMultiple}`) }, null, 1).slice(0, 2500));
