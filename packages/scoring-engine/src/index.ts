import type {
  AssetClass,
  IndicatorSnapshot,
  SignalDecision,
  SignalDecisionDirection,
  SignalDecisionRiskLevel,
  SignalDecisionStatus,
  SignalDecisionType
} from "@signalpilot/shared";

export type ScoringAsset = {
  symbol: string;
  assetType: AssetClass;
};

export type ScoreSignalInput = {
  asset: ScoringAsset;
  timeframe: string;
  indicators: IndicatorSnapshot;
  context?: {
    newsScore?: number;
    socialScore?: number;
    eventScore?: number;
  };
};

type ComponentResult = {
  score: number;
  reasons: string[];
  counterArguments: string[];
};

export function scoreSignal(input: ScoreSignalInput): SignalDecision {
  const reasons: string[] = [];
  const counterArguments: string[] = [];
  const indicators = input.indicators;

  const trend = scoreTrend(indicators);
  const momentum = scoreMomentum(indicators);
  const volume = scoreVolume(indicators);
  const volatility = scoreVolatility(indicators);
  const rsi = scoreRsi(indicators);

  reasons.push(...trend.reasons, ...momentum.reasons, ...volume.reasons, ...volatility.reasons, ...rsi.reasons);
  counterArguments.push(
    ...trend.counterArguments,
    ...momentum.counterArguments,
    ...volume.counterArguments,
    ...volatility.counterArguments,
    ...rsi.counterArguments
  );

  const newsScore = clampScore(input.context?.newsScore ?? 50);
  const socialScore = clampScore(input.context?.socialScore ?? 50);
  const eventScore = clampScore(input.context?.eventScore ?? 50);
  const riskScore = calculateRiskScore(indicators, {
    momentumScore: momentum.score,
    volumeScore: volume.score,
    rsiScore: rsi.score,
    volatilityScore: volatility.score
  });
  const score = roundScore(
    trend.score * 0.25 +
      momentum.score * 0.2 +
      volume.score * 0.2 +
      volatility.score * 0.15 +
      rsi.score * 0.1 +
      newsScore * 0.05 +
      eventScore * 0.05
  );
  const direction = determineDirection(trend.score, momentum.score, volume.score, indicators);
  const status = determineStatus(score, riskScore, direction);
  const signalType = determineSignalType({
    trendScore: trend.score,
    momentumScore: momentum.score,
    volumeScore: volume.score,
    volatilityScore: volatility.score,
    riskScore,
    indicators
  });
  const riskLevel = determineRiskLevel(riskScore);
  const nextTrigger = buildNextTrigger(status, direction, indicators);

  if (newsScore === 50) {
    counterArguments.push("News context is neutral because no news integration is connected yet.");
  }

  if (eventScore === 50) {
    counterArguments.push("Event context is neutral because no event integration is connected yet.");
  }

  if (socialScore === 50) {
    counterArguments.push("Social context is neutral for v1.");
  }

  return {
    symbol: input.asset.symbol,
    assetType: input.asset.assetType,
    timeframe: input.timeframe,
    signalType,
    status,
    direction,
    score,
    riskLevel,
    trendScore: trend.score,
    momentumScore: momentum.score,
    volumeScore: volume.score,
    volatilityScore: volatility.score,
    rsiScore: rsi.score,
    newsScore,
    socialScore,
    eventScore,
    riskScore,
    reasons: unique(reasons),
    counterArguments: unique(counterArguments),
    nextTrigger
  };
}

function scoreTrend(snapshot: IndicatorSnapshot): ComponentResult {
  const { lastClose, sma20, sma50, sma200 } = snapshot;

  if (!hasNumber(lastClose) || !hasNumber(sma20) || !hasNumber(sma50)) {
    return {
      score: 50,
      reasons: ["Trend score is neutral because last close or core SMA values are missing."],
      counterArguments: ["Need lastClose, sma20 and sma50 before trend can be trusted."]
    };
  }

  if (lastClose > sma20 && sma20 > sma50) {
    if (hasNumber(sma200) && lastClose > sma200) {
      return {
        score: 88,
        reasons: ["Price is above sma20, sma20 is above sma50, and price is above sma200."],
        counterArguments: []
      };
    }

    return {
      score: 76,
      reasons: ["Price is above sma20 and sma20 is above sma50."],
      counterArguments: hasNumber(sma200)
        ? ["Price is not above sma200, so long-term confirmation is weaker."]
        : ["sma200 is missing, so long-term trend confirmation is unavailable."]
    };
  }

  if ((hasNumber(sma200) && lastClose < sma200) || lastClose < sma50) {
    return {
      score: 25,
      reasons: ["Trend is weak because price is below sma50 or sma200."],
      counterArguments: []
    };
  }

  return {
    score: 50,
    reasons: ["Trend is not clearly aligned."],
    counterArguments: ["Moving averages do not show a clean directional structure."]
  };
}

function scoreMomentum(snapshot: IndicatorSnapshot): ComponentResult {
  const { lastClose, periodHigh20, periodLow20 } = snapshot;

  if (!hasNumber(lastClose) || !hasNumber(periodHigh20) || !hasNumber(periodLow20)) {
    return {
      score: 50,
      reasons: ["Momentum score is neutral because period high or low is missing."],
      counterArguments: ["Need periodHigh20 and periodLow20 to evaluate breakout proximity."]
    };
  }

  const range = periodHigh20 - periodLow20;

  if (range <= 0) {
    return {
      score: 50,
      reasons: ["Momentum score is neutral because the 20-period range is flat."],
      counterArguments: ["A flat range makes high/low proximity unreliable."]
    };
  }

  const position = (lastClose - periodLow20) / range;

  if (position >= 0.95) {
    return {
      score: 88,
      reasons: ["Price is very close to the 20-period high."],
      counterArguments: []
    };
  }

  if (position >= 0.8) {
    return {
      score: 75,
      reasons: ["Price is in the upper part of the 20-period range."],
      counterArguments: []
    };
  }

  if (position <= 0.15) {
    return {
      score: 25,
      reasons: ["Price is close to the 20-period low."],
      counterArguments: []
    };
  }

  return {
    score: 50,
    reasons: ["Momentum is mid-range and not decisive."],
    counterArguments: ["Price is not close enough to the period high or low."]
  };
}

function scoreVolume(snapshot: IndicatorSnapshot): ComponentResult {
  const relativeVolume = snapshot.relativeVolume;

  if (!hasNumber(relativeVolume)) {
    return {
      score: 50,
      reasons: ["Volume score is neutral because relativeVolume is missing."],
      counterArguments: ["Need averageVolume20 and lastVolume for volume confirmation."]
    };
  }

  if (relativeVolume > 2) {
    return {
      score: 92,
      reasons: ["Relative volume is above 2.0, showing very strong participation."],
      counterArguments: []
    };
  }

  if (relativeVolume > 1.5) {
    return {
      score: 82,
      reasons: ["Relative volume is above 1.5, showing strong participation."],
      counterArguments: []
    };
  }

  if (relativeVolume < 0.7) {
    return {
      score: 32,
      reasons: ["Relative volume is below 0.7, showing weak participation."],
      counterArguments: ["Low participation weakens technical confirmation."]
    };
  }

  return {
    score: 50,
    reasons: ["Relative volume is near normal levels."],
    counterArguments: ["Volume is not confirming an exceptional move."]
  };
}

function scoreVolatility(snapshot: IndicatorSnapshot): ComponentResult {
  const ratio = atrToPriceRatio(snapshot);

  if (ratio === null) {
    return {
      score: 50,
      reasons: ["Volatility score is neutral because atr14 or lastClose is missing."],
      counterArguments: ["Need atr14 relative to price to evaluate volatility."]
    };
  }

  if (ratio >= 0.08) {
    return {
      score: 35,
      reasons: ["ATR is very high relative to price."],
      counterArguments: ["Very high volatility increases execution and false-breakout risk."]
    };
  }

  if (ratio >= 0.04) {
    return {
      score: 68,
      reasons: ["ATR shows elevated volatility."],
      counterArguments: ["Elevated volatility needs careful confirmation."]
    };
  }

  return {
    score: 55,
    reasons: ["Volatility is within a normal range."],
    counterArguments: []
  };
}

function scoreRsi(snapshot: IndicatorSnapshot): ComponentResult {
  const rsi = snapshot.rsi14;

  if (!hasNumber(rsi)) {
    return {
      score: 50,
      reasons: ["RSI score is neutral because rsi14 is missing."],
      counterArguments: ["Need rsi14 for momentum quality."]
    };
  }

  if (rsi > 75) {
    return {
      score: 82,
      reasons: ["RSI is above 75, showing strong momentum."],
      counterArguments: ["RSI above 75 is overheated and increases pullback risk."]
    };
  }

  if (rsi >= 50 && rsi <= 70) {
    return {
      score: 72,
      reasons: ["RSI is between 50 and 70, a constructive momentum zone."],
      counterArguments: []
    };
  }

  if (rsi < 30) {
    return {
      score: 35,
      reasons: ["RSI is below 30, indicating oversold conditions."],
      counterArguments: ["Oversold is not automatically bullish without trend confirmation."]
    };
  }

  if (rsi < 40) {
    return {
      score: 30,
      reasons: ["RSI is below 40, showing weak momentum."],
      counterArguments: []
    };
  }

  return {
    score: 50,
    reasons: ["RSI is neutral."],
    counterArguments: []
  };
}

function calculateRiskScore(
  snapshot: IndicatorSnapshot,
  scores: {
    momentumScore: number;
    volumeScore: number;
    rsiScore: number;
    volatilityScore: number;
  }
): number {
  let risk = 35;
  const ratio = atrToPriceRatio(snapshot);

  if (hasNumber(snapshot.rsi14) && snapshot.rsi14 > 75) {
    risk += 22;
  }

  if (hasNumber(snapshot.relativeVolume) && snapshot.relativeVolume > 2) {
    risk += 14;
  }

  if (ratio !== null && ratio >= 0.08) {
    risk += 26;
  } else if (ratio !== null && ratio >= 0.04) {
    risk += 12;
  }

  if (scores.momentumScore >= 75 && scores.volumeScore < 55) {
    risk += 16;
  }

  if (scores.volatilityScore < 45) {
    risk += 8;
  }

  return clampScore(risk);
}

function determineDirection(
  trendScore: number,
  momentumScore: number,
  volumeScore: number,
  snapshot: IndicatorSnapshot
): SignalDecisionDirection {
  const missingCoreData =
    !hasNumber(snapshot.lastClose) ||
    !hasNumber(snapshot.sma20) ||
    !hasNumber(snapshot.sma50) ||
    !hasNumber(snapshot.periodHigh20) ||
    !hasNumber(snapshot.periodLow20);

  if (missingCoreData) {
    return "NEUTRAL";
  }

  if (trendScore >= 70 && momentumScore >= 70 && volumeScore >= 60) {
    return "BULLISH";
  }

  if (trendScore >= 70 && momentumScore >= 70 && volumeScore < 45) {
    return "MIXED";
  }

  if (trendScore <= 35 && momentumScore <= 35) {
    return "BEARISH";
  }

  if ((trendScore >= 70 && momentumScore <= 45) || (trendScore <= 40 && momentumScore >= 65)) {
    return "MIXED";
  }

  return "NEUTRAL";
}

function determineStatus(
  score: number,
  riskScore: number,
  direction: SignalDecisionDirection
): SignalDecisionStatus {
  if (score < 40 || (direction === "BEARISH" && riskScore >= 70)) {
    return "AVOID";
  }

  if (score >= 80 && riskScore < 70) {
    return "STRONG_WATCH";
  }

  if (score >= 65) {
    return "WATCH";
  }

  if (score >= 50) {
    return "WAIT";
  }

  return "NO_EDGE";
}

function determineSignalType(input: {
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  volatilityScore: number;
  riskScore: number;
  indicators: IndicatorSnapshot;
}): SignalDecisionType {
  const nearHigh = isNearPeriodHigh(input.indicators);

  if (input.volumeScore >= 90) {
    return "VOLUME_SPIKE";
  }

  if (input.volatilityScore >= 68 && input.riskScore >= 55) {
    return "VOLATILITY_SPIKE";
  }

  if (nearHigh && input.volumeScore >= 75) {
    return "BREAKOUT_ALERT";
  }

  if (input.trendScore >= 75 && input.momentumScore >= 75) {
    return "MOMENTUM_ALERT";
  }

  if (input.trendScore >= 75 && input.momentumScore < 75) {
    return "TREND_ALERT";
  }

  return "NO_SIGNAL";
}

function determineRiskLevel(riskScore: number): SignalDecisionRiskLevel {
  if (riskScore >= 70) {
    return "HIGH";
  }

  if (riskScore >= 45) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildNextTrigger(
  status: SignalDecisionStatus,
  direction: SignalDecisionDirection,
  snapshot: IndicatorSnapshot
): string {
  if (status === "AVOID") {
    return "Wait for risk to cool down and trend structure to improve.";
  }

  if (direction === "BULLISH") {
    return "Watch for price to hold above sma20 with relativeVolume above 1.5.";
  }

  if (direction === "BEARISH") {
    return "Wait for price to reclaim sma50 before reconsidering.";
  }

  if (isNearPeriodHigh(snapshot)) {
    return "Watch for a clean break above the 20-period high with volume confirmation.";
  }

  return "Wait for clearer trend, momentum, or volume confirmation.";
}

function isNearPeriodHigh(snapshot: IndicatorSnapshot): boolean {
  if (!hasNumber(snapshot.lastClose) || !hasNumber(snapshot.periodHigh20) || snapshot.periodHigh20 === 0) {
    return false;
  }

  return snapshot.lastClose / snapshot.periodHigh20 >= 0.98;
}

function atrToPriceRatio(snapshot: IndicatorSnapshot): number | null {
  if (!hasNumber(snapshot.atr14) || !hasNumber(snapshot.lastClose) || snapshot.lastClose === 0) {
    return null;
  }

  return snapshot.atr14 / snapshot.lastClose;
}

function hasNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  return Math.max(0, Math.min(100, roundScore(value)));
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
