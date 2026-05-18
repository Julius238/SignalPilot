export type AssetTypeLike = "STOCK" | "ETF" | "CRYPTO" | string;

export type AssetQualityInput = {
  id: string;
  symbol: string;
  assetType: AssetTypeLike;
  isActive: boolean;
  candleCountsByTimeframe?: Record<string, number>;
  latestCandleByTimeframe?: Record<string, Date | string | null>;
  latestSignalByTimeframe?: Record<string, Date | string | null>;
  signalCount?: number;
  recentSignalCount?: number;
  evaluationCount?: number;
  skippedEvaluationCount?: number;
  alertCount?: number;
  successfulAlertCount?: number;
  alertStateCount?: number;
};

export type AssetCoverage = {
  symbol: string;
  assetType: string;
  isActive: boolean;
  candleCountsByTimeframe: Record<string, number>;
  hasMinimumCandlesByTimeframe: Record<string, boolean>;
  latestCandleByTimeframe: Record<string, string | null>;
  latestSignalByTimeframe: Record<string, string | null>;
  signalCount: number;
  evaluationCount: number;
  skippedEvaluationCount: number;
  alertCount: number;
  qualityScore: number;
  warnings: string[];
};

export type DataQualityReport = {
  generatedAt: string;
  assetCoverage: AssetCoverage[];
  signalCoverage: {
    totalSignals: number;
    signalsLast24h: number;
    signalsWithoutEvaluation: number;
    evaluationCoverageRate: number;
  };
  evaluationCoverage: {
    totalEvaluations: number;
    openCount: number;
    evaluatedCount: number;
    skippedCount: number;
    skippedRate: number;
    skippedByReason: Record<string, number>;
  };
  candleCoverage: {
    minimumCandlesByTimeframe: Record<string, number>;
    assetsBelowMinimumByTimeframe: Record<string, number>;
  };
  alertCoverage: {
    alertStateCount: number;
    successfulAlertCount: number;
    alertCount: number;
  };
  warnings: string[];
  recommendations: string[];
};

export type DataQualityInput = {
  assets: AssetQualityInput[];
  totalSignals: number;
  signalsLast24h: number;
  signalsWithoutEvaluation: number;
  totalEvaluations: number;
  openEvaluationCount: number;
  evaluatedEvaluationCount: number;
  skippedEvaluationCount: number;
  skippedByReason?: Record<string, number>;
  alertStateCount: number;
  successfulAlertCount: number;
  alertCount: number;
  generatedAt?: Date;
};

export const minimumCandlesByTimeframe = {
  "1h": 200,
  "4h": 200,
  "1d": 200
} as const;

const qualityWeights = {
  candles: 40,
  signals: 25,
  evaluations: 25,
  alerts: 10
} as const;

export function buildDataQualityReport(input: DataQualityInput): DataQualityReport {
  const assetCoverage = input.assets.map(buildAssetCoverage);
  const assetsBelowMinimumByTimeframe = Object.fromEntries(
    Object.keys(minimumCandlesByTimeframe).map((timeframe) => [
      timeframe,
      assetCoverage.filter((asset) => !asset.hasMinimumCandlesByTimeframe[timeframe]).length
    ])
  );
  const evaluationCoverageRate =
    input.totalSignals === 0
      ? 0
      : ((input.totalSignals - input.signalsWithoutEvaluation) / input.totalSignals) * 100;
  const skippedRate =
    input.totalEvaluations === 0 ? 0 : (input.skippedEvaluationCount / input.totalEvaluations) * 100;
  const warnings = buildWarnings(input, assetCoverage, assetsBelowMinimumByTimeframe, skippedRate);

  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    assetCoverage,
    signalCoverage: {
      totalSignals: input.totalSignals,
      signalsLast24h: input.signalsLast24h,
      signalsWithoutEvaluation: input.signalsWithoutEvaluation,
      evaluationCoverageRate
    },
    evaluationCoverage: {
      totalEvaluations: input.totalEvaluations,
      openCount: input.openEvaluationCount,
      evaluatedCount: input.evaluatedEvaluationCount,
      skippedCount: input.skippedEvaluationCount,
      skippedRate,
      skippedByReason: input.skippedByReason ?? {}
    },
    candleCoverage: {
      minimumCandlesByTimeframe,
      assetsBelowMinimumByTimeframe
    },
    alertCoverage: {
      alertStateCount: input.alertStateCount,
      successfulAlertCount: input.successfulAlertCount,
      alertCount: input.alertCount
    },
    warnings,
    recommendations: buildRecommendations(warnings, skippedRate, evaluationCoverageRate)
  };
}

function getRequiredTimeframes(assetType: string): string[] {
  if (assetType === "STOCK" || assetType === "ETF") {
    return ["1h", "1d"];
  }
  return Object.keys(minimumCandlesByTimeframe);
}

export function buildAssetCoverage(asset: AssetQualityInput): AssetCoverage {
  const candleCountsByTimeframe = normalizeTimeframeRecord(asset.candleCountsByTimeframe);
  const requiredTimeframes = getRequiredTimeframes(asset.assetType);
  const hasMinimumCandlesByTimeframe = Object.fromEntries(
    Object.entries(minimumCandlesByTimeframe).map(([timeframe, minimum]) => [
      timeframe,
      requiredTimeframes.includes(timeframe)
        ? (candleCountsByTimeframe[timeframe] ?? 0) >= minimum
        : true
    ])
  );
  const latestCandleByTimeframe = stringifyDateRecord(asset.latestCandleByTimeframe);
  const latestSignalByTimeframe = stringifyDateRecord(asset.latestSignalByTimeframe);
  const warnings = buildAssetWarnings(asset, hasMinimumCandlesByTimeframe);
  const qualityScore = calculateQualityScore(asset, hasMinimumCandlesByTimeframe);

  return {
    symbol: asset.symbol,
    assetType: asset.assetType,
    isActive: asset.isActive,
    candleCountsByTimeframe,
    hasMinimumCandlesByTimeframe,
    latestCandleByTimeframe,
    latestSignalByTimeframe,
    signalCount: asset.signalCount ?? 0,
    evaluationCount: asset.evaluationCount ?? 0,
    skippedEvaluationCount: asset.skippedEvaluationCount ?? 0,
    alertCount: asset.alertCount ?? 0,
    qualityScore,
    warnings
  };
}

function calculateQualityScore(
  asset: AssetQualityInput,
  hasMinimumCandlesByTimeframe: Record<string, boolean>
) {
  const candleScore =
    (Object.values(hasMinimumCandlesByTimeframe).filter(Boolean).length /
      Object.keys(minimumCandlesByTimeframe).length) *
    qualityWeights.candles;
  const signalScore = (asset.signalCount ?? 0) > 0 ? qualityWeights.signals : 0;
  const evaluationCount = asset.evaluationCount ?? 0;
  const skippedCount = asset.skippedEvaluationCount ?? 0;
  const evaluationScore =
    evaluationCount === 0
      ? 0
      : Math.max(0, ((evaluationCount - skippedCount) / evaluationCount) * qualityWeights.evaluations);
  const alertScore =
    (asset.successfulAlertCount ?? 0) > 0
      ? qualityWeights.alerts
      : (asset.alertStateCount ?? 0) > 0
        ? qualityWeights.alerts / 2
        : 0;

  return clampScore(candleScore + signalScore + evaluationScore + alertScore);
}

function buildAssetWarnings(
  asset: AssetQualityInput,
  hasMinimumCandlesByTimeframe: Record<string, boolean>
) {
  const warnings: string[] = [];
  const requiredTimeframes = getRequiredTimeframes(asset.assetType);

  if (asset.isActive) {
    for (const timeframe of requiredTimeframes) {
      if (!hasMinimumCandlesByTimeframe[timeframe]) {
        warnings.push(`${asset.symbol} has insufficient ${timeframe} candle coverage.`);
      }
    }

    if (asset.assetType === "CRYPTO" && (asset.recentSignalCount ?? 0) === 0) {
      warnings.push(`${asset.symbol} has no crypto signals in the last 24h.`);
    }
  }

  const evaluationCount = asset.evaluationCount ?? 0;
  const skippedCount = asset.skippedEvaluationCount ?? 0;

  if (evaluationCount > 0 && skippedCount / evaluationCount >= 0.5) {
    warnings.push(`${asset.symbol} has a high skipped evaluation rate.`);
  }

  if ((asset.alertStateCount ?? 0) > 0 && (asset.successfulAlertCount ?? 0) === 0) {
    warnings.push(`${asset.symbol} has alert states but no successful alerts.`);
  }

  return warnings;
}

function buildWarnings(
  input: DataQualityInput,
  assets: AssetCoverage[],
  assetsBelowMinimumByTimeframe: Record<string, number>,
  skippedRate: number
) {
  const warnings = assets.flatMap((asset) => asset.warnings);

  for (const [timeframe, count] of Object.entries(assetsBelowMinimumByTimeframe)) {
    if (count > 0) {
      warnings.push(`${count} assets are below minimum candle coverage for ${timeframe}.`);
    }
  }

  if (input.signalsWithoutEvaluation > 0) {
    warnings.push(`${input.signalsWithoutEvaluation} signals have no Paper Evaluation.`);
  }

  if (skippedRate >= 50) {
    warnings.push("Many Paper Evaluations are skipped.");
  }

  if (input.alertStateCount > 0 && input.successfulAlertCount === 0) {
    warnings.push("Alert states exist but no successful alerts were found.");
  }

  return [...new Set(warnings)];
}

function buildRecommendations(warnings: string[], skippedRate: number, evaluationCoverageRate: number) {
  const recommendations = new Set<string>();

  if (warnings.some((warning) => warning.includes("candle coverage"))) {
    recommendations.add("Backfill candles for low-coverage assets and timeframes.");
  }

  if (evaluationCoverageRate < 80) {
    recommendations.add("Run the Paper Evaluation backfill worker.");
  }

  if (skippedRate >= 50) {
    recommendations.add("Run the Paper Evaluation reclassification worker.");
  }

  if (warnings.some((warning) => warning.includes("successful alerts"))) {
    recommendations.add("Check alert routing and n8n delivery health.");
  }

  if (recommendations.size === 0) {
    recommendations.add("Continue monitoring data quality after each pipeline run.");
  }

  return [...recommendations];
}

function normalizeTimeframeRecord(input: Record<string, number> | undefined) {
  return Object.fromEntries(
    Object.keys(minimumCandlesByTimeframe).map((timeframe) => [timeframe, input?.[timeframe] ?? 0])
  );
}

function stringifyDateRecord(input: Record<string, Date | string | null> | undefined) {
  return Object.fromEntries(
    Object.keys(minimumCandlesByTimeframe).map((timeframe) => {
      const value = input?.[timeframe] ?? null;
      return [timeframe, value instanceof Date ? value.toISOString() : value];
    })
  );
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}
