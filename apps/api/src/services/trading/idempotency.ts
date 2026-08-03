import { prisma, type PrismaClient } from "@signalpilot/database";

export interface IdempotentReplay {
  readonly id: string;
  readonly reasonCode: string;
  readonly afterState: unknown;
  readonly occurredAt: Date;
}

/**
 * Look up a prior `TradingAuditEvent` for this exact idempotency key and
 * aggregate. No new table — every P1–P5 mutation already writes one of
 * these, keyed and indexed by `idempotencyKey`. Scoping by `aggregateType`
 * (and, when known, `aggregateId`) keeps two different operations from ever
 * colliding on an operator-supplied key that happens to repeat.
 */
export async function findIdempotentReplay(
  database: PrismaClient = prisma,
  aggregateType: string,
  idempotencyKey: string,
  aggregateId?: string
): Promise<IdempotentReplay | null> {
  const event = await database.tradingAuditEvent.findFirst({
    where: {
      idempotencyKey,
      aggregateType,
      ...(aggregateId !== undefined ? { aggregateId } : {})
    },
    orderBy: { createdAt: "asc" }
  });
  if (event === null) return null;
  return { id: event.id, reasonCode: event.reasonCode, afterState: event.afterState, occurredAt: event.occurredAt };
}
