import {
  AlertChannel,
  AlertStatus,
  Prisma,
  RadarEventSeverity,
  RadarEventType,
  prisma,
  type PrismaClient
} from "@signalpilot/database";

export type AlertSignal = {
  id: string;
  symbol: string;
  asset?: {
    assetType: string;
  } | null;
  assetType?: string;
  timeframe: string;
  status: string;
  direction: string;
  signalType: string;
  score: number;
  riskLevel: string;
  createdAt: Date | string;
};

export type AlertSignalOutput = {
  shortConclusion: string;
  telegramText: string;
  dashboardJson: unknown;
  multiTimeframeSummary?: unknown;
};

export type SendSignalAlertToN8nInput = {
  signal: AlertSignal;
  signalOutput: AlertSignalOutput;
  dashboardUrl?: string;
};

export type SendSignalAlertToN8nOptions = {
  database?: PrismaClient;
  fetchClient?: typeof fetch;
  webhookUrl?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type SendSignalAlertResult = {
  alertId: string;
  status: AlertStatus;
  attempts: number;
  error?: string;
};

export type RadarEventAlert = {
  id: string;
  symbol: string;
  eventType: RadarEventType;
  severity: RadarEventSeverity;
  timeframe: string;
  shortMessage: string;
  score?: number | null;
  movePercent?: number | null;
  relativeVolume?: number | null;
  rangePercent?: number | null;
  metadataJson?: unknown;
  createdAt: Date | string;
};

export type SendRadarEventAlertToN8nInput = {
  radarEvent: RadarEventAlert;
  dashboardUrl?: string;
};

type AlertPayload = {
  signalId: string;
  symbol: string;
  assetType: string | null;
  timeframe: string;
  status: string;
  direction: string;
  signalType: string;
  score: number;
  riskLevel: string;
  shortConclusion: string;
  telegramText: string;
  dashboardJson: unknown;
  multiTimeframeSummary?: unknown;
  alignment?: string;
  alignmentScore?: number;
  dashboardUrl?: string;
  createdAt: string;
};

type RadarEventAlertPayload = {
  source: "signalpilot";
  type: "radar_event";
  symbol: string;
  eventType: RadarEventType;
  severity: RadarEventSeverity;
  timeframe: string;
  shortMessage: string;
  context: {
    wording: "Beobachtung, keine Handlungsempfehlung";
    marketContext: "Marktbewegung";
    riskContext: "Risiko/Kontext prüfen";
    score?: number | null;
    movePercent?: number | null;
    relativeVolume?: number | null;
    rangePercent?: number | null;
    metadataJson?: unknown;
    createdAt: string;
  };
  dashboardUrl?: string;
};

const defaultMaxAttempts = 3;
const defaultRetryDelayMs = 500;

export async function sendSignalAlertToN8n(
  input: SendSignalAlertToN8nInput,
  options: SendSignalAlertToN8nOptions = {}
): Promise<SendSignalAlertResult> {
  const database = options.database ?? prisma;
  const webhookUrl = options.webhookUrl ?? process.env.N8N_WEBHOOK_SIGNAL_URL;
  const payload = buildPayload(input);
  const alert = await database.alert.create({
    data: {
      signalId: input.signal.id,
      channel: AlertChannel.WEBHOOK,
      status: AlertStatus.PENDING,
      payloadJson: payload as Prisma.InputJsonObject
    }
  });

  if (!webhookUrl) {
    const error = "missing N8N_WEBHOOK_SIGNAL_URL";
    await markAlertFailed(database, alert.id, error);
    await writeBotLog(database, "error", "Failed to dispatch signal alert to n8n", {
      alertId: alert.id,
      signalId: input.signal.id,
      symbol: input.signal.symbol,
      error
    });

    return {
      alertId: alert.id,
      status: AlertStatus.FAILED,
      attempts: 0,
      error
    };
  }

  const fetchClient = options.fetchClient ?? fetch;
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  let lastError = "unknown n8n webhook error";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchClient(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`n8n webhook failed with HTTP ${response.status}`);
      }

      await database.alert.update({
        where: {
          id: alert.id
        },
        data: {
          status: AlertStatus.SENT,
          sentAt: new Date(),
          error: null
        }
      });
      await writeBotLog(database, "info", "Dispatched signal alert to n8n", {
        alertId: alert.id,
        signalId: input.signal.id,
        symbol: input.signal.symbol,
        alignment: payload.alignment,
        alignmentScore: payload.alignmentScore,
        attempts: attempt
      });

      return {
        alertId: alert.id,
        status: AlertStatus.SENT,
        attempts: attempt
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown n8n webhook error";

      if (attempt < maxAttempts) {
        await delay(retryDelayMs);
      }
    }
  }

  await markAlertFailed(database, alert.id, lastError);
  await writeBotLog(database, "error", "Failed to dispatch signal alert to n8n", {
    alertId: alert.id,
    signalId: input.signal.id,
    symbol: input.signal.symbol,
    attempts: maxAttempts,
    error: lastError
  });

  return {
    alertId: alert.id,
    status: AlertStatus.FAILED,
    attempts: maxAttempts,
    error: lastError
  };
}

export async function sendRadarEventAlertToN8n(
  input: SendRadarEventAlertToN8nInput,
  options: SendSignalAlertToN8nOptions = {}
): Promise<SendSignalAlertResult> {
  const database = options.database ?? prisma;
  const webhookUrl = options.webhookUrl ?? process.env.N8N_WEBHOOK_SIGNAL_URL;
  const payload = buildRadarEventPayload(input);
  const alert = await database.alert.create({
    data: {
      signalId: null,
      channel: AlertChannel.WEBHOOK,
      status: AlertStatus.PENDING,
      payloadJson: payload as Prisma.InputJsonObject
    }
  });

  if (!webhookUrl) {
    const error = "missing N8N_WEBHOOK_SIGNAL_URL";
    await markAlertFailed(database, alert.id, error);
    await writeBotLog(database, "error", "Failed to dispatch radar event alert to n8n", {
      alertId: alert.id,
      radarEventId: input.radarEvent.id,
      symbol: input.radarEvent.symbol,
      eventType: input.radarEvent.eventType,
      error
    });

    return {
      alertId: alert.id,
      status: AlertStatus.FAILED,
      attempts: 0,
      error
    };
  }

  const fetchClient = options.fetchClient ?? fetch;
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  let lastError = "unknown n8n webhook error";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchClient(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`n8n webhook failed with HTTP ${response.status}`);
      }

      await database.alert.update({
        where: {
          id: alert.id
        },
        data: {
          status: AlertStatus.SENT,
          sentAt: new Date(),
          error: null
        }
      });
      await writeBotLog(database, "info", "Dispatched radar event alert to n8n", {
        alertId: alert.id,
        radarEventId: input.radarEvent.id,
        symbol: input.radarEvent.symbol,
        eventType: input.radarEvent.eventType,
        severity: input.radarEvent.severity,
        attempts: attempt
      });

      return {
        alertId: alert.id,
        status: AlertStatus.SENT,
        attempts: attempt
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown n8n webhook error";

      if (attempt < maxAttempts) {
        await delay(retryDelayMs);
      }
    }
  }

  await markAlertFailed(database, alert.id, lastError);
  await writeBotLog(database, "error", "Failed to dispatch radar event alert to n8n", {
    alertId: alert.id,
    radarEventId: input.radarEvent.id,
    symbol: input.radarEvent.symbol,
    eventType: input.radarEvent.eventType,
    severity: input.radarEvent.severity,
    attempts: maxAttempts,
    error: lastError
  });

  return {
    alertId: alert.id,
    status: AlertStatus.FAILED,
    attempts: maxAttempts,
    error: lastError
  };
}

function buildPayload(input: SendSignalAlertToN8nInput): AlertPayload {
  const multiTimeframeSummary = extractMultiTimeframeSummary(input.signalOutput);
  const alignment = extractStringField(multiTimeframeSummary, "alignment");
  const alignmentScore = extractNumberField(multiTimeframeSummary, "alignmentScore");

  return {
    signalId: input.signal.id,
    symbol: input.signal.symbol,
    assetType: input.signal.asset?.assetType ?? input.signal.assetType ?? null,
    timeframe: input.signal.timeframe,
    status: input.signal.status,
    direction: input.signal.direction,
    signalType: input.signal.signalType,
    score: input.signal.score,
    riskLevel: input.signal.riskLevel,
    shortConclusion: input.signalOutput.shortConclusion,
    telegramText: input.signalOutput.telegramText,
    dashboardJson: input.signalOutput.dashboardJson,
    multiTimeframeSummary,
    alignment,
    alignmentScore,
    dashboardUrl: input.dashboardUrl,
    createdAt:
      input.signal.createdAt instanceof Date
        ? input.signal.createdAt.toISOString()
        : input.signal.createdAt
  };
}

function buildRadarEventPayload(input: SendRadarEventAlertToN8nInput): RadarEventAlertPayload {
  const createdAt =
    input.radarEvent.createdAt instanceof Date
      ? input.radarEvent.createdAt.toISOString()
      : input.radarEvent.createdAt;

  return {
    source: "signalpilot",
    type: "radar_event",
    symbol: input.radarEvent.symbol,
    eventType: input.radarEvent.eventType,
    severity: input.radarEvent.severity,
    timeframe: input.radarEvent.timeframe,
    shortMessage: input.radarEvent.shortMessage,
    context: {
      wording: "Beobachtung, keine Handlungsempfehlung",
      marketContext: "Marktbewegung",
      riskContext: "Risiko/Kontext prüfen",
      score: input.radarEvent.score,
      movePercent: input.radarEvent.movePercent,
      relativeVolume: input.radarEvent.relativeVolume,
      rangePercent: input.radarEvent.rangePercent,
      metadataJson: input.radarEvent.metadataJson,
      createdAt
    },
    dashboardUrl: input.dashboardUrl
  };
}

function extractMultiTimeframeSummary(signalOutput: AlertSignalOutput): unknown {
  if (signalOutput.multiTimeframeSummary) {
    return signalOutput.multiTimeframeSummary;
  }

  if (isRecord(signalOutput.dashboardJson)) {
    return signalOutput.dashboardJson.multiTimeframeSummary;
  }

  return undefined;
}

function extractStringField(source: unknown, field: string): string | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  const value = source[field];
  return typeof value === "string" ? value : undefined;
}

function extractNumberField(source: unknown, field: string): number | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  const value = source[field];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function markAlertFailed(database: PrismaClient, alertId: string, error: string) {
  await database.alert.update({
    where: {
      id: alertId
    },
    data: {
      status: AlertStatus.FAILED,
      error
    }
  });
}

async function writeBotLog(
  database: PrismaClient,
  level: string,
  message: string,
  metadataJson?: Prisma.InputJsonValue
) {
  await database.botLog.create({
    data: {
      level,
      service: "alerts",
      message,
      metadataJson
    }
  });
}

function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
