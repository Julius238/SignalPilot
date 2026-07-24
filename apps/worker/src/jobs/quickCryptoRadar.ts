import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateRadarAlertQualityGate,
  sendRadarEventAlertToN8n
} from "@signalpilot/alerts";
import {
  AssetType,
  BotRunStatus,
  Prisma,
  RadarEventSeverity,
  RadarEventType,
  WatchlistPriority,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  BinanceMarketDataAdapter,
  assessCandleSeriesQuality,
  supportedBinanceIntervals,
  type BinanceInterval,
  type NormalizedCandle
} from "@signalpilot/market-data";
import { config } from "dotenv";
import pino from "pino";

import { evaluateChartPatterns, type ChartPatternObservation } from "../lib/chartPatterns.js";
import {
  buildDashboardUrl,
  persistRadarEventCandidates,
  radarSeverityRank,
  toPatternCandidate,
  type PersistedRadarEvent,
  type RadarEventCandidate
} from "../lib/radarPersistence.js";
import { shouldRouteAlertForAsset } from "../lib/alertRouting.js";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const defaultSettings = {
  enabled: false,
  minMovePercent: 2.5,
  minRelativeVolume: 2,
  minRangePercent: 3,
  maxAssets: 10,
  timeframe: "1h" as BinanceInterval,
  // 50 Kerzen, damit 20-Perioden-Extrema und RSI14 für das Pattern-Radar tragen
  candleLimit: 50,
  eventCooldownMinutes: 60,
  alertsEnabled: false,
  alertCooldownMinutes: 60,
  minAlertSeverity: RadarEventSeverity.IMPORTANT,
  patternsEnabled: true
};

type RadarAsset = {
  id: string;
  symbol: string;
  watchlistItem: {
    priority: WatchlistPriority;
    alertEnabled: boolean;
  } | null;
};

export type QuickCryptoRadarSettings = {
  enabled: boolean;
  minMovePercent: number;
  minRelativeVolume: number;
  minRangePercent: number;
  maxAssets: number;
  timeframe: BinanceInterval;
  candleLimit: number;
  alertsEnabled: boolean;
  alertCooldownMinutes: number;
  minAlertSeverity: RadarEventSeverity;
  patternsEnabled: boolean;
};

export type RadarObservation = {
  assetId: string;
  symbol: string;
  timeframe: BinanceInterval;
  priority: WatchlistPriority | null;
  alertEnabled: boolean;
  movementPercent: number;
  relativeVolume: number;
  rangePercent: number;
  close: number;
  latestCloseTime: string;
  observations: string[];
};

export type QuickCryptoRadarSummary = {
  status: BotRunStatus;
  enabled: boolean;
  timeframe: BinanceInterval;
  checkedAssetCount: number;
  radarEventCount: number;
  topMovers: RadarObservation[];
  volumeSpikes: RadarObservation[];
  volatilitySpikes: RadarObservation[];
  patternObservationCount: number;
  missingDataCount: number;
  errorCount: number;
  persistedRadarEventCount: number;
  sentRadarAlertCount: number;
  skippedRadarAlertCount: number;
};

type MarketDataAdapter = Pick<BinanceMarketDataAdapter, "fetchKlines">;
type QuickCryptoRadarOptions = {
  fetchClient?: typeof fetch;
  webhookUrl?: string;
  now?: Date;
};

export function resolveQuickCryptoRadarSettings(
  env: NodeJS.ProcessEnv = process.env
): QuickCryptoRadarSettings {
  const timeframe = parseTimeframe(env.QUICK_RADAR_TIMEFRAME);

  return {
    enabled: env.QUICK_RADAR_ENABLED === "true",
    minMovePercent: parsePositiveNumber(
      env.QUICK_RADAR_MIN_MOVE_PERCENT,
      defaultSettings.minMovePercent
    ),
    minRelativeVolume: parsePositiveNumber(
      env.QUICK_RADAR_MIN_RELATIVE_VOLUME,
      defaultSettings.minRelativeVolume
    ),
    minRangePercent: parsePositiveNumber(
      env.QUICK_RADAR_MIN_RANGE_PERCENT,
      defaultSettings.minRangePercent
    ),
    maxAssets: parsePositiveInteger(env.QUICK_RADAR_MAX_ASSETS, defaultSettings.maxAssets),
    timeframe,
    candleLimit: defaultSettings.candleLimit,
    alertsEnabled: env.QUICK_RADAR_ALERTS_ENABLED === "true",
    alertCooldownMinutes: parsePositiveInteger(
      env.QUICK_RADAR_ALERT_COOLDOWN_MINUTES,
      defaultSettings.alertCooldownMinutes
    ),
    minAlertSeverity: parseRadarEventSeverity(
      env.QUICK_RADAR_MIN_ALERT_SEVERITY,
      defaultSettings.minAlertSeverity
    ),
    patternsEnabled: env.QUICK_RADAR_PATTERNS_ENABLED !== "false"
  };
}

export async function quickCryptoRadar(
  database: PrismaClient = prisma,
  adapter: MarketDataAdapter = new BinanceMarketDataAdapter(),
  options: QuickCryptoRadarOptions = {}
): Promise<QuickCryptoRadarSummary> {
  const settings = resolveQuickCryptoRadarSettings();
  const now = options.now ?? new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "quickCryptoRadar",
      status: BotRunStatus.RUNNING,
      metadataJson: settings as unknown as Prisma.InputJsonObject
    }
  });

  await writeBotLog(database, "info", "Quick Crypto Markt-Radar gestartet", {
    botRunId: botRun.id,
    enabled: settings.enabled,
    timeframe: settings.timeframe,
    maxAssets: settings.maxAssets,
    alertsEnabled: settings.alertsEnabled,
    minAlertSeverity: settings.minAlertSeverity
  });

  if (!settings.enabled) {
    const summary = createEmptySummary(settings);
    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, "info", "Quick Crypto Markt-Radar deaktiviert", {
      botRunId: botRun.id,
      enabled: false
    });
    return summary;
  }

  let checkedAssetCount = 0;
  let missingDataCount = 0;
  let errorCount = 0;
  let persistedRadarEventCount = 0;
  let sentRadarAlertCount = 0;
  let skippedRadarAlertCount = 0;
  let patternObservationCount = 0;
  const topMovers: RadarObservation[] = [];
  const volumeSpikes: RadarObservation[] = [];
  const volatilitySpikes: RadarObservation[] = [];

  try {
    const assets = await loadRadarAssets(database, settings.maxAssets);

    for (const asset of assets) {
      try {
        const candles = await adapter.fetchKlines(asset.symbol, settings.timeframe, settings.candleLimit);
        const candleQuality = assessCandleSeriesQuality(candles, {
          now,
          timeframe: settings.timeframe,
          marketKind: "CONTINUOUS",
          minimumClosedCandles: 2
        });

        if (candleQuality.reason !== "OK") {
          missingDataCount += 1;
          await writeBotLog(database, "warn", "Quick Crypto Markt-Radar Kerzendaten übersprungen", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            timeframe: settings.timeframe,
            reason: candleQuality.reason,
            closedCandleCount: candleQuality.closedCandles.length,
            excludedOpenOrInvalidCandleCount:
              candleQuality.openOrInvalidCandleCount,
            latestCloseTime:
              candleQuality.latestCloseTime?.toISOString() ?? null
          });
          continue;
        }

        const observation = evaluateRadarCandles(
          asset,
          settings,
          candleQuality.closedCandles,
          now
        );

        if (!observation) {
          missingDataCount += 1;
          continue;
        }

        checkedAssetCount += 1;

        if (Math.abs(observation.movementPercent) >= settings.minMovePercent) {
          topMovers.push(observation);
        }

        if (observation.relativeVolume >= settings.minRelativeVolume) {
          volumeSpikes.push(observation);
        }

        if (observation.rangePercent >= settings.minRangePercent) {
          volatilitySpikes.push(observation);
        }

        let patternObservations: ChartPatternObservation[] = [];

        if (settings.patternsEnabled) {
          const sortedCandles = [...candleQuality.closedCandles].sort(
            (left, right) => left.openTime.getTime() - right.openTime.getTime()
          );
          patternObservations = evaluateChartPatterns(
            asset.symbol,
            settings.timeframe,
            sortedCandles,
            {},
            observation.observations
          );
          patternObservationCount += patternObservations.length;
        }

        if (observation.observations.length > 0 || patternObservations.length > 0) {
          const persistedEvents = await persistRadarEvents(
            database,
            observation,
            settings,
            patternObservations,
            now
          );
          persistedRadarEventCount += persistedEvents.length;

          for (const radarEvent of persistedEvents) {
            const routeDecision = shouldRouteAlertForAsset({
              asset,
              watchlistItem: asset.watchlistItem,
              alertMode: process.env.ALERT_MODE
            });

            if (!routeDecision.shouldRoute) {
              skippedRadarAlertCount += 1;
              continue;
            }

            if (!shouldSendRadarAlert(radarEvent, settings)) {
              skippedRadarAlertCount += 1;
              continue;
            }

            const result = await sendRadarEventAlertToN8n(
              {
                radarEvent,
                dashboardUrl: buildDashboardUrl()
              },
              {
                database,
                fetchClient: options.fetchClient,
                webhookUrl: options.webhookUrl
              }
            );

            if (result.status === "SENT") {
              sentRadarAlertCount += 1;
            } else {
              skippedRadarAlertCount += 1;
            }
          }

          await writeBotLog(database, "info", "Quick Crypto Markt-Radar Beobachtung", {
            botRunId: botRun.id,
            symbol: observation.symbol,
            timeframe: observation.timeframe,
            priority: observation.priority,
            movementPercent: observation.movementPercent,
            relativeVolume: observation.relativeVolume,
            rangePercent: observation.rangePercent,
            observations: observation.observations,
            patternObservations: patternObservations.map((pattern) => pattern.factorLabel),
            wording: "Beobachtung, keine Handlungsempfehlung"
          });
        }
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "Unknown Quick Crypto Radar error";

        logger.warn({ error, symbol: asset.symbol, timeframe: settings.timeframe }, message);
        await writeBotLog(database, "warn", "Quick Crypto Markt-Radar Asset übersprungen", {
          botRunId: botRun.id,
          symbol: asset.symbol,
          timeframe: settings.timeframe,
          error: message
        });
      }
    }

    const summary = sortSummary({
      status: BotRunStatus.SUCCESS,
      enabled: settings.enabled,
      timeframe: settings.timeframe,
      checkedAssetCount,
      radarEventCount: topMovers.length + volumeSpikes.length + volatilitySpikes.length,
      topMovers,
      volumeSpikes,
      volatilitySpikes,
      patternObservationCount,
      missingDataCount,
      errorCount,
      persistedRadarEventCount,
      sentRadarAlertCount,
      skippedRadarAlertCount
    });

    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, "info", "Quick Crypto Markt-Radar fertig", {
      botRunId: botRun.id,
      checkedAssetCount: summary.checkedAssetCount,
      radarEventCount: summary.radarEventCount,
      persistedRadarEventCount: summary.persistedRadarEventCount,
      sentRadarAlertCount: summary.sentRadarAlertCount,
      skippedRadarAlertCount: summary.skippedRadarAlertCount,
      missingDataCount: summary.missingDataCount,
      errorCount: summary.errorCount
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Quick Crypto Radar failure";
    const summary = sortSummary({
      status: BotRunStatus.FAILED,
      enabled: settings.enabled,
      timeframe: settings.timeframe,
      checkedAssetCount,
      radarEventCount: topMovers.length + volumeSpikes.length + volatilitySpikes.length,
      topMovers,
      volumeSpikes,
      volatilitySpikes,
      patternObservationCount,
      missingDataCount,
      errorCount: errorCount + 1,
      persistedRadarEventCount,
      sentRadarAlertCount,
      skippedRadarAlertCount
    });

    await finishBotRun(database, botRun.id, {
      ...summary,
      fatalError: message
    } as QuickCryptoRadarSummary & { fatalError: string });
    await writeBotLog(database, "error", "Quick Crypto Markt-Radar fehlgeschlagen", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

export type RadarMetricSettings = Pick<
  QuickCryptoRadarSettings,
  "minMovePercent" | "minRelativeVolume" | "minRangePercent" | "timeframe"
>;

export function evaluateRadarCandles(
  asset: RadarAsset,
  settings: RadarMetricSettings,
  candles: NormalizedCandle[],
  now: Date = new Date(),
  marketKind: "CONTINUOUS" | "SESSION" = "CONTINUOUS",
  maxAgeMs?: number
): RadarObservation | null {
  const candleQuality = assessCandleSeriesQuality(candles, {
    now,
    timeframe: settings.timeframe,
    marketKind,
    minimumClosedCandles: 2,
    maxAgeMs
  });

  if (candleQuality.reason !== "OK") {
    return null;
  }

  const sorted = candleQuality.closedCandles;
  const latest = sorted.at(-1);
  const previous = sorted.at(-2);

  if (!latest || !previous) {
    return null;
  }

  const previousClose = toFiniteNumber(previous.close);
  const latestClose = toFiniteNumber(latest.close);
  const latestHigh = toFiniteNumber(latest.high);
  const latestLow = toFiniteNumber(latest.low);
  const latestOpen = toFiniteNumber(latest.open);
  const latestVolume = toFiniteNumber(latest.volume);

  if (
    previousClose <= 0 ||
    latestClose <= 0 ||
    latestHigh <= 0 ||
    latestLow <= 0 ||
    latestOpen <= 0 ||
    latestVolume < 0
  ) {
    return null;
  }

  const historicalVolumes = sorted
    .slice(0, -1)
    .map((candle) => toFiniteNumber(candle.volume))
    .filter((volume) => volume > 0);
  const averageVolume =
    historicalVolumes.reduce((sum, volume) => sum + volume, 0) / historicalVolumes.length;

  if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
    return null;
  }

  const movementPercent = roundPercent(((latestClose - previousClose) / previousClose) * 100);
  const relativeVolume = roundRatio(latestVolume / averageVolume);
  const rangePercent = roundPercent(((latestHigh - latestLow) / latestOpen) * 100);
  const observations: string[] = [];

  if (Math.abs(movementPercent) >= settings.minMovePercent) {
    observations.push("auffällige Bewegung");
  }

  if (relativeVolume >= settings.minRelativeVolume) {
    observations.push("Volumenanstieg");
  }

  if (rangePercent >= settings.minRangePercent) {
    observations.push("erhöhte Volatilität");
  }

  return {
    assetId: asset.id,
    symbol: asset.symbol,
    timeframe: settings.timeframe,
    priority: asset.watchlistItem?.priority ?? null,
    alertEnabled: asset.watchlistItem?.alertEnabled === true,
    movementPercent,
    relativeVolume,
    rangePercent,
    close: roundPrice(latestClose),
    latestCloseTime: latest.closeTime.toISOString(),
    observations
  };
}

async function loadRadarAssets(database: PrismaClient, maxAssets: number): Promise<RadarAsset[]> {
  const assets = await database.asset.findMany({
    where: {
      assetType: AssetType.CRYPTO,
      isActive: true,
      watchlistItem: {
        isNot: null
      }
    },
    include: {
      watchlistItem: {
        select: {
          priority: true,
          alertEnabled: true
        }
      }
    },
    orderBy: {
      symbol: "asc"
    },
    take: Math.max(maxAssets * 3, maxAssets)
  });

  return assets
    .sort((left, right) => {
      const priorityDelta =
        priorityRank(right.watchlistItem?.priority) - priorityRank(left.watchlistItem?.priority);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxAssets);
}

function createEmptySummary(settings: QuickCryptoRadarSettings): QuickCryptoRadarSummary {
  return {
    status: BotRunStatus.SUCCESS,
    enabled: settings.enabled,
    timeframe: settings.timeframe,
    checkedAssetCount: 0,
    radarEventCount: 0,
    topMovers: [],
    volumeSpikes: [],
    volatilitySpikes: [],
    patternObservationCount: 0,
    missingDataCount: 0,
    errorCount: 0,
    persistedRadarEventCount: 0,
    sentRadarAlertCount: 0,
    skippedRadarAlertCount: 0
  };
}

async function persistRadarEvents(
  database: PrismaClient,
  observation: RadarObservation,
  settings: QuickCryptoRadarSettings,
  patternObservations: ChartPatternObservation[] = [],
  now: Date = new Date()
): Promise<PersistedRadarEvent[]> {
  const candidates = [
    ...buildRadarEventCandidates(observation, settings),
    ...patternObservations.map(toPatternCandidate)
  ];
  const cooldownMinutes = settings.alertsEnabled
    ? Math.max(defaultSettings.eventCooldownMinutes, settings.alertCooldownMinutes)
    : defaultSettings.eventCooldownMinutes;

  return persistRadarEventCandidates(
    database,
    {
      assetId: observation.assetId,
      symbol: observation.symbol,
      assetType: AssetType.CRYPTO,
      timeframe: observation.timeframe,
      movePercent: observation.movementPercent,
      relativeVolume: observation.relativeVolume,
      rangePercent: observation.rangePercent,
      baseMetadata: {
        priority: observation.priority,
        observations: observation.observations,
        latestCloseTime: observation.latestCloseTime,
        close: observation.close,
        watchlistAlertEnabled: observation.alertEnabled,
        closedCandle: true,
        freshData: true
      },
      cooldownMinutes,
      now
    },
    candidates
  );
}

function buildRadarEventCandidates(
  observation: RadarObservation,
  settings: QuickCryptoRadarSettings
) {
  const candidates: RadarEventCandidate[] = [];

  if (Math.abs(observation.movementPercent) >= settings.minMovePercent) {
    candidates.push({
      eventType: RadarEventType.MOVEMENT_SPIKE,
      severity: severityFromRatio(Math.abs(observation.movementPercent) / settings.minMovePercent),
      score: scoreFromRatio(Math.abs(observation.movementPercent) / settings.minMovePercent),
      shortMessage: `${observation.symbol}: auffällige Bewegung von ${observation.movementPercent}% im ${observation.timeframe} Markt-Radar.`
    });
  }

  if (observation.relativeVolume >= settings.minRelativeVolume) {
    candidates.push({
      eventType: RadarEventType.VOLUME_SPIKE,
      severity: severityFromRatio(observation.relativeVolume / settings.minRelativeVolume),
      score: scoreFromRatio(observation.relativeVolume / settings.minRelativeVolume),
      shortMessage: `${observation.symbol}: Volumenanstieg auf ${observation.relativeVolume}x im ${observation.timeframe} Markt-Radar.`
    });
  }

  if (observation.rangePercent >= settings.minRangePercent) {
    candidates.push({
      eventType: RadarEventType.VOLATILITY_SPIKE,
      severity: severityFromRatio(observation.rangePercent / settings.minRangePercent),
      score: scoreFromRatio(observation.rangePercent / settings.minRangePercent),
      shortMessage: `${observation.symbol}: erhöhte Volatilität mit ${observation.rangePercent}% Range im ${observation.timeframe} Markt-Radar.`
    });
  }

  return candidates;
}

function sortSummary<T extends QuickCryptoRadarSummary>(summary: T): T {
  summary.topMovers.sort((left, right) => Math.abs(right.movementPercent) - Math.abs(left.movementPercent));
  summary.volumeSpikes.sort((left, right) => right.relativeVolume - left.relativeVolume);
  summary.volatilitySpikes.sort((left, right) => right.rangePercent - left.rangePercent);
  return summary;
}

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  metadataJson: QuickCryptoRadarSummary | (QuickCryptoRadarSummary & { fatalError: string })
) {
  await database.botRun.update({
    where: {
      id: botRunId
    },
    data: {
      status: metadataJson.status,
      finishedAt: new Date(),
      metadataJson: metadataJson as unknown as Prisma.InputJsonObject
    }
  });
}

async function writeBotLog(
  database: PrismaClient,
  level: string,
  message: string,
  metadataJson?: Prisma.InputJsonValue
) {
  await database.botLog.create({
    data: {
      level,
      service: "worker",
      message,
      metadataJson
    }
  });
}

function parseTimeframe(value: string | undefined): BinanceInterval {
  if (!value) {
    return defaultSettings.timeframe;
  }

  if (!supportedBinanceIntervals.includes(value as BinanceInterval)) {
    return defaultSettings.timeframe;
  }

  return value as BinanceInterval;
}

function parseRadarEventSeverity(
  value: string | undefined,
  fallback: RadarEventSeverity
): RadarEventSeverity {
  if (!value) {
    return fallback;
  }

  if (Object.values(RadarEventSeverity).includes(value as RadarEventSeverity)) {
    return value as RadarEventSeverity;
  }

  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function priorityRank(priority: WatchlistPriority | undefined): number {
  if (priority === WatchlistPriority.HIGH) {
    return 3;
  }

  if (priority === WatchlistPriority.MEDIUM) {
    return 2;
  }

  if (priority === WatchlistPriority.LOW) {
    return 1;
  }

  return 0;
}

function severityFromRatio(ratio: number): RadarEventSeverity {
  if (ratio >= 3) {
    return RadarEventSeverity.CRITICAL;
  }

  if (ratio >= 2) {
    return RadarEventSeverity.IMPORTANT;
  }

  return RadarEventSeverity.WATCH;
}

function scoreFromRatio(ratio: number): number {
  return Math.min(100, Math.round(ratio * 35));
}

function shouldSendRadarAlert(
  radarEvent: PersistedRadarEvent,
  settings: QuickCryptoRadarSettings
): boolean {
  if (!settings.alertsEnabled) {
    return false;
  }

  return (
    radarSeverityRank(radarEvent.severity) >=
      radarSeverityRank(settings.minAlertSeverity) &&
    evaluateRadarAlertQualityGate(radarEvent).allowed
  );
}

function toFiniteNumber(value: string | number | { toString(): string }): number {
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPrice(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const summary = await quickCryptoRadar();
    logger.info(summary, "quickCryptoRadar completed");
  } finally {
    await prisma.$disconnect();
  }
}
