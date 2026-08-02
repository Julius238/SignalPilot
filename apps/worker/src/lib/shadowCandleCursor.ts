/**
 * Shared "next unprocessed closed candle" cursor for the fill and monitor
 * jobs.
 *
 * Specification: docs/trading/02-shadow-trading-target-architecture.md,
 * "Eine Candle wird je Order/Position durch `lastProcessedCandleId` ... genau
 * einmal verarbeitet." Never returns a candle the caller has already
 * processed and never returns one that closes after `asOf` — a running candle
 * is never used (docs/trading/07).
 */

import type { PrismaClient } from "@signalpilot/database";

export interface NextCandleInput {
  readonly assetId: string;
  readonly timeframe: string;
  readonly lastProcessedCandleId: string | null;
  readonly earliestEligibleAt: Date;
  readonly asOf: Date;
}

export async function findNextUnprocessedCandle(database: PrismaClient, input: NextCandleInput) {
  if (input.lastProcessedCandleId !== null) {
    const last = await database.candle.findUnique({ where: { id: input.lastProcessedCandleId } });
    if (last === null) {
      return database.candle.findFirst({
        where: {
          assetId: input.assetId,
          timeframe: input.timeframe,
          openTime: { gte: input.earliestEligibleAt },
          closeTime: { lte: input.asOf }
        },
        orderBy: { openTime: "asc" }
      });
    }
    return database.candle.findFirst({
      where: {
        assetId: input.assetId,
        timeframe: input.timeframe,
        openTime: { gt: last.openTime },
        closeTime: { lte: input.asOf }
      },
      orderBy: { openTime: "asc" }
    });
  }
  return database.candle.findFirst({
    where: {
      assetId: input.assetId,
      timeframe: input.timeframe,
      openTime: { gte: input.earliestEligibleAt },
      closeTime: { lte: input.asOf }
    },
    orderBy: { openTime: "asc" }
  });
}
