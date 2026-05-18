export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";
export type PerformanceGroupBy =
  | "signalType"
  | "timeframe"
  | "symbol"
  | "status"
  | "riskLevel"
  | "evaluationKind"
  | "scoreBucket";

export type PaperEvaluationLike = {
  symbol: string;
  timeframe: string;
  status: string;
  signalType: string;
  score: number;
  riskLevel: string;
  evaluationKind?: string;
  skipReason?: string | null;
  evaluationStatus: string;
  outcome?: string | null;
  returnAfter1h?: number | null;
  returnAfter4h?: number | null;
  returnAfter1d?: number | null;
  returnAfter3d?: number | null;
  maxFavorableMove?: number | null;
  maxAdverseMove?: number | null;
};

export type PerformanceBucket = {
  key: string;
  label: string;
  total: number;
  evaluatedCount: number;
  skippedCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  winRate: number;
  avgReturnAfter1h: number;
  avgReturnAfter4h: number;
  avgReturnAfter1d: number;
  avgReturnAfter3d: number;
  avgMaxFavorableMove: number;
  avgMaxAdverseMove: number;
  confidenceLevel: ConfidenceLevel;
  insight: string;
  recommendation: string;
};

export type PerformanceIntelligenceReport = {
  generatedAt: string;
  totalEvaluations: number;
  evaluatedCount: number;
  skippedCount: number;
  overallWinRate: number;
  overallAvgReturnAfter1d: number;
  bestSignalTypes: PerformanceBucket[];
  worstSignalTypes: PerformanceBucket[];
  bestTimeframes: PerformanceBucket[];
  worstTimeframes: PerformanceBucket[];
  bestAssets: PerformanceBucket[];
  worstAssets: PerformanceBucket[];
  scoreBuckets: PerformanceBucket[];
  riskBuckets: PerformanceBucket[];
  statusBuckets: PerformanceBucket[];
  groupedByEvaluationKind: PerformanceBucket[];
  observationStats: ObservationStats;
  skippedByReason: Record<string, number>;
  summary: string;
  warnings: string[];
};

export type ObservationStats = {
  total: number;
  evaluatedCount: number;
  positiveMovementCount: number;
  neutralCount: number;
  negativeCount: number;
  avgAbsReturnAfter1d: number;
};

export type BuildReportOptions = {
  minEvaluated?: number;
  includeSkipped?: boolean;
  generatedAt?: Date;
};

const scoreBucketOrder = ["0-49", "50-64", "65-79", "80-100"] as const;

export function buildPerformanceBucket(
  key: string,
  label: string,
  evaluations: PaperEvaluationLike[],
  overallWinRate = 0
): PerformanceBucket {
  const evaluated = evaluations.filter((evaluation) => evaluation.evaluationStatus === "EVALUATED");
  const skippedCount = evaluations.filter((evaluation) => evaluation.evaluationStatus === "SKIPPED").length;
  const positiveCount = evaluated.filter((evaluation) => evaluation.outcome === "POSITIVE").length;
  const targetReachedCount = evaluated.filter((evaluation) => evaluation.outcome === "TARGET_REACHED").length;
  const negativeCount = evaluated.filter((evaluation) => evaluation.outcome === "NEGATIVE").length;
  const invalidatedCount = evaluated.filter((evaluation) => evaluation.outcome === "INVALIDATED").length;
  const neutralCount = evaluated.filter((evaluation) => evaluation.outcome === "NEUTRAL").length;
  const wins = positiveCount + targetReachedCount;
  const winRate = evaluated.length === 0 ? 0 : (wins / evaluated.length) * 100;
  const bucket: Omit<PerformanceBucket, "insight" | "recommendation"> = {
    key,
    label,
    total: evaluations.length,
    evaluatedCount: evaluated.length,
    skippedCount,
    positiveCount,
    negativeCount,
    neutralCount,
    targetReachedCount,
    invalidatedCount,
    winRate,
    avgReturnAfter1h: average(evaluated.map((evaluation) => evaluation.returnAfter1h)),
    avgReturnAfter4h: average(evaluated.map((evaluation) => evaluation.returnAfter4h)),
    avgReturnAfter1d: average(evaluated.map((evaluation) => evaluation.returnAfter1d)),
    avgReturnAfter3d: average(evaluated.map((evaluation) => evaluation.returnAfter3d)),
    avgMaxFavorableMove: average(evaluated.map((evaluation) => evaluation.maxFavorableMove)),
    avgMaxAdverseMove: average(evaluated.map((evaluation) => evaluation.maxAdverseMove)),
    confidenceLevel: confidenceLevel(evaluated.length)
  };

  return {
    ...bucket,
    insight: buildInsight(bucket, overallWinRate),
    recommendation: buildRecommendation(bucket)
  };
}

export function buildPerformanceBuckets(
  evaluations: PaperEvaluationLike[],
  groupBy: PerformanceGroupBy,
  overallWinRate = 0
): PerformanceBucket[] {
  const groups = new Map<string, PaperEvaluationLike[]>();

  for (const evaluation of evaluations) {
    const key = getGroupKey(evaluation, groupBy);
    const group = groups.get(key) ?? [];
    group.push(evaluation);
    groups.set(key, group);
  }

  const buckets = [...groups.entries()].map(([key, values]) =>
    buildPerformanceBucket(key, getGroupLabel(key, groupBy), values, overallWinRate)
  );

  if (groupBy === "scoreBucket") {
    return scoreBucketOrder
      .filter((bucketKey) => groups.has(bucketKey))
      .map((bucketKey) => buckets.find((bucket) => bucket.key === bucketKey))
      .filter((bucket): bucket is PerformanceBucket => bucket !== undefined);
  }

  return sortBestBuckets(buckets);
}

export function buildPerformanceReport(
  evaluations: PaperEvaluationLike[],
  options: BuildReportOptions = {}
): PerformanceIntelligenceReport {
  const includeSkipped = options.includeSkipped ?? true;
  const activeEvaluations = includeSkipped
    ? evaluations
    : evaluations.filter((evaluation) => evaluation.evaluationStatus !== "SKIPPED");
  const overall = buildPerformanceBucket("overall", "Overall", activeEvaluations, 0);
  const signalTypeBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "signalType", overall.winRate),
    options.minEvaluated ?? 0
  );
  const timeframeBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "timeframe", overall.winRate),
    options.minEvaluated ?? 0
  );
  const assetBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "symbol", overall.winRate),
    options.minEvaluated ?? 0
  );
  const scoreBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "scoreBucket", overall.winRate),
    options.minEvaluated ?? 0
  );
  const riskBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "riskLevel", overall.winRate),
    options.minEvaluated ?? 0
  );
  const statusBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "status", overall.winRate),
    options.minEvaluated ?? 0
  );
  const evaluationKindBuckets = filterByMinEvaluated(
    buildPerformanceBuckets(activeEvaluations, "evaluationKind", overall.winRate),
    options.minEvaluated ?? 0
  );
  const warnings = buildWarnings(overall, activeEvaluations.length);

  return {
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    totalEvaluations: activeEvaluations.length,
    evaluatedCount: overall.evaluatedCount,
    skippedCount: overall.skippedCount,
    overallWinRate: overall.winRate,
    overallAvgReturnAfter1d: overall.avgReturnAfter1d,
    bestSignalTypes: signalTypeBuckets.slice(0, 5),
    worstSignalTypes: sortWorstBuckets(signalTypeBuckets).slice(0, 5),
    bestTimeframes: timeframeBuckets.slice(0, 5),
    worstTimeframes: sortWorstBuckets(timeframeBuckets).slice(0, 5),
    bestAssets: assetBuckets.slice(0, 10),
    worstAssets: sortWorstBuckets(assetBuckets).slice(0, 10),
    scoreBuckets,
    riskBuckets,
    statusBuckets,
    groupedByEvaluationKind: evaluationKindBuckets,
    observationStats: buildObservationStats(activeEvaluations),
    skippedByReason: buildSkippedByReason(activeEvaluations),
    summary: buildSummary(overall),
    warnings
  };
}

function getGroupKey(evaluation: PaperEvaluationLike, groupBy: PerformanceGroupBy) {
  if (groupBy === "scoreBucket") {
    return getScoreBucket(evaluation.score);
  }

  return String(evaluation[groupBy]);
}

function getGroupLabel(key: string, groupBy: PerformanceGroupBy) {
  if (groupBy === "scoreBucket") {
    return `Score ${key}`;
  }

  return key;
}

export function getScoreBucket(score: number) {
  if (score < 50) {
    return "0-49";
  }

  if (score < 65) {
    return "50-64";
  }

  if (score < 80) {
    return "65-79";
  }

  return "80-100";
}

function confidenceLevel(evaluatedCount: number): ConfidenceLevel {
  if (evaluatedCount >= 30) {
    return "HIGH";
  }

  if (evaluatedCount >= 10) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildInsight(
  bucket: Omit<PerformanceBucket, "insight" | "recommendation">,
  overallWinRate: number
) {
  if (bucket.evaluatedCount < 10) {
    return "Zu wenig Daten für belastbare Aussage.";
  }

  if (bucket.winRate >= overallWinRate + 10) {
    return `${bucket.label} zeigt bisher bessere Trefferquote als Durchschnitt.`;
  }

  if (bucket.avgReturnAfter1d < -0.5) {
    return `${bucket.label} Signale zeigen schwache Folgerendite.`;
  }

  if (bucket.winRate <= overallWinRate - 10) {
    return `${bucket.label} liegt bisher unter dem Durchschnitt.`;
  }

  return `${bucket.label} liegt bisher nahe am Durchschnitt.`;
}

function buildRecommendation(bucket: Omit<PerformanceBucket, "insight" | "recommendation">) {
  if (bucket.evaluatedCount < 10) {
    return "mehr Daten sammeln";
  }

  if (bucket.winRate >= 60 && bucket.avgReturnAfter1d >= 0) {
    return "weiter beobachten";
  }

  if (bucket.winRate < 40 || bucket.avgReturnAfter1d < -0.5) {
    return "Signalregel prüfen";
  }

  return "niedriger priorisieren";
}

function buildWarnings(overall: PerformanceBucket, totalEvaluations: number) {
  const warnings: string[] = [];

  if (totalEvaluations === 0) {
    warnings.push("Keine Paper Evaluations vorhanden.");
  }

  if (overall.evaluatedCount < 10) {
    warnings.push("Zu wenig Daten für belastbare Aussage.");
  }

  if (overall.skippedCount > overall.evaluatedCount) {
    warnings.push("Viele Evaluations sind SKIPPED und fließen nicht in die WinRate ein.");
  }

  return warnings;
}

function buildObservationStats(evaluations: PaperEvaluationLike[]): ObservationStats {
  const observations = evaluations.filter((evaluation) => evaluation.evaluationKind === "OBSERVATION");
  const evaluatedObservations = observations.filter(
    (evaluation) => evaluation.evaluationStatus === "EVALUATED"
  );

  return {
    total: observations.length,
    evaluatedCount: evaluatedObservations.length,
    positiveMovementCount: evaluatedObservations.filter((evaluation) => evaluation.outcome === "POSITIVE")
      .length,
    neutralCount: evaluatedObservations.filter((evaluation) => evaluation.outcome === "NEUTRAL")
      .length,
    negativeCount: evaluatedObservations.filter((evaluation) => evaluation.outcome === "NEGATIVE")
      .length,
    avgAbsReturnAfter1d: average(
      evaluatedObservations.map((evaluation) =>
        typeof evaluation.returnAfter1d === "number" ? Math.abs(evaluation.returnAfter1d) : null
      )
    )
  };
}

function buildSkippedByReason(evaluations: PaperEvaluationLike[]) {
  return evaluations
    .filter((evaluation) => evaluation.evaluationStatus === "SKIPPED")
    .reduce<Record<string, number>>((groups, evaluation) => {
      const reason = evaluation.skipReason ?? "Unspecified";
      groups[reason] = (groups[reason] ?? 0) + 1;
      return groups;
    }, {});
}

function buildSummary(overall: PerformanceBucket) {
  if (overall.evaluatedCount === 0) {
    return "Noch keine ausgewerteten Paper Evaluations vorhanden.";
  }

  if (overall.evaluatedCount < 10) {
    return "Erste Paper Evaluations vorhanden, aber die Datenbasis ist noch klein.";
  }

  return `Gesamt-WinRate ${overall.winRate.toFixed(1)}% bei ${overall.evaluatedCount} ausgewerteten Paper Evaluations.`;
}

function filterByMinEvaluated(buckets: PerformanceBucket[], minEvaluated: number) {
  return buckets.filter((bucket) => bucket.evaluatedCount >= minEvaluated);
}

function sortBestBuckets(buckets: PerformanceBucket[]) {
  return [...buckets].sort(
    (left, right) =>
      right.winRate - left.winRate ||
      right.avgReturnAfter1d - left.avgReturnAfter1d ||
      right.evaluatedCount - left.evaluatedCount
  );
}

function sortWorstBuckets(buckets: PerformanceBucket[]) {
  return [...buckets].sort(
    (left, right) =>
      left.winRate - right.winRate ||
      left.avgReturnAfter1d - right.avgReturnAfter1d ||
      right.evaluatedCount - left.evaluatedCount
  );
}

function average(values: Array<number | null | undefined>) {
  const activeValues = values.filter((value): value is number => typeof value === "number");

  if (activeValues.length === 0) {
    return 0;
  }

  return activeValues.reduce((sum, value) => sum + value, 0) / activeValues.length;
}
