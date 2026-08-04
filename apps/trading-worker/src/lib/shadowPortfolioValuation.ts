import type { PrismaClient } from "@signalpilot/database";
import {
  computeConservativeMark,
  computePortfolioValuation,
  computePositionMark,
  type PortfolioValuationResultV1,
  type PositionMarkResultV1
} from "@signalpilot/portfolio";

import { decimalString } from "./shadowPortfolioIo.js";

const EXPOSURE_POSITION_STATUSES = [
  "OPENING",
  "OPEN",
  "PARTIALLY_CLOSED",
  "ERROR"
] as const;

type ValuationDatabase = Pick<
  PrismaClient,
  "shadowPosition" | "candle" | "instrumentExecutionProfile"
>;

export interface ShadowPositionValuationV1 extends PositionMarkResultV1 {
  readonly shadowPositionId: string;
  readonly assetId: string;
  readonly direction: "LONG" | "SHORT";
  readonly markPrice: string;
  readonly sourceCandleId: string;
  readonly executionProfileId: string;
}

export interface LoadShadowPortfolioValuationInput {
  readonly portfolioId: string;
  readonly asOf: Date;
  readonly availableCash: string;
  readonly reservedCash: string;
  readonly realizedPnl: string;
  readonly feesPaid: string;
  readonly highWaterMark: string;
  readonly startOfDayEquity: string | null;
}

export interface LoadedShadowPortfolioValuation {
  readonly valuation: PortfolioValuationResultV1;
  readonly marks: readonly ShadowPositionValuationV1[];
}

/**
 * One fail-closed mark-to-market path for worker, risk, reconciliation and
 * snapshots. LONG closes at the conservative bid; synthetic SHORT closes at
 * the conservative ask. Missing market/profile data never becomes a zero mark.
 */
export async function loadShadowPortfolioValuation(
  database: ValuationDatabase,
  input: LoadShadowPortfolioValuationInput
): Promise<LoadedShadowPortfolioValuation> {
  const positions = await database.shadowPosition.findMany({
    where: {
      portfolioId: input.portfolioId,
      status: { in: [...EXPOSURE_POSITION_STATUSES] }
    }
  });

  const marks: ShadowPositionValuationV1[] = [];
  for (const position of positions) {
    if (position.direction !== "LONG" && position.direction !== "SHORT") {
      throw new Error(
        `Position ${position.id} has unknown direction ${String(position.direction)}.`
      );
    }
    const [candle, profile] = await Promise.all([
      database.candle.findFirst({
        where: {
          assetId: position.assetId,
          timeframe: "1h",
          closeTime: { lte: input.asOf }
        },
        orderBy: { closeTime: "desc" }
      }),
      database.instrumentExecutionProfile.findFirst({
        where: { assetId: position.assetId, status: "ACTIVE" },
        orderBy: { version: "desc" }
      })
    ]);
    if (candle === null || profile === null) {
      throw new Error(
        `Position ${position.id} cannot be valued without a closed candle and active profile.`
      );
    }
    const markPrice = computeConservativeMark(
      position.direction,
      decimalString(candle.close),
      profile.fullSpreadBps,
      decimalString(profile.tickSize)
    );
    if (markPrice === null)
      throw new Error(
        `Position ${position.id} has an invalid directional mark.`
      );
    const mark = computePositionMark({
      direction: position.direction,
      openQuantity: decimalString(position.openQuantity),
      averageEntryPrice: decimalString(position.averageEntryPrice),
      conservativeBidMark: markPrice,
      estimatedExitFeeRate: (profile.feeBps / 10_000).toFixed(12)
    });
    if (mark === null)
      throw new Error(`Position ${position.id} has invalid valuation inputs.`);
    marks.push({
      ...mark,
      shadowPositionId: position.id,
      assetId: position.assetId,
      direction: position.direction,
      markPrice,
      sourceCandleId: candle.id,
      executionProfileId: profile.id
    });
  }

  const valuation = computePortfolioValuation({
    availableCash: input.availableCash,
    reservedCash: input.reservedCash,
    realizedPnl: input.realizedPnl,
    feesPaid: input.feesPaid,
    openPositionMarks: marks,
    highWaterMark: input.highWaterMark,
    startOfDayEquity: input.startOfDayEquity
  });
  if (valuation === null)
    throw new Error(
      `Portfolio ${input.portfolioId} has invalid valuation inputs.`
    );
  return { valuation, marks };
}
