import {
  AlertChannel,
  AlertStatus,
  AssetType,
  BotRunStatus,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  Prisma,
  RiskLevel,
  prisma,
  SignalDirection,
  SignalStatus,
  SignalType,
  WatchlistPriority
} from "@signalpilot/database";
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

type QueryValue = string | string[] | undefined;
type QueryRecord = Record<string, QueryValue>;

const assetTypes = Object.values(AssetType);
const signalStatuses = Object.values(SignalStatus);
const signalDirections = Object.values(SignalDirection);
const signalTypes = Object.values(SignalType);
const watchlistPriorities = Object.values(WatchlistPriority);
const botRunStatuses = Object.values(BotRunStatus);
const alertStatuses = Object.values(AlertStatus);
const alertChannels = Object.values(AlertChannel);
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

    return {
      alertMode: parsePublicAlertMode(process.env.ALERT_MODE),
      alertCooldownMinutes: parsePositiveNumberEnv(process.env.ALERT_COOLDOWN_MINUTES, 240),
      alertScoreImprovementThreshold: parsePositiveNumberEnv(
        process.env.ALERT_SCORE_IMPROVEMENT_THRESHOLD,
        8
      ),
      dashboardOrigin: process.env.DASHBOARD_ORIGIN,
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
          jobName: "runCryptoSignalPipeline"
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
