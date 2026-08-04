/**
 * Contracts for the deterministic shadow-trading performance engine (P8).
 *
 * Specification: P8 task, "1. Performance Engine" — "Berechne deterministisch
 * aus abgeschlossenen Shadow-Trades und Portfolio-Snapshots ... Keine
 * erfundenen Werte. Nicht berechenbare Kennzahlen explizit als `null` mit
 * Reason ausgeben."
 *
 * Every money/quantity/ratio value crossing this boundary is a canonical
 * `Decimal(30,12)` string (`@signalpilot/trading-domain`'s `DecimalValue`), so
 * no metric ever passes through an IEEE-754 double. The engine is pure: no
 * Prisma, no clock, no `process.env`. The caller assembles the inputs and owns
 * persistence.
 *
 * `PaperSignalEvaluation` is deliberately not an input — shadow performance is
 * a projection of `ShadowPosition`/`ShadowFill`/`PortfolioSnapshot` only
 * (docs/trading/03, `StrategyPerformance`).
 */

/** Canonical `Decimal(30,12)` string. */
export type DecimalString = string;

/** ISO-8601 UTC timestamp. */
export type IsoDateTimeString = string;

/**
 * Bumped whenever the metric definitions change. A different version never
 * overwrites an older snapshot — it produces a new row (P8 task, "Keine
 * historischen Ergebnisse überschreiben, wenn sich Berechnungslogik oder
 * Version ändert").
 */
export const SHADOW_PERFORMANCE_ENGINE_VERSION = "shadow-performance-v2";

/** Minimum daily return observations before Sharpe/Sortino are reported at all. */
export const MIN_RETURN_OBSERVATIONS = 20;

/** Trading days per year used for annualising Sharpe/Sortino (crypto trades every day). */
export const ANNUALISATION_PERIODS_PER_YEAR = 365;

/**
 * Why a metric is `null`. A metric is never silently replaced by `0` or a
 * guessed value; the reason travels with it.
 */
export const MetricNullReason = {
  NO_CLOSED_TRADES: "NO_CLOSED_TRADES",
  NO_WINNING_TRADES: "NO_WINNING_TRADES",
  NO_LOSING_TRADES: "NO_LOSING_TRADES",
  /** Profit factor needs a strictly positive gross loss to divide by. */
  NO_GROSS_LOSS: "NO_GROSS_LOSS",
  /** No trade in the segment carries a persisted planned risk amount. */
  NO_PLANNED_RISK: "NO_PLANNED_RISK",
  /** Recovery factor needs a strictly positive drawdown to divide by. */
  NO_DRAWDOWN: "NO_DRAWDOWN",
  /** Percentage drawdown needs a strictly positive equity base. */
  NO_EQUITY_BASE: "NO_EQUITY_BASE",
  /** No trade has both an `openedAt` and a `closedAt`. */
  NO_HOLD_DURATION: "NO_HOLD_DURATION",
  /** No trade carries observed intra-hold price extremes. */
  NO_PRICE_EXTREMES: "NO_PRICE_EXTREMES",
  /** Fewer than `MIN_RETURN_OBSERVATIONS` daily returns were supplied. */
  INSUFFICIENT_RETURN_OBSERVATIONS: "INSUFFICIENT_RETURN_OBSERVATIONS",
  /** Return dispersion is exactly zero, so the ratio is undefined. */
  ZERO_RETURN_DISPERSION: "ZERO_RETURN_DISPERSION",
  /** Sortino needs at least one downside return. */
  NO_DOWNSIDE_RETURNS: "NO_DOWNSIDE_RETURNS",
  /**
   * Portfolio-level equity metrics cannot be attributed to one asset, regime
   * or exit reason — the equity curve is not segmented.
   */
  NOT_DEFINED_FOR_SEGMENT: "NOT_DEFINED_FOR_SEGMENT",
  /** Rejection rate needs at least one assessed candidate. */
  NO_ASSESSED_CANDIDATES: "NO_ASSESSED_CANDIDATES",
  /** The reporting window has zero length, so exposure share is undefined. */
  EMPTY_WINDOW: "EMPTY_WINDOW"
} as const;
export type MetricNullReason =
  (typeof MetricNullReason)[keyof typeof MetricNullReason];

/** A metric that may legitimately be unknown. `value === null` always carries a `reason`. */
export type NullableMetric<T = DecimalString> =
  | { readonly value: T; readonly reason: null }
  | { readonly value: null; readonly reason: MetricNullReason };

export const metricValue = <T = DecimalString>(
  value: T
): NullableMetric<T> => ({ value, reason: null });
export const metricUnavailable = <T = DecimalString>(
  reason: MetricNullReason
): NullableMetric<T> => ({
  value: null,
  reason
});

/** Segmentation axis of one computed result. */
export const ShadowPerformanceSegment = {
  OVERALL: "OVERALL",
  DIRECTION: "DIRECTION",
  STRATEGY_VERSION: "STRATEGY_VERSION",
  ASSET: "ASSET",
  MARKET_REGIME: "MARKET_REGIME",
  EXIT_REASON: "EXIT_REASON"
} as const;
export type ShadowPerformanceSegment =
  (typeof ShadowPerformanceSegment)[keyof typeof ShadowPerformanceSegment];

/** Bucket key used when a trade carries no value on the segmentation axis. */
export const UNKNOWN_SEGMENT_KEY = "UNKNOWN";

/** Bucket key of the unsegmented result. */
export const ALL_SEGMENT_KEY = "ALL";

/**
 * One fully closed shadow trade, flattened from `ShadowPosition` plus its
 * fills. Only terminal positions belong here — an open position has no
 * realised result to measure.
 *
 * `netPnl` is `ShadowPosition.realizedPnl`, which `@signalpilot/portfolio`'s
 * `applyExitFillToPosition` already computes net of the proportionally
 * allocated entry fees and every exit fee. `fees` is the position's complete
 * fee history, so `grossPnl = netPnl + fees` holds exactly for a fully closed
 * position and needs no separate source.
 */
export interface ClosedShadowTradeInput {
  readonly positionId: string;
  readonly portfolioId: string;
  readonly strategyVersionId: string;
  readonly assetId: string;
  readonly symbol: string | null;
  readonly direction: "LONG" | "SHORT";
  /** `MarketRegimeSnapshot.overallRegime` captured in the candidate's input snapshot. */
  readonly marketRegime: string | null;
  /** `ShadowFill.triggerType` of the last exit fill (STOP, TAKE_PROFIT, ...). */
  readonly exitReason: string | null;
  readonly openedAt: IsoDateTimeString | null;
  readonly closedAt: IsoDateTimeString | null;
  readonly initialQuantity: DecimalString;
  readonly averageEntryPrice: DecimalString;
  /** `ShadowPosition.realizedPnl` — already net of all fees. */
  readonly netPnl: DecimalString;
  /** `ShadowPosition.feesPaid` — entry plus exit fees. */
  readonly fees: DecimalString;
  /**
   * Σ over the position's fills of `slippageAmount × quantity`.
   * `ShadowFill.slippageAmount` is the full per-unit adverse deviation from
   * the reference price (spread half plus slippage together, see
   * `@signalpilot/trading-simulation`'s `market-fill-v1`), so this is the
   * complete simulated execution cost without double counting the spread.
   */
  readonly simulatedExecutionCost: DecimalString;
  /** `RiskAssessment.riskAmount` behind the entry, or null when not persisted. */
  readonly plannedRiskAmount: DecimalString | null;
  /** Lowest traded price observed while the position was open, if derivable. */
  readonly maxAdversePrice: DecimalString | null;
  /** Highest traded price observed while the position was open, if derivable. */
  readonly maxFavorablePrice: DecimalString | null;
}

/** One daily portfolio observation, ordered by `tradingDateUtc` by the caller. */
export interface PortfolioEquityPointInput {
  readonly asOf: IsoDateTimeString;
  readonly tradingDateUtc: string;
  readonly equity: DecimalString;
}

/** Pre-trade funnel counts for the same window and portfolio. */
export interface RiskFunnelInput {
  /** Candidates that reached a risk assessment. */
  readonly assessedCandidates: number;
  /** Candidates the risk engine refused (`RiskAssessment.status = FAIL`). */
  readonly riskRejectedCandidates: number;
  /** Candidates the strategy itself discarded (`TradeCandidate.status = INVALID`). */
  readonly invalidCandidates: number;
  /** Candidates that expired before a decision. */
  readonly expiredCandidates: number;
}

export interface ShadowPerformanceWindowInput {
  readonly from: IsoDateTimeString;
  readonly to: IsoDateTimeString;
  /** `asOf` of the computed result — the data cut this snapshot is bound to. */
  readonly asOf: IsoDateTimeString;
}

export interface ComputeShadowPerformanceInput {
  readonly portfolioId: string;
  readonly window: ShadowPerformanceWindowInput;
  /** Equity the percentage drawdown is measured against (`Portfolio.startingCash`). */
  readonly equityBase: DecimalString | null;
  readonly trades: readonly ClosedShadowTradeInput[];
  readonly equityCurve: readonly PortfolioEquityPointInput[];
  readonly riskFunnel: RiskFunnelInput;
  /**
   * Highest `ShadowPositionEvent.id`/`sequence` included in `trades`, stored on
   * the snapshot so a later run can prove which data cut it saw.
   */
  readonly sourceThroughPositionEventId: string | null;
  readonly dataThroughAt: IsoDateTimeString | null;
}

/** The complete metric set of one segment. */
export interface ShadowPerformanceMetrics {
  readonly closedTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly breakeven: number;
  readonly winRatePct: NullableMetric;

  readonly grossPnl: DecimalString;
  readonly netPnl: DecimalString;
  readonly fees: DecimalString;
  readonly simulatedExecutionCost: DecimalString;
  readonly grossProfit: DecimalString;
  readonly grossLoss: DecimalString;

  readonly averageWin: NullableMetric;
  readonly averageLoss: NullableMetric;
  readonly profitFactor: NullableMetric;
  readonly expectancy: NullableMetric;

  readonly averageR: NullableMetric;
  readonly cumulativeR: NullableMetric;
  /** Trades that carried a planned risk amount and therefore contributed to R. */
  readonly tradesWithPlannedRisk: number;

  readonly maxWinStreak: number;
  readonly maxLossStreak: number;

  readonly maxDrawdownAmount: NullableMetric;
  readonly maxDrawdownPct: NullableMetric;
  readonly recoveryFactor: NullableMetric;

  readonly averageHoldMinutes: NullableMetric;
  readonly exposureMinutes: DecimalString;
  readonly exposurePct: NullableMetric;

  readonly averageMaePct: NullableMetric;
  readonly averageMfePct: NullableMetric;
  readonly tradesWithPriceExtremes: number;

  readonly sharpeRatio: NullableMetric;
  readonly sortinoRatio: NullableMetric;
  readonly returnObservations: number;

  readonly assessedCandidates: number;
  readonly riskRejectedCandidates: number;
  readonly invalidCandidates: number;
  readonly expiredCandidates: number;
  readonly riskRejectionRatePct: NullableMetric;
}

export interface ShadowPerformanceSegmentResult {
  readonly segmentType: ShadowPerformanceSegment;
  readonly segmentKey: string;
  /** Human-readable label; equals `segmentKey` unless a symbol is known. */
  readonly segmentLabel: string;
  /** Non-null only for `STRATEGY_VERSION` and `OVERALL` segments. */
  readonly strategyVersionId: string | null;
  readonly metrics: ShadowPerformanceMetrics;
}

export interface ShadowPerformanceReport {
  readonly engineVersion: string;
  readonly portfolioId: string;
  readonly window: ShadowPerformanceWindowInput;
  readonly equityBase: DecimalString | null;
  readonly sourceThroughPositionEventId: string | null;
  readonly dataThroughAt: IsoDateTimeString | null;
  /** SHA-256 over the canonical engine input — proves which data produced this. */
  readonly inputHash: string;
  /** SHA-256 over the canonical `segments` array — proves the result is unchanged. */
  readonly outputHash: string;
  readonly segments: readonly ShadowPerformanceSegmentResult[];
}
