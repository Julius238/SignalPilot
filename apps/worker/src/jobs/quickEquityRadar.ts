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
  WatchlistPriority,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  assessCandleSeriesQuality,
  supportedBinanceIntervals,
  type BinanceInterval
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
import { evaluateRadarCandles, type RadarObservation } from "./quickCryptoRadar.js";

// Equity/ETF-Radar: arbeitet ausschließlich auf bereits importierten Kerzen aus der
// Datenbank (Equity-Pipeline) — kein zusätzlicher API-Call. Veraltete Datenstände
// werden übersprungen und gezählt statt stillschweigend ausgewertet.

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const defaultSettings = {
  enabled: false,
  minMovePercent: 2,
  minRelativeVolume: 1.8,
  minRangePercent: 2.5,
  maxAssets: 15,
  timeframe: "1d" as BinanceInterval,
  candleLimit: 50,
  // Wochenende + Feiertag dürfen nicht als "veraltet" gelten
  maxDataAgeHours: 96,
  eventCooldownMinutes: 240,
  alertsEnabled: false,
  alertCooldownMinutes: 240,
  minAlertSeverity: RadarEventSeverity.IMPORTANT,
  patternsEnabled: true
};

export type QuickEquityRadarSettings = {
  enabled: boolean;
  minMovePercent: number;
  minRelativeVolume: number;
  minRangePercent: number;
  maxAssets: number;
  timeframe: BinanceInterval;
  candleLimit: number;
  maxDataAgeHours: number;
  alertsEnabled: boolean;
  alertCooldownMinutes: number;
  minAlertSeverity: RadarEventSeverity;
  patternsEnabled: boolean;
};

export type QuickEquityRadarSummary = {
  status: BotRunStatus;
  enabled: boolean;
  timeframe: BinanceInterval;
  checkedAssetCount: number;
  observationCount: number;
  patternObservationCount: number;
  staleDataCount: number;
  missingDataCount: number;
  errorCount: number;
  persistedRadarEventCount: number;
  sentRadarAlertCount: number;
  skippedRadarAlertCount: number;
};

type QuickEquityRadarOptions = {
  fetchClient?: typeof fetch;
  webhookUrl?: string;
  now?: Date;
};

export function resolveQuickEquityRadarSettings(
  env: NodeJS.ProcessEnv = process.env
): QuickEquityRadarSettings {
  return {
    enabled: env.EQUITY_RADAR_ENABLED === "true",
    minMovePercent: parsePositiveNumber(
      env.EQUITY_RADAR_MIN_MOVE_PERCENT,
      defaultSettings.minMovePercent
    ),
    minRelativeVolume: parsePositiveNumber(
      env.EQUITY_RADAR_MIN_RELATIVE_VOLUME,
      defaultSettings.minRelativeVolume
    ),
    minRangePercent: parsePositiveNumber(
      env.EQUITY_RADAR_MIN_RANGE_PERCENT,
      defaultSettings.minRangePercent
    ),
    maxAssets: parsePositiveInteger(env.EQUITY_RADAR_MAX_ASSETS, defaultSettings.maxAssets),
    timeframe: parseTimeframe(env.EQUITY_RADAR_TIMEFRAME),
    candleLimit: defaultSettings.candleLimit,
    maxDataAgeHours: parsePositiveInteger(
      env.EQUITY_RADAR_MAX_DATA_AGE_HOURS,
      defaultSettings.maxDataAgeHours
    ),
    alertsEnabled: env.EQUITY_RADAR_ALERTS_ENABLED === "true",
    alertCooldownMinutes: parsePositiveInteger(
      env.EQUITY_RADAR_ALERT_COOLDOWN_MINUTES,
      defaultSettings.alertCooldownMinutes
    ),
    minAlertSeverity: parseRadarEventSeverity(
      env.EQUITY_RADAR_MIN_ALERT_SEVERITY,
      defaultSettings.minAlertSeverity
    ),
    patternsEnabled: env.EQUITY_RADAR_PATTERNS_ENABLED !== "false"
  };
}

export async function quickEquityRadar(
  database: PrismaClient = prisma,
  options: QuickEquityRadarOptions = {}
): Promise<QuickEquityRadarSummary> {
  const settings = resolveQuickEquityRadarSettings();
  const now = options.now ?? new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "quickEquityRadar",
      status: BotRunStatus.RUNNING,
      metadataJson: settings as unknown as Prisma.InputJsonObject
    }
  });

  await writeBotLog(database, "info", "Equity Markt-Radar gestartet", {
    botRunId: botRun.id,
    enabled: settings.enabled,
    timeframe: settings.timeframe,
    maxAssets: settings.maxAssets,
    alertsEnabled: settings.alertsEnabled
  });

  if (!settings.enabled) {
    const summary = createEmptySummary(settings);
    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, "info", "Equity Markt-Radar deaktiviert", {
      botRunId: botRun.id,
      enabled: false
    });
    return summary;
  }

  let checkedAssetCount = 0;
  let observationCount = 0;
  let patternObservationCount = 0;
  let staleDataCount = 0;
  let missingDataCount = 0;
  let errorCount = 0;
  let persistedRadarEventCount = 0;
  let sentRadarAlertCount = 0;
  let skippedRadarAlertCount = 0;

  try {
    const assets = await loadEquityRadarAssets(database, settings.maxAssets);

    for (const asset of assets) {
      try {
        const candles = await loadCandles(database, asset.id, settings, now);
        const candleQuality = assessCandleSeriesQuality(candles, {
          now,
          timeframe: settings.timeframe,
          marketKind: "SESSION",
          minimumClosedCandles: 2,
          maxAgeMs: settings.maxDataAgeHours * 3_600_000
        });

        if (candleQuality.reason !== "OK") {
          if (candleQuality.reason === "STALE_DATA") {
            staleDataCount += 1;
          } else {
            missingDataCount += 1;
          }

          await writeBotLog(database, "warn", "Equity Markt-Radar Kerzendaten übersprungen", {
            botRunId: botRun.id,
            symbol: asset.symbol,
            timeframe: settings.timeframe,
            reason: candleQuality.reason,
            closedCandleCount: candleQuality.closedCandles.length,
            excludedOpenOrInvalidCandleCount:
              candleQuality.openOrInvalidCandleCount,
            latestCloseTime:
              candleQuality.latestCloseTime?.toISOString() ?? null,
            maxDataAgeHours: settings.maxDataAgeHours
          });
          continue;
        }

        const latestCandle = candleQuality.closedCandles.at(-1);
        const observation = evaluateRadarCandles(
          asset,
          settings,
          candleQuality.closedCandles,
          now,
          "SESSION",
          settings.maxDataAgeHours * 3_600_000
        );

        if (!observation) {
          missingDataCount += 1;
          continue;
        }

        checkedAssetCount += 1;
        observationCount += observation.observations.length;

        let patternObservations: ChartPatternObservation[] = [];

        if (settings.patternsEnabled) {
          patternObservations = evaluateChartPatterns(
            asset.symbol,
            settings.timeframe,
            candleQuality.closedCandles,
            {},
            observation.observations
          );
          patternObservationCount += patternObservations.length;
        }

        if (observation.observations.length === 0 && patternObservations.length === 0) {
          continue;
        }

        const persistedEvents = await persistEquityRadarEvents(
          database,
          asset,
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

          if (!shouldSendAlert(radarEvent, settings)) {
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

        await writeBotLog(database, "info", "Equity Markt-Radar Beobachtung", {
          botRunId: botRun.id,
          symbol: asset.symbol,
          timeframe: settings.timeframe,
          observations: observation.observations,
          patternObservations: patternObservations.map((pattern) => pattern.factorLabel),
          dataStand: latestCandle?.closeTime.toISOString(),
          wording: "Beobachtung, keine Handlungsempfehlung"
        });
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "Unknown Equity Radar error";

        logger.warn({ error, symbol: asset.symbol }, message);
        await writeBotLog(database, "warn", "Equity Markt-Radar Asset übersprungen", {
          botRunId: botRun.id,
          symbol: asset.symbol,
          error: message
        });
      }
    }

    const summary: QuickEquityRadarSummary = {
      status: BotRunStatus.SUCCESS,
      enabled: settings.enabled,
      timeframe: settings.timeframe,
      checkedAssetCount,
      observationCount,
      patternObservationCount,
      staleDataCount,
      missingDataCount,
      errorCount,
      persistedRadarEventCount,
      sentRadarAlertCount,
      skippedRadarAlertCount
    };

    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, "info", "Equity Markt-Radar fertig", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Equity Radar failure";
    const summary: QuickEquityRadarSummary = {
      status: BotRunStatus.FAILED,
      enabled: settings.enabled,
      timeframe: settings.timeframe,
      checkedAssetCount,
      observationCount,
      patternObservationCount,
      staleDataCount,
      missingDataCount,
      errorCount: errorCount + 1,
      persistedRadarEventCount,
      sentRadarAlertCount,
      skippedRadarAlertCount
    };

    await finishBotRun(database, botRun.id, {
      ...summary,
      fatalError: message
    } as QuickEquityRadarSummary & { fatalError: string });
    await writeBotLog(database, "error", "Equity Markt-Radar fehlgeschlagen", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

type EquityRadarAsset = {
  id: string;
  symbol: string;
  assetType: AssetType;
  watchlistItem: {
    priority: WatchlistPriority;
    alertEnabled: boolean;
  } | null;
};

async function loadEquityRadarAssets(
  database: PrismaClient,
  maxAssets: number
): Promise<EquityRadarAsset[]> {
  const assets = await database.asset.findMany({
    where: {
      assetType: {
        in: [AssetType.STOCK, AssetType.ETF]
      },
      isActive: true,
      watchlistItem: {
        isNot: null
      }
    },
    select: {
      id: true,
      symbol: true,
      assetType: true,
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

type DatabaseCandle = {
  openTime: Date;
  closeTime: Date;
  open: { toString(): string };
  high: { toString(): string };
  low: { toString(): string };
  close: { toString(): string };
  volume: { toString(): string };
};

async function loadCandles(
  database: PrismaClient,
  assetId: string,
  settings: QuickEquityRadarSettings,
  now: Date
) {
  const rows = (await database.candle.findMany({
    where: {
      assetId,
      timeframe: settings.timeframe,
      closeTime: {
        lte: now
      }
    },
    orderBy: {
      openTime: "desc"
    },
    take: settings.candleLimit,
    select: {
      openTime: true,
      closeTime: true,
      open: true,
      high: true,
      low: true,
      close: true,
      volume: true
    }
  })) as DatabaseCandle[];

  return rows.reverse().map((row) => ({
    symbol: "",
    timeframe: settings.timeframe,
    openTime: row.openTime,
    closeTime: row.closeTime,
    open: row.open.toString(),
    high: row.high.toString(),
    low: row.low.toString(),
    close: row.close.toString(),
    volume: row.volume.toString(),
    source: "FINNHUB" as const
  }));
}

async function persistEquityRadarEvents(
  database: PrismaClient,
  asset: EquityRadarAsset,
  observation: RadarObservation,
  settings: QuickEquityRadarSettings,
  patternObservations: ChartPatternObservation[],
  now: Date
): Promise<PersistedRadarEvent[]> {
  const candidates: RadarEventCandidate[] = [
    ...buildMetricCandidates(observation, settings),
    ...patternObservations.map(toPatternCandidate)
  ];
  const cooldownMinutes = settings.alertsEnabled
    ? Math.max(defaultSettings.eventCooldownMinutes, settings.alertCooldownMinutes)
    : defaultSettings.eventCooldownMinutes;

  return persistRadarEventCandidates(
    database,
    {
      assetId: asset.id,
      symbol: asset.symbol,
      assetType: asset.assetType,
      timeframe: settings.timeframe,
      movePercent: observation.movementPercent,
      relativeVolume: observation.relativeVolume,
      rangePercent: observation.rangePercent,
      baseMetadata: {
        priority: observation.priority,
        observations: observation.observations,
        latestCloseTime: observation.latestCloseTime,
        close: observation.close,
        watchlistAlertEnabled: asset.watchlistItem?.alertEnabled === true,
        closedCandle: true,
        freshData: true,
        dataSource: "Equity-Kerzen aus Datenbank (Equity-Pipeline)"
      },
      cooldownMinutes,
      now
    },
    candidates
  );
}

function buildMetricCandidates(
  observation: RadarObservation,
  settings: QuickEquityRadarSettings
): RadarEventCandidate[] {
  const candidates: RadarEventCandidate[] = [];

  if (Math.abs(observation.movementPercent) >= settings.minMovePercent) {
    candidates.push({
      eventType: "MOVEMENT_SPIKE",
      severity: severityFromRatio(Math.abs(observation.movementPercent) / settings.minMovePercent),
      score: scoreFromRatio(Math.abs(observation.movementPercent) / settings.minMovePercent),
      shortMessage: `${observation.symbol}: auffällige Bewegung von ${observation.movementPercent}% im ${observation.timeframe} Equity-Radar.`
    });
  }

  if (observation.relativeVolume >= settings.minRelativeVolume) {
    candidates.push({
      eventType: "VOLUME_SPIKE",
      severity: severityFromRatio(observation.relativeVolume / settings.minRelativeVolume),
      score: scoreFromRatio(observation.relativeVolume / settings.minRelativeVolume),
      shortMessage: `${observation.symbol}: Volumenanstieg auf ${observation.relativeVolume}x im ${observation.timeframe} Equity-Radar.`
    });
  }

  if (observation.rangePercent >= settings.minRangePercent) {
    candidates.push({
      eventType: "VOLATILITY_SPIKE",
      severity: severityFromRatio(observation.rangePercent / settings.minRangePercent),
      score: scoreFromRatio(observation.rangePercent / settings.minRangePercent),
      shortMessage: `${observation.symbol}: erhöhte Volatilität mit ${observation.rangePercent}% Range im ${observation.timeframe} Equity-Radar.`
    });
  }

  return candidates;
}

function createEmptySummary(settings: QuickEquityRadarSettings): QuickEquityRadarSummary {
  return {
    status: BotRunStatus.SUCCESS,
    enabled: settings.enabled,
    timeframe: settings.timeframe,
    checkedAssetCount: 0,
    observationCount: 0,
    patternObservationCount: 0,
    staleDataCount: 0,
    missingDataCount: 0,
    errorCount: 0,
    persistedRadarEventCount: 0,
    sentRadarAlertCount: 0,
    skippedRadarAlertCount: 0
  };
}

function shouldSendAlert(
  radarEvent: PersistedRadarEvent,
  settings: QuickEquityRadarSettings
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

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  metadataJson: QuickEquityRadarSummary | (QuickEquityRadarSummary & { fatalError: string })
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const summary = await quickEquityRadar();
    logger.info(summary, "quickEquityRadar completed");
  } finally {
    await prisma.$disconnect();
  }
}
