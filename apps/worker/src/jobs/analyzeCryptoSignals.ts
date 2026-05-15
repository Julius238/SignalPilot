import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sendSignalAlertToN8n } from "@signalpilot/alerts";
import {
  AlertStatus,
  AssetType,
  BotRunStatus,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { buildIndicatorSnapshot, type IndicatorCandle } from "@signalpilot/indicators";
import { supportedBinanceIntervals } from "@signalpilot/market-data";
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
  alertErrorCount: number;
  errorCount: number;
};

export async function analyzeCryptoSignals(
  database: PrismaClient = prisma
): Promise<AnalyzeCryptoSignalsSummary> {
  const botRun = await database.botRun.create({
    data: {
      jobName: "analyzeCryptoSignals",
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        intervals: [...supportedBinanceIntervals],
        candleLimit
      }
    }
  });

  let analyzedCount = 0;
  let savedSignalCount = 0;
  let sentAlertCount = 0;
  let skippedAlertCount = 0;
  let alertErrorCount = 0;
  let insufficientDataCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "analyzeCryptoSignals started", {
    botRunId: botRun.id
  });

  try {
    const assets = await database.asset.findMany({
      where: {
        assetType: AssetType.CRYPTO,
        isActive: true
      },
      orderBy: {
        symbol: "asc"
      }
    });

    for (const asset of assets) {
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

          const outputDraft = composeSignalOutput({
            decision,
            asset: {
              symbol: asset.symbol,
              assetType: mapAssetType(asset.assetType)
            },
            intelligence: neutralIntelligenceContext
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

          const signalOutput = signal.output;

          if (!signalOutput || !shouldSendSignalAlert(decision, signalOutput.telegramText)) {
            skippedAlertCount += 1;
          } else {
            try {
              const alertResult = await sendSignalAlertToN8n({
                signal,
                signalOutput,
                dashboardUrl: undefined
              }, {
                database
              });

              if (alertResult.status === AlertStatus.SENT) {
                sentAlertCount += 1;
                await writeBotLog(database, "info", "Signal alert sent to n8n", {
                  botRunId: botRun.id,
                  signalId: signal.id,
                  alertId: alertResult.alertId,
                  assetId: asset.id,
                  symbol: asset.symbol,
                  timeframe,
                  status: decision.status,
                  score: decision.score,
                  signalType: decision.signalType
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
          assetCount: assets.length,
          analyzedCount,
          savedSignalCount,
          sentAlertCount,
          skippedAlertCount,
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
          analyzedCount,
          savedSignalCount,
          sentAlertCount,
          skippedAlertCount,
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

export function shouldSendSignalAlert(decision: SignalDecision, telegramText?: string | null): boolean {
  if (!telegramText?.trim()) {
    return false;
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

function mapAssetType(assetType: AssetType): AssetClass {
  if (assetType === AssetType.STOCK) {
    return "stock";
  }

  if (assetType === AssetType.ETF) {
    return "etf";
  }

  return "crypto";
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
