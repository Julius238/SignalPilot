import { decimalToString, toIso, toIsoOrNull } from "./common.js";

export interface ShadowOrderRow {
  readonly id: string;
  readonly orderKey: string;
  readonly portfolioId: string;
  readonly assetId: string;
  readonly asset?: { readonly symbol: string } | null;
  readonly tradeCandidateId: string | null;
  readonly shadowPositionId: string | null;
  readonly purpose: string;
  readonly side: string;
  readonly orderType: string;
  readonly timeInForce: string;
  readonly status: string;
  readonly requestedQuantity: unknown;
  readonly filledQuantity: unknown;
  readonly remainingQuantity: unknown;
  readonly referencePrice: unknown;
  readonly reservedQuoteAmount: unknown;
  readonly rejectionReasonCode: string | null;
  readonly cancelReasonCode: string | null;
  readonly earliestFillAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toOrder(order: ShadowOrderRow) {
  return {
    id: order.id,
    orderKey: order.orderKey,
    portfolioId: order.portfolioId,
    assetId: order.assetId,
    symbol: order.asset?.symbol ?? null,
    tradeCandidateId: order.tradeCandidateId,
    shadowPositionId: order.shadowPositionId,
    purpose: order.purpose,
    side: order.side,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    status: order.status,
    requestedQuantity: decimalToString(order.requestedQuantity),
    filledQuantity: decimalToString(order.filledQuantity),
    remainingQuantity: decimalToString(order.remainingQuantity),
    referencePrice: decimalToString(order.referencePrice),
    reservedQuoteAmount: decimalToString(order.reservedQuoteAmount),
    rejectionReasonCode: order.rejectionReasonCode,
    cancelReasonCode: order.cancelReasonCode,
    earliestFillAt: toIsoOrNull(order.earliestFillAt),
    expiresAt: toIsoOrNull(order.expiresAt),
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt)
  };
}

export interface ShadowFillRow {
  readonly id: string;
  readonly fillKey: string;
  readonly shadowOrderId: string;
  readonly shadowPositionId: string | null;
  readonly assetId: string;
  readonly asset?: { readonly symbol: string } | null;
  readonly side: string;
  readonly quantity: unknown;
  readonly referencePrice: unknown;
  readonly spreadAmount: unknown;
  readonly slippageAmount: unknown;
  readonly fillPrice: unknown;
  readonly notional: unknown;
  readonly feeAmount: unknown;
  readonly feeAsset: string;
  readonly triggerType: string;
  readonly occurredAt: Date;
}

export function toFill(fill: ShadowFillRow) {
  return {
    id: fill.id,
    fillKey: fill.fillKey,
    shadowOrderId: fill.shadowOrderId,
    shadowPositionId: fill.shadowPositionId,
    assetId: fill.assetId,
    symbol: fill.asset?.symbol ?? null,
    side: fill.side,
    quantity: decimalToString(fill.quantity),
    referencePrice: decimalToString(fill.referencePrice),
    spreadAmount: decimalToString(fill.spreadAmount),
    slippageAmount: decimalToString(fill.slippageAmount),
    fillPrice: decimalToString(fill.fillPrice),
    notional: decimalToString(fill.notional),
    feeAmount: decimalToString(fill.feeAmount),
    feeAsset: fill.feeAsset,
    triggerType: fill.triggerType,
    occurredAt: toIso(fill.occurredAt)
  };
}

export interface ShadowPositionEventRow {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly quantity: unknown;
  readonly price: unknown;
  readonly realizedPnlDelta: unknown;
  readonly occurredAt: Date;
}

export interface ShadowPositionRow {
  readonly id: string;
  readonly positionKey: string;
  readonly portfolioId: string;
  readonly assetId: string;
  readonly asset?: { readonly symbol: string } | null;
  readonly status: string;
  readonly initialQuantity: unknown;
  readonly openQuantity: unknown;
  readonly closedQuantity: unknown;
  readonly averageEntryPrice: unknown;
  readonly averageExitPrice: unknown;
  readonly grossEntryNotional: unknown;
  readonly grossExitNotional: unknown;
  readonly realizedPnl: unknown;
  readonly feesPaid: unknown;
  readonly stopPrice: unknown;
  readonly takeProfitPrice: unknown;
  readonly maxHoldUntil: Date;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;
  readonly lastValuationAt: Date | null;
  readonly version: number;
  readonly events?: readonly ShadowPositionEventRow[];
}

export function toPositionListItem(position: ShadowPositionRow) {
  return {
    id: position.id,
    positionKey: position.positionKey,
    portfolioId: position.portfolioId,
    assetId: position.assetId,
    symbol: position.asset?.symbol ?? null,
    status: position.status,
    initialQuantity: decimalToString(position.initialQuantity),
    openQuantity: decimalToString(position.openQuantity),
    closedQuantity: decimalToString(position.closedQuantity),
    averageEntryPrice: decimalToString(position.averageEntryPrice),
    averageExitPrice: decimalToString(position.averageExitPrice),
    realizedPnl: decimalToString(position.realizedPnl),
    feesPaid: decimalToString(position.feesPaid),
    stopPrice: decimalToString(position.stopPrice),
    takeProfitPrice: decimalToString(position.takeProfitPrice),
    maxHoldUntil: toIso(position.maxHoldUntil),
    openedAt: toIsoOrNull(position.openedAt),
    closedAt: toIsoOrNull(position.closedAt),
    version: position.version
  };
}

export function toPositionDetail(position: ShadowPositionRow) {
  return {
    ...toPositionListItem(position),
    grossEntryNotional: decimalToString(position.grossEntryNotional),
    grossExitNotional: decimalToString(position.grossExitNotional),
    lastValuationAt: toIsoOrNull(position.lastValuationAt),
    events: (position.events ?? []).map((event) => ({
      id: event.id,
      sequence: event.sequence,
      type: event.type,
      quantity: decimalToString(event.quantity),
      price: decimalToString(event.price),
      realizedPnlDelta: decimalToString(event.realizedPnlDelta),
      occurredAt: toIso(event.occurredAt)
    }))
  };
}
