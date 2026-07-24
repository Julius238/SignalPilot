import type { SignalAlertQualityContext } from "@signalpilot/alerts";
import type { PrismaClient } from "@signalpilot/database";
import type { IndicatorCandle } from "@signalpilot/indicators";
import type { MultiTimeframeSummary } from "@signalpilot/multi-timeframe";
import type { IndicatorSnapshot, SignalDecision } from "@signalpilot/shared";

export function buildSignalAlertQualityContext(input: {
  decision: SignalDecision;
  candles: readonly IndicatorCandle[];
  indicators: IndicatorSnapshot;
  multiTimeframeSummary: MultiTimeframeSummary;
  newsContext?: unknown;
  eventContext?: unknown;
  materialRepeat?: boolean;
}): SignalAlertQualityContext {
  return {
    closedCandle: true,
    freshData: true,
    patternConfirmed:
      input.decision.signalType !== "BREAKOUT_ALERT" ||
      isBreakoutConfirmed(input.candles, input.decision.direction),
    volumeConfirmed:
      input.indicators.relativeVolume !== null && input.indicators.relativeVolume >= 1.5,
    confirmingTimeframes: [...input.multiTimeframeSummary.confirmingTimeframes],
    newsEventContextFingerprint: buildNewsEventContextFingerprint(
      input.newsContext,
      input.eventContext
    ),
    materialRepeat: input.materialRepeat ?? false
  };
}

export function extractPreviousNotificationContext(dashboardJson: unknown): {
  confirmingTimeframes: string[];
  newsEventContextFingerprint: string | null;
} {
  const dashboard = toRecord(dashboardJson);
  const multiTimeframeSummary = toRecord(dashboard.multiTimeframeSummary);

  return {
    confirmingTimeframes: toStringArray(multiTimeframeSummary.confirmingTimeframes),
    newsEventContextFingerprint: buildNewsEventContextFingerprint(
      dashboard.newsContext,
      dashboard.eventContext
    )
  };
}

export async function loadPreviousNotificationContext(
  database: PrismaClient,
  signalId: string | null | undefined
): Promise<{
  confirmingTimeframes: string[];
  newsEventContextFingerprint: string | null;
}> {
  if (!signalId) {
    return {
      confirmingTimeframes: [],
      newsEventContextFingerprint: null
    };
  }

  const previousOutput = await database.signalOutput.findUnique({
    where: {
      signalId
    },
    select: {
      dashboardJson: true
    }
  });

  return extractPreviousNotificationContext(previousOutput?.dashboardJson);
}

export function buildNewsEventContextFingerprint(
  newsContext: unknown,
  eventContext: unknown
): string | null {
  const news = toRecord(newsContext);
  const event = toRecord(eventContext);
  const relevantNewsCount = toFiniteNumber(news.relevantNewsCount) ?? 0;
  const topNews =
    relevantNewsCount > 0
      ? toRecordArray(news.topNews).map((item) => ({
          headline: toString(item.headline),
          source: toString(item.source),
          publishedAt: toString(item.publishedAt)
        }))
      : [];
  const eventItems = [
    ...toRecordArray(event.recentEvents),
    ...toRecordArray(event.upcomingEvents)
  ].map((item) => ({
    id: toString(item.id),
    eventType: toString(item.eventType),
    title: toString(item.title),
    eventDate: toString(item.eventDate)
  }));

  if (topNews.length === 0 && eventItems.length === 0) {
    return null;
  }

  return JSON.stringify({
    news: topNews,
    events: eventItems
  });
}

export function isBreakoutConfirmed(
  candles: readonly IndicatorCandle[],
  direction: SignalDecision["direction"],
  lookback = 20
): boolean {
  if (candles.length < lookback + 1) {
    return false;
  }

  const latest = candles.at(-1);
  const previousWindow = candles.slice(-(lookback + 1), -1);
  const latestClose = toFiniteNumber(latest?.close);
  const previousHighs = previousWindow.map((candle) => toFiniteNumber(candle.high));
  const previousLows = previousWindow.map((candle) => toFiniteNumber(candle.low));

  if (
    latestClose === null ||
    previousHighs.some((value) => value === null) ||
    previousLows.some((value) => value === null)
  ) {
    return false;
  }

  if (direction === "BULLISH") {
    return latestClose > Math.max(...(previousHighs as number[]));
  }

  if (direction === "BEARISH") {
    return latestClose < Math.min(...(previousLows as number[]));
  }

  return false;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(toRecord) : [];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}
