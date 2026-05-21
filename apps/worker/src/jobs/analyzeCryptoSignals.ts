import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sendSignalAlertToN8n } from "@signalpilot/alerts";
import {
  AlertStatus,
  AssetType,
  BotRunStatus,
  Prisma,
  prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType,
  WatchlistPriority,
  type PrismaClient
} from "@signalpilot/database";
import { buildIndicatorSnapshot, type IndicatorCandle } from "@signalpilot/indicators";
import { supportedBinanceIntervals } from "@signalpilot/market-data";
import {
  calculateMultiTimeframeSummary,
  type MultiTimeframeSignalInput,
  type MultiTimeframeSummary
} from "@signalpilot/multi-timeframe";
import {
  buildSignalRegimeContext,
  type MarketRegimeReport,
  type SignalRegimeContext
} from "@signalpilot/market-regime";
import { composeSignalOutput } from "@signalpilot/output-composer";
import { scoreSignal } from "@signalpilot/scoring-engine";
import type { AssetClass, IntelligenceContext, SignalDecision } from "@signalpilot/shared";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const candleLimit = 250;
const minimumUsefulCandles = 20;
const multiTimeframeIntervals = ["1h", "4h", "1d"] as const;
const alertModes = ["ALL_ASSETS", "WATCHLIST_ONLY", "HIGH_PRIORITY_ONLY"] as const;
const defaultAlertCooldownMinutes = 240;
const defaultAlertScoreImprovementThreshold = 8;
const alignmentImprovementThreshold = 10;
const cooldownSentReasons = [
  "NO_PREVIOUS_ALERT",
  "COOLDOWN_EXPIRED",
  "SCORE_IMPROVED",
  "STATUS_ESCALATED",
  "RISK_ESCALATED",
  "ALIGNMENT_IMPROVED"
] as const;

const neutralIntelligenceContext: IntelligenceContext = {
  newsSummary: "Keine relevante neue Meldung im Scan-Fenster gefunden.",
  socialSummary: "noch nicht aktiv verbunden.",
  eventSummary: "Keine Event-Daten in diesem Scan.",
  impactSummary: "Signal basiert primär auf technischen Daten.",
  sources: []
};

export type AnalyzeCryptoSignalsSummary = {
  status: BotRunStatus;
  analyzedCount: number;
  savedSignalCount: number;
  sentAlertCount: number;
  skippedAlertCount: number;
  alertMode: AlertMode;
  routedAlertCount: number;
  routeSkippedAlertCount: number;
  cooldownSkippedAlertCount: number;
  watchlistDisabledSkipCount: number;
  notOnWatchlistSkipCount: number;
  notHighPrioritySkipCount: number;
  alertErrorCount: number;
  errorCount: number;
};

export type AlertMode = (typeof alertModes)[number];

export type AlertRouteReason =
  | "ALL_ASSETS"
  | "WATCHLIST_ONLY_MATCH"
  | "HIGH_PRIORITY_MATCH"
  | "WATCHLIST_DISABLED"
  | "NOT_ON_WATCHLIST"
  | "NOT_HIGH_PRIORITY"
  | "INVALID_ALERT_MODE";

type AlertRouteWatchlistItem = {
  alertEnabled: boolean;
  priority: WatchlistPriority;
} | null;

type AlertRouteAsset = {
  id: string;
  symbol: string;
};

export type AlertRouteDecision = {
  shouldRoute: boolean;
  reason: AlertRouteReason;
};

export type AlertCooldownReason =
  | (typeof cooldownSentReasons)[number]
  | "COOLDOWN_ACTIVE";

export type AlertCooldownDecision = {
  shouldSend: boolean;
  reason: AlertCooldownReason;
  details: Record<string, unknown>;
};

type CooldownSignal = {
  id?: string | null;
  assetId: string;
  symbol: string;
  timeframe: string;
  signalType: SignalType;
  status: SignalStatus;
  direction: SignalDirection;
  score: number;
  riskLevel: RiskLevel;
};

type ExistingAlertState = {
  status: SignalStatus;
  lastScore: number;
  lastRiskLevel: RiskLevel;
  lastAlignment: string | null;
  lastAlignmentScore: number | null;
  lastSentAt: Date;
};

export async function analyzeCryptoSignals(
  database: PrismaClient = prisma
): Promise<AnalyzeCryptoSignalsSummary> {
  const alertModeConfig = parseAlertMode(process.env.ALERT_MODE);
  const alertCooldownMinutes = parsePositiveNumberEnv(
    process.env.ALERT_COOLDOWN_MINUTES,
    defaultAlertCooldownMinutes
  );
  const alertScoreImprovementThreshold = parsePositiveNumberEnv(
    process.env.ALERT_SCORE_IMPROVEMENT_THRESHOLD,
    defaultAlertScoreImprovementThreshold
  );
  const allowStatusEscalation = parseBooleanEnv(process.env.ALERT_ALLOW_STATUS_ESCALATION, true);
  const allowRiskEscalation = parseBooleanEnv(process.env.ALERT_ALLOW_RISK_ESCALATION, true);
  const botRun = await database.botRun.create({
    data: {
      jobName: "analyzeCryptoSignals",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        intervals: [...supportedBinanceIntervals],
        candleLimit,
        alertMode: alertModeConfig.alertMode,
        alertCooldownMinutes,
        alertScoreImprovementThreshold
      }
    }
  });

  let analyzedCount = 0;
  let savedSignalCount = 0;
  let sentAlertCount = 0;
  let skippedAlertCount = 0;
  let routedAlertCount = 0;
  let routeSkippedAlertCount = 0;
  let cooldownSkippedAlertCount = 0;
  const cooldownSentReasonCounts = createCooldownSentReasonCounts();
  let watchlistDisabledSkipCount = 0;
  let notOnWatchlistSkipCount = 0;
  let notHighPrioritySkipCount = 0;
  let alertErrorCount = 0;
  let insufficientDataCount = 0;
  let errorCount = 0;

  if (alertModeConfig.invalidValue) {
    await writeBotLog(database, "warn", "Invalid ALERT_MODE, falling back to ALL_ASSETS", {
      botRunId: botRun.id,
      invalidAlertMode: alertModeConfig.invalidValue,
      alertMode: alertModeConfig.alertMode
    });
  }

  await writeBotLog(database, "info", "analyzeCryptoSignals started", {
    botRunId: botRun.id,
    alertMode: alertModeConfig.alertMode
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: AssetType.CRYPTO,
        isActive: true
      },
      orderBy: {
        symbol: "asc"
      },
      include: {
        watchlistItem: {
          select: {
            alertEnabled: true,
            priority: true
          }
        }
      }
    });
    const marketRegimeReport = await loadLatestMarketRegimeReport(database);

    for (const asset of assets) {
      const latestSignalsByTimeframe = await loadLatestSignalsByTimeframe(database, asset.id);

      for (const timeframe of supportedBinanceIntervals) {
        try {
          const candles = await database.candle.findMany({
            where: {
              assetId: asset.id,
              timeframe
            },
            orderBy: {
              openTime: "desc"
            },
            take: candleLimit
          });

          const chronologicalCandles: IndicatorCandle[] = [...candles]
            .reverse()
            .map((candle) => ({
              high: candle.high.toString(),
              low: candle.low.toString(),
              close: candle.close.toString(),
              volume: candle.volume.toString()
            }));

          const snapshot = buildIndicatorSnapshot(chronologicalCandles);

          if (snapshot.candleCount < minimumUsefulCandles) {
            insufficientDataCount += 1;
            await writeBotLog(database, "warn", "Insufficient candles for signal analysis", {
              botRunId: botRun.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              candleCount: snapshot.candleCount
            });
            continue;
          }

          analyzedCount += 1;

          const decision = scoreSignal({
            asset: {
              symbol: asset.symbol,
              assetType: mapAssetType(asset.assetType)
            },
            timeframe,
            indicators: snapshot
          });

          const currentSignalInput = toMultiTimeframeSignalInput(decision, new Date());
          const multiTimeframeSummary = calculateSummaryWithCurrentSignal(
            latestSignalsByTimeframe,
            currentSignalInput
          );

          const outputDraft = composeSignalOutput({
            decision,
            asset: {
              symbol: asset.symbol,
              assetType: mapAssetType(asset.assetType)
            },
            intelligence: neutralIntelligenceContext,
            multiTimeframeSummary,
            marketRegimeContext: buildMarketRegimeContext({
              report: marketRegimeReport,
              symbol: asset.symbol,
              assetType: mapAssetType(asset.assetType),
              signalDirection: decision.direction,
              signalStatus: decision.status
            })
          });

          const signal = await database.signal.create({
            data: {
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              signalType: decision.signalType,
              status: decision.status,
              direction: decision.direction,
              score: decision.score,
              riskLevel: decision.riskLevel,
              trendScore: decision.trendScore,
              momentumScore: decision.momentumScore,
              volumeScore: decision.volumeScore,
              volatilityScore: decision.volatilityScore,
              rsiScore: decision.rsiScore,
              newsScore: decision.newsScore,
              socialScore: decision.socialScore,
              eventScore: decision.eventScore,
              riskScore: decision.riskScore,
              output: {
                create: {
                  shortConclusion: outputDraft.shortConclusion,
                  technicalJson: outputDraft.technicalJson as Prisma.InputJsonObject,
                  intelligenceJson: outputDraft.intelligenceJson as Prisma.InputJsonObject,
                  marketConfirmationJson:
                    outputDraft.marketConfirmationJson as Prisma.InputJsonObject,
                  counterArgument: outputDraft.counterArgument,
                  nextTrigger: outputDraft.nextTrigger,
                  telegramText: outputDraft.telegramText,
                  dashboardJson: outputDraft.dashboardJson as Prisma.InputJsonObject
                }
              }
            },
            include: {
              asset: true,
              output: true
            }
          });

          savedSignalCount += 1;
          latestSignalsByTimeframe.set(
            timeframe,
            toMultiTimeframeSignalInput(decision, signal.createdAt)
          );

          const signalOutput = signal.output;

          if (!signalOutput || !shouldSendSignalAlert(decision, signalOutput.telegramText, multiTimeframeSummary)) {
            skippedAlertCount += 1;
          } else {
            const routeDecision = shouldRouteAlertForAsset({
              asset,
              watchlistItem: asset.watchlistItem ?? null,
              alertMode: alertModeConfig.rawAlertMode
            });

            if (!routeDecision.shouldRoute) {
              skippedAlertCount += 1;
              routeSkippedAlertCount += 1;

              if (routeDecision.reason === "WATCHLIST_DISABLED") {
                watchlistDisabledSkipCount += 1;
              } else if (routeDecision.reason === "NOT_ON_WATCHLIST") {
                notOnWatchlistSkipCount += 1;
              } else if (routeDecision.reason === "NOT_HIGH_PRIORITY") {
                notHighPrioritySkipCount += 1;
              }

              continue;
            }

            routedAlertCount += 1;

            try {
              const existingAlertState = await database.alertState.findFirst({
                where: {
                  assetId: asset.id,
                  timeframe,
                  signalType: signal.signalType
                },
                orderBy: {
                  lastSentAt: "desc"
                }
              });
              const cooldownDecision = shouldSendAfterCooldown({
                signal,
                signalOutput,
                multiTimeframeSummary,
                existingAlertState,
                cooldownMinutes: alertCooldownMinutes,
                scoreImprovementThreshold: alertScoreImprovementThreshold,
                allowStatusEscalation,
                allowRiskEscalation
              });

              if (!cooldownDecision.shouldSend) {
                skippedAlertCount += 1;
                cooldownSkippedAlertCount += 1;
                continue;
              }

              const alertResult = await sendSignalAlertToN8n({
                signal,
                signalOutput,
                dashboardUrl: undefined
              }, {
                database
              });

              if (alertResult.status === AlertStatus.SENT) {
                sentAlertCount += 1;
                cooldownSentReasonCounts[cooldownDecision.reason as (typeof cooldownSentReasons)[number]] += 1;
                await upsertAlertStateAfterSend(database, {
                  signal,
                  alertId: alertResult.alertId,
                  multiTimeframeSummary,
                  sentAt: new Date()
                });
                await writeBotLog(database, "info", "Signal alert sent to n8n", {
                  botRunId: botRun.id,
                  signalId: signal.id,
                  alertId: alertResult.alertId,
                  assetId: asset.id,
                  symbol: asset.symbol,
                  timeframe,
                  status: decision.status,
                  score: decision.score,
                  signalType: decision.signalType,
                  cooldownReason: cooldownDecision.reason,
                  alignment: multiTimeframeSummary.alignment,
                  alignmentScore: multiTimeframeSummary.alignmentScore
                });
              } else {
                alertErrorCount += 1;
                await writeBotLog(database, "error", "Failed to send signal alert to n8n", {
                  botRunId: botRun.id,
                  signalId: signal.id,
                  alertId: alertResult.alertId,
                  assetId: asset.id,
                  symbol: asset.symbol,
                  timeframe,
                  status: decision.status,
                  score: decision.score,
                  signalType: decision.signalType,
                  alignment: multiTimeframeSummary.alignment,
                  alignmentScore: multiTimeframeSummary.alignmentScore,
                  error: alertResult.error ?? "unknown alert dispatch error"
                });
              }
            } catch (error) {
              alertErrorCount += 1;
              const message =
                error instanceof Error ? error.message : "unknown alert dispatch error";

              await writeBotLog(database, "error", "Failed to send signal alert to n8n", {
                botRunId: botRun.id,
                signalId: signal.id,
                assetId: asset.id,
                symbol: asset.symbol,
                timeframe,
                status: decision.status,
                score: decision.score,
                signalType: decision.signalType,
                alignment: multiTimeframeSummary.alignment,
                alignmentScore: multiTimeframeSummary.alignmentScore,
                error: message
              });
            }
          }
        } catch (error) {
          errorCount += 1;
          const message = error instanceof Error ? error.message : "Unknown signal analysis error";

          logger.error({ error, symbol: asset.symbol, timeframe }, message);
          await writeBotLog(database, "error", "Failed to analyze crypto signal", {
            botRunId: botRun.id,
            assetId: asset.id,
            symbol: asset.symbol,
            timeframe,
            error: message
          });
        }
      }
    }

    const status = errorCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: {
          intervals: [...supportedBinanceIntervals],
          candleLimit,
          alertMode: alertModeConfig.alertMode,
          assetCount: assets.length,
          analyzedCount,
          savedSignalCount,
          sentAlertCount,
          skippedAlertCount,
          routedAlertCount,
          routeSkippedAlertCount,
          cooldownSkippedAlertCount,
          cooldownSentReasonCounts,
          alertCooldownMinutes,
          alertScoreImprovementThreshold,
          watchlistDisabledSkipCount,
          notOnWatchlistSkipCount,
          notHighPrioritySkipCount,
          alertErrorCount,
          insufficientDataCount,
          errorCount
        }
      }
    });

    await writeBotLog(
      database,
      status === BotRunStatus.SUCCESS ? "info" : "warn",
      "analyzeCryptoSignals finished",
      {
        botRunId: botRun.id,
        assetCount: assets.length,
        analyzedCount,
        savedSignalCount,
        sentAlertCount,
        skippedAlertCount,
        alertMode: alertModeConfig.alertMode,
        routedAlertCount,
        routeSkippedAlertCount,
        cooldownSkippedAlertCount,
        cooldownSentReasonCounts,
        alertCooldownMinutes,
        alertScoreImprovementThreshold,
        watchlistDisabledSkipCount,
        notOnWatchlistSkipCount,
        notHighPrioritySkipCount,
        alertErrorCount,
        insufficientDataCount,
        errorCount
      }
    );

    return {
      status,
      analyzedCount,
      savedSignalCount,
      sentAlertCount,
      skippedAlertCount,
      alertMode: alertModeConfig.alertMode,
      routedAlertCount,
      routeSkippedAlertCount,
      cooldownSkippedAlertCount,
      watchlistDisabledSkipCount,
      notOnWatchlistSkipCount,
      notHighPrioritySkipCount,
      alertErrorCount,
      errorCount
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown analyzeCryptoSignals error";

    await database.botRun.update({
      where: {
        id: botRun.id
      },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          intervals: [...supportedBinanceIntervals],
          candleLimit,
          alertMode: alertModeConfig.alertMode,
          analyzedCount,
          savedSignalCount,
          sentAlertCount,
          skippedAlertCount,
          routedAlertCount,
          routeSkippedAlertCount,
          cooldownSkippedAlertCount,
          cooldownSentReasonCounts,
          alertCooldownMinutes,
          alertScoreImprovementThreshold,
          watchlistDisabledSkipCount,
          notOnWatchlistSkipCount,
          notHighPrioritySkipCount,
          alertErrorCount,
          insufficientDataCount,
          errorCount,
          fatalError: message
        }
      }
    });

    await writeBotLog(database, "error", "analyzeCryptoSignals failed", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

export function shouldRouteAlertForAsset(input: {
  asset: AlertRouteAsset;
  watchlistItem?: AlertRouteWatchlistItem;
  alertMode?: string | null;
}): AlertRouteDecision {
  const parsed = parseAlertMode(input.alertMode);
  const watchlistItem = input.watchlistItem ?? null;

  if (parsed.invalidValue && !watchlistItem) {
    return {
      shouldRoute: true,
      reason: "INVALID_ALERT_MODE"
    };
  }

  if (watchlistItem?.alertEnabled === false) {
    return {
      shouldRoute: false,
      reason: "WATCHLIST_DISABLED"
    };
  }

  if (parsed.alertMode === "ALL_ASSETS") {
    return {
      shouldRoute: true,
      reason: parsed.invalidValue ? "INVALID_ALERT_MODE" : "ALL_ASSETS"
    };
  }

  if (!watchlistItem) {
    return {
      shouldRoute: false,
      reason: "NOT_ON_WATCHLIST"
    };
  }

  if (parsed.alertMode === "WATCHLIST_ONLY") {
    return {
      shouldRoute: true,
      reason: "WATCHLIST_ONLY_MATCH"
    };
  }

  if (watchlistItem.priority === WatchlistPriority.HIGH) {
    return {
      shouldRoute: true,
      reason: "HIGH_PRIORITY_MATCH"
    };
  }

  return {
    shouldRoute: false,
    reason: "NOT_HIGH_PRIORITY"
  };
}

export function shouldSendSignalAlert(
  decision: SignalDecision,
  telegramText?: string | null,
  multiTimeframeSummary?: MultiTimeframeSummary | null
): boolean {
  if (!telegramText?.trim()) {
    return false;
  }

  if (isMultiTimeframeAlertWorthy(decision, multiTimeframeSummary)) {
    return true;
  }

  if (decision.status === "NO_EDGE" || decision.signalType === "NO_SIGNAL") {
    return false;
  }

  const hasAlertSignalType =
    decision.signalType === "VOLUME_SPIKE" ||
    decision.signalType === "VOLATILITY_SPIKE" ||
    decision.signalType === "BREAKOUT_ALERT";

  if (hasAlertSignalType) {
    return true;
  }

  if (decision.status === "WAIT" && decision.score < 70) {
    return false;
  }

  return (
    decision.status === "STRONG_WATCH" ||
    (decision.status === "WATCH" && decision.score >= 70) ||
    (decision.status === "AVOID" && decision.riskLevel === "HIGH")
  );
}

export function shouldSendAfterCooldown(input: {
  signal: CooldownSignal;
  signalOutput: { telegramText?: string | null };
  multiTimeframeSummary?: Pick<MultiTimeframeSummary, "alignment" | "alignmentScore"> | null;
  existingAlertState?: ExistingAlertState | null;
  now?: Date;
  cooldownMinutes: number;
  scoreImprovementThreshold: number;
  allowStatusEscalation: boolean;
  allowRiskEscalation: boolean;
}): AlertCooldownDecision {
  const now = input.now ?? new Date();
  const existing = input.existingAlertState ?? null;
  const currentAlignmentScore = input.multiTimeframeSummary?.alignmentScore;

  if (!existing) {
    return {
      shouldSend: true,
      reason: "NO_PREVIOUS_ALERT",
      details: {
        score: input.signal.score,
        riskLevel: input.signal.riskLevel,
        alignment: input.multiTimeframeSummary?.alignment ?? null,
        alignmentScore: currentAlignmentScore ?? null
      }
    };
  }

  const elapsedMinutes = (now.getTime() - existing.lastSentAt.getTime()) / 60_000;

  if (elapsedMinutes >= input.cooldownMinutes) {
    return {
      shouldSend: true,
      reason: "COOLDOWN_EXPIRED",
      details: {
        elapsedMinutes,
        cooldownMinutes: input.cooldownMinutes,
        lastSentAt: existing.lastSentAt.toISOString()
      }
    };
  }

  const scoreDelta = input.signal.score - existing.lastScore;

  if (scoreDelta >= input.scoreImprovementThreshold) {
    return {
      shouldSend: true,
      reason: "SCORE_IMPROVED",
      details: {
        previousScore: existing.lastScore,
        currentScore: input.signal.score,
        scoreDelta,
        threshold: input.scoreImprovementThreshold
      }
    };
  }

  const currentStatusRank = statusRank(input.signal.status);
  const previousStatusRank = statusRank(existing.status);

  if (
    input.allowStatusEscalation &&
    currentStatusRank !== null &&
    previousStatusRank !== null &&
    currentStatusRank > previousStatusRank
  ) {
    return {
      shouldSend: true,
      reason: "STATUS_ESCALATED",
      details: {
        previousStatus: existing.status,
        currentStatus: input.signal.status
      }
    };
  }

  if (
    input.allowRiskEscalation &&
    riskRank(input.signal.riskLevel) > riskRank(existing.lastRiskLevel)
  ) {
    return {
      shouldSend: true,
      reason: "RISK_ESCALATED",
      details: {
        previousRiskLevel: existing.lastRiskLevel,
        currentRiskLevel: input.signal.riskLevel
      }
    };
  }

  const alignmentDelta =
    currentAlignmentScore === undefined || existing.lastAlignmentScore === null
      ? null
      : currentAlignmentScore - existing.lastAlignmentScore;

  if (alignmentDelta !== null && alignmentDelta >= alignmentImprovementThreshold) {
    return {
      shouldSend: true,
      reason: "ALIGNMENT_IMPROVED",
      details: {
        previousAlignment: existing.lastAlignment,
        currentAlignment: input.multiTimeframeSummary?.alignment ?? null,
        previousAlignmentScore: existing.lastAlignmentScore,
        currentAlignmentScore,
        alignmentDelta,
        threshold: alignmentImprovementThreshold
      }
    };
  }

  return {
    shouldSend: false,
    reason: "COOLDOWN_ACTIVE",
    details: {
      elapsedMinutes,
      cooldownMinutes: input.cooldownMinutes,
      previousScore: existing.lastScore,
      currentScore: input.signal.score,
      previousStatus: existing.status,
      currentStatus: input.signal.status,
      previousRiskLevel: existing.lastRiskLevel,
      currentRiskLevel: input.signal.riskLevel,
      previousAlignmentScore: existing.lastAlignmentScore,
      currentAlignmentScore: currentAlignmentScore ?? null
    }
  };
}

function parseAlertMode(value: string | null | undefined): {
  alertMode: AlertMode;
  rawAlertMode: string | null | undefined;
  invalidValue: string | null;
} {
  if (value === undefined || value === null || value.trim() === "") {
    return {
      alertMode: "ALL_ASSETS",
      rawAlertMode: value,
      invalidValue: null
    };
  }

  const normalized = value.trim();

  if (alertModes.includes(normalized as AlertMode)) {
    return {
      alertMode: normalized as AlertMode,
      rawAlertMode: value,
      invalidValue: null
    };
  }

  return {
    alertMode: "ALL_ASSETS",
    rawAlertMode: value,
    invalidValue: value
  };
}

function parsePositiveNumberEnv(value: string | undefined, defaultValue: number) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return defaultValue;
}

function createCooldownSentReasonCounts() {
  return Object.fromEntries(cooldownSentReasons.map((reason) => [reason, 0])) as Record<
    (typeof cooldownSentReasons)[number],
    number
  >;
}

function statusRank(status: SignalStatus): number | null {
  if (status === "NO_EDGE") {
    return 0;
  }

  if (status === "WAIT") {
    return 1;
  }

  if (status === "WATCH") {
    return 2;
  }

  if (status === "STRONG_WATCH") {
    return 3;
  }

  return null;
}

function riskRank(riskLevel: RiskLevel) {
  if (riskLevel === "LOW") {
    return 0;
  }

  if (riskLevel === "MEDIUM") {
    return 1;
  }

  return 2;
}

async function upsertAlertStateAfterSend(
  database: PrismaClient,
  input: {
    signal: CooldownSignal;
    alertId: string;
    multiTimeframeSummary?: Pick<MultiTimeframeSummary, "alignment" | "alignmentScore"> | null;
    sentAt: Date;
  }
) {
  await database.alertState.upsert({
    where: {
      assetId_timeframe_signalType_status: {
        assetId: input.signal.assetId,
        timeframe: input.signal.timeframe,
        signalType: input.signal.signalType,
        status: input.signal.status
      }
    },
    create: {
      assetId: input.signal.assetId,
      symbol: input.signal.symbol,
      timeframe: input.signal.timeframe,
      signalType: input.signal.signalType,
      status: input.signal.status,
      direction: input.signal.direction,
      lastSignalId: input.signal.id ?? null,
      lastAlertId: input.alertId,
      lastScore: input.signal.score,
      lastRiskLevel: input.signal.riskLevel,
      lastAlignment: input.multiTimeframeSummary?.alignment ?? null,
      lastAlignmentScore: input.multiTimeframeSummary?.alignmentScore ?? null,
      lastSentAt: input.sentAt
    },
    update: {
      symbol: input.signal.symbol,
      direction: input.signal.direction,
      lastSignalId: input.signal.id ?? null,
      lastAlertId: input.alertId,
      lastScore: input.signal.score,
      lastRiskLevel: input.signal.riskLevel,
      lastAlignment: input.multiTimeframeSummary?.alignment ?? null,
      lastAlignmentScore: input.multiTimeframeSummary?.alignmentScore ?? null,
      lastSentAt: input.sentAt,
      sendCount: {
        increment: 1
      }
    }
  });
}

async function loadLatestSignalsByTimeframe(
  database: PrismaClient,
  assetId: string
): Promise<Map<string, MultiTimeframeSignalInput>> {
  const latestSignals = await Promise.all(
    multiTimeframeIntervals.map((timeframe) =>
      database.signal.findFirst({
        where: {
          assetId,
          timeframe
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          symbol: true,
          timeframe: true,
          status: true,
          direction: true,
          signalType: true,
          score: true,
          riskLevel: true,
          riskScore: true,
          createdAt: true
        }
      })
    )
  );

  const latestSignalsByTimeframe = new Map<string, MultiTimeframeSignalInput>();

  for (const signal of latestSignals) {
    if (!signal) {
      continue;
    }

    if (!latestSignalsByTimeframe.has(signal.timeframe)) {
      latestSignalsByTimeframe.set(signal.timeframe, signal);
    }
  }

  return latestSignalsByTimeframe;
}

function calculateSummaryWithCurrentSignal(
  latestSignalsByTimeframe: Map<string, MultiTimeframeSignalInput>,
  currentSignal: MultiTimeframeSignalInput
): MultiTimeframeSummary {
  return calculateMultiTimeframeSummary([...latestSignalsByTimeframe.values(), currentSignal]);
}

function toMultiTimeframeSignalInput(
  decision: SignalDecision,
  createdAt: Date | string
): MultiTimeframeSignalInput {
  return {
    symbol: decision.symbol,
    timeframe: decision.timeframe,
    status: decision.status,
    direction: decision.direction,
    signalType: decision.signalType,
    score: decision.score,
    riskLevel: decision.riskLevel,
    riskScore: decision.riskScore,
    createdAt
  };
}

function isMultiTimeframeAlertWorthy(
  decision: SignalDecision,
  summary?: MultiTimeframeSummary | null
): boolean {
  if (!summary) {
    return false;
  }

  if (summary.alignment === "BULLISH_ALIGNED" && summary.alignmentScore >= 70) {
    return true;
  }

  if (summary.alignment === "HIGHER_TIMEFRAME_CONFIRMATION" && summary.alignmentScore >= 65) {
    return true;
  }

  if (summary.alignment === "CONFLICT" && decision.riskLevel === "HIGH") {
    return true;
  }

  return summary.alignment === "BEARISH_ALIGNED" && decision.riskLevel === "HIGH";
}

function mapAssetType(assetType: AssetType): AssetClass {
  if (assetType === AssetType.STOCK) {
    return "stock";
  }

  if (assetType === AssetType.ETF) {
    return "etf";
  }

  return "crypto";
}

async function loadLatestMarketRegimeReport(database: PrismaClient): Promise<MarketRegimeReport | null> {
  const snapshot = await database.marketRegimeSnapshot?.findFirst({
    orderBy: { generatedAt: "desc" }
  });

  return snapshot?.reportJson as MarketRegimeReport | null;
}

function buildMarketRegimeContext(input: {
  report: MarketRegimeReport | null;
  symbol: string;
  assetType: AssetClass;
  signalDirection: SignalDirection;
  signalStatus: SignalStatus;
}): SignalRegimeContext | null {
  if (!input.report) return null;

  return buildSignalRegimeContext({
    symbol: input.symbol,
    assetType: input.assetType,
    signalDirection: input.signalDirection,
    signalStatus: input.signalStatus,
    report: input.report
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
      service: "worker",
      message,
      metadataJson
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await analyzeCryptoSignals();
    logger.info("analyzeCryptoSignals completed");
  } finally {
    await prisma.$disconnect();
  }
}
