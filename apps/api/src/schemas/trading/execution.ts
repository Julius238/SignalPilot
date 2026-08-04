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
  readonly direction: string;
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
  readonly tradeCandidate?: ExecutionStrategySource | null;
  readonly exitForPosition?: ExecutionStrategySource | null;
}

interface ExecutionStrategySource {
  readonly strategyVersionId: string;
  readonly strategyVersion?: {
    readonly version: number;
    readonly strategy?: { readonly key: string; readonly name: string } | null;
  } | null;
}

function executionStrategy(source: ExecutionStrategySource | null | undefined) {
  return {
    strategyVersionId: source?.strategyVersionId ?? null,
    strategyVersion: source?.strategyVersion?.version ?? null,
    strategyKey: source?.strategyVersion?.strategy?.key ?? null,
    strategyName: source?.strategyVersion?.strategy?.name ?? null
  };
}

export function toOrder(order: ShadowOrderRow) {
  const strategy = executionStrategy(
    order.tradeCandidate ?? order.exitForPosition
  );
  return {
    id: order.id,
    orderKey: order.orderKey,
    portfolioId: order.portfolioId,
    assetId: order.assetId,
    symbol: order.asset?.symbol ?? null,
    tradeCandidateId: order.tradeCandidateId,
    shadowPositionId: order.shadowPositionId,
    purpose: order.purpose,
    direction: order.direction,
    side: order.side,
    ...strategy,
    syntheticShadowShort: order.direction === "SHORT",
    exchangePosition: false,
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
  readonly shadowOrder?: ShadowOrderRow | null;
}

export function toFill(fill: ShadowFillRow) {
  const order = fill.shadowOrder;
  const strategy = executionStrategy(
    order?.tradeCandidate ?? order?.exitForPosition
  );
  return {
    id: fill.id,
    fillKey: fill.fillKey,
    shadowOrderId: fill.shadowOrderId,
    shadowPositionId: fill.shadowPositionId,
    assetId: fill.assetId,
    symbol: fill.asset?.symbol ?? null,
    side: fill.side,
    direction: order?.direction ?? null,
    ...strategy,
    syntheticShadowShort: order?.direction === "SHORT",
    exchangePosition: false,
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
  readonly direction: string;
  readonly strategyAssignmentId: string;
  readonly strategyVersionId: string;
  readonly strategyVersion?: {
    readonly version: number;
    readonly strategy?: { readonly key: string; readonly name: string } | null;
  } | null;
  readonly initialQuantity: unknown;
  readonly openQuantity: unknown;
  readonly closedQuantity: unknown;
  readonly averageEntryPrice: unknown;
  readonly averageExitPrice: unknown;
  readonly grossEntryNotional: unknown;
  readonly grossExitNotional: unknown;
  readonly realizedPnl: unknown;
  readonly feesPaid: unknown;
  readonly reservedCollateral: unknown;
  readonly stopPrice: unknown;
  readonly takeProfitPrice: unknown;
  readonly maxHoldUntil: Date;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;
  readonly lastValuationAt: Date | null;
  readonly version: number;
  readonly events?: readonly ShadowPositionEventRow[];
  readonly exitPlans?: readonly {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly triggeredBy: string | null;
    readonly triggeredAt: Date | null;
  }[];
  readonly exitOrders?: readonly {
    readonly fills?: readonly {
      readonly triggerType: string;
      readonly occurredAt: Date;
    }[];
  }[];
}

function positionExitReason(position: ShadowPositionRow): string | null {
  for (const order of position.exitOrders ?? []) {
    const trigger = order.fills?.[0]?.triggerType;
    if (trigger !== undefined) return trigger;
  }
  return (
    position.exitPlans?.find((plan) => plan.triggeredBy !== null)
      ?.triggeredBy ?? null
  );
}

export function toPositionListItem(position: ShadowPositionRow) {
  return {
    id: position.id,
    positionKey: position.positionKey,
    portfolioId: position.portfolioId,
    assetId: position.assetId,
    symbol: position.asset?.symbol ?? null,
    direction: position.direction,
    strategyAssignmentId: position.strategyAssignmentId,
    strategyVersionId: position.strategyVersionId,
    strategyVersion: position.strategyVersion?.version ?? null,
    strategyKey: position.strategyVersion?.strategy?.key ?? null,
    strategyName: position.strategyVersion?.strategy?.name ?? null,
    syntheticShadowShort: position.direction === "SHORT",
    exchangePosition: false,
    status: position.status,
    initialQuantity: decimalToString(position.initialQuantity),
    openQuantity: decimalToString(position.openQuantity),
    closedQuantity: decimalToString(position.closedQuantity),
    averageEntryPrice: decimalToString(position.averageEntryPrice),
    averageExitPrice: decimalToString(position.averageExitPrice),
    realizedPnl: decimalToString(position.realizedPnl),
    feesPaid: decimalToString(position.feesPaid),
    reservedCollateral: decimalToString(position.reservedCollateral),
    exitReason: positionExitReason(position),
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
    exitPlans: (position.exitPlans ?? []).map((plan) => ({
      id: plan.id,
      version: plan.version,
      status: plan.status,
      triggeredBy: plan.triggeredBy,
      triggeredAt: toIsoOrNull(plan.triggeredAt)
    })),
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
