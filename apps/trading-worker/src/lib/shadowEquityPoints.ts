/**
 * Intraday equity curve: one conservative valuation per UTC hour
 * (`PortfolioEquityPoint`), written by the hourly performance refresh.
 *
 * Reporting only. The day-start snapshot (`PortfolioSnapshot`) stays the one
 * reference for R-010 and the daily return statistics, so an hourly point can
 * never change a risk decision or a Sharpe ratio. Idempotent by
 * `(portfolioId, hour)`: a second run in the same hour changes nothing.
 */

import { ShadowPositionStatus, type PrismaClient } from "@signalpilot/database";

import { decimalString } from "./shadowPortfolioIo.js";
import { loadShadowPortfolioValuation } from "./shadowPortfolioValuation.js";

const HOUR_MS = 60 * 60 * 1000;

const OPEN_POSITION_STATUSES = [
  ShadowPositionStatus.OPENING,
  ShadowPositionStatus.OPEN,
  ShadowPositionStatus.PARTIALLY_CLOSED,
  ShadowPositionStatus.ERROR
];

export interface RecordEquityPointResult {
  readonly outcome: "CREATED" | "ALREADY_RECORDED";
  readonly asOf: string;
  readonly equity: string | null;
}

/** The UTC hour a run at `at` records: a run at 14:15 values the portfolio as of 14:00. */
export function equityPointHour(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

export async function recordPortfolioEquityPoint(
  database: PrismaClient,
  input: { readonly portfolioId: string; readonly asOf: Date }
): Promise<RecordEquityPointResult> {
  const hour = equityPointHour(input.asOf);
  const existing = await database.portfolioEquityPoint.findUnique({
    where: { portfolioId_asOf: { portfolioId: input.portfolioId, asOf: hour } }
  });
  if (existing !== null) {
    return { outcome: "ALREADY_RECORDED", asOf: hour.toISOString(), equity: decimalString(existing.equity) };
  }

  const portfolio = await database.portfolio.findUnique({ where: { id: input.portfolioId } });
  if (portfolio === null) throw new Error(`Portfolio ${input.portfolioId} not found.`);

  // Valued at the full hour with the candles closed by then — the same
  // fail-closed mark path as reconciliation and the day-start snapshot.
  const { valuation } = await loadShadowPortfolioValuation(database, {
    portfolioId: portfolio.id,
    asOf: hour,
    availableCash: decimalString(portfolio.availableCash),
    reservedCash: decimalString(portfolio.reservedCash),
    realizedPnl: decimalString(portfolio.realizedPnl),
    feesPaid: decimalString(portfolio.feesPaid),
    highWaterMark: decimalString(portfolio.highWaterMark),
    startOfDayEquity: null
  });
  const openPositionCount = await database.shadowPosition.count({
    where: { portfolioId: portfolio.id, status: { in: OPEN_POSITION_STATUSES } }
  });

  await database.portfolioEquityPoint.create({
    data: {
      portfolioId: portfolio.id,
      asOf: hour,
      sourceLedgerSequence: portfolio.ledgerSequence,
      availableCash: portfolio.availableCash,
      reservedCash: portfolio.reservedCash,
      marketValue: valuation.marketValue,
      equity: valuation.equity,
      realizedPnl: portfolio.realizedPnl,
      unrealizedPnl: valuation.unrealizedPnl,
      highWaterMark: valuation.highWaterMark,
      drawdownPct: valuation.drawdownPct,
      openPositionCount
    }
  });
  return { outcome: "CREATED", asOf: hour.toISOString(), equity: valuation.equity };
}
