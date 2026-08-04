/**
 * Conservative stop/take-profit/time-exit resolution against one closed candle.
 *
 * Specification: docs/trading/07-shadow-execution-model.md, "Stop, Take Profit
 * und Intrakerzenkonflikte", "Gap-Risiken"; docs/trading/05, "Exit-Modell".
 *
 * Evaluated in the documented priority order. Only price- and time-driven
 * exits live here: `REGIME_INVALIDATED`, `DATA_INVALIDATION` and
 * `MANUAL_RISK_CLOSE` are requested by the worker, not derived from a candle,
 * so they are out of scope for this pure function (docs/trading/05,
 * "Exit-Modell").
 */

import { DecimalValue, TradeDirection } from "@signalpilot/trading-domain";

import {
  ExitTrigger,
  type ExitCandleInputV1,
  type ExitResolutionResultV1
} from "./contracts.js";
import { SimulationReasonCode } from "./reason-codes.js";

export const EXIT_RESOLUTION_SIMULATION_VERSION = "exit-resolution-v1/1.0.0";

function decimalOrNull(value: string): DecimalValue | null {
  if (!DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

function notTriggered(
  reasonCode: SimulationReasonCode
): ExitResolutionResultV1 {
  return {
    triggered: false,
    trigger: null,
    referencePrice: null,
    gapIndicator: false,
    reasonCode,
    assumptions: { simulationVersion: EXIT_RESOLUTION_SIMULATION_VERSION }
  };
}

/**
 * Resolve the single exit trigger, if any, that fires for this candle. Never
 * invents a fill outside the candle's own OHLC/close-time — an unreadable
 * candle or plan is reported as `INVALID_EXIT_PLAN`/`INVALID_CANDLE`, which
 * the caller must treat as a data invalidation (docs/trading/07, "Ist
 * Open/Range ungültig oder fehlt die Candle, kein erfundener Fill").
 */
export function resolveCandleExit(
  input: ExitCandleInputV1
): ExitResolutionResultV1 {
  const stop = decimalOrNull(input.stopPrice);
  const takeProfit = decimalOrNull(input.takeProfitPrice);
  const open = decimalOrNull(input.candle.open);
  const high = decimalOrNull(input.candle.high);
  const low = decimalOrNull(input.candle.low);
  const close = decimalOrNull(input.candle.close);

  if (
    (input.direction !== TradeDirection.LONG &&
      input.direction !== TradeDirection.SHORT) ||
    stop === null ||
    !stop.isPositive() ||
    takeProfit === null ||
    !takeProfit.isPositive() ||
    (input.direction === TradeDirection.LONG
      ? takeProfit.lte(stop)
      : stop.lte(takeProfit))
  ) {
    return notTriggered(SimulationReasonCode.INVALID_EXIT_PLAN);
  }
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    !open.isPositive() ||
    !high.isPositive() ||
    !low.isPositive() ||
    !close.isPositive() ||
    low.gt(open) ||
    open.gt(high) ||
    low.gt(close) ||
    close.gt(high) ||
    low.gt(high)
  ) {
    return notTriggered(SimulationReasonCode.INVALID_CANDLE);
  }

  const assumptions = {
    simulationVersion: EXIT_RESOLUTION_SIMULATION_VERSION,
    sourceCandleId: input.candle.id,
    direction: input.direction,
    stopPrice: input.stopPrice,
    takeProfitPrice: input.takeProfitPrice
  };

  const stopGap =
    input.direction === TradeDirection.LONG ? open.lte(stop) : open.gte(stop);
  // 1. Gap through stop: reference the adverse open for either direction.
  if (stopGap) {
    return {
      triggered: true,
      trigger: ExitTrigger.STOP,
      referencePrice: open.toString(),
      gapIndicator: true,
      reasonCode: SimulationReasonCode.STOP_GAP,
      assumptions
    };
  }

  const takeProfitGap =
    input.direction === TradeDirection.LONG
      ? open.gte(takeProfit)
      : open.lte(takeProfit);
  // 2. Gap past take profit: cap at target, never grant a favourable bonus.
  if (takeProfitGap) {
    return {
      triggered: true,
      trigger: ExitTrigger.TAKE_PROFIT,
      referencePrice: takeProfit.toString(),
      gapIndicator: true,
      reasonCode: SimulationReasonCode.TAKE_PROFIT_GAP,
      assumptions
    };
  }

  const stopInRange =
    input.direction === TradeDirection.LONG ? low.lte(stop) : high.gte(stop);
  const takeProfitInRange =
    input.direction === TradeDirection.LONG
      ? high.gte(takeProfit)
      : low.lte(takeProfit);

  // 3. Both thresholds reachable within the range, order unknown -> stop first
  //    (docs/trading/04, IntrabarConflictPolicy STOP_FIRST).
  if (stopInRange && takeProfitInRange) {
    return {
      triggered: true,
      trigger: ExitTrigger.STOP,
      referencePrice: stop.toString(),
      gapIndicator: false,
      reasonCode: SimulationReasonCode.STOP_AND_TAKE_PROFIT_IN_RANGE_STOP_FIRST,
      assumptions
    };
  }

  // 4. Stop only.
  if (stopInRange) {
    return {
      triggered: true,
      trigger: ExitTrigger.STOP,
      referencePrice: stop.toString(),
      gapIndicator: false,
      reasonCode: SimulationReasonCode.STOP_IN_RANGE,
      assumptions
    };
  }

  // 5. Take profit only, capped at the target.
  if (takeProfitInRange) {
    return {
      triggered: true,
      trigger: ExitTrigger.TAKE_PROFIT,
      referencePrice: takeProfit.toString(),
      gapIndicator: false,
      reasonCode: SimulationReasonCode.TAKE_PROFIT_IN_RANGE,
      assumptions
    };
  }

  // 6. Max hold reached with no price exit -> close of the first candle whose
  //    close time is at/after maxHoldUntil.
  const maxHoldUntilMs = Date.parse(input.maxHoldUntil);
  const closeTimeMs = Date.parse(input.candle.closeTime);
  if (
    Number.isFinite(maxHoldUntilMs) &&
    Number.isFinite(closeTimeMs) &&
    closeTimeMs >= maxHoldUntilMs
  ) {
    return {
      triggered: true,
      trigger: ExitTrigger.TIME_EXIT,
      referencePrice: close.toString(),
      gapIndicator: false,
      reasonCode: SimulationReasonCode.MAX_HOLD_REACHED,
      assumptions
    };
  }

  return {
    triggered: false,
    trigger: null,
    referencePrice: null,
    gapIndicator: false,
    reasonCode: SimulationReasonCode.NO_EXIT_TRIGGER,
    assumptions
  };
}
