/**
 * Input and output contracts of the shadow fill and exit simulation.
 *
 * Specification:
 *   docs/trading/07-shadow-execution-model.md (the model in full)
 *   docs/trading/decisions/0005-conservative-candle-simulation.md
 *   docs/trading/02-shadow-trading-target-architecture.md, module table
 *     ("packages/trading-simulation ... darf nicht Provider/Exchange
 *      anrufen, Portfolio direkt mutieren, Zufall ohne gespeicherten Seed
 *      verwenden").
 *
 * Everything crossing this boundary is plain JSON: ISO-8601 UTC strings and
 * canonical fixed-scale decimal strings. No `Date`, no `number` for a
 * monetary value, no class instance, no `process.env`, no network client and
 * no system clock — every timestamp the module reasons about is part of the
 * candle or the plan the caller supplies.
 */

import type {
  DecimalString,
  TradeDirection
} from "@signalpilot/trading-domain";

import type { SimulationReasonCode } from "./reason-codes.js";

export type IsoDateTimeString = string;

/** One closed OHLCV candle exactly as persisted. */
export interface CandleSnapshotV1 {
  readonly id: string;
  readonly openTime: IsoDateTimeString;
  readonly closeTime: IsoDateTimeString;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly close: DecimalString;
  readonly volume: DecimalString;
}

/** The immutable execution-profile snapshot a `ShadowOrder` was accepted with. */
export interface ExecutionProfileSnapshotV1 {
  readonly id: string;
  readonly tickSize: DecimalString;
  readonly stepSize: DecimalString;
  readonly minQuantity: DecimalString;
  readonly minNotional: DecimalString;
  readonly maxQuantity: DecimalString | null;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: DecimalString;
  readonly specificationHash: string;
}

export const MarketSide = {
  BUY: "BUY",
  SELL: "SELL"
} as const;
export type MarketSide = (typeof MarketSide)[keyof typeof MarketSide];

/**
 * One candle's opportunity to fill a market order. `referencePrice` is the
 * pre-cost price the model is centred on: `candle.open` for an entry or a
 * gap exit, the capped take-profit price for an in-range take-profit, and so
 * on — `exit-resolution-v1.ts` derives it for exits.
 */
export interface MarketFillComputationInputV1 {
  readonly side: MarketSide;
  readonly referencePrice: DecimalString;
  /** Quantity still outstanding on the order before this candle. */
  readonly requestedQuantity: DecimalString;
  readonly candle: CandleSnapshotV1;
  readonly executionProfile: ExecutionProfileSnapshotV1;
  /**
   * Reserve still tied to an entry. LONG/BUY must cover notional plus fee;
   * synthetic SHORT/SELL must at least cover its fee here while the worker
   * retains the separately computed unleveraged collateral.
   */
  readonly reservedQuoteAmount?: DecimalString;
  /**
   * Quantity already open on the position, checked for either exit side so a
   * SELL long exit and BUY-to-close short exit cannot exceed exposure.
   */
  readonly openQuantity?: DecimalString;
}

/**
 * Every value a `ShadowFill` row needs to be reproduced later without
 * re-reading the candle or the profile (docs/trading/07, "Historisch zu
 * speichernde Filldaten").
 */
export interface MarketFillComputationResultV1 {
  readonly fillable: boolean;
  readonly reasonCode: SimulationReasonCode;
  readonly fillQuantity: DecimalString;
  readonly liquidityCap: DecimalString;
  readonly participationRate: DecimalString;
  readonly referencePrice: DecimalString;
  readonly fullSpreadAmount: DecimalString;
  readonly slippageAmount: DecimalString;
  readonly fillPrice: DecimalString;
  readonly notional: DecimalString;
  readonly feeAmount: DecimalString;
  readonly feeRate: DecimalString;
  readonly assumptions: Readonly<Record<string, unknown>>;
}

/** v1's single conservative intrabar-conflict policy (docs/trading/04). */
export const ExitTrigger = {
  STOP: "STOP",
  TAKE_PROFIT: "TAKE_PROFIT",
  TIME_EXIT: "TIME_EXIT"
} as const;
export type ExitTrigger = (typeof ExitTrigger)[keyof typeof ExitTrigger];

export interface ExitCandleInputV1 {
  readonly direction: TradeDirection;
  readonly stopPrice: DecimalString;
  readonly takeProfitPrice: DecimalString;
  readonly maxHoldUntil: IsoDateTimeString;
  readonly candle: CandleSnapshotV1;
}

export interface ExitResolutionResultV1 {
  readonly triggered: boolean;
  readonly trigger: ExitTrigger | null;
  /** Pre-cost reference price the market-fill step should centre on. */
  readonly referencePrice: DecimalString | null;
  readonly gapIndicator: boolean;
  readonly reasonCode: SimulationReasonCode;
  readonly assumptions: Readonly<Record<string, unknown>>;
}

/** Entry-gap check (docs/trading/07, "Entry und Gap" item 4). */
export interface EntryGapCheckInputV1 {
  readonly direction?: TradeDirection;
  readonly candleOpen: DecimalString;
  readonly plannedEntryMaximum?: DecimalString;
  readonly plannedEntryMinimum?: DecimalString;
}

export interface EntryGapCheckResultV1 {
  readonly gapTooLarge: boolean;
  readonly reasonCode: SimulationReasonCode;
}
