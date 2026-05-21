import type { AssetClass, SignalDecisionDirection, SignalDecisionStatus } from "@signalpilot/shared";

export type MarketRegime = "RISK_ON" | "RISK_OFF" | "MIXED" | "NEUTRAL" | "UNKNOWN";
export type RiskMode = "AGGRESSIVE" | "NORMAL" | "DEFENSIVE" | "HIGH_RISK" | "UNKNOWN";
export type TrendDirection = "UP" | "DOWN" | "SIDEWAYS" | "UNKNOWN";
export type MomentumState = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNKNOWN";
export type VolatilityState = "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";
export type ConflictLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type RegimeCandle = {
  close: number | string;
  high?: number | string;
  low?: number | string;
};

export type BenchmarkInput = {
  symbol: string;
  assetType: AssetClass | "STOCK" | "ETF" | "CRYPTO" | string;
  timeframe: string;
  candles: RegimeCandle[];
};

export type BenchmarkSummary = {
  symbol: string;
  assetType: string;
  timeframe: string;
  trendDirection: TrendDirection;
  momentumState: MomentumState;
  volatilityState: VolatilityState;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  rsi: number | null;
  score: number;
  summary: string;
};

export type MarketRegimeReport = {
  generatedAt: string;
  equityRegime: MarketRegime;
  cryptoRegime: MarketRegime;
  overallRegime: MarketRegime;
  riskMode: RiskMode;
  confidence: number;
  benchmarkSummaries: BenchmarkSummary[];
  summary: string;
  riskNote: string;
  recommendations: string[];
};

export type SignalRegimeContext = {
  signalId?: string;
  symbol: string;
  assetType: string;
  signalDirection: SignalDecisionDirection | string;
  signalStatus: SignalDecisionStatus | string;
  marketRegime: MarketRegime;
  overallRegime: MarketRegime;
  riskMode: RiskMode;
  isAlignedWithRegime: boolean;
  conflictLevel: ConflictLevel;
  summary: string;
  riskNote: string;
};

const equityBenchmarks = ["SPY", "QQQ", "IWM"] as const;
const cryptoBenchmarks = ["BTCUSDT", "ETHUSDT"] as const;
const minimumCandles = 200;

export function calculateMarketRegimeReport(input: {
  benchmarks: BenchmarkInput[];
  generatedAt?: Date;
}): MarketRegimeReport {
  const generatedAt = input.generatedAt ?? new Date();
  const benchmarkSummaries = input.benchmarks.map(summarizeBenchmark);
  const bySymbol = new Map(benchmarkSummaries.map((summary) => [summary.symbol, summary]));
  const equityRegime = calculateEquityRegime(bySymbol);
  const cryptoRegime = calculateCryptoRegime(bySymbol);
  const overallRegime = calculateOverallRegime(equityRegime, cryptoRegime);
  const confidence = calculateConfidence(benchmarkSummaries, equityRegime, cryptoRegime);
  const riskMode = calculateRiskMode(overallRegime, equityRegime, cryptoRegime, confidence);
  const summary = buildReportSummary(equityRegime, cryptoRegime, overallRegime, riskMode, confidence);
  const riskNote = buildRiskNote(overallRegime, riskMode);

  return {
    generatedAt: generatedAt.toISOString(),
    equityRegime,
    cryptoRegime,
    overallRegime,
    riskMode,
    confidence,
    benchmarkSummaries,
    summary,
    riskNote,
    recommendations: buildRecommendations(overallRegime, riskMode, confidence)
  };
}

export function buildSignalRegimeContext(input: {
  signalId?: string;
  symbol: string;
  assetType: AssetClass | "STOCK" | "ETF" | "CRYPTO" | string;
  signalDirection: SignalDecisionDirection | string;
  signalStatus: SignalDecisionStatus | string;
  report: Pick<MarketRegimeReport, "equityRegime" | "cryptoRegime" | "overallRegime" | "riskMode" | "summary" | "riskNote">;
}): SignalRegimeContext {
  const normalizedAssetType = normalizeAssetType(input.assetType);
  const marketRegime = normalizedAssetType === "crypto" ? input.report.cryptoRegime : input.report.equityRegime;
  const isBullish = input.signalDirection === "BULLISH";
  const isBearish = input.signalDirection === "BEARISH";
  const watchLike = input.signalStatus === "WATCH" || input.signalStatus === "STRONG_WATCH";
  const aligned =
    marketRegime === "UNKNOWN" || marketRegime === "NEUTRAL"
      ? false
      : (marketRegime === "RISK_ON" && isBullish) || (marketRegime === "RISK_OFF" && isBearish);
  const conflictLevel = determineConflictLevel({
    marketRegime,
    riskMode: input.report.riskMode,
    isBullish,
    isBearish,
    watchLike
  });

  return {
    signalId: input.signalId,
    symbol: input.symbol,
    assetType: normalizedAssetType,
    signalDirection: input.signalDirection,
    signalStatus: input.signalStatus,
    marketRegime,
    overallRegime: input.report.overallRegime,
    riskMode: input.report.riskMode,
    isAlignedWithRegime: aligned,
    conflictLevel,
    summary: aligned ? "Marktumfeld unterstützt das Signal." : buildContextSummary(marketRegime, input.signalDirection),
    riskNote:
      conflictLevel === "HIGH" || conflictLevel === "MEDIUM"
        ? `Marktumfeld ist gegenläufig. ${input.report.riskNote}`
        : input.report.riskNote
  };
}

function summarizeBenchmark(input: BenchmarkInput): BenchmarkSummary {
  const closes = input.candles.map((candle) => toNumber(candle.close)).filter(isNumber);

  if (closes.length < minimumCandles) {
    return {
      symbol: input.symbol,
      assetType: normalizeAssetType(input.assetType),
      timeframe: input.timeframe,
      trendDirection: "UNKNOWN",
      momentumState: "UNKNOWN",
      volatilityState: "UNKNOWN",
      priceVsSma50: null,
      priceVsSma200: null,
      rsi: null,
      score: 0,
      summary: "Zu wenig 1d Candles fuer eine belastbare Regime-Auswertung."
    };
  }

  const lastClose = closes.at(-1) ?? 0;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi = calculateRsi(closes, 14);
  const performance20 = percentChange(closes.at(-21), lastClose);
  const volatility20 = annualizedVolatility(closes.slice(-21));
  const priceVsSma50 = sma50 === null ? null : ((lastClose - sma50) / sma50) * 100;
  const priceVsSma200 = sma200 === null ? null : ((lastClose - sma200) / sma200) * 100;
  const trendDirection = determineTrend(priceVsSma50, priceVsSma200);
  const momentumState = performance20 === null ? "UNKNOWN" : performance20 > 1 ? "POSITIVE" : performance20 < -1 ? "NEGATIVE" : "NEUTRAL";
  const volatilityState = volatility20 === null ? "UNKNOWN" : volatility20 >= 35 ? "HIGH" : volatility20 <= 14 ? "LOW" : "NORMAL";
  const score = clamp(
    50 +
      (priceVsSma50 ?? 0) * 1.8 +
      (priceVsSma200 ?? 0) * 0.9 +
      (performance20 ?? 0) * 2 -
      (volatilityState === "HIGH" ? 15 : 0),
    0,
    100
  );

  return {
    symbol: input.symbol,
    assetType: normalizeAssetType(input.assetType),
    timeframe: input.timeframe,
    trendDirection,
    momentumState,
    volatilityState,
    priceVsSma50: round(priceVsSma50),
    priceVsSma200: round(priceVsSma200),
    rsi: round(rsi),
    score: round(score) ?? 0,
    summary: `${input.symbol}: ${trendDirection}, Momentum ${momentumState}, Volatilitaet ${volatilityState}.`
  };
}

function calculateEquityRegime(bySymbol: Map<string, BenchmarkSummary>): MarketRegime {
  const spy = bySymbol.get("SPY");
  const qqq = bySymbol.get("QQQ");
  const iwm = bySymbol.get("IWM");
  if (!spy || !qqq || !hasData(spy) || !hasData(qqq)) return "UNKNOWN";

  const spyStrong = isAboveSma50(spy) && isAboveSma200(spy) && spy.momentumState === "POSITIVE";
  const qqqStrong = isAboveSma50(qqq) && qqq.momentumState === "POSITIVE";
  const iwmWeak = iwm && hasData(iwm) && (isBelowSma50(iwm) || iwm.momentumState === "NEGATIVE");
  const highVolatility = [spy, qqq, iwm].some((summary) => summary?.volatilityState === "HIGH");

  if (spyStrong && qqqStrong && !iwmWeak) return "RISK_ON";
  if (isBelowSma50(spy) && isBelowSma50(qqq) && (spy.momentumState === "NEGATIVE" || qqq.momentumState === "NEGATIVE")) return "RISK_OFF";
  if (highVolatility && (spy.momentumState === "NEGATIVE" || qqq.momentumState === "NEGATIVE")) return "RISK_OFF";
  if (isAboveSma50(spy) !== isAboveSma50(qqq) || iwmWeak) return "MIXED";
  return "NEUTRAL";
}

function calculateCryptoRegime(bySymbol: Map<string, BenchmarkSummary>): MarketRegime {
  const btc = bySymbol.get("BTCUSDT");
  const eth = bySymbol.get("ETHUSDT");
  if (!btc || !eth || !hasData(btc) || !hasData(eth)) return "UNKNOWN";
  if (isAboveSma50(btc) && isAboveSma50(eth) && btc.momentumState === "POSITIVE" && eth.momentumState === "POSITIVE") return "RISK_ON";
  if (isBelowSma50(btc) && isBelowSma50(eth) && btc.momentumState === "NEGATIVE" && eth.momentumState === "NEGATIVE") return "RISK_OFF";
  if (isAboveSma50(btc) !== isAboveSma50(eth) || btc.momentumState !== eth.momentumState) return "MIXED";
  return "NEUTRAL";
}

function calculateOverallRegime(equityRegime: MarketRegime, cryptoRegime: MarketRegime): MarketRegime {
  if (equityRegime === "RISK_ON" && cryptoRegime === "RISK_ON") return "RISK_ON";
  if (equityRegime === "RISK_OFF" && cryptoRegime === "RISK_OFF") return "RISK_OFF";
  if (equityRegime === "UNKNOWN" && cryptoRegime === "UNKNOWN") return "UNKNOWN";
  if (equityRegime === "RISK_OFF" || cryptoRegime === "RISK_OFF") return "MIXED";
  if (equityRegime === "MIXED" || cryptoRegime === "MIXED") return "MIXED";
  if (equityRegime === "RISK_ON" || cryptoRegime === "RISK_ON") return "NEUTRAL";
  return "NEUTRAL";
}

function calculateRiskMode(overall: MarketRegime, equity: MarketRegime, crypto: MarketRegime, confidence: number): RiskMode {
  if (overall === "UNKNOWN") return "UNKNOWN";
  if (overall === "RISK_OFF" || (equity === "RISK_OFF" && crypto === "RISK_OFF")) return "HIGH_RISK";
  if (equity === "RISK_OFF" || crypto === "RISK_OFF") return "HIGH_RISK";
  if (overall === "RISK_ON" && confidence >= 75) return "AGGRESSIVE";
  if (overall === "MIXED") return "DEFENSIVE";
  return "NORMAL";
}

function calculateConfidence(summaries: BenchmarkSummary[], equity: MarketRegime, crypto: MarketRegime): number {
  const expectedCount = equityBenchmarks.length + cryptoBenchmarks.length;
  const completeCount = summaries.filter(hasData).length;
  const coverage = (completeCount / expectedCount) * 65;
  const agreement = [equity, crypto].filter((regime) => regime !== "UNKNOWN" && regime !== "MIXED").length * 12.5;
  const mixedPenalty = [equity, crypto].filter((regime) => regime === "MIXED").length * 8;
  return round(clamp(coverage + agreement - mixedPenalty, 0, 100)) ?? 0;
}

function buildReportSummary(equity: MarketRegime, crypto: MarketRegime, overall: MarketRegime, riskMode: RiskMode, confidence: number) {
  return `Equity ${equity}, Crypto ${crypto}, Overall ${overall}. Risk Mode ${riskMode}, Confidence ${confidence}/100.`;
}

function buildRiskNote(overall: MarketRegime, riskMode: RiskMode) {
  if (riskMode === "HIGH_RISK") return "Risk Mode HIGH_RISK: Signale niedriger priorisieren und mehr Bestaetigung abwarten.";
  if (riskMode === "DEFENSIVE") return "Gemischtes Marktumfeld: Signal-Konflikte aktiv pruefen und mehr Bestaetigung abwarten.";
  if (overall === "RISK_ON") return "Marktumfeld unterstuetzt risikofreundliche Signale, ersetzt aber keine Signalqualitaet.";
  if (overall === "UNKNOWN") return "Regime noch nicht belastbar berechnet, weil Benchmark-Daten fehlen.";
  return "Marktumfeld neutral: Signalqualitaet und Multi-Timeframe-Kontext priorisieren.";
}

function buildRecommendations(overall: MarketRegime, riskMode: RiskMode, confidence: number) {
  const recommendations: string[] = [];
  if (riskMode === "HIGH_RISK") recommendations.push("Bullishe Watch-Signale niedriger priorisieren.");
  if (riskMode === "DEFENSIVE") recommendations.push("Mehr Bestaetigung abwarten.");
  if (confidence < 60) recommendations.push("Benchmark-Coverage pruefen.");
  if (overall === "RISK_ON") recommendations.push("Signale im Einklang mit dem Marktumfeld bevorzugt beobachten.");
  if (recommendations.length === 0) recommendations.push("Regime als Kontext nutzen, keine Handelsaussage ableiten.");
  return recommendations;
}

function determineConflictLevel(input: {
  marketRegime: MarketRegime;
  riskMode: RiskMode;
  isBullish: boolean;
  isBearish: boolean;
  watchLike: boolean;
}): ConflictLevel {
  if (input.marketRegime === "RISK_OFF" && input.isBullish && input.watchLike) return "HIGH";
  if (input.marketRegime === "RISK_ON" && input.isBearish && input.watchLike) return "MEDIUM";
  if (input.riskMode === "HIGH_RISK" && input.isBullish) return "MEDIUM";
  if (input.marketRegime === "MIXED" && input.watchLike) return "LOW";
  return "NONE";
}

function buildContextSummary(marketRegime: MarketRegime, direction: string) {
  if (marketRegime === "RISK_OFF" && direction === "BULLISH") return "Marktumfeld ist gegenlaeufig.";
  if (marketRegime === "RISK_ON" && direction === "BEARISH") return "Signal laeuft gegen ein risikofreundliches Marktumfeld.";
  if (marketRegime === "MIXED") return "Marktumfeld ist gemischt; Signal niedriger priorisieren.";
  if (marketRegime === "UNKNOWN") return "Market Regime: Noch nicht berechnet.";
  return "Marktumfeld liefert keine klare Zusatzbestaetigung.";
}

function hasData(summary: BenchmarkSummary) {
  return summary.priceVsSma50 !== null && summary.momentumState !== "UNKNOWN";
}

function isAboveSma50(summary: BenchmarkSummary) {
  return (summary.priceVsSma50 ?? -Infinity) > 0;
}

function isBelowSma50(summary: BenchmarkSummary) {
  return (summary.priceVsSma50 ?? Infinity) < 0;
}

function isAboveSma200(summary: BenchmarkSummary) {
  return (summary.priceVsSma200 ?? -Infinity) > 0;
}

function determineTrend(priceVsSma50: number | null, priceVsSma200: number | null): TrendDirection {
  if (priceVsSma50 === null || priceVsSma200 === null) return "UNKNOWN";
  if (priceVsSma50 > 0 && priceVsSma200 > 0) return "UP";
  if (priceVsSma50 < 0 && priceVsSma200 < 0) return "DOWN";
  return "SIDEWAYS";
}

function normalizeAssetType(assetType: string) {
  if (assetType === "CRYPTO" || assetType === "crypto") return "crypto";
  if (assetType === "ETF" || assetType === "etf") return "etf";
  return "stock";
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

function calculateRsi(values: number[], period: number) {
  if (values.length < period + 1) return null;
  const window = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < window.length; index += 1) {
    const change = window[index] - window[index - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

function percentChange(previous: number | undefined, current: number) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function annualizedVolatility(values: number[]) {
  if (values.length < 2) return null;
  const returns = values.slice(1).map((value, index) => Math.log(value / values[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function toNumber(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}
