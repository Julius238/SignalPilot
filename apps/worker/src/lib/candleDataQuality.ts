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

  await database.candleDataQuality.upsert({
    where: qualityKey(input),
    create: {
      assetId: input.assetId,
      provider: input.provider,
      timeframe: input.timeframe,
      ...toAuditData(audit, now),
      lastAuditAt: now
    },
    update: {
      ...toAuditData(audit, now),
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
  const successData =
    input.kind === "SUCCESS"
      ? { lastSuccessfulFetchAt: at, lastErrorKind: null, lastErrorAt: null }
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

function toAuditData(audit: CandleGapAudit, now: Date) {
  return {
    oldestCandle: audit.oldestCandle,
    latestClosedCandle: audit.latestClosedCandle,
    candleCount: audit.candleCount,
    expectedCandleCount: audit.expectedCandleCount,
    gapCount: audit.gapCount,
    missingCandleCount: audit.missingCandleCount,
    latestDataAgeSeconds: audit.latestClosedCandle
      ? Math.max(0, Math.floor((now.getTime() - audit.latestClosedCandle.getTime()) / 1000))
      : null,
    metadataJson: {
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
