/**
 * Portfolio consistency invariants.
 *
 * Specification: docs/trading/06-risk-engine-specification.md,
 * "Portfolio-Konsistenz und Toleranz"; docs/trading/02-shadow-trading-target-architecture.md,
 * "Wiederaufnahme nach Prozessabbruch".
 *
 * A violation is reported, never silently corrected — reconciliation
 * (docs/trading/07, "Ledger unklar: niemals aus Projektion überschreiben")
 * turns any of these into `ERROR_LOCKED` plus a critical `RiskEvent`, not an
 * automatic cache repair.
 */

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  PortfolioReasonCode,
  type PortfolioInvariantInputV1,
  type PortfolioInvariantResultV1
} from "./contracts.js";

function decimalOrNull(value: string): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

const withinTolerance = (left: DecimalValue, right: DecimalValue, tolerance: DecimalValue): boolean =>
  left.sub(right).abs().lte(tolerance);

/**
 * Every invariant docs/trading/06 requires before a new order may be
 * approved: non-negative cash, reservation sum matching the cache, the ledger
 * replay matching the cache, and equity matching
 * `availableCash + reservedCash + marketValue`.
 */
export function checkPortfolioInvariants(
  input: PortfolioInvariantInputV1
): PortfolioInvariantResultV1 {
  const violations: PortfolioReasonCode[] = [];

  const tolerance = decimalOrNull(input.toleranceUnscaled);
  const availableCash = decimalOrNull(input.cache.availableCash);
  const reservedCash = decimalOrNull(input.cache.reservedCash);
  const realizedPnl = decimalOrNull(input.cache.realizedPnl);
  const feesPaid = decimalOrNull(input.cache.feesPaid);
  const cacheEquity = decimalOrNull(input.cacheEquity);
  const marketValue = decimalOrNull(input.marketValue);
  const replayAvailable = decimalOrNull(input.replayed.availableCash);
  const replayReserved = decimalOrNull(input.replayed.reservedCash);
  const replayRealized = decimalOrNull(input.replayed.realizedPnl);
  const replayFees = decimalOrNull(input.replayed.feesPaid);

  if (
    tolerance === null ||
    availableCash === null ||
    reservedCash === null ||
    realizedPnl === null ||
    feesPaid === null ||
    cacheEquity === null ||
    marketValue === null ||
    replayAvailable === null ||
    replayReserved === null ||
    replayRealized === null ||
    replayFees === null
  ) {
    return { consistent: false, violations: [PortfolioReasonCode.INVALID_AMOUNT] };
  }

  if (availableCash.isNegative() || reservedCash.isNegative()) {
    violations.push(PortfolioReasonCode.NEGATIVE_CASH);
  }
  if (input.orphanReferenceCount > 0) {
    violations.push(PortfolioReasonCode.ORPHAN_LEDGER_REFERENCE);
  }
  if (input.sequenceGapCount > 0 || input.cache.ledgerSequence !== input.replayed.ledgerSequence) {
    violations.push(PortfolioReasonCode.SEQUENCE_NOT_CONTIGUOUS);
  }
  if (
    !withinTolerance(availableCash, replayAvailable, tolerance) ||
    !withinTolerance(reservedCash, replayReserved, tolerance) ||
    !withinTolerance(realizedPnl, replayRealized, tolerance) ||
    !withinTolerance(feesPaid, replayFees, tolerance)
  ) {
    violations.push(PortfolioReasonCode.CACHE_MISMATCH_LEDGER_REPLAY);
  }

  const reservationSum = DecimalValue.sum(
    input.openReservations.map((reservation) => {
      const amount = decimalOrNull(reservation.reservedQuoteAmount);
      return amount ?? DecimalValue.ZERO;
    })
  );
  if (!withinTolerance(reservationSum, reservedCash, tolerance)) {
    violations.push(PortfolioReasonCode.RESERVATION_MISMATCH);
  }

  const expectedEquity = availableCash.add(reservedCash).add(marketValue);
  if (!withinTolerance(cacheEquity, expectedEquity, tolerance)) {
    violations.push(PortfolioReasonCode.EQUITY_MISMATCH);
  }

  if (input.duplicateAssetScopeCount > 0) {
    violations.push(PortfolioReasonCode.DUPLICATE_ASSET_POSITION_SCOPE);
  }

  return { consistent: violations.length === 0, violations: Object.freeze(violations) };
}
