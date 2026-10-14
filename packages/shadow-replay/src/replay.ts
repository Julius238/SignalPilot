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
import {
  EMPTY_POSITION_STATE,
  applyEntryFillLedger,
  applyEntryFillToPosition,
  applyExitFillLedger,
  applyExitFillToPosition,
  checkPortfolioInvariants,
  computeConservativeMark,
  computePortfolioValuation,
  computePositionMark,
  computeReleaseReservation,
  computeReserveEntry,
  replayLedger,
  type LedgerEntryDraftV1,
  type PortfolioStateV1,
  type PositionMarkResultV1,
  type PositionStateV1
} from "@signalpilot/portfolio";
import {
  CRYPTO_MAJOR_GROUP_KEY,
  CRYPTO_MAJOR_MEMBERS,
  RISK_COST_POLICY_VERSION,
  RISK_ENGINE_VERSION,
  RISK_INPUT_SNAPSHOT_VERSION,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RISK_RULE_SET_VERSION,
  RISK_SIZING_POLICY_VERSION,
  computePositionSizing,
  computePostFillNetRewardRisk,
  evaluateRisk,
  type RiskInputSnapshotV1
} from "@signalpilot/risk-engine";
import {
  CRYPTO_NATIVE_REGIME_SOURCE,
  INDICATORS_V1_VERSION,
  LEGACY_BREAKOUT_IDENTITY,
  LONG_V1_BREAKOUT_IDENTITY,
  STRATEGY_INPUT_SNAPSHOT_VERSION,
  STRATEGY_TIMEFRAMES,
  evaluateCryptoMtfBreakoutV1,
  evaluateStrategy,
  getStrategy,
  type SnapshotCandleV1,
  type StrategyEvaluationResultV1,
  type StrategyInputSnapshotV1,
  type TradeCandidateDraftV1
} from "@signalpilot/strategy-engine";

import { STRATEGY_VARIANTS } from "./variants.js";
import { DecimalValue, RoundingMode, buildSpecificationHash, canonicalHash } from "@signalpilot/trading-domain";
import {
  checkEntryGap,
  computeMarketFill,
  resolveCandleExit,
  type CandleSnapshotV1,
  type ExecutionProfileSnapshotV1
} from "@signalpilot/trading-simulation";
import type { MarketRegimeReport } from "@signalpilot/market-regime";
import { calculateMultiTimeframeSummary as calculateMtf } from "@signalpilot/multi-timeframe";

import type {
  ReplayCandle,
  ReplayConfig,
  ReplayEquityPoint,
  ForwardReturnStats,
  NearMissAnalysis,
  ReplayFunnel,
  ReplayMarketData,
  ReplayPeriodMetrics,
  ReplayResult,
  ReplaySeries,
  ReplayTimeframe,
  ReplayTrade
} from "./contracts.js";
import {
  SIGNAL_CANDLE_LIMIT,
  deriveDataQuality,
  deriveRegime,
  deriveSignal,
  findGapEnds,
  lastClosedIndex,
  toMultiTimeframeInput,
  type DerivedSignal
} from "./research.js";

export const SHADOW_REPLAY_ENGINE_VERSION = "shadow-replay-v1/1.2.0";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_HISTORY = 200;
const PORTFOLIO_ID = "replay-portfolio";
const STRATEGY_ID = "replay-strategy";
const STRATEGY_VERSION_ID = "replay-strategy-version";
const ASSIGNMENT_ID = "replay-assignment";
const SESSION_ID = "replay-session";
const RISK_LIMIT_SET_ID = "replay-risk-limit-set";

const iso = (ms: number): string => new Date(ms).toISOString();
const dec = (value: string | number): DecimalValue => DecimalValue.fromString(typeof value === "number" ? value.toFixed(12) : value);
const fixed = (value: string): string => DecimalValue.fromString(value).toString();
const add = (a: string, b: string): string => dec(a).add(dec(b)).toString();
const sub = (a: string, b: string): string => dec(a).sub(dec(b)).toString();
const utcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

interface PreparedSeries {
  readonly source: ReplaySeries;
  readonly candles: Record<ReplayTimeframe, readonly ReplayCandle[]>;
  readonly snapshotCandles: Record<ReplayTimeframe, readonly SnapshotCandleV1[]>;
  readonly gapEnds: Record<ReplayTimeframe, readonly number[]>;
}

interface OpenOrder {
  readonly id: string;
  readonly candidate: TradeCandidateDraftV1;
  readonly anchorMs: number;
  readonly earliestFillAtMs: number;
  readonly plannedRiskAmount: string;
  readonly regime: string | null;
  remainingQuantity: string;
  reserved: string;
  candlesSeen: number;
  positionId: string | null;
}

interface OpenPosition {
  readonly id: string;
  readonly orderId: string;
  readonly candidate: TradeCandidateDraftV1;
  readonly anchorMs: number;
  readonly openedAtMs: number;
  readonly maxHoldUntilMs: number;
  readonly plannedRiskAmount: string;
  readonly regime: string | null;
  state: PositionStateV1;
  entryFeesTotal: string;
  /** Spread + slippage price impact of every fill so far (quote currency). */
  executionCost: string;
  lastProcessedCloseMs: number;
  pendingExit: { trigger: string; referencePrice: string } | null;
  forceClose: boolean;
  maxAdverse: string;
  maxFavorable: string;
}

interface ClosedPosition {
  readonly trade: ReplayTrade;
  readonly closedAtMs: number;
  readonly netPnl: string;
}

export interface ReplayHooks {
  /** Diagnostics only — called with every strategy evaluation. */
  readonly onEvaluation?: (anchorCloseTime: string, evaluation: StrategyEvaluationResultV1) => void;
  /**
   * Test seam: replaces the strategy evaluation (default: the registered
   * production strategy). Everything downstream stays production code.
   */
  readonly evaluate?: (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1;
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
  const simProfile: ExecutionProfileSnapshotV1 = {
    id: profile.id,
    tickSize: profile.tickSize,
    stepSize: profile.stepSize,
    minQuantity: profile.minQuantity,
    minNotional: profile.minNotional,
    maxQuantity: profile.maxQuantity,
    feeBps: profile.feeBps,
    fullSpreadBps: profile.fullSpreadBps,
    slippageBps: profile.slippageBps,
    maxParticipationRate: profile.maxParticipationRate,
    specificationHash: profile.specificationHash
  };

  const fromMs = config.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(config.from);
  const toMs = config.to === undefined ? Number.POSITIVE_INFINITY : Date.parse(config.to);
  const splitMs = config.trainTestSplitAt === undefined ? null : Date.parse(config.trainTestSplitAt);

  // ── Portfolio state ──────────────────────────────────────────────────────
  const startingCash = fixed(config.startingCash);
  let state: PortfolioStateV1 = {
    availableCash: startingCash,
    reservedCash: "0.000000000000",
    realizedPnl: "0.000000000000",
    feesPaid: "0.000000000000",
    ledgerSequence: 1
  };
  const ledger: LedgerEntryDraftV1[] = [];
  const knownOrderIds = new Set<string>();
  const knownFillIds = new Set<string>();
  const knownPositionIds = new Set<string>();
  let orders: OpenOrder[] = [];
  let positions: OpenPosition[] = [];
  const closed: ClosedPosition[] = [];
  const entryFillDays: number[] = [];
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;
  let highWaterMark = startingCash;
  let startOfDay: { day: number; asOfMs: number; equity: string; sequence: number } | null = null;
  let previousApproval: { assessedAt: string; equity: string; riskAmount: string } | null = null;
  // R-021 engages the kill switch "until a review"; live, the operator's release
  // restarts the loss streak. The replay assumes that review after a fixed delay.
  const killSwitchReviewMs = (config.killSwitchReviewHours ?? 24) * HOUR_MS;
  let killSwitchEngagedAtMs: number | null = null;
  let lastKillSwitchReleaseMs: number | null = null;
  let killSwitchEngagements = 0;
  let equity = startingCash;
  let invariantViolations = 0;
  const notes: string[] = [];

  const funnel = {
    cycles: 0,
    invalidInput: 0,
    noCandidate: 0,
    candidates: 0,
    riskApproved: 0,
    riskRejected: 0,
    skippedOpenExposure: 0,
    ordersExpired: 0,
    entriesFilled: 0,
    strategyReasons: {} as Record<string, number>,
    failedStrategyChecks: {} as Record<string, number>,
    riskReasons: {} as Record<string, number>,
    failedRiskRules: {} as Record<string, number>
  };
  const bump = (bucket: Record<string, number>, key: string) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };

  const hourlyEquity: Array<{ at: number; equity: string; close: number; exposed: boolean }> = [];
  const cycleAnchors: number[] = [];
  const candidateAnchors: number[] = [];
  const nearMissAnchors = new Map<string, number[]>();
  const dailyEquity: ReplayEquityPoint[] = [];

  // ── Research caches ──────────────────────────────────────────────────────
  let regimeDay = -1;
  let regimeReport: MarketRegimeReport | null = null;
  let regimeVersion = 0;
  const signalCache = new Map<string, Omit<DerivedSignal, "createdAtMs">>();
  let previousSignals: Partial<Record<ReplayTimeframe, DerivedSignal>> = {};

  let firstAnchorMs: number | null = null;
  let lastAnchorMs: number | null = null;

  const pushLedger = (entries: readonly LedgerEntryDraftV1[], next: PortfolioStateV1 | null, what: string) => {
    if (next === null) throw new Error(`Ledger operation failed: ${what}`);
    ledger.push(...entries);
    state = next;
  };

  // Funding entry, exactly like the bootstrap job writes it.
  ledger.push({
    entryKey: "replay|INITIAL_CASH",
    sequence: 1,
    type: "INITIAL_CASH",
    availableCashDelta: startingCash,
    reservedCashDelta: "0.000000000000",
    realizedPnlDelta: "0.000000000000",
    feeDelta: "0.000000000000",
    shadowOrderId: null,
    shadowFillId: null,
    shadowPositionId: null,
    correctionOfId: null,
    balanceAfterJson: { availableCash: startingCash, reservedCash: "0.000000000000", equity: startingCash },
    occurredAt: iso(hourly[0]?.closeTime ?? 0)
  });

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
    let ledgerChanged = false;

    // 1. Entry fills on this candle.
    for (const order of orders) {
      if (anchor.openTime < order.earliestFillAtMs) continue;
      order.candlesSeen += 1;
      if (order.candlesSeen === 1) {
        const gap = checkEntryGap({
          direction: order.candidate.direction,
          candleOpen: anchorSnapshot.open,
          plannedEntryMaximum: order.candidate.plannedEntryMaximum,
          plannedEntryMinimum: order.candidate.plannedEntryMinimum
        });
        if (gap.gapTooLarge) {
          releaseOrder(order, anchor.closeTime);
          continue;
        }
      }

      const fill = computeMarketFill({
        side: "BUY",
        referencePrice: anchorSnapshot.open,
        requestedQuantity: order.remainingQuantity,
        candle: toSimCandle(anchorSnapshot),
        executionProfile: simProfile,
        reservedQuoteAmount: order.reserved
      });
      if (!fill.fillable) {
        if (order.candlesSeen >= 2) releaseOrder(order, anchor.closeTime);
        continue;
      }

      const remaining = dec(order.remainingQuantity);
      const fillQuantity = dec(fill.fillQuantity);
      const isFinal = fillQuantity.gte(remaining);
      const reservedForFill = isFinal
        ? dec(order.reserved)
        : dec(order.reserved).mul(fillQuantity, RoundingMode.CEIL).div(remaining, RoundingMode.CEIL);

      let position = positions.find((candidate) => candidate.orderId === order.id);
      const positionId = position?.id ?? nextId("pos");
      const fillId = nextId("fill");
      knownFillIds.add(fillId);
      knownPositionIds.add(positionId);

      const update = applyEntryFillToPosition(position?.state ?? { ...EMPTY_POSITION_STATE, direction: "LONG" }, {
        quantity: fill.fillQuantity,
        fillPrice: fill.fillPrice,
        notional: fill.notional,
        feeAmount: fill.feeAmount,
        collateralAmount: "0.000000000000"
      });
      if (!update.ok || update.position === null) throw new Error(`Entry fill rejected: ${update.reasonCode}`);

      const booking = applyEntryFillLedger({
        direction: "LONG",
        state,
        notionalEntryKey: `${fillId}|BUY_NOTIONAL`,
        feeEntryKey: `${fillId}|FEE`,
        reservedForFill: reservedForFill.toString(),
        fill: {
          quantity: fill.fillQuantity,
          fillPrice: fill.fillPrice,
          notional: fill.notional,
          feeAmount: fill.feeAmount,
          collateralAmount: "0.000000000000"
        },
        shadowOrderId: order.id,
        shadowFillId: fillId,
        shadowPositionId: positionId,
        occurredAt: iso(anchor.closeTime)
      });
      pushLedger(booking.entries, booking.ok ? booking.nextState : null, `entry fill ${fillId}`);
      ledgerChanged = true;

      if (position === undefined) {
        position = {
          id: positionId,
          orderId: order.id,
          candidate: order.candidate,
          anchorMs: order.anchorMs,
          openedAtMs: anchor.closeTime,
          maxHoldUntilMs: anchor.closeTime + order.candidate.maxHoldHours * HOUR_MS,
          plannedRiskAmount: order.plannedRiskAmount,
          regime: order.regime,
          state: update.position,
          entryFeesTotal: fill.feeAmount,
          executionCost: priceImpact(fill.fillPrice, anchorSnapshot.open, fill.fillQuantity),
          lastProcessedCloseMs: anchor.closeTime,
          pendingExit: null,
          forceClose: false,
          maxAdverse: anchorSnapshot.low,
          maxFavorable: anchorSnapshot.high
        };
        positions.push(position);
        funnel.entriesFilled += 1;
        entryFillDays.push(utcDay(anchor.closeTime));
      } else {
        position.state = update.position;
        position.entryFeesTotal = add(position.entryFeesTotal, fill.feeAmount);
        position.executionCost = add(position.executionCost, priceImpact(fill.fillPrice, anchorSnapshot.open, fill.fillQuantity));
      }
      order.positionId = positionId;
      order.remainingQuantity = remaining.sub(fillQuantity).toString();
      order.reserved = dec(order.reserved).sub(reservedForFill).toString();

      // Post-fill net-CRV recheck (ADR 0009) — only the specified path enforces it.
      if (config.mode === "SPEC") {
        const openQuantity = dec(update.position.openQuantity);
        const recheck = computePostFillNetRewardRisk({
          direction: "LONG",
          actualAverageEntryPrice: dec(update.position.averageEntryPrice),
          actualEntryFeePerUnit: openQuantity.isPositive()
            ? dec(update.position.feesPaid).div(openQuantity, RoundingMode.CEIL)
            : DecimalValue.ZERO,
          stopPrice: dec(order.candidate.stopPrice),
          takeProfitPrice: dec(order.candidate.takeProfitPrice),
          tickSize: dec(profile.tickSize),
          feeBps: profile.feeBps,
          fullSpreadBps: profile.fullSpreadBps,
          slippageBps: profile.slippageBps
        });
        if (!recheck.computable || dec(recheck.netRewardRisk).lt(dec(RISK_LIMIT_SET_V1.minRewardRisk))) {
          position.forceClose = true;
          if (!isFinal) releaseOrder(order, anchor.closeTime);
        }
      }
      if (isFinal && dec(order.reserved).isPositive()) releaseOrder(order, anchor.closeTime);
      if (isFinal) order.remainingQuantity = "0.000000000000";
      // A remainder still open after the second candle is released, like the live 2-candle window.
      if (!isFinal && order.candlesSeen >= 2 && dec(order.remainingQuantity).isPositive()) releaseOrder(order, anchor.closeTime);
    }
    orders = orders.filter((order) => dec(order.remainingQuantity).isPositive());

    // 2. Monitor open positions on this candle.
    for (const position of positions) {
      if (anchor.closeTime <= position.lastProcessedCloseMs) continue;
      position.lastProcessedCloseMs = anchor.closeTime;
      if (dec(anchorSnapshot.low).lt(dec(position.maxAdverse))) position.maxAdverse = anchorSnapshot.low;
      if (dec(anchorSnapshot.high).gt(dec(position.maxFavorable))) position.maxFavorable = anchorSnapshot.high;

      let exit = position.pendingExit;
      if (exit === null) {
        const resolution = resolveCandleExit({
          direction: "LONG",
          stopPrice: position.candidate.stopPrice,
          takeProfitPrice: position.candidate.takeProfitPrice,
          maxHoldUntil: iso(position.maxHoldUntilMs),
          candle: toSimCandle(anchorSnapshot)
        });
        if (resolution.triggered && resolution.trigger !== null && resolution.referencePrice !== null) {
          exit = { trigger: resolution.trigger, referencePrice: resolution.referencePrice };
        } else if (position.forceClose) {
          exit = { trigger: "MANUAL_RISK_CLOSE", referencePrice: anchorSnapshot.close };
        }
      }
      if (exit === null) continue;

      const fill = computeMarketFill({
        side: "SELL",
        referencePrice: exit.referencePrice,
        requestedQuantity: position.state.openQuantity,
        candle: toSimCandle(anchorSnapshot),
        executionProfile: simProfile,
        openQuantity: position.state.openQuantity
      });
      if (!fill.fillable) {
        position.pendingExit = exit;
        continue;
      }
      const update = applyExitFillToPosition(
        position.state,
        { quantity: fill.fillQuantity, fillPrice: fill.fillPrice, notional: fill.notional, feeAmount: fill.feeAmount },
        position.entryFeesTotal
      );
      if (!update.ok || update.position === null || update.realizedPnlDelta === null) {
        throw new Error(`Exit fill rejected: ${update.reasonCode}`);
      }
      const fillId = nextId("fill");
      knownFillIds.add(fillId);
      const booking = applyExitFillLedger({
        direction: "LONG",
        state,
        proceedsEntryKey: `${fillId}|SELL_NOTIONAL`,
        feeEntryKey: `${fillId}|FEE`,
        pnlEntryKey: `${fillId}|PNL_ADJUSTMENT`,
        fill: { quantity: fill.fillQuantity, fillPrice: fill.fillPrice, notional: fill.notional, feeAmount: fill.feeAmount },
        realizedPnlDelta: update.realizedPnlDelta,
        grossPnlDelta: update.grossPnlDelta ?? "0.000000000000",
        releasedCollateral: update.releasedCollateralDelta ?? "0.000000000000",
        shadowOrderId: position.orderId,
        shadowFillId: fillId,
        shadowPositionId: position.id,
        occurredAt: iso(anchor.closeTime)
      });
      pushLedger(booking.entries, booking.ok ? booking.nextState : null, `exit fill ${fillId}`);
      ledgerChanged = true;
      position.state = update.position;
      position.executionCost = add(position.executionCost, priceImpact(fill.fillPrice, exit.referencePrice, fill.fillQuantity));
      position.pendingExit = dec(update.position.openQuantity).isPositive() ? exit : null;

      if (!dec(update.position.openQuantity).isPositive()) {
        closed.push(closeTrade(position, exit.trigger, anchor.closeTime, splitMs, profile));
      }
    }
    positions = positions.filter((position) => dec(position.state.openQuantity).isPositive());

    // 3. Valuation, high-water mark and start-of-day snapshot.
    const marks = markPositions(positions, anchorSnapshot.close, profile);
    const valuation = computePortfolioValuation({
      availableCash: state.availableCash,
      reservedCash: state.reservedCash,
      realizedPnl: state.realizedPnl,
      feesPaid: state.feesPaid,
      openPositionMarks: marks,
      highWaterMark,
      startOfDayEquity: startOfDay?.equity ?? null
    });
    if (valuation === null) throw new Error("Portfolio valuation failed.");
    equity = valuation.equity;
    highWaterMark = valuation.highWaterMark;
    hourlyEquity.push({ at: anchor.closeTime, equity, close: Number(anchor.close), exposed: positions.length > 0 });

    const day = utcDay(asOfMs);
    if (startOfDay === null || startOfDay.day !== day) {
      startOfDay = { day, asOfMs: day + 5 * 60 * 1000, equity, sequence: state.ledgerSequence };
      dailyEquity.push({ at: iso(asOfMs), equity });
    }

    if (ledgerChanged || index % 24 === 0) {
      const replay = replayLedger(ledger, {
        shadowOrderIds: knownOrderIds,
        shadowFillIds: knownFillIds,
        shadowPositionIds: knownPositionIds
      });
      const report = checkPortfolioInvariants({
        cache: state,
        cacheEquity: equity,
        replayed: replay.state,
        openReservations: orders.map((order) => ({ shadowOrderId: order.id, reservedQuoteAmount: order.reserved })),
        marketValue: marks.reduce((sum, mark) => add(sum, mark.equityContribution), "0.000000000000"),
        orphanReferenceCount: replay.orphanReferenceCount,
        sequenceGapCount: replay.sequenceGapCount,
        duplicateAssetScopeCount: 0,
        toleranceUnscaled: "0.00000001"
      });
      if (!report.consistent) {
        invariantViolations += 1;
        if (notes.length < 10) notes.push(`Invarianten verletzt bei ${iso(anchor.closeTime)}: ${report.violations.join(", ")}`);
      }
    }

    if (killSwitchEngagedAtMs !== null && asOfMs >= killSwitchEngagedAtMs + killSwitchReviewMs) {
      lastKillSwitchReleaseMs = killSwitchEngagedAtMs + killSwitchReviewMs;
      killSwitchEngagedAtMs = null;
    }

    // 4. Research inputs and strategy evaluation at asOf.
    const regimeKey = utcDay(pipelineMs);
    if (regimeKey !== regimeDay) {
      regimeDay = regimeKey;
      regimeReport = deriveRegime(market.series, pipelineMs, config.regimePolicy);
      regimeVersion += 1;
    }
    const currentRegime = regimeReport === null ? null : { ...regimeReport, generatedAt: iso(pipelineMs) };

    const signals: Partial<Record<ReplayTimeframe, DerivedSignal>> = {};
    for (const timeframe of STRATEGY_TIMEFRAMES) {
      const candles = traded.candles[timeframe];
      const last = lastClosedIndex(candles, pipelineMs);
      if (last < 0) continue;
      const cacheKey = `${timeframe}:${last}:${regimeVersion}`;
      let cached = signalCache.get(cacheKey);
      if (cached === undefined) {
        const others = STRATEGY_TIMEFRAMES.filter((other) => other !== timeframe)
          .map((other) => signals[other] ?? previousSignals[other])
          .filter((signal): signal is DerivedSignal => signal !== undefined)
          .map((signal) => toMultiTimeframeInput(config.symbol, signal));
        const derived = deriveSignal({
          symbol: config.symbol,
          timeframe,
          window: candles.slice(Math.max(0, last + 1 - SIGNAL_CANDLE_LIMIT), last + 1),
          regime: currentRegime,
          otherSignals: others,
          createdAtMs: pipelineMs
        });
        if (derived === null) continue;
        const { createdAtMs: _ignored, ...rest } = derived;
        void _ignored;
        cached = rest;
        signalCache.set(cacheKey, cached);
        if (signalCache.size > 64) signalCache.delete(signalCache.keys().next().value as string);
      }
      signals[timeframe] = { ...cached, createdAtMs: pipelineMs };
    }
    previousSignals = signals;

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
    for (const check of evaluation.checks) {
      if (!check.passed) bump(funnel.failedStrategyChecks, check.reasonCode);
    }
    if (evaluation.outcome === "INVALID_INPUT") {
      funnel.invalidInput += 1;
      bump(funnel.strategyReasons, evaluation.primaryReasonCode);
      continue;
    }
    if (evaluation.outcome === "NO_CANDIDATE") {
      funnel.noCandidate += 1;
      bump(funnel.strategyReasons, evaluation.primaryReasonCode);
      const blockers = evaluation.checks.filter((check) => !check.passed && check.stage !== "PRE_VALIDATION");
      if (blockers.length === 1) {
        const list = nearMissAnchors.get(blockers[0].reasonCode) ?? [];
        list.push(index);
        nearMissAnchors.set(blockers[0].reasonCode, list);
      }
      continue;
    }
    funnel.candidates += 1;
    candidateAnchors.push(index);
    const candidate = evaluation.candidate;

    // 5. Risk decision and order.
    const exposure = positions.length > 0 || orders.length > 0;
    let approvedQuantity: string;
    let reservedQuoteAmount: string;
    let riskAmount: string;
    if (config.mode === "SPEC") {
      const riskSnapshot = buildRiskSnapshot({
        config,
        candidate,
        asOfMs,
        state,
        equity,
        highWaterMark,
        ledgerEntries: ledger,
        startOfDay,
        positions,
        marks,
        orders,
        closed,
        entryFillDays,
        profile,
        regime: currentRegime,
        traded,
        pipelineMs,
        previousApproval,
        killSwitchEngaged: killSwitchEngagedAtMs !== null,
        lastKillSwitchReleaseMs
      });
      const risk = evaluateRisk(riskSnapshot);
      if (risk.directive === "ENGAGE_KILL_SWITCH" && killSwitchEngagedAtMs === null) {
        killSwitchEngagedAtMs = asOfMs;
        killSwitchEngagements += 1;
      }
      for (const rule of risk.ruleResults) {
        if (rule.outcome === "FAIL" || rule.outcome === "ERROR") bump(funnel.failedRiskRules, `${rule.ruleCode}:${rule.reasonCode}`);
      }
      if (risk.outcome !== "APPROVED") {
        funnel.riskRejected += 1;
        bump(funnel.riskReasons, risk.primaryReasonCode);
        continue;
      }
      funnel.riskApproved += 1;
      approvedQuantity = risk.assessment.approvedQuantity;
      reservedQuoteAmount = risk.assessment.sizing.reservedQuoteAmount;
      riskAmount = risk.assessment.riskAmount;
      previousApproval = { assessedAt: iso(asOfMs), equity, riskAmount };
    } else {
      if (exposure) {
        funnel.skippedOpenExposure += 1;
        continue;
      }
      const sizing = computePositionSizing({
        direction: "LONG",
        referenceEntryPrice: dec(candidate.referenceEntryPrice),
        stopPrice: dec(candidate.stopPrice),
        takeProfitPrice: dec(candidate.takeProfitPrice),
        equity: dec(equity),
        availableCash: dec(state.availableCash),
        currentGrossExposure: DecimalValue.ZERO,
        currentAssetExposure: DecimalValue.ZERO,
        currentCorrelatedExposure: DecimalValue.ZERO,
        maxRiskPerTradePct: dec(RISK_LIMIT_SET_V1.maxRiskPerTradePct),
        maxGrossExposurePct: dec(RISK_LIMIT_SET_V1.maxGrossExposurePct),
        maxAssetExposurePct: dec(RISK_LIMIT_SET_V1.maxAssetExposurePct),
        maxCorrelatedExposurePct: dec(RISK_LIMIT_SET_V1.maxCorrelatedExposurePct),
        tickSize: dec(profile.tickSize),
        stepSize: dec(profile.stepSize),
        minQuantity: dec(profile.minQuantity),
        minNotional: dec(profile.minNotional),
        maxQuantity: profile.maxQuantity === null ? null : dec(profile.maxQuantity),
        feeBps: profile.feeBps,
        fullSpreadBps: profile.fullSpreadBps,
        slippageBps: profile.slippageBps
      });
      if (!sizing.computable || !dec(sizing.approvedQuantity).isPositive()) {
        funnel.riskRejected += 1;
        bump(funnel.riskReasons, "SIZING_ZERO");
        continue;
      }
      funnel.riskApproved += 1;
      approvedQuantity = sizing.approvedQuantity;
      reservedQuoteAmount = sizing.reservedQuoteAmount;
      riskAmount = sizing.riskAmount;
    }

    const orderId = nextId("ord");
    const reserve = computeReserveEntry({
      state,
      entryKey: `${orderId}|RESERVE`,
      reservedQuoteAmount,
      shadowOrderId: orderId,
      occurredAt: iso(asOfMs)
    });
    if (!reserve.ok || reserve.nextState === null) {
      funnel.riskRejected += 1;
      bump(funnel.riskReasons, reserve.reasonCode);
      continue;
    }
    knownOrderIds.add(orderId);
    pushLedger(reserve.entries, reserve.nextState, `reserve ${orderId}`);
    orders.push({
      id: orderId,
      candidate,
      anchorMs: anchor.closeTime,
      earliestFillAtMs: Date.parse(candidate.earliestFillAt),
      plannedRiskAmount: riskAmount,
      regime: currentRegime?.cryptoRegime ?? null,
      remainingQuantity: approvedQuantity,
      reserved: reservedQuoteAmount,
      candlesSeen: 0,
      positionId: null
    });
  }

  function releaseOrder(order: OpenOrder, atMs: number) {
    if (dec(order.reserved).isPositive()) {
      const release = computeReleaseReservation({
        state,
        entryKey: `${order.id}|RELEASE|${atMs}`,
        releaseAmount: order.reserved,
        shadowOrderId: order.id,
        occurredAt: iso(atMs)
      });
      pushLedger(release.entries, release.ok ? release.nextState : null, `release ${order.id}`);
    }
    if (order.positionId === null) funnel.ordersExpired += 1;
    order.reserved = "0.000000000000";
    order.remainingQuantity = "0.000000000000";
  }

  // ── Results ──────────────────────────────────────────────────────────────
  const trades = closed.map((entry) => entry.trade);
  const funnelResult: ReplayFunnel = funnel;
  const metrics = {
    overall: periodMetrics("Gesamtzeitraum", trades, hourlyEquity, startingCash, null, null, profile),
    training:
      splitMs === null
        ? null
        : periodMetrics("Training (In-Sample)", trades.filter((trade) => trade.period === "TRAINING"), hourlyEquity, startingCash, null, splitMs, profile),
    test:
      splitMs === null
        ? null
        : periodMetrics("Test (Out-of-Sample)", trades.filter((trade) => trade.period === "TEST"), hourlyEquity, startingCash, splitMs, null, profile),
    nearMiss: nearMissAnalysis(hourly, cycleAnchors, candidateAnchors, nearMissAnchors)
  };

  if (market.synthetic) notes.unshift("SYNTHETISCHE TESTDATEN — keine Aussage über reale Strategieperformance.");
  if ((config.variant ?? "BASELINE") !== "BASELINE") {
    const variant = STRATEGY_VARIANTS[config.variant!]!;
    notes.push(`Forschungsvariante ${variant.key} (${variant.label}): ${variant.rationale} Nicht live ausführbar.`);
  }
  if (config.mode === "SPEC" && killSwitchEngagements > 0) {
    notes.push(
      `Kill-Switch (R-021, Verlustserie) ${killSwitchEngagements}× ausgelöst; Replay-Annahme: Operator-Freigabe nach ${config.killSwitchReviewHours ?? 24} h.`
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
    finalState: state,
    finalEquity: equity,
    invariantViolations
  });

  return {
    engineVersion: SHADOW_REPLAY_ENGINE_VERSION,
    config,
    origin: market.origin,
    synthetic: market.synthetic,
    firstAnchorAt: firstAnchorMs === null ? null : iso(firstAnchorMs),
    lastAnchorAt: lastAnchorMs === null ? null : iso(lastAnchorMs),
    startingCash,
    finalEquity: equity,
    funnel: funnelResult,
    invariantViolations,
    trades,
    equityCurve: dailyEquity,
    metrics,
    outputHash,
    notes
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function prepareSeries(series: ReplaySeries): PreparedSeries {
  const candles = {} as Record<ReplayTimeframe, readonly ReplayCandle[]>;
  const snapshotCandles = {} as Record<ReplayTimeframe, readonly SnapshotCandleV1[]>;
  const gapEnds = {} as Record<ReplayTimeframe, readonly number[]>;
  for (const timeframe of ["1h", "4h", "1d"] as const) {
    const sorted = [...(series.candles[timeframe] ?? [])].sort((a, b) => a.openTime - b.openTime);
    candles[timeframe] = sorted;
    snapshotCandles[timeframe] = sorted.map((candle) => ({
      id: `${series.symbol}-${timeframe}-${candle.openTime}`,
      openTime: iso(candle.openTime),
      closeTime: iso(candle.closeTime),
      open: fixed(candle.open),
      high: fixed(candle.high),
      low: fixed(candle.low),
      close: fixed(candle.close),
      volume: fixed(candle.volume),
      source: series.source
    }));
    gapEnds[timeframe] = findGapEnds(sorted, timeframe);
  }
  return { source: series, candles, snapshotCandles, gapEnds };
}

function hasHistory(series: PreparedSeries, atMs: number): boolean {
  return (["1h", "4h", "1d"] as const).every(
    (timeframe) => lastClosedIndex(series.candles[timeframe], atMs) + 1 >= MIN_HISTORY
  );
}

function toSimCandle(candle: SnapshotCandleV1): CandleSnapshotV1 {
  return {
    id: candle.id,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
}

interface ReplayProfile {
  readonly id: string;
  readonly tickSize: string;
  readonly stepSize: string;
  readonly minQuantity: string;
  readonly minNotional: string;
  readonly maxQuantity: string | null;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: string;
  readonly specificationHash: string;
}

function buildProfile(config: ReplayConfig): ReplayProfile {
  const base = {
    tickSize: fixed(config.executionProfile.tickSize),
    stepSize: fixed(config.executionProfile.stepSize),
    minQuantity: fixed(config.executionProfile.minQuantity),
    minNotional: fixed(config.executionProfile.minNotional),
    maxQuantity: config.executionProfile.maxQuantity === null ? null : fixed(config.executionProfile.maxQuantity),
    feeBps: config.executionProfile.feeBps,
    fullSpreadBps: config.executionProfile.fullSpreadBps,
    slippageBps: config.executionProfile.slippageBps,
    maxParticipationRate: fixed(config.executionProfile.maxParticipationRate)
  };
  return { id: `replay-profile-${config.symbol}`, ...base, specificationHash: buildSpecificationHash(base) };
}

function markPositions(positions: readonly OpenPosition[], close: string, profile: ReplayProfile): PositionMarkResultV1[] {
  return positions.map((position) => {
    const markPrice = computeConservativeMark("LONG", close, profile.fullSpreadBps, profile.tickSize);
    if (markPrice === null) throw new Error("Invalid mark price.");
    const mark = computePositionMark({
      direction: "LONG",
      openQuantity: position.state.openQuantity,
      averageEntryPrice: position.state.averageEntryPrice,
      conservativeBidMark: markPrice,
      estimatedExitFeeRate: (profile.feeBps / 10_000).toFixed(12)
    });
    if (mark === null) throw new Error("Invalid position mark.");
    return mark;
  });
}

/** |fill − reference| × quantity: what the simulated spread and slippage moved the price. */
function priceImpact(fillPrice: string, referencePrice: string, quantity: string): string {
  return dec(fillPrice).sub(dec(referencePrice)).abs().mul(dec(quantity), RoundingMode.HALF_UP).toString();
}

function closeTrade(
  position: OpenPosition,
  trigger: string,
  closedAtMs: number,
  splitMs: number | null,
  costs: { readonly fullSpreadBps: number; readonly slippageBps: number }
): ClosedPosition {
  const state = position.state;
  // Fill prices move by half the spread plus the slippage (then tick-rounded),
  // so the impact is attributed to both in that proportion.
  const impactBps = costs.fullSpreadBps / 2 + costs.slippageBps;
  const spreadShare = impactBps > 0 ? costs.fullSpreadBps / 2 / impactBps : 0;
  const spreadCost = dec(position.executionCost).mul(dec(spreadShare), RoundingMode.HALF_UP);
  const netPnl = state.realizedPnl;
  const fees = state.feesPaid;
  const grossPnl = add(netPnl, fees);
  const risk = dec(position.plannedRiskAmount);
  const trade: ReplayTrade = {
    positionId: position.id,
    candidateKey: position.candidate.candidateKey,
    symbol: position.candidate.symbol,
    direction: "LONG",
    period: splitMs !== null && position.anchorMs >= splitMs ? "TEST" : "TRAINING",
    anchorAt: iso(position.anchorMs),
    openedAt: iso(position.openedAtMs),
    closedAt: iso(closedAtMs),
    exitReason: trigger,
    quantity: state.initialQuantity,
    entryPrice: state.averageEntryPrice,
    exitPrice: state.averageExitPrice ?? "0.000000000000",
    stopPrice: position.candidate.stopPrice,
    takeProfitPrice: position.candidate.takeProfitPrice,
    plannedRiskAmount: position.plannedRiskAmount,
    grossPnl,
    fees,
    netPnl,
    rMultiple: risk.isPositive() ? dec(netPnl).div(risk, RoundingMode.HALF_UP).toString() : null,
    spreadCost: spreadCost.toString(),
    slippageCost: dec(position.executionCost).sub(spreadCost).toString(),
    maxAdversePrice: position.maxAdverse,
    maxFavorablePrice: position.maxFavorable,
    marketRegime: position.regime
  };
  return { trade, closedAtMs, netPnl };
}

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

// ───────────────────────────────────────────────────────────────────────────
// Snapshot builders — same shape and formatting as the trading worker's
// assemblers (`strategyInputAssembler.ts`, `riskInputAssembler.ts`).
// ───────────────────────────────────────────────────────────────────────────

function buildStrategySnapshot(input: {
  readonly config: ReplayConfig;
  readonly definition: NonNullable<ReturnType<typeof getStrategy>>;
  readonly traded: PreparedSeries;
  readonly asOfMs: number;
  readonly pipelineMs: number;
  readonly signals: Partial<Record<ReplayTimeframe, DerivedSignal>>;
  readonly regime: MarketRegimeReport | null;
  readonly profile: ReplayProfile;
}): StrategyInputSnapshotV1 {
  const { config, definition, traded, asOfMs, pipelineMs, signals, regime, profile } = input;
  const symbol = config.symbol;
  const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;

  const series = {} as { -readonly [K in keyof StrategyInputSnapshotV1["series"]]: StrategyInputSnapshotV1["series"][K] };
  for (const timeframe of STRATEGY_TIMEFRAMES) {
    const candles = traded.candles[timeframe];
    const last = lastClosedIndex(candles, asOfMs);
    const window = traded.snapshotCandles[timeframe].slice(Math.max(0, last + 1 - SIGNAL_CANDLE_LIMIT), last + 1);
    const quality = deriveDataQuality(candles, traded.gapEnds[timeframe], timeframe, pipelineMs);
    series[timeframe] = {
      timeframe,
      candles: window,
      dataQuality: {
        id: `dq-${symbol}-${timeframe}-${pipelineMs}`,
        provider: traded.source.source,
        timeframe,
        observedAt: iso(pipelineMs),
        latestClosedCandle: quality.latestClosedCandle === null ? null : iso(quality.latestClosedCandle),
        candleCount: quality.candleCount,
        expectedCandleCount: quality.expectedCandleCount,
        gapCount: quality.gapCount,
        missingCandleCount: quality.missingCandleCount,
        providerErrorCount: 0,
        rateLimitCount: 0,
        entitlementErrorCount: 0,
        noDataCount: 0,
        lastErrorKind: null
      }
    };
  }

  const signalSnapshot = (timeframe: ReplayTimeframe) => {
    const signal = signals[timeframe];
    if (signal === undefined) return null;
    return {
      id: `sig-${symbol}-${timeframe}-${signal.createdAtMs}`,
      timeframe,
      signalType: signal.signalType,
      status: signal.status,
      direction: signal.direction,
      riskLevel: signal.riskLevel,
      baseScore: signal.score,
      adjustedScore: signal.score,
      adjustedScoreSource: "RULE_APPLICATION" as const,
      adjustedStatus: signal.status,
      riskScore: signal.riskScore,
      ruleApplicationId: `rule-${symbol}-${timeframe}-${signal.createdAtMs}`,
      outputId: null,
      createdAt: iso(signal.createdAtMs)
    };
  };

  const mtfInputs = STRATEGY_TIMEFRAMES.flatMap((timeframe) => {
    const signal = signals[timeframe];
    return signal === undefined ? [] : [toMultiTimeframeInput(symbol, signal)];
  });
  const mtf = mtfInputs.length === 0 ? null : calculateMtf(mtfInputs);

  return {
    snapshotVersion: STRATEGY_INPUT_SNAPSHOT_VERSION,
    asOf: iso(asOfMs),
    asset: {
      id: `asset-${symbol}`,
      symbol,
      assetType: "CRYPTO",
      exchange: "BINANCE",
      provider: "BINANCE",
      baseCurrency: base,
      quoteCurrency: "USDT",
      instrumentStatus: "ACTIVE",
      isActive: true,
      isTradable: true,
      isLeveraged: false,
      isInverse: false,
      isStablecoin: false
    },
    strategy: {
      strategyId: STRATEGY_ID,
      strategyKey: definition.key,
      strategyVersionId: STRATEGY_VERSION_ID,
      version: 1,
      status: "ACTIVE",
      engineVersion: definition.engineVersion,
      codeVersion: config.codeVersion,
      specificationHash: definition.specificationHash
    },
    assignment: {
      id: ASSIGNMENT_ID,
      portfolioId: PORTFOLIO_ID,
      timeframe: "1h",
      enabled: true,
      validFrom: null,
      validTo: null
    },
    series,
    signals: { "1h": signalSnapshot("1h"), "4h": signalSnapshot("4h"), "1d": signalSnapshot("1d") },
    multiTimeframe:
      mtf === null
        ? null
        : {
            version: "multi-timeframe/1.0.0",
            alignment: mtf.alignment,
            alignmentScore: (Math.min(Math.max(Number.isFinite(mtf.alignmentScore) ? mtf.alignmentScore : 0, 0), 100) / 100).toFixed(12),
            alignmentScoreRaw: mtf.alignmentScore,
            primaryTimeframe: mtf.primaryTimeframe,
            confirmingTimeframes: [...mtf.confirmingTimeframes],
            conflictingTimeframes: [...mtf.conflictingTimeframes],
            riskLevel: mtf.riskLevel,
            sourceSignalIds: STRATEGY_TIMEFRAMES.flatMap((timeframe) => {
              const signal = signals[timeframe];
              return signal === undefined ? [] : [`sig-${symbol}-${timeframe}-${signal.createdAtMs}`];
            })
          },
    marketRegime:
      regime === null
        ? null
        : {
            id: `regime-${Date.parse(regime.generatedAt)}`,
            generatedAt: regime.generatedAt,
            equityRegime: regime.equityRegime,
            cryptoRegime: regime.cryptoRegime,
            overallRegime: regime.overallRegime,
            riskMode: regime.riskMode,
            confidence: regime.confidence,
            // Like the live assembler: a non-production model names itself.
            ...(config.regimePolicy === "CRYPTO_NATIVE_V1" ? { source: CRYPTO_NATIVE_REGIME_SOURCE } : {})
          },
    executionProfile: {
      id: profile.id,
      version: 1,
      status: "ACTIVE",
      tickSize: profile.tickSize,
      stepSize: profile.stepSize,
      minQuantity: profile.minQuantity,
      minNotional: profile.minNotional,
      feeBps: profile.feeBps,
      fullSpreadBps: profile.fullSpreadBps,
      slippageBps: profile.slippageBps,
      maxParticipationRate: profile.maxParticipationRate,
      source: "REPLAY_CONFIG",
      sourceObservedAt: iso(0),
      specificationHash: profile.specificationHash
    },
    contextEvents: [],
    policyVersions: {
      inputAssemblerVersion: `${SHADOW_REPLAY_ENGINE_VERSION}#strategy-input`,
      indicatorVersion: INDICATORS_V1_VERSION,
      multiTimeframeVersion: "multi-timeframe/1.0.0",
      breakoutPolicyVersion: String(
        (definition.parameters as { breakoutPolicyVersion?: string; breakdownPolicyVersion?: string }).breakoutPolicyVersion ??
          (definition.parameters as { breakdownPolicyVersion?: string }).breakdownPolicyVersion
      ),
      freshnessPolicyVersion: String((definition.parameters as { freshnessPolicyVersion: string }).freshnessPolicyVersion)
    }
  };
}

function buildRiskSnapshot(input: {
  readonly config: ReplayConfig;
  readonly candidate: TradeCandidateDraftV1;
  readonly asOfMs: number;
  readonly state: PortfolioStateV1;
  readonly equity: string;
  readonly highWaterMark: string;
  readonly ledgerEntries: readonly LedgerEntryDraftV1[];
  readonly startOfDay: { asOfMs: number; equity: string; sequence: number } | null;
  readonly positions: readonly OpenPosition[];
  readonly marks: readonly PositionMarkResultV1[];
  readonly orders: readonly OpenOrder[];
  readonly closed: readonly ClosedPosition[];
  readonly entryFillDays: readonly number[];
  readonly profile: ReplayProfile;
  readonly regime: MarketRegimeReport | null;
  readonly traded: PreparedSeries;
  readonly pipelineMs: number;
  readonly previousApproval: { assessedAt: string; equity: string; riskAmount: string } | null;
  readonly killSwitchEngaged: boolean;
  readonly lastKillSwitchReleaseMs: number | null;
}): RiskInputSnapshotV1 {
  const { candidate, asOfMs, state, profile, regime, traded } = input;
  const today = utcDay(asOfMs);
  const sums = input.ledgerEntries.reduce(
    (acc, entry) => ({
      availableCash: add(acc.availableCash, entry.availableCashDelta),
      reservedCash: add(acc.reservedCash, entry.reservedCashDelta),
      realizedPnl: add(acc.realizedPnl, entry.realizedPnlDelta),
      feesPaid: add(acc.feesPaid, entry.feeDelta)
    }),
    {
      availableCash: "0.000000000000",
      reservedCash: "0.000000000000",
      realizedPnl: "0.000000000000",
      feesPaid: "0.000000000000"
    }
  );

  // Like the live assembler: the streak restarts after the latest kill-switch release.
  let consecutiveLosses = 0;
  for (const position of [...input.closed].sort((a, b) => b.closedAtMs - a.closedAtMs)) {
    if (input.lastKillSwitchReleaseMs !== null && position.closedAtMs <= input.lastKillSwitchReleaseMs) break;
    const pnl = dec(position.netPnl);
    if (pnl.isPositive()) break;
    if (pnl.isNegative()) consecutiveLosses += 1;
  }

  const candleAge = (timeframe: ReplayTimeframe) => {
    const last = lastClosedIndex(traded.candles[timeframe], asOfMs);
    return last < 0 ? null : asOfMs - traded.candles[timeframe][last].closeTime;
  };
  const quality = (timeframe: ReplayTimeframe) =>
    deriveDataQuality(traded.candles[timeframe], traded.gapEnds[timeframe], timeframe, input.pipelineMs);
  const q1h = quality("1h");
  const q4h = quality("4h");
  const q1d = quality("1d");

  return {
    snapshotVersion: RISK_INPUT_SNAPSHOT_VERSION,
    asOf: iso(asOfMs),
    tradingDateUtc: iso(today).slice(0, 10),
    capability: {
      buildCapability: "SHADOW_ONLY",
      tradingMode: "SHADOW",
      enableLiveTrading: false,
      shadowMasterFlagEnabled: true,
      riskJobEnabled: true,
      strategyLongV1Enabled: true,
      strategyShortV1Enabled: false,
      shadowShortEnabled: false,
      exchangeExecutionEnabled: false,
      marginTradingEnabled: false,
      futuresTradingEnabled: false
    },
    candidate: {
      // A database id in production; it becomes part of the risk assessment
      // key, so it must be a single key part (the composite candidate key is not).
      id: `replay-candidate-${candidate.anchorCandleId}`,
      candidateKey: candidate.candidateKey,
      status: "CREATED",
      direction: candidate.direction,
      entryType: candidate.entryType,
      symbol: candidate.symbol,
      assetId: candidate.assetId,
      portfolioId: PORTFOLIO_ID,
      strategyAssignmentId: ASSIGNMENT_ID,
      strategyVersionId: STRATEGY_VERSION_ID,
      strategyVersionStatus: "ACTIVE",
      strategyKey: candidate.strategyKey,
      strategyDirection: candidate.direction,
      assignmentEnabled: true,
      assignmentDirection: candidate.direction,
      anchorCandleId: candidate.anchorCandleId,
      referenceEntryPrice: candidate.referenceEntryPrice,
      stopPrice: candidate.stopPrice,
      takeProfitPrice: candidate.takeProfitPrice,
      minimumRewardRisk: candidate.minimumRewardRisk,
      stopDistance: candidate.stopDistance,
      stopDistancePct: candidate.stopDistancePct,
      plannedRewardRisk: candidate.plannedRewardRisk,
      plannedEntryMinimum: candidate.plannedEntryMinimum,
      plannedEntryMaximum: candidate.plannedEntryMaximum,
      maximumEntryGapDistance: candidate.maximumEntryGapDistance,
      validFrom: candidate.validFrom,
      earliestFillAt: candidate.earliestFillAt,
      maxHoldHours: candidate.maxHoldHours,
      dataAsOf: candidate.dataAsOf,
      decisionTime: candidate.decisionTime,
      expiresAt: candidate.expiresAt,
      inputHash: candidate.inputHash,
      strategyOutputHash: candidate.outputHash,
      strategySpecificationHash: candidate.specificationHash,
      strategyEngineVersion: candidate.engineVersion,
      hasFinalDecision: false
    },
    asset: {
      id: candidate.assetId,
      symbol: candidate.symbol,
      assetType: "CRYPTO",
      quoteCurrency: "USDT",
      isTradable: true,
      isActive: true,
      isLeveraged: false,
      isInverse: false,
      isStablecoin: false,
      instrumentStatus: "ACTIVE"
    },
    session: {
      id: SESSION_ID,
      sessionKey: "replay-session",
      portfolioId: PORTFOLIO_ID,
      mode: "SHADOW",
      status: "SHADOW_ACTIVE",
      killSwitchEngaged: input.killSwitchEngaged,
      reconciledAt: iso(asOfMs),
      heartbeatAt: iso(asOfMs),
      version: 1
    },
    portfolio: {
      id: PORTFOLIO_ID,
      key: "SHADOW_REPLAY",
      status: "ACTIVE",
      baseCurrency: "USDT",
      startingCash: fixed(input.config.startingCash),
      availableCash: state.availableCash,
      reservedCash: state.reservedCash,
      realizedPnl: state.realizedPnl,
      feesPaid: state.feesPaid,
      equity: input.equity,
      highWaterMark: input.highWaterMark,
      ledgerSequence: state.ledgerSequence,
      lastReconciledAt: iso(asOfMs),
      version: state.ledgerSequence
    },
    ledgerReplay: {
      sequence: state.ledgerSequence,
      entryCount: input.ledgerEntries.length,
      ...sums,
      orphanReferenceCount: 0,
      sequenceGapCount: input.ledgerEntries.length === state.ledgerSequence ? 0 : 1
    },
    startOfDay:
      input.startOfDay === null
        ? null
        : {
            asOf: iso(input.startOfDay.asOfMs),
            sourceLedgerSequence: input.startOfDay.sequence,
            equity: input.startOfDay.equity
          },
    openPositions: input.positions.map((position, index) => ({
      id: position.id,
      positionKey: position.id,
      assetId: position.candidate.assetId,
      symbol: position.candidate.symbol,
      status: "OPEN",
      direction: "LONG",
      openQuantity: position.state.openQuantity,
      averageEntryPrice: position.state.averageEntryPrice,
      marketValue: input.marks[index]?.marketValue ?? "INVALID",
      equityContribution: input.marks[index]?.equityContribution ?? "INVALID",
      reservedCollateral: position.state.reservedCollateral
    })),
    reservations: input.orders
      .filter((order) => dec(order.reserved).isPositive())
      .map((order) => ({
        shadowOrderId: order.id,
        assetId: order.candidate.assetId,
        symbol: order.candidate.symbol,
        status: "WAITING_FOR_ENTRY",
        direction: "LONG",
        purpose: "ENTRY",
        reservedQuoteAmount: order.reserved
      })),
    dailyCounters: {
      tradingDateUtc: iso(today).slice(0, 10),
      filledEntryOrdersToday: input.entryFillDays.filter((day) => day === today).length,
      consecutiveLosses,
      dailyPnl: input.startOfDay === null ? "0.000000000000" : sub(input.equity, input.startOfDay.equity),
      closedTradeSequence: input.closed.length
    },
    executionProfile: {
      id: profile.id,
      assetId: candidate.assetId,
      version: 1,
      status: "ACTIVE",
      tickSize: profile.tickSize,
      stepSize: profile.stepSize,
      minQuantity: profile.minQuantity,
      minNotional: profile.minNotional,
      maxQuantity: profile.maxQuantity,
      feeBps: profile.feeBps,
      fullSpreadBps: profile.fullSpreadBps,
      slippageBps: profile.slippageBps,
      maxParticipationRate: profile.maxParticipationRate,
      sourceObservedAt: iso(0),
      specificationHash: profile.specificationHash
    },
    riskLimitSet: {
      id: RISK_LIMIT_SET_ID,
      key: RISK_LIMIT_SET_V1.key,
      version: RISK_LIMIT_SET_V1.version,
      status: "ACTIVE",
      scope: RISK_LIMIT_SET_V1.scope,
      maxRiskPerTradePct: fixed(RISK_LIMIT_SET_V1.maxRiskPerTradePct),
      maxDailyLossPct: fixed(RISK_LIMIT_SET_V1.maxDailyLossPct),
      minRewardRisk: fixed(RISK_LIMIT_SET_V1.minRewardRisk),
      maxOpenPositions: RISK_LIMIT_SET_V1.maxOpenPositions,
      maxNewTradesPerDay: RISK_LIMIT_SET_V1.maxNewTradesPerDay,
      maxConsecutiveLosses: RISK_LIMIT_SET_V1.maxConsecutiveLosses,
      maxGrossExposurePct: fixed(RISK_LIMIT_SET_V1.maxGrossExposurePct),
      maxAssetExposurePct: fixed(RISK_LIMIT_SET_V1.maxAssetExposurePct),
      maxCorrelatedExposurePct: fixed(RISK_LIMIT_SET_V1.maxCorrelatedExposurePct),
      maxSpreadBps: RISK_LIMIT_SET_V1.maxSpreadBps,
      maxSlippageBps: RISK_LIMIT_SET_V1.maxSlippageBps,
      specificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH
    },
    freshness: {
      candleAgeMs: { "1h": candleAge("1h"), "4h": candleAge("4h"), "1d": candleAge("1d") },
      dataQualityAgeMs: asOfMs - input.pipelineMs,
      regimeAgeMs: regime === null ? null : asOfMs - Date.parse(regime.generatedAt),
      portfolioSnapshotAgeMs: 0,
      hasFutureTimestamp: false
    },
    dataQuality: {
      minimumClosedCandles: { "1h": q1h.candleCount, "4h": q4h.candleCount, "1d": q1d.candleCount },
      gapCount: { "1h": q1h.gapCount, "4h": q4h.gapCount, "1d": q1d.gapCount },
      providerErrorCount: { "1h": 0, "4h": 0, "1d": 0 },
      ohlcContradiction: false
    },
    marketRegime:
      regime === null
        ? null
        : {
            id: `regime-${Date.parse(regime.generatedAt)}`,
            generatedAt: regime.generatedAt,
            cryptoRegime: regime.cryptoRegime,
            riskMode: regime.riskMode,
            confidence: regime.confidence
          },
    correlationGroup: { key: CRYPTO_MAJOR_GROUP_KEY, memberSymbols: [...CRYPTO_MAJOR_MEMBERS] },
    sizeOverride: { manualQuantity: null, riskMultiplier: null, requestedBy: null },
    previousApproval: input.previousApproval,
    existingAssessment: null,
    policyVersions: {
      riskEngineVersion: RISK_ENGINE_VERSION,
      ruleSetVersion: RISK_RULE_SET_VERSION,
      sizingPolicyVersion: RISK_SIZING_POLICY_VERSION,
      costPolicyVersion: RISK_COST_POLICY_VERSION,
      inputAssemblerVersion: `${SHADOW_REPLAY_ENGINE_VERSION}#risk-input`,
      codeVersion: input.config.codeVersion
    }
  };
}

function variantEvaluator(config: ReplayConfig): (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1 {
  const key = config.variant ?? "BASELINE";
  const variant = STRATEGY_VARIANTS[key];
  if (variant === undefined) throw new Error(`Unknown strategy variant ${key}.`);
  if (key === "BASELINE") return evaluateStrategy;
  const identity =
    config.strategyKey === LONG_V1_BREAKOUT_IDENTITY.key
      ? LONG_V1_BREAKOUT_IDENTITY
      : config.strategyKey === LEGACY_BREAKOUT_IDENTITY.key
        ? LEGACY_BREAKOUT_IDENTITY
        : null;
  if (identity === null) throw new Error(`Variants exist only for the long breakout strategy, not ${config.strategyKey}.`);
  // A research variant is evaluated under the replay's regime model — that is
  // the research question. BASELINE above runs the registered strategy
  // exactly as specified, so it refuses a model it is not specified against.
  const research = {
    ...identity,
    research: variant.overrides,
    regimeSource: config.regimePolicy === "CRYPTO_NATIVE_V1" ? CRYPTO_NATIVE_REGIME_SOURCE : undefined
  };
  return (snapshot) => evaluateCryptoMtfBreakoutV1(snapshot, research);
}
