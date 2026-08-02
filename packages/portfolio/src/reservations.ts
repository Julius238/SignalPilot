/**
 * Cash reservation and release.
 *
 * Specification: docs/trading/07-shadow-execution-model.md, "Portfolio-Cash
 * und Reservierung"; docs/trading/04-state-machines.md, "Shadow Order"
 * (`PROPOSED -> ACCEPTED` requires an atomically successful reservation; no
 * reserve survives a `REJECTED`).
 *
 * `reservedQuoteAmount` itself is not computed here — it is the risk engine's
 * worst-case sizing result (`RiskSizingResultV1.reservedQuoteAmount`). This
 * module only ever moves cash between `availableCash` and `reservedCash`
 * and never invents an amount of its own.
 */

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  PortfolioReasonCode,
  type IsoDateTimeString,
  type LedgerEntryDraftV1,
  type LedgerOperationResultV1,
  type PortfolioStateV1
} from "./contracts.js";
import { applyLedgerEntry } from "./ledger.js";

function decimalOrNull(value: string): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

function failed(reasonCode: PortfolioReasonCode): LedgerOperationResultV1 {
  return { ok: false, reasonCode, entries: [], nextState: null };
}

export interface ReserveInputV1 {
  readonly state: PortfolioStateV1;
  readonly entryKey: string;
  readonly reservedQuoteAmount: string;
  readonly shadowOrderId: string;
  readonly occurredAt: IsoDateTimeString;
}

/**
 * Reserve cash for a newly accepted entry order. Fails closed — no partial
 * reservation and no negative `availableCash` — when the amount is invalid or
 * the cash is not there (docs/trading/04, `PROPOSED -> REJECTED`).
 */
export function computeReserveEntry(input: ReserveInputV1): LedgerOperationResultV1 {
  const amount = decimalOrNull(input.reservedQuoteAmount);
  const available = decimalOrNull(input.state.availableCash);
  if (amount === null || !amount.isPositive() || available === null) {
    return failed(PortfolioReasonCode.INVALID_AMOUNT);
  }
  if (amount.gt(available)) {
    return failed(PortfolioReasonCode.INSUFFICIENT_CASH);
  }

  const entry: LedgerEntryDraftV1 = {
    entryKey: input.entryKey,
    sequence: input.state.ledgerSequence + 1,
    type: "RESERVE",
    availableCashDelta: amount.negate().toString(),
    reservedCashDelta: amount.toString(),
    realizedPnlDelta: "0.000000000000",
    feeDelta: "0.000000000000",
    shadowOrderId: input.shadowOrderId,
    shadowFillId: null,
    shadowPositionId: null,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  const nextState = applyLedgerEntry(input.state, entry);
  return {
    ok: true,
    reasonCode: PortfolioReasonCode.OK,
    entries: [{ ...entry, balanceAfterJson: { ...nextState } }],
    nextState
  };
}

export interface ReleaseInputV1 {
  readonly state: PortfolioStateV1;
  readonly entryKey: string;
  readonly releaseAmount: string;
  readonly shadowOrderId: string;
  readonly occurredAt: IsoDateTimeString;
}

/**
 * Release an unfilled (or cancelled/expired) portion of a reservation back to
 * `availableCash`. `reservedCash` may never go negative — a release larger
 * than what remains reserved indicates an upstream bookkeeping error, not
 * something this function silently clamps.
 */
export function computeReleaseReservation(input: ReleaseInputV1): LedgerOperationResultV1 {
  const amount = decimalOrNull(input.releaseAmount);
  const reserved = decimalOrNull(input.state.reservedCash);
  if (amount === null || !amount.isPositive() || reserved === null) {
    return failed(PortfolioReasonCode.INVALID_AMOUNT);
  }
  if (amount.gt(reserved)) {
    return failed(PortfolioReasonCode.RESERVATION_MISMATCH);
  }

  const entry: LedgerEntryDraftV1 = {
    entryKey: input.entryKey,
    sequence: input.state.ledgerSequence + 1,
    type: "RELEASE",
    availableCashDelta: amount.toString(),
    reservedCashDelta: amount.negate().toString(),
    realizedPnlDelta: "0.000000000000",
    feeDelta: "0.000000000000",
    shadowOrderId: input.shadowOrderId,
    shadowFillId: null,
    shadowPositionId: null,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  const nextState = applyLedgerEntry(input.state, entry);
  return {
    ok: true,
    reasonCode: PortfolioReasonCode.OK,
    entries: [{ ...entry, balanceAfterJson: { ...nextState } }],
    nextState
  };
}
