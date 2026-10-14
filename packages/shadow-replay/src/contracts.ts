/**
 * Contracts of the historical shadow replay.
 *
 * The replay drives the unchanged production engines (strategy, risk,
 * simulation, portfolio, performance) hour by hour over stored candles. Every
 * input of a cycle is derived from candles that had closed at that cycle's
 * `asOf` — the same point in time the live scheduler would have seen them.
 */

export type ReplayTimeframe = "1h" | "4h" | "1d";

/** One closed candle. Times are epoch milliseconds (UTC). */
export interface ReplayCandle {
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
}

export interface ReplaySeries {
  readonly symbol: string;
  readonly assetType: "CRYPTO" | "ETF" | "STOCK";
  readonly source: string;
  readonly candles: Readonly<Partial<Record<ReplayTimeframe, readonly ReplayCandle[]>>>;
}

export interface ReplayMarketData {
  /** Traded symbol plus any regime benchmarks (BTCUSDT, ETHUSDT, SPY, QQQ, IWM). */
  readonly series: readonly ReplaySeries[];
  /** Where the candles came from, e.g. `DATABASE`, `SNAPSHOT_FILE`, `SYNTHETIC`. */
  readonly origin: string;
  /** True only for generated test markets — never a statement about real performance. */
  readonly synthetic: boolean;
}

/**
 * - `SPEC`: candidates go through the full risk engine (all 26 rules) exactly
 *   as in live shadow trading.
 * - `SIGNAL_EDGE`: research view of the raw strategy signal. Candidates are
 *   sized with the production sizing function and simulated with the same fill
 *   and exit model, but the risk-engine gates are not applied (one open
 *   position per symbol at a time).
 */
export type ReplayMode = "SPEC" | "SIGNAL_EDGE";

/**
 * - `AS_SPECIFIED`: the production regime report over whatever benchmarks the
 *   data contains (needs SPY/QQQ/IWM for full confidence).
 * - `CRYPTO_ONLY`: research assumption when no equity benchmarks exist — the
 *   regime is computed from the crypto benchmarks alone and its confidence is
 *   normalised to those benchmarks.
 * - `CRYPTO_NATIVE_V1`: the versioned crypto-native regime
 *   (`calculateCryptoNativeRegimeReport`): regime, risk mode and confidence
 *   from BTC/ETH only, with a 200-day trend filter.
 */
export type RegimePolicy = "AS_SPECIFIED" | "CRYPTO_ONLY" | "CRYPTO_NATIVE_V1";

export interface ReplayExecutionProfile {
  readonly tickSize: string;
  readonly stepSize: string;
  readonly minQuantity: string;
  readonly minNotional: string;
  readonly maxQuantity: string | null;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: string;
}

export interface ReplayConfig {
  readonly symbol: string;
  readonly strategyKey: string;
  readonly mode: ReplayMode;
  readonly regimePolicy: RegimePolicy;
  readonly startingCash: string;
  readonly executionProfile: ReplayExecutionProfile;
  /** Inclusive window of anchor candle close times (ISO); defaults to the whole series after warm-up. */
  readonly from?: string;
  readonly to?: string;
  /** Anchors closing before this instant belong to the training period, the rest to the test period. */
  readonly trainTestSplitAt?: string;
  readonly codeVersion: string;
  /** Minutes after the candle close at which the candidate scan runs (live: 5). */
  readonly scanDelayMinutes?: number;
  /** Research variant key from `STRATEGY_VARIANTS` (default BASELINE). */
  readonly variant?: string;
  /**
   * Hours after which the replay assumes the operator's review releases a
   * kill switch engaged by the loss-streak rule (R-021); live, only the
   * operator releases it. Default 24.
   */
  readonly killSwitchReviewHours?: number;
}

export interface ReplayTrade {
  readonly positionId: string;
  readonly candidateKey: string;
  readonly symbol: string;
  readonly direction: "LONG" | "SHORT";
  readonly period: "TRAINING" | "TEST";
  readonly anchorAt: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly exitReason: string;
  readonly quantity: string;
  readonly entryPrice: string;
  readonly exitPrice: string;
  readonly stopPrice: string;
  readonly takeProfitPrice: string;
  readonly plannedRiskAmount: string;
  readonly grossPnl: string;
  readonly fees: string;
  readonly netPnl: string;
  readonly rMultiple: string | null;
  /** Price impact of the simulated half spread on entry and exit (quote currency). */
  readonly spreadCost: string;
  /** Price impact of the simulated slippage on entry and exit (quote currency). */
  readonly slippageCost: string;
  readonly maxAdversePrice: string;
  readonly maxFavorablePrice: string;
  readonly marketRegime: string | null;
}

export interface ReplayEquityPoint {
  readonly at: string;
  readonly equity: string;
}

export interface ReplayPeriodMetrics {
  readonly label: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly closedTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: string | null;
  readonly profitFactor: string | null;
  readonly expectancy: string | null;
  readonly averageR: string | null;
  /** Mean net PnL of winning / losing trades (losses negative). */
  readonly averageWin: string | null;
  readonly averageLoss: string | null;
  /** Longest run of consecutive losing trades in closing order. */
  readonly maxConsecutiveLosses: number;
  readonly netPnl: string;
  readonly fees: string;
  readonly spreadCost: string;
  readonly slippageCost: string;
  /** Fees + spread + slippage: everything the simulated execution cost. */
  readonly totalExecutionCost: string;
  readonly returnPct: string | null;
  readonly maxDrawdownPct: string | null;
  readonly sharpeRatio: string | null;
  readonly sortinoRatio: string | null;
  readonly averageHoldHours: string | null;
  /** Buy-and-hold of the same symbol over the same window, one round trip of costs. */
  readonly buyAndHoldReturnPct: string | null;
  readonly buyAndHoldMaxDrawdownPct: string | null;
  /** Share of the window with an open position (0–100). */
  readonly exposurePct: string | null;
}

export interface ReplayFunnel {
  readonly cycles: number;
  readonly invalidInput: number;
  readonly noCandidate: number;
  readonly candidates: number;
  readonly riskApproved: number;
  readonly riskRejected: number;
  readonly skippedOpenExposure: number;
  readonly ordersExpired: number;
  readonly entriesFilled: number;
  /** Strategy NO_CANDIDATE / INVALID_INPUT: first reason code → count. */
  readonly strategyReasons: Readonly<Record<string, number>>;
  /** Every failed strategy check (all conditions, not only the first) → count. */
  readonly failedStrategyChecks: Readonly<Record<string, number>>;
  /** Risk engine REJECTED: primary reason code → count. */
  readonly riskReasons: Readonly<Record<string, number>>;
  /** Every failed risk rule (not only the primary one) → count. */
  readonly failedRiskRules: Readonly<Record<string, number>>;
}

/** Forward returns from the next candle open (no costs) — research statistics. */
export interface ForwardReturnStats {
  readonly samples: number;
  readonly avgReturn24hPct: string | null;
  readonly avgReturn72hPct: string | null;
  readonly positive24hPct: string | null;
  readonly positive72hPct: string | null;
}

/**
 * Near-miss study: hours in which the strategy failed exactly one entry or
 * price-plan condition, grouped by that condition, compared with actual
 * candidates and with the unconditional baseline of all hours.
 */
export interface NearMissAnalysis {
  readonly baseline: ForwardReturnStats;
  readonly candidates: ForwardReturnStats;
  readonly blockers: readonly ({ readonly blocker: string } & ForwardReturnStats)[];
}

export interface ReplayResult {
  readonly engineVersion: string;
  readonly config: ReplayConfig;
  readonly origin: string;
  readonly synthetic: boolean;
  readonly firstAnchorAt: string | null;
  readonly lastAnchorAt: string | null;
  readonly startingCash: string;
  readonly finalEquity: string;
  readonly funnel: ReplayFunnel;
  readonly invariantViolations: number;
  readonly trades: readonly ReplayTrade[];
  readonly equityCurve: readonly ReplayEquityPoint[];
  readonly metrics: {
    readonly overall: ReplayPeriodMetrics;
    readonly training: ReplayPeriodMetrics | null;
    readonly test: ReplayPeriodMetrics | null;
    readonly nearMiss: NearMissAnalysis;
  };
  /** Canonical hash of trades, funnel and final state — equal across identical runs. */
  readonly outputHash: string;
  readonly notes: readonly string[];
}
