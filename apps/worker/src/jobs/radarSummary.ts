import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AlertChannel,
  AlertStatus,
  AssetDiscoveryAction,
  AssetDiscoveryRunKind,
  BotRunStatus,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const defaultLookbackMinutes = 60;

export type RadarSummarySettings = {
  enabled: boolean;
  minEventCount: number;
  webhookEnabled: boolean;
  lookbackMinutes: number;
  discoverySummaryEnabled: boolean;
};

export type RadarSummaryResult = {
  status: BotRunStatus;
  enabled: boolean;
  period: {
    from: string;
    to: string;
    lookbackMinutes: number;
  };
  checkedAssetCount: number;
  notableAssetCount: number;
  radarEventCount: number;
  globalEventCount: number;
  topMovers: RadarSummaryEvent[];
  volumeSpikes: RadarSummaryEvent[];
  volatilitySpikes: RadarSummaryEvent[];
  patternEvents: RadarSummaryEvent[];
  globalEvents: GlobalEventSummaryItem[];
  marketRegimeContext: MarketRegimeContext | null;
  discoveryCandidates: DiscoverySummaryItem[];
  discoveryCandidateCount: number;
  summaryText: string;
  webhookEnabled: boolean;
  webhookSent: boolean;
  skippedReason?: string;
};

type GlobalEventSummaryItem = {
  title: string;
  eventType: string;
  severity: string;
  region: string | null;
  sourceUrl: string | null;
  detectedAt: string;
};

type DiscoverySummaryItem = {
  symbol: string;
  score: number;
  action: string;
  reasons: string[];
  createdAt: string;
};

const patternEventTypes = ["BREAKOUT_PROXIMITY", "SR_PROXIMITY", "MOMENTUM_SHIFT", "CONFLUENCE"];

type RadarSummaryEvent = {
  symbol: string;
  eventType: string;
  severity: string;
  timeframe: string;
  movePercent: number | null;
  relativeVolume: number | null;
  rangePercent: number | null;
  shortMessage: string;
  createdAt: string;
};

type MarketRegimeContext = {
  generatedAt: string;
  overallRegime: string;
  cryptoRegime: string;
  riskMode: string;
  confidence: number;
  summary: string;
  riskNote: string;
};

type SendSummaryOptions = {
  fetchClient?: typeof fetch;
  webhookUrl?: string;
};

export function resolveRadarSummarySettings(env: NodeJS.ProcessEnv = process.env): RadarSummarySettings {
  return {
    enabled: env.RADAR_SUMMARY_ENABLED === "true",
    minEventCount: parsePositiveInteger(env.RADAR_SUMMARY_MIN_EVENT_COUNT, 1),
    webhookEnabled: env.RADAR_SUMMARY_WEBHOOK_ENABLED === "true",
    // Für Daily Briefings (z.B. 2x täglich) auf 720 stellen
    lookbackMinutes: parsePositiveInteger(env.RADAR_SUMMARY_LOOKBACK_MINUTES, defaultLookbackMinutes),
    discoverySummaryEnabled: env.ASSET_DISCOVERY_SUMMARY_ENABLED !== "false"
  };
}

export async function radarSummary(
  database: PrismaClient = prisma,
  options: SendSummaryOptions = {}
): Promise<RadarSummaryResult> {
  const settings = resolveRadarSummarySettings();
  const now = new Date();
  const from = new Date(now.getTime() - settings.lookbackMinutes * 60_000);
  const botRun = await database.botRun.create({
    data: {
      jobName: "radarSummary",
      status: BotRunStatus.RUNNING,
      metadataJson: {
        enabled: settings.enabled,
        minEventCount: settings.minEventCount,
        webhookEnabled: settings.webhookEnabled,
        lookbackMinutes: settings.lookbackMinutes
      }
    }
  });

  try {
    if (!settings.enabled) {
      const baseSummary = createDisabledSummary(settings, from, now);
      const summary = { ...baseSummary, skippedReason: "RADAR_SUMMARY_DISABLED" };
      await finishBotRun(database, botRun.id, summary);
      await writeBotLog(database, "info", "Radar Summary deaktiviert", {
        botRunId: botRun.id,
        skippedReason: summary.skippedReason
      });
      return summary;
    }

    const baseSummary = await buildRadarSummary(database, settings, from, now);

    if (
      baseSummary.radarEventCount +
        baseSummary.globalEventCount +
        baseSummary.discoveryCandidateCount <
      settings.minEventCount
    ) {
      const summary = { ...baseSummary, skippedReason: "MIN_EVENT_COUNT_NOT_REACHED" };
      await finishBotRun(database, botRun.id, summary);
      await writeBotLog(database, "info", "Radar Summary ohne Versand fertig", {
        botRunId: botRun.id,
        radarEventCount: summary.radarEventCount,
        minEventCount: settings.minEventCount,
        skippedReason: summary.skippedReason
      });
      return summary;
    }

    if (!settings.webhookEnabled) {
      const summary = { ...baseSummary, skippedReason: "RADAR_SUMMARY_WEBHOOK_DISABLED" };
      await finishBotRun(database, botRun.id, summary);
      await writeBotLog(database, "info", "Radar Summary erstellt", {
        botRunId: botRun.id,
        radarEventCount: summary.radarEventCount,
        skippedReason: summary.skippedReason
      });
      return summary;
    }

    const alreadySent = await hasSentSummaryForCurrentEvents(database, from, baseSummary);
    if (alreadySent) {
      const summary = { ...baseSummary, skippedReason: "NO_NEW_RADAR_EVENTS_SINCE_LAST_SUMMARY" };
      await finishBotRun(database, botRun.id, summary);
      await writeBotLog(database, "info", "Radar Summary Versand übersprungen", {
        botRunId: botRun.id,
        skippedReason: summary.skippedReason
      });
      return summary;
    }

    const sendResult = await sendRadarSummaryToN8n(database, baseSummary, options);
    const summary = { ...baseSummary, webhookSent: sendResult.status === AlertStatus.SENT };

    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, summary.webhookSent ? "info" : "warn", "Radar Summary fertig", {
      botRunId: botRun.id,
      radarEventCount: summary.radarEventCount,
      webhookSent: summary.webhookSent,
      alertId: sendResult.alertId,
      error: sendResult.error
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Radar Summary error";
    const failedSummary: RadarSummaryResult = {
      status: BotRunStatus.FAILED,
      enabled: settings.enabled,
      period: {
        from: from.toISOString(),
        to: now.toISOString(),
        lookbackMinutes: settings.lookbackMinutes
      },
      checkedAssetCount: 0,
      notableAssetCount: 0,
      radarEventCount: 0,
      globalEventCount: 0,
      topMovers: [],
      volumeSpikes: [],
      volatilitySpikes: [],
      patternEvents: [],
      globalEvents: [],
      marketRegimeContext: null,
      discoveryCandidates: [],
      discoveryCandidateCount: 0,
      summaryText: "Radar Summary konnte nicht erstellt werden.",
      webhookEnabled: settings.webhookEnabled,
      webhookSent: false,
      skippedReason: message
    };

    await finishBotRun(database, botRun.id, failedSummary);
    await writeBotLog(database, "error", "Radar Summary fehlgeschlagen", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

function createDisabledSummary(
  settings: RadarSummarySettings,
  from: Date,
  to: Date
): RadarSummaryResult {
  return {
    status: BotRunStatus.SUCCESS,
    enabled: settings.enabled,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      lookbackMinutes: settings.lookbackMinutes
    },
    checkedAssetCount: 0,
    notableAssetCount: 0,
    radarEventCount: 0,
    globalEventCount: 0,
    topMovers: [],
    volumeSpikes: [],
    volatilitySpikes: [],
    patternEvents: [],
    globalEvents: [],
    marketRegimeContext: null,
    discoveryCandidates: [],
    discoveryCandidateCount: 0,
    summaryText: "Radar Summary deaktiviert.",
    webhookEnabled: settings.webhookEnabled,
    webhookSent: false
  };
}

async function buildRadarSummary(
  database: PrismaClient,
  settings: RadarSummarySettings,
  from: Date,
  to: Date
): Promise<RadarSummaryResult> {
  const [events, marketEvents, latestQuickRadar, latestMarketRegime, latestDiscovery] = await Promise.all([
    database.radarEvent.findMany({
      where: {
        createdAt: {
          gte: from,
          lte: to
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 100
    }),
    database.marketEvent.findMany({
      where: {
        detectedAt: {
          gte: from,
          lte: to
        }
      },
      orderBy: {
        detectedAt: "desc"
      },
      take: 20,
      select: {
        title: true,
        eventType: true,
        severity: true,
        region: true,
        sourceUrl: true,
        detectedAt: true
      }
    }),
    database.botRun.findFirst({
      where: {
        jobName: "quickCryptoRadar"
      },
      orderBy: {
        startedAt: "desc"
      }
    }),
    database.marketRegimeSnapshot.findFirst({
      orderBy: {
        generatedAt: "desc"
      }
    }),
    settings.discoverySummaryEnabled
      ? database.assetDiscoveryRun.findFirst({
          where: {
            kind: AssetDiscoveryRunKind.ACTIVE_SELECTION,
            status: BotRunStatus.SUCCESS,
            startedAt: { gte: from, lte: to }
          },
          orderBy: { startedAt: "desc" },
          select: {
            candidates: {
              where: {
                proposedAction: {
                  in: [AssetDiscoveryAction.ADD, AssetDiscoveryAction.REMOVE]
                }
              },
              orderBy: { score: "desc" },
              take: 10,
              select: {
                score: true,
                proposedAction: true,
                reasonsJson: true,
                createdAt: true,
                asset: { select: { symbol: true } }
              }
            }
          }
        })
      : Promise.resolve(null)
  ]);

  const checkedAssetCount = numberFromMetadata(latestQuickRadar?.metadataJson, "checkedAssetCount") ?? 0;
  const notableSymbols = new Set(events.map((event) => event.symbol));
  const mappedEvents = events.map(toSummaryEvent);
  const topMovers = mappedEvents
    .filter((event) => event.eventType === "MOVEMENT_SPIKE")
    .sort((left, right) => Math.abs(right.movePercent ?? 0) - Math.abs(left.movePercent ?? 0))
    .slice(0, 5);
  const volumeSpikes = mappedEvents
    .filter((event) => event.eventType === "VOLUME_SPIKE")
    .sort((left, right) => (right.relativeVolume ?? 0) - (left.relativeVolume ?? 0))
    .slice(0, 5);
  const volatilitySpikes = mappedEvents
    .filter((event) => event.eventType === "VOLATILITY_SPIKE")
    .sort((left, right) => (right.rangePercent ?? 0) - (left.rangePercent ?? 0))
    .slice(0, 5);
  const patternEvents = mappedEvents
    .filter((event) => patternEventTypes.includes(event.eventType))
    .slice(0, 5);
  const globalEvents: GlobalEventSummaryItem[] = marketEvents.map((event) => ({
    title: event.title,
    eventType: event.eventType,
    severity: event.severity,
    region: event.region,
    sourceUrl: event.sourceUrl,
    detectedAt: event.detectedAt.toISOString()
  }));
  const marketRegimeContext = latestMarketRegime
    ? {
        generatedAt: latestMarketRegime.generatedAt.toISOString(),
        overallRegime: latestMarketRegime.overallRegime,
        cryptoRegime: latestMarketRegime.cryptoRegime,
        riskMode: latestMarketRegime.riskMode,
        confidence: latestMarketRegime.confidence,
        summary: latestMarketRegime.summary,
        riskNote: latestMarketRegime.riskNote
      }
    : null;
  const discoveryCandidates: DiscoverySummaryItem[] = (latestDiscovery?.candidates ?? []).map(
    (candidate) => ({
      symbol: candidate.asset.symbol,
      score: candidate.score,
      action: candidate.proposedAction,
      reasons: Array.isArray(candidate.reasonsJson)
        ? candidate.reasonsJson.filter(
            (reason): reason is string => typeof reason === "string"
          )
        : [],
      createdAt: candidate.createdAt.toISOString()
    })
  );

  return {
    status: BotRunStatus.SUCCESS,
    enabled: settings.enabled,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      lookbackMinutes: settings.lookbackMinutes
    },
    checkedAssetCount,
    notableAssetCount: notableSymbols.size,
    radarEventCount: events.length,
    globalEventCount: globalEvents.length,
    topMovers,
    volumeSpikes,
    volatilitySpikes,
    patternEvents,
    globalEvents,
    marketRegimeContext,
    discoveryCandidates,
    discoveryCandidateCount: discoveryCandidates.length,
    summaryText: buildSummaryText({
      checkedAssetCount,
      notableAssetCount: notableSymbols.size,
      radarEventCount: events.length,
      topMovers,
      volumeSpikes,
      volatilitySpikes,
      patternEvents,
      globalEvents,
      marketRegimeContext,
      discoveryCandidates,
      period: {
        from: from.toISOString(),
        to: to.toISOString()
      }
    }),
    webhookEnabled: settings.webhookEnabled,
    webhookSent: false
  };
}

async function hasSentSummaryForCurrentEvents(
  database: PrismaClient,
  from: Date,
  summary: RadarSummaryResult
) {
  const newestEventTime = [
    ...[...summary.topMovers, ...summary.volumeSpikes, ...summary.volatilitySpikes, ...summary.patternEvents].map(
      (event) => new Date(event.createdAt).getTime()
    ),
    ...summary.globalEvents.map((event) => new Date(event.detectedAt).getTime()),
    ...summary.discoveryCandidates.map((candidate) => new Date(candidate.createdAt).getTime())
  ]
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];

  if (!newestEventTime) {
    return false;
  }

  const previous = await database.botRun.findFirst({
    where: {
      jobName: "radarSummary",
      status: BotRunStatus.SUCCESS,
      startedAt: {
        gte: from
      }
    },
    orderBy: {
      startedAt: "desc"
    }
  });

  if (!previous?.metadataJson || !isRecord(previous.metadataJson)) {
    return false;
  }

  return previous.metadataJson.webhookSent === true && previous.startedAt.getTime() >= newestEventTime;
}

async function sendRadarSummaryToN8n(
  database: PrismaClient,
  summary: RadarSummaryResult,
  options: SendSummaryOptions
) {
  const payload = {
    source: "signalpilot",
    type: "radar_summary",
    period: summary.period,
    checkedAssetCount: summary.checkedAssetCount,
    notableAssetCount: summary.notableAssetCount,
    radarEventCount: summary.radarEventCount,
    globalEventCount: summary.globalEventCount,
    topMovers: summary.topMovers,
    volumeSpikes: summary.volumeSpikes,
    volatilitySpikes: summary.volatilitySpikes,
    patternEvents: summary.patternEvents,
    globalEvents: summary.globalEvents,
    discoveryCandidates: summary.discoveryCandidates,
    discoveryCandidateCount: summary.discoveryCandidateCount,
    marketRegimeContext: summary.marketRegimeContext,
    shortMessage: summary.summaryText,
    context: {
      wording: "Keine Handlungsempfehlung, nur Research/Beobachtung.",
      marketContext: "Markt-Radar Zusammenfassung"
    },
    dashboardUrl: buildDashboardUrl()
  };
  const alert = await database.alert.create({
    data: {
      signalId: null,
      channel: AlertChannel.WEBHOOK,
      status: AlertStatus.PENDING,
      payloadJson: payload as Prisma.InputJsonObject
    }
  });
  const webhookUrl = options.webhookUrl ?? process.env.N8N_WEBHOOK_SIGNAL_URL;

  if (!webhookUrl) {
    const error = "missing N8N_WEBHOOK_SIGNAL_URL";
    await database.alert.update({
      where: { id: alert.id },
      data: { status: AlertStatus.FAILED, error }
    });
    return { alertId: alert.id, status: AlertStatus.FAILED, error };
  }

  const response = await (options.fetchClient ?? fetch)(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = `n8n webhook failed with HTTP ${response.status}`;
    await database.alert.update({
      where: { id: alert.id },
      data: { status: AlertStatus.FAILED, error }
    });
    return { alertId: alert.id, status: AlertStatus.FAILED, error };
  }

  await database.alert.update({
    where: { id: alert.id },
    data: { status: AlertStatus.SENT, sentAt: new Date(), error: null }
  });
  return { alertId: alert.id, status: AlertStatus.SENT };
}

function toSummaryEvent(event: {
  symbol: string;
  eventType: string;
  severity: string;
  timeframe: string;
  movePercent: number | null;
  relativeVolume: number | null;
  rangePercent: number | null;
  shortMessage: string;
  createdAt: Date;
}): RadarSummaryEvent {
  return {
    symbol: event.symbol,
    eventType: event.eventType,
    severity: event.severity,
    timeframe: event.timeframe,
    movePercent: event.movePercent,
    relativeVolume: event.relativeVolume,
    rangePercent: event.rangePercent,
    shortMessage: event.shortMessage,
    createdAt: event.createdAt.toISOString()
  };
}

function buildSummaryText(input: {
  checkedAssetCount: number;
  notableAssetCount: number;
  radarEventCount: number;
  topMovers: RadarSummaryEvent[];
  volumeSpikes: RadarSummaryEvent[];
  volatilitySpikes: RadarSummaryEvent[];
  patternEvents: RadarSummaryEvent[];
  globalEvents: GlobalEventSummaryItem[];
  marketRegimeContext: MarketRegimeContext | null;
  discoveryCandidates: DiscoverySummaryItem[];
  period: { from: string; to: string };
}) {
  const lines = [
    `Radar Summary (${formatDateTime(input.period.from)} - ${formatDateTime(input.period.to)})`,
    `Geprüfte Assets: ${input.checkedAssetCount}`,
    `Auffällige Assets: ${input.notableAssetCount}`,
    `Beobachtungen: ${input.radarEventCount}`,
    `Top Movers: ${formatSymbols(input.topMovers)}`,
    `Volume Spikes: ${formatSymbols(input.volumeSpikes)}`,
    `Volatility Spikes: ${formatSymbols(input.volatilitySpikes)}`
  ];

  if (input.patternEvents.length > 0) {
    lines.push(`Chart-Beobachtungen: ${formatSymbols(input.patternEvents)}`);
  }

  if (input.globalEvents.length > 0) {
    lines.push(`Globale Ereignisse (${input.globalEvents.length}):`);
    for (const event of input.globalEvents.slice(0, 5)) {
      lines.push(`- [${event.severity}] ${event.title}${event.region ? ` (${event.region})` : ""}`);
    }
  }

  if (input.marketRegimeContext) {
    lines.push(
      `Marktumfeld: ${input.marketRegimeContext.overallRegime} / ${input.marketRegimeContext.riskMode}`
    );
  }

  if (input.discoveryCandidates.length > 0) {
    lines.push(`Discovery-Vorschläge (${input.discoveryCandidates.length}):`);
    for (const candidate of input.discoveryCandidates.slice(0, 5)) {
      lines.push(
        `- ${candidate.action} ${candidate.symbol} · Score ${candidate.score.toFixed(1)} · ${
          candidate.reasons[0] ?? "Policy-Auswahl"
        }`
      );
    }
  }

  lines.push("Keine Handlungsempfehlung, nur Research/Beobachtung.");
  return lines.join("\n");
}

function formatSymbols(events: RadarSummaryEvent[]) {
  if (events.length === 0) {
    return "-";
  }

  return events.map((event) => event.symbol).join(", ");
}

function numberFromMetadata(metadata: unknown, key: string) {
  if (!isRecord(metadata)) {
    return null;
  }

  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

async function finishBotRun(database: PrismaClient, botRunId: string, summary: RadarSummaryResult) {
  await database.botRun.update({
    where: { id: botRunId },
    data: {
      status: summary.status,
      finishedAt: new Date(),
      metadataJson: summary as unknown as Prisma.InputJsonObject
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildDashboardUrl(): string | undefined {
  const origin = process.env.DASHBOARD_ORIGIN?.trim();
  return origin ? `${origin.replace(/\/$/, "")}/dashboard` : undefined;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const summary = await radarSummary();
    logger.info(summary, "radarSummary completed");
  } finally {
    await prisma.$disconnect();
  }
}
