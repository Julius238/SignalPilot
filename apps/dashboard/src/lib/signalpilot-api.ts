export type AssetType = "STOCK" | "ETF" | "CRYPTO";
export type SignalStatus = "STRONG_WATCH" | "WATCH" | "WAIT" | "AVOID" | "NO_EDGE";
export type SignalDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type WatchlistPriority = "LOW" | "MEDIUM" | "HIGH";
export type PaperEvaluationStatus = "OPEN" | "EVALUATED" | "EXPIRED" | "SKIPPED";
export type PaperEvaluationKind =
  | "DIRECTIONAL_BULLISH"
  | "DIRECTIONAL_BEARISH"
  | "RISK_WARNING"
  | "OBSERVATION"
  | "SKIPPED";
export type PaperExpectedMoveDirection = "UP" | "DOWN" | "ANY" | "NONE";
export type PaperEvaluationOutcome =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "INVALIDATED"
  | "TARGET_REACHED";
export type MultiTimeframeAlignment =
  | "BULLISH_ALIGNED"
  | "BEARISH_ALIGNED"
  | "MIXED"
  | "SHORT_TERM_ONLY"
  | "HIGHER_TIMEFRAME_CONFIRMATION"
  | "CONFLICT"
  | "NO_EDGE";

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  exchange: string;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SignalOutput = {
  id: string;
  signalId: string;
  shortConclusion: string;
  counterArgument?: string;
  nextTrigger: string;
  telegramText?: string;
  dashboardJson?: unknown;
  technicalJson?: unknown;
  intelligenceJson?: unknown;
  marketConfirmationJson?: unknown;
  createdAt: string;
};

export type SignalListItem = {
  id: string;
  symbol: string;
  timeframe: string;
  signalType: string;
  status: SignalStatus;
  direction: SignalDirection;
  score: number;
  riskLevel: RiskLevel;
  riskScore?: number;
  createdAt: string;
  asset: Asset;
  signalOutput: SignalOutput | null;
};

export type MultiTimeframeSummary = {
  symbol: string;
  alignment: MultiTimeframeAlignment;
  alignmentScore: number;
  primaryTimeframe: string | null;
  confirmingTimeframes: string[];
  conflictingTimeframes: string[];
  strongestSignal: Omit<SignalListItem, "asset" | "signalOutput"> | null;
  weakestSignal: Omit<SignalListItem, "asset" | "signalOutput"> | null;
  riskLevel: RiskLevel;
  summary: string;
  riskNote: string;
  nextFocus: string;
};

export type SignalDetail = {
  signal: SignalListItem["id"] extends string
    ? {
        id: string;
        assetId: string;
        symbol: string;
        timeframe: string;
        signalType: string;
        status: SignalStatus;
        direction: SignalDirection;
        score: number;
        riskLevel: RiskLevel;
        trendScore: number;
        momentumScore: number;
        volumeScore: number;
        volatilityScore: number;
        rsiScore: number;
        newsScore: number;
        socialScore: number;
        eventScore: number;
        riskScore: number;
        createdAt: string;
      }
    : never;
  asset: Asset;
  signalOutput: SignalOutput | null;
  paperEvaluation: PaperSignalEvaluation | null;
  candles: Candle[];
};

export type Candle = {
  id: string;
  symbol: string;
  timeframe: string;
  openTime: string;
  closeTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: string;
};

export type AssetDetail = Asset & {
  isWatchlisted: boolean;
  watchlistItem: WatchlistItem | null;
  latestSignal: Omit<SignalListItem, "asset" | "signalOutput"> | null;
  latestSignalOutput: SignalOutput | null;
  multiTimeframeSummary: MultiTimeframeSummary | null;
  candleCounts: Record<string, number>;
  candles?: Candle[];
};

export type BotRun = {
  id: string;
  jobName: string;
  status: "SUCCESS" | "FAILED" | "RUNNING";
  startedAt: string;
  finishedAt: string | null;
  metadataJson: unknown;
};

export type BotLog = {
  id: string;
  level: string;
  service: string;
  message: string;
  metadataJson: unknown;
  createdAt: string;
};

export type Alert = {
  id: string;
  signalId: string | null;
  channel: string;
  status: "PENDING" | "SENT" | "FAILED";
  payloadJson: unknown;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  signal?: {
    id: string;
    symbol: string;
    timeframe: string;
    status: SignalStatus;
    signalType: string;
    score: number;
  } | null;
};

export type AlertState = {
  id: string;
  symbol: string;
  assetId: string;
  timeframe: string;
  signalType: string;
  status: SignalStatus;
  direction: SignalDirection;
  lastSignalId: string | null;
  lastAlertId: string | null;
  lastScore: number;
  lastRiskLevel: RiskLevel;
  lastAlignment: string | null;
  lastAlignmentScore: number | null;
  lastSentAt: string;
  sendCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PaperSignalEvaluation = {
  id: string;
  signalId: string;
  assetId: string;
  symbol: string;
  timeframe: string;
  direction: SignalDirection;
  status: SignalStatus;
  signalType: string;
  score: number;
  riskLevel: RiskLevel;
  entryPrice: string;
  invalidationPrice: string | null;
  targetPrice: string | null;
  evaluationKind: PaperEvaluationKind;
  expectedMoveDirection: PaperExpectedMoveDirection;
  evaluationStatus: PaperEvaluationStatus;
  skipReason: string | null;
  openedAt: string;
  evaluatedAt: string | null;
  priceAfter1h: string | null;
  priceAfter4h: string | null;
  priceAfter1d: string | null;
  priceAfter3d: string | null;
  returnAfter1h: number | null;
  returnAfter4h: number | null;
  returnAfter1d: number | null;
  returnAfter3d: number | null;
  maxFavorableMove: number | null;
  maxAdverseMove: number | null;
  outcome: PaperEvaluationOutcome | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperStats = {
  totalEvaluations: number;
  openCount: number;
  evaluatedCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  winRate: number;
  avgReturnAfter1h: number;
  avgReturnAfter4h: number;
  avgReturnAfter1d: number;
  avgMaxFavorableMove: number;
  avgMaxAdverseMove: number;
  groupedBySignalStatus: Record<string, number>;
  groupedBySignalType: Record<string, number>;
  groupedByTimeframe: Record<string, number>;
  byEvaluationKind: Record<string, number>;
  skippedByReason: Record<string, number>;
  observationStats: ObservationStats;
};

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

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

export type ObservationStats = {
  total: number;
  evaluatedCount: number;
  positiveMovementCount: number;
  neutralCount: number;
  negativeCount: number;
  avgAbsReturnAfter1d: number;
};

export type EventItem = {
  id: string;
  assetId: string | null;
  symbol: string | null;
  eventType: string;
  title: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  eventDate: string | null;
  eventTime: string | null;
  fiscalQuarter: string | null;
  fiscalYear: number | null;
  epsEstimate: string | null;
  epsActual: string | null;
  revenueEstimate: string | null;
  revenueActual: string | null;
  importance: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventContextItem = {
  id: string;
  symbol: string;
  eventType: string;
  title: string;
  eventDate: string;
  fiscalQuarter: string | null;
  fiscalYear: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  daysFromNow: number;
};

export type EventRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "NONE";

export type EventContext = {
  hasUpcomingEvent: boolean;
  hasRecentEvent: boolean;
  upcomingEvents: EventContextItem[];
  recentEvents: EventContextItem[];
  nearestEvent: EventContextItem | null;
  eventRiskLevel: EventRiskLevel;
  daysToNearestEvent: number | null;
  daysSinceRecentEvent: number | null;
  summary: string;
  riskNote: string;
  sourceNote: string;
};

export type NewsItem = {
  id: string;
  assetId: string | null;
  symbol: string;
  source: string;
  headline: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  publishedAt: string;
  category: string | null;
  sentiment: string | null;
  relevanceScore: number | null;
  createdAt: string;
  updatedAt: string;
};

export type NewsContextItem = {
  headline: string;
  source: string;
  publishedAt: string;
  url: string | null;
  sentiment: string;
};

export type NewsContext = {
  hasRecentNews: boolean;
  recentNewsCount: number;
  relevantNewsCount: number;
  topNews: NewsContextItem[];
  relevanceScore: number;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  summary: string;
  riskNote: string;
  sourceNote: string;
};

export type PublicConfig = {
  alertMode: "ALL_ASSETS" | "WATCHLIST_ONLY" | "HIGH_PRIORITY_ONLY";
  alertCooldownMinutes: number;
  alertScoreImprovementThreshold: number;
  dashboardOrigin?: string;
  liveTradingEnabled: boolean;
  paperTradingOnly: boolean;
};

export type ScannerGroupKey =
  | "strongWatch"
  | "watchlist"
  | "volumeSpikes"
  | "breakouts"
  | "highRisk"
  | "noEdge";

export type ScannerResponse = {
  summary: {
    strongWatchCount: number;
    watchCount: number;
    alertsSentToday: number;
    lastPipelineRunStatus: BotRun["status"] | null;
    lastPipelineRunAt: string | null;
    bullishAlignedCount: number;
    bearishAlignedCount: number;
    conflictCount: number;
    noEdgeCount: number;
  };
  groups: Record<ScannerGroupKey, SignalListItem[]>;
  multiTimeframeSummaries: Record<string, MultiTimeframeSummary>;
};

export type MultiTimeframeScannerItem = {
  asset: Asset;
  latestSignalsByTimeframe: Partial<
    Record<string, Omit<SignalListItem, "asset" | "signalOutput">>
  >;
  multiTimeframeSummary: MultiTimeframeSummary;
};

export type WatchlistItem = {
  id: string;
  assetId: string;
  symbol: string;
  priority: WatchlistPriority;
  notes: string | null;
  alertEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  asset: Asset;
  latestSignal: Omit<SignalListItem, "asset" | "signalOutput"> | null;
  latestSignalOutput: SignalOutput | null;
  multiTimeframeSummary: MultiTimeframeSummary | null;
};

export type ApiResult<T> =
  | {
      data: T;
      error: null;
    }
  | {
      data: null;
      error: string;
    };

const apiUrl = process.env.NEXT_PUBLIC_SIGNALPILOT_API_URL ?? "http://localhost:3100";

export async function fetchApi<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        typeof body?.message === "string"
          ? body.message
          : `SignalPilot API returned HTTP ${response.status}`;

      return {
        data: null,
        error: message
      };
    }

    if (response.status === 204) {
      return {
        data: null as T,
        error: null
      };
    }

    return {
      data: (await response.json()) as T,
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to reach SignalPilot API"
    };
  }
}

export async function mutateApi<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  return fetchApi<T>(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

export function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }

  const value = query.toString();
  return value ? `?${value}` : "";
}
