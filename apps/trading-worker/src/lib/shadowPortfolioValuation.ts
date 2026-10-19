import type { PrismaClient } from "@signalpilot/database";
import {
  computeConservativeMark,
  computePortfolioValuation,
  computePositionMark,
  type PortfolioValuationResultV1,
  type PositionMarkResultV1
} from "@signalpilot/portfolio";

import {
  loadActiveExecutionProfile,
  riskReducingExecutionProfile
} from "./executionProfileIntegrity.js";
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

/**
 * Which candle prices each open position.
 * - `NEWEST_CANDLE` (default): the newest closed 1h candle at `asOf`, a fresh
 *   market view for risk, arena and reporting.
 * - `BOOKED_CANDLE`: the candle the position's exits were last evaluated on,
 *   its persisted `lastProcessedCandleId`. Every writer of `Portfolio.equity`
 *   and the reconciliation use it, so the cache and its check share one
 *   persisted basis however the scheduler interleaves (ADR 0025). A position
 *   without that candle id falls back to the newest candle, as before.
 */
export type ShadowValuationBasis = "NEWEST_CANDLE" | "BOOKED_CANDLE";

export interface LoadShadowPortfolioValuationInput {
  readonly portfolioId: string;
  readonly asOf: Date;
  readonly availableCash: string;
  readonly reservedCash: string;
  readonly realizedPnl: string;
  readonly feesPaid: string;
  readonly highWaterMark: string;
  readonly startOfDayEquity: string | null;
  readonly basis?: ShadowValuationBasis;
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
    },
    include: { asset: { select: { symbol: true } } }
  });

  const marks: ShadowPositionValuationV1[] = [];
  for (const position of positions) {
    if (position.direction !== "LONG" && position.direction !== "SHORT") {
      throw new Error(
        `Position ${position.id} has unknown direction ${String(position.direction)}.`
      );
    }
    const bookedCandleId =
      input.basis === "BOOKED_CANDLE" ? position.lastProcessedCandleId : null;
    const [candle, active] = await Promise.all([
      bookedCandleId === null
        ? database.candle.findFirst({
            where: {
              assetId: position.assetId,
              timeframe: "1h",
              closeTime: { lte: input.asOf }
            },
            orderBy: { closeTime: "desc" }
          })
        : database.candle.findUnique({ where: { id: bookedCandleId } }),
      loadActiveExecutionProfile(database, position.assetId)
    ]);
    if (candle === null || active.row === null) {
      throw new Error(
        `Position ${position.id} cannot be valued without a closed candle and active profile.`
      );
    }
    if (
      bookedCandleId !== null &&
      (candle.assetId !== position.assetId || candle.timeframe !== "1h")
    ) {
      throw new Error(
        `Position ${position.id} is booked on a candle of another asset or timeframe.`
      );
    }
    // Marks feed equity, daily P&L and the kill switch, and run inside every
    // exit: a deviating row is replaced by the approved profile, never used
    // and never a reason to fail (ADR 0023).
    const profile = riskReducingExecutionProfile(
      { ...active, row: active.row },
      position.asset?.symbol ?? null,
      position.assetId
    ).values;
    const markPrice = computeConservativeMark(
      position.direction,
      decimalString(candle.close),
      profile.fullSpreadBps,
      profile.tickSize
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
