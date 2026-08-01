import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scoreDiscoveryAsset,
  type DiscoveryCandle,
  type DiscoveryInstrument,
  type DiscoveryMarketSnapshot,
  type HistoricalQuality
} from "@signalpilot/discovery";
import {
  AssetDiscoveryAction,
  AssetDiscoveryCandidateStatus,
  AssetDiscoveryRunKind,
  AssetType,
  BotRunStatus,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  createDefaultDiscoveryProviders,
  type AssetDiscoveryProvider
} from "@signalpilot/market-data";
import { config } from "dotenv";

import { resolveAssetDiscoverySettings } from "../lib/discoveryConfig.js";
import {
  finishDiscoveryRun,
  startDiscoveryRun,
  writeDiscoveryLog
} from "../lib/discoveryRun.js";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

type ScanAsset = Awaited<ReturnType<typeof loadAssets>>[number];

export type DiscoveryScanSummary = {
  status: BotRunStatus;
  enabled: boolean;
  dryRun: boolean;
  checkedAssetCount: number;
  excludedAssetCount: number;
  candidateCount: number;
  eligibleCandidateCount: number;
  providerRequestCount: number;
  estimatedApiUnits: number;
  errorCount: number;
  exclusionReasons: Record<string, number>;
  discoveryRunId: string;
};

export async function discoveryScan(
  database: PrismaClient = prisma,
  providers: AssetDiscoveryProvider[] = createDefaultDiscoveryProviders(),
  now: Date = new Date()
): Promise<DiscoveryScanSummary> {
  const settings = resolveAssetDiscoverySettings();
  const context = await startDiscoveryRun(database, {
    kind: AssetDiscoveryRunKind.DISCOVERY_SCAN,
    jobName: "assetDiscoveryScan",
    settings,
    now
  });
  const summary: DiscoveryScanSummary = {
    status: BotRunStatus.RUNNING,
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    checkedAssetCount: 0,
    excludedAssetCount: 0,
    candidateCount: 0,
    eligibleCandidateCount: 0,
    providerRequestCount: 0,
    estimatedApiUnits: 0,
    errorCount: 0,
    exclusionReasons: {},
    discoveryRunId: context.discoveryRunId
  };

  try {
    if (!settings.enabled) {
      summary.status = BotRunStatus.SUCCESS;
      await finishDiscoveryRun(database, context, {
        status: summary.status,
        metrics: summary
      });
      return summary;
    }

    const assets = await loadAssets(
      database,
      settings.policy.allowLeveragedEtfs,
      settings.policy.allowStablecoins
    );
    summary.checkedAssetCount = assets.length;
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const snapshots = new Map<string, DiscoveryMarketSnapshot>();

    for (const provider of providers) {
      try {
        const response = await provider.fetchMarketSnapshots();
        summary.providerRequestCount += response.usage.requestCount;
        summary.estimatedApiUnits += response.usage.estimatedApiUnits;
        for (const snapshot of response.data) {
          snapshots.set(providerKey(snapshot.provider, snapshot.providerSymbol), snapshot);
        }
      } catch (error) {
        summary.errorCount += 1;
        await writeDiscoveryLog(database, "warn", "Markt-Snapshots teilweise fehlgeschlagen", {
          discoveryRunId: context.discoveryRunId,
          provider: provider.id,
          error: error instanceof Error ? error.message : "Unknown snapshot error"
        });
      }
    }

    const pool = buildVerificationPool(assets, snapshots, settings.maxCandidates, now);
    summary.candidateCount = pool.length;
    summary.excludedAssetCount = Math.max(0, assets.length - pool.length);
    if (summary.excludedAssetCount > 0) {
      summary.exclusionReasons.FUNNEL_NOT_SHORTLISTED = summary.excludedAssetCount;
    }
    const candidateIds = pool.map((asset) => asset.id);
    await database.assetDiscoveryCandidate.updateMany({
      where: {
        discoveryRunId: context.discoveryRunId,
        assetId: { notIn: candidateIds }
      },
      data: {
        status: AssetDiscoveryCandidateStatus.EXCLUDED,
        proposedAction: AssetDiscoveryAction.NONE,
        selected: false,
        exclusionReasonsJson: ["FUNNEL_NOT_SHORTLISTED_CURRENT_ATTEMPT"]
      }
    });
    const [history, benchmarkByType, newsCounts] = await Promise.all([
      loadHistoricalQuality(database, candidateIds),
      loadBenchmarks(database),
      loadNewsCounts(database, candidateIds, now)
    ]);
    const results: Array<{ assetId: string; score: number }> = [];

    for (const asset of pool) {
      const providerId = asset.provider ?? defaultProvider(asset.assetType);
      const provider = providerById.get(providerId);
      const instrument = toInstrument(asset, providerId);
      const snapshot =
        snapshots.get(providerKey(providerId, asset.providerSymbol ?? asset.symbol)) ?? null;
      let candles = await loadExistingCandles(database, asset);

      try {
        if (candles.length < settings.policy.minimumCandles && provider) {
          const response = await provider.fetchVerificationCandles(
            instrument,
            settings.verificationCandleLimit,
            now
          );
          candles = response.data;
          summary.providerRequestCount += response.usage.requestCount;
          summary.estimatedApiUnits += response.usage.estimatedApiUnits;
          await delay(settings.requestDelayMs);
        }
      } catch (error) {
        summary.errorCount += 1;
        await writeDiscoveryLog(database, "warn", "Kandidatenprüfung teilweise fehlgeschlagen", {
          discoveryRunId: context.discoveryRunId,
          provider: providerId,
          symbol: asset.symbol,
          error: error instanceof Error ? error.message : "Unknown verification error"
        });
      }

      const derivedSnapshot = snapshot ?? snapshotFromCandles(providerId, instrument, candles);
      const score = scoreDiscoveryAsset(
        {
          assetType: toDiscoveryAssetType(asset.assetType),
          snapshot: derivedSnapshot,
          candles,
          benchmarkCandles: benchmarkByType.get(asset.assetType) ?? [],
          newsActivity: newsCounts.get(asset.id) ?? 0,
          historicalSignals: history.signals.get(asset.id),
          paperEvaluation: history.paper.get(asset.id),
          backtest: history.backtests.get(asset.id),
          now
        },
        settings.policy
      );
      for (const reason of score.exclusionReasons) {
        summary.exclusionReasons[reason] = (summary.exclusionReasons[reason] ?? 0) + 1;
      }
      if (score.eligible) summary.eligibleCandidateCount += 1;

      const candidate = await database.assetDiscoveryCandidate.upsert({
        where: {
          discoveryRunId_assetId: {
            discoveryRunId: context.discoveryRunId,
            assetId: asset.id
          }
        },
        create: {
          discoveryRunId: context.discoveryRunId,
          assetId: asset.id,
          status: score.eligible
            ? AssetDiscoveryCandidateStatus.ELIGIBLE
            : AssetDiscoveryCandidateStatus.EXCLUDED,
          score: score.score,
          confidence: score.confidence,
          dataQuality: score.dataQuality,
          liquidity: score.liquidity,
          reasonsJson: score.reasons,
          exclusionReasonsJson: score.exclusionReasons,
          metricsJson: {
            ...score.metrics,
            returnSeries: returnSeries(candles),
            provider: providerId
          },
          providerMetadataJson: asset.providerMetadataJson ?? Prisma.JsonNull
        },
        update: {
          status: score.eligible
            ? AssetDiscoveryCandidateStatus.ELIGIBLE
            : AssetDiscoveryCandidateStatus.EXCLUDED,
          score: score.score,
          confidence: score.confidence,
          dataQuality: score.dataQuality,
          liquidity: score.liquidity,
          reasonsJson: score.reasons,
          exclusionReasonsJson: score.exclusionReasons,
          metricsJson: {
            ...score.metrics,
            returnSeries: returnSeries(candles),
            provider: providerId
          },
          providerMetadataJson: asset.providerMetadataJson ?? Prisma.JsonNull
        }
      });
      await database.discoveryScoreSnapshot.upsert({
        where: { candidateId: candidate.id },
        create: {
          discoveryRunId: context.discoveryRunId,
          candidateId: candidate.id,
          assetId: asset.id,
          score: score.score,
          rawScore: score.rawScore,
          confidence: score.confidence,
          dataQuality: score.dataQuality,
          liquidity: score.liquidity,
          sampleSize: score.sampleSize,
          policyVersion: settings.policy.version,
          componentsJson: score.components,
          weightsJson: score.weights,
          metricsJson: score.metrics as Prisma.InputJsonObject
        },
        update: {
          score: score.score,
          rawScore: score.rawScore,
          confidence: score.confidence,
          dataQuality: score.dataQuality,
          liquidity: score.liquidity,
          sampleSize: score.sampleSize,
          policyVersion: settings.policy.version,
          componentsJson: score.components,
          weightsJson: score.weights,
          metricsJson: score.metrics as Prisma.InputJsonObject
        }
      });
      results.push({ assetId: asset.id, score: score.score });
    }

    const ranked = results.sort(
      (left, right) => right.score - left.score || left.assetId.localeCompare(right.assetId)
    );
    for (const [index, result] of ranked.entries()) {
      await database.assetDiscoveryCandidate.update({
        where: {
          discoveryRunId_assetId: {
            discoveryRunId: context.discoveryRunId,
            assetId: result.assetId
          }
        },
        data: { rank: index + 1 }
      });
    }

    summary.status = BotRunStatus.SUCCESS;
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: summary
    });
    await database.assetDiscoveryRun.update({
      where: { id: context.discoveryRunId },
      data: { exclusionReasonsJson: summary.exclusionReasons }
    });
    await writeDiscoveryLog(database, summary.errorCount > 0 ? "warn" : "info", "Discovery Scan abgeschlossen", {
      ...summary
    });
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    const message = error instanceof Error ? error.message : "Unknown discovery scan error";
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: summary,
      error: message
    });
    throw error;
  }
}

async function loadAssets(
  database: PrismaClient,
  allowLeveragedEtfs: boolean,
  allowStablecoins: boolean
) {
  return database.asset.findMany({
    where: {
      instrumentStatus: "ACTIVE",
      isTradable: true,
      AND: [
        allowLeveragedEtfs
          ? {
              OR: [
                { isLeveraged: false, isInverse: false },
                { assetType: AssetType.ETF }
              ]
            }
          : { isLeveraged: false, isInverse: false },
        allowStablecoins
          ? {}
          : {
              OR: [
                { assetType: { not: AssetType.CRYPTO } },
                { isStablecoin: false }
              ]
            }
      ],
      universePreference: {
        is: { isExcluded: false }
      }
    },
    include: {
      universePreference: true,
      universeMemberships: {
        where: { isCurrent: true },
        take: 1
      }
    },
    orderBy: [{ assetType: "asc" }, { symbol: "asc" }]
  });
}

function buildVerificationPool(
  assets: ScanAsset[],
  snapshots: Map<string, DiscoveryMarketSnapshot>,
  maxCandidates: number,
  now: Date
) {
  const mandatory = assets.filter(
    (asset) =>
      asset.isActive ||
      asset.universePreference?.isPinned ||
      asset.universePreference?.manualActive ||
      asset.universeMemberships[0]?.role === "CORE"
  );
  const mandatoryIds = new Set(mandatory.map((asset) => asset.id));
  const remaining = assets.filter((asset) => !mandatoryIds.has(asset.id));
  const quotas = {
    CRYPTO: Math.max(1, Math.floor(maxCandidates * 0.4)),
    STOCK: Math.max(1, Math.floor(maxCandidates * 0.4)),
    ETF: Math.max(1, Math.floor(maxCandidates * 0.2))
  };
  const dayOffset = Math.floor(now.getTime() / 86_400_000);
  const selected: ScanAsset[] = [...mandatory];

  for (const assetType of [AssetType.CRYPTO, AssetType.STOCK, AssetType.ETF]) {
    const classAssets = remaining
      .filter((asset) => asset.assetType === assetType)
      .sort((left, right) => {
        const rightSnapshot = snapshots.get(
          providerKey(
            right.provider ?? defaultProvider(right.assetType),
            right.providerSymbol ?? right.symbol
          )
        );
        const leftSnapshot = snapshots.get(
          providerKey(
            left.provider ?? defaultProvider(left.assetType),
            left.providerSymbol ?? left.symbol
          )
        );
        const volumeDelta =
          (rightSnapshot?.quoteVolume24h ?? 0) - (leftSnapshot?.quoteVolume24h ?? 0);
        if (volumeDelta !== 0) return volumeDelta;
        return rotatingRank(left.symbol, dayOffset) - rotatingRank(right.symbol, dayOffset);
      })
      .slice(0, quotas[assetType]);
    selected.push(...classAssets);
  }

  return selected.slice(0, Math.max(maxCandidates, mandatory.length));
}

async function loadExistingCandles(
  database: PrismaClient,
  asset: Pick<ScanAsset, "id" | "assetType">
): Promise<DiscoveryCandle[]> {
  const timeframe = asset.assetType === AssetType.CRYPTO ? "1h" : "1d";
  const candles = await database.candle.findMany({
    where: { assetId: asset.id, timeframe },
    orderBy: { openTime: "desc" },
    take: 120
  });
  return candles.reverse().map((candle) => ({
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume),
    timeframe: candle.timeframe
  }));
}

async function loadBenchmarks(database: PrismaClient) {
  const benchmarks = await database.asset.findMany({
    where: { symbol: { in: ["BTCUSDT", "SPY"] } },
    select: { id: true, symbol: true }
  });
  const result = new Map<AssetType, DiscoveryCandle[]>();
  for (const benchmark of benchmarks) {
    const assetType =
      benchmark.symbol === "BTCUSDT" ? AssetType.CRYPTO : AssetType.STOCK;
    const candles = await database.candle.findMany({
      where: {
        assetId: benchmark.id,
        timeframe: benchmark.symbol === "BTCUSDT" ? "1h" : "1d"
      },
      orderBy: { openTime: "desc" },
      take: 120
    });
    const mapped = candles.reverse().map((candle) => ({
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume)
    }));
    result.set(assetType, mapped);
    if (assetType === AssetType.STOCK) result.set(AssetType.ETF, mapped);
  }
  return result;
}

async function loadHistoricalQuality(database: PrismaClient, assetIds: string[]) {
  if (assetIds.length === 0) {
    return {
      signals: new Map<string, HistoricalQuality>(),
      paper: new Map<string, HistoricalQuality>(),
      backtests: new Map<string, HistoricalQuality>()
    };
  }
  const [signals, paper, backtests] = await Promise.all([
    database.signal.findMany({
      where: { assetId: { in: assetIds } },
      select: { assetId: true, paperEvaluation: { select: { outcome: true, returnAfter1d: true } } }
    }),
    database.paperSignalEvaluation.findMany({
      where: { assetId: { in: assetIds }, evaluationStatus: "EVALUATED" },
      select: { assetId: true, outcome: true, returnAfter1d: true }
    }),
    database.backtestSignal.findMany({
      where: { assetId: { in: assetIds }, outcomeStatus: "EVALUATED" },
      select: { assetId: true, outcome: true, returnAfter1d: true }
    })
  ]);
  return {
    signals: qualityMap(
      signals.flatMap((signal) =>
        signal.paperEvaluation
          ? [
              {
                assetId: signal.assetId,
                outcome: signal.paperEvaluation.outcome,
                returnAfter1d: signal.paperEvaluation.returnAfter1d
              }
            ]
          : []
      )
    ),
    paper: qualityMap(paper),
    backtests: qualityMap(backtests)
  };
}

function qualityMap(
  items: Array<{ assetId: string; outcome: string | null; returnAfter1d: number | null }>
) {
  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    grouped.set(item.assetId, [...(grouped.get(item.assetId) ?? []), item]);
  }
  const result = new Map<string, HistoricalQuality>();
  for (const [assetId, values] of grouped) {
    const wins = values.filter((item) =>
      item.outcome === "POSITIVE" || item.outcome === "TARGET_REACHED"
    ).length;
    const returns = values
      .map((item) => item.returnAfter1d)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    result.set(assetId, {
      sampleSize: values.length,
      winRate: values.length > 0 ? (wins / values.length) * 100 : null,
      averageReturn:
        returns.length > 0
          ? returns.reduce((sum, value) => sum + value, 0) / returns.length
          : null
    });
  }
  return result;
}

async function loadNewsCounts(database: PrismaClient, assetIds: string[], now: Date) {
  if (assetIds.length === 0) return new Map<string, number>();
  const rows = await database.newsItem.groupBy({
    by: ["assetId"],
    where: {
      assetId: { in: assetIds },
      publishedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) }
    },
    _count: { _all: true }
  });
  return new Map(
    rows.flatMap((row) => (row.assetId ? [[row.assetId, row._count._all] as const] : []))
  );
}

function snapshotFromCandles(
  provider: string,
  instrument: DiscoveryInstrument,
  candles: DiscoveryCandle[]
): DiscoveryMarketSnapshot | null {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  if (!latest) return null;
  return {
    provider,
    providerSymbol: instrument.providerSymbol,
    observedAt: latest.closeTime,
    price: latest.close,
    quoteVolume24h: latest.volume * latest.close,
    baseVolume24h: latest.volume,
    priceChangePercent24h:
      previous && previous.close > 0
        ? ((latest.close - previous.close) / previous.close) * 100
        : null,
    high24h: latest.high,
    low24h: latest.low,
    tradeCount24h: null
  };
}

function toInstrument(asset: ScanAsset, provider: string): DiscoveryInstrument {
  return {
    provider,
    providerSymbol: asset.providerSymbol ?? asset.symbol,
    symbol: asset.symbol,
    name: asset.name,
    assetType: toDiscoveryAssetType(asset.assetType),
    exchange: asset.exchange,
    currency: asset.currency,
    baseCurrency: asset.baseCurrency,
    quoteCurrency: asset.quoteCurrency,
    sector: asset.sector,
    industry: asset.industry,
    status: asset.instrumentStatus === "ACTIVE" ? "ACTIVE" : "UNKNOWN",
    tradable: asset.isTradable,
    leveraged: asset.isLeveraged,
    inverse: asset.isInverse,
    stablecoin: asset.isStablecoin,
    metadata: isJsonObject(asset.providerMetadataJson)
      ? asset.providerMetadataJson
      : undefined
  };
}

function toDiscoveryAssetType(assetType: AssetType) {
  if (assetType === AssetType.CRYPTO) return "CRYPTO" as const;
  if (assetType === AssetType.ETF) return "ETF" as const;
  return "STOCK" as const;
}

function defaultProvider(assetType: AssetType) {
  return assetType === AssetType.CRYPTO ? "BINANCE" : "FINNHUB";
}

function providerKey(provider: string, providerSymbol: string) {
  return `${provider}:${providerSymbol}`;
}

function rotatingRank(symbol: string, dayOffset: number) {
  let hash = dayOffset;
  for (const character of symbol) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function returnSeries(candles: DiscoveryCandle[]) {
  return candles
    .slice(-41)
    .map((candle, index, values) =>
      index === 0 || values[index - 1]!.close <= 0
        ? null
        : (candle.close - values[index - 1]!.close) / values[index - 1]!.close
    )
    .filter((value): value is number => value !== null);
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await discoveryScan();
  } finally {
    await prisma.$disconnect();
  }
}
