/**
 * Deterministic shadow-trading performance computation (P8, "1. Performance
 * Engine").
 *
 * Pure and total: identical inputs always produce an identical
 * `ShadowPerformanceReport`, including its `inputHash`/`outputHash`. Every
 * arithmetic step runs on `DecimalValue` (BigInt at scale 12), so no metric is
 * ever derived through a JavaScript float. Where a metric is not derivable
 * from the data at hand, it is emitted as `null` with a `MetricNullReason` —
 * never as `0` and never as an estimate (P8 task, "Keine erfundenen Werte").
 *
 * Drawdown is measured on the cumulative net-P&L curve of the trades in the
 * segment, ordered by `closedAt`. That is the only drawdown definition that
 * stays meaningful per asset, per regime and per exit reason — the portfolio
 * equity curve cannot be attributed to one of those buckets. Sharpe and
 * Sortino are the opposite case: they are portfolio-level daily-return
 * statistics, so they are reported for `OVERALL` only and explicitly
 * `NOT_DEFINED_FOR_SEGMENT` everywhere else.
 */

import {
  DecimalValue,
  RoundingMode,
  canonicalHash
} from "@signalpilot/trading-domain";

import {
  ALL_SEGMENT_KEY,
  ANNUALISATION_PERIODS_PER_YEAR,
  MIN_RETURN_OBSERVATIONS,
  MetricNullReason,
  SHADOW_PERFORMANCE_ENGINE_VERSION,
  ShadowPerformanceSegment,
  UNKNOWN_SEGMENT_KEY,
  metricUnavailable,
  metricValue,
  type ClosedShadowTradeInput,
  type ComputeShadowPerformanceInput,
  type DecimalString,
  type NullableMetric,
  type PortfolioEquityPointInput,
  type RiskFunnelInput,
  type ShadowPerformanceMetrics,
  type ShadowPerformanceReport,
  type ShadowPerformanceSegmentResult
} from "./contracts.js";

const ZERO = DecimalValue.ZERO;
const HUNDRED = DecimalValue.fromSafeInteger(100);
const MINUTE_MS = 60_000;

function toDecimal(value: DecimalString | null): DecimalValue | null {
  if (value === null || !DecimalValue.isDecimalString(value)) return null;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return null;
  }
}

function toDecimalOrZero(value: DecimalString | null): DecimalValue {
  return toDecimal(value) ?? ZERO;
}

/** Integer square root of a non-negative BigInt (Newton, exact, no floats). */
function bigintSqrt(value: bigint): bigint {
  if (value < 0n)
    throw new RangeError("bigintSqrt expects a non-negative value.");
  if (value < 2n) return value;
  let guess = value;
  let next = (guess + 1n) / 2n;
  while (next < guess) {
    guess = next;
    next = (guess + value / guess) / 2n;
  }
  return guess;
}

/**
 * √x at scale 12. `x = u / 10^12`, so `√x = √(u × 10^12) / 10^12` — the whole
 * computation stays in BigInt and never touches `Math.sqrt`.
 */
function decimalSqrt(value: DecimalValue): DecimalValue {
  if (value.isNegative()) return ZERO;
  return DecimalValue.fromUnscaled(
    bigintSqrt(value.unscaled * 1_000_000_000_000n)
  );
}

function parseIsoMs(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Milliseconds as whole minutes at scale 12. Uses BigInt division so a long
 * hold duration cannot lose precision the way `ms / 60000` would.
 */
function millisecondsToMinutes(milliseconds: number): DecimalValue {
  return DecimalValue.fromSafeInteger(Math.trunc(milliseconds)).div(
    DecimalValue.fromSafeInteger(MINUTE_MS),
    RoundingMode.HALF_UP
  );
}

/** Mean of a non-empty list; the caller guarantees non-emptiness. */
function mean(values: readonly DecimalValue[]): DecimalValue {
  return DecimalValue.sum(values).div(
    DecimalValue.fromSafeInteger(values.length),
    RoundingMode.HALF_UP
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Per-trade derivation
// ───────────────────────────────────────────────────────────────────────────

interface DerivedTrade {
  readonly source: ClosedShadowTradeInput;
  readonly netPnl: DecimalValue;
  readonly fees: DecimalValue;
  readonly grossPnl: DecimalValue;
  readonly executionCost: DecimalValue;
  readonly plannedRisk: DecimalValue | null;
  /** `netPnl / plannedRisk`, null when no planned risk is persisted. */
  readonly rMultiple: DecimalValue | null;
  readonly holdMinutes: DecimalValue | null;
  /** Sort key: `closedAt`, falling back to `openedAt`, then to insertion order. */
  readonly orderKey: number;
  /** `(entry − lowest) / entry × 100`, null when no extreme is known. */
  readonly maePct: DecimalValue | null;
  /** `(highest − entry) / entry × 100`, null when no extreme is known. */
  readonly mfePct: DecimalValue | null;
}

function deriveTrade(
  trade: ClosedShadowTradeInput,
  fallbackOrder: number
): DerivedTrade {
  const netPnl = toDecimalOrZero(trade.netPnl);
  const fees = toDecimalOrZero(trade.fees);
  const plannedRisk = toDecimal(trade.plannedRiskAmount);
  const entryPrice = toDecimal(trade.averageEntryPrice);
  const openedAtMs = parseIsoMs(trade.openedAt);
  const closedAtMs = parseIsoMs(trade.closedAt);

  const holdMinutes =
    openedAtMs !== null && closedAtMs !== null && closedAtMs >= openedAtMs
      ? millisecondsToMinutes(closedAtMs - openedAtMs)
      : null;

  const lowest = toDecimal(trade.maxAdversePrice);
  const highest = toDecimal(trade.maxFavorablePrice);
  const priceBaseUsable = entryPrice !== null && entryPrice.isPositive();

  return {
    source: trade,
    netPnl,
    fees,
    grossPnl: netPnl.add(fees),
    executionCost: toDecimalOrZero(trade.simulatedExecutionCost),
    plannedRisk,
    rMultiple:
      plannedRisk !== null && plannedRisk.isPositive()
        ? netPnl.div(plannedRisk, RoundingMode.HALF_UP)
        : null,
    holdMinutes,
    orderKey: closedAtMs ?? openedAtMs ?? fallbackOrder,
    maePct:
      priceBaseUsable &&
      (trade.direction === "LONG" ? lowest !== null : highest !== null)
        ? (trade.direction === "LONG"
            ? entryPrice.sub(lowest as DecimalValue)
            : (highest as DecimalValue).sub(entryPrice)
          )
            .mul(HUNDRED, RoundingMode.HALF_UP)
            .div(entryPrice, RoundingMode.HALF_UP)
        : null,
    mfePct:
      priceBaseUsable &&
      (trade.direction === "LONG" ? highest !== null : lowest !== null)
        ? (trade.direction === "LONG"
            ? (highest as DecimalValue).sub(entryPrice)
            : entryPrice.sub(lowest as DecimalValue)
          )
            .mul(HUNDRED, RoundingMode.HALF_UP)
            .div(entryPrice, RoundingMode.HALF_UP)
        : null
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Metric blocks
// ───────────────────────────────────────────────────────────────────────────

interface DrawdownResult {
  readonly amount: NullableMetric;
  readonly pct: NullableMetric;
}

/**
 * Peak-to-trough of the running equity `equityBase + Σ netPnl`, in trade close
 * order. Without an equity base the absolute drawdown is still exact (it only
 * depends on the P&L path) but the percentage is not derivable.
 */
function computeDrawdown(
  ordered: readonly DerivedTrade[],
  equityBase: DecimalValue | null
): DrawdownResult {
  if (ordered.length === 0) {
    return {
      amount: metricUnavailable(MetricNullReason.NO_CLOSED_TRADES),
      pct: metricUnavailable(MetricNullReason.NO_CLOSED_TRADES)
    };
  }

  const base = equityBase ?? ZERO;
  let running = base;
  let peak = base;
  let maxDrawdown = ZERO;
  let peakAtMaxDrawdown = base;

  for (const trade of ordered) {
    running = running.add(trade.netPnl);
    if (running.gt(peak)) peak = running;
    const drawdown = peak.sub(running);
    if (drawdown.gt(maxDrawdown)) {
      maxDrawdown = drawdown;
      peakAtMaxDrawdown = peak;
    }
  }

  const pct =
    equityBase === null
      ? metricUnavailable(MetricNullReason.NO_EQUITY_BASE)
      : peakAtMaxDrawdown.isPositive()
        ? metricValue(
            maxDrawdown
              .mul(HUNDRED, RoundingMode.HALF_UP)
              .div(peakAtMaxDrawdown, RoundingMode.HALF_UP)
              .toString()
          )
        : metricUnavailable(MetricNullReason.NO_EQUITY_BASE);

  return { amount: metricValue(maxDrawdown.toString()), pct };
}

interface StreakResult {
  readonly maxWinStreak: number;
  readonly maxLossStreak: number;
}

function computeStreaks(ordered: readonly DerivedTrade[]): StreakResult {
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let winStreak = 0;
  let lossStreak = 0;

  for (const trade of ordered) {
    if (trade.netPnl.isPositive()) {
      winStreak += 1;
      lossStreak = 0;
    } else if (trade.netPnl.isNegative()) {
      lossStreak += 1;
      winStreak = 0;
    } else {
      // A breakeven trade breaks both streaks rather than extending either.
      winStreak = 0;
      lossStreak = 0;
    }
    if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
  }

  return { maxWinStreak, maxLossStreak };
}

interface RatioResult {
  readonly sharpe: NullableMetric;
  readonly sortino: NullableMetric;
  readonly observations: number;
}

/**
 * Daily simple returns from consecutive equity observations, then annualised
 * Sharpe/Sortino at a zero risk-free rate. Below `MIN_RETURN_OBSERVATIONS`
 * both are `null` — a ratio from a handful of days is noise, not a
 * measurement (P8 task, "Sharpe und Sortino nur bei ausreichender
 * Datenbasis").
 */
function computeRiskAdjustedRatios(
  equityCurve: readonly PortfolioEquityPointInput[]
): RatioResult {
  const returns: DecimalValue[] = [];
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = toDecimal(equityCurve[index - 1].equity);
    const current = toDecimal(equityCurve[index].equity);
    if (previous === null || current === null || !previous.isPositive())
      continue;
    returns.push(current.sub(previous).div(previous, RoundingMode.HALF_UP));
  }

  if (returns.length < MIN_RETURN_OBSERVATIONS) {
    return {
      sharpe: metricUnavailable(
        MetricNullReason.INSUFFICIENT_RETURN_OBSERVATIONS
      ),
      sortino: metricUnavailable(
        MetricNullReason.INSUFFICIENT_RETURN_OBSERVATIONS
      ),
      observations: returns.length
    };
  }

  const averageReturn = mean(returns);
  const squaredDeviations = returns.map((value) => {
    const deviation = value.sub(averageReturn);
    return deviation.mul(deviation, RoundingMode.HALF_UP);
  });
  // Sample standard deviation (n − 1): `returns.length >= 20` here, so the
  // divisor is always positive.
  const variance = DecimalValue.sum(squaredDeviations).div(
    DecimalValue.fromSafeInteger(returns.length - 1),
    RoundingMode.HALF_UP
  );
  const standardDeviation = decimalSqrt(variance);
  const annualisation = decimalSqrt(
    DecimalValue.fromSafeInteger(ANNUALISATION_PERIODS_PER_YEAR)
  );

  const sharpe = standardDeviation.isPositive()
    ? metricValue(
        averageReturn
          .div(standardDeviation, RoundingMode.HALF_UP)
          .mul(annualisation, RoundingMode.HALF_UP)
          .toString()
      )
    : metricUnavailable(MetricNullReason.ZERO_RETURN_DISPERSION);

  const downside = returns.filter((value) => value.isNegative());
  let sortino: NullableMetric;
  if (downside.length === 0) {
    sortino = metricUnavailable(MetricNullReason.NO_DOWNSIDE_RETURNS);
  } else {
    const downsideVariance = DecimalValue.sum(
      downside.map((value) => value.mul(value, RoundingMode.HALF_UP))
    ).div(DecimalValue.fromSafeInteger(downside.length), RoundingMode.HALF_UP);
    const downsideDeviation = decimalSqrt(downsideVariance);
    sortino = downsideDeviation.isPositive()
      ? metricValue(
          averageReturn
            .div(downsideDeviation, RoundingMode.HALF_UP)
            .mul(annualisation, RoundingMode.HALF_UP)
            .toString()
        )
      : metricUnavailable(MetricNullReason.ZERO_RETURN_DISPERSION);
  }

  return { sharpe, sortino, observations: returns.length };
}

interface MetricsContext {
  readonly window: ComputeShadowPerformanceInput["window"];
  readonly equityBase: DecimalValue | null;
  readonly riskFunnel: RiskFunnelInput;
  readonly ratios: RatioResult;
  /** Portfolio-level ratios only apply to the unsegmented result. */
  readonly isOverall: boolean;
}

function computeMetrics(
  trades: readonly DerivedTrade[],
  context: MetricsContext
): ShadowPerformanceMetrics {
  const ordered = [...trades].sort(
    (left, right) => left.orderKey - right.orderKey
  );
  const count = ordered.length;

  const winners = ordered.filter((trade) => trade.netPnl.isPositive());
  const losers = ordered.filter((trade) => trade.netPnl.isNegative());
  const breakeven = count - winners.length - losers.length;

  const netPnl = DecimalValue.sum(ordered.map((trade) => trade.netPnl));
  const fees = DecimalValue.sum(ordered.map((trade) => trade.fees));
  const grossPnl = DecimalValue.sum(ordered.map((trade) => trade.grossPnl));
  const executionCost = DecimalValue.sum(
    ordered.map((trade) => trade.executionCost)
  );
  const grossProfit = DecimalValue.sum(winners.map((trade) => trade.netPnl));
  const grossLoss = DecimalValue.sum(losers.map((trade) => trade.netPnl)).abs();

  const countDecimal = DecimalValue.fromSafeInteger(count);

  const winRatePct =
    count === 0
      ? metricUnavailable(MetricNullReason.NO_CLOSED_TRADES)
      : metricValue(
          DecimalValue.fromSafeInteger(winners.length)
            .mul(HUNDRED, RoundingMode.HALF_UP)
            .div(countDecimal, RoundingMode.HALF_UP)
            .toString()
        );

  const averageWin =
    winners.length === 0
      ? metricUnavailable(MetricNullReason.NO_WINNING_TRADES)
      : metricValue(mean(winners.map((trade) => trade.netPnl)).toString());

  const averageLoss =
    losers.length === 0
      ? metricUnavailable(MetricNullReason.NO_LOSING_TRADES)
      : metricValue(mean(losers.map((trade) => trade.netPnl)).toString());

  const profitFactor = grossLoss.isPositive()
    ? metricValue(grossProfit.div(grossLoss, RoundingMode.HALF_UP).toString())
    : metricUnavailable(
        count === 0
          ? MetricNullReason.NO_CLOSED_TRADES
          : MetricNullReason.NO_GROSS_LOSS
      );

  const expectancy =
    count === 0
      ? metricUnavailable(MetricNullReason.NO_CLOSED_TRADES)
      : metricValue(netPnl.div(countDecimal, RoundingMode.HALF_UP).toString());

  const rMultiples = ordered
    .map((trade) => trade.rMultiple)
    .filter((value): value is DecimalValue => value !== null);
  const averageR =
    rMultiples.length === 0
      ? metricUnavailable(
          count === 0
            ? MetricNullReason.NO_CLOSED_TRADES
            : MetricNullReason.NO_PLANNED_RISK
        )
      : metricValue(mean(rMultiples).toString());
  const cumulativeR =
    rMultiples.length === 0
      ? metricUnavailable(
          count === 0
            ? MetricNullReason.NO_CLOSED_TRADES
            : MetricNullReason.NO_PLANNED_RISK
        )
      : metricValue(DecimalValue.sum(rMultiples).toString());

  const streaks = computeStreaks(ordered);
  const drawdown = computeDrawdown(ordered, context.equityBase);

  const recoveryFactor =
    drawdown.amount.value === null
      ? metricUnavailable(drawdown.amount.reason)
      : (() => {
          const amount = DecimalValue.fromString(drawdown.amount.value);
          return amount.isPositive()
            ? metricValue(netPnl.div(amount, RoundingMode.HALF_UP).toString())
            : metricUnavailable(MetricNullReason.NO_DRAWDOWN);
        })();

  const holdDurations = ordered
    .map((trade) => trade.holdMinutes)
    .filter((value): value is DecimalValue => value !== null);
  const averageHoldMinutes =
    holdDurations.length === 0
      ? metricUnavailable(
          count === 0
            ? MetricNullReason.NO_CLOSED_TRADES
            : MetricNullReason.NO_HOLD_DURATION
        )
      : metricValue(mean(holdDurations).toString());
  const exposureMinutes = DecimalValue.sum(holdDurations);

  const windowFromMs = parseIsoMs(context.window.from);
  const windowToMs = parseIsoMs(context.window.to);
  const windowMinutes =
    windowFromMs !== null && windowToMs !== null && windowToMs > windowFromMs
      ? millisecondsToMinutes(windowToMs - windowFromMs)
      : null;
  const exposurePct =
    windowMinutes === null || !windowMinutes.isPositive()
      ? metricUnavailable(MetricNullReason.EMPTY_WINDOW)
      : metricValue(
          exposureMinutes
            .mul(HUNDRED, RoundingMode.HALF_UP)
            .div(windowMinutes, RoundingMode.HALF_UP)
            .toString()
        );

  const maeValues = ordered
    .map((trade) => trade.maePct)
    .filter((value): value is DecimalValue => value !== null);
  const mfeValues = ordered
    .map((trade) => trade.mfePct)
    .filter((value): value is DecimalValue => value !== null);
  const extremesReason =
    count === 0
      ? MetricNullReason.NO_CLOSED_TRADES
      : MetricNullReason.NO_PRICE_EXTREMES;
  const averageMaePct =
    maeValues.length === 0
      ? metricUnavailable(extremesReason)
      : metricValue(mean(maeValues).toString());
  const averageMfePct =
    mfeValues.length === 0
      ? metricUnavailable(extremesReason)
      : metricValue(mean(mfeValues).toString());

  const sharpeRatio = context.isOverall
    ? context.ratios.sharpe
    : metricUnavailable(MetricNullReason.NOT_DEFINED_FOR_SEGMENT);
  const sortinoRatio = context.isOverall
    ? context.ratios.sortino
    : metricUnavailable(MetricNullReason.NOT_DEFINED_FOR_SEGMENT);

  // The pre-trade funnel is a portfolio-and-window fact. Splitting it by exit
  // reason or realised regime would be meaningless — a rejected candidate
  // never had either.
  const funnel = context.isOverall
    ? context.riskFunnel
    : {
        assessedCandidates: 0,
        riskRejectedCandidates: 0,
        invalidCandidates: 0,
        expiredCandidates: 0
      };
  const riskRejectionRatePct = !context.isOverall
    ? metricUnavailable(MetricNullReason.NOT_DEFINED_FOR_SEGMENT)
    : funnel.assessedCandidates === 0
      ? metricUnavailable(MetricNullReason.NO_ASSESSED_CANDIDATES)
      : metricValue(
          DecimalValue.fromSafeInteger(funnel.riskRejectedCandidates)
            .mul(HUNDRED, RoundingMode.HALF_UP)
            .div(
              DecimalValue.fromSafeInteger(funnel.assessedCandidates),
              RoundingMode.HALF_UP
            )
            .toString()
        );

  return {
    closedTrades: count,
    wins: winners.length,
    losses: losers.length,
    breakeven,
    winRatePct,
    grossPnl: grossPnl.toString(),
    netPnl: netPnl.toString(),
    fees: fees.toString(),
    simulatedExecutionCost: executionCost.toString(),
    grossProfit: grossProfit.toString(),
    grossLoss: grossLoss.toString(),
    averageWin,
    averageLoss,
    profitFactor,
    expectancy,
    averageR,
    cumulativeR,
    tradesWithPlannedRisk: rMultiples.length,
    maxWinStreak: streaks.maxWinStreak,
    maxLossStreak: streaks.maxLossStreak,
    maxDrawdownAmount: drawdown.amount,
    maxDrawdownPct: drawdown.pct,
    recoveryFactor,
    averageHoldMinutes,
    exposureMinutes: exposureMinutes.toString(),
    exposurePct,
    averageMaePct,
    averageMfePct,
    tradesWithPriceExtremes: Math.max(maeValues.length, mfeValues.length),
    sharpeRatio,
    sortinoRatio,
    returnObservations: context.isOverall ? context.ratios.observations : 0,
    assessedCandidates: funnel.assessedCandidates,
    riskRejectedCandidates: funnel.riskRejectedCandidates,
    invalidCandidates: funnel.invalidCandidates,
    expiredCandidates: funnel.expiredCandidates,
    riskRejectionRatePct
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Segmentation
// ───────────────────────────────────────────────────────────────────────────

interface SegmentAxis {
  readonly type: ShadowPerformanceSegment;
  readonly keyOf: (trade: DerivedTrade) => string;
  readonly labelOf: (trade: DerivedTrade, key: string) => string;
  readonly strategyVersionOf: (trade: DerivedTrade) => string | null;
}

const SEGMENT_AXES: readonly SegmentAxis[] = [
  {
    type: ShadowPerformanceSegment.DIRECTION,
    keyOf: (trade) => trade.source.direction,
    labelOf: (_trade, key) => key,
    strategyVersionOf: () => null
  },
  {
    type: ShadowPerformanceSegment.STRATEGY_VERSION,
    keyOf: (trade) => trade.source.strategyVersionId,
    labelOf: (_trade, key) => key,
    strategyVersionOf: (trade) => trade.source.strategyVersionId
  },
  {
    type: ShadowPerformanceSegment.ASSET,
    keyOf: (trade) => trade.source.assetId,
    labelOf: (trade, key) => trade.source.symbol ?? key,
    strategyVersionOf: () => null
  },
  {
    type: ShadowPerformanceSegment.MARKET_REGIME,
    keyOf: (trade) => trade.source.marketRegime ?? UNKNOWN_SEGMENT_KEY,
    labelOf: (_trade, key) => key,
    strategyVersionOf: () => null
  },
  {
    type: ShadowPerformanceSegment.EXIT_REASON,
    keyOf: (trade) => trade.source.exitReason ?? UNKNOWN_SEGMENT_KEY,
    labelOf: (_trade, key) => key,
    strategyVersionOf: () => null
  }
];

/**
 * Compute every segment of one window. The result is stable: segments are
 * emitted in a fixed axis order and, within an axis, sorted by segment key, so
 * the output hash does not depend on input ordering.
 */
export function computeShadowPerformance(
  input: ComputeShadowPerformanceInput
): ShadowPerformanceReport {
  const derived = input.trades.map((trade, index) => deriveTrade(trade, index));
  const equityBase = toDecimal(input.equityBase);
  const ratios = computeRiskAdjustedRatios(input.equityCurve);

  const overallContext: MetricsContext = {
    window: input.window,
    equityBase,
    riskFunnel: input.riskFunnel,
    ratios,
    isOverall: true
  };
  const segmentContext: MetricsContext = {
    ...overallContext,
    isOverall: false
  };

  const segments: ShadowPerformanceSegmentResult[] = [
    {
      segmentType: ShadowPerformanceSegment.OVERALL,
      segmentKey: ALL_SEGMENT_KEY,
      segmentLabel: ALL_SEGMENT_KEY,
      strategyVersionId: null,
      metrics: computeMetrics(derived, overallContext)
    }
  ];

  for (const axis of SEGMENT_AXES) {
    const buckets = new Map<string, DerivedTrade[]>();
    for (const trade of derived) {
      const key = axis.keyOf(trade);
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [trade]);
      else bucket.push(trade);
    }

    const keys = [...buckets.keys()].sort();
    for (const key of keys) {
      const bucket = buckets.get(key) as DerivedTrade[];
      segments.push({
        segmentType: axis.type,
        segmentKey: key,
        segmentLabel: axis.labelOf(bucket[0], key),
        strategyVersionId: axis.strategyVersionOf(bucket[0]),
        metrics: computeMetrics(bucket, segmentContext)
      });
    }
  }

  // The hash covers the assembled input rather than the raw arguments so that
  // insertion order of `trades` never changes it.
  const canonicalInput = {
    engineVersion: SHADOW_PERFORMANCE_ENGINE_VERSION,
    portfolioId: input.portfolioId,
    window: input.window,
    equityBase: input.equityBase,
    riskFunnel: input.riskFunnel,
    sourceThroughPositionEventId: input.sourceThroughPositionEventId,
    dataThroughAt: input.dataThroughAt,
    trades: [...input.trades].sort((left, right) =>
      left.positionId.localeCompare(right.positionId)
    ),
    equityCurve: [...input.equityCurve].sort((left, right) =>
      left.asOf.localeCompare(right.asOf)
    )
  };

  return {
    engineVersion: SHADOW_PERFORMANCE_ENGINE_VERSION,
    portfolioId: input.portfolioId,
    window: input.window,
    equityBase: input.equityBase,
    sourceThroughPositionEventId: input.sourceThroughPositionEventId,
    dataThroughAt: input.dataThroughAt,
    inputHash: canonicalHash(canonicalInput),
    outputHash: canonicalHash(segments),
    segments
  };
}
