/**
 * Building blocks shared by the single-strategy replay (`runShadowReplay`)
 * and the multi-strategy portfolio replay (`runPortfolioReplay`).
 *
 * The portfolio book holds exactly the state one shadow portfolio carries in
 * production — ledger, cash and reservations, entry orders, open and closed
 * positions, high-water mark, start-of-day snapshot, kill switch — and runs
 * the hourly steps on it with the unchanged production engines. The code was
 * moved here from `replay.ts` without changing a step for a single symbol;
 * `test/replay-regression.test.ts` pins that. A book may hold several symbols
 * (one execution profile each); every step then works per symbol.
 */

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
  type RiskEvaluationResultV1,
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
import { DecimalValue, RoundingMode, buildSpecificationHash } from "@signalpilot/trading-domain";
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
  ReplayFunnel,
  ReplayMarketData,
  ReplayMode,
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
import { STRATEGY_VARIANTS } from "./variants.js";

export const SHADOW_REPLAY_ENGINE_VERSION = "shadow-replay-v1/1.3.0";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const MIN_HISTORY = 200;
export const PORTFOLIO_ID = "replay-portfolio";
const STRATEGY_ID = "replay-strategy";
export const STRATEGY_VERSION_ID = "replay-strategy-version";
const ASSIGNMENT_ID = "replay-assignment";
const SESSION_ID = "replay-session";
const RISK_LIMIT_SET_ID = "replay-risk-limit-set";

export const iso = (ms: number): string => new Date(ms).toISOString();
export const dec = (value: string | number): DecimalValue => DecimalValue.fromString(typeof value === "number" ? value.toFixed(12) : value);
export const fixed = (value: string): string => DecimalValue.fromString(value).toString();
export const add = (a: string, b: string): string => dec(a).add(dec(b)).toString();
export const sub = (a: string, b: string): string => dec(a).sub(dec(b)).toString();
export const utcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

export interface PreparedSeries {
  readonly source: ReplaySeries;
  readonly candles: Record<ReplayTimeframe, readonly ReplayCandle[]>;
  readonly snapshotCandles: Record<ReplayTimeframe, readonly SnapshotCandleV1[]>;
  readonly gapEnds: Record<ReplayTimeframe, readonly number[]>;
}

export interface OpenOrder {
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

export interface OpenPosition {
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

export interface ClosedPosition {
  readonly trade: ReplayTrade;
  readonly closedAtMs: number;
  readonly netPnl: string;
}

export interface ReplayProfile {
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

export interface HourlyEquityPoint {
  readonly at: number;
  readonly equity: string;
  readonly close: number;
  readonly exposed: boolean;
}

/** The replay's funnel while it is being counted (same shape as `ReplayFunnel`). */
export interface MutableFunnel {
  cycles: number;
  invalidInput: number;
  noCandidate: number;
  candidates: number;
  riskApproved: number;
  riskRejected: number;
  skippedOpenExposure: number;
  ordersExpired: number;
  entriesFilled: number;
  strategyReasons: Record<string, number>;
  failedStrategyChecks: Record<string, number>;
  riskReasons: Record<string, number>;
  failedRiskRules: Record<string, number>;
}

export function newFunnel(): MutableFunnel {
  return {
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
}

export const bump = (bucket: Record<string, number>, key: string) => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

export interface RegimeGate {
  (regime: { readonly cryptoRegime: string; readonly riskMode: string; readonly confidence: number }): boolean;
}

/** Sizing and reservation the risk step approved for one candidate. */
export interface EntryApproval {
  readonly approvedQuantity: string;
  readonly reservedQuoteAmount: string;
  readonly riskAmount: string;
}

export interface RiskStepResult extends EntryApproval {
  readonly risk: RiskEvaluationResultV1;
  readonly snapshot: RiskInputSnapshotV1;
}

// ───────────────────────────────────────────────────────────────────────────
// Portfolio book
// ───────────────────────────────────────────────────────────────────────────

export interface PortfolioBookOptions {
  /** Canonical decimal string (`fixed`). */
  readonly startingCash: string;
  readonly mode: ReplayMode;
  readonly splitMs: number | null;
  readonly killSwitchReviewMs: number;
  /** Time of the INITIAL_CASH ledger entry. */
  readonly fundedAtMs: number;
  /** One execution profile per tradable symbol of this book. */
  readonly profiles: ReadonlyMap<string, ReplayProfile>;
  /** Like the live monitor: only a strategy that declares the policy exits on a shut regime gate. */
  readonly exitOnRegimeGate: boolean;
  readonly exitGateOpen: RegimeGate;
}

export type PortfolioBook = ReturnType<typeof createPortfolioBook>;

export function createPortfolioBook(options: PortfolioBookOptions) {
  const startingCash = options.startingCash;
  const profileOf = (symbol: string): ReplayProfile => {
    const profile = options.profiles.get(symbol);
    if (profile === undefined) throw new Error(`No execution profile for ${symbol} in this portfolio.`);
    return profile;
  };
  const simProfiles = new Map<string, ExecutionProfileSnapshotV1>(
    [...options.profiles.entries()].map(([symbol, profile]) => [
      symbol,
      {
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
      }
    ])
  );
  const simProfileOf = (symbol: string): ExecutionProfileSnapshotV1 => simProfiles.get(symbol)!;

  // ── Portfolio state ──────────────────────────────────────────────────────
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
  const killSwitchReviewMs = options.killSwitchReviewMs;
  let killSwitchEngagedAtMs: number | null = null;
  let lastKillSwitchReleaseMs: number | null = null;
  let killSwitchEngagements = 0;
  let equity = startingCash;
  let invariantViolations = 0;
  let marks: PositionMarkResultV1[] = [];
  const notes: string[] = [];
  const funnel = newFunnel();
  const hourlyEquity: HourlyEquityPoint[] = [];
  const dailyEquity: ReplayEquityPoint[] = [];

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
    occurredAt: iso(options.fundedAtMs)
  });

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

  /** Step 1: entry orders of `symbol` try to fill on this candle. Returns whether the ledger changed. */
  function fillOrders(symbol: string, anchor: ReplayCandle, anchorSnapshot: SnapshotCandleV1): boolean {
    let ledgerChanged = false;
    const profile = profileOf(symbol);
    const simProfile = simProfileOf(symbol);
    for (const order of orders) {
      if (order.candidate.symbol !== symbol) continue;
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
      if (options.mode === "SPEC") {
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
    return ledgerChanged;
  }

  /** Step 2: open positions of `symbol` are monitored on this candle. Returns whether the ledger changed. */
  function monitorPositions(
    symbol: string,
    anchor: ReplayCandle,
    anchorSnapshot: SnapshotCandleV1,
    regimeReport: MarketRegimeReport | null
  ): boolean {
    let ledgerChanged = false;
    const profile = profileOf(symbol);
    const simProfile = simProfileOf(symbol);
    for (const position of positions) {
      if (position.candidate.symbol !== symbol) continue;
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
        } else if (options.exitOnRegimeGate && (regimeReport === null || !options.exitGateOpen(regimeReport))) {
          // The report known at this candle's close: derived at an earlier
          // pipeline time (step 4 runs after monitoring), never a later one.
          exit = { trigger: "INVALIDATION", referencePrice: anchorSnapshot.close };
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
        closed.push(closeTrade(position, exit.trigger, anchor.closeTime, options.splitMs, profile));
      }
    }
    positions = positions.filter((position) => dec(position.state.openQuantity).isPositive());
    return ledgerChanged;
  }

  /**
   * Step 3: valuation at the candle close (conservative mark), high-water mark,
   * start-of-day snapshot and, when the ledger changed or every 24th cycle, the
   * portfolio invariant check.
   */
  function valuate(input: {
    readonly closeMs: number;
    /** Latest close of every symbol this book holds. */
    readonly closeOf: (symbol: string) => string;
    /** Close recorded with the hourly equity point (buy-and-hold benchmark). */
    readonly benchmarkClose: number;
    readonly asOfMs: number;
    readonly cycleIndex: number;
    readonly ledgerChanged: boolean;
  }): void {
    marks = markPositions(positions, input.closeOf, profileOf);
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
    hourlyEquity.push({ at: input.closeMs, equity, close: input.benchmarkClose, exposed: positions.length > 0 });

    const day = utcDay(input.asOfMs);
    if (startOfDay === null || startOfDay.day !== day) {
      startOfDay = { day, asOfMs: day + 5 * 60 * 1000, equity, sequence: state.ledgerSequence };
      dailyEquity.push({ at: iso(input.asOfMs), equity });
    }

    if (input.ledgerChanged || input.cycleIndex % 24 === 0) {
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
        if (notes.length < 10) notes.push(`Invarianten verletzt bei ${iso(input.closeMs)}: ${report.violations.join(", ")}`);
      }
    }
  }

  /** The assumed operator review releases an engaged kill switch after the review delay. */
  function releaseKillSwitchIfReviewed(asOfMs: number): void {
    if (killSwitchEngagedAtMs !== null && asOfMs >= killSwitchEngagedAtMs + killSwitchReviewMs) {
      lastKillSwitchReleaseMs = killSwitchEngagedAtMs + killSwitchReviewMs;
      killSwitchEngagedAtMs = null;
    }
  }

  /**
   * Step 5 (`SPEC`): the unchanged risk engine against this book's own state.
   * Returns the approval, or null when the risk engine did not approve.
   * Records the kill-switch directive and the funnel exactly like production.
   */
  function assessRisk(input: {
    readonly config: ReplayConfig;
    readonly candidate: TradeCandidateDraftV1;
    readonly asOfMs: number;
    readonly pipelineMs: number;
    readonly regime: MarketRegimeReport | null;
    readonly traded: PreparedSeries;
  }): RiskStepResult | null {
    const riskSnapshot = buildRiskSnapshot({
      config: input.config,
      candidate: input.candidate,
      asOfMs: input.asOfMs,
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
      profile: profileOf(input.candidate.symbol),
      regime: input.regime,
      traded: input.traded,
      pipelineMs: input.pipelineMs,
      previousApproval,
      killSwitchEngaged: killSwitchEngagedAtMs !== null,
      lastKillSwitchReleaseMs
    });
    const risk = evaluateRisk(riskSnapshot);
    if (risk.directive === "ENGAGE_KILL_SWITCH" && killSwitchEngagedAtMs === null) {
      killSwitchEngagedAtMs = input.asOfMs;
      killSwitchEngagements += 1;
    }
    for (const rule of risk.ruleResults) {
      if (rule.outcome === "FAIL" || rule.outcome === "ERROR") bump(funnel.failedRiskRules, `${rule.ruleCode}:${rule.reasonCode}`);
    }
    if (risk.outcome !== "APPROVED") {
      funnel.riskRejected += 1;
      bump(funnel.riskReasons, risk.primaryReasonCode);
      return null;
    }
    funnel.riskApproved += 1;
    return {
      risk,
      snapshot: riskSnapshot,
      approvedQuantity: risk.assessment.approvedQuantity,
      reservedQuoteAmount: risk.assessment.sizing.reservedQuoteAmount,
      riskAmount: risk.assessment.riskAmount
    };
  }

  /** Records an approval as the one R-024 compares the next sizing against. */
  function commitApproval(asOfMs: number, riskAmount: string): void {
    previousApproval = { assessedAt: iso(asOfMs), equity, riskAmount };
  }

  /** Step 5 (`SIGNAL_EDGE` research mode): production sizing without the risk rules, one position at a time. */
  function sizeWithoutRiskRules(candidate: TradeCandidateDraftV1): EntryApproval | null {
    const exposure = positions.length > 0 || orders.length > 0;
    if (exposure) {
      funnel.skippedOpenExposure += 1;
      return null;
    }
    const profile = profileOf(candidate.symbol);
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
      return null;
    }
    funnel.riskApproved += 1;
    return { approvedQuantity: sizing.approvedQuantity, reservedQuoteAmount: sizing.reservedQuoteAmount, riskAmount: sizing.riskAmount };
  }

  /** Reserves the approved amount and opens the entry order. Returns false when the reservation failed. */
  function placeOrder(input: {
    readonly candidate: TradeCandidateDraftV1;
    readonly approval: EntryApproval;
    readonly anchorCloseMs: number;
    readonly asOfMs: number;
    readonly regime: MarketRegimeReport | null;
  }): boolean {
    const orderId = nextId("ord");
    const reserve = computeReserveEntry({
      state,
      entryKey: `${orderId}|RESERVE`,
      reservedQuoteAmount: input.approval.reservedQuoteAmount,
      shadowOrderId: orderId,
      occurredAt: iso(input.asOfMs)
    });
    if (!reserve.ok || reserve.nextState === null) {
      funnel.riskRejected += 1;
      bump(funnel.riskReasons, reserve.reasonCode);
      return false;
    }
    knownOrderIds.add(orderId);
    pushLedger(reserve.entries, reserve.nextState, `reserve ${orderId}`);
    orders.push({
      id: orderId,
      candidate: input.candidate,
      anchorMs: input.anchorCloseMs,
      earliestFillAtMs: Date.parse(input.candidate.earliestFillAt),
      plannedRiskAmount: input.approval.riskAmount,
      regime: input.regime?.cryptoRegime ?? null,
      remainingQuantity: input.approval.approvedQuantity,
      reserved: input.approval.reservedQuoteAmount,
      candlesSeen: 0,
      positionId: null
    });
    return true;
  }

  return {
    fillOrders,
    monitorPositions,
    valuate,
    releaseKillSwitchIfReviewed,
    assessRisk,
    commitApproval,
    sizeWithoutRiskRules,
    placeOrder,
    funnel,
    notes,
    hourlyEquity,
    dailyEquity,
    get state(): PortfolioStateV1 {
      return state;
    },
    get equity(): string {
      return equity;
    },
    get startOfDayEquity(): string | null {
      return startOfDay?.equity ?? null;
    },
    get openPositions(): readonly OpenPosition[] {
      return positions;
    },
    /** Marks of the open positions from the latest valuation, in `openPositions` order. */
    get marks(): readonly PositionMarkResultV1[] {
      return marks;
    },
    get openOrders(): readonly OpenOrder[] {
      return orders;
    },
    get closedTrades(): readonly ReplayTrade[] {
      return closed.map((entry) => entry.trade);
    },
    get invariantViolations(): number {
      return invariantViolations;
    },
    get killSwitchEngagements(): number {
      return killSwitchEngagements;
    },
    get killSwitchEngaged(): boolean {
      return killSwitchEngagedAtMs !== null;
    }
  };
}

/** Freezes a counted funnel into the result shape. */
export const toReplayFunnel = (funnel: MutableFunnel): ReplayFunnel => funnel;

// ───────────────────────────────────────────────────────────────────────────
// Research inputs (regime and signals), shared by every strategy of a replay
// ───────────────────────────────────────────────────────────────────────────

/** The regime report of the replay's policy, derived once per UTC day of the pipeline time. */
export function createRegimeTracker(market: ReplayMarketData, policy: ReplayConfig["regimePolicy"]) {
  let regimeDay = -1;
  let regimeReport: MarketRegimeReport | null = null;
  let regimeVersion = 0;
  return {
    /** The report known before this cycle's research step (used by the position monitor). */
    get report(): MarketRegimeReport | null {
      return regimeReport;
    },
    get version(): number {
      return regimeVersion;
    },
    update(pipelineMs: number): MarketRegimeReport | null {
      const regimeKey = utcDay(pipelineMs);
      if (regimeKey !== regimeDay) {
        regimeDay = regimeKey;
        regimeReport = deriveRegime(market.series, pipelineMs, policy);
        regimeVersion += 1;
      }
      return regimeReport === null ? null : { ...regimeReport, generatedAt: iso(pipelineMs) };
    }
  };
}

/** Point-in-time signals of one symbol, with the replay's cache. */
export function createSignalTracker(symbol: string) {
  const signalCache = new Map<string, Omit<DerivedSignal, "createdAtMs">>();
  let previousSignals: Partial<Record<ReplayTimeframe, DerivedSignal>> = {};
  return {
    derive(traded: PreparedSeries, pipelineMs: number, currentRegime: MarketRegimeReport | null, regimeVersion: number) {
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
            .map((signal) => toMultiTimeframeInput(symbol, signal));
          const derived = deriveSignal({
            symbol,
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
      return signals;
    }
  };
}

/** Counts a strategy evaluation into the funnel; returns the candidate, or null with the blockers of a miss. */
export function countEvaluation(
  funnel: MutableFunnel,
  evaluation: StrategyEvaluationResultV1
): { readonly candidate: TradeCandidateDraftV1 } | { readonly candidate: null; readonly nearMissBlocker: string | null } {
  for (const check of evaluation.checks) {
    if (!check.passed) bump(funnel.failedStrategyChecks, check.reasonCode);
  }
  if (evaluation.outcome === "INVALID_INPUT") {
    funnel.invalidInput += 1;
    bump(funnel.strategyReasons, evaluation.primaryReasonCode);
    return { candidate: null, nearMissBlocker: null };
  }
  if (evaluation.outcome === "NO_CANDIDATE") {
    funnel.noCandidate += 1;
    bump(funnel.strategyReasons, evaluation.primaryReasonCode);
    const blockers = evaluation.checks.filter((check) => !check.passed && check.stage !== "PRE_VALIDATION");
    return { candidate: null, nearMissBlocker: blockers.length === 1 ? blockers[0].reasonCode : null };
  }
  funnel.candidates += 1;
  return { candidate: evaluation.candidate };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

export function prepareSeries(series: ReplaySeries): PreparedSeries {
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

export function hasHistory(series: PreparedSeries, atMs: number): boolean {
  return (["1h", "4h", "1d"] as const).every(
    (timeframe) => lastClosedIndex(series.candles[timeframe], atMs) + 1 >= MIN_HISTORY
  );
}

export function toSimCandle(candle: SnapshotCandleV1): CandleSnapshotV1 {
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

export function buildProfile(config: Pick<ReplayConfig, "symbol" | "executionProfile">): ReplayProfile {
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

function markPositions(
  positions: readonly OpenPosition[],
  closeOf: (symbol: string) => string,
  profileOf: (symbol: string) => ReplayProfile
): PositionMarkResultV1[] {
  return positions.map((position) => {
    const profile = profileOf(position.candidate.symbol);
    const markPrice = computeConservativeMark("LONG", closeOf(position.candidate.symbol), profile.fullSpreadBps, profile.tickSize);
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

// ───────────────────────────────────────────────────────────────────────────
// Snapshot builders — same shape and formatting as the trading worker's
// assemblers (`strategyInputAssembler.ts`, `riskInputAssembler.ts`).
// ───────────────────────────────────────────────────────────────────────────

export function buildStrategySnapshot(input: {
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

export function variantEvaluator(config: ReplayConfig): (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1 {
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
