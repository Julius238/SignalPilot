import {
  AlertChannel,
  AlertStatus,
  AssetType,
  BotRunStatus,
  Prisma,
  prisma,
  SignalDirection,
  SignalStatus,
  SignalType
} from "@signalpilot/database";
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

export async function registerDashboardRoutes(server: FastifyInstance) {
  server.get("/assets", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes, "assetType", reply);
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

    const [latestSignal, candleCounts] = await Promise.all([
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
      candleCounts: Object.fromEntries(
        candleCounts.map((count) => [count.timeframe, count._count._all])
      ),
      candles: includeCandles ? candles.reverse().map(toCandle) : undefined
    };
  });

  server.get("/signals", async (request, reply) => {
    const query = asQueryRecord(request.query);
    const assetType = parseEnum(query.assetType, assetTypes, "assetType", reply);
    const status = parseEnum(query.status, signalStatuses, "status", reply);
    const direction = parseEnum(query.direction, signalDirections, "direction", reply);
    const signalType = parseEnum(query.signalType, signalTypes, "signalType", reply);
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
    const status = parseEnum(query.status, botRunStatuses, "status", reply);
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
    const status = parseEnum(query.status, alertStatuses, "status", reply);
    const channel = parseEnum(query.channel, alertChannels, "channel", reply);
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
