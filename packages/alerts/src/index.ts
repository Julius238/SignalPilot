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
  volumeScore?: number | null;
  riskLevel: string;
  createdAt: Date | string;
};

export type SignalAlertQualityContext = {
  closedCandle: boolean;
  freshData: boolean;
  patternConfirmed: boolean;
  volumeConfirmed: boolean;
  confirmingTimeframes: string[];
  newsEventContextFingerprint: string | null;
  materialRepeat: boolean;
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
  qualityContext?: SignalAlertQualityContext;
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

export type AlertQualityGateDecision = {
  allowed: boolean;
  reasons: string[];
};

export type AlertRepeatReason =
  | "NO_PREVIOUS_ALERT"
  | "SCORE_IMPROVED"
  | "SEVERITY_ESCALATED"
  | "TIMEFRAME_CONFIRMATION_ADDED"
  | "DIRECTION_CHANGED"
  | "NEWS_EVENT_CONTEXT_CHANGED"
  | "NO_MATERIAL_IMPROVEMENT";

export type AlertRepeatDecision = {
  shouldSend: boolean;
  reason: AlertRepeatReason;
  details: Record<string, unknown>;
};

export type SignalRepeatSnapshot = {
  status: string;
  direction: string;
  score: number;
  confirmingTimeframes: readonly string[];
  newsEventContextFingerprint: string | null;
};

export type RadarEventAlert = {
  id: string;
  symbol: string;
  assetType?: string | null;
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

// Gemeinsame Research-Alert-Taxonomie für alle n8n/Telegram Payloads.
// "radar_event" und "signal" bleiben als Legacy-Discriminator im Feld `type` erhalten.
export type ResearchAlertType =
  | "market_event"
  | "macro_event"
  | "geopolitical_event"
  | "chart_pattern"
  | "crypto_radar"
  | "equity_radar"
  | "commodity_radar"
  | "risk_warning"
  | "daily_summary"
  | "urgent_event";

export type ResearchAlertSeverity = "INFO" | "WATCH" | "IMPORTANT" | "CRITICAL";

export const researchAlertDisclaimer =
  "Keine Handlungsempfehlung. Research- und Beobachtungshinweis.";

export type MarketEventAlertInput = {
  id: string;
  alertType: Extract<
    ResearchAlertType,
    "market_event" | "macro_event" | "geopolitical_event" | "risk_warning" | "urgent_event"
  >;
  severity: ResearchAlertSeverity;
  title: string;
  summary: string;
  reasoning?: string | null;
  region?: string | null;
  affectedAssetClasses?: string[];
  affectedSectors?: string[];
  affectedSymbols?: string[];
  positiveImpact?: string[];
  negativeImpact?: string[];
  confidence?: number | null;
  timeframe?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  publishedAt?: Date | string | null;
  detectedAt?: Date | string | null;
};

export type MarketEventAlertPayload = {
  source: "signalpilot";
  type: "market_event";
  marketEventId: string;
  alertType: MarketEventAlertInput["alertType"];
  severity: ResearchAlertSeverity;
  title: string;
  whatHappened: string;
  whyRelevant: string | null;
  region: string | null;
  affectedAssetClasses: string[];
  affectedSectors: string[];
  affectedSymbols: string[];
  potentiallyPositive: string[];
  potentiallyNegative: string[];
  confidence: number | null;
  timeframe: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  detectedAt: string | null;
  telegramText: string;
  disclaimer: string;
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
  qualityContext?: SignalAlertQualityContext;
  dashboardUrl?: string;
  createdAt: string;
};

export type RadarEventAlertPayload = {
  source: "signalpilot";
  type: "radar_event";
  alertType: ResearchAlertType;
  symbol: string;
  eventType: RadarEventType;
  severity: RadarEventSeverity;
  timeframe: string;
  title: string;
  shortMessage: string;
  whatHappened: string;
  whyRelevant: string;
  potentiallyPositive: string[];
  potentiallyNegative: string[];
  confidence: number | null;
  sourceName: string;
  sourceUrl: string | null;
  telegramText: string;
  disclaimer: string;
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
const minimumInstantSignalScore = 75;
const minimumConfirmedVolumeScore = 75;

type DispatchAlertInput = {
  payload: unknown;
  signalId: string | null;
  logLabel: string;
  logMetadata: Record<string, unknown>;
};

async function dispatchAlertToN8n(
  input: DispatchAlertInput,
  options: SendSignalAlertToN8nOptions
): Promise<SendSignalAlertResult> {
  const database = options.database ?? prisma;
  const webhookUrl = options.webhookUrl ?? process.env.N8N_WEBHOOK_SIGNAL_URL;
  const alert = await database.alert.create({
    data: {
      signalId: input.signalId,
      channel: AlertChannel.WEBHOOK,
      status: AlertStatus.PENDING,
      payloadJson: input.payload as Prisma.InputJsonObject
    }
  });

  if (!webhookUrl) {
    const error = "missing N8N_WEBHOOK_SIGNAL_URL";
    await markAlertFailed(database, alert.id, error);
    await writeBotLog(database, "error", `Failed to dispatch ${input.logLabel} to n8n`, {
      alertId: alert.id,
      ...input.logMetadata,
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
        body: JSON.stringify(input.payload)
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
      await writeBotLog(database, "info", `Dispatched ${input.logLabel} to n8n`, {
        alertId: alert.id,
        ...input.logMetadata,
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
  await writeBotLog(database, "error", `Failed to dispatch ${input.logLabel} to n8n`, {
    alertId: alert.id,
    ...input.logMetadata,
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

async function recordBlockedAlert(
  input: DispatchAlertInput,
  options: SendSignalAlertToN8nOptions,
  gate: AlertQualityGateDecision
): Promise<SendSignalAlertResult> {
  const database = options.database ?? prisma;
  const error = `quality gate blocked: ${gate.reasons.join(", ")}`;
  const alert = await database.alert.create({
    data: {
      signalId: input.signalId,
      channel: AlertChannel.WEBHOOK,
      status: AlertStatus.FAILED,
      payloadJson: input.payload as Prisma.InputJsonObject,
      error
    }
  });

  await writeBotLog(database, "warn", `Blocked ${input.logLabel} before n8n dispatch`, {
    alertId: alert.id,
    ...input.logMetadata,
    qualityGateReasons: gate.reasons
  });

  return {
    alertId: alert.id,
    status: AlertStatus.FAILED,
    attempts: 0,
    error
  };
}

export async function sendSignalAlertToN8n(
  input: SendSignalAlertToN8nInput,
  options: SendSignalAlertToN8nOptions = {}
): Promise<SendSignalAlertResult> {
  const payload = buildPayload(input);
  const gate = evaluateSignalAlertQualityGate(input);

  if (!gate.allowed) {
    return recordBlockedAlert(
      {
        payload,
        signalId: input.signal.id,
        logLabel: "signal alert",
        logMetadata: {
          signalId: input.signal.id,
          symbol: input.signal.symbol,
          qualityGateReasons: gate.reasons
        }
      },
      options,
      gate
    );
  }

  return dispatchAlertToN8n(
    {
      payload,
      signalId: input.signal.id,
      logLabel: "signal alert",
      logMetadata: {
        signalId: input.signal.id,
        symbol: input.signal.symbol,
        alignment: payload.alignment,
        alignmentScore: payload.alignmentScore
      }
    },
    options
  );
}

export async function sendRadarEventAlertToN8n(
  input: SendRadarEventAlertToN8nInput,
  options: SendSignalAlertToN8nOptions = {}
): Promise<SendSignalAlertResult> {
  const payload = buildRadarEventPayload(input);
  const gate = evaluateRadarAlertQualityGate(input.radarEvent);

  if (!gate.allowed) {
    return recordBlockedAlert(
      {
        payload,
        signalId: null,
        logLabel: "radar event alert",
        logMetadata: {
          radarEventId: input.radarEvent.id,
          symbol: input.radarEvent.symbol,
          eventType: input.radarEvent.eventType,
          qualityGateReasons: gate.reasons
        }
      },
      options,
      gate
    );
  }

  return dispatchAlertToN8n(
    {
      payload,
      signalId: null,
      logLabel: "radar event alert",
      logMetadata: {
        radarEventId: input.radarEvent.id,
        symbol: input.radarEvent.symbol,
        eventType: input.radarEvent.eventType,
        severity: input.radarEvent.severity
      }
    },
    options
  );
}

export type SendMarketEventAlertToN8nInput = {
  marketEvent: MarketEventAlertInput;
  dashboardUrl?: string;
};

export async function sendMarketEventAlertToN8n(
  input: SendMarketEventAlertToN8nInput,
  options: SendSignalAlertToN8nOptions = {}
): Promise<SendSignalAlertResult> {
  const payload = buildMarketEventAlertPayload(input.marketEvent, input.dashboardUrl);

  return dispatchAlertToN8n(
    {
      payload,
      signalId: null,
      logLabel: "market event alert",
      logMetadata: {
        marketEventId: input.marketEvent.id,
        alertType: input.marketEvent.alertType,
        severity: input.marketEvent.severity,
        eventTitle: input.marketEvent.title
      }
    },
    options
  );
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
    qualityContext: input.qualityContext,
    dashboardUrl: input.dashboardUrl,
    createdAt:
      input.signal.createdAt instanceof Date
        ? input.signal.createdAt.toISOString()
        : input.signal.createdAt
  };
}

export function evaluateSignalAlertQualityGate(
  input: Pick<SendSignalAlertToN8nInput, "signal" | "signalOutput" | "qualityContext">
): AlertQualityGateDecision {
  const reasons: string[] = [];
  const signal = input.signal;
  const quality = input.qualityContext;

  if (!input.signalOutput.telegramText?.trim()) {
    reasons.push("EMPTY_TELEGRAM_TEXT");
  }

  if (signal.status === "WAIT") {
    reasons.push("WAIT_STATUS");
  }

  if (signal.status === "NO_EDGE") {
    reasons.push("NO_EDGE_STATUS");
  }

  if (signal.signalType === "NO_SIGNAL") {
    reasons.push("NO_SIGNAL_TYPE");
  }

  if (signal.direction !== "BULLISH" && signal.direction !== "BEARISH") {
    reasons.push("UNCLEAR_DIRECTION");
  }

  if (!Number.isFinite(signal.score) || signal.score < minimumInstantSignalScore) {
    reasons.push("SCORE_BELOW_75");
  }

  if (quality?.closedCandle !== true) {
    reasons.push("CANDLE_NOT_CONFIRMED_CLOSED");
  }

  if (quality?.freshData !== true) {
    reasons.push("STALE_OR_UNCONFIRMED_DATA");
  }

  if (signal.signalType === "BREAKOUT_ALERT" && quality?.patternConfirmed !== true) {
    reasons.push("UNCONFIRMED_PATTERN");
  }

  if (
    (signal.signalType === "BREAKOUT_ALERT" || signal.signalType === "VOLUME_SPIKE") &&
    (quality?.volumeConfirmed !== true ||
      !Number.isFinite(signal.volumeScore) ||
      (signal.volumeScore ?? 0) < minimumConfirmedVolumeScore)
  ) {
    reasons.push("MISSING_VOLUME_CONFIRMATION");
  }

  if (quality?.materialRepeat !== true) {
    reasons.push("NO_MATERIAL_REPEAT_IMPROVEMENT");
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

export function evaluateRadarAlertQualityGate(
  radarEvent: RadarEventAlert
): AlertQualityGateDecision {
  const reasons: string[] = [];
  const metadata = toRecord(radarEvent.metadataJson);
  const patternDirection = extractStringField(metadata, "patternDirection");
  const hasDirectionalMove =
    radarEvent.eventType === RadarEventType.MOVEMENT_SPIKE &&
    typeof radarEvent.movePercent === "number" &&
    radarEvent.movePercent !== 0;
  const hasDirectionalPattern =
    radarEvent.eventType === RadarEventType.MOMENTUM_SHIFT &&
    (patternDirection === "UP" || patternDirection === "DOWN");

  if (
    radarEvent.severity !== RadarEventSeverity.IMPORTANT &&
    radarEvent.severity !== RadarEventSeverity.CRITICAL
  ) {
    reasons.push("SEVERITY_BELOW_IMPORTANT");
  }

  if (typeof radarEvent.score !== "number" || radarEvent.score < minimumInstantSignalScore) {
    reasons.push("SCORE_BELOW_75");
  }

  if (!hasDirectionalMove && !hasDirectionalPattern) {
    reasons.push("UNCLEAR_DIRECTION");
  }

  if (
    radarEvent.eventType === RadarEventType.VOLUME_SPIKE ||
    radarEvent.eventType === RadarEventType.VOLATILITY_SPIKE
  ) {
    reasons.push("OBSERVATION_ONLY_TYPE");
  }

  if (
    radarEvent.eventType === RadarEventType.BREAKOUT_PROXIMITY ||
    radarEvent.eventType === RadarEventType.SR_PROXIMITY ||
    radarEvent.eventType === RadarEventType.CONFLUENCE
  ) {
    reasons.push("UNCONFIRMED_OR_NEUTRAL_PATTERN");
  }

  if (
    radarEvent.eventType === RadarEventType.MOMENTUM_SHIFT &&
    extractBooleanField(metadata, "patternConfirmed") !== true
  ) {
    reasons.push("UNCONFIRMED_PATTERN");
  }

  if (extractBooleanField(metadata, "watchlistAlertEnabled") !== true) {
    reasons.push("WATCHLIST_ALERT_NOT_ENABLED");
  }

  if (extractBooleanField(metadata, "closedCandle") !== true) {
    reasons.push("CANDLE_NOT_CONFIRMED_CLOSED");
  }

  if (extractBooleanField(metadata, "freshData") !== true) {
    reasons.push("STALE_OR_UNCONFIRMED_DATA");
  }

  if (extractBooleanField(metadata, "alertMaterialChange") !== true) {
    reasons.push("NO_MATERIAL_REPEAT_IMPROVEMENT");
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

export function evaluateSignalAlertRepeat(
  input: {
    current: SignalRepeatSnapshot;
    previous?: (SignalRepeatSnapshot & { sentAt: Date }) | null;
    now?: Date;
    cooldownMinutes: number;
    scoreImprovementThreshold?: number;
  }
): AlertRepeatDecision {
  const previous = input.previous ?? null;
  const threshold = Math.max(8, input.scoreImprovementThreshold ?? 8);

  if (!previous) {
    return {
      shouldSend: true,
      reason: "NO_PREVIOUS_ALERT",
      details: {
        score: input.current.score,
        direction: input.current.direction,
        confirmingTimeframes: [...input.current.confirmingTimeframes]
      }
    };
  }

  const scoreDelta = input.current.score - previous.score;

  if (scoreDelta >= threshold) {
    return {
      shouldSend: true,
      reason: "SCORE_IMPROVED",
      details: {
        previousScore: previous.score,
        currentScore: input.current.score,
        scoreDelta,
        threshold
      }
    };
  }

  if (signalSeverityRank(input.current.status) > signalSeverityRank(previous.status)) {
    return {
      shouldSend: true,
      reason: "SEVERITY_ESCALATED",
      details: {
        previousStatus: previous.status,
        currentStatus: input.current.status
      }
    };
  }

  if (
    isClearDirection(input.current.direction) &&
    isClearDirection(previous.direction) &&
    input.current.direction !== previous.direction
  ) {
    return {
      shouldSend: true,
      reason: "DIRECTION_CHANGED",
      details: {
        previousDirection: previous.direction,
        currentDirection: input.current.direction
      }
    };
  }

  const previousTimeframes = new Set(previous.confirmingTimeframes);
  const addedTimeframes = input.current.confirmingTimeframes.filter(
    (timeframe) => !previousTimeframes.has(timeframe)
  );

  if (addedTimeframes.length > 0) {
    return {
      shouldSend: true,
      reason: "TIMEFRAME_CONFIRMATION_ADDED",
      details: {
        previousConfirmingTimeframes: [...previous.confirmingTimeframes],
        currentConfirmingTimeframes: [...input.current.confirmingTimeframes],
        addedTimeframes
      }
    };
  }

  if (
    input.current.newsEventContextFingerprint !== null &&
    input.current.newsEventContextFingerprint !== previous.newsEventContextFingerprint
  ) {
    return {
      shouldSend: true,
      reason: "NEWS_EVENT_CONTEXT_CHANGED",
      details: {
        hadPreviousContext: previous.newsEventContextFingerprint !== null,
        hasCurrentContext: true
      }
    };
  }

  const now = input.now ?? new Date();
  const elapsedMinutes = (now.getTime() - previous.sentAt.getTime()) / 60_000;

  return {
    shouldSend: false,
    reason: "NO_MATERIAL_IMPROVEMENT",
    details: {
      elapsedMinutes,
      cooldownMinutes: input.cooldownMinutes,
      cooldownExpired: elapsedMinutes >= input.cooldownMinutes,
      previousScore: previous.score,
      currentScore: input.current.score,
      previousStatus: previous.status,
      currentStatus: input.current.status,
      previousDirection: previous.direction,
      currentDirection: input.current.direction,
      previousConfirmingTimeframes: [...previous.confirmingTimeframes],
      currentConfirmingTimeframes: [...input.current.confirmingTimeframes]
    }
  };
}

function signalSeverityRank(status: string): number {
  if (status === "STRONG_WATCH") {
    return 3;
  }

  if (status === "WATCH" || status === "AVOID") {
    return 2;
  }

  if (status === "WAIT") {
    return 1;
  }

  return 0;
}

function isClearDirection(direction: string): boolean {
  return direction === "BULLISH" || direction === "BEARISH";
}

const radarEventTypeLabels: Record<RadarEventType, string> = {
  MOVEMENT_SPIKE: "Auffällige Bewegung",
  VOLUME_SPIKE: "Volumenanstieg",
  VOLATILITY_SPIKE: "Erhöhte Volatilität",
  SCORE_CHANGE: "Score-Veränderung",
  REGIME_CHANGE: "Marktumfeld-Wechsel",
  BREAKOUT_PROXIMITY: "Möglicher Ausbruchsbereich",
  SR_PROXIMITY: "Support/Resistance-Nähe",
  MOMENTUM_SHIFT: "Momentum-Wechsel",
  CONFLUENCE: "Konfluenz mehrerer Faktoren"
};

const severityLabels: Record<ResearchAlertSeverity, string> = {
  INFO: "Nur Information",
  WATCH: "Beobachten",
  IMPORTANT: "Wichtig",
  CRITICAL: "Hochrelevant"
};

export function buildRadarEventPayload(input: SendRadarEventAlertToN8nInput): RadarEventAlertPayload {
  const radarEvent = input.radarEvent;
  const createdAt =
    radarEvent.createdAt instanceof Date ? radarEvent.createdAt.toISOString() : radarEvent.createdAt;
  const eventLabel = radarEventTypeLabels[radarEvent.eventType] ?? "Beobachtung";
  const title = `${radarEvent.symbol} · ${eventLabel} (${radarEvent.timeframe})`;
  const whyRelevant = buildRadarWhyRelevant(radarEvent);
  const confidence = confidenceFromScore(radarEvent.score);
  const sourceName = radarAlertSourceName(radarEvent.assetType);
  const alertType = radarAlertType(radarEvent.assetType);
  const telegramText = buildRadarTelegramText({
    title,
    severity: radarEvent.severity,
    whatHappened: radarEvent.shortMessage,
    whyRelevant,
    confidence,
    sourceName,
    dashboardUrl: input.dashboardUrl
  });

  return {
    source: "signalpilot",
    type: "radar_event",
    alertType,
    symbol: radarEvent.symbol,
    eventType: radarEvent.eventType,
    severity: radarEvent.severity,
    timeframe: radarEvent.timeframe,
    title,
    shortMessage: radarEvent.shortMessage,
    whatHappened: radarEvent.shortMessage,
    whyRelevant,
    // Impact-Zuordnung folgt erst mit der Impact Engine — bis dahin bewusst leer
    // statt spekulativ befüllt.
    potentiallyPositive: [],
    potentiallyNegative: [],
    confidence,
    sourceName,
    sourceUrl: null,
    telegramText,
    disclaimer: researchAlertDisclaimer,
    context: {
      wording: "Beobachtung, keine Handlungsempfehlung",
      marketContext: "Marktbewegung",
      riskContext: "Risiko/Kontext prüfen",
      score: radarEvent.score,
      movePercent: radarEvent.movePercent,
      relativeVolume: radarEvent.relativeVolume,
      rangePercent: radarEvent.rangePercent,
      metadataJson: radarEvent.metadataJson,
      createdAt
    },
    dashboardUrl: input.dashboardUrl
  };
}

export function buildMarketEventAlertPayload(
  input: MarketEventAlertInput,
  dashboardUrl?: string
): MarketEventAlertPayload {
  const whyRelevant = trimToNull(input.reasoning);
  const confidence = clampConfidence(input.confidence);
  const telegramText = buildMarketEventTelegramText(input, whyRelevant, confidence, dashboardUrl);

  return {
    source: "signalpilot",
    type: "market_event",
    marketEventId: input.id,
    alertType: input.alertType,
    severity: input.severity,
    title: input.title,
    whatHappened: input.summary,
    whyRelevant,
    region: trimToNull(input.region),
    affectedAssetClasses: input.affectedAssetClasses ?? [],
    affectedSectors: input.affectedSectors ?? [],
    affectedSymbols: input.affectedSymbols ?? [],
    potentiallyPositive: input.positiveImpact ?? [],
    potentiallyNegative: input.negativeImpact ?? [],
    confidence,
    timeframe: trimToNull(input.timeframe),
    sourceName: trimToNull(input.sourceName),
    sourceUrl: trimToNull(input.sourceUrl),
    publishedAt: toIsoOrNull(input.publishedAt),
    detectedAt: toIsoOrNull(input.detectedAt),
    telegramText,
    disclaimer: researchAlertDisclaimer,
    dashboardUrl
  };
}

function buildRadarWhyRelevant(radarEvent: RadarEventAlert): string {
  const parts: string[] = [];

  if (typeof radarEvent.movePercent === "number") {
    parts.push(`Bewegung ${formatSignedPercent(radarEvent.movePercent)}`);
  }

  if (typeof radarEvent.relativeVolume === "number") {
    parts.push(`Volumen ${radarEvent.relativeVolume}x des Durchschnitts`);
  }

  if (typeof radarEvent.rangePercent === "number") {
    parts.push(`Range ${radarEvent.rangePercent}%`);
  }

  const metrics = parts.length > 0 ? parts.join(" · ") : "Marktbewegung außerhalb der üblichen Spanne";
  return `${metrics} im ${radarEvent.timeframe} Zeitfenster. Einstufung: ${severityLabels[radarEvent.severity]}.`;
}

function buildRadarTelegramText(input: {
  title: string;
  severity: RadarEventSeverity;
  whatHappened: string;
  whyRelevant: string;
  confidence: number | null;
  sourceName: string;
  dashboardUrl?: string;
}): string {
  const lines = [
    `🔭 SignalPilot Radar · ${input.title}`,
    `Priorität: ${severityLabels[input.severity]}`,
    "",
    `Was ist passiert? ${input.whatHappened}`,
    `Warum relevant? ${input.whyRelevant}`
  ];

  if (input.confidence !== null) {
    lines.push(`Confidence: ${Math.round(input.confidence * 100)}%`);
  }

  lines.push(`Quelle: ${input.sourceName}`);

  if (input.dashboardUrl) {
    lines.push(`Dashboard: ${input.dashboardUrl}`);
  }

  lines.push("", `Hinweis: ${researchAlertDisclaimer}`);
  return lines.join("\n");
}

function buildMarketEventTelegramText(
  input: MarketEventAlertInput,
  whyRelevant: string | null,
  confidence: number | null,
  dashboardUrl?: string
): string {
  const lines = [
    `🌍 SignalPilot Event · ${input.title}`,
    `Priorität: ${severityLabels[input.severity]}${input.region ? ` · Region: ${input.region}` : ""}`,
    "",
    `Was ist passiert? ${input.summary}`
  ];

  if (whyRelevant) {
    lines.push(`Warum relevant? ${whyRelevant}`);
  }

  if ((input.positiveImpact ?? []).length > 0) {
    lines.push(`Potenziell positiv: ${(input.positiveImpact ?? []).join(", ")}`);
  }

  if ((input.negativeImpact ?? []).length > 0) {
    lines.push(`Potenziell negativ: ${(input.negativeImpact ?? []).join(", ")}`);
  }

  if (confidence !== null) {
    lines.push(`Confidence: ${Math.round(confidence * 100)}%`);
  }

  if (input.sourceName) {
    lines.push(`Quelle: ${input.sourceName}${input.sourceUrl ? ` (${input.sourceUrl})` : ""}`);
  }

  if (dashboardUrl) {
    lines.push(`Dashboard: ${dashboardUrl}`);
  }

  lines.push("", `Hinweis: ${researchAlertDisclaimer}`);
  return lines.join("\n");
}

function radarAlertType(assetType: string | null | undefined): ResearchAlertType {
  if (assetType === "STOCK" || assetType === "ETF") {
    return "equity_radar";
  }

  return "crypto_radar";
}

function radarAlertSourceName(assetType: string | null | undefined): string {
  if (assetType === "STOCK" || assetType === "ETF") {
    return "SignalPilot Quick Radar (Finnhub Marktdaten)";
  }

  return "SignalPilot Quick Radar (Binance Marktdaten)";
}

function confidenceFromScore(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }

  return clampConfidence(score / 100);
}

function clampConfidence(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
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

function extractBooleanField(source: unknown, field: string): boolean | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  const value = source[field];
  return typeof value === "boolean" ? value : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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
