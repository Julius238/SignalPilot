/**
 * Input and output contracts of the portfolio ledger, positions and valuation.
 *
 * Specification:
 *   docs/trading/03-domain-model.md, `Portfolio`, `PortfolioLedgerEntry`,
 *     `PortfolioSnapshot`, `ShadowPosition`
 *   docs/trading/07-shadow-execution-model.md, "Portfolio-Cash und
 *     Reservierung", "Realisiert, unrealisiert und Equity"
 *   docs/trading/02-shadow-trading-target-architecture.md, module table
 *     ("packages/portfolio ... darf nicht Strategie entscheiden, Orders
 *      erzeugen oder DB-Transaktionen besitzen").
 *
 * This package processes confirmed domain events (a reservation, a fill, a
 * mark) into ledger-entry drafts and updated cache drafts. It never decides
 * whether an event *should* happen — that is the risk engine's and the
 * worker's job — and it never opens a database transaction; the caller
 * commits the drafts atomically.
 */

import type { DecimalString } from "@signalpilot/trading-domain";

export type IsoDateTimeString = string;

/** Mirrors `PortfolioLedgerEntryType` in `packages/trading-domain` and Prisma. */
export const LedgerEntryType = {
  INITIAL_CASH: "INITIAL_CASH",
  RESERVE: "RESERVE",
  RELEASE: "RELEASE",
  BUY_NOTIONAL: "BUY_NOTIONAL",
  SELL_NOTIONAL: "SELL_NOTIONAL",
  FEE: "FEE",
  PNL_ADJUSTMENT: "PNL_ADJUSTMENT",
  CORRECTION: "CORRECTION"
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

/** The cached, replayable projection of `Portfolio`'s money columns. */
export interface PortfolioStateV1 {
  readonly availableCash: DecimalString;
  readonly reservedCash: DecimalString;
  readonly realizedPnl: DecimalString;
  readonly feesPaid: DecimalString;
  readonly ledgerSequence: number;
}

/** Draft of one append-only `PortfolioLedgerEntry` row. */
export interface LedgerEntryDraftV1 {
  readonly entryKey: string;
  readonly sequence: number;
  readonly type: LedgerEntryType;
  readonly availableCashDelta: DecimalString;
  readonly reservedCashDelta: DecimalString;
  readonly realizedPnlDelta: DecimalString;
  readonly feeDelta: DecimalString;
  readonly shadowOrderId: string | null;
  readonly shadowFillId: string | null;
  readonly shadowPositionId: string | null;
  readonly correctionOfId: string | null;
  readonly balanceAfterJson: Readonly<Record<string, unknown>>;
  readonly occurredAt: IsoDateTimeString;
}

export const PortfolioReasonCode = {
  OK: "PORTFOLIO_OK",
  INSUFFICIENT_CASH: "PORTFOLIO_INSUFFICIENT_CASH",
  INSUFFICIENT_RESERVE: "PORTFOLIO_INSUFFICIENT_RESERVE",
  NEGATIVE_CASH: "PORTFOLIO_NEGATIVE_CASH",
  NEGATIVE_QUANTITY: "PORTFOLIO_NEGATIVE_QUANTITY",
  SEQUENCE_NOT_CONTIGUOUS: "PORTFOLIO_SEQUENCE_NOT_CONTIGUOUS",
  ORPHAN_LEDGER_REFERENCE: "PORTFOLIO_ORPHAN_LEDGER_REFERENCE",
  INVALID_AMOUNT: "PORTFOLIO_INVALID_AMOUNT",
  RESERVATION_MISMATCH: "PORTFOLIO_RESERVATION_MISMATCH",
  EQUITY_MISMATCH: "PORTFOLIO_EQUITY_MISMATCH",
  CACHE_MISMATCH_LEDGER_REPLAY: "PORTFOLIO_CACHE_MISMATCH_LEDGER_REPLAY",
  DUPLICATE_ASSET_POSITION_SCOPE: "PORTFOLIO_DUPLICATE_ASSET_POSITION_SCOPE",
  QUANTITY_EXCEEDS_OPEN: "PORTFOLIO_QUANTITY_EXCEEDS_OPEN"
} as const;
export type PortfolioReasonCode = (typeof PortfolioReasonCode)[keyof typeof PortfolioReasonCode];

/** Result of one ledger-producing operation: at most one entry, never a partial one. */
export interface LedgerOperationResultV1 {
  readonly ok: boolean;
  readonly reasonCode: PortfolioReasonCode;
  readonly entries: readonly LedgerEntryDraftV1[];
  readonly nextState: PortfolioStateV1 | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Positions
// ───────────────────────────────────────────────────────────────────────────

/** The subset of `ShadowPosition` this package computes and mutates. */
export interface PositionStateV1 {
  readonly initialQuantity: DecimalString;
  readonly openQuantity: DecimalString;
  readonly closedQuantity: DecimalString;
  readonly averageEntryPrice: DecimalString;
  readonly averageExitPrice: DecimalString | null;
  readonly grossEntryNotional: DecimalString;
  readonly grossExitNotional: DecimalString;
  readonly realizedPnl: DecimalString;
  readonly feesPaid: DecimalString;
  /** Entry fees already attributed to a closed quantity — for proportional allocation. */
  readonly allocatedEntryFees: DecimalString;
}

export const EMPTY_POSITION_STATE: PositionStateV1 = Object.freeze({
  initialQuantity: "0.000000000000",
  openQuantity: "0.000000000000",
  closedQuantity: "0.000000000000",
  averageEntryPrice: "0.000000000000",
  averageExitPrice: null,
  grossEntryNotional: "0.000000000000",
  grossExitNotional: "0.000000000000",
  realizedPnl: "0.000000000000",
  feesPaid: "0.000000000000",
  allocatedEntryFees: "0.000000000000"
});

export interface FillAppliedV1 {
  readonly quantity: DecimalString;
  readonly fillPrice: DecimalString;
  readonly notional: DecimalString;
  readonly feeAmount: DecimalString;
}

export interface PositionUpdateResultV1 {
  readonly ok: boolean;
  readonly reasonCode: PortfolioReasonCode;
  readonly position: PositionStateV1 | null;
  /** `realizedPnlDelta` this exit fill contributed — `null` for an entry fill. */
  readonly realizedPnlDelta: DecimalString | null;
  readonly allocatedEntryFeesDelta: DecimalString | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Valuation
// ───────────────────────────────────────────────────────────────────────────

export interface PositionMarkInputV1 {
  readonly openQuantity: DecimalString;
  readonly averageEntryPrice: DecimalString;
  readonly conservativeBidMark: DecimalString;
  readonly estimatedExitFeeRate: DecimalString;
}

export interface PositionMarkResultV1 {
  readonly marketValue: DecimalString;
  readonly unrealizedPnl: DecimalString;
}

export interface PortfolioValuationInputV1 {
  readonly availableCash: DecimalString;
  readonly reservedCash: DecimalString;
  readonly realizedPnl: DecimalString;
  readonly feesPaid: DecimalString;
  readonly openPositionMarks: readonly PositionMarkResultV1[];
  readonly highWaterMark: DecimalString;
  readonly startOfDayEquity: DecimalString | null;
}

export interface PortfolioValuationResultV1 {
  readonly marketValue: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly equity: DecimalString;
  readonly dailyPnl: DecimalString | null;
  readonly highWaterMark: DecimalString;
  readonly drawdownAmount: DecimalString;
  readonly drawdownPct: DecimalString;
}

// ───────────────────────────────────────────────────────────────────────────
// Invariants and replay
// ───────────────────────────────────────────────────────────────────────────

export interface ReservationSummaryV1 {
  readonly shadowOrderId: string;
  readonly reservedQuoteAmount: DecimalString;
}

export interface PortfolioInvariantInputV1 {
  readonly cache: PortfolioStateV1;
  readonly cacheEquity: DecimalString;
  readonly replayed: PortfolioStateV1;
  readonly openReservations: readonly ReservationSummaryV1[];
  readonly marketValue: DecimalString;
  readonly orphanReferenceCount: number;
  readonly sequenceGapCount: number;
  readonly duplicateAssetScopeCount: number;
  readonly toleranceUnscaled: DecimalString;
}

export interface PortfolioInvariantResultV1 {
  readonly consistent: boolean;
  readonly violations: readonly PortfolioReasonCode[];
}

export interface ReplayReportV1 {
  readonly state: PortfolioStateV1;
  readonly entryCount: number;
  readonly orphanReferenceCount: number;
  readonly sequenceGapCount: number;
  readonly duplicateEntryKeyCount: number;
}
