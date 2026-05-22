import type {
  AssetClass,
  SignalDecision,
  SignalDecisionRiskLevel,
  SignalDecisionStatus
} from "@signalpilot/shared";

export type SignalRuleCategory =
  | "PERFORMANCE"
  | "MARKET_REGIME"
  | "NEWS"
  | "EVENTS"
  | "RISK"
  | "DATA_QUALITY";
export type RuleConfidence = "LOW" | "MEDIUM" | "HIGH";

export type SignalRuleAdjustment = {
  id: string;
  reason: string;
  category: SignalRuleCategory;
  scoreDelta: number;
  confidence: RuleConfidence;
  explanation: string;
};

export type SignalRulesContext = {
  asset: { symbol: string; assetType: AssetClass | string };
  signalDecision: SignalDecision;
  multiTimeframeSummary?: { alignment?: string; alignmentScore?: number; riskLevel?: string } | null;
  newsContext?: { relevanceScore?: number; sentiment?: string; hasRecentNews?: boolean } | null;
  eventContext?: { eventRiskLevel?: string } | null;
  marketRegimeContext?: { marketRegime?: string; overallRegime?: string; riskMode?: string; conflictLevel?: string } | null;
  performanceReport?: PerformanceReportLike | null;
  paperStats?: unknown;
  dataQuality?: { qualityScore?: number; warnings?: string[]; hasMinimumCandles?: boolean; missingMarketRegimeContext?: boolean } | null;
  maxDelta?: number;
};

export type SignalRulesResult = {
  originalScore: number;
  originalStatus: SignalDecisionStatus;
  adjustedScore: number;
  adjustments: SignalRuleAdjustment[];
  finalRiskLevel: SignalDecisionRiskLevel;
  finalStatus: SignalDecisionStatus;
  summary: string;
  warnings: string[];
};

export type PerformanceBucketLike = {
  key: string;
  evaluatedCount: number;
  winRate: number;
  confidenceLevel: RuleConfidence | string;
};

export type PerformanceReportLike = {
  bestSignalTypes?: PerformanceBucketLike[];
  worstSignalTypes?: PerformanceBucketLike[];
  bestTimeframes?: PerformanceBucketLike[];
  worstTimeframes?: PerformanceBucketLike[];
  bestAssets?: PerformanceBucketLike[];
  worstAssets?: PerformanceBucketLike[];
  scoreBuckets?: PerformanceBucketLike[];
};

const defaultMaxDelta = 15;

export function applySignalRules(context: SignalRulesContext): SignalRulesResult {
  const maxDelta = context.maxDelta ?? parseMaxDelta(process.env.SIGNAL_RULES_MAX_DELTA);
  const warnings: string[] = [];
  const rawAdjustments: SignalRuleAdjustment[] = [
    ...performanceAdjustments(context, warnings),
    ...marketRegimeAdjustments(context, warnings),
    ...newsAdjustments(context),
    ...eventAdjustments(context, warnings),
    ...dataQualityAdjustments(context, warnings)
  ];
  const rawDelta = rawAdjustments.reduce((sum, adjustment) => sum + adjustment.scoreDelta, 0);
  const boundedDelta = clamp(rawDelta, -maxDelta, maxDelta);
  const adjustedScore = round(clamp(context.signalDecision.score + boundedDelta, 0, 100));
  const finalRiskLevel = context.signalDecision.riskLevel;
  const finalStatus = recalculateStatus(context.signalDecision, adjustedScore, finalRiskLevel);

  return {
    originalScore: round(context.signalDecision.score),
    originalStatus: context.signalDecision.status,
    adjustedScore,
    adjustments: scaleAdjustments(rawAdjustments, rawDelta, boundedDelta),
    finalRiskLevel,
    finalStatus,
    summary: buildSummary(rawAdjustments, context.signalDecision.score, adjustedScore),
    warnings: [...new Set(warnings)]
  };
}

function performanceAdjustments(context: SignalRulesContext, warnings: string[]): SignalRuleAdjustment[] {
  const report = context.performanceReport;
  if (!report) return [];

  const decision = context.signalDecision;
  const adjustments: SignalRuleAdjustment[] = [];
  const signalTypeBucket = findBucket([...report.bestSignalTypes ?? [], ...report.worstSignalTypes ?? []], decision.signalType);
  const timeframeBucket = findBucket([...report.bestTimeframes ?? [], ...report.worstTimeframes ?? []], decision.timeframe);
  const assetBucket = findBucket([...report.bestAssets ?? [], ...report.worstAssets ?? []], decision.symbol);
  const scoreBucket = findBucket(report.scoreBuckets ?? [], getScoreBucket(decision.score));

  for (const bucket of [signalTypeBucket, timeframeBucket].filter(Boolean) as PerformanceBucketLike[]) {
    if (bucket.evaluatedCount < 10) {
      warnings.push("Zu wenig Performance-Daten für belastbare Anpassung.");
      continue;
    }
    if (isConfident(bucket) && bucket.winRate >= 60) {
      adjustments.push(adjust("performance-positive", "Historisch starker Performance-Bucket.", "PERFORMANCE", 5, "MEDIUM", `${bucket.key} hat ${round(bucket.winRate)}% Trefferquote bei ${bucket.evaluatedCount} Auswertungen.`));
    } else if (isConfident(bucket) && bucket.winRate <= 40) {
      adjustments.push(adjust("performance-negative", "Historisch schwacher Performance-Bucket.", "PERFORMANCE", -6, "MEDIUM", `${bucket.key} hat nur ${round(bucket.winRate)}% Trefferquote bei ${bucket.evaluatedCount} Auswertungen.`));
    }
  }

  if (assetBucket && assetBucket.evaluatedCount >= 10 && isConfident(assetBucket) && assetBucket.winRate <= 40) {
    adjustments.push(adjust("asset-performance-weak", "Asset-spezifische Performance schwach.", "PERFORMANCE", -4, "MEDIUM", `${decision.symbol} zeigt historisch schwache Auswertungen.`));
  }

  if (scoreBucket && scoreBucket.key === "80-100" && decision.score >= 80 && scoreBucket.evaluatedCount >= 10 && isConfident(scoreBucket) && scoreBucket.winRate >= 60) {
    adjustments.push(adjust("score-bucket-strong", "Hohe Score-Klasse historisch konstruktiv.", "PERFORMANCE", 3, "MEDIUM", "ScoreBucket 80-100 war historisch belastbar."));
  }

  return adjustments;
}

function marketRegimeAdjustments(context: SignalRulesContext, warnings: string[]): SignalRuleAdjustment[] {
  const regime = context.marketRegimeContext;
  const decision = context.signalDecision;
  const watchLike = decision.status === "WATCH" || decision.status === "STRONG_WATCH";
  const bullish = decision.direction === "BULLISH";
  const bearish = decision.direction === "BEARISH";

  if (!regime) {
    warnings.push("Market-Regime-Kontext fehlt.");
    return [];
  }

  if (bullish && watchLike && regime.marketRegime === "RISK_ON") {
    return [adjust("regime-risk-on-bullish", "Marktumfeld unterstützt das Signal.", "MARKET_REGIME", 5, "MEDIUM", "Bullishes Watch-Signal liegt im RISK_ON-Regime.")];
  }

  if (bullish && watchLike && (regime.marketRegime === "RISK_OFF" || regime.riskMode === "HIGH_RISK")) {
    warnings.push("Signal läuft gegen das Marktumfeld.");
    return [adjust("regime-risk-off-bullish", "Signal läuft gegen das Marktumfeld.", "MARKET_REGIME", -8, "HIGH", "Bullishes Watch-Signal im RISK_OFF/HIGH_RISK-Umfeld wird niedriger priorisiert.")];
  }

  if (bearish && decision.status === "AVOID" && regime.marketRegime === "RISK_OFF") {
    return [adjust("regime-risk-off-warning", "Warnsignal wird vom Marktumfeld bestätigt.", "MARKET_REGIME", 5, "MEDIUM", "Bearishes/Avoid-Signal passt zum RISK_OFF-Regime.")];
  }

  if (regime.marketRegime === "MIXED" && regime.conflictLevel !== "NONE") {
    return [adjust("regime-mixed", "Gemischtes Marktumfeld.", "MARKET_REGIME", -2, "LOW", "MIXED-Regime reduziert schwache Setups leicht.")];
  }

  return [];
}

function newsAdjustments(context: SignalRulesContext): SignalRuleAdjustment[] {
  const news = context.newsContext;
  if (!news || (news.relevanceScore ?? 0) < 70) return [];

  const bullish = context.signalDecision.direction === "BULLISH";
  const warning = context.signalDecision.status === "AVOID" || context.signalDecision.riskLevel === "HIGH";

  if (news.sentiment === "POSITIVE" && bullish) {
    return [adjust("news-positive-bullish", "Positive relevante News unterstützt das Signal.", "NEWS", 4, "MEDIUM", "Hohe News-Relevanz mit positivem Sentiment.")];
  }
  if (news.sentiment === "NEGATIVE" && bullish) {
    return [adjust("news-negative-bullish", "Negative relevante News belastet bullishes Signal.", "NEWS", -4, "MEDIUM", "Hohe News-Relevanz mit negativem Sentiment.")];
  }
  if (news.sentiment === "NEGATIVE" && warning) {
    return [adjust("news-negative-warning", "Negative News bestätigt Risikohinweis.", "NEWS", 4, "MEDIUM", "Negatives Sentiment stützt AVOID/Risk-Warning-Kontext.")];
  }
  return [];
}

function eventAdjustments(context: SignalRulesContext, warnings: string[]): SignalRuleAdjustment[] {
  const eventRisk = context.eventContext?.eventRiskLevel;
  const decision = context.signalDecision;
  const bullishWatch = decision.direction === "BULLISH" && (decision.status === "WATCH" || decision.status === "STRONG_WATCH");
  const warning = decision.status === "AVOID" || decision.riskLevel === "HIGH";

  if (eventRisk === "HIGH") {
    warnings.push("Hohes Event-Risiko.");
    return bullishWatch
      ? [adjust("event-high-bullish", "Hohes Event-Risiko.", "EVENTS", -6, "HIGH", "Bullishes Watch-Signal wird vor hohem Event-Risiko vorsichtiger bewertet.")]
      : warning
        ? [adjust("event-high-warning", "Hohes Event-Risiko bestätigt Warnsignal.", "EVENTS", 3, "MEDIUM", "Event-Risiko stützt Risikokontext.")]
        : [];
  }

  if (eventRisk === "MEDIUM" && bullishWatch) {
    return [adjust("event-medium-bullish", "Mittleres Event-Risiko.", "EVENTS", -2, "LOW", "Leichte Vorsichtsanpassung wegen Event-Risiko.")];
  }

  return [];
}

function dataQualityAdjustments(context: SignalRulesContext, warnings: string[]): SignalRuleAdjustment[] {
  const quality = context.dataQuality;
  if (!quality) return [];
  const adjustments: SignalRuleAdjustment[] = [];

  if (quality.qualityScore !== undefined && quality.qualityScore < 60 || quality.hasMinimumCandles === false) {
    warnings.push("Datenqualität begrenzt Aussagekraft.");
    adjustments.push(adjust("data-quality-low", "Datenqualität begrenzt Aussagekraft.", "DATA_QUALITY", -5, "HIGH", "Schwache Candle Coverage oder Quality Score unter 60."));
  }
  if (quality.missingMarketRegimeContext) {
    warnings.push("Market-Regime-Kontext fehlt.");
  }

  return adjustments;
}

function recalculateStatus(decision: SignalDecision, adjustedScore: number, riskLevel: SignalDecisionRiskLevel): SignalDecisionStatus {
  if (decision.status === "AVOID" || (riskLevel === "HIGH" && decision.direction === "BEARISH")) return "AVOID";
  if (adjustedScore >= 80 && riskLevel !== "HIGH") return "STRONG_WATCH";
  if (adjustedScore >= 65) return "WATCH";
  if (adjustedScore >= 50) return "WAIT";
  return "NO_EDGE";
}

function scaleAdjustments(adjustments: SignalRuleAdjustment[], rawDelta: number, boundedDelta: number) {
  if (rawDelta === boundedDelta || rawDelta === 0) return adjustments;
  const factor = boundedDelta / rawDelta;
  return adjustments.map((adjustment) => ({ ...adjustment, scoreDelta: round(adjustment.scoreDelta * factor) }));
}

function buildSummary(adjustments: SignalRuleAdjustment[], originalScore: number, adjustedScore: number) {
  if (adjustments.length === 0) return "Keine regelbasierte Anpassung.";
  const main = adjustments.reduce((best, item) => Math.abs(item.scoreDelta) > Math.abs(best.scoreDelta) ? item : best, adjustments[0]);
  return `Score von ${round(originalScore)} auf ${round(adjustedScore)} angepasst. Hauptgrund: ${main.reason}`;
}

function adjust(id: string, reason: string, category: SignalRuleCategory, scoreDelta: number, confidence: RuleConfidence, explanation: string): SignalRuleAdjustment {
  return { id, reason, category, scoreDelta, confidence, explanation };
}

function findBucket(buckets: PerformanceBucketLike[], key: string) {
  return buckets.find((bucket) => bucket.key === key);
}

function isConfident(bucket: PerformanceBucketLike) {
  return bucket.confidenceLevel === "MEDIUM" || bucket.confidenceLevel === "HIGH";
}

function getScoreBucket(score: number) {
  if (score < 50) return "0-49";
  if (score < 65) return "50-64";
  if (score < 80) return "65-79";
  return "80-100";
}

function parseMaxDelta(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxDelta;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
