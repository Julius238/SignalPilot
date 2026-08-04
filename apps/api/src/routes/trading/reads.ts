/**
 * `/trading/*` read routes — registered only when `TRADING_API_ENABLED` is
 * true (see `server.ts`). Every filter is optional; every list is bounded by
 * `limit`/`offset` exactly like `routes/dashboard.ts`'s existing routes —
 * never an unbounded table scan (P6 task, "Keine unbegrenzten
 * Tabellenabfragen").
 */

import {
  RiskAssessmentStatus,
  RiskEventType,
  RiskSeverity,
  ShadowOrderPurpose,
  ShadowOrderStatus,
  StrategyPerformanceSegment,
  StrategyPerformanceWindow,
  TradeCandidateStatus,
  TradeDirection,
  TradingAlertEventType,
  TradingAlertOutboxStatus,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { buildEligibilityReport } from "@signalpilot/trading-worker/lib/shadowEligibility";
import type { FastifyInstance } from "fastify";

import {
  toCandidateDetail,
  toCandidateListItem,
  toRiskAssessment
} from "../../schemas/trading/candidates.js";
import {
  toFill,
  toOrder,
  toPositionDetail,
  toPositionListItem
} from "../../schemas/trading/execution.js";
import {
  toAlertOutboxEntry,
  toPerformanceSegment
} from "../../schemas/trading/performance.js";
import {
  toPortfolioSnapshot,
  toPortfolioSummary
} from "../../schemas/trading/portfolio.js";
import {
  toAuditEvent,
  toRiskEvent,
  toSession
} from "../../schemas/trading/session.js";
import {
  getAlertOutboxSummary,
  listAlertOutbox
} from "../../services/trading/alertOutboxService.js";
import { listStrategyAssignments } from "../../services/trading/assignmentService.js";
import {
  getAuditDrilldown,
  isDrilldownAggregateType,
  DRILLDOWN_AGGREGATE_TYPES
} from "../../services/trading/auditDrilldownService.js";
import {
  getCandidateById,
  listCandidates
} from "../../services/trading/candidatesService.js";
import {
  listFills,
  listOrders,
  listPositions,
  getPositionById
} from "../../services/trading/executionService.js";
import { getOverview } from "../../services/trading/overviewService.js";
import { listPerformance } from "../../services/trading/performanceService.js";
import {
  getLatestPerformanceRun,
  listPerformanceEngineVersions,
  listPerformanceSegments
} from "../../services/trading/performanceSegmentService.js";
import {
  getPrimaryPortfolio,
  listSnapshots
} from "../../services/trading/portfolioService.js";
import { listRiskAssessments } from "../../services/trading/riskService.js";
import {
  listAuditEvents,
  listRiskEvents,
  listSessions
} from "../../services/trading/sessionService.js";
import { getWorkerStatus } from "../../services/trading/workerStatusService.js";
import { requireTradingOperator } from "./operatorAuth.js";
import {
  asQueryRecord,
  badRequest,
  notFound,
  parseEnum,
  parseLimit,
  parseOffset,
  parseOptionalDate,
  parseOptionalString
} from "./http.js";

let database: PrismaClient = prisma;

export function setTradingReadsDatabaseForTests(db: PrismaClient): void {
  database = db;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function registerTradingReadRoutes(server: FastifyInstance) {
  server.get("/trading/overview", async () => getOverview(database));

  server.get("/trading/portfolio", async (_request, reply) => {
    const portfolio = await getPrimaryPortfolio(database);
    if (portfolio === null) return notFound(reply, "No portfolio exists yet.");
    return toPortfolioSummary(portfolio);
  });

  server.get("/trading/portfolio/snapshots", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const snapshots = await listSnapshots(database, {
      from,
      to,
      limit,
      offset
    });
    return snapshots.map(toPortfolioSnapshot);
  });

  server.get("/trading/assignments", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetId = parseOptionalString(query.assetId);
    const direction = parseEnum(
      query.direction,
      Object.values(TradeDirection),
      "direction",
      reply
    );
    const enabledRaw = parseOptionalString(query.enabled);
    if (
      enabledRaw !== undefined &&
      enabledRaw !== "true" &&
      enabledRaw !== "false"
    ) {
      return badRequest(reply, "enabled must be true or false");
    }
    const enabled =
      enabledRaw === undefined ? undefined : enabledRaw === "true";
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const assignments = await listStrategyAssignments(database, {
      assetId,
      direction,
      enabled,
      limit,
      offset
    });
    return assignments.map((assignment) => {
      const config = assignment.assignmentConfigJson as Record<string, unknown>;
      const parameters = assignment.strategyVersion.parametersJson as Record<
        string,
        unknown
      >;
      const assignmentDirection = config.direction;
      const strategyDirection = parameters.direction;
      return {
        id: assignment.id,
        portfolioId: assignment.portfolioId,
        assetId: assignment.assetId,
        symbol: assignment.asset.symbol,
        timeframe: assignment.timeframe,
        enabled: assignment.enabled,
        direction:
          assignmentDirection === "LONG" || assignmentDirection === "SHORT"
            ? assignmentDirection
            : null,
        directionConsistent: assignmentDirection === strategyDirection,
        strategyId: assignment.strategyId,
        strategyKey: assignment.strategy.key,
        strategyName: assignment.strategy.name,
        strategyStatus: assignment.strategy.status,
        strategyVersionId: assignment.strategyVersionId,
        strategyVersion: assignment.strategyVersion.version,
        strategyVersionStatus: assignment.strategyVersion.status,
        strategyEngineVersion: assignment.strategyVersion.engineVersion,
        strategySpecificationHash: assignment.strategyVersion.specificationHash,
        syntheticShadowOnly:
          config.leverageAllowed === false &&
          config.marginAllowed === false &&
          config.futuresAllowed === false &&
          (assignmentDirection !== "SHORT" ||
            config.syntheticShadowShort === true),
        version: assignment.version,
        validFrom: assignment.validFrom?.toISOString() ?? null,
        validTo: assignment.validTo?.toISOString() ?? null
      };
    });
  });

  server.get("/trading/candidates", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(
      query.status,
      Object.values(TradeCandidateStatus),
      "status",
      reply
    );
    const direction = parseEnum(
      query.direction,
      Object.values(TradeDirection),
      "direction",
      reply
    );
    const assetId = parseOptionalString(query.assetId);
    const strategyVersionId = parseOptionalString(query.strategyVersionId);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const candidates = await listCandidates(database, {
      assetId,
      direction,
      strategyVersionId,
      status,
      from,
      to,
      limit,
      offset
    });
    return candidates.map(toCandidateListItem);
  });

  server.get("/trading/candidates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidate = await getCandidateById(database, id);
    if (candidate === null) return notFound(reply, `No TradeCandidate ${id}.`);
    return toCandidateDetail(candidate);
  });

  server.get("/trading/risk-assessments", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(
      query.status,
      Object.values(RiskAssessmentStatus),
      "status",
      reply
    );
    const tradeCandidateId = parseOptionalString(query.tradeCandidateId);
    const portfolioId = parseOptionalString(query.portfolioId);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const assessments = await listRiskAssessments(database, {
      tradeCandidateId,
      portfolioId,
      status,
      from,
      to,
      limit,
      offset
    });
    return assessments.map(toRiskAssessment);
  });

  server.get("/trading/orders", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(
      query.status,
      Object.values(ShadowOrderStatus),
      "status",
      reply
    );
    const purpose = parseEnum(
      query.purpose,
      Object.values(ShadowOrderPurpose),
      "purpose",
      reply
    );
    const direction = parseEnum(
      query.direction,
      Object.values(TradeDirection),
      "direction",
      reply
    );
    const assetId = parseOptionalString(query.assetId);
    const portfolioId = parseOptionalString(query.portfolioId);
    const strategyVersionId = parseOptionalString(query.strategyVersionId);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const orders = await listOrders(database, {
      assetId,
      portfolioId,
      direction,
      strategyVersionId,
      status,
      purpose,
      from,
      to,
      limit,
      offset
    });
    return orders.map(toOrder);
  });

  server.get("/trading/fills", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetId = parseOptionalString(query.assetId);
    const shadowOrderId = parseOptionalString(query.orderId);
    const shadowPositionId = parseOptionalString(query.positionId);
    const direction = parseEnum(
      query.direction,
      Object.values(TradeDirection),
      "direction",
      reply
    );
    const strategyVersionId = parseOptionalString(query.strategyVersionId);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const fills = await listFills(database, {
      assetId,
      shadowOrderId,
      shadowPositionId,
      direction,
      strategyVersionId,
      from,
      to,
      limit,
      offset
    });
    return fills.map(toFill);
  });

  server.get("/trading/positions", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetId = parseOptionalString(query.assetId);
    const portfolioId = parseOptionalString(query.portfolioId);
    const direction = parseEnum(
      query.direction,
      Object.values(TradeDirection),
      "direction",
      reply
    );
    const strategyVersionId = parseOptionalString(query.strategyVersionId);
    const openRaw = parseOptionalString(query.open);
    if (openRaw !== undefined && openRaw !== "true" && openRaw !== "false") {
      return badRequest(reply, "open must be true or false");
    }
    const open = openRaw === undefined ? undefined : openRaw === "true";
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const positions = await listPositions(database, {
      assetId,
      portfolioId,
      direction,
      strategyVersionId,
      open,
      limit,
      offset
    });
    return positions.map(toPositionListItem);
  });

  server.get("/trading/positions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const position = await getPositionById(database, id);
    if (position === null) return notFound(reply, `No ShadowPosition ${id}.`);
    return toPositionDetail(position);
  });

  server.get("/trading/performance", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const window = parseEnum(
      query.window,
      Object.values(StrategyPerformanceWindow),
      "window",
      reply
    );
    const portfolioId = parseOptionalString(query.portfolioId);
    const strategyVersionId = parseOptionalString(query.strategyVersionId);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const performance = await listPerformance(database, {
      portfolioId,
      strategyVersionId,
      window,
      from,
      to,
      limit,
      offset
    });
    return performance.map((row) => ({
      id: row.id,
      strategyVersionId: row.strategyVersionId,
      portfolioId: row.portfolioId,
      window: row.window,
      asOf: row.asOf.toISOString(),
      from: row.from.toISOString(),
      to: row.to.toISOString(),
      closedTrades: row.closedTrades,
      wins: row.wins,
      losses: row.losses,
      breakeven: row.breakeven,
      grossPnl: String(row.grossPnl),
      netPnl: String(row.netPnl),
      fees: String(row.fees),
      averageR: String(row.averageR),
      profitFactor: String(row.profitFactor),
      maxDrawdownPct: String(row.maxDrawdownPct)
    }));
  });

  server.get("/trading/sessions", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const portfolioId = parseOptionalString(query.portfolioId);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const sessions = await listSessions(database, {
      portfolioId,
      limit,
      offset
    });
    return sessions.map(toSession);
  });

  server.get("/trading/risk-events", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const type = parseEnum(
      query.type,
      Object.values(RiskEventType),
      "type",
      reply
    );
    const severity = parseEnum(
      query.severity,
      Object.values(RiskSeverity),
      "severity",
      reply
    );
    const portfolioId = parseOptionalString(query.portfolioId);
    const acknowledgedRaw = parseOptionalString(query.acknowledged);
    if (
      acknowledgedRaw !== undefined &&
      acknowledgedRaw !== "true" &&
      acknowledgedRaw !== "false"
    ) {
      return badRequest(reply, "acknowledged must be true or false");
    }
    const acknowledged =
      acknowledgedRaw === undefined ? undefined : acknowledgedRaw === "true";
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const events = await listRiskEvents(database, {
      portfolioId,
      type,
      severity,
      acknowledged,
      from,
      to,
      limit,
      offset
    });
    return events.map(toRiskEvent);
  });

  server.get("/trading/audit", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const aggregateType = parseOptionalString(query.aggregateType);
    const aggregateId = parseOptionalString(query.aggregateId);
    const eventType = parseOptionalString(query.eventType);
    const tradingSessionId = parseOptionalString(query.sessionId);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const events = await listAuditEvents(database, {
      aggregateType,
      aggregateId,
      eventType,
      tradingSessionId,
      from,
      to,
      limit,
      offset
    });
    return events.map(toAuditEvent);
  });

  server.get("/trading/worker-status", async () => getWorkerStatus(database));

  // ── P8: segmented performance ────────────────────────────────────────────

  server.get("/trading/performance/segments", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const window = parseEnum(
      query.window,
      Object.values(StrategyPerformanceWindow),
      "window",
      reply
    );
    const segmentType = parseEnum(
      query.segmentType,
      Object.values(StrategyPerformanceSegment),
      "segmentType",
      reply
    );
    const portfolioId = parseOptionalString(query.portfolioId);
    const segmentKey = parseOptionalString(query.segmentKey);
    const strategyVersionId = parseOptionalString(query.strategyVersionId);
    const engineVersion = parseOptionalString(query.engineVersion);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
    const offset = parseOffset(query.offset, reply);
    if (reply.sent || limit === undefined || offset === undefined) return reply;

    const rows = await listPerformanceSegments(database, {
      portfolioId,
      window,
      segmentType,
      segmentKey,
      strategyVersionId,
      engineVersion,
      from,
      to,
      limit,
      offset
    });
    return rows.map(toPerformanceSegment);
  });

  /**
   * The newest computation run as one coherent unit. Every segment in the
   * response comes from the same `inputHash`, so the dashboard can never show
   * an asset breakdown from one data cut next to a regime breakdown from
   * another.
   */
  server.get("/trading/performance/latest", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const window = parseEnum(
      query.window,
      Object.values(StrategyPerformanceWindow),
      "window",
      reply
    );
    if (reply.sent) return reply;

    const portfolioId =
      parseOptionalString(query.portfolioId) ??
      (await getPrimaryPortfolio(database))?.id;
    if (portfolioId === undefined)
      return notFound(reply, "No portfolio exists yet.");

    const run = await getLatestPerformanceRun(database, {
      portfolioId,
      window: window ?? StrategyPerformanceWindow.ALL_TIME
    });
    if (run === null) {
      return {
        portfolioId,
        window: window ?? StrategyPerformanceWindow.ALL_TIME,
        provenance: null,
        segments: [],
        engineVersions: await listPerformanceEngineVersions(database, {
          portfolioId
        })
      };
    }

    return {
      portfolioId,
      window: run.newest.window,
      provenance: {
        asOf: run.newest.asOf.toISOString(),
        from: run.newest.from.toISOString(),
        to: run.newest.to.toISOString(),
        engineVersion: run.newest.engineVersion,
        codeVersion: run.newest.codeVersion,
        inputHash: run.newest.inputHash,
        outputHash: run.newest.outputHash,
        dataThroughAt: run.newest.dataThroughAt?.toISOString() ?? null,
        computedAt: run.newest.computedAt?.toISOString() ?? null
      },
      segments: run.segments.map(toPerformanceSegment),
      engineVersions: await listPerformanceEngineVersions(database, {
        portfolioId
      })
    };
  });

  // ── P8: alert outbox (operators only) ────────────────────────────────────

  server.get(
    "/trading/alerts/outbox",
    { preHandler: requireTradingOperator },
    async (request, reply) => {
      const query = asQueryRecord(request.query);
      const status = parseEnum(
        query.status,
        Object.values(TradingAlertOutboxStatus),
        "status",
        reply
      );
      const eventType = parseEnum(
        query.eventType,
        Object.values(TradingAlertEventType),
        "eventType",
        reply
      );
      const severity = parseEnum(
        query.severity,
        Object.values(RiskSeverity),
        "severity",
        reply
      );
      const portfolioId = parseOptionalString(query.portfolioId);
      const from = parseOptionalDate(query.from, "from", reply);
      const to = parseOptionalDate(query.to, "to", reply);
      const limit = parseLimit(query.limit, DEFAULT_LIMIT, MAX_LIMIT, reply);
      const offset = parseOffset(query.offset, reply);
      if (reply.sent || limit === undefined || offset === undefined)
        return reply;

      const entries = await listAlertOutbox(database, {
        status,
        eventType,
        severity,
        portfolioId,
        from,
        to,
        limit,
        offset
      });
      return entries.map(toAlertOutboxEntry);
    }
  );

  server.get(
    "/trading/alerts/summary",
    { preHandler: requireTradingOperator },
    async () => getAlertOutboxSummary(database)
  );

  // ── P8: audit drilldown (operators only) ─────────────────────────────────

  server.get(
    "/trading/audit/drilldown",
    { preHandler: requireTradingOperator },
    async (request, reply) => {
      const query = asQueryRecord(request.query);
      const aggregateType = parseOptionalString(query.aggregateType);
      const aggregateId = parseOptionalString(query.aggregateId);
      const limit = parseLimit(query.limit, 200, 500, reply);
      if (reply.sent || limit === undefined) return reply;

      if (
        aggregateType === undefined ||
        !isDrilldownAggregateType(aggregateType)
      ) {
        return badRequest(
          reply,
          `aggregateType must be one of: ${DRILLDOWN_AGGREGATE_TYPES.join(", ")}`
        );
      }
      if (aggregateId === undefined)
        return badRequest(reply, "aggregateId is required");

      const drilldown = await getAuditDrilldown(database, {
        aggregateType,
        aggregateId,
        limit
      });
      if (!drilldown.found)
        return notFound(
          reply,
          `No audit trail for ${aggregateType} ${aggregateId}.`
        );
      return drilldown;
    }
  );

  // ── P8: shadow eligibility ───────────────────────────────────────────────

  /**
   * Strictly read-only: `buildEligibilityReport` performs no write of any
   * kind, so this route cannot activate, unlock or enable anything — which is
   * exactly what P8 demands of it ("Der Report darf nichts aktivieren").
   */
  server.get(
    "/trading/eligibility",
    { preHandler: requireTradingOperator },
    async () => buildEligibilityReport(database, { asOf: new Date() })
  );
}
