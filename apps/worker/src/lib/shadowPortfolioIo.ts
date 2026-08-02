/**
 * Shared Prisma <-> `@signalpilot/portfolio` conversion helpers.
 *
 * Specification: docs/trading/02-shadow-trading-target-architecture.md,
 * "Transaktionsgrenzen" 3-5; ADR 0004 (append-only ledger, atomic audit).
 *
 * Every P4 job that moves money (order creation, fills, exits,
 * reconciliation) goes through these helpers so the compare-and-swap on
 * `Portfolio.version` and the ledger-entry row shape are written exactly once.
 */

import { Prisma } from "@signalpilot/database";
import type { LedgerEntryDraftV1, PortfolioStateV1 } from "@signalpilot/portfolio";
import { DecimalValue } from "@signalpilot/trading-domain";

/** The subset of a Prisma transaction client this module needs. */
export interface PortfolioTransactionClient {
  readonly portfolio: {
    readonly updateMany: (args: {
      readonly where: { readonly id: string; readonly version: number };
      readonly data: Record<string, unknown>;
    }) => Promise<{ readonly count: number }>;
  };
}

type Json = Prisma.InputJsonValue;
export const asJson = (value: unknown): Json => value as Json;

export function decimalString(value: unknown): string {
  if (value instanceof Prisma.Decimal) return value.toFixed(12);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  ) {
    return (value as { toFixed: (digits: number) => string }).toFixed(12);
  }
  if (typeof value === "number") return value.toFixed(12);
  // A real Prisma `Decimal` column never round-trips as a plain string, so
  // this only ever matches an already-canonical fixed-scale string (e.g. one
  // produced by this same function, or a test fixture).
  if (typeof value === "string" && DecimalValue.isDecimalString(value)) {
    return DecimalValue.fromString(value).toString();
  }
  return "0.000000000000";
}

export const nullableDecimal = (value: unknown): string | null =>
  value === null || value === undefined ? null : decimalString(value);

/** The subset of a `Portfolio` row this module reads. */
export interface PortfolioRow {
  readonly availableCash: unknown;
  readonly reservedCash: unknown;
  readonly realizedPnl: unknown;
  readonly feesPaid: unknown;
  readonly ledgerSequence: number;
}

export function portfolioState(portfolio: PortfolioRow): PortfolioStateV1 {
  return {
    availableCash: decimalString(portfolio.availableCash),
    reservedCash: decimalString(portfolio.reservedCash),
    realizedPnl: decimalString(portfolio.realizedPnl),
    feesPaid: decimalString(portfolio.feesPaid),
    ledgerSequence: portfolio.ledgerSequence
  };
}

/** Thrown when a concurrent writer changed the portfolio between read and write. */
export class PortfolioVersionConflictError extends Error {
  constructor(portfolioId: string) {
    super(`Portfolio ${portfolioId} was concurrently modified (version conflict).`);
    this.name = "PortfolioVersionConflictError";
  }
}

export function ledgerEntryCreateData(entry: LedgerEntryDraftV1, portfolioId: string) {
  return {
    entryKey: entry.entryKey,
    portfolioId,
    sequence: entry.sequence,
    type: entry.type,
    availableCashDelta: entry.availableCashDelta,
    reservedCashDelta: entry.reservedCashDelta,
    realizedPnlDelta: entry.realizedPnlDelta,
    feeDelta: entry.feeDelta,
    shadowOrderId: entry.shadowOrderId,
    shadowFillId: entry.shadowFillId,
    shadowPositionId: entry.shadowPositionId,
    correctionOfId: entry.correctionOfId,
    balanceAfterJson: asJson(entry.balanceAfterJson),
    occurredAt: new Date(entry.occurredAt)
  };
}

/**
 * Compare-and-swap the portfolio cache to `nextState`. Throws
 * `PortfolioVersionConflictError` rather than silently retrying — the caller's
 * transaction rolls back and the job's next run picks the candidate up again
 * through its own idempotency key (docs/trading/02, "Idempotenz und
 * Concurrency").
 */
export async function applyPortfolioCacheUpdate(
  tx: PortfolioTransactionClient,
  portfolioId: string,
  expectedVersion: number,
  nextState: PortfolioStateV1
): Promise<void> {
  const updated = await tx.portfolio.updateMany({
    where: { id: portfolioId, version: expectedVersion },
    data: {
      availableCash: nextState.availableCash,
      reservedCash: nextState.reservedCash,
      realizedPnl: nextState.realizedPnl,
      feesPaid: nextState.feesPaid,
      ledgerSequence: nextState.ledgerSequence,
      version: { increment: 1 }
    }
  });
  if (updated.count === 0) {
    throw new PortfolioVersionConflictError(portfolioId);
  }
}
