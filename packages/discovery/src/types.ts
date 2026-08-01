export type DiscoveryAssetClass = "CRYPTO" | "STOCK" | "ETF";

export type DiscoveryInstrument = {
  provider: string;
  providerSymbol: string;
  symbol: string;
  name: string;
  assetType: DiscoveryAssetClass;
  exchange: string;
  mic?: string | null;
  currency?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
  sector?: string | null;
  industry?: string | null;
  status: "ACTIVE" | "INACTIVE" | "DELISTED" | "UNKNOWN";
  tradable: boolean;
  leveraged: boolean;
  inverse: boolean;
  stablecoin: boolean;
  metadata?: Record<string, unknown>;
};

export type DiscoveryMarketSnapshot = {
  provider: string;
  providerSymbol: string;
  observedAt: Date;
  price: number | null;
  quoteVolume24h: number | null;
  baseVolume24h: number | null;
  priceChangePercent24h: number | null;
  high24h: number | null;
  low24h: number | null;
  tradeCount24h: number | null;
};

export type DiscoveryCandle = {
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe?: string;
};

export type HistoricalQuality = {
  sampleSize: number;
  winRate: number | null;
  averageReturn: number | null;
};

export const discoveryComponentKeys = [
  "liquidity",
  "tradingVolume",
  "volumeChange",
  "volatility",
  "priceMovement",
  "trendStrength",
  "relativeStrength",
  "breakoutProximity",
  "multiTimeframeConfluence",
  "dataFreshness",
  "dataCompleteness",
  "newsActivity",
  "unusualActivity",
  "historicalSignalQuality",
  "paperAndBacktestQuality"
] as const;

export type DiscoveryComponentKey = (typeof discoveryComponentKeys)[number];
export type DiscoveryScoreComponents = Record<DiscoveryComponentKey, number>;
export type DiscoveryScoreWeights = Record<DiscoveryComponentKey, number>;

export type DiscoveryPolicy = {
  version: string;
  weights: Record<DiscoveryAssetClass, DiscoveryScoreWeights>;
  minimumDataQuality: number;
  minimumLiquidity: number;
  minimumScore: number;
  minimumCandles: number;
  maximumCandidateScoreWithoutCandles: number;
  activeLimits: Record<DiscoveryAssetClass, number>;
  maxPerSector: number;
  maxCorrelatedAssets: number;
  correlationThreshold: number;
  minimumDaysActive: number;
  replacementScoreDelta: number;
  maxAdditionsPerRun: number;
  maxRemovalsPerRun: number;
  removalCooldownDays: number;
  allowLeveragedEtfs: boolean;
  allowStablecoins: boolean;
};

export type DiscoveryScoreInput = {
  assetType: DiscoveryAssetClass;
  snapshot?: DiscoveryMarketSnapshot | null;
  candles?: DiscoveryCandle[];
  benchmarkCandles?: DiscoveryCandle[];
  newsActivity?: number;
  eventActivity?: number;
  historicalSignals?: HistoricalQuality;
  paperEvaluation?: HistoricalQuality;
  backtest?: HistoricalQuality;
  now?: Date;
};

export type DiscoveryScoreResult = {
  score: number;
  rawScore: number;
  confidence: number;
  dataQuality: number;
  liquidity: number;
  sampleSize: number;
  eligible: boolean;
  exclusionReasons: string[];
  reasons: string[];
  components: DiscoveryScoreComponents;
  weights: DiscoveryScoreWeights;
  metrics: Record<string, number | null>;
};

export type UniverseSelectionCandidate = {
  assetId: string;
  symbol: string;
  assetType: DiscoveryAssetClass;
  sector?: string | null;
  score: number;
  dataQuality: number;
  liquidity: number;
  eligible: boolean;
  isActive: boolean;
  isCore: boolean;
  isPinned: boolean;
  isManual: boolean;
  isExcluded: boolean;
  isObserveOnly?: boolean;
  activeSince?: Date | null;
  cooldownUntil?: Date | null;
  correlationGroup?: string | null;
  correlations?: Record<string, number>;
};

export type UniverseSelectionDecision = {
  assetId: string;
  symbol: string;
  action: "ADD" | "REMOVE" | "KEEP" | "IGNORE";
  reason: string;
  score: number;
};

export type UniverseSelectionResult = {
  selectedAssetIds: string[];
  decisions: UniverseSelectionDecision[];
  additions: UniverseSelectionDecision[];
  removals: UniverseSelectionDecision[];
  retained: UniverseSelectionDecision[];
  ignored: UniverseSelectionDecision[];
};
