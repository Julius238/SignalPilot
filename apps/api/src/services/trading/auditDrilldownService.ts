/**
 * Audit and incident drilldown (P8, "5. Audit und Incident Review").
 *
 * Assembles the complete event chain behind one aggregate — candidate,
 * assessment, decision, order, fill, position, session — from the append-only
 * `TradingAuditEvent` log plus the domain rows it references, and sanitises
 * every before/after state **server-side** before it leaves this process.
 *
 * Three properties this module guarantees:
 *
 *   1. **Read-only.** There is no write, update or delete anywhere in this
 *      file. Audit data is not editable through the application at all
 *      (P8: "keine frei editierbaren Auditdaten").
 *   2. **Sanitised on the server, not in the browser.** `sanitiseState` runs
 *      here, so a redacted value never travels to the client at all — a
 *      client-side filter would still have shipped the secret over the wire.
 *   3. **Bounded.** Every list takes a `limit`; the chain walk follows a fixed
 *      set of relations exactly once and never recurses.
 */

import { prisma, type PrismaClient } from "@signalpilot/database";

/**
 * Keys that are dropped from any before/after state, matched
 * case-insensitively as a substring. This is a denylist on top of data that is
 * already internal-only; the aggregate projections below are additionally an
 * explicit allowlist of columns.
 */
const REDACTED_KEY_FRAGMENTS: readonly string[] = [
  "secret",
  "token",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "credential",
  "authorization",
  "cookie",
  "webhook",
  "connectionstring",
  "database_url",
  "databaseurl",
  "privatekey",
  "private_key",
  "sessioncookie",
  "csrf"
];

const MAX_STATE_DEPTH = 6;
const MAX_STATE_STRING = 2_000;
const MAX_STATE_ARRAY = 50;

function isRedactedKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return REDACTED_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Recursively strip redacted keys and bound the shape of an audit state
 * payload. A dropped key is replaced by the marker rather than removed
 * silently, so a reviewer can see that something was withheld instead of
 * concluding the field never existed.
 */
export function sanitiseState(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return value.length > MAX_STATE_STRING ? `${value.slice(0, MAX_STATE_STRING)}…` : value;
  }
  if (depth >= MAX_STATE_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_STATE_ARRAY).map((entry) => sanitiseState(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isRedactedKey(key) ? "[redacted]" : sanitiseState(entry, depth + 1);
    }
    return output;
  }
  return null;
}

export interface AuditChainEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly tradingSessionId: string | null;
  readonly engineVersion: string | null;
  readonly codeVersion: string | null;
  readonly inputHash: string | null;
  readonly outputHash: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly occurredAt: string;
}

export interface AuditChainNode {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly label: string;
  readonly status: string | null;
  readonly occurredAt: string | null;
  /** Reason/rejection codes the domain row itself carries. */
  readonly reasonCodes: readonly string[];
  readonly version: number | null;
}

export interface AuditDrilldown {
  readonly rootAggregateType: string;
  readonly rootAggregateId: string;
  readonly found: boolean;
  /** The aggregates involved, in causal order candidate → … → position. */
  readonly chain: readonly AuditChainNode[];
  readonly events: readonly AuditChainEvent[];
  readonly correlationIds: readonly string[];
  readonly truncated: boolean;
}

/** Aggregate types the drilldown can start from. */
export const DRILLDOWN_AGGREGATE_TYPES = [
  "TradeCandidate",
  "RiskAssessment",
  "ShadowOrder",
  "ShadowFill",
  "ShadowPosition",
  "TradingSession"
] as const;
export type DrilldownAggregateType = (typeof DRILLDOWN_AGGREGATE_TYPES)[number];

export function isDrilldownAggregateType(value: string): value is DrilldownAggregateType {
  return (DRILLDOWN_AGGREGATE_TYPES as readonly string[]).includes(value);
}

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

/**
 * Resolve the whole aggregate chain around one starting point. Whatever the
 * entry point, the result covers the same causal path: candidate → decision →
 * risk assessment → order → fills → position → session.
 */
async function resolveChain(
  database: PrismaClient,
  aggregateType: DrilldownAggregateType,
  aggregateId: string
): Promise<{ nodes: AuditChainNode[]; ids: Map<string, string[]> }> {
  const nodes: AuditChainNode[] = [];
  const ids = new Map<string, string[]>();

  const addId = (type: string, id: string | null | undefined): void => {
    if (!id) return;
    const list = ids.get(type) ?? [];
    if (!list.includes(id)) list.push(id);
    ids.set(type, list);
  };

  // Normalise every entry point onto a candidate id and/or a position id, then
  // expand from those two anchors — one walk, no recursion.
  let candidateId: string | null = null;
  let positionId: string | null = null;
  let sessionId: string | null = null;

  switch (aggregateType) {
    case "TradeCandidate":
      candidateId = aggregateId;
      break;
    case "RiskAssessment": {
      const assessment = await database.riskAssessment.findUnique({
        where: { id: aggregateId },
        select: { tradeCandidateId: true }
      });
      candidateId = assessment?.tradeCandidateId ?? null;
      break;
    }
    case "ShadowOrder": {
      const order = await database.shadowOrder.findUnique({
        where: { id: aggregateId },
        select: { tradeCandidateId: true, shadowPositionId: true, tradingSessionId: true }
      });
      candidateId = order?.tradeCandidateId ?? null;
      positionId = order?.shadowPositionId ?? null;
      sessionId = order?.tradingSessionId ?? null;
      break;
    }
    case "ShadowFill": {
      const fill = await database.shadowFill.findUnique({
        where: { id: aggregateId },
        select: { shadowPositionId: true, shadowOrder: { select: { tradeCandidateId: true, tradingSessionId: true } } }
      });
      candidateId = fill?.shadowOrder?.tradeCandidateId ?? null;
      positionId = fill?.shadowPositionId ?? null;
      sessionId = fill?.shadowOrder?.tradingSessionId ?? null;
      break;
    }
    case "ShadowPosition": {
      positionId = aggregateId;
      const position = await database.shadowPosition.findUnique({
        where: { id: aggregateId },
        select: { entryOrder: { select: { tradeCandidateId: true, tradingSessionId: true } } }
      });
      candidateId = position?.entryOrder?.tradeCandidateId ?? null;
      sessionId = position?.entryOrder?.tradingSessionId ?? null;
      break;
    }
    case "TradingSession":
      sessionId = aggregateId;
      break;
  }

  if (candidateId !== null) {
    const candidate = await database.tradeCandidate.findUnique({
      where: { id: candidateId },
      include: {
        asset: { select: { symbol: true } },
        decision: { select: { id: true, outcome: true, reasonCode: true, decidedAt: true } },
        riskAssessments: {
          orderBy: { assessedAt: "asc" },
          select: { id: true, status: true, assessedAt: true, ruleSetVersion: true }
        },
        shadowOrders: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            purpose: true,
            createdAt: true,
            version: true,
            rejectionReasonCode: true,
            cancelReasonCode: true,
            shadowPositionId: true,
            tradingSessionId: true
          }
        }
      }
    });

    if (candidate !== null) {
      addId("TradeCandidate", candidate.id);
      nodes.push({
        aggregateType: "TradeCandidate",
        aggregateId: candidate.id,
        label: `${candidate.asset?.symbol ?? candidate.assetId} ${candidate.direction}`,
        status: candidate.status,
        occurredAt: iso(candidate.decisionTime),
        reasonCodes: [candidate.invalidReasonCode, candidate.cancelReasonCode].filter(
          (value): value is string => typeof value === "string"
        ),
        version: candidate.version
      });

      for (const assessment of candidate.riskAssessments) {
        addId("RiskAssessment", assessment.id);
        nodes.push({
          aggregateType: "RiskAssessment",
          aggregateId: assessment.id,
          label: `Risk ${assessment.ruleSetVersion}`,
          status: assessment.status,
          occurredAt: iso(assessment.assessedAt),
          reasonCodes: [],
          version: null
        });
      }

      if (candidate.decision !== null) {
        addId("TradeDecision", candidate.decision.id);
        nodes.push({
          aggregateType: "TradeDecision",
          aggregateId: candidate.decision.id,
          label: "Entscheidung",
          status: candidate.decision.outcome,
          occurredAt: iso(candidate.decision.decidedAt),
          reasonCodes: [candidate.decision.reasonCode],
          version: null
        });
      }

      // An ENTRY order carries no `shadowPositionId` — the position points at
      // it via `entryOrderId`, not the other way round (docs/trading/03), so
      // walking forward from a candidate needs the reverse lookup below.
      const entryOrderIds: string[] = [];

      for (const order of candidate.shadowOrders) {
        addId("ShadowOrder", order.id);
        entryOrderIds.push(order.id);
        if (positionId === null && order.shadowPositionId !== null) positionId = order.shadowPositionId;
        if (sessionId === null) sessionId = order.tradingSessionId;
        nodes.push({
          aggregateType: "ShadowOrder",
          aggregateId: order.id,
          label: `${order.purpose}-Order`,
          status: order.status,
          occurredAt: iso(order.createdAt),
          reasonCodes: [order.rejectionReasonCode, order.cancelReasonCode].filter(
            (value): value is string => typeof value === "string"
          ),
          version: order.version
        });
      }

      if (positionId === null && entryOrderIds.length > 0) {
        const openedPosition = await database.shadowPosition.findFirst({
          where: { entryOrderId: { in: entryOrderIds } },
          select: { id: true }
        });
        positionId = openedPosition?.id ?? null;
      }
    }
  }

  if (positionId !== null) {
    const position = await database.shadowPosition.findUnique({
      where: { id: positionId },
      include: {
        asset: { select: { symbol: true } },
        fills: {
          orderBy: { occurredAt: "asc" },
          take: 100,
          select: { id: true, triggerType: true, occurredAt: true, side: true }
        },
        events: {
          orderBy: { sequence: "asc" },
          take: 100,
          select: { id: true, type: true, sequence: true, occurredAt: true }
        },
        exitPlans: { orderBy: { version: "asc" }, select: { id: true, version: true, status: true, createdAt: true } }
      }
    });

    if (position !== null) {
      addId("ShadowPosition", position.id);
      nodes.push({
        aggregateType: "ShadowPosition",
        aggregateId: position.id,
        label: `Position ${position.asset?.symbol ?? position.assetId}`,
        status: position.status,
        occurredAt: iso(position.openedAt),
        reasonCodes: [],
        version: position.version
      });

      for (const plan of position.exitPlans) {
        nodes.push({
          aggregateType: "ExitPlan",
          aggregateId: plan.id,
          label: `ExitPlan v${plan.version}`,
          status: plan.status,
          occurredAt: iso(plan.createdAt),
          reasonCodes: [],
          version: plan.version
        });
      }

      for (const fill of position.fills) {
        addId("ShadowFill", fill.id);
        nodes.push({
          aggregateType: "ShadowFill",
          aggregateId: fill.id,
          label: `${fill.side}-Fill (${fill.triggerType})`,
          status: fill.triggerType,
          occurredAt: iso(fill.occurredAt),
          reasonCodes: [],
          version: null
        });
      }

      for (const event of position.events) {
        nodes.push({
          aggregateType: "ShadowPositionEvent",
          aggregateId: event.id,
          label: `Event #${event.sequence}`,
          status: event.type,
          occurredAt: iso(event.occurredAt),
          reasonCodes: [],
          version: event.sequence
        });
      }
    }
  }

  if (sessionId !== null) {
    const session = await database.tradingSession.findUnique({ where: { id: sessionId } });
    if (session !== null) {
      addId("TradingSession", session.id);
      nodes.push({
        aggregateType: "TradingSession",
        aggregateId: session.id,
        label: `Session ${session.mode}`,
        status: session.status,
        occurredAt: iso(session.startedAt ?? session.createdAt),
        reasonCodes: [session.killReasonCode].filter((value): value is string => typeof value === "string"),
        version: session.version
      });
    }
  }

  nodes.sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""));
  return { nodes, ids };
}

export interface GetAuditDrilldownOptions {
  readonly aggregateType: DrilldownAggregateType;
  readonly aggregateId: string;
  readonly limit: number;
}

export async function getAuditDrilldown(
  database: PrismaClient = prisma,
  options: GetAuditDrilldownOptions
): Promise<AuditDrilldown> {
  const { nodes, ids } = await resolveChain(database, options.aggregateType, options.aggregateId);

  const aggregateFilters = [...ids.entries()].map(([aggregateType, aggregateIds]) => ({
    aggregateType,
    aggregateId: { in: aggregateIds }
  }));
  // Always include the requested aggregate itself, even when the chain walk
  // found nothing (a deleted or never-linked id still has audit events).
  aggregateFilters.push({ aggregateType: options.aggregateType, aggregateId: { in: [options.aggregateId] } });

  const rows = await database.tradingAuditEvent.findMany({
    where: { OR: aggregateFilters },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    take: options.limit + 1
  });

  const truncated = rows.length > options.limit;
  const events: AuditChainEvent[] = rows.slice(0, options.limit).map((row) => ({
    id: row.id,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    actorType: row.actorType,
    actorId: row.actorId,
    reasonCode: row.reasonCode,
    correlationId: row.correlationId,
    causationId: row.causationId,
    tradingSessionId: row.tradingSessionId,
    engineVersion: row.engineVersion,
    codeVersion: row.codeVersion,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    // Sanitised here, before serialisation — a redacted value never reaches
    // the network at all.
    beforeState: sanitiseState(row.beforeState),
    afterState: sanitiseState(row.afterState),
    occurredAt: row.occurredAt.toISOString()
  }));

  return {
    rootAggregateType: options.aggregateType,
    rootAggregateId: options.aggregateId,
    found: nodes.length > 0 || events.length > 0,
    chain: nodes,
    events,
    correlationIds: [...new Set(events.map((event) => event.correlationId))],
    truncated
  };
}
