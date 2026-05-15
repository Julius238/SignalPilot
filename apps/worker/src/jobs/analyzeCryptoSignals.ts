import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
  socialSummary: "X/Social: noch nicht aktiv verbunden.",
  eventSummary: "Keine Event-Daten in diesem Scan.",
  impactSummary: "Signal basiert primär auf technischen Daten.",
  sources: []
};

export async function analyzeCryptoSignals(database: PrismaClient = prisma) {
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
            }
          });

          savedSignalCount += 1;

          if (isRelevantSignal(decision)) {
            await writeBotLog(database, "info", "Saved crypto technical signal", {
              botRunId: botRun.id,
              signalId: signal.id,
              assetId: asset.id,
              symbol: asset.symbol,
              timeframe,
              status: decision.status,
              direction: decision.direction,
              score: decision.score,
              signalType: decision.signalType,
              shortConclusion: outputDraft.shortConclusion,
              nextTrigger: outputDraft.nextTrigger
            });
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
        insufficientDataCount,
        errorCount
      }
    );
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

function isRelevantSignal(decision: SignalDecision): boolean {
  return decision.signalType !== "NO_SIGNAL" || decision.status === "WATCH" || decision.status === "STRONG_WATCH";
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
