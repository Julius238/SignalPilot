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
  type PrismaClient
} from "@signalpilot/database";
import { buildIndicatorSnapshot, type IndicatorCandle } from "@signalpilot/indicators";
import {
  assessCandleSeriesQuality,
  isTimestampFresh
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
import {
  buildEventContextForSignal,
  type EventContext,
  type EventInput
} from "@signalpilot/events-intelligence";
import { buildNewsContextForSignal, type NewsContext } from "@signalpilot/news-intelligence";
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
  shouldRouteAlertForAsset,
  shouldSendAfterCooldown,
  shouldSendSignalAlert,
  type AlertMode
} from "./analyzeCryptoSignals.js";

const logger = pino({ name: "signalpilot-worker" });

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

const candleLimit = 250;
const minimumUsefulCandles = 20;
const equityIntervals = ["1h", "1d"] as const;
const defaultAlertCooldownMinutes = 240;
const defaultAlertScoreImprovementThreshold = 8;

const neutralIntelligenceContext: IntelligenceContext = {
  newsSummary: "Keine relevante neue Meldung im Scan-Fenster gefunden.",
  socialSummary: "noch nicht aktiv verbunden.",
  eventSummary: "Keine Event-Daten in diesem Scan.",
  impactSummary: "Signal basiert primär auf technischen Daten.",
  sources: []
};

export type AnalyzeEquitySignalsSummary = {
  status: BotRunStatus;
  analyzedCount: number;
  savedSignalCount: number;
  missingDataCount: number;
  sentAlertCount: number;
  skippedAlertCount: number;
  equityAlertsDisabledCount: number;
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

export async function analyzeEquitySignals(
  database: PrismaClient = prisma
): Promise<AnalyzeEquitySignalsSummary> {
  const equityAlertsEnabled = parseBooleanEnv(process.env.ENABLE_EQUITY_ALERTS, false);
  const alertModeRaw = process.env.ALERT_MODE;
  const alertCooldownMinutes = parsePositiveNumberEnv(
    process.env.ALERT_COOLDOWN_MINUTES,
    defaultAlertCooldownMinutes
  );
  const alertScoreImprovementThreshold = parsePositiveNumberEnv(
    process.env.ALERT_SCORE_IMPROVEMENT_THRESHOLD,
    defaultAlertScoreImprovementThreshold
  );
  const now = new Date();

  const botRun = await database.botRun.create({
    data: {
      jobName: "analyzeEquitySignals",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        intervals: [...equityIntervals],
        candleLimit,
        equityAlertsEnabled,
        alertCooldownMinutes,
        alertScoreImprovementThreshold
      }
    }
  });

  let analyzedCount = 0;
  let savedSignalCount = 0;
  let missingDataCount = 0;
  let sentAlertCount = 0;
  let skippedAlertCount = 0;
  let equityAlertsDisabledCount = 0;
  let routedAlertCount = 0;
  let routeSkippedAlertCount = 0;
  let cooldownSkippedAlertCount = 0;
  let watchlistDisabledSkipCount = 0;
  let notOnWatchlistSkipCount = 0;
  let notHighPrioritySkipCount = 0;
  let alertErrorCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "analyzeEquitySignals started", {
    botRunId: botRun.id,
    equityAlertsEnabled
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: { in: [AssetType.STOCK, AssetType.ETF] },
        isActive: true
      },
      orderBy: { symbol: "asc" },
      include: {
        watchlistItem: {
          select: { alertEnabled: true, priority: true }
        }
      }
    });

    const equityNewsEnabled = parseBooleanEnv(process.env.ENABLE_EQUITY_NEWS, true);
    const equityEventsEnabled = parseBooleanEnv(process.env.ENABLE_EQUITY_EVENTS, true);
    const marketRegimeReport = await loadLatestMarketRegimeReport(database);
    const performanceReport = await loadPerformanceReport(database);

    for (const asset of assets) {
      const latestSignalsByTimeframe = await loadLatestEquitySignalsByTimeframe(database, asset.id);
      let newsContext: NewsContext | null = null;
      if (equityNewsEnabled) {
        try {
          newsContext = await loadNewsContext(database, asset, now);
        } catch {
          newsContext = buildNewsContextForSignal({ asset, signal: { createdAt: now }, newsItems: [], now });
        }
      }

      let eventContext: EventContext | null = null;
      if (equityEventsEnabled) {
        try {
          eventContext = await loadEventContext(database, asset, now);
        } catch {
          eventContext = null;
        }
      }

      for (const timeframe of equityIntervals) {
        try {
          const candles = await database.candle.findMany({
            where: {
              assetId: asset.id,
              timeframe,
              closeTime: {
                lte: now
              }
            },
            orderBy: { openTime: "desc" },
            take: candleLimit
          });

          const candleQuality = assessCandleSeriesQuality(candles, {
            now,
            timeframe,
            marketKind: "SESSION",
            minimumClosedCandles: minimumUsefulCandles
          });

          if (candleQuality.reason !== "OK") {
            missingDataCount += 1;
            await writeBotLog(database, "warn", "Equity signal analysis skipped for candle quality", {
              botRunId: botRun.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              reason: candleQuality.reason,
              closedCandleCount: candleQuality.closedCandles.length,
              excludedOpenOrInvalidCandleCount: candleQuality.openOrInvalidCandleCount,
              latestCloseTime: candleQuality.latestCloseTime?.toISOString() ?? null,
              ageHours:
                candleQuality.ageMs === null
                  ? null
                  : Math.round((candleQuality.ageMs / 3_600_000) * 10) / 10
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
            missingDataCount += 1;
            continue;
          }

          analyzedCount += 1;

          const decision = scoreSignal({
            asset: { symbol: asset.symbol, assetType: mapAssetType(asset.assetType) },
            timeframe,
            indicators: snapshot
          });

          const currentSignalInput = toEquityMultiTimeframeInput(decision, new Date());
          const multiTimeframeSummary = calculateMultiTimeframeSummary([
            ...latestSignalsByTimeframe.values(),
            currentSignalInput
          ]);

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
            newsContext,
            eventContext,
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
            multiTimeframeSummary,
            newsContext,
            eventContext
          });

          const outputDraft = composeSignalOutput({
            decision: adjustedDecision,
            asset: { symbol: asset.symbol, assetType: mapAssetType(asset.assetType) },
            intelligence: neutralIntelligenceContext,
            multiTimeframeSummary,
            marketRegimeContext,
            signalRulesResult,
            newsContext,
            eventContext
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
                  marketConfirmationJson: outputDraft.marketConfirmationJson as Prisma.InputJsonObject,
                  counterArgument: outputDraft.counterArgument,
                  nextTrigger: outputDraft.nextTrigger,
                  telegramText: outputDraft.telegramText,
                  dashboardJson: outputDraft.dashboardJson as Prisma.InputJsonObject
                }
              }
            },
            include: { asset: true, output: true }
          });

          savedSignalCount += 1;
          latestSignalsByTimeframe.set(timeframe, toEquityMultiTimeframeInput(adjustedDecision, signal.createdAt));

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
            continue;
          }

          if (!equityAlertsEnabled) {
            equityAlertsDisabledCount += 1;
            skippedAlertCount += 1;
            continue;
          }

          const routeDecision = shouldRouteAlertForAsset({
            asset,
            watchlistItem: asset.watchlistItem ?? null,
            alertMode: alertModeRaw
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
              where: { assetId: asset.id, timeframe, signalType: signal.signalType },
              orderBy: { lastSentAt: "desc" }
            });
            const previousContext = await loadPreviousNotificationContext(
              database,
              existingAlertState?.lastSignalId
            );

            const cooldownDecision = shouldSendAfterCooldown({
              signal,
              signalOutput,
              multiTimeframeSummary,
              qualityContext: baseAlertQualityContext,
              existingAlertState: existingAlertState
                ? {
                    ...existingAlertState,
                    lastConfirmingTimeframes:
                      previousContext.confirmingTimeframes,
                    lastNewsEventContextFingerprint:
                      previousContext.newsEventContextFingerprint
                  }
                : null,
              cooldownMinutes: alertCooldownMinutes,
              scoreImprovementThreshold: alertScoreImprovementThreshold
            });

            if (!cooldownDecision.shouldSend) {
              skippedAlertCount += 1;
              cooldownSkippedAlertCount += 1;
              continue;
            }

            const alertResult = await sendSignalAlertToN8n(
              {
                signal,
                signalOutput,
                qualityContext: {
                  ...baseAlertQualityContext,
                  materialRepeat: cooldownDecision.shouldSend
                },
                dashboardUrl: undefined
              },
              { database }
            );

            if (alertResult.status === AlertStatus.SENT) {
              sentAlertCount += 1;
              await upsertAlertStateAfterSend(database, {
                signal,
                alertId: alertResult.alertId,
                multiTimeframeSummary,
                sentAt: new Date()
              });
              await writeBotLog(database, "info", "Equity signal alert sent to n8n", {
                botRunId: botRun.id,
                signalId: signal.id,
                symbol: asset.symbol,
                timeframe,
                status: decision.status,
                score: decision.score,
                cooldownReason: cooldownDecision.reason,
                alignment: multiTimeframeSummary.alignment
              });
            } else {
              alertErrorCount += 1;
              await writeBotLog(database, "error", "Failed to send equity signal alert to n8n", {
                botRunId: botRun.id,
                signalId: signal.id,
                symbol: asset.symbol,
                timeframe,
                error: alertResult.error ?? "unknown alert dispatch error"
              });
            }
          } catch (error) {
            alertErrorCount += 1;
            const message = error instanceof Error ? error.message : "unknown alert dispatch error";
            await writeBotLog(database, "error", "Failed to send equity signal alert to n8n", {
              botRunId: botRun.id,
              symbol: asset.symbol,
              timeframe,
              error: message
            });
          }
        } catch (error) {
          errorCount += 1;
          const message = error instanceof Error ? error.message : "Unknown signal analysis error";
          logger.error({ error, symbol: asset.symbol, timeframe }, message);
          await writeBotLog(database, "error", "Failed to analyze equity signal", {
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
      where: { id: botRun.id },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: {
          intervals: [...equityIntervals],
          candleLimit,
          equityAlertsEnabled,
          assetCount: assets.length,
          analyzedCount,
          savedSignalCount,
          missingDataCount,
          sentAlertCount,
          skippedAlertCount,
          equityAlertsDisabledCount,
          routedAlertCount,
          routeSkippedAlertCount,
          cooldownSkippedAlertCount,
          alertCooldownMinutes,
          alertScoreImprovementThreshold,
          watchlistDisabledSkipCount,
          notOnWatchlistSkipCount,
          notHighPrioritySkipCount,
          alertErrorCount,
          errorCount
        }
      }
    });

    await writeBotLog(
      database,
      status === BotRunStatus.SUCCESS ? "info" : "warn",
      "analyzeEquitySignals finished",
      {
        botRunId: botRun.id,
        assetCount: assets.length,
        analyzedCount,
        savedSignalCount,
        missingDataCount,
        sentAlertCount,
        skippedAlertCount,
        equityAlertsDisabledCount,
        errorCount
      }
    );

    return {
      status,
      analyzedCount,
      savedSignalCount,
      missingDataCount,
      sentAlertCount,
      skippedAlertCount,
      equityAlertsDisabledCount,
      alertMode: parseAlertMode(alertModeRaw),
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
    const message = error instanceof Error ? error.message : "Unknown analyzeEquitySignals error";

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          intervals: [...equityIntervals],
          candleLimit,
          equityAlertsEnabled,
          analyzedCount,
          savedSignalCount,
          missingDataCount,
          errorCount,
          fatalError: message
        }
      }
    });

    await writeBotLog(database, "error", "analyzeEquitySignals failed", {
      botRunId: botRun.id,
      error: message
    });

    throw error;
  }
}

async function loadEventContext(
  database: PrismaClient,
  asset: { id: string; symbol: string; assetType: AssetType },
  now: Date
): Promise<EventContext> {
  const lookbackDays = Number(process.env.EVENTS_LOOKBACK_DAYS ?? 14);
  const lookaheadDays = Number(process.env.EVENTS_LOOKAHEAD_DAYS ?? 60);
  const from = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

  const events = await database.event.findMany({
    where: {
      symbol: asset.symbol,
      eventDate: { gte: from, lte: to }
    },
    orderBy: { eventDate: "asc" }
  });

  return buildEventContextForSignal({
    asset: { symbol: asset.symbol, assetType: mapAssetType(asset.assetType) },
    signal: { createdAt: now },
    events: events.map((e) => ({
      id: e.id,
      symbol: e.symbol ?? asset.symbol,
      eventType: e.eventType,
      title: e.title,
      eventDate: e.eventDate ?? now,
      fiscalQuarter: e.fiscalQuarter,
      fiscalYear: e.fiscalYear,
      epsEstimate: e.epsEstimate?.toString() ?? null,
      epsActual: e.epsActual?.toString() ?? null,
      revenueEstimate: e.revenueEstimate?.toString() ?? null,
      revenueActual: e.revenueActual?.toString() ?? null
    } satisfies EventInput)),
    now
  });
}

async function loadNewsContext(
  database: PrismaClient,
  asset: { id: string; symbol: string },
  now: Date
): Promise<NewsContext> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const newsItems = await database.newsItem.findMany({
    where: {
      assetId: asset.id,
      publishedAt: { gte: since }
    },
    orderBy: { publishedAt: "desc" },
    take: 20
  });

  return buildNewsContextForSignal({
    asset,
    signal: { createdAt: now },
    newsItems: newsItems.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
      category: item.category
    })),
    now
  });
}

async function loadLatestEquitySignalsByTimeframe(
  database: PrismaClient,
  assetId: string
): Promise<Map<string, MultiTimeframeSignalInput>> {
  const latestSignals = await Promise.all(
    equityIntervals.map((timeframe) =>
      database.signal.findFirst({
        where: { assetId, timeframe },
        orderBy: { createdAt: "desc" },
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

  const map = new Map<string, MultiTimeframeSignalInput>();
  for (const signal of latestSignals) {
    if (
      signal &&
      isTimestampFresh(signal.createdAt, signal.timeframe, "SESSION") &&
      !map.has(signal.timeframe)
    ) {
      map.set(signal.timeframe, signal);
    }
  }
  return map;
}

async function upsertAlertStateAfterSend(
  database: PrismaClient,
  input: {
    signal: {
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
      sendCount: { increment: 1 }
    }
  });
}

function toEquityMultiTimeframeInput(decision: SignalDecision, createdAt: Date | string): MultiTimeframeSignalInput {
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
  if (assetType === AssetType.STOCK) return "stock";
  if (assetType === AssetType.ETF) return "etf";
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

function parseAlertMode(value: string | null | undefined): AlertMode {
  if (value === "WATCHLIST_ONLY" || value === "HIGH_PRIORITY_ONLY") return value;
  return "ALL_ASSETS";
}

function parsePositiveNumberEnv(value: string | undefined, defaultValue: number) {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

async function writeBotLog(
  database: PrismaClient,
  level: string,
  message: string,
  metadataJson?: Prisma.InputJsonValue
) {
  await database.botLog.create({
    data: { level, service: "worker", message, metadataJson }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await analyzeEquitySignals();
    logger.info("analyzeEquitySignals completed");
  } finally {
    await prisma.$disconnect();
  }
}
