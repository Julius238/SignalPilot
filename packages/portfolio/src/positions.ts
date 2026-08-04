/**
 * Entry/exit fill application to the position and the ledger.
 *
 * Specification: docs/trading/07-shadow-execution-model.md, "Entry-Fill",
 * "Exit-Fill"; docs/trading/03-domain-model.md, `ShadowPosition`.
 *
 * Each fill produces two or three ledger rows so every documented booking
 * type stays a distinct, auditable row (docs/trading/03,
 * `PortfolioLedgerEntryType`): the notional/proceeds movement, the fee, and —
 * for an exit — the realized-P&L adjustment. Entry fees paid at entry time
 * are attributed to realized P&L only when the corresponding quantity is
 * later closed, proportionally to the closed share of `initialQuantity`, with
 * the rounding remainder assigned to the fill that fully closes the position
 * (docs/trading/07, "Rundungsreste werden erst beim finalen Close
 * deterministisch dem letzten Fill zugeschlagen").
 */

import {
  DecimalValue,
  RoundingMode,
  TradeDirection,
  grossPnl
} from "@signalpilot/trading-domain";

import {
  EMPTY_POSITION_STATE,
  PortfolioReasonCode,
  type FillAppliedV1,
  type IsoDateTimeString,
  type LedgerEntryDraftV1,
  type LedgerOperationResultV1,
  type PortfolioStateV1,
  type PositionStateV1,
  type PositionUpdateResultV1
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

const ZERO_STR = "0.000000000000";

function failedPosition(
  reasonCode: PortfolioReasonCode
): PositionUpdateResultV1 {
  return {
    ok: false,
    reasonCode,
    position: null,
    realizedPnlDelta: null,
    allocatedEntryFeesDelta: null,
    releasedCollateralDelta: null,
    grossPnlDelta: null
  };
}

function failedLedger(
  reasonCode: PortfolioReasonCode
): LedgerOperationResultV1 {
  return { ok: false, reasonCode, entries: [], nextState: null };
}

/**
 * Fold an entry fill into the position aggregate: weighted average entry
 * price, cumulative notional and fees. Never called after the entry window
 * has closed (docs/trading/04: no positive quantity mutation after entry).
 */
export function applyEntryFillToPosition(
  position: PositionStateV1,
  fill: FillAppliedV1
): PositionUpdateResultV1 {
  const quantity = decimalOrNull(fill.quantity);
  const fillPrice = decimalOrNull(fill.fillPrice);
  const notional = decimalOrNull(fill.notional);
  const fee = decimalOrNull(fill.feeAmount);
  const collateral = decimalOrNull(fill.collateralAmount ?? ZERO_STR);
  if (
    quantity === null ||
    !quantity.isPositive() ||
    fillPrice === null ||
    !fillPrice.isPositive() ||
    notional === null ||
    fee === null ||
    fee.isNegative() ||
    collateral === null ||
    collateral.isNegative() ||
    (position.direction === TradeDirection.LONG && !collateral.isZero()) ||
    (position.direction === TradeDirection.SHORT && !collateral.isPositive())
  ) {
    return failedPosition(PortfolioReasonCode.INVALID_AMOUNT);
  }

  const priorQuantity =
    decimalOrNull(position.openQuantity) ?? DecimalValue.ZERO;
  const priorNotional =
    decimalOrNull(position.grossEntryNotional) ?? DecimalValue.ZERO;
  const priorFees = decimalOrNull(position.feesPaid) ?? DecimalValue.ZERO;
  const priorInitial =
    decimalOrNull(position.initialQuantity) ?? DecimalValue.ZERO;
  const priorCollateral =
    decimalOrNull(position.reservedCollateral) ?? DecimalValue.ZERO;

  const newQuantity = priorQuantity.add(quantity);
  const newNotional = priorNotional.add(notional);
  const averageEntryPrice = newQuantity.isPositive()
    ? newNotional.div(newQuantity, RoundingMode.FLOOR)
    : DecimalValue.ZERO;

  const next: PositionStateV1 = {
    ...position,
    initialQuantity: priorInitial.add(quantity).toString(),
    openQuantity: newQuantity.toString(),
    grossEntryNotional: newNotional.toString(),
    averageEntryPrice: averageEntryPrice.toString(),
    feesPaid: priorFees.add(fee).toString(),
    reservedCollateral: priorCollateral.add(collateral).toString()
  };

  return {
    ok: true,
    reasonCode: PortfolioReasonCode.OK,
    position: next,
    realizedPnlDelta: null,
    allocatedEntryFeesDelta: null,
    releasedCollateralDelta: null,
    grossPnlDelta: null
  };
}

/**
 * Fold an exit fill into the position aggregate and compute the realized-P&L
 * contribution of this fill. `entryFeesPaidTotal` is the position's entire
 * entry-fee history (`position.feesPaid` immediately after the entry window
 * closed) — allocation is proportional to it, not to fees paid so far on
 * exits.
 */
export function applyExitFillToPosition(
  position: PositionStateV1,
  fill: FillAppliedV1,
  entryFeesPaidTotal: string
): PositionUpdateResultV1 {
  const quantity = decimalOrNull(fill.quantity);
  const fillPrice = decimalOrNull(fill.fillPrice);
  const notional = decimalOrNull(fill.notional);
  const exitFee = decimalOrNull(fill.feeAmount);
  const openQuantity = decimalOrNull(position.openQuantity);
  const initialQuantity = decimalOrNull(position.initialQuantity);
  const averageEntryPrice = decimalOrNull(position.averageEntryPrice);
  const entryFeesTotal = decimalOrNull(entryFeesPaidTotal);
  const reservedCollateral = decimalOrNull(position.reservedCollateral);

  if (
    quantity === null ||
    !quantity.isPositive() ||
    fillPrice === null ||
    !fillPrice.isPositive() ||
    notional === null ||
    exitFee === null ||
    exitFee.isNegative() ||
    openQuantity === null ||
    initialQuantity === null ||
    !initialQuantity.isPositive() ||
    averageEntryPrice === null ||
    entryFeesTotal === null ||
    reservedCollateral === null ||
    reservedCollateral.isNegative()
  ) {
    return failedPosition(PortfolioReasonCode.INVALID_AMOUNT);
  }
  if (quantity.gt(openQuantity)) {
    return failedPosition(PortfolioReasonCode.QUANTITY_EXCEEDS_OPEN);
  }

  const priorClosed =
    decimalOrNull(position.closedQuantity) ?? DecimalValue.ZERO;
  const priorExitNotional =
    decimalOrNull(position.grossExitNotional) ?? DecimalValue.ZERO;
  const priorRealized =
    decimalOrNull(position.realizedPnl) ?? DecimalValue.ZERO;
  const priorAllocated =
    decimalOrNull(position.allocatedEntryFees) ?? DecimalValue.ZERO;
  const priorExitFees = decimalOrNull(position.feesPaid) ?? DecimalValue.ZERO;

  const newClosed = priorClosed.add(quantity);
  const isFinalClose = newClosed.gte(initialQuantity);

  // Proportional allocation, rounded up at both steps so a partial close never
  // under-attributes entry fees (which would overstate that fill's realized
  // profit); the final close absorbs whatever remainder that conservatism
  // left instead of leaving fees permanently unattributed.
  const allocatedEntryFeesDelta = isFinalClose
    ? entryFeesTotal.sub(priorAllocated)
    : entryFeesTotal
        .mul(quantity, RoundingMode.CEIL)
        .div(initialQuantity, RoundingMode.CEIL);

  const grossPnlDelta = grossPnl(
    position.direction,
    averageEntryPrice,
    fillPrice,
    quantity,
    RoundingMode.FLOOR
  );
  const realizedPnlDelta = grossPnlDelta
    .sub(allocatedEntryFeesDelta)
    .sub(exitFee);
  const releasedCollateralDelta =
    position.direction === TradeDirection.SHORT
      ? isFinalClose
        ? reservedCollateral
        : reservedCollateral
            .mul(quantity, RoundingMode.FLOOR)
            .div(openQuantity, RoundingMode.FLOOR)
      : DecimalValue.ZERO;

  const priorExitNotionalSum = priorExitNotional.add(notional);
  const averageExitPrice = newClosed.isPositive()
    ? priorExitNotionalSum.div(newClosed, RoundingMode.FLOOR)
    : DecimalValue.ZERO;

  const next: PositionStateV1 = {
    ...position,
    openQuantity: openQuantity.sub(quantity).toString(),
    closedQuantity: newClosed.toString(),
    grossExitNotional: priorExitNotionalSum.toString(),
    averageExitPrice: averageExitPrice.toString(),
    realizedPnl: priorRealized.add(realizedPnlDelta).toString(),
    allocatedEntryFees: priorAllocated.add(allocatedEntryFeesDelta).toString(),
    feesPaid: priorExitFees.add(exitFee).toString(),
    reservedCollateral: reservedCollateral
      .sub(releasedCollateralDelta)
      .toString()
  };

  return {
    ok: true,
    reasonCode: PortfolioReasonCode.OK,
    position: next,
    realizedPnlDelta: realizedPnlDelta.toString(),
    allocatedEntryFeesDelta: allocatedEntryFeesDelta.toString(),
    releasedCollateralDelta: releasedCollateralDelta.toString(),
    grossPnlDelta: grossPnlDelta.toString()
  };
}

export interface ApplyEntryFillLedgerInputV1 {
  readonly direction: "LONG" | "SHORT";
  readonly state: PortfolioStateV1;
  readonly notionalEntryKey: string;
  readonly feeEntryKey: string;
  readonly reservedForFill: string;
  readonly fill: FillAppliedV1;
  readonly shadowOrderId: string;
  readonly shadowFillId: string;
  readonly shadowPositionId: string;
  readonly occurredAt: IsoDateTimeString;
}

/**
 * Two ledger rows for one entry fill: the reserve release net of the actual
 * notional cost (`BUY_NOTIONAL`), and the fee (`FEE`). No path can make
 * `availableCash` negative — an over-committed reserve is refused outright
 * rather than silently absorbed (docs/trading/07, "Kein Pfad darf
 * `availableCash` negativ machen").
 */
export function applyEntryFillLedger(
  input: ApplyEntryFillLedgerInputV1
): LedgerOperationResultV1 {
  const reservedForFill = decimalOrNull(input.reservedForFill);
  const notional = decimalOrNull(input.fill.notional);
  const fee = decimalOrNull(input.fill.feeAmount);
  const reservedCash = decimalOrNull(input.state.reservedCash);
  if (
    reservedForFill === null ||
    !reservedForFill.isPositive() ||
    notional === null ||
    fee === null ||
    reservedCash === null
  ) {
    return failedLedger(PortfolioReasonCode.INVALID_AMOUNT);
  }
  if (reservedForFill.gt(reservedCash)) {
    return failedLedger(PortfolioReasonCode.RESERVATION_MISMATCH);
  }
  const requiredReserve =
    input.direction === TradeDirection.LONG ? notional.add(fee) : fee;
  if (requiredReserve.gt(reservedForFill)) {
    return failedLedger(PortfolioReasonCode.INSUFFICIENT_RESERVE);
  }

  // The whole tied reserve is released here; the fee row below spends its own
  // share separately, so this row nets only the notional cost against it
  // (releasing the fee's share too and then subtracting the fee again in the
  // FEE row would double-charge it).
  const releasedExcess = reservedForFill.sub(notional);

  const notionalEntry: LedgerEntryDraftV1 = {
    entryKey: input.notionalEntryKey,
    sequence: input.state.ledgerSequence + 1,
    type:
      input.direction === TradeDirection.LONG
        ? "BUY_NOTIONAL"
        : "SELL_NOTIONAL",
    availableCashDelta:
      input.direction === TradeDirection.LONG
        ? releasedExcess.toString()
        : ZERO_STR,
    reservedCashDelta:
      input.direction === TradeDirection.LONG
        ? reservedForFill.negate().toString()
        : ZERO_STR,
    realizedPnlDelta: ZERO_STR,
    feeDelta: ZERO_STR,
    shadowOrderId: input.shadowOrderId,
    shadowFillId: input.shadowFillId,
    shadowPositionId: input.shadowPositionId,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  let state = applyLedgerEntry(input.state, notionalEntry);
  const notionalWithBalance = {
    ...notionalEntry,
    balanceAfterJson: { ...state }
  };

  const feeEntry: LedgerEntryDraftV1 = {
    entryKey: input.feeEntryKey,
    sequence: state.ledgerSequence + 1,
    type: "FEE",
    availableCashDelta:
      input.direction === TradeDirection.LONG
        ? fee.negate().toString()
        : ZERO_STR,
    reservedCashDelta:
      input.direction === TradeDirection.SHORT
        ? fee.negate().toString()
        : ZERO_STR,
    realizedPnlDelta: ZERO_STR,
    feeDelta: fee.toString(),
    shadowOrderId: input.shadowOrderId,
    shadowFillId: input.shadowFillId,
    shadowPositionId: input.shadowPositionId,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  state = applyLedgerEntry(state, feeEntry);
  const feeWithBalance = { ...feeEntry, balanceAfterJson: { ...state } };

  return {
    ok: true,
    reasonCode: PortfolioReasonCode.OK,
    entries: [notionalWithBalance, feeWithBalance],
    nextState: state
  };
}

export interface ApplyExitFillLedgerInputV1 {
  readonly direction: "LONG" | "SHORT";
  readonly state: PortfolioStateV1;
  readonly proceedsEntryKey: string;
  readonly feeEntryKey: string;
  readonly pnlEntryKey: string;
  readonly fill: FillAppliedV1;
  readonly realizedPnlDelta: string;
  readonly grossPnlDelta: string;
  readonly releasedCollateral: string;
  readonly shadowOrderId: string;
  readonly shadowFillId: string;
  readonly shadowPositionId: string;
  readonly occurredAt: IsoDateTimeString;
}

/**
 * Three ledger rows for one exit fill: gross proceeds (`SELL_NOTIONAL`), the
 * fee (`FEE`), and the realized-P&L adjustment (`PNL_ADJUSTMENT`) —
 * `positions.ts`'s `applyExitFillToPosition` already computed the delta from
 * the allocated entry fee and this exit's own fee, so the P&L row moves no
 * cash of its own.
 */
export function applyExitFillLedger(
  input: ApplyExitFillLedgerInputV1
): LedgerOperationResultV1 {
  const notional = decimalOrNull(input.fill.notional);
  const fee = decimalOrNull(input.fill.feeAmount);
  const realizedPnlDelta = decimalOrNull(input.realizedPnlDelta);
  const grossPnlDelta = decimalOrNull(input.grossPnlDelta);
  const releasedCollateral = decimalOrNull(input.releasedCollateral);
  if (
    notional === null ||
    fee === null ||
    fee.isNegative() ||
    realizedPnlDelta === null ||
    grossPnlDelta === null ||
    releasedCollateral === null ||
    releasedCollateral.isNegative() ||
    (input.direction === TradeDirection.LONG && !releasedCollateral.isZero())
  ) {
    return failedLedger(PortfolioReasonCode.INVALID_AMOUNT);
  }

  const proceedsEntry: LedgerEntryDraftV1 = {
    entryKey: input.proceedsEntryKey,
    sequence: input.state.ledgerSequence + 1,
    type:
      input.direction === TradeDirection.LONG
        ? "SELL_NOTIONAL"
        : "BUY_NOTIONAL",
    availableCashDelta:
      input.direction === TradeDirection.LONG ? notional.toString() : ZERO_STR,
    reservedCashDelta: ZERO_STR,
    realizedPnlDelta: ZERO_STR,
    feeDelta: ZERO_STR,
    shadowOrderId: input.shadowOrderId,
    shadowFillId: input.shadowFillId,
    shadowPositionId: input.shadowPositionId,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  let state = applyLedgerEntry(input.state, proceedsEntry);
  const proceedsWithBalance = {
    ...proceedsEntry,
    balanceAfterJson: { ...state }
  };

  const entries: LedgerEntryDraftV1[] = [proceedsWithBalance];
  if (input.direction === TradeDirection.SHORT) {
    const releaseEntry: LedgerEntryDraftV1 = {
      entryKey: `${input.proceedsEntryKey}|COLLATERAL_RELEASE`,
      sequence: state.ledgerSequence + 1,
      type: "RELEASE",
      availableCashDelta: releasedCollateral.toString(),
      reservedCashDelta: releasedCollateral.negate().toString(),
      realizedPnlDelta: ZERO_STR,
      feeDelta: ZERO_STR,
      shadowOrderId: input.shadowOrderId,
      shadowFillId: input.shadowFillId,
      shadowPositionId: input.shadowPositionId,
      correctionOfId: null,
      balanceAfterJson: {},
      occurredAt: input.occurredAt
    };
    state = applyLedgerEntry(state, releaseEntry);
    entries.push({ ...releaseEntry, balanceAfterJson: { ...state } });
  }

  const feeEntry: LedgerEntryDraftV1 = {
    entryKey: input.feeEntryKey,
    sequence: state.ledgerSequence + 1,
    type: "FEE",
    availableCashDelta: fee.negate().toString(),
    reservedCashDelta: ZERO_STR,
    realizedPnlDelta: ZERO_STR,
    feeDelta: fee.toString(),
    shadowOrderId: input.shadowOrderId,
    shadowFillId: input.shadowFillId,
    shadowPositionId: input.shadowPositionId,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  state = applyLedgerEntry(state, feeEntry);
  const feeWithBalance = { ...feeEntry, balanceAfterJson: { ...state } };
  entries.push(feeWithBalance);

  const pnlEntry: LedgerEntryDraftV1 = {
    entryKey: input.pnlEntryKey,
    sequence: state.ledgerSequence + 1,
    type: "PNL_ADJUSTMENT",
    availableCashDelta:
      input.direction === TradeDirection.SHORT
        ? grossPnlDelta.toString()
        : ZERO_STR,
    reservedCashDelta: ZERO_STR,
    realizedPnlDelta: realizedPnlDelta.toString(),
    feeDelta: ZERO_STR,
    shadowOrderId: input.shadowOrderId,
    shadowFillId: input.shadowFillId,
    shadowPositionId: input.shadowPositionId,
    correctionOfId: null,
    balanceAfterJson: {},
    occurredAt: input.occurredAt
  };
  state = applyLedgerEntry(state, pnlEntry);
  const pnlWithBalance = { ...pnlEntry, balanceAfterJson: { ...state } };
  entries.push(pnlWithBalance);

  return {
    ok: true,
    reasonCode: PortfolioReasonCode.OK,
    entries,
    nextState: state
  };
}

export { EMPTY_POSITION_STATE };
