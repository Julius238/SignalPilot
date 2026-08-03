import { decimalToString, toIso, toIsoOrNull } from "./common.js";

/**
 * Hand-written field shapes rather than `Prisma.PortfolioGetPayload<...>` —
 * every mapper here only reads the fields it lists, so it works regardless
 * of the exact `select`/`include` the caller used to fetch the row.
 */
export interface PortfolioRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly status: string;
  readonly startingCash: unknown;
  readonly availableCash: unknown;
  readonly reservedCash: unknown;
  readonly realizedPnl: unknown;
  readonly feesPaid: unknown;
  readonly equity: unknown;
  readonly highWaterMark: unknown;
  readonly ledgerSequence: number;
  readonly lastReconciledAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PortfolioSnapshotRow {
  readonly id: string;
  readonly portfolioId: string;
  readonly asOf: Date;
  readonly tradingDateUtc: Date;
  readonly availableCash: unknown;
  readonly reservedCash: unknown;
  readonly marketValue: unknown;
  readonly equity: unknown;
  readonly realizedPnl: unknown;
  readonly unrealizedPnl: unknown;
  readonly feesPaid: unknown;
  readonly dailyPnl: unknown;
  readonly highWaterMark: unknown;
  readonly drawdownAmount: unknown;
  readonly drawdownPct: unknown;
  readonly grossExposure: unknown;
  readonly openPositionCount: number;
}

export function toPortfolioSummary(portfolio: PortfolioRow) {
  return {
    id: portfolio.id,
    key: portfolio.key,
    name: portfolio.name,
    baseCurrency: portfolio.baseCurrency,
    status: portfolio.status,
    startingCash: decimalToString(portfolio.startingCash),
    availableCash: decimalToString(portfolio.availableCash),
    reservedCash: decimalToString(portfolio.reservedCash),
    realizedPnl: decimalToString(portfolio.realizedPnl),
    feesPaid: decimalToString(portfolio.feesPaid),
    equity: decimalToString(portfolio.equity),
    highWaterMark: decimalToString(portfolio.highWaterMark),
    ledgerSequence: portfolio.ledgerSequence,
    lastReconciledAt: toIsoOrNull(portfolio.lastReconciledAt),
    version: portfolio.version,
    updatedAt: toIso(portfolio.updatedAt)
  };
}

export function toPortfolioSnapshot(snapshot: PortfolioSnapshotRow) {
  return {
    id: snapshot.id,
    portfolioId: snapshot.portfolioId,
    asOf: toIso(snapshot.asOf),
    tradingDateUtc: toIso(snapshot.tradingDateUtc),
    availableCash: decimalToString(snapshot.availableCash),
    reservedCash: decimalToString(snapshot.reservedCash),
    marketValue: decimalToString(snapshot.marketValue),
    equity: decimalToString(snapshot.equity),
    realizedPnl: decimalToString(snapshot.realizedPnl),
    unrealizedPnl: decimalToString(snapshot.unrealizedPnl),
    feesPaid: decimalToString(snapshot.feesPaid),
    dailyPnl: decimalToString(snapshot.dailyPnl),
    highWaterMark: decimalToString(snapshot.highWaterMark),
    drawdownAmount: decimalToString(snapshot.drawdownAmount),
    drawdownPct: decimalToString(snapshot.drawdownPct),
    grossExposure: decimalToString(snapshot.grossExposure),
    openPositionCount: snapshot.openPositionCount
  };
}
