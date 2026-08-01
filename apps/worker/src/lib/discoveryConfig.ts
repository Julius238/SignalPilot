import {
  defaultDiscoveryPolicy,
  mergeDiscoveryPolicy,
  type DiscoveryPolicy,
  type DiscoveryScoreWeights
} from "@signalpilot/discovery";

export type AssetDiscoverySettings = {
  enabled: boolean;
  dryRun: boolean;
  cron: string;
  maxCandidates: number;
  verificationCandleLimit: number;
  summaryEnabled: boolean;
  requestDelayMs: number;
  policy: DiscoveryPolicy;
};

export function resolveAssetDiscoverySettings(
  env: NodeJS.ProcessEnv = process.env
): AssetDiscoverySettings {
  const enabled = env.ASSET_DISCOVERY_ENABLED === "true";
  const dryRun = env.ASSET_DISCOVERY_DRY_RUN !== "false";
  const weights = parseWeights(env.ASSET_DISCOVERY_SCORE_WEIGHTS_JSON);

  return {
    enabled,
    dryRun,
    cron: env.ASSET_DISCOVERY_CRON ?? "30 2 * * *",
    maxCandidates: positiveInteger(env.ASSET_DISCOVERY_MAX_CANDIDATES, 45, 500),
    verificationCandleLimit: positiveInteger(
      env.ASSET_DISCOVERY_VERIFICATION_CANDLE_LIMIT,
      80,
      500
    ),
    summaryEnabled: env.ASSET_DISCOVERY_SUMMARY_ENABLED !== "false",
    requestDelayMs: nonNegativeInteger(env.MARKET_DATA_REQUEST_DELAY_MS, 500, 60_000),
    policy: mergeDiscoveryPolicy({
      version: env.ASSET_DISCOVERY_POLICY_VERSION ?? defaultDiscoveryPolicy.version,
      minimumScore: numberValue(
        env.ASSET_DISCOVERY_MIN_SCORE,
        defaultDiscoveryPolicy.minimumScore,
        0,
        100
      ),
      minimumDataQuality: numberValue(
        env.ASSET_DISCOVERY_MIN_DATA_QUALITY,
        defaultDiscoveryPolicy.minimumDataQuality,
        0,
        100
      ),
      minimumLiquidity: numberValue(
        env.ASSET_DISCOVERY_MIN_LIQUIDITY,
        defaultDiscoveryPolicy.minimumLiquidity,
        0,
        100
      ),
      minimumDaysActive: positiveInteger(
        env.ASSET_DISCOVERY_MIN_DAYS_ACTIVE,
        defaultDiscoveryPolicy.minimumDaysActive,
        365
      ),
      replacementScoreDelta: numberValue(
        env.ASSET_DISCOVERY_REPLACEMENT_SCORE_DELTA,
        defaultDiscoveryPolicy.replacementScoreDelta,
        0,
        100
      ),
      maxAdditionsPerRun: positiveInteger(
        env.ASSET_DISCOVERY_MAX_ADDITIONS_PER_RUN,
        defaultDiscoveryPolicy.maxAdditionsPerRun,
        100
      ),
      maxRemovalsPerRun: positiveInteger(
        env.ASSET_DISCOVERY_MAX_REMOVALS_PER_RUN,
        defaultDiscoveryPolicy.maxRemovalsPerRun,
        100
      ),
      removalCooldownDays: positiveInteger(
        env.ASSET_DISCOVERY_REMOVAL_COOLDOWN_DAYS,
        defaultDiscoveryPolicy.removalCooldownDays,
        365
      ),
      maxPerSector: positiveInteger(
        env.ASSET_DISCOVERY_MAX_PER_SECTOR,
        defaultDiscoveryPolicy.maxPerSector,
        100
      ),
      maxCorrelatedAssets: positiveInteger(
        env.ASSET_DISCOVERY_MAX_CORRELATED_ASSETS,
        defaultDiscoveryPolicy.maxCorrelatedAssets,
        100
      ),
      correlationThreshold: numberValue(
        env.ASSET_DISCOVERY_CORRELATION_THRESHOLD,
        defaultDiscoveryPolicy.correlationThreshold,
        0,
        1
      ),
      allowLeveragedEtfs: env.ASSET_DISCOVERY_ALLOW_LEVERAGED_ETFS === "true",
      allowStablecoins: env.ASSET_DISCOVERY_ALLOW_STABLECOINS === "true",
      activeLimits: {
        CRYPTO: positiveInteger(
          env.ASSET_DISCOVERY_ACTIVE_CRYPTO_LIMIT,
          defaultDiscoveryPolicy.activeLimits.CRYPTO,
          500
        ),
        STOCK: positiveInteger(
          env.ASSET_DISCOVERY_ACTIVE_EQUITY_LIMIT,
          defaultDiscoveryPolicy.activeLimits.STOCK,
          500
        ),
        ETF: positiveInteger(
          env.ASSET_DISCOVERY_ACTIVE_ETF_LIMIT,
          defaultDiscoveryPolicy.activeLimits.ETF,
          500
        )
      },
      weights
    })
  };
}

export function discoveryRunKey(
  kind: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env
) {
  const base = env.ASSET_DISCOVERY_RUN_KEY ?? now.toISOString().slice(0, 10);
  return `${base}:${kind}`;
}

function parseWeights(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      CRYPTO: recordWeights(parsed.CRYPTO),
      STOCK: recordWeights(parsed.STOCK),
      ETF: recordWeights(parsed.ETF)
    };
  } catch {
    return undefined;
  }
}

function recordWeights(value: unknown): Partial<DiscoveryScoreWeights> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, weight]) => [key, Number(weight)] as const)
      .filter(([, weight]) => Number.isFinite(weight) && weight >= 0)
  ) as Partial<DiscoveryScoreWeights>;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function numberValue(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
