import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  sendMarketEventAlertToN8n,
  type MarketEventAlertInput,
  type ResearchAlertSeverity
} from "@signalpilot/alerts";
import {
  BotRunStatus,
  MarketEventSeverity,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  classifyGlobalNews,
  type MarketEventCandidate,
  type MarketEventTypeLiteral
} from "@signalpilot/events-intelligence";
import { assessMarketEventImpact, type ImpactAssessment } from "@signalpilot/impact-engine";
import {
  FinnhubNewsAdapter,
  type FinnhubGeneralNewsFetchResult,
  type GeneralNewsCategory
} from "@signalpilot/market-data";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const supportedCategories: GeneralNewsCategory[] = ["general", "forex", "crypto", "merger"];

const defaultSettings = {
  enabled: false,
  categories: ["general"] as GeneralNewsCategory[],
  maxEventsPerRun: 25,
  alertsEnabled: false,
  minAlertSeverity: MarketEventSeverity.IMPORTANT,
  alertCooldownMinutes: 120,
  maxAlertsPerRun: 3
};

export type GlobalEventMonitorSettings = {
  enabled: boolean;
  categories: GeneralNewsCategory[];
  maxEventsPerRun: number;
  alertsEnabled: boolean;
  minAlertSeverity: MarketEventSeverity;
  alertCooldownMinutes: number;
  maxAlertsPerRun: number;
};

export type GlobalEventMonitorSummary = {
  status: BotRunStatus;
  enabled: boolean;
  categories: GeneralNewsCategory[];
  fetchedNewsCount: number;
  classifiedCandidateCount: number;
  newEventCount: number;
  duplicateEventCount: number;
  impactAssessedCount: number;
  sentAlertCount: number;
  skippedAlertCount: number;
  rateLimited: boolean;
  errorCount: number;
};

type NewsAdapter = Pick<FinnhubNewsAdapter, "fetchGeneralNews" | "assertApiKey">;

type GlobalEventMonitorOptions = {
  fetchClient?: typeof fetch;
  webhookUrl?: string;
  now?: Date;
};

type PersistedMarketEvent = {
  id: string;
  dedupKey: string;
  eventType: MarketEventTypeLiteral;
  severity: MarketEventSeverity;
  confidence: number;
  title: string;
  summary: string | null;
  region: string | null;
  source: string;
  sourceUrl: string | null;
  publishedAt: Date | null;
  detectedAt: Date;
  reasoning: string | null;
  affectedAssetClasses: string[];
  affectedSectors: string[];
  affectedSymbols: string[];
  positiveImpact: string[];
  negativeImpact: string[];
};

export function resolveGlobalEventMonitorSettings(
  env: NodeJS.ProcessEnv = process.env
): GlobalEventMonitorSettings {
  return {
    enabled: env.GLOBAL_EVENT_MONITOR_ENABLED === "true",
    categories: parseCategories(env.GLOBAL_EVENT_MONITOR_CATEGORIES),
    maxEventsPerRun: parsePositiveInteger(
      env.GLOBAL_EVENT_MONITOR_MAX_EVENTS,
      defaultSettings.maxEventsPerRun
    ),
    alertsEnabled: env.GLOBAL_EVENT_ALERTS_ENABLED === "true",
    minAlertSeverity: parseSeverity(env.MIN_EVENT_ALERT_SEVERITY, defaultSettings.minAlertSeverity),
    alertCooldownMinutes: parsePositiveInteger(
      env.GLOBAL_EVENT_ALERT_COOLDOWN_MINUTES,
      defaultSettings.alertCooldownMinutes
    ),
    maxAlertsPerRun: parsePositiveInteger(
      env.GLOBAL_EVENT_MAX_ALERTS_PER_RUN,
      defaultSettings.maxAlertsPerRun
    )
  };
}

export async function globalEventMonitor(
  database: PrismaClient = prisma,
  adapter: NewsAdapter = new FinnhubNewsAdapter(),
  options: GlobalEventMonitorOptions = {}
): Promise<GlobalEventMonitorSummary> {
  const settings = resolveGlobalEventMonitorSettings();
  const botRun = await database.botRun.create({
    data: {
      jobName: "globalEventMonitor",
      status: BotRunStatus.RUNNING,
      metadataJson: settings as unknown as Prisma.InputJsonObject
    }
  });

  await writeBotLog(database, "info", "Global Event Monitor gestartet", {
    botRunId: botRun.id,
    enabled: settings.enabled,
    categories: settings.categories,
    alertsEnabled: settings.alertsEnabled,
    minAlertSeverity: settings.minAlertSeverity
  });

  if (!settings.enabled) {
    const summary = createEmptySummary(settings);
    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, "info", "Global Event Monitor deaktiviert", {
      botRunId: botRun.id,
      enabled: false
    });
    return summary;
  }

  let fetchedNewsCount = 0;
  let classifiedCandidateCount = 0;
  let newEventCount = 0;
  let duplicateEventCount = 0;
  let impactAssessedCount = 0;
  let sentAlertCount = 0;
  let skippedAlertCount = 0;
  let rateLimited = false;
  let errorCount = 0;
  const persistedEvents: PersistedMarketEvent[] = [];

  try {
    adapter.assertApiKey();

    const riskMode = await loadCurrentRiskMode(database);

    for (const category of settings.categories) {
      let result: FinnhubGeneralNewsFetchResult;

      try {
        result = await adapter.fetchGeneralNews(category);
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "Unknown general news fetch error";

        logger.warn({ error, category }, message);
        await writeBotLog(database, "warn", "Global Event Monitor Kategorie übersprungen", {
          botRunId: botRun.id,
          category,
          error: message
        });
        continue;
      }

      if (result.kind === "rate_limit") {
        rateLimited = true;
        await writeBotLog(database, "warn", "Global Event Monitor Rate-Limit erreicht", {
          botRunId: botRun.id,
          category
        });
        continue;
      }

      if (result.kind === "no_news") {
        continue;
      }

      fetchedNewsCount += result.items.length;

      const candidates = classifyGlobalNews(result.items, { feed: `finnhub-${category}` });
      classifiedCandidateCount += candidates.length;

      for (const candidate of candidates) {
        if (newEventCount >= settings.maxEventsPerRun) {
          break;
        }

        const existing = await database.marketEvent.findUnique({
          where: {
            dedupKey: candidate.dedupKey
          },
          select: {
            id: true
          }
        });

        if (existing) {
          duplicateEventCount += 1;
          continue;
        }

        const impact = assessMarketEventImpact(
          {
            eventType: candidate.eventType,
            title: candidate.title,
            summary: candidate.summary,
            region: candidate.region
          },
          { riskMode }
        );

        if (impact) {
          impactAssessedCount += 1;
        }

        const created = await persistMarketEvent(database, candidate, impact);
        persistedEvents.push(created);
        newEventCount += 1;

        await writeBotLog(database, "info", "Global Event Monitor Ereignis erkannt", {
          botRunId: botRun.id,
          marketEventId: created.id,
          eventType: created.eventType,
          severity: created.severity,
          confidence: created.confidence,
          region: created.region,
          source: created.source,
          sourceUrl: created.sourceUrl,
          title: created.title,
          appliedImpactRules: impact?.appliedRules ?? [],
          wording: "Beobachtung, keine Handlungsempfehlung"
        });
      }
    }

    const alertOutcome = await sendAlertsForNewEvents(
      database,
      botRun.id,
      persistedEvents,
      settings,
      options
    );
    sentAlertCount = alertOutcome.sentAlertCount;
    skippedAlertCount = alertOutcome.skippedAlertCount;

    const summary: GlobalEventMonitorSummary = {
      status: BotRunStatus.SUCCESS,
      enabled: settings.enabled,
      categories: settings.categories,
      fetchedNewsCount,
      classifiedCandidateCount,
      newEventCount,
      duplicateEventCount,
      impactAssessedCount,
      sentAlertCount,
      skippedAlertCount,
      rateLimited,
      errorCount
    };

    await finishBotRun(database, botRun.id, summary);
    await writeBotLog(database, "info", "Global Event Monitor fertig", {
      botRunId: botRun.id,
      fetchedNewsCount,
      classifiedCandidateCount,
      newEventCount,
      duplicateEventCount,
      impactAssessedCount,
      sentAlertCount,
      skippedAlertCount,
      rateLimited,
      errorCount
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Global Event Monitor failure";
    const summary: GlobalEventMonitorSummary = {
      status: BotRunStatus.FAILED,
      enabled: settings.enabled,
      categories: settings.categories,
      fetchedNewsCount,
      classifiedCandidateCount,
      newEventCount,
      duplicateEventCount,
      impactAssessedCount,
      sentAlertCount,
      skippedAlertCount,
      rateLimited,
      errorCount: errorCount + 1
    };

    await finishBotRun(database, botRun.id, {
      ...summary,
      fatalError: message
    } as GlobalEventMonitorSummary & { fatalError: string });
    await writeBotLog(database, "error", "Global Event Monitor fehlgeschlagen", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

async function persistMarketEvent(
  database: PrismaClient,
  candidate: MarketEventCandidate,
  impact: ImpactAssessment | null
): Promise<PersistedMarketEvent> {
  const reasoning = impact ? `${candidate.reasoning} ${impact.reasoning}` : candidate.reasoning;
  const created = await database.marketEvent.create({
    data: {
      dedupKey: candidate.dedupKey,
      eventType: candidate.eventType,
      severity: candidate.severity,
      confidence: candidate.confidence,
      title: candidate.title,
      summary: candidate.summary,
      region: candidate.region,
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
      publishedAt: candidate.publishedAt,
      reasoning,
      affectedAssetClasses: impact?.affectedAssetClasses ?? [],
      affectedSectors: impact?.affectedSectors ?? [],
      affectedSymbols: impact?.affectedSymbols ?? [],
      positiveImpact: impact?.potentiallyPositive ?? [],
      negativeImpact: impact?.potentiallyNegative ?? [],
      metadataJson: {
        matchedKeywords: candidate.matchedKeywords,
        appliedImpactRules: impact?.appliedRules ?? [],
        impactConfidence: impact?.confidence ?? null,
        mixedSignals: impact?.mixedSignals ?? [],
        wording: "Beobachtung, keine Handlungsempfehlung"
      }
    }
  });

  return {
    id: created.id,
    dedupKey: created.dedupKey,
    eventType: created.eventType,
    severity: created.severity,
    confidence: created.confidence,
    title: created.title,
    summary: created.summary,
    region: created.region,
    source: created.source,
    sourceUrl: created.sourceUrl,
    publishedAt: created.publishedAt,
    detectedAt: created.detectedAt,
    reasoning: created.reasoning,
    affectedAssetClasses: created.affectedAssetClasses,
    affectedSectors: created.affectedSectors,
    affectedSymbols: created.affectedSymbols,
    positiveImpact: created.positiveImpact,
    negativeImpact: created.negativeImpact
  };
}

async function loadCurrentRiskMode(database: PrismaClient): Promise<string | null> {
  const snapshot = await database.marketRegimeSnapshot.findFirst({
    orderBy: {
      generatedAt: "desc"
    },
    select: {
      riskMode: true
    }
  });

  return snapshot?.riskMode ?? null;
}

async function sendAlertsForNewEvents(
  database: PrismaClient,
  botRunId: string,
  events: PersistedMarketEvent[],
  settings: GlobalEventMonitorSettings,
  options: GlobalEventMonitorOptions
): Promise<{ sentAlertCount: number; skippedAlertCount: number }> {
  let sentAlertCount = 0;
  let skippedAlertCount = 0;

  if (events.length === 0) {
    return { sentAlertCount, skippedAlertCount };
  }

  const now = options.now ?? new Date();
  const cooldownStart = new Date(now.getTime() - settings.alertCooldownMinutes * 60_000);
  const sortedBySeverity = [...events].sort(
    (left, right) => severityRank(right.severity) - severityRank(left.severity)
  );

  for (const event of sortedBySeverity) {
    if (!settings.alertsEnabled) {
      skippedAlertCount += 1;
      continue;
    }

    if (severityRank(event.severity) < severityRank(settings.minAlertSeverity)) {
      skippedAlertCount += 1;
      continue;
    }

    if (sentAlertCount >= settings.maxAlertsPerRun) {
      skippedAlertCount += 1;
      continue;
    }

    const recentAlertForType = await database.marketEvent.findFirst({
      where: {
        eventType: event.eventType,
        alertSentAt: {
          gte: cooldownStart
        }
      },
      select: {
        id: true
      }
    });

    if (recentAlertForType) {
      skippedAlertCount += 1;
      await writeBotLog(database, "info", "Global Event Monitor Alert im Cooldown übersprungen", {
        botRunId,
        marketEventId: event.id,
        eventType: event.eventType,
        cooldownMinutes: settings.alertCooldownMinutes
      });
      continue;
    }

    const result = await sendMarketEventAlertToN8n(
      {
        marketEvent: buildAlertInput(event),
        dashboardUrl: buildDashboardUrl()
      },
      {
        database,
        fetchClient: options.fetchClient,
        webhookUrl: options.webhookUrl
      }
    );

    if (result.status === "SENT") {
      sentAlertCount += 1;
      await database.marketEvent.update({
        where: {
          id: event.id
        },
        data: {
          alertSentAt: new Date()
        }
      });
    } else {
      skippedAlertCount += 1;
    }
  }

  return { sentAlertCount, skippedAlertCount };
}

function buildAlertInput(event: PersistedMarketEvent): MarketEventAlertInput {
  return {
    id: event.id,
    alertType: alertTypeFromEventType(event.eventType),
    severity: event.severity as ResearchAlertSeverity,
    title: event.title,
    summary: event.summary ?? event.title,
    reasoning: event.reasoning,
    region: event.region,
    affectedAssetClasses: event.affectedAssetClasses,
    affectedSectors: event.affectedSectors,
    affectedSymbols: event.affectedSymbols,
    positiveImpact: event.positiveImpact,
    negativeImpact: event.negativeImpact,
    confidence: event.confidence,
    sourceName: `${event.source} (Finnhub News)`,
    sourceUrl: event.sourceUrl,
    publishedAt: event.publishedAt,
    detectedAt: event.detectedAt
  };
}

function alertTypeFromEventType(eventType: MarketEventTypeLiteral): MarketEventAlertInput["alertType"] {
  if (eventType === "CONFLICT" || eventType === "GEOPOLITICAL" || eventType === "SANCTIONS") {
    return "geopolitical_event";
  }

  if (
    eventType === "CENTRAL_BANK" ||
    eventType === "RATES" ||
    eventType === "INFLATION" ||
    eventType === "LABOR_MARKET" ||
    eventType === "MACRO"
  ) {
    return "macro_event";
  }

  if (eventType === "RISK_SENTIMENT") {
    return "risk_warning";
  }

  return "market_event";
}

function createEmptySummary(settings: GlobalEventMonitorSettings): GlobalEventMonitorSummary {
  return {
    status: BotRunStatus.SUCCESS,
    enabled: settings.enabled,
    categories: settings.categories,
    fetchedNewsCount: 0,
    classifiedCandidateCount: 0,
    newEventCount: 0,
    duplicateEventCount: 0,
    impactAssessedCount: 0,
    sentAlertCount: 0,
    skippedAlertCount: 0,
    rateLimited: false,
    errorCount: 0
  };
}

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  metadataJson: GlobalEventMonitorSummary | (GlobalEventMonitorSummary & { fatalError: string })
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

function parseCategories(value: string | undefined): GeneralNewsCategory[] {
  if (!value) {
    return defaultSettings.categories;
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is GeneralNewsCategory =>
      supportedCategories.includes(entry as GeneralNewsCategory)
    );

  return parsed.length > 0 ? [...new Set(parsed)] : defaultSettings.categories;
}

function parseSeverity(value: string | undefined, fallback: MarketEventSeverity): MarketEventSeverity {
  if (!value) {
    return fallback;
  }

  if (Object.values(MarketEventSeverity).includes(value as MarketEventSeverity)) {
    return value as MarketEventSeverity;
  }

  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function severityRank(severity: MarketEventSeverity): number {
  if (severity === MarketEventSeverity.CRITICAL) {
    return 4;
  }

  if (severity === MarketEventSeverity.IMPORTANT) {
    return 3;
  }

  if (severity === MarketEventSeverity.WATCH) {
    return 2;
  }

  return 1;
}

function buildDashboardUrl(): string | undefined {
  const origin = process.env.DASHBOARD_ORIGIN?.trim();

  if (!origin) {
    return undefined;
  }

  return `${origin.replace(/\/$/, "")}/dashboard`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const summary = await globalEventMonitor();
    logger.info(summary, "globalEventMonitor completed");
  } finally {
    await prisma.$disconnect();
  }
}
