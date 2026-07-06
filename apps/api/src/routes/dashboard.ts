import {
  AlertChannel,
  AlertStatus,
  AssetType,
  BacktestOutcome,
  BacktestOutcomeStatus,
  BacktestRunStatus,
  BotRunStatus,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  Prisma,
  MarketEventSeverity,
  MarketEventType,
  RadarEventSeverity,
  RadarEventType,
  RiskLevel,
  prisma,
  SignalDirection,
  SignalStatus,
  SignalType,
  StrategyComparisonStatus,
  WatchlistPriority
} from "@signalpilot/database";
import { extractRequestContext, logAudit } from "../auth/audit.js";
import { buildDataQualityReport } from "@signalpilot/data-quality";
import { buildEventContextForSignal, type EventInput } from "@signalpilot/events-intelligence";
import {
  buildSignalRegimeContext,
  type MarketRegimeReport,
  type SignalRegimeContext
} from "@signalpilot/market-regime";
import { buildNewsContextForSignal } from "@signalpilot/news-intelligence";
import {
  calculateMultiTimeframeSummary,
  type MultiTimeframeSignalInput,
  type MultiTimeframeSummary
} from "@signalpilot/multi-timeframe";
import {
  buildPerformanceBuckets,
  buildPerformanceReport,
  type PerformanceGroupBy
} from "@signalpilot/performance-intelligence";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getPublicEnvironment, isDevLoginEnabled } from "../auth/config.js";
import { isAuthEnabled } from "../auth/session.js";

type QueryValue = string | string[] | undefined;
type QueryRecord = Record<string, QueryValue>;

const assetTypes = Object.values(AssetType);
const signalStatuses = Object.values(SignalStatus);
const signalDirections = Object.values(SignalDirection);
const signalTypes = Object.values(SignalType);
const watchlistPriorities = Object.values(WatchlistPriority);
const botRunStatuses = Object.values(BotRunStatus);
const radarEventTypes = Object.values(RadarEventType);
const radarEventSeverities = Object.values(RadarEventSeverity);
const marketEventTypes = Object.values(MarketEventType);
const marketEventSeverities = Object.values(MarketEventSeverity);
const alertStatuses = Object.values(AlertStatus);
const alertChannels = Object.values(AlertChannel);
const backtestRunStatuses = Object.values(BacktestRunStatus);
const backtestOutcomes = Object.values(BacktestOutcome);
const strategyComparisonStatuses = Object.values(StrategyComparisonStatus);
const paperEvaluationStatuses = Object.values(PaperEvaluationStatus);
const paperEvaluationOutcomes = Object.values(PaperEvaluationOutcome);
const paperEvaluationKinds = Object.values(PaperEvaluationKind);
const performanceGroupBys = [
  "signalType",
  "timeframe",
  "symbol",
  "status",
  "riskLevel",
  "evaluationKind",
  "scoreBucket"
] as const;
const publicAlertModes = ["ALL_ASSETS", "WATCHLIST_ONLY", "HIGH_PRIORITY_ONLY"] as const;
const multiTimeframes = ["1h", "4h", "1d"] as const;
const multiTimeframeAlignments = [
  "BULLISH_ALIGNED",
  "BEARISH_ALIGNED",
  "MIXED",
  "SHORT_TERM_ONLY",
  "HIGHER_TIMEFRAME_CONFIRMATION",
  "CONFLICT",
  "NO_EDGE"
] as const;
type SignalListItem = ReturnType<typeof toSignalListItem>;
type SignalRecord = Prisma.SignalGetPayload<Record<string, never>>;
type WatchlistItemRecord = Prisma.WatchlistItemGetPayload<{
  include: { asset: { select: typeof assetSelect } };
}>;
type MultiTimeframeScannerRow = {
  asset: Prisma.AssetGetPayload<{ select: typeof assetSelect }>;
  latestSignalsByTimeframe: Partial<Record<(typeof multiTimeframes)[number], ReturnType<typeof toCompactSignal>>>;
  multiTimeframeSummary: MultiTimeframeSummary;
};

let database = prisma;

export function setDashboardDatabaseForTests(db: typeof prisma) {
  database = db;
}

export async function registerDashboardRoutes(server: FastifyInstance) {
  server.get("/config/public", async () => {
    const liveTradingEnabled = process.env.ENABLE_LIVE_TRADING === "true";
    const authEnabled = isAuthEnabled();

    return {
      alertMode: parsePublicAlertMode(process.env.ALERT_MODE),
      alertCooldownMinutes: parsePositiveNumberEnv(process.env.ALERT_COOLDOWN_MINUTES, 240),
      alertScoreImprovementThreshold: parsePositiveNumberEnv(
        process.env.ALERT_SCORE_IMPROVEMENT_THRESHOLD,
        8
      ),
      dashboardOrigin: process.env.DASHBOARD_ORIGIN,
      authEnabled,
      devLoginEnabled: authEnabled && isDevLoginEnabled(),
      environment: getPublicEnvironment(),
      liveTradingEnabled,
      paperTradingOnly: !liveTradingEnabled
    };
  });

  server.get("/assets", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const isActive = parseBoolean(query.isActive, "isActive", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const assets = await database.asset.findMany({
      where: {
        assetType,
        isActive
      },
      orderBy: {
        symbol: "asc"
      },
      take: limit,
      select: assetSelect
    });

    return assets;
  });

  // TODO: Scope watchlist items to the authenticated user once auth is introduced.
  server.get("/watchlist", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const priority = parseEnum(
      query.priority,
      watchlistPriorities as WatchlistPriority[],
      "priority",
      reply
    );
    const alertEnabled = parseBoolean(query.alertEnabled, "alertEnabled", reply);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const items = await database.watchlistItem.findMany({
      where: {
        priority,
        alertEnabled,
        asset: {
          assetType
        }
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        asset: {
          select: assetSelect
        }
      }
    });

    return buildWatchlistItems(items);
  });

  server.post("/watchlist", async (request, reply) => {
    const body = asBodyRecord(request.body);
    const symbol = parseRequiredBodyString(body.symbol, "symbol", reply)?.toUpperCase();
    const priority =
      parseOptionalBodyEnum(
        body.priority,
        watchlistPriorities as WatchlistPriority[],
        "priority",
        reply
      ) ?? WatchlistPriority.MEDIUM;
    const notes = parseOptionalNullableBodyString(body.notes, "notes", reply);
    const alertEnabled = parseOptionalBodyBoolean(body.alertEnabled, "alertEnabled", reply) ?? true;

    if (reply.sent || !symbol) {
      return reply;
    }

    const asset = await database.asset.findFirst({
      where: {
        symbol
      },
      select: {
        id: true,
        symbol: true
      }
    });

    if (!asset) {
      return notFound(reply, "Asset not found");
    }

    try {
      const item = await database.watchlistItem.create({
        data: {
          assetId: asset.id,
          symbol: asset.symbol,
          priority,
          notes,
          alertEnabled
        },
        include: {
          asset: {
            select: assetSelect
          }
        }
      });

      reply.code(201);
      void logAudit({ action: "watchlist_create", actor: "admin", targetType: "WatchlistItem", targetId: item.id, ...extractRequestContext(request) });
      return (await buildWatchlistItems([item]))[0];
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return conflict(reply, "Asset is already in the watchlist");
      }

      throw error;
    }
  });

  server.patch("/watchlist/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = asBodyRecord(request.body);
    const data: Prisma.WatchlistItemUpdateInput = {};

    if (hasOwn(body, "priority")) {
      const priority = parseOptionalBodyEnum(
        body.priority,
        watchlistPriorities as WatchlistPriority[],
        "priority",
        reply
      );
      if (priority !== undefined) {
        data.priority = priority;
      }
    }

    if (hasOwn(body, "notes")) {
      data.notes = parseOptionalNullableBodyString(body.notes, "notes", reply);
    }

    if (hasOwn(body, "alertEnabled")) {
      const alertEnabled = parseOptionalBodyBoolean(body.alertEnabled, "alertEnabled", reply);
      if (alertEnabled !== undefined) {
        data.alertEnabled = alertEnabled;
      }
    }

    if (reply.sent) {
      return reply;
    }

    try {
      const item = await database.watchlistItem.update({
        where: {
          id
        },
        data,
        include: {
          asset: {
            select: assetSelect
          }
        }
      });

      void logAudit({ action: "watchlist_update", actor: "admin", targetType: "WatchlistItem", targetId: id, ...extractRequestContext(request) });
      return (await buildWatchlistItems([item]))[0];
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return notFound(reply, "Watchlist item not found");
      }

      throw error;
    }
  });

  server.delete("/watchlist/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await database.watchlistItem.delete({
        where: {
          id
        }
      });

      reply.code(204);
      void logAudit({ action: "watchlist_delete", actor: "admin", targetType: "WatchlistItem", targetId: id, ...extractRequestContext(request) });
      return null;
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return notFound(reply, "Watchlist item not found");
      }

      throw error;
    }
  });

  server.get("/assets/:symbol", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const query = asQueryRecord(request.query);
    const includeCandles = parseBoolean(query.includeCandles, "includeCandles", reply) ?? false;
    const includeMultiTimeframe =
      parseBoolean(query.includeMultiTimeframe, "includeMultiTimeframe", reply) ?? true;
    const candleLimit = parseLimit(query.candleLimit, 250, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const asset = await database.asset.findFirst({
      where: {
        symbol: symbol.toUpperCase()
      },
      select: {
        ...assetSelect,
        watchlistItem: {
          select: watchlistItemSelect
        }
      }
    });

    if (!asset) {
      return notFound(reply, "Asset not found");
    }

    const [latestSignal, multiTimeframeSignals, candleCounts] = await Promise.all([
      database.signal.findFirst({
        where: {
          assetId: asset.id
        },
        orderBy: {
          createdAt: "desc"
        },
        include: {
          output: true
        }
      }),
      includeMultiTimeframe ? findLatestMultiTimeframeSignalsForAsset(asset.id) : Promise.resolve([]),
      database.candle.groupBy({
        by: ["timeframe"],
        where: {
          assetId: asset.id
        },
        _count: {
          _all: true
        }
      })
    ]);
    const candleTimeframe =
      parseOptionalString(query.timeframe) ?? latestSignal?.timeframe ?? "1d";
    const candles =
      includeCandles && candleLimit
        ? await database.candle.findMany({
            where: {
              assetId: asset.id,
              timeframe: candleTimeframe
            },
            orderBy: {
              openTime: "desc"
            },
            take: candleLimit
          })
        : [];

    return {
      ...asset,
      isWatchlisted: asset.watchlistItem !== null,
      latestSignal: latestSignal ? toSignalSummary(latestSignal) : null,
      latestSignalOutput: latestSignal?.output ? toSignalOutput(latestSignal.output, true) : null,
      multiTimeframeSummary:
        includeMultiTimeframe && multiTimeframeSignals.length > 0
          ? calculateMultiTimeframeSummary(multiTimeframeSignals.map(toMultiTimeframeSignalInput))
          : null,
      candleCounts: Object.fromEntries(
        candleCounts.map((count: { timeframe: string; _count: { _all: number } }) => [
          count.timeframe,
          count._count._all
        ])
      ),
      candles: includeCandles ? candles.reverse().map(toCandle) : undefined
    };
  });

  server.get("/signals", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const status = parseEnum(query.status, signalStatuses as SignalStatus[], "status", reply);
    const direction = parseEnum(query.direction, signalDirections as SignalDirection[], "direction", reply);
    const signalType = parseEnum(query.signalType, signalTypes as SignalType[], "signalType", reply);
    const limit = parseLimit(query.limit, 50, 200, reply);
    const offset = parseOffset(query.offset, reply);

    if (reply.sent) {
      return reply;
    }

    const timeframe = parseOptionalString(query.timeframe);
    const symbol = parseOptionalString(query.symbol)?.toUpperCase();

    const signals = await database.signal.findMany({
      where: {
        symbol,
        timeframe,
        status,
        direction,
        signalType,
        asset: assetType
          ? {
              assetType
            }
          : undefined
      },
      orderBy: {
        createdAt: "desc"
      },
      skip: offset,
      take: limit,
      include: {
        asset: {
          select: assetSelect
        },
        output: true,
        paperEvaluation: true
      }
    });

    return signals.map(toSignalListItem);
  });

  server.get("/scanner", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const showOnlyAlertWorthy =
      parseBoolean(query.showOnlyAlertWorthy, "showOnlyAlertWorthy", reply) ?? false;
    const watchlistOnly = parseBoolean(query.watchlistOnly, "watchlistOnly", reply) ?? false;
    const minScore = parseOptionalNumber(query.minScore, "minScore", reply);

    if (reply.sent) {
      return reply;
    }

    const timeframe = parseOptionalString(query.timeframe);
    const baseWhere: Prisma.SignalWhereInput = {
      timeframe,
      score: minScore === undefined ? undefined : { gte: minScore },
      asset: buildAssetRelationWhere(assetType, watchlistOnly)
    };
    const today = startOfToday();
    const scannerWhere = (where: Prisma.SignalWhereInput): Prisma.SignalWhereInput =>
      mergeSignalWhere(baseWhere, where, showOnlyAlertWorthy ? alertWorthyWhere : undefined);

    const [
      strongWatch,
      watchlist,
      volumeSpikes,
      breakouts,
      highRisk,
      noEdge,
      strongWatchCount,
      watchCount,
      alertsSentToday,
      lastPipelineRun
    ] = await Promise.all([
      findScannerSignals(scannerWhere({ status: SignalStatus.STRONG_WATCH }), { score: "desc" }),
      findScannerSignals(scannerWhere({ status: SignalStatus.WATCH }), { score: "desc" }),
      findScannerSignals(scannerWhere({ signalType: SignalType.VOLUME_SPIKE }), {
        createdAt: "desc"
      }),
      findScannerSignals(scannerWhere({ signalType: SignalType.BREAKOUT_ALERT }), {
        score: "desc"
      }),
      findScannerSignals(
        scannerWhere({
          OR: [{ status: SignalStatus.AVOID }, { riskLevel: RiskLevel.HIGH }]
        }),
        { riskScore: "desc" }
      ),
      findScannerSignals(scannerWhere({ status: SignalStatus.NO_EDGE }), { createdAt: "desc" }),
      database.signal.count({
        where: scannerWhere({ status: SignalStatus.STRONG_WATCH })
      }),
      database.signal.count({
        where: scannerWhere({ status: SignalStatus.WATCH })
      }),
      database.alert.count({
        where: {
          status: AlertStatus.SENT,
          sentAt: {
            gte: today
          }
        }
      }),
      database.botRun.findFirst({
        where: {
          jobName: {
            in: ["runCryptoSignalPipeline", "runEquitySignalPipeline"]
          }
        },
        orderBy: {
          startedAt: "desc"
        }
      })
    ]);

    const groups = {
      strongWatch,
      watchlist,
      volumeSpikes,
      breakouts,
      highRisk,
      noEdge
    };
    const multiTimeframeSummaries = await buildScannerMultiTimeframeSummaries(groups);
    const multiTimeframeSummaryValues = Object.values(multiTimeframeSummaries);

    return {
      summary: {
        strongWatchCount,
        watchCount,
        alertsSentToday,
        lastPipelineRunStatus: lastPipelineRun?.status ?? null,
        lastPipelineRunAt: lastPipelineRun?.startedAt ?? null,
        bullishAlignedCount: multiTimeframeSummaryValues.filter(
          (summary) => summary.alignment === "BULLISH_ALIGNED"
        ).length,
        bearishAlignedCount: multiTimeframeSummaryValues.filter(
          (summary) => summary.alignment === "BEARISH_ALIGNED"
        ).length,
        conflictCount: multiTimeframeSummaryValues.filter((summary) => summary.alignment === "CONFLICT")
          .length,
        noEdgeCount: multiTimeframeSummaryValues.filter((summary) => summary.alignment === "NO_EDGE")
          .length
      },
      groups,
      multiTimeframeSummaries
    };
  });

  server.get("/scanner/multi-timeframe", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const watchlistOnly = parseBoolean(query.watchlistOnly, "watchlistOnly", reply) ?? false;
    const alignment = parseEnum(
      query.alignment,
      multiTimeframeAlignments,
      "alignment",
      reply
    );
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const assets = await database.asset.findMany({
      where: {
        assetType,
        isActive: true,
        watchlistItem: watchlistOnly
          ? {
              isNot: null
            }
          : undefined
      },
      orderBy: {
        symbol: "asc"
      },
      take: 500,
      select: assetSelect
    });
    const rows = await buildMultiTimeframeScannerRows(assets);
    const filteredRows = alignment
      ? rows.filter((row) => row.multiTimeframeSummary.alignment === alignment)
      : rows;

    return filteredRows.slice(0, limit);
  });

  server.get("/market-regime/latest", async () => {
    const snapshot = await database.marketRegimeSnapshot.findFirst({
      orderBy: { generatedAt: "desc" }
    });

    return snapshot ? toMarketRegimeSnapshot(snapshot) : null;
  });

  server.get("/market-regime/history", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, 50, 500, reply);
    const from = parseOptionalIsoDate(query.from);
    const to = parseOptionalIsoDate(query.to);

    if (reply.sent) return reply;

    const snapshots = await database.marketRegimeSnapshot.findMany({
      where: {
        generatedAt:
          from || to
            ? {
                gte: from,
                lte: to
              }
            : undefined
      },
      orderBy: { generatedAt: "desc" },
      take: limit
    });

    return snapshots.map(toMarketRegimeSnapshot);
  });

  server.get("/signals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const signal = await database.signal.findUnique({
      where: {
        id
      },
      include: {
        asset: {
          select: assetSelect
        },
        output: true
      }
    });

    if (!signal) {
      return notFound(reply, "Signal not found");
    }

    const candles = await database.candle.findMany({
      where: {
        assetId: signal.assetId,
        timeframe: signal.timeframe
      },
      orderBy: {
        openTime: "desc"
      },
      take: 250
    });
    const paperEvaluation = (
      signal as typeof signal & {
        paperEvaluation?: Prisma.PaperSignalEvaluationGetPayload<Record<string, never>> | null;
      }
    ).paperEvaluation;

    return {
      signal: toSignalDetail(signal),
      asset: signal.asset,
      signalOutput: signal.output ? toSignalOutput(signal.output, true) : null,
      paperEvaluation: paperEvaluation ? toPaperEvaluation(paperEvaluation) : null,
      candles: candles.reverse().map(toCandle)
    };
  });

  server.get("/signals/:id/market-regime-context", async (request, reply) => {
    const { id } = request.params as { id: string };
    const signal = await database.signal.findUnique({
      where: { id },
      include: { asset: { select: { assetType: true } }, output: true }
    });

    if (!signal) return notFound(reply, "Signal not found");

    const storedContext = extractMarketRegimeContext(signal.output?.dashboardJson);
    if (storedContext) return storedContext;

    const snapshot = await database.marketRegimeSnapshot.findFirst({
      orderBy: { generatedAt: "desc" }
    });

    if (!snapshot) return null;

    return buildSignalRegimeContext({
      signalId: signal.id,
      symbol: signal.symbol,
      assetType: mapAssetTypeForMarketRegime(signal.asset?.assetType ?? AssetType.STOCK),
      signalDirection: signal.direction,
      signalStatus: signal.status,
      report: snapshot.reportJson as MarketRegimeReport
    });
  });

  server.get("/signals/:id/rule-application", async (request, reply) => {
    const { id } = request.params as { id: string };
    const application = await database.signalRuleApplication.findUnique({
      where: { signalId: id },
      include: { signal: { select: { symbol: true, timeframe: true } } }
    });

    if (!application) return notFound(reply, "Signal rule application not found");
    return toSignalRuleApplication(application);
  });

  server.get("/rules/applications", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const adjustedStatus = parseEnum(query.adjustedStatus, signalStatuses as SignalStatus[], "adjustedStatus", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);
    const symbol = parseOptionalString(query.symbol)?.toUpperCase();
    const category = parseOptionalString(query.category)?.toUpperCase();

    if (reply.sent) return reply;

    const applications = await database.signalRuleApplication.findMany({
      where: {
        adjustedStatus,
        signal: symbol ? { symbol } : undefined
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { signal: { select: { symbol: true, timeframe: true } } }
    });
    const rows = applications.map(toSignalRuleApplication);

    return category
      ? rows.filter((row) => row.adjustments.some((adjustment) => adjustment.category === category))
      : rows;
  });

  server.get("/rules/summary", async () => {
    const applications = await database.signalRuleApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000
    });
    const deltas = applications.map((application) => application.adjustedScore - application.originalScore);
    const adjustmentRows = applications.flatMap((application) => parseAdjustments(application.adjustmentsJson));

    return {
      totalApplications: applications.length,
      avgDelta: average(deltas),
      positiveAdjustmentCount: deltas.filter((delta) => delta > 0).length,
      negativeAdjustmentCount: deltas.filter((delta) => delta < 0).length,
      noAdjustmentCount: deltas.filter((delta) => delta === 0).length,
      topAdjustmentReasons: topCounts(adjustmentRows.map((adjustment) => adjustment.reason)),
      groupedByCategory: topCounts(adjustmentRows.map((adjustment) => adjustment.category))
    };
  });

  server.get("/backtests", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(query.status, backtestRunStatuses as BacktestRunStatus[], "status", reply);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) return reply;

    const runs = await database.backtestRun.findMany({
      where: { status },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { _count: { select: { signals: true } } }
    });

    return runs.map(toBacktestRunListItem);
  });

  server.get("/backtests/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await database.backtestRun.findUnique({
      where: { id },
      include: { _count: { select: { signals: true } } }
    });

    if (!run) return notFound(reply, "Backtest run not found");
    return toBacktestRunListItem(run);
  });

  server.get("/backtests/:id/signals", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = asQueryRecord(request.query);
    const symbol = parseOptionalString(query.symbol)?.toUpperCase();
    const timeframe = parseOptionalString(query.timeframe);
    const outcome = parseEnum(query.outcome, backtestOutcomes as BacktestOutcome[], "outcome", reply);
    const status = parseEnum(query.status, signalStatuses as SignalStatus[], "status", reply);
    const signalType = parseEnum(query.signalType, signalTypes as SignalType[], "signalType", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) return reply;

    const signals = await database.backtestSignal.findMany({
      where: { backtestRunId: id, symbol, timeframe, outcome, status, signalType },
      orderBy: { signalTime: "desc" },
      take: limit
    });

    return signals.map(toBacktestSignal);
  });

  server.get("/backtests/:id/summary", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await database.backtestRun.findUnique({ where: { id } });

    if (!run) return notFound(reply, "Backtest run not found");
    if (run.summaryJson && isRecord(run.summaryJson)) return run.summaryJson;

    const signals = await database.backtestSignal.findMany({ where: { backtestRunId: id } });
    return buildBacktestSummaryFromRows(signals);
  });

  server.post("/backtests/run", async (request, reply) => {
    const body = asBodyRecord(request.body);
    const assetType = parseOptionalBodyEnum(body.assetType, assetTypes as AssetType[], "assetType", reply);
    const useSignalRules = parseOptionalBodyBoolean(body.useSignalRules, "useSignalRules", reply);
    const from = parseOptionalBodyDate(body.from, "from", reply);
    const to = parseOptionalBodyDate(body.to, "to", reply);
    const minScoreToRecord = parseOptionalBodyNumber(body.minScoreToRecord, "minScoreToRecord", reply);
    const maxSignalsPerAssetTimeframe = parseOptionalBodyNumber(
      body.maxSignalsPerAssetTimeframe,
      "maxSignalsPerAssetTimeframe",
      reply
    );
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const symbols = parseOptionalBodyStringArray(body.symbols, "symbols", reply);
    const timeframes = parseOptionalBodyStringArray(body.timeframes, "timeframes", reply);

    if (reply.sent) return reply;

    void logAudit({ action: "backtest_run_request", actor: "admin", metadata: { name, assetType }, ...extractRequestContext(request) });
    return {
      accepted: false,
      message: "Backtest API v1 validiert die Konfiguration. Starte den Lauf synchron per Worker Script.",
      command: "pnpm worker:run-backtest",
      config: {
        name,
        assetType,
        symbols,
        timeframes,
        from,
        to,
        minScoreToRecord,
        useSignalRules,
        maxSignalsPerAssetTimeframe
      }
    };
  });

  server.get("/strategy/configs", async () => {
    const configs = await database.strategyConfig.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    return configs.map(toStrategyConfig);
  });

  server.get("/strategy/comparisons", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(query.status, strategyComparisonStatuses as StrategyComparisonStatus[], "status", reply);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) return reply;

    const runs = await database.strategyComparisonRun.findMany({
      where: { status },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { results: { include: { strategyConfig: true }, orderBy: { rank: "asc" } } }
    });

    return runs.map(toStrategyComparisonRun);
  });

  server.get("/strategy/comparisons/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await database.strategyComparisonRun.findUnique({
      where: { id },
      include: { results: { include: { strategyConfig: true }, orderBy: { rank: "asc" } } }
    });

    if (!run) return notFound(reply, "Strategy comparison run not found");
    return toStrategyComparisonRun(run);
  });

  server.get("/strategy/comparisons/:id/results", async (request) => {
    const { id } = request.params as { id: string };
    const results = await database.strategyBacktestResult.findMany({
      where: { comparisonRunId: id },
      orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
      include: { strategyConfig: true, backtestRun: true }
    });

    return results.map(toStrategyBacktestResult);
  });

  server.get("/strategy/comparisons/:id/summary", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await database.strategyComparisonRun.findUnique({ where: { id } });

    if (!run) return notFound(reply, "Strategy comparison run not found");
    return run.summaryJson ?? { totalStrategies: 0, bestStrategy: null, bestWinRate: null, warnings: [] };
  });

  server.post("/strategy/comparisons/run", async (request, reply) => {
    const body = asBodyRecord(request.body);
    const assetType = parseOptionalBodyEnum(body.assetType, assetTypes as AssetType[], "assetType", reply);
    const from = parseOptionalBodyDate(body.from, "from", reply);
    const to = parseOptionalBodyDate(body.to, "to", reply);
    const maxSignalsPerAssetTimeframe = parseOptionalBodyNumber(
      body.maxSignalsPerAssetTimeframe,
      "maxSignalsPerAssetTimeframe",
      reply
    );
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const symbols = parseOptionalBodyStringArray(body.symbols, "symbols", reply);
    const timeframes = parseOptionalBodyStringArray(body.timeframes, "timeframes", reply);
    const strategyConfigIds = parseOptionalBodyStringArray(body.strategyConfigIds, "strategyConfigIds", reply);

    if (reply.sent) return reply;

    void logAudit({ action: "strategy_comparison_run_request", actor: "admin", metadata: { name, assetType }, ...extractRequestContext(request) });
    return {
      accepted: false,
      message: "Use pnpm worker:run-strategy-comparison for a local run.",
      command: "pnpm worker:run-strategy-comparison",
      config: { name, symbols, assetType, timeframes, from, to, strategyConfigIds, maxSignalsPerAssetTimeframe }
    };
  });

  server.get("/news", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const symbol = parseOptionalString(query.symbol)?.toUpperCase();
    const source = parseOptionalString(query.source);
    const from = parseOptionalIsoDate(query.from);
    const to = parseOptionalIsoDate(query.to);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const newsItems = await database.newsItem.findMany({
      where: {
        symbol,
        source: source ?? undefined,
        publishedAt: from || to
          ? {
              gte: from ?? undefined,
              lte: to ?? undefined
            }
          : undefined
      },
      orderBy: { publishedAt: "desc" },
      take: limit
    });

    return newsItems.map(toNewsItem);
  });

  server.get("/assets/:symbol/news", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    const newsItems = await database.newsItem.findMany({
      where: { symbol: symbol.toUpperCase() },
      orderBy: { publishedAt: "desc" },
      take: limit
    });

    return newsItems.map(toNewsItem);
  });

  server.get("/signals/:id/news-context", async (request, reply) => {
    const { id } = request.params as { id: string };
    const signal = await database.signal.findUnique({
      where: { id },
      select: { id: true, assetId: true, symbol: true, createdAt: true }
    });

    if (!signal) {
      return notFound(reply, "Signal not found");
    }

    const since = new Date(signal.createdAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const newsItems = await database.newsItem.findMany({
      where: {
        assetId: signal.assetId,
        publishedAt: { gte: since }
      },
      orderBy: { publishedAt: "desc" },
      take: 20
    });

    return buildNewsContextForSignal({
      asset: { id: signal.assetId, symbol: signal.symbol },
      signal: { createdAt: signal.createdAt },
      newsItems: newsItems.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        headline: item.headline,
        summary: item.summary,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
        category: item.category
      }))
    });
  });

  server.get("/events", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const symbol = parseOptionalString(query.symbol)?.toUpperCase();
    const eventType = parseOptionalString(query.eventType);
    const from = parseOptionalIsoDate(query.from);
    const to = parseOptionalIsoDate(query.to);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const events = await database.event.findMany({
      where: {
        symbol,
        eventType: eventType ?? undefined,
        eventDate:
          from || to
            ? { gte: from ?? undefined, lte: to ?? undefined }
            : undefined
      },
      orderBy: { eventDate: "desc" },
      take: limit
    });

    return events.map(toEvent);
  });

  server.get("/assets/:symbol/events", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    const events = await database.event.findMany({
      where: { symbol: symbol.toUpperCase() },
      orderBy: { eventDate: "asc" },
      take: limit
    });

    return events.map(toEvent);
  });

  server.get("/signals/:id/event-context", async (request, reply) => {
    const { id } = request.params as { id: string };
    const signal = await database.signal.findUnique({
      where: { id },
      select: {
        id: true,
        assetId: true,
        symbol: true,
        createdAt: true,
        asset: { select: { assetType: true } }
      }
    });

    if (!signal) {
      return notFound(reply, "Signal not found");
    }

    const lookbackDays = parsePositiveNumberEnv(process.env.EVENTS_LOOKBACK_DAYS, 14);
    const lookaheadDays = parsePositiveNumberEnv(process.env.EVENTS_LOOKAHEAD_DAYS, 60);
    const from = new Date(signal.createdAt.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const to = new Date(signal.createdAt.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

    const events = await database.event.findMany({
      where: {
        symbol: signal.symbol,
        eventDate: { gte: from, lte: to }
      },
      orderBy: { eventDate: "asc" }
    });

    return buildEventContextForSignal({
      asset: {
        symbol: signal.symbol,
        assetType: signal.asset?.assetType ?? "STOCK"
      },
      signal: { createdAt: signal.createdAt },
      events: events.map(
        (e) =>
          ({
            id: e.id,
            symbol: e.symbol ?? signal.symbol,
            eventType: e.eventType,
            title: e.title,
            eventDate: e.eventDate ?? signal.createdAt,
            fiscalQuarter: e.fiscalQuarter,
            fiscalYear: e.fiscalYear,
            epsEstimate: e.epsEstimate?.toString() ?? null,
            epsActual: e.epsActual?.toString() ?? null,
            revenueEstimate: e.revenueEstimate?.toString() ?? null,
            revenueActual: e.revenueActual?.toString() ?? null
          }) satisfies EventInput
      ),
      now: signal.createdAt
    });
  });

  server.get("/paper/evaluations", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const evaluationStatus = parseEnum(
      query.status,
      paperEvaluationStatuses as PaperEvaluationStatus[],
      "status",
      reply
    );
    const outcome = parseEnum(
      query.outcome,
      paperEvaluationOutcomes as PaperEvaluationOutcome[],
      "outcome",
      reply
    );
    const signalStatus = parseEnum(
      query.signalStatus,
      signalStatuses as SignalStatus[],
      "signalStatus",
      reply
    );
    const signalType = parseEnum(query.signalType, signalTypes as SignalType[], "signalType", reply);
    const evaluationKind = parseEnum(
      query.evaluationKind,
      paperEvaluationKinds as PaperEvaluationKind[],
      "evaluationKind",
      reply
    );
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const evaluations = await database.paperSignalEvaluation.findMany({
      where: {
        symbol: parseOptionalString(query.symbol)?.toUpperCase(),
        evaluationStatus,
        evaluationKind,
        skipReason: parseOptionalString(query.skipReason),
        outcome,
        status: signalStatus,
        signalType
      },
      orderBy: {
        openedAt: "desc"
      },
      take: limit,
      include: {
        signal: {
          select: {
            id: true,
            assetId: true
          }
        }
      }
    });

    return evaluations.map(toPaperEvaluation);
  });

  server.get("/paper/evaluations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const evaluation = await database.paperSignalEvaluation.findUnique({
      where: {
        id
      },
      include: {
        signal: {
          include: {
            asset: {
              select: assetSelect
            },
            output: true
          }
        }
      }
    });

    if (!evaluation) {
      return notFound(reply, "Paper Evaluation not found");
    }

    return {
      evaluation: toPaperEvaluation(evaluation),
      signal: evaluation.signal ? toSignalSummary(evaluation.signal) : null,
      signalOutput: evaluation.signal?.output ? toSignalOutput(evaluation.signal.output, false) : null,
      asset: evaluation.signal?.asset ?? null
    };
  });

  server.get("/paper/stats", async () => {
    const evaluations = await database.paperSignalEvaluation.findMany();
    const evaluated = evaluations.filter(
      (evaluation) => evaluation.evaluationStatus === PaperEvaluationStatus.EVALUATED
    );
    const positiveCount = evaluations.filter(
      (evaluation) => evaluation.outcome === PaperEvaluationOutcome.POSITIVE
    ).length;
    const targetReachedCount = evaluations.filter(
      (evaluation) => evaluation.outcome === PaperEvaluationOutcome.TARGET_REACHED
    ).length;
    const negativeCount = evaluations.filter(
      (evaluation) => evaluation.outcome === PaperEvaluationOutcome.NEGATIVE
    ).length;
    const neutralCount = evaluations.filter(
      (evaluation) => evaluation.outcome === PaperEvaluationOutcome.NEUTRAL
    ).length;
    const invalidatedCount = evaluations.filter(
      (evaluation) => evaluation.outcome === PaperEvaluationOutcome.INVALIDATED
    ).length;

    return {
      totalEvaluations: evaluations.length,
      openCount: evaluations.filter((evaluation) => evaluation.evaluationStatus === PaperEvaluationStatus.OPEN)
        .length,
      evaluatedCount: evaluated.length,
      positiveCount,
      negativeCount,
      neutralCount,
      targetReachedCount,
      invalidatedCount,
      winRate:
        evaluated.length === 0
          ? 0
          : ((positiveCount + targetReachedCount) / evaluated.length) * 100,
      avgReturnAfter1h: average(evaluations.map((evaluation) => evaluation.returnAfter1h)),
      avgReturnAfter4h: average(evaluations.map((evaluation) => evaluation.returnAfter4h)),
      avgReturnAfter1d: average(evaluations.map((evaluation) => evaluation.returnAfter1d)),
      avgMaxFavorableMove: average(evaluations.map((evaluation) => evaluation.maxFavorableMove)),
      avgMaxAdverseMove: average(evaluations.map((evaluation) => evaluation.maxAdverseMove)),
      groupedBySignalStatus: groupCount(evaluations, (evaluation) => evaluation.status),
      groupedBySignalType: groupCount(evaluations, (evaluation) => evaluation.signalType),
      groupedByTimeframe: groupCount(evaluations, (evaluation) => evaluation.timeframe),
      byEvaluationKind: groupCount(evaluations, (evaluation) => evaluation.evaluationKind),
      skippedByReason: groupCount(
        evaluations.filter((evaluation) => evaluation.evaluationStatus === PaperEvaluationStatus.SKIPPED),
        (evaluation) => evaluation.skipReason ?? "Unspecified"
      ),
      observationStats: buildPaperObservationStats(evaluations)
    };
  });

  server.get("/performance/report", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const from = parseOptionalDate(query.from, "from", reply);
    const to = parseOptionalDate(query.to, "to", reply);
    const minEvaluated = parseOptionalInteger(query.minEvaluated, "minEvaluated", reply) ?? 0;
    const includeSkipped = parseBoolean(query.includeSkipped, "includeSkipped", reply) ?? true;

    if (reply.sent) {
      return reply;
    }

    const evaluations = await loadPerformanceEvaluations({
      symbol: parseOptionalString(query.symbol)?.toUpperCase(),
      assetType,
      timeframe: parseOptionalString(query.timeframe),
      from,
      to
    });

    return buildPerformanceReport(evaluations, {
      minEvaluated,
      includeSkipped
    });
  });

  server.get("/performance/buckets", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const groupBy = parseEnum(
      query.groupBy,
      performanceGroupBys,
      "groupBy",
      reply
    ) as PerformanceGroupBy | undefined;
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent || !groupBy) {
      return reply;
    }

    const evaluations = await loadPerformanceEvaluations({});
    const report = buildPerformanceReport(evaluations);

    return buildPerformanceBuckets(evaluations, groupBy, report.overallWinRate).slice(0, limit);
  });

  server.get("/data-quality/report", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);

    if (reply.sent) {
      return reply;
    }

    return loadDataQualityReport({
      assetType,
      symbol: parseOptionalString(query.symbol)?.toUpperCase()
    });
  });

  server.get("/data-quality/assets", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const minQualityScore = parseOptionalInteger(query.minQualityScore, "minQualityScore", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent || limit === undefined) {
      return reply;
    }

    const report = await loadDataQualityReport({ assetType });

    return report.assetCoverage
      .filter((asset) => minQualityScore === undefined || asset.qualityScore >= minQualityScore)
      .sort((left, right) => left.qualityScore - right.qualityScore || left.symbol.localeCompare(right.symbol))
      .slice(0, limit);
  });

  server.get("/assets/:symbol/signals", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    const asset = await database.asset.findFirst({
      where: {
        symbol: symbol.toUpperCase()
      },
      select: {
        id: true
      }
    });

    if (!asset) {
      return notFound(reply, "Asset not found");
    }

    const signals = await database.signal.findMany({
      where: {
        assetId: asset.id,
        timeframe: parseOptionalString(query.timeframe)
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit,
      include: {
        asset: {
          select: assetSelect
        },
        output: true
      }
    });

    return signals.map(toSignalListItem);
  });

  server.get("/bot-runs", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(query.status, botRunStatuses as BotRunStatus[], "status", reply);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    return database.botRun.findMany({
      where: {
        jobName: parseOptionalString(query.jobName),
        status
      },
      orderBy: {
        startedAt: "desc"
      },
      take: limit
    });
  });

  server.get("/logs", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    return database.botLog.findMany({
      where: {
        level: parseOptionalString(query.level),
        service: parseOptionalString(query.service)
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });
  });

  server.get("/radar/events", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const eventType = parseEnum(query.eventType, radarEventTypes as RadarEventType[], "eventType", reply);
    const severity = parseEnum(query.severity, radarEventSeverities as RadarEventSeverity[], "severity", reply);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    return database.radarEvent.findMany({
      where: {
        symbol: parseOptionalString(query.symbol),
        timeframe: parseOptionalString(query.timeframe),
        eventType,
        severity,
        assetType
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });
  });

  server.get("/market-events", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const eventType = parseEnum(
      query.eventType,
      marketEventTypes as MarketEventType[],
      "eventType",
      reply
    );
    const severity = parseEnum(
      query.severity,
      marketEventSeverities as MarketEventSeverity[],
      "severity",
      reply
    );
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    return database.marketEvent.findMany({
      where: {
        eventType,
        severity,
        region: parseOptionalString(query.region)
      },
      orderBy: {
        detectedAt: "desc"
      },
      take: limit,
      select: {
        id: true,
        eventType: true,
        severity: true,
        confidence: true,
        title: true,
        summary: true,
        region: true,
        source: true,
        sourceUrl: true,
        affectedAssetClasses: true,
        affectedSectors: true,
        affectedSymbols: true,
        positiveImpact: true,
        negativeImpact: true,
        reasoning: true,
        publishedAt: true,
        detectedAt: true,
        alertSentAt: true
      }
    });
  });

  server.get("/alerts", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(query.status, alertStatuses as AlertStatus[], "status", reply);
    const channel = parseEnum(query.channel, alertChannels as AlertChannel[], "channel", reply);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    return database.alert.findMany({
      where: {
        status,
        channel
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit,
      include: {
        signal: {
          select: {
            id: true,
            symbol: true,
            timeframe: true,
            status: true,
            signalType: true,
            score: true
          }
        }
      }
    });
  });

  server.get("/alerts/states", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const status = parseEnum(query.status, signalStatuses as SignalStatus[], "status", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    return database.alertState.findMany({
      where: {
        symbol: parseOptionalString(query.symbol)?.toUpperCase(),
        status
      },
      orderBy: {
        lastSentAt: "desc"
      },
      take: limit
    });
  });
}

function parsePublicAlertMode(value: string | undefined) {
  if (!value) {
    return "ALL_ASSETS";
  }

  const normalized = value.trim();

  return publicAlertModes.includes(normalized as (typeof publicAlertModes)[number])
    ? normalized
    : "ALL_ASSETS";
}

function parsePositiveNumberEnv(value: string | undefined, defaultValue: number) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const alertWorthyWhere = {
  OR: [
    { status: SignalStatus.STRONG_WATCH },
    {
      status: SignalStatus.WATCH,
      score: {
        gte: 70
      }
    },
    {
      status: SignalStatus.AVOID,
      riskLevel: RiskLevel.HIGH
    },
    { signalType: SignalType.VOLUME_SPIKE },
    { signalType: SignalType.VOLATILITY_SPIKE },
    { signalType: SignalType.BREAKOUT_ALERT }
  ]
} satisfies Prisma.SignalWhereInput;

async function findScannerSignals(
  where: Prisma.SignalWhereInput,
  orderBy: Prisma.SignalOrderByWithRelationInput
) {
  const signals = await database.signal.findMany({
    where,
    orderBy,
    take: 20,
    include: {
      asset: {
        select: assetSelect
      },
      output: true
    }
  });

  return signals.map(toSignalListItem);
}

async function buildWatchlistItems(items: WatchlistItemRecord[]) {
  if (items.length === 0) {
    return [];
  }

  return Promise.all(
    items.map(async (item) => {
      const [latestSignal, multiTimeframeSignals] = await Promise.all([
        database.signal.findFirst({
          where: {
            assetId: item.assetId
          },
          orderBy: {
            createdAt: "desc"
          },
          include: {
            output: true
          }
        }),
        findLatestMultiTimeframeSignalsForAsset(item.assetId)
      ]);

      return {
        ...toWatchlistItem(item),
        latestSignal: latestSignal ? toSignalSummary(latestSignal) : null,
        latestSignalOutput: latestSignal?.output ? toSignalOutput(latestSignal.output, false) : null,
        multiTimeframeSummary:
          multiTimeframeSignals.length > 0
            ? calculateMultiTimeframeSummary(multiTimeframeSignals.map(toMultiTimeframeSignalInput))
            : null
      };
    })
  );
}

async function findLatestMultiTimeframeSignalsForAsset(assetId: string) {
  const signals = await database.signal.findMany({
    where: {
      assetId,
      timeframe: {
        in: [...multiTimeframes]
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    distinct: ["assetId", "timeframe"]
  });

  return selectLatestMultiTimeframeSignals(signals);
}

async function buildMultiTimeframeScannerRows(
  assets: Prisma.AssetGetPayload<{ select: typeof assetSelect }>[]
): Promise<MultiTimeframeScannerRow[]> {
  if (assets.length === 0) {
    return [];
  }

  const assetIds = assets.map((asset) => asset.id);
  const signals = await database.signal.findMany({
    where: {
      assetId: {
        in: assetIds
      },
      timeframe: {
        in: [...multiTimeframes]
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    distinct: ["assetId", "timeframe"]
  });
  const latestSignalsByAsset = new Map<string, SignalRecord[]>();

  for (const signal of selectLatestMultiTimeframeSignalsByAsset(signals)) {
    const assetSignals = latestSignalsByAsset.get(signal.assetId) ?? [];
    assetSignals.push(signal);
    latestSignalsByAsset.set(signal.assetId, assetSignals);
  }

  return assets.flatMap((asset) => {
    const assetSignals = latestSignalsByAsset.get(asset.id) ?? [];

    if (assetSignals.length === 0) {
      return [];
    }

    return [
      {
        asset,
        latestSignalsByTimeframe: Object.fromEntries(
          assetSignals.map((signal) => [signal.timeframe, toCompactSignal(signal)])
        ),
        multiTimeframeSummary: calculateMultiTimeframeSummary(
          assetSignals.map(toMultiTimeframeSignalInput)
        )
      }
    ];
  });
}

async function buildScannerMultiTimeframeSummaries(
  groups: Record<string, SignalListItem[]>
): Promise<Record<string, MultiTimeframeSummary>> {
  const symbols = [...new Set(Object.values(groups).flatMap((signals) => signals.map((signal) => signal.symbol)))];

  if (symbols.length === 0) {
    return {};
  }

  const signals = await database.signal.findMany({
    where: {
      symbol: {
        in: symbols
      },
      timeframe: {
        in: [...multiTimeframes]
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const latestBySymbol = new Map<string, SignalRecord[]>();

  for (const signal of selectLatestMultiTimeframeSignalsBySymbol(signals)) {
    const symbolSignals = latestBySymbol.get(signal.symbol) ?? [];
    symbolSignals.push(signal);
    latestBySymbol.set(signal.symbol, symbolSignals);
  }

  return Object.fromEntries(
    [...latestBySymbol.entries()].map(([symbol, symbolSignals]) => [
      symbol,
      calculateMultiTimeframeSummary(symbolSignals.map(toMultiTimeframeSignalInput))
    ])
  );
}

function selectLatestMultiTimeframeSignals<T extends { timeframe: string; createdAt: Date }>(signals: T[]) {
  const latest = new Map<string, T>();

  for (const signal of signals) {
    const current = latest.get(signal.timeframe);
    if (!current || signal.createdAt > current.createdAt) {
      latest.set(signal.timeframe, signal);
    }
  }

  return [...latest.values()];
}

function selectLatestMultiTimeframeSignalsBySymbol<T extends { symbol: string; timeframe: string; createdAt: Date }>(
  signals: T[]
) {
  const latest = new Map<string, T>();

  for (const signal of signals) {
    const key = `${signal.symbol}:${signal.timeframe}`;
    const current = latest.get(key);
    if (!current || signal.createdAt > current.createdAt) {
      latest.set(key, signal);
    }
  }

  return [...latest.values()];
}

function selectLatestMultiTimeframeSignalsByAsset<T extends { assetId: string; timeframe: string; createdAt: Date }>(
  signals: T[]
) {
  const latest = new Map<string, T>();

  for (const signal of signals) {
    const key = `${signal.assetId}:${signal.timeframe}`;
    const current = latest.get(key);
    if (!current || signal.createdAt > current.createdAt) {
      latest.set(key, signal);
    }
  }

  return [...latest.values()];
}

function mergeSignalWhere(...conditions: Array<Prisma.SignalWhereInput | undefined>) {
  const activeConditions = conditions.filter(
    (condition): condition is Prisma.SignalWhereInput =>
      condition !== undefined && Object.values(condition).some((value) => value !== undefined)
  );

  if (activeConditions.length === 0) {
    return {};
  }

  if (activeConditions.length === 1) {
    return activeConditions[0];
  }

  return {
    AND: activeConditions
  };
}

function toEvent(event: {
  id: string;
  assetId: string | null;
  symbol: string | null;
  eventType: string;
  title: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  eventDate: Date | null;
  eventTime: string | null;
  fiscalQuarter: string | null;
  fiscalYear: number | null;
  epsEstimate: { toString(): string } | null;
  epsActual: { toString(): string } | null;
  revenueEstimate: { toString(): string } | null;
  revenueActual: { toString(): string } | null;
  importance: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: event.id,
    assetId: event.assetId,
    symbol: event.symbol,
    eventType: event.eventType,
    title: event.title,
    description: event.description,
    source: event.source,
    sourceUrl: event.sourceUrl,
    eventDate: event.eventDate,
    eventTime: event.eventTime,
    fiscalQuarter: event.fiscalQuarter,
    fiscalYear: event.fiscalYear,
    epsEstimate: event.epsEstimate?.toString() ?? null,
    epsActual: event.epsActual?.toString() ?? null,
    revenueEstimate: event.revenueEstimate?.toString() ?? null,
    revenueActual: event.revenueActual?.toString() ?? null,
    importance: event.importance,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

function toNewsItem(item: {
  id: string;
  assetId: string | null;
  symbol: string;
  source: string;
  headline: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  category: string | null;
  sentiment: string | null;
  relevanceScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    assetId: item.assetId,
    symbol: item.symbol,
    source: item.source,
    headline: item.headline,
    summary: item.summary,
    url: item.url,
    imageUrl: item.imageUrl,
    publishedAt: item.publishedAt,
    category: item.category,
    sentiment: item.sentiment,
    relevanceScore: item.relevanceScore,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function parseOptionalIsoDate(value: QueryValue): Date | undefined {
  const raw = firstQueryValue(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildAssetRelationWhere(assetType: AssetType | undefined, watchlistOnly: boolean) {
  if (!assetType && !watchlistOnly) {
    return undefined;
  }

  return {
    assetType,
    watchlistItem: watchlistOnly
      ? {
          isNot: null
        }
      : undefined
  } satisfies Prisma.AssetWhereInput;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

const assetSelect = {
  id: true,
  symbol: true,
  name: true,
  assetType: true,
  exchange: true,
  baseCurrency: true,
  quoteCurrency: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.AssetSelect;

const watchlistItemSelect = {
  id: true,
  assetId: true,
  symbol: true,
  priority: true,
  notes: true,
  alertEnabled: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.WatchlistItemSelect;

function toWatchlistItem(item: WatchlistItemRecord) {
  return {
    id: item.id,
    assetId: item.assetId,
    symbol: item.symbol,
    priority: item.priority,
    notes: item.notes,
    alertEnabled: item.alertEnabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    asset: item.asset
  };
}

function toSignalListItem(
  signal: Prisma.SignalGetPayload<{
    include: { asset: { select: typeof assetSelect }; output: true };
  }>
) {
  return {
    id: signal.id,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    signalType: signal.signalType,
    status: signal.status,
    direction: signal.direction,
    score: signal.score,
    riskLevel: signal.riskLevel,
    riskScore: signal.riskScore,
    createdAt: signal.createdAt,
    asset: signal.asset,
    signalOutput: signal.output ? toSignalOutputSummary(signal.output) : null
  };
}

function toSignalDetail(
  signal: Prisma.SignalGetPayload<{
    include: { asset: { select: typeof assetSelect }; output: true };
  }>
) {
  return {
    id: signal.id,
    assetId: signal.assetId,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    signalType: signal.signalType,
    status: signal.status,
    direction: signal.direction,
    score: signal.score,
    riskLevel: signal.riskLevel,
    trendScore: signal.trendScore,
    momentumScore: signal.momentumScore,
    volumeScore: signal.volumeScore,
    volatilityScore: signal.volatilityScore,
    rsiScore: signal.rsiScore,
    newsScore: signal.newsScore,
    socialScore: signal.socialScore,
    eventScore: signal.eventScore,
    riskScore: signal.riskScore,
    createdAt: signal.createdAt
  };
}

function toSignalOutputSummary(output: Prisma.SignalOutputGetPayload<Record<string, never>>) {
  return {
    id: output.id,
    signalId: output.signalId,
    shortConclusion: output.shortConclusion,
    nextTrigger: output.nextTrigger,
    telegramText: output.telegramText,
    dashboardJson: output.dashboardJson,
    createdAt: output.createdAt
  };
}

function toSignalSummary(
  signal: Prisma.SignalGetPayload<{
    include: { output: true };
  }>
) {
  return {
    id: signal.id,
    assetId: signal.assetId,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    signalType: signal.signalType,
    status: signal.status,
    direction: signal.direction,
    score: signal.score,
    riskLevel: signal.riskLevel,
    riskScore: signal.riskScore,
    createdAt: signal.createdAt
  };
}

function toCompactSignal(signal: SignalRecord) {
  return {
    id: signal.id,
    assetId: signal.assetId,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    signalType: signal.signalType,
    status: signal.status,
    direction: signal.direction,
    score: signal.score,
    riskLevel: signal.riskLevel,
    riskScore: signal.riskScore,
    createdAt: signal.createdAt
  };
}

function toMultiTimeframeSignalInput(signal: {
  symbol: string;
  timeframe: string;
  status: SignalStatus;
  direction: SignalDirection;
  signalType: SignalType;
  score: number;
  riskLevel: RiskLevel;
  riskScore: number | null;
  createdAt: Date;
}): MultiTimeframeSignalInput {
  return {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    status: signal.status,
    direction: signal.direction,
    signalType: signal.signalType,
    score: signal.score,
    riskLevel: signal.riskLevel,
    riskScore: signal.riskScore,
    createdAt: signal.createdAt
  };
}

function toSignalOutput(
  output: Prisma.SignalOutputGetPayload<Record<string, never>>,
  includeRichFields: boolean
) {
  return {
    id: output.id,
    signalId: output.signalId,
    shortConclusion: output.shortConclusion,
    counterArgument: output.counterArgument,
    nextTrigger: output.nextTrigger,
    telegramText: includeRichFields ? output.telegramText : undefined,
    dashboardJson: includeRichFields ? output.dashboardJson : undefined,
    technicalJson: includeRichFields ? output.technicalJson : undefined,
    intelligenceJson: includeRichFields ? output.intelligenceJson : undefined,
    marketConfirmationJson: includeRichFields ? output.marketConfirmationJson : undefined,
    createdAt: output.createdAt
  };
}

function toMarketRegimeSnapshot(snapshot: Prisma.MarketRegimeSnapshotGetPayload<Record<string, never>>) {
  return {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    equityRegime: snapshot.equityRegime,
    cryptoRegime: snapshot.cryptoRegime,
    overallRegime: snapshot.overallRegime,
    riskMode: snapshot.riskMode,
    confidence: snapshot.confidence,
    summary: snapshot.summary,
    riskNote: snapshot.riskNote,
    reportJson: snapshot.reportJson,
    report: snapshot.reportJson,
    createdAt: snapshot.createdAt
  };
}

function toBacktestRunListItem(
  run: Prisma.BacktestRunGetPayload<{ include: { _count: { select: { signals: true } } } }>
) {
  const summary = isRecord(run.summaryJson) ? run.summaryJson : {};
  return {
    id: run.id,
    name: run.name,
    assetType: run.assetType,
    symbols: Array.isArray(run.symbols) ? run.symbols : [],
    timeframes: Array.isArray(run.timeframes) ? run.timeframes : [],
    from: run.from,
    to: run.to,
    status: run.status,
    configJson: run.configJson,
    summaryJson: run.summaryJson,
    totalSignals: numberFromRecord(summary, "totalSignals") ?? run._count.signals,
    winRate: numberFromRecord(summary, "winRate"),
    avgReturnAfter1d: numberFromRecord(summary, "avgReturnAfter1d"),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function toBacktestSignal(signal: Prisma.BacktestSignalGetPayload<Record<string, never>>) {
  return {
    id: signal.id,
    backtestRunId: signal.backtestRunId,
    assetId: signal.assetId,
    symbol: signal.symbol,
    assetType: signal.assetType,
    timeframe: signal.timeframe,
    signalTime: signal.signalTime,
    signalType: signal.signalType,
    status: signal.status,
    direction: signal.direction,
    riskLevel: signal.riskLevel,
    score: signal.score,
    originalScore: signal.originalScore,
    adjustedScore: signal.adjustedScore,
    entryPrice: signal.entryPrice.toString(),
    targetPrice: signal.targetPrice?.toString() ?? null,
    invalidationPrice: signal.invalidationPrice?.toString() ?? null,
    outcome: signal.outcome,
    outcomeStatus: signal.outcomeStatus,
    evaluatedAt: signal.evaluatedAt,
    returnAfter1h: signal.returnAfter1h,
    returnAfter4h: signal.returnAfter4h,
    returnAfter1d: signal.returnAfter1d,
    returnAfter3d: signal.returnAfter3d,
    maxFavorableMove: signal.maxFavorableMove,
    maxAdverseMove: signal.maxAdverseMove,
    contextJson: signal.contextJson,
    createdAt: signal.createdAt
  };
}

function toStrategyConfig(config: Prisma.StrategyConfigGetPayload<Record<string, never>>) {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    isDefault: config.isDefault,
    configJson: config.configJson,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function toStrategyComparisonRun(
  run: Prisma.StrategyComparisonRunGetPayload<{
    include: { results: { include: { strategyConfig: true } } };
  }>
) {
  const summary = isRecord(run.summaryJson) ? run.summaryJson : {};
  const bestResult = run.results.find((result) => result.rank === 1) ?? run.results[0] ?? null;
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    from: run.from,
    to: run.to,
    symbols: Array.isArray(run.symbols) ? run.symbols : [],
    assetType: run.assetType,
    timeframes: Array.isArray(run.timeframes) ? run.timeframes : [],
    configJson: run.configJson,
    summaryJson: run.summaryJson,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    bestStrategy: typeof summary.bestStrategy === "string" ? summary.bestStrategy : bestResult?.strategyConfig.name ?? null,
    bestWinRate: numberFromRecord(summary, "bestWinRate") ?? bestResult?.winRate ?? null,
    resultCount: run.results.length
  };
}

function toStrategyBacktestResult(
  result: Prisma.StrategyBacktestResultGetPayload<{
    include: { strategyConfig: true; backtestRun: true };
  }>
) {
  return {
    id: result.id,
    comparisonRunId: result.comparisonRunId,
    strategyConfigId: result.strategyConfigId,
    strategyName: result.strategyConfig.name,
    strategyConfig: toStrategyConfig(result.strategyConfig),
    backtestRunId: result.backtestRunId,
    backtestRunName: result.backtestRun?.name ?? null,
    totalSignals: result.totalSignals,
    evaluatedCount: result.evaluatedCount,
    winRate: result.winRate,
    avgReturnAfter1d: result.avgReturnAfter1d,
    targetReachedCount: result.targetReachedCount,
    invalidatedCount: result.invalidatedCount,
    positiveCount: result.positiveCount,
    negativeCount: result.negativeCount,
    neutralCount: result.neutralCount,
    summaryJson: result.summaryJson,
    rank: result.rank,
    createdAt: result.createdAt
  };
}

function buildBacktestSummaryFromRows(signals: Prisma.BacktestSignalGetPayload<Record<string, never>>[]) {
  const evaluated = signals.filter((signal) => signal.outcomeStatus === BacktestOutcomeStatus.EVALUATED);
  const wins = evaluated.filter((signal) => signal.outcome === BacktestOutcome.POSITIVE || signal.outcome === BacktestOutcome.TARGET_REACHED);
  return {
    totalSignals: signals.length,
    evaluatedCount: evaluated.length,
    positiveCount: evaluated.filter((signal) => signal.outcome === BacktestOutcome.POSITIVE).length,
    negativeCount: evaluated.filter((signal) => signal.outcome === BacktestOutcome.NEGATIVE).length,
    neutralCount: evaluated.filter((signal) => signal.outcome === BacktestOutcome.NEUTRAL).length,
    targetReachedCount: evaluated.filter((signal) => signal.outcome === BacktestOutcome.TARGET_REACHED).length,
    invalidatedCount: evaluated.filter((signal) => signal.outcome === BacktestOutcome.INVALIDATED).length,
    winRate: evaluated.length === 0 ? 0 : (wins.length / evaluated.length) * 100,
    avgReturnAfter1h: average(evaluated.map((signal) => signal.returnAfter1h)),
    avgReturnAfter4h: average(evaluated.map((signal) => signal.returnAfter4h)),
    avgReturnAfter1d: average(evaluated.map((signal) => signal.returnAfter1d)),
    avgReturnAfter3d: average(evaluated.map((signal) => signal.returnAfter3d)),
    groupedBySymbol: buildBacktestGroups(evaluated, (signal) => signal.symbol),
    groupedByTimeframe: buildBacktestGroups(evaluated, (signal) => signal.timeframe),
    groupedBySignalType: buildBacktestGroups(evaluated, (signal) => signal.signalType),
    groupedByStatus: buildBacktestGroups(evaluated, (signal) => signal.status),
    groupedByScoreBucket: buildBacktestGroups(evaluated, (signal) => scoreBucket(signal.score)),
    warnings: []
  };
}

function buildBacktestGroups(
  signals: Prisma.BacktestSignalGetPayload<Record<string, never>>[],
  getKey: (signal: Prisma.BacktestSignalGetPayload<Record<string, never>>) => string
) {
  const groups = new Map<string, Prisma.BacktestSignalGetPayload<Record<string, never>>[]>();
  for (const signal of signals) {
    const key = getKey(signal);
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const wins = rows.filter((row) => row.outcome === BacktestOutcome.POSITIVE || row.outcome === BacktestOutcome.TARGET_REACHED);
    return {
      key,
      totalSignals: rows.length,
      evaluatedCount: rows.length,
      winRate: rows.length === 0 ? 0 : (wins.length / rows.length) * 100,
      avgReturnAfter1d: average(rows.map((row) => row.returnAfter1d))
    };
  });
}

function numberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function scoreBucket(score: number) {
  if (score < 50) return "0-49";
  if (score < 65) return "50-64";
  if (score < 80) return "65-79";
  return "80-100";
}

function toSignalRuleApplication(
  application: Prisma.SignalRuleApplicationGetPayload<{
    include: { signal: { select: { symbol: true; timeframe: true } } };
  }>
) {
  return {
    id: application.id,
    signalId: application.signalId,
    symbol: application.signal.symbol,
    timeframe: application.signal.timeframe,
    originalScore: application.originalScore,
    adjustedScore: application.adjustedScore,
    originalStatus: application.originalStatus,
    adjustedStatus: application.adjustedStatus,
    finalRiskLevel: application.finalRiskLevel,
    adjustments: parseAdjustments(application.adjustmentsJson),
    warnings: Array.isArray(application.warningsJson) ? application.warningsJson : [],
    summary: application.summary,
    createdAt: application.createdAt
  };
}

function parseAdjustments(value: unknown): Array<{ reason: string; category: string; scoreDelta: number }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    reason: typeof item.reason === "string" ? item.reason : "Unspecified",
    category: typeof item.category === "string" ? item.category : "UNKNOWN",
    scoreDelta: typeof item.scoreDelta === "number" ? item.scoreDelta : 0
  }));
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractMarketRegimeContext(dashboardJson: unknown): SignalRegimeContext | null {
  if (!dashboardJson || typeof dashboardJson !== "object" || !("marketRegimeContext" in dashboardJson)) {
    return null;
  }

  const context = (dashboardJson as { marketRegimeContext?: unknown }).marketRegimeContext;
  return context && typeof context === "object" ? (context as SignalRegimeContext) : null;
}

function mapAssetTypeForMarketRegime(assetType: AssetType) {
  if (assetType === AssetType.CRYPTO) return "crypto";
  if (assetType === AssetType.ETF) return "etf";
  return "stock";
}

function toCandle(candle: Prisma.CandleGetPayload<Record<string, never>>) {
  return {
    id: candle.id,
    assetId: candle.assetId,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open.toString(),
    high: candle.high.toString(),
    low: candle.low.toString(),
    close: candle.close.toString(),
    volume: candle.volume.toString(),
    source: candle.source,
    createdAt: candle.createdAt
  };
}

function toPaperEvaluation(
  evaluation: Prisma.PaperSignalEvaluationGetPayload<Record<string, never>>
) {
  return {
    id: evaluation.id,
    signalId: evaluation.signalId,
    assetId: evaluation.assetId,
    symbol: evaluation.symbol,
    timeframe: evaluation.timeframe,
    direction: evaluation.direction,
    status: evaluation.status,
    signalType: evaluation.signalType,
    score: evaluation.score,
    riskLevel: evaluation.riskLevel,
    entryPrice: evaluation.entryPrice.toString(),
    invalidationPrice: evaluation.invalidationPrice?.toString() ?? null,
    targetPrice: evaluation.targetPrice?.toString() ?? null,
    evaluationKind: evaluation.evaluationKind,
    expectedMoveDirection: evaluation.expectedMoveDirection,
    evaluationStatus: evaluation.evaluationStatus,
    skipReason: evaluation.skipReason,
    openedAt: evaluation.openedAt,
    evaluatedAt: evaluation.evaluatedAt,
    priceAfter1h: evaluation.priceAfter1h?.toString() ?? null,
    priceAfter4h: evaluation.priceAfter4h?.toString() ?? null,
    priceAfter1d: evaluation.priceAfter1d?.toString() ?? null,
    priceAfter3d: evaluation.priceAfter3d?.toString() ?? null,
    returnAfter1h: evaluation.returnAfter1h,
    returnAfter4h: evaluation.returnAfter4h,
    returnAfter1d: evaluation.returnAfter1d,
    returnAfter3d: evaluation.returnAfter3d,
    maxFavorableMove: evaluation.maxFavorableMove,
    maxAdverseMove: evaluation.maxAdverseMove,
    outcome: evaluation.outcome,
    notes: evaluation.notes,
    createdAt: evaluation.createdAt,
    updatedAt: evaluation.updatedAt
  };
}

function average(values: Array<number | null>) {
  const activeValues = values.filter((value): value is number => typeof value === "number");

  if (activeValues.length === 0) {
    return 0;
  }

  return activeValues.reduce((sum, value) => sum + value, 0) / activeValues.length;
}

function groupCount<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((groups, item) => {
    const key = getKey(item);
    groups[key] = (groups[key] ?? 0) + 1;
    return groups;
  }, {});
}

function buildPaperObservationStats(
  evaluations: Array<{
    evaluationKind: PaperEvaluationKind;
    evaluationStatus: PaperEvaluationStatus;
    outcome: PaperEvaluationOutcome | null;
    returnAfter1d: number | null;
  }>
) {
  const observations = evaluations.filter(
    (evaluation) => evaluation.evaluationKind === PaperEvaluationKind.OBSERVATION
  );
  const evaluated = observations.filter(
    (evaluation) => evaluation.evaluationStatus === PaperEvaluationStatus.EVALUATED
  );

  return {
    total: observations.length,
    evaluatedCount: evaluated.length,
    positiveMovementCount: evaluated.filter((evaluation) => evaluation.outcome === PaperEvaluationOutcome.POSITIVE)
      .length,
    neutralCount: evaluated.filter((evaluation) => evaluation.outcome === PaperEvaluationOutcome.NEUTRAL)
      .length,
    negativeCount: evaluated.filter((evaluation) => evaluation.outcome === PaperEvaluationOutcome.NEGATIVE)
      .length,
    avgAbsReturnAfter1d: average(
      evaluated.map((evaluation) =>
        typeof evaluation.returnAfter1d === "number" ? Math.abs(evaluation.returnAfter1d) : null
      )
    )
  };
}

async function loadPerformanceEvaluations(input: {
  symbol?: string;
  assetType?: AssetType;
  timeframe?: string;
  from?: Date;
  to?: Date;
}) {
  const evaluations = await database.paperSignalEvaluation.findMany({
    where: {
      symbol: input.symbol,
      timeframe: input.timeframe,
      openedAt:
        input.from || input.to
          ? {
              gte: input.from,
              lte: input.to
            }
          : undefined,
      signal: input.assetType
        ? {
            asset: {
              assetType: input.assetType
            }
          }
        : undefined
    }
  });

  return evaluations.map((evaluation) => ({
    symbol: evaluation.symbol,
    timeframe: evaluation.timeframe,
    status: evaluation.status,
    signalType: evaluation.signalType,
    score: evaluation.score,
    riskLevel: evaluation.riskLevel,
    evaluationKind: evaluation.evaluationKind,
    skipReason: evaluation.skipReason,
    evaluationStatus: evaluation.evaluationStatus,
    outcome: evaluation.outcome,
    returnAfter1h: evaluation.returnAfter1h,
    returnAfter4h: evaluation.returnAfter4h,
    returnAfter1d: evaluation.returnAfter1d,
    returnAfter3d: evaluation.returnAfter3d,
    maxFavorableMove: evaluation.maxFavorableMove,
    maxAdverseMove: evaluation.maxAdverseMove
  }));
}

async function loadDataQualityReport(input: { assetType?: AssetType; symbol?: string }) {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const eventWindowFrom = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const eventWindowTo = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const assets = await database.asset.findMany({
    where: {
      assetType: input.assetType,
      symbol: input.symbol
    },
    orderBy: {
      symbol: "asc"
    },
    select: assetSelect
  });
  const assetIds = assets.map((asset) => asset.id);
  const assetSymbols = assets.map((asset) => asset.symbol);
  const assetWhere =
    assetIds.length > 0
      ? {
          assetId: {
            in: assetIds
          }
        }
      : { assetId: { in: [] as string[] } };
  const [
    candleGroups,
    signalGroups,
    recentSignalGroups,
    evaluationGroups,
    skippedReasonGroups,
    eventCoverageRows,
    alertStates,
    alerts,
    totalSignals,
    signalsLast24h,
    signalsWithoutEvaluation,
    totalEvaluations,
    latestMarketRegimeSnapshot,
    latestBacktestRun
  ] = await Promise.all([
    database.candle.groupBy({
      by: ["assetId", "timeframe"],
      where: assetWhere,
      _count: { _all: true },
      _max: { closeTime: true }
    }),
    database.signal.groupBy({
      by: ["assetId", "timeframe"],
      where: assetWhere,
      _count: { _all: true },
      _max: { createdAt: true }
    }),
    database.signal.groupBy({
      by: ["assetId"],
      where: {
        ...assetWhere,
        createdAt: {
          gte: since
        }
      },
      _count: { _all: true }
    }),
    database.paperSignalEvaluation.groupBy({
      by: ["assetId", "evaluationStatus"],
      where: assetWhere,
      _count: { _all: true }
    }),
    database.paperSignalEvaluation.groupBy({
      by: ["skipReason"],
      where: {
        ...assetWhere,
        evaluationStatus: PaperEvaluationStatus.SKIPPED
      },
      _count: { _all: true }
    }),
    database.event.findMany({
      where: {
        eventDate: {
          gte: eventWindowFrom,
          lte: eventWindowTo
        },
        OR: [
          { assetId: { in: assetIds } },
          { symbol: { in: assetSymbols } }
        ]
      },
      select: {
        assetId: true,
        symbol: true
      }
    }),
    database.alertState.findMany({
      where: assetWhere,
      select: {
        assetId: true
      }
    }),
    database.alert.findMany({
      where: {
        signal: assetWhere
      },
      select: {
        status: true,
        signal: {
          select: {
            assetId: true
          }
        }
      }
    }),
    database.signal.count({ where: assetWhere }),
    database.signal.count({
      where: {
        ...assetWhere,
        createdAt: {
          gte: since
        }
      }
    }),
    database.signal.count({
      where: {
        ...assetWhere,
        paperEvaluation: {
          is: null
        }
      }
    }),
    database.paperSignalEvaluation.count({ where: assetWhere }),
    database.marketRegimeSnapshot.findFirst({ orderBy: { generatedAt: "desc" } }),
    database.backtestRun.findFirst({ orderBy: { startedAt: "desc" } })
  ]);

  const signalCountsByAsset = new Map<string, number>();
  const recentSignalCountsByAsset = new Map<string, number>();
  const evaluationCountsByAsset = new Map<string, number>();
  const skippedEvaluationCountsByAsset = new Map<string, number>();
  const alertCountsByAsset = new Map<string, number>();
  const successfulAlertCountsByAsset = new Map<string, number>();
  const alertStateCountsByAsset = new Map<string, number>();
  const candleCountsByAsset = new Map<string, Record<string, number>>();
  const latestCandleByAsset = new Map<string, Record<string, Date | null>>();
  const latestSignalByAsset = new Map<string, Record<string, Date | null>>();
  const eventCoverageByAsset = new Set<string>();
  const assetIdBySymbol = new Map(assets.map((asset) => [asset.symbol, asset.id]));

  for (const group of candleGroups) {
    const counts = candleCountsByAsset.get(group.assetId) ?? {};
    counts[group.timeframe] = group._count._all;
    candleCountsByAsset.set(group.assetId, counts);

    const latest = latestCandleByAsset.get(group.assetId) ?? {};
    latest[group.timeframe] = group._max.closeTime;
    latestCandleByAsset.set(group.assetId, latest);
  }

  for (const group of signalGroups) {
    signalCountsByAsset.set(group.assetId, (signalCountsByAsset.get(group.assetId) ?? 0) + group._count._all);
    const latest = latestSignalByAsset.get(group.assetId) ?? {};
    latest[group.timeframe] = group._max.createdAt;
    latestSignalByAsset.set(group.assetId, latest);
  }

  for (const group of recentSignalGroups) {
    recentSignalCountsByAsset.set(group.assetId, group._count._all);
  }

  for (const group of evaluationGroups) {
    evaluationCountsByAsset.set(group.assetId, (evaluationCountsByAsset.get(group.assetId) ?? 0) + group._count._all);

    if (group.evaluationStatus === PaperEvaluationStatus.SKIPPED) {
      skippedEvaluationCountsByAsset.set(group.assetId, group._count._all);
    }
  }

  for (const alertState of alertStates) {
    alertStateCountsByAsset.set(alertState.assetId, (alertStateCountsByAsset.get(alertState.assetId) ?? 0) + 1);
  }

  for (const alert of alerts) {
    const assetId = alert.signal?.assetId;

    if (!assetId) {
      continue;
    }

    alertCountsByAsset.set(assetId, (alertCountsByAsset.get(assetId) ?? 0) + 1);

    if (alert.status === AlertStatus.SENT) {
      successfulAlertCountsByAsset.set(assetId, (successfulAlertCountsByAsset.get(assetId) ?? 0) + 1);
    }
  }

  for (const event of eventCoverageRows) {
    if (event.assetId) {
      eventCoverageByAsset.add(event.assetId);
      continue;
    }

    if (event.symbol) {
      const assetId = assetIdBySymbol.get(event.symbol);
      if (assetId) eventCoverageByAsset.add(assetId);
    }
  }

  const skippedByReason = Object.fromEntries(
    skippedReasonGroups.map((group) => [group.skipReason ?? "Unspecified", group._count._all])
  );
  const openEvaluationCount = evaluationGroups
    .filter((group) => group.evaluationStatus === PaperEvaluationStatus.OPEN)
    .reduce((sum, group) => sum + group._count._all, 0);
  const evaluatedEvaluationCount = evaluationGroups
    .filter((group) => group.evaluationStatus === PaperEvaluationStatus.EVALUATED)
    .reduce((sum, group) => sum + group._count._all, 0);
  const skippedEvaluationCount = evaluationGroups
    .filter((group) => group.evaluationStatus === PaperEvaluationStatus.SKIPPED)
    .reduce((sum, group) => sum + group._count._all, 0);

  const report = buildDataQualityReport({
    assets: assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      assetType: asset.assetType,
      isActive: asset.isActive,
      candleCountsByTimeframe: candleCountsByAsset.get(asset.id),
      latestCandleByTimeframe: latestCandleByAsset.get(asset.id),
      latestSignalByTimeframe: latestSignalByAsset.get(asset.id),
      signalCount: signalCountsByAsset.get(asset.id) ?? 0,
      recentSignalCount: recentSignalCountsByAsset.get(asset.id) ?? 0,
      evaluationCount: evaluationCountsByAsset.get(asset.id) ?? 0,
      skippedEvaluationCount: skippedEvaluationCountsByAsset.get(asset.id) ?? 0,
      alertCount: alertCountsByAsset.get(asset.id) ?? 0,
      successfulAlertCount: successfulAlertCountsByAsset.get(asset.id) ?? 0,
      alertStateCount: alertStateCountsByAsset.get(asset.id) ?? 0,
      hasEventsInWindow: eventCoverageByAsset.has(asset.id)
    })),
    totalSignals,
    signalsLast24h,
    signalsWithoutEvaluation,
    totalEvaluations,
    openEvaluationCount,
    evaluatedEvaluationCount,
    skippedEvaluationCount,
    skippedByReason,
    alertStateCount: alertStates.length,
    successfulAlertCount: alerts.filter((alert) => alert.status === AlertStatus.SENT).length,
    alertCount: alerts.length
  });
  const marketRegimeWarnings = buildMarketRegimeCoverageWarnings(
    assets,
    candleCountsByAsset,
    latestMarketRegimeSnapshot?.generatedAt ?? null,
    now
  );
  const backtestWarnings = buildBacktestCoverageWarnings(latestBacktestRun?.startedAt ?? null, now);

  return {
    ...report,
    warnings: [...report.warnings, ...marketRegimeWarnings, ...backtestWarnings]
  };
}

function buildMarketRegimeCoverageWarnings(
  assets: Array<{ symbol: string; id: string }>,
  candleCountsByAsset: Map<string, Record<string, number>>,
  latestGeneratedAt: Date | null,
  now: Date
) {
  const assetIdBySymbol = new Map(assets.map((asset) => [asset.symbol, asset.id]));
  const warnings: string[] = [];

  for (const symbol of ["SPY", "QQQ", "IWM", "BTCUSDT", "ETHUSDT"]) {
    const assetId = assetIdBySymbol.get(symbol);
    if (!assetId || (candleCountsByAsset.get(assetId)?.["1d"] ?? 0) < 200) {
      warnings.push(`Market Regime Benchmark ${symbol} hat weniger als 200 1d Candles.`);
    }
  }

  if (!latestGeneratedAt) {
    warnings.push("MarketRegimeSnapshot wurde noch nicht berechnet.");
  } else if (now.getTime() - latestGeneratedAt.getTime() > 2 * 60 * 60 * 1000) {
    warnings.push("MarketRegimeSnapshot ist aelter als 2 Stunden.");
  }

  return warnings;
}

function buildBacktestCoverageWarnings(latestStartedAt: Date | null, now: Date) {
  if (!latestStartedAt) {
    return ["BacktestRun wurde noch nicht berechnet."];
  }

  const maxAgeDays = 7;
  if (now.getTime() - latestStartedAt.getTime() > maxAgeDays * 24 * 60 * 60 * 1000) {
    return [`Letzter BacktestRun ist aelter als ${maxAgeDays} Tage.`];
  }

  return [];
}

function asQueryRecord(query: unknown): QueryRecord {
  return (query ?? {}) as QueryRecord;
}

function asBodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function parseLimit(
  value: QueryValue,
  defaultValue: number,
  maxValue: number,
  reply: FastifyReply
): number | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return defaultValue;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    badRequest(reply, `limit must be an integer between 1 and ${maxValue}`);
    return undefined;
  }

  return parsed;
}

function parseOffset(value: QueryValue, reply: FastifyReply): number | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return 0;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    badRequest(reply, "offset must be a non-negative integer");
    return undefined;
  }

  return parsed;
}

function parseBoolean(
  value: QueryValue,
  name: string,
  reply: FastifyReply
): boolean | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  badRequest(reply, `${name} must be true or false`);
  return undefined;
}

function parseOptionalNumber(
  value: QueryValue,
  name: string,
  reply: FastifyReply
): number | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    badRequest(reply, `${name} must be a non-negative number`);
    return undefined;
  }

  return parsed;
}

function parseOptionalInteger(
  value: QueryValue,
  name: string,
  reply: FastifyReply
): number | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    badRequest(reply, `${name} must be a non-negative integer`);
    return undefined;
  }

  return parsed;
}

function parseOptionalDate(value: QueryValue, name: string, reply: FastifyReply): Date | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return undefined;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    badRequest(reply, `${name} must be a valid ISO date`);
    return undefined;
  }

  return parsed;
}

function parseEnum<T extends string>(
  value: QueryValue,
  allowedValues: readonly T[],
  name: string,
  reply: FastifyReply
): T | undefined {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (allowedValues.includes(raw as T)) {
    return raw as T;
  }

  badRequest(reply, `${name} must be one of: ${allowedValues.join(", ")}`);
  return undefined;
}

function parseRequiredBodyString(
  value: unknown,
  name: string,
  reply: FastifyReply
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    badRequest(reply, `${name} is required`);
    return undefined;
  }

  return value.trim();
}

function parseOptionalNullableBodyString(
  value: unknown,
  name: string,
  reply: FastifyReply
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    badRequest(reply, `${name} must be a string`);
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalBodyBoolean(
  value: unknown,
  name: string,
  reply: FastifyReply
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    badRequest(reply, `${name} must be a boolean`);
    return undefined;
  }

  return value;
}

function parseOptionalBodyNumber(
  value: unknown,
  name: string,
  reply: FastifyReply
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    badRequest(reply, `${name} must be a non-negative number`);
    return undefined;
  }

  return value;
}

function parseOptionalBodyDate(
  value: unknown,
  name: string,
  reply: FastifyReply
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    badRequest(reply, `${name} must be a valid ISO date`);
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    badRequest(reply, `${name} must be a valid ISO date`);
    return undefined;
  }

  return parsed;
}

function parseOptionalBodyStringArray(
  value: unknown,
  name: string,
  reply: FastifyReply
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    badRequest(reply, `${name} must be an array of strings`);
    return undefined;
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function parseOptionalBodyEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  name: string,
  reply: FastifyReply
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && allowedValues.includes(value as T)) {
    return value as T;
  }

  badRequest(reply, `${name} must be one of: ${allowedValues.join(", ")}`);
  return undefined;
}

function parseOptionalString(value: QueryValue): string | undefined {
  const raw = firstQueryValue(value);
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function firstQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function badRequest(reply: FastifyReply, message: string) {
  reply.code(400).send({
    error: "Bad Request",
    message
  });
}

function conflict(reply: FastifyReply, message: string) {
  return reply.code(409).send({
    error: "Conflict",
    message
  });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({
    error: "Not Found",
    message
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRecordNotFoundError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
