/**
 * Historical shadow replay: hour by hour through stored candles, driving the
 * unchanged production engines in the order the live scheduler runs them.
 *
 * Per anchor candle (the 1h candle that just closed at pipeline time P):
 *   1. entry orders from the previous cycle try to fill on this candle
 *      (`trading-simulation` market fill, entry-gap check, 2-candle expiry);
 *   2. open positions are monitored on this candle (stop-first exit
 *      resolution, time exit, forced close);
 *   3. the portfolio is valued at the candle close (conservative mark) and,
 *      on a new UTC day, a start-of-day snapshot is taken;
 *   4. research inputs are derived point-in-time (signals, multi-timeframe,
 *      regime, data quality) and the strategy evaluates the snapshot at
 *      `asOf = P + scan delay`;
 *   5. a candidate goes through the risk engine (`SPEC`) or straight to the
 *      production sizing function (`SIGNAL_EDGE`), and an approved order
 *      reserves cash.
 *
 * Determinism: no clock, no randomness, deterministic ids. Running the same
 * data and config twice yields the same `outputHash`.
 */

import { computeShadowPerformance, type ClosedShadowTradeInput } from "@signalpilot/performance-intelligence";
import { REGIME_EXIT_POLICY, getStrategy, regimeGateOpen, type StrategyEvaluationResultV1, type StrategyInputSnapshotV1 } from "@signalpilot/strategy-engine";
import { canonicalHash } from "@signalpilot/trading-domain";

import type {
  ReplayCandle,
  ReplayConfig,
  ForwardReturnStats,
  NearMissAnalysis,
  ReplayFunnel,
  ReplayMarketData,
  ReplayPeriodMetrics,
  ReplayResult,
  ReplayTrade
} from "./contracts.js";
import {
  HOUR_MS,
  PORTFOLIO_ID,
  SHADOW_REPLAY_ENGINE_VERSION,
  STRATEGY_VERSION_ID,
  add,
  buildProfile,
  buildStrategySnapshot,
  countEvaluation,
  createPortfolioBook,
  createRegimeTracker,
  createSignalTracker,
  dec,
  fixed,
  hasHistory,
  iso,
  prepareSeries,
  utcDay,
  variantEvaluator,
  type EntryApproval
} from "./replay-core.js";
import { STRATEGY_VARIANTS } from "./variants.js";

export { SHADOW_REPLAY_ENGINE_VERSION };

export interface ReplayHooks {
  /** Diagnostics only — called with every strategy evaluation. */
  readonly onEvaluation?: (anchorCloseTime: string, evaluation: StrategyEvaluationResultV1) => void;
  /**
   * Replaces the strategy evaluation (default: the registered production
   * strategy). Used by tests and by research replays of unregistered rule
   * variants (Evolution Engine); everything downstream stays production code.
   */
  readonly evaluate?: (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1;
  /**
   * Research only: replaces the regime exit of the strategy (default: exit on a
   * closed gate exactly when the strategy declares `REGIME_EXIT_POLICY`, with
   * the specified gate). Lets a regime research variant exit on its own gate.
   */
  readonly regimeExit?: {
    readonly enabled: boolean;
    readonly gateOpen: (regime: { readonly cryptoRegime: string; readonly riskMode: string; readonly confidence: number }) => boolean;
  };
}

export function runShadowReplay(market: ReplayMarketData, config: ReplayConfig, hooks: ReplayHooks = {}): ReplayResult {
  const definition = getStrategy(config.strategyKey);
  if (definition === null) throw new Error(`Unknown strategy ${config.strategyKey}`);

  const prepared = new Map(market.series.map((series) => [series.symbol, prepareSeries(series)] as const));
  const traded = prepared.get(config.symbol);
  if (traded === undefined) throw new Error(`No candles for ${config.symbol}`);
  const hourly = traded.candles["1h"];
  const scanDelayMs = (config.scanDelayMinutes ?? 5) * 60 * 1000;

  const profile = buildProfile(config);
  const evaluate = hooks.evaluate ?? variantEvaluator(config);
  // Like the live monitor: only a strategy that declares the policy exits on a shut regime gate.
  const exitOnRegimeGate =
    hooks.regimeExit?.enabled ?? (definition.parameters as { exitPolicy?: unknown }).exitPolicy === REGIME_EXIT_POLICY;
  const exitGateOpen = hooks.regimeExit?.gateOpen ?? regimeGateOpen;

  const fromMs = config.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(config.from);
  const toMs = config.to === undefined ? Number.POSITIVE_INFINITY : Date.parse(config.to);
  const splitMs = config.trainTestSplitAt === undefined ? null : Date.parse(config.trainTestSplitAt);

  // ── Portfolio state ──────────────────────────────────────────────────────
  const startingCash = fixed(config.startingCash);
  const book = createPortfolioBook({
    startingCash,
    mode: config.mode,
    splitMs,
    killSwitchReviewMs: (config.killSwitchReviewHours ?? 24) * HOUR_MS,
    fundedAtMs: hourly[0]?.closeTime ?? 0,
    profiles: new Map([[config.symbol, profile]]),
    exitOnRegimeGate,
    exitGateOpen
  });
  const funnel = book.funnel;
  const cycleAnchors: number[] = [];
  const candidateAnchors: number[] = [];
  const nearMissAnchors = new Map<string, number[]>();

  // ── Research inputs ──────────────────────────────────────────────────────
  const regime = createRegimeTracker(market, config.regimePolicy);
  const signalTracker = createSignalTracker(config.symbol);

  let firstAnchorMs: number | null = null;
  let lastAnchorMs: number | null = null;

  for (let index = 0; index < hourly.length; index += 1) {
    const anchor = hourly[index];
    const anchorSnapshot = traded.snapshotCandles["1h"][index];
    const pipelineMs = anchor.closeTime + 1;
    const asOfMs = pipelineMs + scanDelayMs;
    if (anchor.closeTime < fromMs || anchor.closeTime > toMs) continue;
    if (!hasHistory(traded, pipelineMs)) continue;

    firstAnchorMs ??= anchor.closeTime;
    lastAnchorMs = anchor.closeTime;
    funnel.cycles += 1;
    cycleAnchors.push(index);

    // 1. Entry fills on this candle.
    let ledgerChanged = book.fillOrders(config.symbol, anchor, anchorSnapshot);
    // 2. Monitor open positions on this candle (with the regime report known before this cycle).
    ledgerChanged = book.monitorPositions(config.symbol, anchor, anchorSnapshot, regime.report) || ledgerChanged;
    // 3. Valuation, high-water mark, start-of-day snapshot and invariants.
    book.valuate({
      closeMs: anchor.closeTime,
      closeOf: () => anchorSnapshot.close,
      benchmarkClose: Number(anchor.close),
      asOfMs,
      cycleIndex: index,
      ledgerChanged
    });
    book.releaseKillSwitchIfReviewed(asOfMs);

    // 4. Research inputs and strategy evaluation at asOf.
    const currentRegime = regime.update(pipelineMs);
    const signals = signalTracker.derive(traded, pipelineMs, currentRegime, regime.version);
    const snapshot = buildStrategySnapshot({
      config,
      definition,
      traded,
      asOfMs,
      pipelineMs,
      signals,
      regime: currentRegime,
      profile
    });
    const evaluation = evaluate(snapshot);
    hooks.onEvaluation?.(iso(anchor.closeTime), evaluation);
    const counted = countEvaluation(funnel, evaluation);
    if (counted.candidate === null) {
      if (counted.nearMissBlocker !== null) {
        const list = nearMissAnchors.get(counted.nearMissBlocker) ?? [];
        list.push(index);
        nearMissAnchors.set(counted.nearMissBlocker, list);
      }
      continue;
    }
    candidateAnchors.push(index);
    const candidate = counted.candidate;

    // 5. Risk decision and order.
    let approval: EntryApproval;
    if (config.mode === "SPEC") {
      const assessed = book.assessRisk({ config, candidate, asOfMs, pipelineMs, regime: currentRegime, traded });
      if (assessed === null) continue;
      book.commitApproval(asOfMs, assessed.riskAmount);
      approval = assessed;
    } else {
      const sized = book.sizeWithoutRiskRules(candidate);
      if (sized === null) continue;
      approval = sized;
    }
    book.placeOrder({ candidate, approval, anchorCloseMs: anchor.closeTime, asOfMs, regime: currentRegime });
  }

  // ── Results ──────────────────────────────────────────────────────────────
  const trades = book.closedTrades;
  const funnelResult: ReplayFunnel = funnel;
  const metrics = {
    overall: periodMetrics("Gesamtzeitraum", trades, book.hourlyEquity, startingCash, null, null, profile),
    training:
      splitMs === null
        ? null
        : periodMetrics("Training (In-Sample)", trades.filter((trade) => trade.period === "TRAINING"), book.hourlyEquity, startingCash, null, splitMs, profile),
    test:
      splitMs === null
        ? null
        : periodMetrics("Test (Out-of-Sample)", trades.filter((trade) => trade.period === "TEST"), book.hourlyEquity, startingCash, splitMs, null, profile),
    nearMiss: nearMissAnalysis(hourly, cycleAnchors, candidateAnchors, nearMissAnchors)
  };

  const notes = [...book.notes];
  if (market.synthetic) notes.unshift("SYNTHETISCHE TESTDATEN — keine Aussage über reale Strategieperformance.");
  if ((config.variant ?? "BASELINE") !== "BASELINE") {
    const variant = STRATEGY_VARIANTS[config.variant!]!;
    notes.push(`Forschungsvariante ${variant.key} (${variant.label}): ${variant.rationale} Nicht live ausführbar.`);
  }
  if (config.mode === "SPEC" && book.killSwitchEngagements > 0) {
    notes.push(
      `Kill-Switch (R-021, Verlustserie) ${book.killSwitchEngagements}× ausgelöst; Replay-Annahme: Operator-Freigabe nach ${config.killSwitchReviewHours ?? 24} h.`
    );
  }
  if (config.mode === "SIGNAL_EDGE") {
    notes.push("Forschungsmodus SIGNAL_EDGE: Risk-Engine-Regeln nicht angewendet; Sizing, Fill- und Exitmodell wie produktiv; eine Position je Symbol.");
  }
  if (config.regimePolicy === "CRYPTO_ONLY") {
    notes.push("Regime-Annahme CRYPTO_ONLY: Regime und Konfidenz nur aus BTC/ETH-Tageskerzen (keine Aktien-Benchmarks).");
  }
  if (config.regimePolicy === "CRYPTO_NATIVE_V1") {
    notes.push("Regime-Variante CRYPTO_NATIVE_V1: Regime, Risk Mode und Konfidenz nur aus BTC/ETH mit 200-Tage-Trendfilter.");
  }
  notes.push("Kontext-Events (News/Radar) und Paper-Statistiken sind historisch nicht rekonstruierbar und fließen nicht ein.");

  const outputHash = canonicalHash({
    engineVersion: SHADOW_REPLAY_ENGINE_VERSION,
    trades,
    funnel: funnelResult,
    finalState: book.state,
    finalEquity: book.equity,
    invariantViolations: book.invariantViolations
  });

  return {
    engineVersion: SHADOW_REPLAY_ENGINE_VERSION,
    config,
    origin: market.origin,
    synthetic: market.synthetic,
    firstAnchorAt: firstAnchorMs === null ? null : iso(firstAnchorMs),
    lastAnchorAt: lastAnchorMs === null ? null : iso(lastAnchorMs),
    startingCash,
    finalEquity: book.equity,
    funnel: funnelResult,
    invariantViolations: book.invariantViolations,
    trades,
    equityCurve: book.dailyEquity,
    metrics,
    outputHash,
    notes
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Result metrics
// ───────────────────────────────────────────────────────────────────────────

function periodMetrics(
  label: string,
  trades: readonly ReplayTrade[],
  hourlyEquity: readonly { at: number; equity: string; close: number; exposed: boolean }[],
  startingCash: string,
  fromMs: number | null,
  toMs: number | null,
  costs: { readonly feeBps: number; readonly fullSpreadBps: number; readonly slippageBps: number }
): ReplayPeriodMetrics {
  const curve = hourlyEquity.filter(
    (point) => (fromMs === null || point.at >= fromMs) && (toMs === null || point.at < toMs)
  );
  const base = curve[0]?.equity ?? startingCash;
  const fromIso = curve[0] === undefined ? null : iso(curve[0].at);
  const toIso = curve.at(-1) === undefined ? null : iso(curve.at(-1)!.at);

  // Daily equity points for the performance engine's return statistics.
  const daily = new Map<number, { asOf: string; tradingDateUtc: string; equity: string }>();
  for (const point of curve) {
    const day = utcDay(point.at);
    daily.set(day, { asOf: iso(point.at), tradingDateUtc: iso(day).slice(0, 10), equity: point.equity });
  }

  const report = computeShadowPerformance({
    portfolioId: PORTFOLIO_ID,
    window: { from: fromIso ?? iso(0), to: toIso ?? iso(0), asOf: toIso ?? iso(0) },
    equityBase: base,
    trades: trades.map(toPerformanceTrade),
    equityCurve: [...daily.values()],
    riskFunnel: { assessedCandidates: 0, riskRejectedCandidates: 0, invalidCandidates: 0, expiredCandidates: 0 },
    sourceThroughPositionEventId: null,
    dataThroughAt: toIso
  });
  const overall = report.segments.find((segment) => segment.segmentType === "OVERALL");
  const metrics = overall?.metrics;

  // Mark-to-market drawdown on the hourly equity curve (stricter than trade-close drawdown).
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  for (const point of curve) {
    const value = Number(point.equity);
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }
  // Benchmark: buy at the first anchor close, sell at the last, paying the
  // same fee, half spread and slippage on both legs as the strategy does.
  const oneLegCost = (costs.feeBps + costs.fullSpreadBps / 2 + costs.slippageBps) / 10_000;
  const firstClose = curve[0]?.close;
  const lastClose = curve.at(-1)?.close;
  let buyAndHoldReturnPct: string | null = null;
  let buyAndHoldMaxDrawdownPct: string | null = null;
  if (firstClose !== undefined && lastClose !== undefined && firstClose > 0) {
    buyAndHoldReturnPct = (((lastClose * (1 - oneLegCost)) / (firstClose * (1 + oneLegCost)) - 1) * 100).toFixed(4);
    let closePeak = Number.NEGATIVE_INFINITY;
    let closeDrawdown = 0;
    for (const point of curve) {
      closePeak = Math.max(closePeak, point.close);
      closeDrawdown = Math.max(closeDrawdown, (closePeak - point.close) / closePeak);
    }
    buyAndHoldMaxDrawdownPct = (closeDrawdown * 100).toFixed(4);
  }
  const exposurePct =
    curve.length === 0 ? null : ((curve.filter((point) => point.exposed).length / curve.length) * 100).toFixed(2);

  const end = curve.at(-1)?.equity ?? base;
  const returnPct = Number(base) > 0 ? (((Number(end) - Number(base)) / Number(base)) * 100).toFixed(4) : null;

  let maxConsecutiveLosses = 0;
  let streak = 0;
  for (const trade of [...trades].sort((a, b) => a.closedAt.localeCompare(b.closedAt))) {
    streak = dec(trade.netPnl).isNegative() ? streak + 1 : 0;
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streak);
  }
  const sum = (pick: (trade: ReplayTrade) => string) =>
    trades.reduce((total, trade) => add(total, pick(trade)), "0.000000000000");
  const spreadCost = sum((trade) => trade.spreadCost);
  const slippageCost = sum((trade) => trade.slippageCost);

  return {
    label,
    from: fromIso,
    to: toIso,
    closedTrades: metrics?.closedTrades ?? 0,
    wins: metrics?.wins ?? 0,
    losses: metrics?.losses ?? 0,
    winRatePct: metrics?.winRatePct.value ?? null,
    profitFactor: metrics?.profitFactor.value ?? null,
    expectancy: metrics?.expectancy.value ?? null,
    averageR: metrics?.averageR.value ?? null,
    averageWin: metrics?.averageWin.value ?? null,
    averageLoss: metrics?.averageLoss.value ?? null,
    maxConsecutiveLosses,
    netPnl: metrics?.netPnl ?? "0.000000000000",
    fees: metrics?.fees ?? "0.000000000000",
    spreadCost,
    slippageCost,
    totalExecutionCost: add(add(metrics?.fees ?? "0.000000000000", spreadCost), slippageCost),
    returnPct,
    maxDrawdownPct: curve.length === 0 ? null : (maxDrawdown * 100).toFixed(4),
    sharpeRatio: metrics?.sharpeRatio.value ?? null,
    sortinoRatio: metrics?.sortinoRatio.value ?? null,
    averageHoldHours:
      metrics?.averageHoldMinutes.value === null || metrics?.averageHoldMinutes.value === undefined
        ? null
        : (Number(metrics.averageHoldMinutes.value) / 60).toFixed(2),
    buyAndHoldReturnPct,
    buyAndHoldMaxDrawdownPct,
    exposurePct
  };
}

function forwardStats(hourly: readonly ReplayCandle[], anchors: readonly number[]): ForwardReturnStats {
  const r24: number[] = [];
  const r72: number[] = [];
  for (const index of anchors) {
    const entry = Number(hourly[index + 1]?.open);
    if (!Number.isFinite(entry) || entry <= 0) continue;
    const at24 = hourly[index + 24];
    const at72 = hourly[index + 72];
    if (at24 !== undefined) r24.push(Number(at24.close) / entry - 1);
    if (at72 !== undefined) r72.push(Number(at72.close) / entry - 1);
  }
  const mean = (values: number[]) => (values.length === 0 ? null : ((values.reduce((a, b) => a + b, 0) / values.length) * 100).toFixed(4));
  const positive = (values: number[]) =>
    values.length === 0 ? null : ((values.filter((value) => value > 0).length / values.length) * 100).toFixed(2);
  return {
    samples: anchors.length,
    avgReturn24hPct: mean(r24),
    avgReturn72hPct: mean(r72),
    positive24hPct: positive(r24),
    positive72hPct: positive(r72)
  };
}

function nearMissAnalysis(
  hourly: readonly ReplayCandle[],
  cycles: readonly number[],
  candidates: readonly number[],
  nearMisses: ReadonlyMap<string, readonly number[]>
): NearMissAnalysis {
  return {
    baseline: forwardStats(hourly, cycles),
    candidates: forwardStats(hourly, candidates),
    blockers: [...nearMisses.entries()]
      .map(([blocker, anchors]) => ({ blocker, ...forwardStats(hourly, anchors) }))
      .sort((left, right) => right.samples - left.samples || left.blocker.localeCompare(right.blocker))
  };
}

function toPerformanceTrade(trade: ReplayTrade): ClosedShadowTradeInput {
  return {
    positionId: trade.positionId,
    portfolioId: PORTFOLIO_ID,
    strategyVersionId: STRATEGY_VERSION_ID,
    assetId: `asset-${trade.symbol}`,
    symbol: trade.symbol,
    direction: trade.direction,
    marketRegime: trade.marketRegime,
    exitReason: trade.exitReason,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    initialQuantity: trade.quantity,
    averageEntryPrice: trade.entryPrice,
    netPnl: trade.netPnl,
    fees: trade.fees,
    simulatedExecutionCost: "0.000000000000",
    plannedRiskAmount: trade.plannedRiskAmount,
    maxAdversePrice: trade.maxAdversePrice,
    maxFavorablePrice: trade.maxFavorablePrice
  };
}
