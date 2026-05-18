import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  PaperExpectedMoveDirection,
  Prisma,
  prisma,
  SignalDirection,
  SignalStatus,
  SignalType,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

const horizons = {
  priceAfter1h: 60 * 60 * 1000,
  priceAfter4h: 4 * 60 * 60 * 1000,
  priceAfter1d: 24 * 60 * 60 * 1000,
  priceAfter3d: 3 * 24 * 60 * 60 * 1000
} as const;
const expirationMs = 4 * 24 * 60 * 60 * 1000;
const observationReturnThreshold = 0.75;
const observationMoveThreshold = 1.5;
const riskWarningAdverseMoveThreshold = 1.5;
const riskWarningReturnThreshold = 0.75;

export type CreatePaperEvaluationsSummary = {
  status: BotRunStatus;
  scannedSignalCount: number;
  createdEvaluationCount: number;
  skippedSignalCount: number;
  duplicateSkipCount: number;
  missingEntryPriceCount: number;
  errorCount: number;
};

export type EvaluatePaperSignalsSummary = {
  status: BotRunStatus;
  openEvaluationCount: number;
  evaluatedCount: number;
  expiredCount: number;
  stillOpenCount: number;
  errorCount: number;
};

export type ReclassifyPaperEvaluationsSummary = {
  status: BotRunStatus;
  scannedCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedToOpenCount: number;
  openToSkippedCount: number;
  evaluatedUpdatedCount: number;
  byOldKind: Record<string, number>;
  byNewKind: Record<string, number>;
  dryRun: boolean;
};

export type BackfillPaperEvaluationsSummary = {
  status: BotRunStatus;
  scannedSignals: number;
  createdCount: number;
  skippedCount: number;
  alreadyExistsCount: number;
  missingEntryPriceCount: number;
  byEvaluationKind: Record<string, number>;
};

type PaperSignal = Prisma.SignalGetPayload<{
  include: { output: true; paperEvaluation: true };
}>;
type PaperEvaluationWithSignal = Prisma.PaperSignalEvaluationGetPayload<{
  include: { signal: true };
}>;

type EvaluationRecord = Prisma.PaperSignalEvaluationGetPayload<Record<string, never>>;
type CandleRecord = Prisma.CandleGetPayload<Record<string, never>>;

export async function createPaperEvaluationsForSignals(
  database: PrismaClient = prisma
): Promise<CreatePaperEvaluationsSummary> {
  const startedAt = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "createPaperEvaluationsForSignals",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        startedAt: startedAt.toISOString()
      }
    }
  });

  let scannedSignalCount = 0;
  let createdEvaluationCount = 0;
  let skippedSignalCount = 0;
  let duplicateSkipCount = 0;
  let missingEntryPriceCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "Paper Evaluation creation started", {
    botRunId: botRun.id
  });

  try {
    const signals = await database.signal.findMany({
      where: {
        paperEvaluation: {
          is: null
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      take: 500,
      include: {
        output: true,
        paperEvaluation: true
      }
    });

    for (const signal of signals) {
      scannedSignalCount += 1;

      try {
        const classification = classifyPaperEvaluation(signal);

        const entryCandle = await findEntryCandle(database, signal);

        if (!entryCandle) {
          missingEntryPriceCount += 1;
          continue;
        }

        const entryPrice = toNumber(entryCandle.close);
        const atr = extractAtr(signal.output?.technicalJson) ?? extractAtr(signal.output?.dashboardJson);
        const prices = buildInvalidationAndTarget(classification.evaluationKind, signal, entryPrice, atr);

        await database.paperSignalEvaluation.create({
          data: {
            signalId: signal.id,
            assetId: signal.assetId,
            symbol: signal.symbol,
            timeframe: signal.timeframe,
            direction: signal.direction,
            status: signal.status,
            signalType: signal.signalType,
            score: signal.score,
            riskLevel: signal.riskLevel,
            entryPrice: new Prisma.Decimal(entryPrice),
            invalidationPrice: new Prisma.Decimal(prices.invalidationPrice),
            targetPrice: new Prisma.Decimal(prices.targetPrice),
            evaluationKind: classification.evaluationKind,
            expectedMoveDirection: classification.expectedMoveDirection,
            evaluationStatus: classification.evaluationStatus,
            skipReason: classification.skipReason,
            openedAt: entryCandle.closeTime,
            evaluatedAt:
              classification.evaluationStatus === PaperEvaluationStatus.SKIPPED
                ? new Date()
                : undefined
          }
        });

        if (classification.evaluationStatus === PaperEvaluationStatus.SKIPPED) {
          skippedSignalCount += 1;
        } else {
          createdEvaluationCount += 1;
        }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          duplicateSkipCount += 1;
          continue;
        }

        errorCount += 1;
        await writeBotLog(database, "error", "Paper Evaluation creation failed for signal", {
          botRunId: botRun.id,
          signalId: signal.id,
          symbol: signal.symbol,
          error: error instanceof Error ? error.message : "unknown error"
        });
      }
    }

    const status = errorCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
    const summary = {
      status,
      scannedSignalCount,
      createdEvaluationCount,
      skippedSignalCount,
      duplicateSkipCount,
      missingEntryPriceCount,
      errorCount
    };

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: summary as Prisma.InputJsonObject
      }
    });
    await writeBotLog(database, status === BotRunStatus.SUCCESS ? "info" : "warn", "Paper Evaluation creation finished", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown createPaperEvaluations error";
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          scannedSignalCount,
          createdEvaluationCount,
          skippedSignalCount,
          duplicateSkipCount,
          missingEntryPriceCount,
          errorCount,
          fatalError: message
        }
      }
    });
    await writeBotLog(database, "error", "Paper Evaluation creation failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

export async function evaluatePaperSignals(
  database: PrismaClient = prisma
): Promise<EvaluatePaperSignalsSummary> {
  const startedAt = new Date();
  const now = new Date();
  const botRun = await database.botRun.create({
    data: {
      jobName: "evaluatePaperSignals",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        startedAt: startedAt.toISOString()
      }
    }
  });

  let openEvaluationCount = 0;
  let evaluatedCount = 0;
  let expiredCount = 0;
  let stillOpenCount = 0;
  let errorCount = 0;

  await writeBotLog(database, "info", "Paper Evaluation scoring started", {
    botRunId: botRun.id
  });

  try {
    const evaluations = await database.paperSignalEvaluation.findMany({
      where: {
        evaluationStatus: PaperEvaluationStatus.OPEN
      },
      orderBy: {
        openedAt: "asc"
      },
      take: 500
    });
    openEvaluationCount = evaluations.length;

    for (const evaluation of evaluations) {
      try {
        const candles = await database.candle.findMany({
          where: {
            assetId: evaluation.assetId,
            timeframe: evaluation.timeframe,
            closeTime: {
              gte: evaluation.openedAt
            }
          },
          orderBy: {
            closeTime: "asc"
          },
          take: 2000
        });

        const metrics = buildEvaluationMetrics(evaluation, candles);

        if (!metrics.priceAfter1d) {
          if (now.getTime() - evaluation.openedAt.getTime() >= expirationMs) {
            await database.paperSignalEvaluation.update({
              where: { id: evaluation.id },
              data: {
                evaluationStatus: PaperEvaluationStatus.EXPIRED,
                evaluatedAt: now,
                notes: "Expired after 4 days without enough candle data."
              }
            });
            expiredCount += 1;
          } else {
            stillOpenCount += 1;
          }

          continue;
        }

        const outcome = determineOutcome(evaluation, metrics);
        await database.paperSignalEvaluation.update({
          where: { id: evaluation.id },
          data: {
            evaluationStatus: PaperEvaluationStatus.EVALUATED,
            evaluatedAt: now,
            priceAfter1h: toDecimalOrUndefined(metrics.priceAfter1h),
            priceAfter4h: toDecimalOrUndefined(metrics.priceAfter4h),
            priceAfter1d: toDecimalOrUndefined(metrics.priceAfter1d),
            priceAfter3d: toDecimalOrUndefined(metrics.priceAfter3d),
            returnAfter1h: metrics.returnAfter1h,
            returnAfter4h: metrics.returnAfter4h,
            returnAfter1d: metrics.returnAfter1d,
            returnAfter3d: metrics.returnAfter3d,
            maxFavorableMove: metrics.maxFavorableMove,
            maxAdverseMove: metrics.maxAdverseMove,
            outcome
          }
        });
        evaluatedCount += 1;
      } catch (error) {
        errorCount += 1;
        await writeBotLog(database, "error", "Paper Evaluation scoring failed for evaluation", {
          botRunId: botRun.id,
          evaluationId: evaluation.id,
          symbol: evaluation.symbol,
          error: error instanceof Error ? error.message : "unknown error"
        });
      }
    }

    const status = errorCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
    const summary = {
      status,
      openEvaluationCount,
      evaluatedCount,
      expiredCount,
      stillOpenCount,
      errorCount
    };

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status,
        finishedAt: new Date(),
        metadataJson: summary as Prisma.InputJsonObject
      }
    });
    await writeBotLog(database, status === BotRunStatus.SUCCESS ? "info" : "warn", "Paper Evaluation scoring finished", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown evaluatePaperSignals error";
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          openEvaluationCount,
          evaluatedCount,
          expiredCount,
          stillOpenCount,
          errorCount,
          fatalError: message
        }
      }
    });
    await writeBotLog(database, "error", "Paper Evaluation scoring failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

export async function reclassifyPaperEvaluations(
  database: PrismaClient = prisma
): Promise<ReclassifyPaperEvaluationsSummary> {
  const startedAt = new Date();
  const dryRun = parseBooleanEnv(process.env.RECLASSIFY_DRY_RUN, true);
  const batchSize = parsePositiveIntegerEnv(process.env.RECLASSIFY_BATCH_SIZE, 100);
  const botRun = await database.botRun.create({
    data: {
      jobName: "reclassifyPaperEvaluations",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        startedAt: startedAt.toISOString(),
        dryRun,
        batchSize
      }
    }
  });

  let scannedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedToOpenCount = 0;
  let openToSkippedCount = 0;
  let evaluatedUpdatedCount = 0;
  const byOldKind: Record<string, number> = {};
  const byNewKind: Record<string, number> = {};

  await writeBotLog(database, "info", "Paper Evaluation reclassification started", {
    botRunId: botRun.id,
    dryRun,
    batchSize
  });

  try {
    let cursor: string | undefined;

    while (true) {
      const evaluations = await database.paperSignalEvaluation.findMany({
        where: cursor
          ? {
              id: {
                gt: cursor
              }
            }
          : undefined,
        orderBy: {
          id: "asc"
        },
        take: batchSize,
        include: {
          signal: true
        }
      });

      if (evaluations.length === 0) {
        break;
      }

      const updates: Prisma.PrismaPromise<unknown>[] = [];

      for (const evaluation of evaluations) {
        scannedCount += 1;
        byOldKind[evaluation.evaluationKind] = (byOldKind[evaluation.evaluationKind] ?? 0) + 1;

        const reclassification = buildReclassification(evaluation);
        byNewKind[reclassification.evaluationKind] =
          (byNewKind[reclassification.evaluationKind] ?? 0) + 1;

        if (!reclassification.changed) {
          unchangedCount += 1;
          continue;
        }

        updatedCount += 1;

        if (
          evaluation.evaluationStatus === PaperEvaluationStatus.SKIPPED &&
          reclassification.data.evaluationStatus === PaperEvaluationStatus.OPEN
        ) {
          skippedToOpenCount += 1;
        }

        if (
          evaluation.evaluationStatus === PaperEvaluationStatus.OPEN &&
          reclassification.data.evaluationStatus === PaperEvaluationStatus.SKIPPED
        ) {
          openToSkippedCount += 1;
        }

        if (evaluation.evaluationStatus === PaperEvaluationStatus.EVALUATED) {
          evaluatedUpdatedCount += 1;
        }

        if (!dryRun) {
          updates.push(
            database.paperSignalEvaluation.update({
              where: { id: evaluation.id },
              data: reclassification.data
            })
          );
        }
      }

      if (updates.length > 0) {
        await database.$transaction(updates);
      }

      cursor = evaluations[evaluations.length - 1].id;
    }

    const summary = {
      status: BotRunStatus.SUCCESS,
      scannedCount,
      updatedCount,
      unchangedCount,
      skippedToOpenCount,
      openToSkippedCount,
      evaluatedUpdatedCount,
      byOldKind,
      byNewKind,
      dryRun
    };

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.SUCCESS,
        finishedAt: new Date(),
        metadataJson: summary
      }
    });
    await writeBotLog(database, "info", "Paper Evaluation reclassification finished", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reclassifyPaperEvaluations error";
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          scannedCount,
          updatedCount,
          unchangedCount,
          skippedToOpenCount,
          openToSkippedCount,
          evaluatedUpdatedCount,
          byOldKind,
          byNewKind,
          dryRun,
          fatalError: message
        }
      }
    });
    await writeBotLog(database, "error", "Paper Evaluation reclassification failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

export async function backfillPaperEvaluations(
  database: PrismaClient = prisma
): Promise<BackfillPaperEvaluationsSummary> {
  const startedAt = new Date();
  const symbol = process.env.BACKFILL_SYMBOL?.trim().toUpperCase() || undefined;
  const from = parseOptionalDateEnv(process.env.BACKFILL_FROM);
  const to = parseOptionalDateEnv(process.env.BACKFILL_TO);
  const limit = parsePositiveIntegerEnv(process.env.BACKFILL_LIMIT, 500);
  const botRun = await database.botRun.create({
    data: {
      jobName: "backfillPaperEvaluations",
      status: BotRunStatus.RUNNING,
      startedAt,
      metadataJson: {
        startedAt: startedAt.toISOString(),
        symbol,
        from: from?.toISOString(),
        to: to?.toISOString(),
        limit
      }
    }
  });

  let scannedSignals = 0;
  let createdCount = 0;
  let skippedCount = 0;
  let alreadyExistsCount = 0;
  let missingEntryPriceCount = 0;
  const byEvaluationKind: Record<string, number> = {};

  await writeBotLog(database, "info", "Paper Evaluation backfill started", {
    botRunId: botRun.id,
    symbol,
    from: from?.toISOString(),
    to: to?.toISOString(),
    limit
  });

  try {
    const signals = await database.signal.findMany({
      where: {
        symbol,
        createdAt:
          from || to
            ? {
                gte: from,
                lte: to
              }
            : undefined,
        paperEvaluation: {
          is: null
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      take: limit,
      include: {
        output: true,
        paperEvaluation: true
      }
    });

    for (const signal of signals) {
      scannedSignals += 1;

      try {
        const classification = classifyPaperEvaluation(signal);
        byEvaluationKind[classification.evaluationKind] =
          (byEvaluationKind[classification.evaluationKind] ?? 0) + 1;

        const entryCandle = await findEntryCandle(database, signal);

        if (!entryCandle) {
          missingEntryPriceCount += 1;
          continue;
        }

        const entryPrice = toNumber(entryCandle.close);
        const atr = extractAtr(signal.output?.technicalJson) ?? extractAtr(signal.output?.dashboardJson);
        const prices = buildInvalidationAndTarget(classification.evaluationKind, signal, entryPrice, atr);

        await database.paperSignalEvaluation.create({
          data: {
            signalId: signal.id,
            assetId: signal.assetId,
            symbol: signal.symbol,
            timeframe: signal.timeframe,
            direction: signal.direction,
            status: signal.status,
            signalType: signal.signalType,
            score: signal.score,
            riskLevel: signal.riskLevel,
            entryPrice: new Prisma.Decimal(entryPrice),
            invalidationPrice: new Prisma.Decimal(prices.invalidationPrice),
            targetPrice: new Prisma.Decimal(prices.targetPrice),
            evaluationKind: classification.evaluationKind,
            expectedMoveDirection: classification.expectedMoveDirection,
            evaluationStatus: classification.evaluationStatus,
            skipReason: classification.skipReason,
            openedAt: entryCandle.closeTime,
            evaluatedAt:
              classification.evaluationStatus === PaperEvaluationStatus.SKIPPED
                ? new Date()
                : undefined
          }
        });

        if (classification.evaluationStatus === PaperEvaluationStatus.SKIPPED) {
          skippedCount += 1;
        } else {
          createdCount += 1;
        }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          alreadyExistsCount += 1;
          continue;
        }

        throw error;
      }
    }

    const summary = {
      status: BotRunStatus.SUCCESS,
      scannedSignals,
      createdCount,
      skippedCount,
      alreadyExistsCount,
      missingEntryPriceCount,
      byEvaluationKind
    };

    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.SUCCESS,
        finishedAt: new Date(),
        metadataJson: summary
      }
    });
    await writeBotLog(database, "info", "Paper Evaluation backfill finished", {
      botRunId: botRun.id,
      ...summary
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backfillPaperEvaluations error";
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: {
          scannedSignals,
          createdCount,
          skippedCount,
          alreadyExistsCount,
          missingEntryPriceCount,
          byEvaluationKind,
          fatalError: message
        }
      }
    });
    await writeBotLog(database, "error", "Paper Evaluation backfill failed", {
      botRunId: botRun.id,
      error: message
    });
    throw error;
  }
}

export function isEvaluableSignal(signal: {
  direction: SignalDirection;
  status: SignalStatus;
  signalType: SignalType;
  riskLevel: string;
  score: number;
}) {
  return classifyPaperEvaluation(signal).evaluationStatus === PaperEvaluationStatus.OPEN;
}

export function calculateReturn(entryPrice: number, laterPrice: number) {
  return ((laterPrice - entryPrice) / entryPrice) * 100;
}

export function classifyPaperEvaluation(signal: {
  direction: SignalDirection;
  status: SignalStatus;
  signalType: SignalType;
  riskLevel: string;
  score: number;
}): {
  evaluationKind: PaperEvaluationKind;
  expectedMoveDirection: PaperExpectedMoveDirection;
  evaluationStatus: PaperEvaluationStatus;
  skipReason?: string;
} {
  if (signal.status === SignalStatus.NO_EDGE) {
    return {
      evaluationKind: PaperEvaluationKind.SKIPPED,
      expectedMoveDirection: PaperExpectedMoveDirection.NONE,
      evaluationStatus: PaperEvaluationStatus.SKIPPED,
      skipReason: "NO_EDGE signal has no measurable evaluation edge."
    };
  }

  if (signal.status === SignalStatus.WAIT && signal.score < 65) {
    return {
      evaluationKind: PaperEvaluationKind.SKIPPED,
      expectedMoveDirection: PaperExpectedMoveDirection.NONE,
      evaluationStatus: PaperEvaluationStatus.SKIPPED,
      skipReason: "WAIT signal below evaluation threshold."
    };
  }

  if (signal.status === SignalStatus.AVOID || signal.riskLevel === "HIGH") {
    return {
      evaluationKind: PaperEvaluationKind.RISK_WARNING,
      expectedMoveDirection: PaperExpectedMoveDirection.ANY,
      evaluationStatus: PaperEvaluationStatus.OPEN
    };
  }

  if (signal.direction === SignalDirection.BULLISH) {
    return {
      evaluationKind: PaperEvaluationKind.DIRECTIONAL_BULLISH,
      expectedMoveDirection: PaperExpectedMoveDirection.UP,
      evaluationStatus: PaperEvaluationStatus.OPEN
    };
  }

  if (signal.direction === SignalDirection.BEARISH) {
    return {
      evaluationKind: PaperEvaluationKind.DIRECTIONAL_BEARISH,
      expectedMoveDirection: PaperExpectedMoveDirection.DOWN,
      evaluationStatus: PaperEvaluationStatus.OPEN
    };
  }

  if (
    (signal.status === SignalStatus.STRONG_WATCH || signal.status === SignalStatus.WATCH) &&
    signal.score >= 65
  ) {
    return {
      evaluationKind: PaperEvaluationKind.OBSERVATION,
      expectedMoveDirection: PaperExpectedMoveDirection.ANY,
      evaluationStatus: PaperEvaluationStatus.OPEN
    };
  }

  if (
    signal.signalType === SignalType.BREAKOUT_ALERT ||
    signal.signalType === SignalType.VOLUME_SPIKE ||
    signal.signalType === SignalType.VOLATILITY_SPIKE
  ) {
    return {
      evaluationKind: PaperEvaluationKind.OBSERVATION,
      expectedMoveDirection: PaperExpectedMoveDirection.ANY,
      evaluationStatus: PaperEvaluationStatus.OPEN
    };
  }

  return {
    evaluationKind: PaperEvaluationKind.SKIPPED,
    expectedMoveDirection: PaperExpectedMoveDirection.NONE,
    evaluationStatus: PaperEvaluationStatus.SKIPPED,
    skipReason: "Neutral or mixed signal without sufficient evaluation strength."
  };
}

function buildInvalidationAndTarget(
  evaluationKind: PaperEvaluationKind,
  signal: { direction: SignalDirection; status: SignalStatus },
  entryPrice: number,
  atr?: number
) {
  const invalidationDistance = atr && atr > 0 ? atr * 1.5 : entryPrice * 0.02;
  const targetDistance = atr && atr > 0 ? atr * 3 : entryPrice * 0.04;

  if (evaluationKind === PaperEvaluationKind.DIRECTIONAL_BEARISH || isBearishEvaluation(signal)) {
    return {
      invalidationPrice: entryPrice + invalidationDistance,
      targetPrice: entryPrice - targetDistance
    };
  }

  return {
    invalidationPrice: entryPrice - invalidationDistance,
    targetPrice: entryPrice + targetDistance
  };
}

function buildReclassification(evaluation: PaperEvaluationWithSignal): {
  changed: boolean;
  evaluationKind: PaperEvaluationKind;
  data: Prisma.PaperSignalEvaluationUpdateInput;
} {
  const classification = classifyPaperEvaluation(evaluation.signal);
  const nextStatus = nextEvaluationStatus(evaluation.evaluationStatus, classification.evaluationStatus);
  const nextSkipReason =
    classification.evaluationStatus === PaperEvaluationStatus.SKIPPED ? classification.skipReason : null;
  const data = {
    evaluationKind: classification.evaluationKind,
    expectedMoveDirection: classification.expectedMoveDirection,
    evaluationStatus: nextStatus,
    skipReason: nextSkipReason
  } satisfies Prisma.PaperSignalEvaluationUpdateInput;

  return {
    evaluationKind: classification.evaluationKind,
    changed:
      evaluation.evaluationKind !== data.evaluationKind ||
      evaluation.expectedMoveDirection !== data.expectedMoveDirection ||
      evaluation.evaluationStatus !== data.evaluationStatus ||
      (evaluation.skipReason ?? null) !== data.skipReason,
    data
  };
}

function nextEvaluationStatus(
  currentStatus: PaperEvaluationStatus,
  classifiedStatus: PaperEvaluationStatus
) {
  if (currentStatus === PaperEvaluationStatus.EVALUATED) {
    return PaperEvaluationStatus.EVALUATED;
  }

  if (currentStatus === PaperEvaluationStatus.EXPIRED) {
    return classifiedStatus === PaperEvaluationStatus.SKIPPED
      ? PaperEvaluationStatus.SKIPPED
      : PaperEvaluationStatus.EXPIRED;
  }

  if (currentStatus === PaperEvaluationStatus.SKIPPED) {
    return classifiedStatus === PaperEvaluationStatus.OPEN
      ? PaperEvaluationStatus.OPEN
      : PaperEvaluationStatus.SKIPPED;
  }

  return classifiedStatus;
}

function buildEvaluationMetrics(evaluation: EvaluationRecord, candles: CandleRecord[]) {
  const entryPrice = toNumber(evaluation.entryPrice);
  const priceAfter1h = priceAtOrAfter(candles, evaluation.openedAt, horizons.priceAfter1h);
  const priceAfter4h = priceAtOrAfter(candles, evaluation.openedAt, horizons.priceAfter4h);
  const priceAfter1d = priceAtOrAfter(candles, evaluation.openedAt, horizons.priceAfter1d);
  const priceAfter3d = priceAtOrAfter(candles, evaluation.openedAt, horizons.priceAfter3d);
  const moveStats = calculateMoveStats(evaluation, candles);

  return {
    priceAfter1h,
    priceAfter4h,
    priceAfter1d,
    priceAfter3d,
    returnAfter1h: priceAfter1h === undefined ? undefined : calculateReturn(entryPrice, priceAfter1h),
    returnAfter4h: priceAfter4h === undefined ? undefined : calculateReturn(entryPrice, priceAfter4h),
    returnAfter1d: priceAfter1d === undefined ? undefined : calculateReturn(entryPrice, priceAfter1d),
    returnAfter3d: priceAfter3d === undefined ? undefined : calculateReturn(entryPrice, priceAfter3d),
    ...moveStats
  };
}

function determineOutcome(
  evaluation: EvaluationRecord,
  metrics: ReturnType<typeof buildEvaluationMetrics>
) {
  if (evaluation.evaluationKind === PaperEvaluationKind.OBSERVATION) {
    return determineObservationOutcome(evaluation, metrics);
  }

  if (evaluation.evaluationKind === PaperEvaluationKind.RISK_WARNING) {
    return determineRiskWarningOutcome(metrics);
  }

  const isBearish = isBearishEvaluation(evaluation);

  if (targetWasReached(evaluation, metrics.maxFavorableMove)) {
    return PaperEvaluationOutcome.TARGET_REACHED;
  }

  if (invalidationWasReached(evaluation, metrics.maxAdverseMove)) {
    return PaperEvaluationOutcome.INVALIDATED;
  }

  const oneDayReturn = metrics.returnAfter1d ?? 0;

  if (isBearish) {
    if (oneDayReturn < -0.5) {
      return PaperEvaluationOutcome.POSITIVE;
    }

    if (oneDayReturn > 0.5) {
      return PaperEvaluationOutcome.NEGATIVE;
    }

    return PaperEvaluationOutcome.NEUTRAL;
  }

  if (oneDayReturn > 0.5) {
    return PaperEvaluationOutcome.POSITIVE;
  }

  if (oneDayReturn < -0.5) {
    return PaperEvaluationOutcome.NEGATIVE;
  }

  return PaperEvaluationOutcome.NEUTRAL;
}

function determineObservationOutcome(
  evaluation: EvaluationRecord,
  metrics: ReturnType<typeof buildEvaluationMetrics>
) {
  const absoluteReturnAfter1d = Math.abs(metrics.returnAfter1d ?? 0);
  const hasRelevantMovement =
    absoluteReturnAfter1d >= observationReturnThreshold ||
    metrics.maxFavorableMove >= observationMoveThreshold ||
    metrics.maxAdverseMove >= observationMoveThreshold;

  if (hasRelevantMovement) {
    return PaperEvaluationOutcome.POSITIVE;
  }

  return evaluation.score >= 80 ? PaperEvaluationOutcome.NEGATIVE : PaperEvaluationOutcome.NEUTRAL;
}

function determineRiskWarningOutcome(metrics: ReturnType<typeof buildEvaluationMetrics>) {
  const oneDayReturn = metrics.returnAfter1d ?? 0;

  if (
    metrics.maxAdverseMove >= riskWarningAdverseMoveThreshold ||
    oneDayReturn <= -riskWarningReturnThreshold ||
    Math.abs(oneDayReturn) >= observationReturnThreshold
  ) {
    return PaperEvaluationOutcome.POSITIVE;
  }

  if (oneDayReturn > riskWarningReturnThreshold && metrics.maxAdverseMove < riskWarningAdverseMoveThreshold / 2) {
    return PaperEvaluationOutcome.NEGATIVE;
  }

  return PaperEvaluationOutcome.NEUTRAL;
}

function targetWasReached(evaluation: EvaluationRecord, maxFavorableMove: number) {
  const target = evaluation.targetPrice === null ? null : toNumber(evaluation.targetPrice);

  if (target === null) {
    return false;
  }

  const entryPrice = toNumber(evaluation.entryPrice);
  const requiredMove = Math.abs(calculateReturn(entryPrice, target));
  return maxFavorableMove >= requiredMove;
}

function invalidationWasReached(evaluation: EvaluationRecord, maxAdverseMove: number) {
  const invalidation = evaluation.invalidationPrice === null ? null : toNumber(evaluation.invalidationPrice);

  if (invalidation === null) {
    return false;
  }

  const entryPrice = toNumber(evaluation.entryPrice);
  const requiredMove = Math.abs(calculateReturn(entryPrice, invalidation));
  return maxAdverseMove >= requiredMove;
}

function calculateMoveStats(evaluation: EvaluationRecord, candles: CandleRecord[]) {
  const entryPrice = toNumber(evaluation.entryPrice);
  const isBearish =
    evaluation.evaluationKind === PaperEvaluationKind.DIRECTIONAL_BEARISH ||
    isBearishEvaluation(evaluation);
  let maxFavorableMove = 0;
  let maxAdverseMove = 0;

  for (const candle of candles) {
    const highReturn = calculateReturn(entryPrice, toNumber(candle.high));
    const lowReturn = calculateReturn(entryPrice, toNumber(candle.low));

    if (isBearish) {
      maxFavorableMove = Math.max(maxFavorableMove, Math.abs(Math.min(lowReturn, 0)));
      maxAdverseMove = Math.max(maxAdverseMove, Math.max(highReturn, 0));
    } else {
      maxFavorableMove = Math.max(maxFavorableMove, Math.max(highReturn, 0));
      maxAdverseMove = Math.max(maxAdverseMove, Math.abs(Math.min(lowReturn, 0)));
    }
  }

  return {
    maxFavorableMove,
    maxAdverseMove
  };
}

function priceAtOrAfter(candles: CandleRecord[], openedAt: Date, offsetMs: number) {
  const targetTime = new Date(openedAt.getTime() + offsetMs);
  const candle = candles.find((candidate) => candidate.closeTime >= targetTime);
  return candle ? toNumber(candle.close) : undefined;
}

function isBearishEvaluation(evaluation: { direction: SignalDirection; status: SignalStatus }) {
  return evaluation.direction === SignalDirection.BEARISH || evaluation.status === SignalStatus.AVOID;
}

async function findEntryCandle(database: PrismaClient, signal: PaperSignal) {
  const atOrBefore = await database.candle.findFirst({
    where: {
      assetId: signal.assetId,
      timeframe: signal.timeframe,
      closeTime: {
        lte: signal.createdAt
      }
    },
    orderBy: {
      closeTime: "desc"
    }
  });

  if (atOrBefore) {
    return atOrBefore;
  }

  return database.candle.findFirst({
    where: {
      assetId: signal.assetId,
      timeframe: signal.timeframe,
      closeTime: {
        gt: signal.createdAt
      }
    },
    orderBy: {
      closeTime: "asc"
    }
  });
}

function extractAtr(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase() === "atr") {
      const parsed = typeof nested === "number" ? nested : Number(nested);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    const child = extractAtr(nested);

    if (child !== undefined) {
      return child;
    }
  }

  return undefined;
}

function toNumber(value: Prisma.Decimal | number | string) {
  return typeof value === "number" ? value : Number(value.toString());
}

function toDecimalOrUndefined(value: number | undefined) {
  return value === undefined ? undefined : new Prisma.Decimal(value);
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return value.trim().toLowerCase() === "true";
}

function parsePositiveIntegerEnv(value: string | undefined, defaultValue: number) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseOptionalDateEnv(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
    const command = process.argv[2] ?? "create";

    if (command === "evaluate") {
      await evaluatePaperSignals();
      logger.info("evaluatePaperSignals completed");
    } else if (command === "reclassify") {
      await reclassifyPaperEvaluations();
      logger.info("reclassifyPaperEvaluations completed");
    } else if (command === "backfill") {
      await backfillPaperEvaluations();
      logger.info("backfillPaperEvaluations completed");
    } else {
      await createPaperEvaluationsForSignals();
      logger.info("createPaperEvaluationsForSignals completed");
    }
  } finally {
    await prisma.$disconnect();
  }
}
