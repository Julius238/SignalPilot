import { type Prisma, type PrismaClient } from "@signalpilot/database";
import {
  detectCandleGaps,
  type CandleGapAudit,
  type CandleMarketKind
} from "@signalpilot/market-data";

export type ProviderOutcomeKind =
  | "SUCCESS"
  | "NO_DATA"
  | "RATE_LIMIT"
  | "INVALID_API_KEY"
  | "ENTITLEMENT"
  | "UNSUPPORTED_SYMBOL"
  | "TEMPORARY"
  | "PERMANENT";

/**
 * Strategy, risk and eligibility read `gapCount`/`missingCandleCount` as "is
 * the data the indicators use complete?" (docs/trading/05: no gap in the last
 * 200 intervals). Those two counters therefore cover the newest 250 closed
 * candles — the window the signal and strategy jobs read — instead of the
 * whole history: a 2019 exchange outage must not mark an asset unhealthy
 * forever. Oldest candle and candle counts stay full-history for coverage;
 * the full-history gap statistics stay in `metadataJson`.
 */
export const DATA_QUALITY_AUDIT_WINDOW_CANDLES = 250;

export async function refreshCandleDataQuality(
  database: PrismaClient,
  input: {
    assetId: string;
    provider: string;
    timeframe: string;
    marketKind: CandleMarketKind;
    now?: Date;
  }
): Promise<CandleGapAudit> {
  const now = input.now ?? new Date();
  const candles = await database.candle.findMany({
    where: {
      assetId: input.assetId,
      timeframe: input.timeframe,
      source: input.provider,
      closeTime: { lte: now }
    },
    orderBy: { openTime: "asc" },
    select: { openTime: true, closeTime: true }
  });
  const audit = detectCandleGaps(candles, {
    timeframe: input.timeframe,
    marketKind: input.marketKind,
    now
  });
  // The window plus the candle before it, so a gap at its start is visible.
  const windowAudit = detectCandleGaps(candles.slice(-(DATA_QUALITY_AUDIT_WINDOW_CANDLES + 1)), {
    timeframe: input.timeframe,
    marketKind: input.marketKind,
    now
  });

  await database.candleDataQuality.upsert({
    where: qualityKey(input),
    create: {
      assetId: input.assetId,
      provider: input.provider,
      timeframe: input.timeframe,
      ...toAuditData(audit, windowAudit, now),
      lastAuditAt: now
    },
    update: {
      ...toAuditData(audit, windowAudit, now),
      lastAuditAt: now
    }
  });

  return audit;
}

export async function recordProviderOutcome(
  database: PrismaClient,
  input: {
    assetId: string;
    provider: string;
    timeframe: string;
    kind: ProviderOutcomeKind;
    at?: Date;
    count?: number;
  }
) {
  const at = input.at ?? new Date();
  const count = Math.max(1, Math.floor(input.count ?? 1));
  const counters = counterUpdate(input.kind, count);
  // The error counters mean "since the last successful fetch": strategy and
  // risk treat any non-zero value as unhealthy data, so a lifetime total would
  // let one transient provider error block the asset forever. A success
  // therefore clears them (the history stays in BotRun/BotLog).
  const successData =
    input.kind === "SUCCESS"
      ? {
          lastSuccessfulFetchAt: at,
          lastErrorKind: null,
          lastErrorAt: null,
          providerErrorCount: 0,
          rateLimitCount: 0,
          entitlementErrorCount: 0,
          noDataCount: 0
        }
      : {};
  const errorData =
    input.kind !== "SUCCESS" && input.kind !== "NO_DATA"
      ? { lastErrorKind: input.kind, lastErrorAt: at }
      : {};

  await database.candleDataQuality.upsert({
    where: qualityKey(input),
    create: {
      assetId: input.assetId,
      provider: input.provider,
      timeframe: input.timeframe,
      ...counterCreate(input.kind, count),
      ...successData,
      ...errorData
    },
    update: {
      ...counters,
      ...successData,
      ...errorData
    }
  });
}

export async function markBackfillProgress(
  database: PrismaClient,
  input: {
    assetId: string;
    provider: string;
    timeframe: string;
    start: Date;
    end: Date;
    cursor: Date;
    status: "RUNNING" | "SUCCESS" | "FAILED";
    metadataJson?: Prisma.InputJsonValue;
  }
) {
  await database.candleDataQuality.upsert({
    where: qualityKey(input),
    create: {
      assetId: input.assetId,
      provider: input.provider,
      timeframe: input.timeframe,
      backfillStart: input.start,
      backfillEnd: input.end,
      backfillCursor: input.cursor,
      backfillStatus: input.status,
      metadataJson: input.metadataJson
    },
    update: {
      backfillStart: input.start,
      backfillEnd: input.end,
      backfillCursor: input.cursor,
      backfillStatus: input.status,
      metadataJson: input.metadataJson
    }
  });
}

function qualityKey(input: { assetId: string; provider: string; timeframe: string }) {
  return {
    assetId_provider_timeframe: {
      assetId: input.assetId,
      provider: input.provider,
      timeframe: input.timeframe
    }
  };
}

function toAuditData(audit: CandleGapAudit, windowAudit: CandleGapAudit, now: Date) {
  return {
    oldestCandle: audit.oldestCandle,
    latestClosedCandle: audit.latestClosedCandle,
    candleCount: audit.candleCount,
    expectedCandleCount: audit.expectedCandleCount,
    gapCount: windowAudit.gapCount,
    missingCandleCount: windowAudit.missingCandleCount,
    latestDataAgeSeconds: audit.latestClosedCandle
      ? Math.max(0, Math.floor((now.getTime() - audit.latestClosedCandle.getTime()) / 1000))
      : null,
    metadataJson: {
      auditWindowCandles: DATA_QUALITY_AUDIT_WINDOW_CANDLES,
      lifetimeGapCount: audit.gapCount,
      lifetimeMissingCandleCount: audit.missingCandleCount,
      gaps: audit.gaps.slice(0, 100).map((gap) => ({
        from: gap.from.toISOString(),
        to: gap.to.toISOString(),
        missingCandleCount: gap.missingCandleCount
      })),
      gapListTruncated: audit.gaps.length > 100
    } satisfies Prisma.InputJsonValue
  };
}

function counterCreate(kind: ProviderOutcomeKind, count: number) {
  return {
    providerErrorCount: isProviderError(kind) ? count : 0,
    rateLimitCount: kind === "RATE_LIMIT" ? count : 0,
    entitlementErrorCount: kind === "ENTITLEMENT" ? count : 0,
    noDataCount: kind === "NO_DATA" ? count : 0
  };
}

function counterUpdate(kind: ProviderOutcomeKind, count: number) {
  const update: Prisma.CandleDataQualityUpdateInput = {};
  if (isProviderError(kind)) update.providerErrorCount = { increment: count };
  if (kind === "RATE_LIMIT") update.rateLimitCount = { increment: count };
  if (kind === "ENTITLEMENT") update.entitlementErrorCount = { increment: count };
  if (kind === "NO_DATA") update.noDataCount = { increment: count };
  return update;
}

function isProviderError(kind: ProviderOutcomeKind) {
  return (
    kind === "INVALID_API_KEY" ||
    kind === "UNSUPPORTED_SYMBOL" ||
    kind === "TEMPORARY" ||
    kind === "PERMANENT"
  );
}
