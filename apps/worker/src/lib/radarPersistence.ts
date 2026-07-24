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
  now?: Date;
};

export function toPatternCandidate(pattern: ChartPatternObservation): RadarEventCandidate {
  return {
    eventType: RadarEventType[pattern.patternType],
    severity: RadarEventSeverity[pattern.severity],
    score: pattern.score,
    shortMessage: pattern.shortMessage,
    extraMetadata: {
      patternDirection: pattern.direction,
      patternConfirmed: pattern.patternType === "MOMENTUM_SHIFT",
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
  const now = context.now ?? new Date();
  const cooldownStart = new Date(now.getTime() - context.cooldownMinutes * 60 * 1000);

  for (const candidate of candidates) {
    const existing = await database.radarEvent.findFirst({
      where: {
        symbol: context.symbol,
        timeframe: context.timeframe,
        eventType: candidate.eventType
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        score: true,
        severity: true,
        movePercent: true,
        metadataJson: true,
        createdAt: true
      }
    });
    const repeat = evaluateRadarRepeat(context, candidate, existing);
    const withinCooldown =
      existing !== null && existing.createdAt.getTime() >= cooldownStart.getTime();

    if (withinCooldown && !repeat.materialChange) {
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
          ...candidate.extraMetadata,
          alertMaterialChange: repeat.materialChange,
          alertMaterialReason: repeat.reason,
          alertBaseline: repeat.nextBaseline
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

type RadarRepeatBaseline = {
  score: number;
  severity: RadarEventSeverity;
  direction: "UP" | "DOWN" | null;
};

function evaluateRadarRepeat(
  context: RadarPersistenceContext,
  candidate: RadarEventCandidate,
  existing: {
    score: number | null;
    severity: RadarEventSeverity;
    movePercent: number | null;
    metadataJson: unknown;
  } | null
): {
  materialChange: boolean;
  reason: string;
  nextBaseline: RadarRepeatBaseline;
} {
  const current: RadarRepeatBaseline = {
    score: candidate.score,
    severity: candidate.severity,
    direction: radarDirection(context.movePercent, candidate.extraMetadata)
  };

  if (!existing) {
    return {
      materialChange: true,
      reason: "NO_PREVIOUS_ALERT",
      nextBaseline: current
    };
  }

  const existingMetadata = toRecord(existing.metadataJson);
  const storedBaseline = toRecord(existingMetadata.alertBaseline);
  const baseline: RadarRepeatBaseline = {
    score: toFiniteNumber(storedBaseline.score) ?? existing.score ?? 0,
    severity:
      toRadarSeverity(storedBaseline.severity) ?? existing.severity,
    direction:
      toRadarDirection(storedBaseline.direction) ??
      radarDirection(existing.movePercent, existingMetadata)
  };

  if (current.score - baseline.score >= 8) {
    return {
      materialChange: true,
      reason: "SCORE_IMPROVED",
      nextBaseline: current
    };
  }

  if (radarSeverityRank(current.severity) > radarSeverityRank(baseline.severity)) {
    return {
      materialChange: true,
      reason: "SEVERITY_ESCALATED",
      nextBaseline: current
    };
  }

  if (
    current.direction !== null &&
    baseline.direction !== null &&
    current.direction !== baseline.direction
  ) {
    return {
      materialChange: true,
      reason: "DIRECTION_CHANGED",
      nextBaseline: current
    };
  }

  return {
    materialChange: false,
    reason: "NO_MATERIAL_IMPROVEMENT",
    nextBaseline: baseline
  };
}

function radarDirection(
  movePercent: number | null | undefined,
  metadata: Record<string, unknown> | undefined
): "UP" | "DOWN" | null {
  const patternDirection = toRadarDirection(metadata?.patternDirection);

  if (patternDirection) {
    return patternDirection;
  }

  if (typeof movePercent !== "number" || movePercent === 0) {
    return null;
  }

  return movePercent > 0 ? "UP" : "DOWN";
}

function toRadarDirection(value: unknown): "UP" | "DOWN" | null {
  return value === "UP" || value === "DOWN" ? value : null;
}

function toRadarSeverity(value: unknown): RadarEventSeverity | null {
  return typeof value === "string" &&
    Object.values(RadarEventSeverity).includes(value as RadarEventSeverity)
    ? (value as RadarEventSeverity)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
