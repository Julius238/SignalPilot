import {
  AlertChannel,
  AlertStatus,
  AssetType,
  BotRunStatus,
  Prisma,
  RiskLevel,
  prisma,
  SignalDirection,
  SignalStatus,
  SignalType
} from "@signalpilot/database";
import {
  calculateMultiTimeframeSummary,
  type MultiTimeframeSignalInput,
  type MultiTimeframeSummary
} from "@signalpilot/multi-timeframe";
import type { FastifyInstance, FastifyReply } from "fastify";

type QueryValue = string | string[] | undefined;
type QueryRecord = Record<string, QueryValue>;

const assetTypes = Object.values(AssetType);
const signalStatuses = Object.values(SignalStatus);
const signalDirections = Object.values(SignalDirection);
const signalTypes = Object.values(SignalType);
const botRunStatuses = Object.values(BotRunStatus);
const alertStatuses = Object.values(AlertStatus);
const alertChannels = Object.values(AlertChannel);
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
type MultiTimeframeScannerRow = {
  asset: Prisma.AssetGetPayload<{ select: typeof assetSelect }>;
  latestSignalsByTimeframe: Partial<Record<(typeof multiTimeframes)[number], ReturnType<typeof toCompactSignal>>>;
  multiTimeframeSummary: MultiTimeframeSummary;
};

export async function registerDashboardRoutes(server: FastifyInstance) {
  server.get("/assets", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const isActive = parseBoolean(query.isActive, "isActive", reply);
    const limit = parseLimit(query.limit, 100, 500, reply);

    if (reply.sent) {
      return reply;
    }

    const assets = await prisma.asset.findMany({
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

    const asset = await prisma.asset.findFirst({
      where: {
        symbol: symbol.toUpperCase()
      },
      select: assetSelect
    });

    if (!asset) {
      return notFound(reply, "Asset not found");
    }

    const [latestSignal, multiTimeframeSignals, candleCounts] = await Promise.all([
      prisma.signal.findFirst({
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
      prisma.candle.groupBy({
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
        ? await prisma.candle.findMany({
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

    const signals = await prisma.signal.findMany({
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
        output: true
      }
    });

    return signals.map(toSignalListItem);
  });

  server.get("/scanner", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes as AssetType[], "assetType", reply);
    const showOnlyAlertWorthy =
      parseBoolean(query.showOnlyAlertWorthy, "showOnlyAlertWorthy", reply) ?? false;
    const minScore = parseOptionalNumber(query.minScore, "minScore", reply);

    if (reply.sent) {
      return reply;
    }

    const timeframe = parseOptionalString(query.timeframe);
    const baseWhere: Prisma.SignalWhereInput = {
      timeframe,
      score: minScore === undefined ? undefined : { gte: minScore },
      asset: assetType
        ? {
            assetType
          }
        : undefined
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
      prisma.signal.count({
        where: scannerWhere({ status: SignalStatus.STRONG_WATCH })
      }),
      prisma.signal.count({
        where: scannerWhere({ status: SignalStatus.WATCH })
      }),
      prisma.alert.count({
        where: {
          status: AlertStatus.SENT,
          sentAt: {
            gte: today
          }
        }
      }),
      prisma.botRun.findFirst({
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

    const assets = await prisma.asset.findMany({
      where: {
        assetType,
        isActive: true
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
    const signal = await prisma.signal.findUnique({
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

    const candles = await prisma.candle.findMany({
      where: {
        assetId: signal.assetId,
        timeframe: signal.timeframe
      },
      orderBy: {
        openTime: "desc"
      },
      take: 250
    });

    return {
      signal: toSignalDetail(signal),
      asset: signal.asset,
      signalOutput: signal.output ? toSignalOutput(signal.output, true) : null,
      candles: candles.reverse().map(toCandle)
    };
  });

  server.get("/assets/:symbol/signals", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const query = asQueryRecord(request.query);
    const limit = parseLimit(query.limit, 50, 200, reply);

    if (reply.sent) {
      return reply;
    }

    const asset = await prisma.asset.findFirst({
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

    const signals = await prisma.signal.findMany({
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

    return prisma.botRun.findMany({
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

    return prisma.botLog.findMany({
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

    return prisma.alert.findMany({
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
  const signals = await prisma.signal.findMany({
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

async function findLatestMultiTimeframeSignalsForAsset(assetId: string) {
  const signals = await prisma.signal.findMany({
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
  const signals = await prisma.signal.findMany({
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

  const signals = await prisma.signal.findMany({
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

function asQueryRecord(query: unknown): QueryRecord {
  return (query ?? {}) as QueryRecord;
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

function parseOptionalString(value: QueryValue): string | undefined {
  const raw = firstQueryValue(value);
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function firstQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function badRequest(reply: FastifyReply, message: string) {
  reply.code(400).send({
    error: "Bad Request",
    message
  });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({
    error: "Not Found",
    message
  });
}
