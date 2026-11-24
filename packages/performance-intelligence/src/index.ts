// Shadow-Trading-Performance (P8). Eigener Namensraum, weil er dieselbe
// Aufgabe erfüllt, aber niemals dieselbe Datenquelle nutzt: der Report unten
// wertet PaperSignalEvaluations aus, `./shadow` ausschließlich abgeschlossene
// ShadowPositions.
export * from "./shadow/index.js";

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

/** Sum and count of the non-null values of one metric, in evaluation order. */
export type MetricSum = { sum: number; count: number };

/** Everything a bucket needs to know about its evaluations. */
export type PerformanceStats = {
  total: number;
  evaluatedCount: number;
  skippedCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  returnAfter1h: MetricSum;
  returnAfter4h: MetricSum;
  returnAfter1d: MetricSum;
  returnAfter3d: MetricSum;
  maxFavorableMove: MetricSum;
  maxAdverseMove: MetricSum;
};

export type PerformanceGroupStats = { key: string; stats: PerformanceStats };

/**
 * The complete input of a report without its evaluations. The database builds
 * it with one aggregate query (`./paper-aggregate`), so a report never needs
 * the evaluations themselves in memory.
 *
 * Groups and skip reasons are listed in the order of their first evaluation:
 * that order decides ties between equally ranked buckets.
 */
export type PerformanceAggregate = {
  overall: PerformanceStats;
  groups: Record<PerformanceGroupBy, PerformanceGroupStats[]>;
  observation: {
    total: number;
    evaluatedCount: number;
    positiveMovementCount: number;
    neutralCount: number;
    negativeCount: number;
    absReturnAfter1d: MetricSum;
  };
  skippedByReason: Array<{ reason: string; count: number }>;
};

export function buildPerformanceBucket(
  key: string,
  label: string,
  evaluations: PaperEvaluationLike[],
  overallWinRate = 0
): PerformanceBucket {
  return bucketFromStats(key, label, collectStats(evaluations), overallWinRate);
}

function bucketFromStats(
  key: string,
  label: string,
  stats: PerformanceStats,
  overallWinRate: number
): PerformanceBucket {
  const wins = stats.positiveCount + stats.targetReachedCount;
  const winRate = stats.evaluatedCount === 0 ? 0 : (wins / stats.evaluatedCount) * 100;
  const bucket: Omit<PerformanceBucket, "insight" | "recommendation"> = {
    key,
    label,
    total: stats.total,
    evaluatedCount: stats.evaluatedCount,
    skippedCount: stats.skippedCount,
    positiveCount: stats.positiveCount,
    negativeCount: stats.negativeCount,
    neutralCount: stats.neutralCount,
    targetReachedCount: stats.targetReachedCount,
    invalidatedCount: stats.invalidatedCount,
    winRate,
    avgReturnAfter1h: mean(stats.returnAfter1h),
    avgReturnAfter4h: mean(stats.returnAfter4h),
    avgReturnAfter1d: mean(stats.returnAfter1d),
    avgReturnAfter3d: mean(stats.returnAfter3d),
    avgMaxFavorableMove: mean(stats.maxFavorableMove),
    avgMaxAdverseMove: mean(stats.maxAdverseMove),
    confidenceLevel: confidenceLevel(stats.evaluatedCount)
  };

  return {
    ...bucket,
    insight: buildInsight(bucket, overallWinRate),
    recommendation: buildRecommendation(bucket)
  };
}

function collectStats(evaluations: PaperEvaluationLike[]): PerformanceStats {
  const evaluated = evaluations.filter((evaluation) => evaluation.evaluationStatus === "EVALUATED");
  const countOutcome = (outcome: string) =>
    evaluated.filter((evaluation) => evaluation.outcome === outcome).length;

  return {
    total: evaluations.length,
    evaluatedCount: evaluated.length,
    skippedCount: evaluations.filter((evaluation) => evaluation.evaluationStatus === "SKIPPED").length,
    positiveCount: countOutcome("POSITIVE"),
    negativeCount: countOutcome("NEGATIVE"),
    neutralCount: countOutcome("NEUTRAL"),
    targetReachedCount: countOutcome("TARGET_REACHED"),
    invalidatedCount: countOutcome("INVALIDATED"),
    returnAfter1h: sumMetric(evaluated.map((evaluation) => evaluation.returnAfter1h)),
    returnAfter4h: sumMetric(evaluated.map((evaluation) => evaluation.returnAfter4h)),
    returnAfter1d: sumMetric(evaluated.map((evaluation) => evaluation.returnAfter1d)),
    returnAfter3d: sumMetric(evaluated.map((evaluation) => evaluation.returnAfter3d)),
    maxFavorableMove: sumMetric(evaluated.map((evaluation) => evaluation.maxFavorableMove)),
    maxAdverseMove: sumMetric(evaluated.map((evaluation) => evaluation.maxAdverseMove))
  };
}

export function buildPerformanceBuckets(
  evaluations: PaperEvaluationLike[],
  groupBy: PerformanceGroupBy,
  overallWinRate = 0
): PerformanceBucket[] {
  return bucketsFromGroups(collectGroups(evaluations, groupBy), groupBy, overallWinRate);
}

export function buildPerformanceBucketsFromAggregate(
  aggregate: PerformanceAggregate,
  groupBy: PerformanceGroupBy,
  overallWinRate = 0
): PerformanceBucket[] {
  return bucketsFromGroups(aggregate.groups[groupBy], groupBy, overallWinRate);
}

function collectGroups(
  evaluations: PaperEvaluationLike[],
  groupBy: PerformanceGroupBy
): PerformanceGroupStats[] {
  const groups = new Map<string, PaperEvaluationLike[]>();

  for (const evaluation of evaluations) {
    const key = getGroupKey(evaluation, groupBy);
    const group = groups.get(key) ?? [];
    group.push(evaluation);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, values]) => ({ key, stats: collectStats(values) }));
}

function bucketsFromGroups(
  groups: PerformanceGroupStats[],
  groupBy: PerformanceGroupBy,
  overallWinRate: number
): PerformanceBucket[] {
  const buckets = groups.map(({ key, stats }) =>
    bucketFromStats(key, getGroupLabel(key, groupBy), stats, overallWinRate)
  );

  if (groupBy === "scoreBucket") {
    return scoreBucketOrder
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

  return buildPerformanceReportFromAggregate(aggregateEvaluations(activeEvaluations), options);
}

export function aggregateEvaluations(evaluations: PaperEvaluationLike[]): PerformanceAggregate {
  const observations = evaluations.filter((evaluation) => evaluation.evaluationKind === "OBSERVATION");
  const evaluatedObservations = observations.filter(
    (evaluation) => evaluation.evaluationStatus === "EVALUATED"
  );
  const countOutcome = (outcome: string) =>
    evaluatedObservations.filter((evaluation) => evaluation.outcome === outcome).length;
  const reasons = new Map<string, number>();
  for (const evaluation of evaluations) {
    if (evaluation.evaluationStatus !== "SKIPPED") continue;
    const reason = evaluation.skipReason ?? "Unspecified";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    overall: collectStats(evaluations),
    groups: {
      signalType: collectGroups(evaluations, "signalType"),
      timeframe: collectGroups(evaluations, "timeframe"),
      symbol: collectGroups(evaluations, "symbol"),
      status: collectGroups(evaluations, "status"),
      riskLevel: collectGroups(evaluations, "riskLevel"),
      evaluationKind: collectGroups(evaluations, "evaluationKind"),
      scoreBucket: collectGroups(evaluations, "scoreBucket")
    },
    observation: {
      total: observations.length,
      evaluatedCount: evaluatedObservations.length,
      positiveMovementCount: countOutcome("POSITIVE"),
      neutralCount: countOutcome("NEUTRAL"),
      negativeCount: countOutcome("NEGATIVE"),
      absReturnAfter1d: sumMetric(
        evaluatedObservations.map((evaluation) =>
          typeof evaluation.returnAfter1d === "number" ? Math.abs(evaluation.returnAfter1d) : null
        )
      )
    },
    skippedByReason: [...reasons.entries()].map(([reason, count]) => ({ reason, count }))
  };
}

/** `includeSkipped` must already be applied to the aggregate. */
export function buildPerformanceReportFromAggregate(
  aggregate: PerformanceAggregate,
  options: BuildReportOptions = {}
): PerformanceIntelligenceReport {
  const overall = bucketFromStats("overall", "Overall", aggregate.overall, 0);
  const buckets = (groupBy: PerformanceGroupBy) =>
    filterByMinEvaluated(
      bucketsFromGroups(aggregate.groups[groupBy], groupBy, overall.winRate),
      options.minEvaluated ?? 0
    );
  const signalTypeBuckets = buckets("signalType");
  const timeframeBuckets = buckets("timeframe");
  const assetBuckets = buckets("symbol");
  const warnings = buildWarnings(overall, aggregate.overall.total);

  return {
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    totalEvaluations: aggregate.overall.total,
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
    scoreBuckets: buckets("scoreBucket"),
    riskBuckets: buckets("riskLevel"),
    statusBuckets: buckets("status"),
    groupedByEvaluationKind: buckets("evaluationKind"),
    observationStats: buildObservationStats(aggregate.observation),
    skippedByReason: buildSkippedByReason(aggregate.skippedByReason),
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

function buildObservationStats(observation: PerformanceAggregate["observation"]): ObservationStats {
  return {
    total: observation.total,
    evaluatedCount: observation.evaluatedCount,
    positiveMovementCount: observation.positiveMovementCount,
    neutralCount: observation.neutralCount,
    negativeCount: observation.negativeCount,
    avgAbsReturnAfter1d: mean(observation.absReturnAfter1d)
  };
}

function buildSkippedByReason(reasons: PerformanceAggregate["skippedByReason"]) {
  const groups: Record<string, number> = {};
  for (const { reason, count } of reasons) groups[reason] = count;
  return groups;
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

function sumMetric(values: Array<number | null | undefined>): MetricSum {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value !== "number") continue;
    sum += value;
    count += 1;
  }
  return { sum, count };
}

function mean(metric: MetricSum) {
  return metric.count === 0 ? 0 : metric.sum / metric.count;
}
