import type { SignalDecisionStatus, SignalDecisionType } from "@signalpilot/shared";

export type StrategyRuleConfig = {
  name?: string;
  label?: string;
  useSignalRules?: boolean;
  minScoreToRecord?: number;
  includeStatuses?: string[];
  excludeStatuses?: string[];
  includeSignalTypes?: string[];
  excludeSignalTypes?: string[];
  requireMarketRegimeAlignment?: boolean;
  allowedRiskModes?: string[];
  maxSignalsPerAssetTimeframe?: number;
  includeAvoidSignals?: boolean;
};

export type StrategyConfigDefinition = {
  name: string;
  description?: string;
  isDefault: boolean;
  configJson: StrategyRuleConfig;
};

export type StrategySignalCandidate = {
  score: number;
  originalScore?: number | null;
  adjustedScore?: number | null;
  status: SignalDecisionStatus | string;
  signalType: SignalDecisionType | string;
  marketRegimeContext?: {
    isAlignedWithRegime?: boolean;
    riskMode?: string;
  } | null;
};

export type StrategyResultInput = {
  id?: string;
  strategyConfigId?: string;
  strategyName: string;
  totalSignals: number;
  evaluatedCount: number;
  winRate?: number | null;
  avgReturnAfter1d?: number | null;
};

export type RankedStrategyResult<T extends StrategyResultInput = StrategyResultInput> = T & {
  rank: number;
  warnings: string[];
  rankingScore: number;
};

const minimumEvaluatedSamples = 30;

export function buildDefaultStrategyConfigs(): StrategyConfigDefinition[] {
  return [
    {
      name: "Baseline 50",
      description: "Base scoring with score threshold 50.",
      isDefault: true,
      configJson: { useSignalRules: false, minScoreToRecord: 50 }
    },
    {
      name: "Adaptive 50",
      description: "Adaptive scoring with score threshold 50.",
      isDefault: true,
      configJson: { useSignalRules: true, minScoreToRecord: 50 }
    },
    {
      name: "Adaptive 65",
      description: "Adaptive scoring with score threshold 65.",
      isDefault: true,
      configJson: { useSignalRules: true, minScoreToRecord: 65 }
    },
    {
      name: "Watch Only",
      description: "Adaptive scoring for WATCH and STRONG_WATCH only.",
      isDefault: true,
      configJson: { useSignalRules: true, minScoreToRecord: 65, includeStatuses: ["WATCH", "STRONG_WATCH"] }
    },
    {
      name: "Strong Watch Only",
      description: "Adaptive scoring for STRONG_WATCH only.",
      isDefault: true,
      configJson: { useSignalRules: true, minScoreToRecord: 80, includeStatuses: ["STRONG_WATCH"] }
    },
    {
      name: "Regime Aligned",
      description: "Adaptive scoring requiring market regime alignment when context is available.",
      isDefault: true,
      configJson: { useSignalRules: true, minScoreToRecord: 65, requireMarketRegimeAlignment: true }
    },
    {
      name: "Risk Warnings",
      description: "Adaptive scoring for AVOID risk-warning signals.",
      isDefault: true,
      configJson: { useSignalRules: true, includeStatuses: ["AVOID"], includeAvoidSignals: true }
    }
  ];
}

export function applyStrategyFilter(candidate: StrategySignalCandidate, strategyConfig: StrategyRuleConfig): boolean {
  const score = strategyConfig.useSignalRules === false
    ? candidate.originalScore ?? candidate.score
    : candidate.adjustedScore ?? candidate.score;
  const minScore = strategyConfig.minScoreToRecord ?? 50;

  if (!strategyConfig.includeAvoidSignals && candidate.status === "AVOID" && !strategyConfig.includeStatuses?.includes("AVOID")) {
    return false;
  }
  if (score < minScore && !strategyConfig.includeAvoidSignals) return false;
  if (strategyConfig.includeStatuses?.length && !strategyConfig.includeStatuses.includes(candidate.status)) return false;
  if (strategyConfig.excludeStatuses?.includes(candidate.status)) return false;
  if (strategyConfig.includeSignalTypes?.length && !strategyConfig.includeSignalTypes.includes(candidate.signalType)) return false;
  if (strategyConfig.excludeSignalTypes?.includes(candidate.signalType)) return false;
  if (strategyConfig.requireMarketRegimeAlignment && candidate.marketRegimeContext?.isAlignedWithRegime !== true) return false;
  if (
    strategyConfig.allowedRiskModes?.length &&
    (!candidate.marketRegimeContext?.riskMode || !strategyConfig.allowedRiskModes.includes(candidate.marketRegimeContext.riskMode))
  ) {
    return false;
  }

  return true;
}

export function rankStrategyResults<T extends StrategyResultInput>(results: T[]): Array<RankedStrategyResult<T>> {
  return results
    .map((result) => {
      const warnings = result.evaluatedCount < minimumEvaluatedSamples
        ? ["Zu wenig Samples fuer belastbaren Vergleich."]
        : [];
      const winRate = result.winRate ?? 0;
      const samplePenalty = result.evaluatedCount < minimumEvaluatedSamples ? 10 : 0;
      const rankingScore = winRate - samplePenalty + (result.avgReturnAfter1d ?? 0) * 0.1;
      return { ...result, warnings, rankingScore, rank: 0 };
    })
    .sort((left, right) =>
      right.rankingScore - left.rankingScore ||
      right.evaluatedCount - left.evaluatedCount ||
      (right.avgReturnAfter1d ?? 0) - (left.avgReturnAfter1d ?? 0)
    )
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

export function summarizeStrategyComparison(results: StrategyResultInput[]) {
  const ranked = rankStrategyResults(results);
  const best = ranked[0] ?? null;
  const highestAvgReturn = [...ranked].sort(
    (left, right) => (right.avgReturnAfter1d ?? Number.NEGATIVE_INFINITY) - (left.avgReturnAfter1d ?? Number.NEGATIVE_INFINITY)
  )[0] ?? null;

  return {
    totalStrategies: results.length,
    bestStrategy: best?.strategyName ?? null,
    bestStrategyId: best?.strategyConfigId ?? null,
    bestWinRate: best?.winRate ?? null,
    highestAvgReturnStrategy: highestAvgReturn?.strategyName ?? null,
    highestAvgReturnAfter1d: highestAvgReturn?.avgReturnAfter1d ?? null,
    warnings: ranked.flatMap((result) => result.warnings.map((warning) => `${result.strategyName}: ${warning}`)),
    rankedResults: ranked
  };
}
