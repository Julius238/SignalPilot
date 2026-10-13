/**
 * Every hourly strategy evaluation — with or without a candidate — read from
 * the audit events the candidate job already writes (`persistStrategyEvaluation`).
 * Lets the dashboard answer "why did the bot (not) trade this hour?".
 */

import type { PrismaClient } from "@signalpilot/database";

const EVALUATION_EVENT_TYPES = ["STRATEGY_EVALUATION_REJECTED", "STRATEGY_CANDIDATE_CREATED"] as const;

interface StoredCheck {
  readonly checkId?: unknown;
  readonly stage?: unknown;
  readonly passed?: unknown;
  readonly reasonCode?: unknown;
  readonly actual?: unknown;
  readonly limit?: unknown;
}

export interface StrategyEvaluationDto {
  readonly id: string;
  readonly occurredAt: string;
  readonly symbol: string | null;
  readonly outcome: "CANDIDATE" | "NO_CANDIDATE" | "INVALID_INPUT";
  readonly primaryReasonCode: string;
  readonly tradeCandidateId: string | null;
  readonly checksPassed: number;
  readonly checksTotal: number;
  readonly failedChecks: readonly {
    readonly checkId: string;
    readonly reasonCode: string;
    readonly actual: string | null;
    readonly limit: string | null;
  }[];
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

export async function listStrategyEvaluations(
  database: PrismaClient,
  options: { readonly limit: number; readonly offset: number }
): Promise<StrategyEvaluationDto[]> {
  const events = await database.tradingAuditEvent.findMany({
    where: { eventType: { in: [...EVALUATION_EVENT_TYPES] } },
    orderBy: { occurredAt: "desc" },
    take: options.limit,
    skip: options.offset
  });

  return events.map((event) => {
    const metadata = (event.metadataJson ?? {}) as Record<string, unknown>;
    const checks = (Array.isArray(metadata.checks) ? metadata.checks : []) as StoredCheck[];
    const created = event.eventType === "STRATEGY_CANDIDATE_CREATED";
    const storedOutcome = asString(metadata.outcome);
    return {
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      symbol: asString(metadata.symbol),
      outcome: created ? "CANDIDATE" : storedOutcome === "INVALID_INPUT" ? "INVALID_INPUT" : "NO_CANDIDATE",
      primaryReasonCode: event.reasonCode,
      tradeCandidateId: created ? event.aggregateId : null,
      checksPassed: checks.filter((check) => check.passed === true).length,
      checksTotal: checks.length,
      failedChecks: checks
        .filter((check) => check.passed === false)
        .map((check) => ({
          checkId: asString(check.checkId) ?? "UNKNOWN",
          reasonCode: asString(check.reasonCode) ?? "UNKNOWN",
          actual: asString(check.actual),
          limit: asString(check.limit)
        }))
    };
  });
}

export interface MarketDataOriginDto {
  readonly symbol: string;
  readonly source: string | null;
  readonly synthetic: boolean;
  readonly latestCloseTime: string | null;
}

const TRADED_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

/**
 * Where the candles the strategy decides on come from. The dev feed writes
 * `source = "SYNTHETIC"`; the dashboard must then say so on every trading page,
 * so simulated signals are never mistaken for decisions on real market data.
 */
export async function getMarketDataOrigin(database: PrismaClient): Promise<MarketDataOriginDto[]> {
  return Promise.all(
    TRADED_SYMBOLS.map(async (symbol) => {
      const candle = await database.candle.findFirst({
        where: { symbol, timeframe: "1h" },
        orderBy: { closeTime: "desc" },
        select: { source: true, closeTime: true }
      });
      return {
        symbol,
        source: candle?.source ?? null,
        synthetic: candle?.source === "SYNTHETIC",
        latestCloseTime: candle?.closeTime.toISOString() ?? null
      };
    })
  );
}
