/**
 * Manual, admin-requested risk-reducing close for one open `ShadowPosition`.
 *
 * Specification: P6 task, "Manual Risk Close" — "nur eine vorhandene offene
 * Shadow-Position reduzieren oder schließen; keine Position vergrößern;
 * keine neue Position erzeugen; in blockierten Sessions weiterhin
 * funktionieren; über den vorhandenen Exit-/Execution-Ablauf gehen; Reason,
 * Benutzer und Idempotency Key persistieren."
 *
 * This module never touches the position, an order, a fill or the ledger
 * itself — it only records the request as a critical `RiskEvent` (+ its own
 * `TradingAuditEvent`), keyed so a replayed request with the same
 * idempotency key is a no-op. `shadowPositionMonitor.ts`'s forced-exit check
 * (widened to also recognise this event's `reasonCode`) is what actually
 * closes the position, at the next closed candle, through the exact same
 * fill/ledger/event/audit pipeline every stop/take-profit/time exit already
 * uses. That is also why this always runs regardless of session/kill-switch
 * state: the monitor path it feeds is itself never gated by session capability
 * (docs/trading/04, "Kill-Switch-Auslöser") — a request can be filed even
 * while the session is `ERROR_LOCKED`, exactly like a stop-loss would still
 * fire.
 *
 * A full close is always requested (matching every other exit trigger's
 * sizing convention — the exit order is always sized at the position's full
 * open quantity); the eventual fill may still only partially close the
 * position within one candle if the execution profile's liquidity
 * participation cap limits it, exactly as an ordinary stop/take-profit exit
 * can.
 */

import {
  RiskEventType,
  RiskSeverity,
  ShadowPositionStatus,
  TradingActorType,
  type PrismaClient
} from "@signalpilot/database";
import { buildAuditEventKey, buildPayloadHash, buildRiskEventKey } from "@signalpilot/trading-domain";

import { asJson, decimalString } from "./shadowPortfolioIo.js";

export const MANUAL_RISK_CLOSE_REASON_CODE = "MANUAL_RISK_CLOSE_REQUESTED";

const OPEN_POSITION_STATUSES = [ShadowPositionStatus.OPEN, ShadowPositionStatus.PARTIALLY_CLOSED];

export interface RequestManualRiskCloseInput {
  readonly shadowPositionId: string;
  readonly actorId: string;
  readonly reasonNote: string;
  readonly idempotencyKey: string;
  readonly asOf: Date;
}

export type RequestManualRiskCloseResult =
  | {
      readonly ok: true;
      readonly riskEventId: string;
      readonly alreadyRequested: boolean;
      readonly positionStatus: string;
    }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };

export async function requestManualRiskClose(
  database: PrismaClient,
  input: RequestManualRiskCloseInput
): Promise<RequestManualRiskCloseResult> {
  const position = await database.shadowPosition.findUnique({ where: { id: input.shadowPositionId } });
  if (position === null) {
    return { ok: false, reasonCode: "POSITION_NOT_FOUND", message: `No ShadowPosition ${input.shadowPositionId}.` };
  }
  if (!OPEN_POSITION_STATUSES.includes(position.status as never)) {
    return {
      ok: false,
      reasonCode: "POSITION_NOT_OPEN",
      message: `ShadowPosition ${position.id} is ${position.status}, not open for a risk-reducing close.`
    };
  }

  const inputHash = buildPayloadHash(input.idempotencyKey);
  const eventKey = buildRiskEventKey({
    type: RiskEventType.ADMIN_ACTION,
    aggregateType: "ShadowPosition",
    aggregateId: position.id,
    inputHash
  });

  const existing = await database.riskEvent.findUnique({ where: { eventKey } });
  if (existing !== null) {
    return { ok: true, riskEventId: existing.id, alreadyRequested: true, positionStatus: position.status };
  }

  const session = await database.tradingSession.findFirst({
    where: { portfolioId: position.portfolioId, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" }
  });

  const created = await database.$transaction(async (tx) => {
    const riskEvent = await tx.riskEvent.create({
      data: {
        eventKey,
        type: RiskEventType.ADMIN_ACTION,
        severity: RiskSeverity.CRITICAL,
        reasonCode: MANUAL_RISK_CLOSE_REASON_CODE,
        portfolioId: position.portfolioId,
        tradingSessionId: session?.id ?? null,
        shadowPositionId: position.id,
        payloadJson: asJson({ actorId: input.actorId, reasonNote: input.reasonNote, idempotencyKey: input.idempotencyKey }),
        inputHash
      }
    });
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "MANUAL_RISK_CLOSE_REQUESTED",
          aggregateType: "ShadowPosition",
          aggregateId: position.id,
          idempotencyKey: input.idempotencyKey
        }),
        eventType: "MANUAL_RISK_CLOSE_REQUESTED",
        aggregateType: "ShadowPosition",
        aggregateId: position.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: input.idempotencyKey,
        causationId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        reasonCode: MANUAL_RISK_CLOSE_REASON_CODE,
        tradingSessionId: session?.id ?? null,
        beforeState: asJson({ positionStatus: position.status, openQuantity: decimalString(position.openQuantity) }),
        afterState: asJson({ riskEventId: riskEvent.id, reasonNote: input.reasonNote }),
        occurredAt: input.asOf
      }
    });
    return riskEvent;
  });

  return { ok: true, riskEventId: created.id, alreadyRequested: false, positionStatus: position.status };
}
