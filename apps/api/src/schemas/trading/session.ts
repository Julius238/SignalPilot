import { toIso, toIsoOrNull } from "./common.js";

export interface TradingSessionRow {
  readonly id: string;
  readonly sessionKey: string;
  readonly portfolioId: string;
  readonly mode: string;
  readonly status: string;
  readonly killSwitchEngaged: boolean;
  readonly killReasonCode: string | null;
  readonly startedAt: Date | null;
  readonly pausedAt: Date | null;
  readonly killedAt: Date | null;
  readonly closedAt: Date | null;
  readonly reconciledAt: Date | null;
  readonly heartbeatAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export function toSession(session: TradingSessionRow) {
  return {
    id: session.id,
    sessionKey: session.sessionKey,
    portfolioId: session.portfolioId,
    mode: session.mode,
    status: session.status,
    killSwitchEngaged: session.killSwitchEngaged,
    killReasonCode: session.killReasonCode,
    startedAt: toIsoOrNull(session.startedAt),
    pausedAt: toIsoOrNull(session.pausedAt),
    killedAt: toIsoOrNull(session.killedAt),
    closedAt: toIsoOrNull(session.closedAt),
    reconciledAt: toIsoOrNull(session.reconciledAt),
    heartbeatAt: toIsoOrNull(session.heartbeatAt),
    version: session.version,
    updatedAt: toIso(session.updatedAt)
  };
}

export interface RiskEventRow {
  readonly id: string;
  readonly type: string;
  readonly severity: string;
  readonly reasonCode: string;
  readonly portfolioId: string;
  readonly tradeCandidateId: string | null;
  readonly shadowOrderId: string | null;
  readonly shadowPositionId: string | null;
  readonly tradingSessionId: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: Date | null;
  readonly resolutionNote: string | null;
  readonly createdAt: Date;
}

export function toRiskEvent(event: RiskEventRow) {
  return {
    id: event.id,
    type: event.type,
    severity: event.severity,
    reasonCode: event.reasonCode,
    portfolioId: event.portfolioId,
    tradeCandidateId: event.tradeCandidateId,
    shadowOrderId: event.shadowOrderId,
    shadowPositionId: event.shadowPositionId,
    tradingSessionId: event.tradingSessionId,
    acknowledgedBy: event.acknowledgedBy,
    acknowledgedAt: toIsoOrNull(event.acknowledgedAt),
    resolutionNote: event.resolutionNote,
    createdAt: toIso(event.createdAt)
  };
}

export interface TradingAuditEventRow {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly reasonCode: string;
  readonly tradingSessionId: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly occurredAt: Date;
}

export function toAuditEvent(event: TradingAuditEventRow) {
  return {
    id: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    actorType: event.actorType,
    actorId: event.actorId,
    reasonCode: event.reasonCode,
    tradingSessionId: event.tradingSessionId,
    beforeState: event.beforeState,
    afterState: event.afterState,
    occurredAt: toIso(event.occurredAt)
  };
}
