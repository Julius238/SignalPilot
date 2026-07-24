import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSignalAlertQualityGate,
  evaluateSignalAlertRepeat,
  sendSignalAlertToN8n,
  type SignalAlertQualityContext
} from "@signalpilot/alerts";
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
  type PrismaClient
} from "@signalpilot/database";
import { buildIndicatorSnapshot, type IndicatorCandle } from "@signalpilot/indicators";
import {
  assessCandleSeriesQuality,
  isTimestampFresh,
  supportedBinanceIntervals
} from "@signalpilot/market-data";
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
import { buildPerformanceReport, type PerformanceIntelligenceReport } from "@signalpilot/performance-intelligence";
import { scoreSignal } from "@signalpilot/scoring-engine";
import { applySignalRules, type SignalRulesResult } from "@signalpilot/signal-rules";
import type { AssetClass, IntelligenceContext, SignalDecision } from "@signalpilot/shared";
import { config } from "dotenv";
import pino from "pino";

import {
  buildSignalAlertQualityContext,
  loadPreviousNotificationContext
} from "../lib/alertQuality.js";
import {
  parseAlertMode,
  shouldRouteAlertForAsset,
  type AlertMode
} from "../lib/alertRouting.js";

export {
  shouldRouteAlertForAsset,
  type AlertMode
} from "../lib/alertRouting.js";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const candleLimit = 250;
const minimumUsefulCandles = 20;
const multiTimeframeIntervals = ["1h", "4h", "1d"] as const;
const defaultAlertCooldownMinutes = 240;
const defaultAlertScoreImprovementThreshold = 8;
const cooldownSentReasons = [
  "NO_PREVIOUS_ALERT",
  "SCORE_IMPROVED",
  "SEVERITY_ESCALATED",
  "TIMEFRAME_CONFIRMATION_ADDED",
  "DIRECTION_CHANGED",
  "NEWS_EVENT_CONTEXT_CHANGED"
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

export type AlertCooldownReason =
  | (typeof cooldownSentReasons)[number]
  | "NO_MATERIAL_IMPROVEMENT";

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
  direction: SignalDirection;
  lastSignalId?: string | null;
  lastScore: number;
  lastRiskLevel: RiskLevel;
  lastAlignment: string | null;
  lastAlignmentScore: number | null;
  lastSentAt: Date;
  lastConfirmingTimeframes?: string[];
  lastNewsEventContextFingerprint?: string | null;
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
  const analysisNow = new Date();
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
    const performanceReport = await loadPerformanceReport(database);

    for (const asset of assets) {
      const latestSignalsByTimeframe = await loadLatestSignalsByTimeframe(database, asset.id);

      for (const timeframe of supportedBinanceIntervals) {
        try {
          const candles = await database.candle.findMany({
            where: {
              assetId: asset.id,
              timeframe,
              closeTime: {
                lte: analysisNow
              }
            },
            orderBy: {
              openTime: "desc"
            },
            take: candleLimit
          });

          const candleQuality = assessCandleSeriesQuality(candles, {
            now: analysisNow,
            timeframe,
            marketKind: "CONTINUOUS",
            minimumClosedCandles: minimumUsefulCandles
          });

          if (candleQuality.reason !== "OK") {
            insufficientDataCount += 1;
            await writeBotLog(database, "warn", "Crypto signal analysis skipped for candle quality", {
              botRunId: botRun.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              reason: candleQuality.reason,
              closedCandleCount: candleQuality.closedCandles.length,
              excludedOpenOrInvalidCandleCount: candleQuality.openOrInvalidCandleCount,
              latestCloseTime: candleQuality.latestCloseTime?.toISOString() ?? null,
              ageMinutes:
                candleQuality.ageMs === null ? null : Math.round(candleQuality.ageMs / 60_000)
            });
            continue;
          }

          const chronologicalCandles: IndicatorCandle[] = candleQuality.closedCandles.map((candle) => ({
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

          const currentSignalInput = toMultiTimeframeSignalInput(decision, analysisNow);
          const multiTimeframeSummary = calculateSummaryWithCurrentSignal(
            latestSignalsByTimeframe,
            currentSignalInput
          );

          const marketRegimeContext = buildMarketRegimeContext({
            report: marketRegimeReport,
            symbol: asset.symbol,
            assetType: mapAssetType(asset.assetType),
            signalDirection: decision.direction,
            signalStatus: decision.status
          });
          const signalRulesResult = applySignalRules({
            asset: { symbol: asset.symbol, assetType: mapAssetType(asset.assetType) },
            signalDecision: decision,
            multiTimeframeSummary,
            marketRegimeContext,
            performanceReport,
            dataQuality: {
              qualityScore: snapshot.candleCount >= 200 ? 80 : 55,
              hasMinimumCandles: snapshot.candleCount >= 200,
              missingMarketRegimeContext: marketRegimeContext === null
            }
          });
          const adjustedDecision = applyRuleResultToDecision(decision, signalRulesResult);
          const baseAlertQualityContext = buildSignalAlertQualityContext({
            decision: adjustedDecision,
            candles: chronologicalCandles,
            indicators: snapshot,
            multiTimeframeSummary
          });

          const outputDraft = composeSignalOutput({
            decision: adjustedDecision,
            asset: {
              symbol: asset.symbol,
              assetType: mapAssetType(asset.assetType)
            },
            intelligence: neutralIntelligenceContext,
            multiTimeframeSummary,
            marketRegimeContext,
            signalRulesResult
          });

          const signal = await database.signal.create({
            data: {
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              signalType: decision.signalType,
              status: signalRulesResult.finalStatus,
              direction: decision.direction,
              score: signalRulesResult.adjustedScore,
              riskLevel: signalRulesResult.finalRiskLevel,
              trendScore: decision.trendScore,
              momentumScore: decision.momentumScore,
              volumeScore: decision.volumeScore,
              volatilityScore: decision.volatilityScore,
              rsiScore: decision.rsiScore,
              newsScore: decision.newsScore,
              socialScore: decision.socialScore,
              eventScore: decision.eventScore,
              riskScore: decision.riskScore,
              ruleApplication: {
                create: buildRuleApplicationCreate(decision, signalRulesResult)
              },
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
            toMultiTimeframeSignalInput(adjustedDecision, signal.createdAt)
          );

          const signalOutput = signal.output;

          if (
            !signalOutput ||
            !shouldSendSignalAlert(
              adjustedDecision,
              signalOutput.telegramText,
              multiTimeframeSummary,
              {
                ...baseAlertQualityContext,
                materialRepeat: true
              }
            )
          ) {
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
              const enrichedAlertState = await enrichExistingAlertState(
                database,
                existingAlertState
              );
              const cooldownDecision = shouldSendAfterCooldown({
                signal,
                signalOutput,
                multiTimeframeSummary,
                qualityContext: baseAlertQualityContext,
                existingAlertState: enrichedAlertState,
                cooldownMinutes: alertCooldownMinutes,
                scoreImprovementThreshold: alertScoreImprovementThreshold
              });

              if (!cooldownDecision.shouldSend) {
                skippedAlertCount += 1;
                cooldownSkippedAlertCount += 1;
                continue;
              }

              const alertResult = await sendSignalAlertToN8n({
                signal,
                signalOutput,
                qualityContext: {
                  ...baseAlertQualityContext,
                  materialRepeat: cooldownDecision.shouldSend
                },
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

export function shouldSendSignalAlert(
  decision: SignalDecision,
  telegramText?: string | null,
  multiTimeframeSummary?: MultiTimeframeSummary | null,
  qualityContext?: SignalAlertQualityContext
): boolean {
  return evaluateSignalAlertQualityGate({
    signal: {
      id: "worker-preflight",
      symbol: decision.symbol,
      assetType: decision.assetType,
      timeframe: decision.timeframe,
      status: decision.status,
      direction: decision.direction,
      signalType: decision.signalType,
      score: decision.score,
      volumeScore: decision.volumeScore,
      riskLevel: decision.riskLevel,
      createdAt: new Date(0)
    },
    signalOutput: {
      shortConclusion: "",
      telegramText: telegramText ?? "",
      dashboardJson: {},
      multiTimeframeSummary
    },
    qualityContext
  }).allowed;
}

export function shouldSendAfterCooldown(input: {
  signal: CooldownSignal;
  signalOutput: { telegramText?: string | null };
  multiTimeframeSummary?: Pick<
    MultiTimeframeSummary,
    "alignment" | "alignmentScore" | "confirmingTimeframes"
  > | null;
  qualityContext?: Pick<
    SignalAlertQualityContext,
    "confirmingTimeframes" | "newsEventContextFingerprint"
  >;
  existingAlertState?: ExistingAlertState | null;
  now?: Date;
  cooldownMinutes: number;
  scoreImprovementThreshold: number;
}): AlertCooldownDecision {
  const existing = input.existingAlertState ?? null;
  const repeatDecision = evaluateSignalAlertRepeat({
    current: {
      status: input.signal.status,
      direction: input.signal.direction,
      score: input.signal.score,
      confirmingTimeframes:
        input.qualityContext?.confirmingTimeframes ??
        input.multiTimeframeSummary?.confirmingTimeframes ??
        [],
      newsEventContextFingerprint:
        input.qualityContext?.newsEventContextFingerprint ?? null
    },
    previous: existing
      ? {
          status: existing.status,
          direction: existing.direction,
          score: existing.lastScore,
          confirmingTimeframes: existing.lastConfirmingTimeframes ?? [],
          newsEventContextFingerprint:
            existing.lastNewsEventContextFingerprint ?? null,
          sentAt: existing.lastSentAt
        }
      : null,
    now: input.now,
    cooldownMinutes: input.cooldownMinutes,
    scoreImprovementThreshold: input.scoreImprovementThreshold
  });

  return repeatDecision;
}

function parsePositiveNumberEnv(value: string | undefined, defaultValue: number) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function createCooldownSentReasonCounts() {
  return Object.fromEntries(cooldownSentReasons.map((reason) => [reason, 0])) as Record<
    (typeof cooldownSentReasons)[number],
    number
  >;
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

async function enrichExistingAlertState(
  database: PrismaClient,
  existingAlertState: ExistingAlertState | null
): Promise<ExistingAlertState | null> {
  if (!existingAlertState?.lastSignalId) {
    return existingAlertState;
  }

  const previousContext = await loadPreviousNotificationContext(
    database,
    existingAlertState.lastSignalId
  );

  return {
    ...existingAlertState,
    lastConfirmingTimeframes: previousContext.confirmingTimeframes,
    lastNewsEventContextFingerprint:
      previousContext.newsEventContextFingerprint
  };
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
    if (
      !signal ||
      !isTimestampFresh(
        signal.createdAt,
        signal.timeframe,
        "CONTINUOUS"
      )
    ) {
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

async function loadPerformanceReport(database: PrismaClient): Promise<PerformanceIntelligenceReport | null> {
  const evaluations = await database.paperSignalEvaluation?.findMany();
  if (!evaluations || evaluations.length === 0) return null;

  return buildPerformanceReport(
    evaluations.map((evaluation) => ({
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
    }))
  );
}

function applyRuleResultToDecision(decision: SignalDecision, rules: SignalRulesResult): SignalDecision {
  return {
    ...decision,
    score: rules.adjustedScore,
    status: rules.finalStatus,
    riskLevel: rules.finalRiskLevel
  };
}

function buildRuleApplicationCreate(decision: SignalDecision, rules: SignalRulesResult) {
  return {
    originalScore: rules.originalScore,
    adjustedScore: rules.adjustedScore,
    originalStatus: decision.status,
    adjustedStatus: rules.finalStatus,
    finalRiskLevel: rules.finalRiskLevel,
    adjustmentsJson: rules.adjustments as unknown as Prisma.InputJsonArray,
    warningsJson: rules.warnings as unknown as Prisma.InputJsonArray,
    summary: rules.summary
  };
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
