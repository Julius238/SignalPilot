import type {
  DiscoveryAssetClass,
  DiscoveryPolicy,
  DiscoveryScoreWeights
} from "./types.js";

const baseWeights: DiscoveryScoreWeights = {
  liquidity: 13,
  tradingVolume: 9,
  volumeChange: 7,
  volatility: 6,
  priceMovement: 6,
  trendStrength: 9,
  relativeStrength: 7,
  breakoutProximity: 7,
  multiTimeframeConfluence: 6,
  dataFreshness: 8,
  dataCompleteness: 10,
  newsActivity: 3,
  unusualActivity: 4,
  historicalSignalQuality: 2,
  paperAndBacktestQuality: 3
};

const cryptoWeights: DiscoveryScoreWeights = {
  ...baseWeights,
  liquidity: 15,
  tradingVolume: 11,
  newsActivity: 1,
  paperAndBacktestQuality: 2
};

const equityWeights: DiscoveryScoreWeights = {
  ...baseWeights,
  newsActivity: 5,
  paperAndBacktestQuality: 4,
  liquidity: 12,
  tradingVolume: 8
};

const etfWeights: DiscoveryScoreWeights = {
  ...baseWeights,
  newsActivity: 1,
  trendStrength: 11,
  relativeStrength: 9,
  liquidity: 15
};

export const defaultDiscoveryPolicy: DiscoveryPolicy = {
  version: "discovery-v1.0.0",
  weights: {
    CRYPTO: cryptoWeights,
    STOCK: equityWeights,
    ETF: etfWeights
  },
  minimumDataQuality: 70,
  minimumLiquidity: 60,
  minimumScore: 62,
  minimumCandles: 40,
  maximumCandidateScoreWithoutCandles: 48,
  activeLimits: {
    CRYPTO: 12,
    STOCK: 15,
    ETF: 8
  },
  maxPerSector: 3,
  maxCorrelatedAssets: 2,
  correlationThreshold: 0.85,
  minimumDaysActive: 7,
  replacementScoreDelta: 8,
  maxAdditionsPerRun: 3,
  maxRemovalsPerRun: 3,
  removalCooldownDays: 14,
  allowLeveragedEtfs: false,
  allowStablecoins: false
};

export function mergeDiscoveryPolicy(
  overrides: Partial<Omit<DiscoveryPolicy, "weights" | "activeLimits">> & {
    weights?: Partial<Record<DiscoveryAssetClass, Partial<DiscoveryScoreWeights>>>;
    activeLimits?: Partial<Record<DiscoveryAssetClass, number>>;
  } = {}
): DiscoveryPolicy {
  return {
    ...defaultDiscoveryPolicy,
    ...overrides,
    weights: {
      CRYPTO: { ...defaultDiscoveryPolicy.weights.CRYPTO, ...overrides.weights?.CRYPTO },
      STOCK: { ...defaultDiscoveryPolicy.weights.STOCK, ...overrides.weights?.STOCK },
      ETF: { ...defaultDiscoveryPolicy.weights.ETF, ...overrides.weights?.ETF }
    },
    activeLimits: {
      ...defaultDiscoveryPolicy.activeLimits,
      ...overrides.activeLimits
    }
  };
}
