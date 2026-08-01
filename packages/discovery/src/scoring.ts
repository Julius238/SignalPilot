import {
  discoveryComponentKeys,
  type DiscoveryAssetClass,
  type DiscoveryCandle,
  type DiscoveryScoreComponents,
  type DiscoveryScoreInput,
  type DiscoveryScoreResult,
  type HistoricalQuality,
  type DiscoveryPolicy
} from "./types.js";

export function scoreDiscoveryAsset(
  input: DiscoveryScoreInput,
  policy: DiscoveryPolicy
): DiscoveryScoreResult {
  const candles = cleanCandles(input.candles ?? []);
  const snapshot = input.snapshot ?? null;
  const now = input.now ?? new Date();
  const closes = candles.map((candle) => candle.close);
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const volumeValues = candles.map((candle) => candle.volume).filter((value) => value > 0);
  const latestPrice = snapshot?.price ?? latest?.close ?? null;
  const averageVolume = average(volumeValues.slice(-20));
  const latestQuoteVolume =
    snapshot?.quoteVolume24h ??
    (latest && latestPrice ? latest.volume * latestPrice : null);
  const liquidityUsd = Math.max(0, latestQuoteVolume ?? 0);
  const liquidity = liquidityScore(input.assetType, liquidityUsd);
  const relativeVolume =
    latest && averageVolume && averageVolume > 0 ? latest.volume / averageVolume : null;
  const shortReturn = percentageChange(closes.at(-6), closes.at(-1));
  const priceMovement24h =
    snapshot?.priceChangePercent24h ?? percentageChange(previous?.close, latest?.close);
  const rangePercent =
    snapshot?.high24h && snapshot?.low24h && latestPrice
      ? ((snapshot.high24h - snapshot.low24h) / latestPrice) * 100
      : averageTrueRangePercent(candles.slice(-14));
  const volumeTrend = compareAverages(volumeValues.slice(-5), volumeValues.slice(-20, -5));
  const dataFreshness = freshnessScore(snapshot?.observedAt ?? latest?.closeTime ?? null, now, input.assetType);
  const dataCompleteness = completenessScore(candles, policy.minimumCandles);
  const dataQuality = round(clamp(dataFreshness * 0.45 + dataCompleteness * 0.55));
  const trend = trendScore(closes);
  const relativeStrength = relativeStrengthScore(candles, input.benchmarkCandles ?? []);
  const breakout = breakoutScore(candles);
  const historicalSignalQuality = historicalQualityScore(input.historicalSignals);
  const paperAndBacktestQuality = combinedHistoricalQualityScore(
    input.paperEvaluation,
    input.backtest
  );
  const activityCount = Math.max(0, (input.newsActivity ?? 0) + (input.eventActivity ?? 0));

  const components: DiscoveryScoreComponents = {
    liquidity,
    tradingVolume: liquidityScore(input.assetType, liquidityUsd),
    volumeChange: boundedActivityScore(relativeVolume, volumeTrend),
    volatility: balancedVolatilityScore(rangePercent),
    priceMovement: balancedMovementScore(priceMovement24h),
    trendStrength: trend,
    relativeStrength,
    breakoutProximity: breakout,
    multiTimeframeConfluence: confluenceScore(candles),
    dataFreshness,
    dataCompleteness,
    newsActivity: round(clamp(35 + Math.min(activityCount, 5) * 13)),
    unusualActivity: unusualActivityScore(relativeVolume, priceMovement24h, rangePercent),
    historicalSignalQuality,
    paperAndBacktestQuality
  };

  const weights = inputPolicyWeights(input.assetType, policy);
  const weightTotal = discoveryComponentKeys.reduce((sum, key) => sum + weights[key], 0);
  const rawScore = round(
    discoveryComponentKeys.reduce((sum, key) => sum + components[key] * weights[key], 0) /
      Math.max(1, weightTotal)
  );
  const sampleSize = candles.length;
  const sampleConfidence = clamp(sampleSize / Math.max(policy.minimumCandles * 2, 1));
  const historicalSample =
    (input.historicalSignals?.sampleSize ?? 0) +
    (input.paperEvaluation?.sampleSize ?? 0) +
    (input.backtest?.sampleSize ?? 0);
  const confidence = round(
    clamp(dataQuality * 0.7 + sampleConfidence * 20 + Math.min(10, historicalSample / 5))
  );

  let score = Math.min(rawScore, Math.max(0, dataQuality + 8));
  if (sampleSize < policy.minimumCandles) {
    score = Math.min(score, policy.maximumCandidateScoreWithoutCandles);
  }
  if (dataQuality < policy.minimumDataQuality) {
    score = Math.min(score, dataQuality * 0.8);
  }
  score = round(clamp(score));

  const exclusionReasons: string[] = [];
  if (liquidity < policy.minimumLiquidity) exclusionReasons.push("INSUFFICIENT_LIQUIDITY");
  if (dataQuality < policy.minimumDataQuality) exclusionReasons.push("INSUFFICIENT_DATA_QUALITY");
  if (sampleSize < policy.minimumCandles) exclusionReasons.push("INSUFFICIENT_HISTORY");
  if (dataFreshness < 60) exclusionReasons.push("STALE_DATA");
  if (score < policy.minimumScore) exclusionReasons.push("BELOW_MINIMUM_SCORE");

  return {
    score,
    rawScore,
    confidence,
    dataQuality,
    liquidity,
    sampleSize,
    eligible: exclusionReasons.length === 0,
    exclusionReasons,
    reasons: buildReasons(components, relativeVolume, priceMovement24h),
    components,
    weights,
    metrics: {
      price: latestPrice,
      quoteVolume24h: latestQuoteVolume,
      relativeVolume,
      priceChangePercent24h: priceMovement24h,
      rangePercent,
      shortReturnPercent: shortReturn,
      candleCount: sampleSize
    }
  };
}

function inputPolicyWeights(assetType: DiscoveryAssetClass, policy: DiscoveryPolicy) {
  return policy.weights[assetType];
}

function cleanCandles(candles: DiscoveryCandle[]) {
  return candles
    .filter(
      (candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        Number.isFinite(candle.volume) &&
        candle.close > 0
    )
    .sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
}

function liquidityScore(assetType: DiscoveryAssetClass, quoteVolume: number) {
  const floor = assetType === "CRYPTO" ? 1_000_000 : assetType === "ETF" ? 5_000_000 : 10_000_000;
  const excellent = assetType === "CRYPTO" ? 100_000_000 : 250_000_000;
  if (quoteVolume <= 0) return 0;
  if (quoteVolume < floor) return round((quoteVolume / floor) * 35);
  const normalized =
    35 + (Math.log10(quoteVolume / floor) / Math.log10(excellent / floor)) * 65;
  return round(clamp(normalized));
}

function freshnessScore(observedAt: Date | null, now: Date, assetType: DiscoveryAssetClass) {
  if (!observedAt || !Number.isFinite(observedAt.getTime())) return 0;
  const ageHours = Math.max(0, (now.getTime() - observedAt.getTime()) / 3_600_000);
  const freshWindow = assetType === "CRYPTO" ? 2 : 72;
  const staleWindow = assetType === "CRYPTO" ? 24 : 120;
  if (ageHours <= freshWindow) return 100;
  if (ageHours >= staleWindow) return 0;
  return round(100 - ((ageHours - freshWindow) / (staleWindow - freshWindow)) * 100);
}

function completenessScore(candles: DiscoveryCandle[], minimumCandles: number) {
  if (candles.length === 0) return 0;
  const countScore = clamp((candles.length / Math.max(1, minimumCandles)) * 100);
  if (candles.length < 3) return round(countScore * 0.4);
  const gaps = candles.slice(1).map((candle, index) => candle.openTime.getTime() - candles[index]!.openTime.getTime());
  const expected = median(gaps.filter((gap) => gap > 0));
  const irregular = expected
    ? gaps.filter((gap) => gap > expected * 2.1).length / Math.max(1, gaps.length)
    : 1;
  return round(clamp(countScore * 0.8 + (1 - irregular) * 20));
}

function trendScore(closes: number[]) {
  if (closes.length < 20) return 30;
  const short = average(closes.slice(-10));
  const medium = average(closes.slice(-20));
  const long = average(closes.slice(-50));
  const current = closes.at(-1)!;
  if (!short || !medium || !long) return 30;
  const aligned = current > short && short > medium && medium >= long;
  const bearishAligned = current < short && short < medium && medium <= long;
  const distance = Math.abs((current - medium) / medium) * 100;
  return round(clamp((aligned || bearishAligned ? 72 : 42) + Math.min(distance, 8) * 3));
}

function relativeStrengthScore(candles: DiscoveryCandle[], benchmark: DiscoveryCandle[]) {
  if (candles.length < 20 || benchmark.length < 20) return 40;
  const assetReturn = percentageChange(candles.at(-20)?.close, candles.at(-1)?.close) ?? 0;
  const benchmarkReturn =
    percentageChange(benchmark.at(-20)?.close, benchmark.at(-1)?.close) ?? 0;
  return round(clamp(50 + (assetReturn - benchmarkReturn) * 3));
}

function breakoutScore(candles: DiscoveryCandle[]) {
  if (candles.length < 20) return 35;
  const recent = candles.slice(-20);
  const current = recent.at(-1)!.close;
  const high = Math.max(...recent.slice(0, -1).map((candle) => candle.high));
  const low = Math.min(...recent.slice(0, -1).map((candle) => candle.low));
  const highDistance = Math.abs((high - current) / current) * 100;
  const lowDistance = Math.abs((current - low) / current) * 100;
  const nearest = Math.min(highDistance, lowDistance);
  return round(clamp(100 - nearest * 12));
}

function confluenceScore(candles: DiscoveryCandle[]) {
  if (candles.length < 40) return 35;
  const closes = candles.map((candle) => candle.close);
  const r5 = percentageChange(closes.at(-6), closes.at(-1)) ?? 0;
  const r20 = percentageChange(closes.at(-21), closes.at(-1)) ?? 0;
  const sameDirection = Math.sign(r5) === Math.sign(r20);
  return round(clamp((sameDirection ? 70 : 35) + Math.min(20, Math.abs(r5 - r20))));
}

function historicalQualityScore(input?: HistoricalQuality) {
  if (!input || input.sampleSize <= 0 || input.winRate === null) return 45;
  const shrinkage = input.sampleSize / (input.sampleSize + 30);
  const shrunkWinRate = 50 + (input.winRate - 50) * shrinkage;
  const returnAdjustment =
    input.averageReturn === null ? 0 : clamp(input.averageReturn * 4, -10, 10);
  return round(clamp(shrunkWinRate + returnAdjustment));
}

function combinedHistoricalQualityScore(
  paper?: HistoricalQuality,
  backtest?: HistoricalQuality
) {
  if (!paper && !backtest) return 45;
  const values = [paper, backtest].filter(Boolean).map((item) => historicalQualityScore(item));
  return round(average(values) ?? 45);
}

function boundedActivityScore(relativeVolume: number | null, volumeTrend: number | null) {
  const relative = relativeVolume === null ? 35 : clamp(35 + (relativeVolume - 1) * 35);
  const trend = volumeTrend === null ? 40 : clamp(50 + volumeTrend * 40);
  return round(relative * 0.7 + trend * 0.3);
}

function balancedVolatilityScore(rangePercent: number | null) {
  if (rangePercent === null) return 35;
  const value = Math.abs(rangePercent);
  if (value < 0.5) return round(clamp(value * 60));
  if (value <= 6) return round(clamp(55 + value * 6));
  if (value <= 12) return round(clamp(91 - (value - 6) * 6));
  return round(clamp(55 - (value - 12) * 4));
}

function balancedMovementScore(changePercent: number | null) {
  if (changePercent === null) return 35;
  const value = Math.abs(changePercent);
  if (value <= 8) return round(clamp(35 + value * 8));
  if (value <= 15) return round(clamp(99 - (value - 8) * 7));
  return round(clamp(50 - (value - 15) * 3));
}

function unusualActivityScore(
  relativeVolume: number | null,
  priceMovement: number | null,
  rangePercent: number | null
) {
  const volume = relativeVolume === null ? 30 : clamp((relativeVolume - 0.8) * 45);
  const movement = balancedMovementScore(priceMovement);
  const volatility = balancedVolatilityScore(rangePercent);
  return round(volume * 0.55 + movement * 0.25 + volatility * 0.2);
}

function buildReasons(
  components: DiscoveryScoreComponents,
  relativeVolume: number | null,
  movement: number | null
) {
  const ranked = Object.entries(components)
    .filter(([key]) => !["dataFreshness", "dataCompleteness"].includes(key))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([key]) => `STRONG_${key.replace(/[A-Z]/g, (value) => `_${value}`).toUpperCase()}`);
  if (relativeVolume !== null && relativeVolume >= 1.8) ranked.unshift("UNUSUAL_VOLUME");
  if (movement !== null && Math.abs(movement) >= 3 && Math.abs(movement) <= 12) {
    ranked.unshift("MATERIAL_PRICE_MOVEMENT");
  }
  return [...new Set(ranked)].slice(0, 4);
}

function averageTrueRangePercent(candles: DiscoveryCandle[]) {
  if (candles.length === 0) return null;
  const percentages = candles
    .map((candle) => ((candle.high - candle.low) / candle.open) * 100)
    .filter(Number.isFinite);
  return average(percentages);
}

function compareAverages(recent: number[], previous: number[]) {
  const recentAverage = average(recent);
  const previousAverage = average(previous);
  if (!recentAverage || !previousAverage) return null;
  return (recentAverage - previousAverage) / previousAverage;
}

function percentageChange(start?: number, end?: number) {
  if (!start || end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return ((end - start) / start) * 100;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
