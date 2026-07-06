import {
  RadarEventSeverity,
  RadarEventType,
  type AssetType,
  type PrismaClient
} from "@signalpilot/database";

import type { ChartPatternObservation } from "./chartPatterns.js";

// Gemeinsame RadarEvent-Persistenz für Crypto- und Equity-Radar:
// dedupliziert pro Symbol/Timeframe/EventType innerhalb des Cooldown-Fensters.

export type RadarEventCandidate = {
  eventType: RadarEventType;
  severity: RadarEventSeverity;
  score: number;
  shortMessage: string;
  extraMetadata?: Record<string, unknown>;
};

export type PersistedRadarEvent = {
  id: string;
  symbol: string;
  assetType: AssetType;
  eventType: RadarEventType;
  severity: RadarEventSeverity;
  timeframe: string;
  shortMessage: string;
  score: number | null;
  movePercent: number | null;
  relativeVolume: number | null;
  rangePercent: number | null;
  metadataJson: unknown;
  createdAt: Date;
};

export type RadarPersistenceContext = {
  assetId: string | null;
  symbol: string;
  assetType: AssetType;
  timeframe: string;
  movePercent?: number | null;
  relativeVolume?: number | null;
  rangePercent?: number | null;
  baseMetadata?: Record<string, unknown>;
  cooldownMinutes: number;
};

export function toPatternCandidate(pattern: ChartPatternObservation): RadarEventCandidate {
  return {
    eventType: RadarEventType[pattern.patternType],
    severity: RadarEventSeverity[pattern.severity],
    score: pattern.score,
    shortMessage: pattern.shortMessage,
    extraMetadata: {
      patternDirection: pattern.direction,
      patternFactor: pattern.factorLabel,
      patternDetails: pattern.details
    }
  };
}

export async function persistRadarEventCandidates(
  database: PrismaClient,
  context: RadarPersistenceContext,
  candidates: RadarEventCandidate[]
): Promise<PersistedRadarEvent[]> {
  const persistedEvents: PersistedRadarEvent[] = [];
  const cooldownStart = new Date(Date.now() - context.cooldownMinutes * 60 * 1000);

  for (const candidate of candidates) {
    const existing = await database.radarEvent.findFirst({
      where: {
        symbol: context.symbol,
        timeframe: context.timeframe,
        eventType: candidate.eventType,
        createdAt: {
          gte: cooldownStart
        }
      },
      select: {
        id: true
      }
    });

    if (existing) {
      continue;
    }

    const radarEvent = await database.radarEvent.create({
      data: {
        assetId: context.assetId,
        symbol: context.symbol,
        assetType: context.assetType,
        eventType: candidate.eventType,
        severity: candidate.severity,
        timeframe: context.timeframe,
        score: candidate.score,
        movePercent: context.movePercent ?? null,
        relativeVolume: context.relativeVolume ?? null,
        rangePercent: context.rangePercent ?? null,
        shortMessage: candidate.shortMessage,
        metadataJson: {
          ...context.baseMetadata,
          wording: "Beobachtung, keine Handlungsempfehlung",
          ...candidate.extraMetadata
        }
      }
    });

    persistedEvents.push({
      id: radarEvent.id,
      symbol: radarEvent.symbol,
      assetType: radarEvent.assetType,
      eventType: radarEvent.eventType,
      severity: radarEvent.severity,
      timeframe: radarEvent.timeframe,
      shortMessage: radarEvent.shortMessage,
      score: radarEvent.score,
      movePercent: radarEvent.movePercent,
      relativeVolume: radarEvent.relativeVolume,
      rangePercent: radarEvent.rangePercent,
      metadataJson: radarEvent.metadataJson,
      createdAt: radarEvent.createdAt
    });
  }

  return persistedEvents;
}

export function radarSeverityRank(severity: RadarEventSeverity): number {
  if (severity === RadarEventSeverity.CRITICAL) {
    return 4;
  }

  if (severity === RadarEventSeverity.IMPORTANT) {
    return 3;
  }

  if (severity === RadarEventSeverity.WATCH) {
    return 2;
  }

  return 1;
}

export function buildDashboardUrl(): string | undefined {
  const origin = process.env.DASHBOARD_ORIGIN?.trim();

  if (!origin) {
    return undefined;
  }

  return `${origin.replace(/\/$/, "")}/dashboard`;
}
