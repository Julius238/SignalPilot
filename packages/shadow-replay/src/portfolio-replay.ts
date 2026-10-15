/**
 * Chronological multi-strategy portfolio replay (`portfolio-replay-v1`).
 *
 * Several strategy portfolios — each with its own ledger, cash, orders,
 * positions, start-of-day snapshot and kill switch, holding BTC and ETH — run
 * hour by hour on one shared timeline with the same production engines as the
 * single-strategy replay (`replay-core.ts`). Nothing is added up afterwards:
 * every entry is decided at its hour against the state of that hour.
 *
 * Per anchor hour, in a fixed order:
 *   1. entry orders of every portfolio and symbol try to fill;
 *   2. open positions are monitored (stop first, target, time, and the regime
 *      exit only for strategies that specify it);
 *   3. every portfolio is valued at the candle close; the group (all
 *      portfolios plus the unallocated reserve) is valued and, on a new UTC
 *      day, gets its start-of-day snapshot; kill switches whose review delay
 *      passed are released;
 *   4. the regime and the signals are derived once per symbol;
 *   5. portfolio by portfolio (in configuration order) and symbol by symbol:
 *      strategy evaluation → stage 1, the unchanged `evaluateRisk` on the own
 *      portfolio → stage 2, the cross-portfolio rules (`group-risk.ts`) →
 *      reservation. A reservation counts towards the group view at once.
 *
 * Specification: docs/trading/research/2026-10-15-evolution-gates-v4-draft.md
 * (sections 3 and 4). Pure: no database, network, clock or `process.env`.
 */

import { REGIME_EXIT_POLICY, getStrategy, regimeGateOpen, type StrategyEvaluationResultV1, type StrategyInputSnapshotV1 } from "@signalpilot/strategy-engine";
import { canonicalHash } from "@signalpilot/trading-domain";

import type {
  RegimePolicy,
  ReplayConfig,
  ReplayEquityPoint,
  ReplayExecutionProfile,
  ReplayFunnel,
  ReplayMarketData,
  ReplayTrade
} from "./contracts.js";
import { GROUP_RISK_VERSION, evaluateGroupRisk, type GroupPosition, type GroupReservation, type GroupRiskInput, type GroupRiskResult } from "./group-risk.js";
import {
  HOUR_MS,
  SHADOW_REPLAY_ENGINE_VERSION,
  add,
  buildProfile,
  buildStrategySnapshot,
  bump,
  countEvaluation,
  createPortfolioBook,
  createRegimeTracker,
  createSignalTracker,
  dec,
  fixed,
  hasHistory,
  iso,
  prepareSeries,
  sub,
  utcDay,
  variantEvaluator,
  type PortfolioBook,
  type PreparedSeries,
  type ReplayProfile,
  type RiskStepResult
} from "./replay-core.js";
import type { ReplayHooks } from "./replay.js";

export const PORTFOLIO_REPLAY_ENGINE_VERSION = "portfolio-replay-v1/1.0.0";

export interface PortfolioMemberSymbol {
  readonly symbol: string;
  readonly executionProfile: ReplayExecutionProfile;
}

export interface PortfolioMemberConfig {
  /**
   * Attribution key of this strategy portfolio. Every trade of the portfolio
   * belongs to this key, whatever strategy key the replay runs under.
   */
  readonly key: string;
  /**
   * Registered strategy the replay runs under. A non-registered research
   * family runs under a registered key as replay hull; it is recorded but
   * never decides the attribution.
   */
  readonly strategyKey: string;
  /** Research identity of a non-registered strategy family, if any. */
  readonly researchIdentity?: string;
  readonly startingCash: string;
  /** Symbols this portfolio trades, in processing order. */
  readonly symbols: readonly PortfolioMemberSymbol[];
  readonly variant?: string;
  readonly hooks?: Pick<ReplayHooks, "evaluate" | "regimeExit">;
}

/** `GROUP_RISK_V1`: stage 2 with the cross-portfolio rules; `NONE`: independent portfolios only (stage 1). */
export type GroupRiskPolicy = "GROUP_RISK_V1" | "NONE";

export interface PortfolioReplayConfig {
  /** Strategy portfolios in decision order (existing strategies first, a candidate last). */
  readonly members: readonly PortfolioMemberConfig[];
  /** Unallocated cash of the comparison frame: part of the total capital, never traded. */
  readonly reserveCash: string;
  readonly regimePolicy: RegimePolicy;
  readonly groupRisk: GroupRiskPolicy;
  readonly codeVersion: string;
  readonly from?: string;
  readonly to?: string;
  readonly scanDelayMinutes?: number;
  readonly killSwitchReviewHours?: number;
  /** Keep the per-candidate decision log in the result (large on real data). */
  readonly recordDecisions?: boolean;
}

export type Stage2Outcome = "PASSED" | "REJECTED" | "GROUP_KILL_SWITCH" | "NOT_RUN";

export interface PortfolioDecision {
  readonly at: string;
  readonly memberKey: string;
  readonly symbol: string;
  readonly candidateKey: string;
  readonly stage1: "APPROVED" | "REJECTED";
  readonly stage1Reason: string | null;
  readonly stage2: Stage2Outcome;
  readonly stage2FailedRules: readonly string[];
  readonly orderPlaced: boolean;
  readonly approvedQuantity: string | null;
}

export interface PortfolioDecisionDetail {
  readonly decision: PortfolioDecision;
  readonly stage1: RiskStepResult | null;
  readonly stage2Input: GroupRiskInput | null;
  readonly stage2: GroupRiskResult | null;
}

export interface PortfolioReplayHooks {
  /**
   * Replaces stage 2 (tests and diagnostics). It still runs only after a
   * stage-1 approval and can only reject; it can never admit a trade the
   * risk engine refused.
   */
  readonly groupCheck?: (input: GroupRiskInput) => GroupRiskResult;
  /** Diagnostics: every candidate decision with both stages. */
  readonly onDecision?: (detail: PortfolioDecisionDetail) => void;
}

export interface PortfolioMemberResult {
  readonly key: string;
  readonly strategyKey: string;
  readonly researchIdentity: string | null;
  readonly symbols: readonly string[];
  readonly startingCash: string;
  readonly finalEquity: string;
  readonly funnel: ReplayFunnel;
  /** Stage-1 approvals stage 2 rejected. */
  readonly groupRejected: number;
  readonly groupRejections: Readonly<Record<string, number>>;
  readonly invariantViolations: number;
  readonly killSwitchEngagements: number;
  readonly trades: readonly ReplayTrade[];
  /** Equity at the first valuation of every UTC day (same convention as `ReplayResult.equityCurve`). */
  readonly equityCurve: readonly ReplayEquityPoint[];
  /** Same formula as the single-strategy replay's output hash. */
  readonly outputHash: string;
}

export interface PortfolioGroupSummary {
  /** Sum of the portfolios' starting cash plus the reserve. */
  readonly totalCapital: string;
  readonly finalEquity: string;
  readonly netReturnPct: string | null;
  /** Mark-to-market drawdown on the hourly group equity. */
  readonly maxDrawdownPct: string | null;
  /** Concurrent risk: planned risk of every open position ÷ group equity, hourly. */
  readonly averageOpenRiskPct: string | null;
  readonly peakOpenRiskPct: string | null;
  /** Capital tie-up: market value of every open position ÷ group equity, hourly. */
  readonly averageCapitalBoundPct: string | null;
  readonly peakCapitalBoundPct: string | null;
  readonly hours: number;
  readonly hoursWithOpenPositions: number;
  readonly stage2Rejections: Readonly<Record<string, number>>;
  readonly groupKillSwitchEngagements: number;
}

export interface PortfolioReplayResult {
  readonly engineVersion: string;
  readonly groupRiskVersion: string | null;
  readonly config: PortfolioReplayConfig;
  readonly origin: string;
  readonly synthetic: boolean;
  readonly firstAnchorAt: string | null;
  readonly lastAnchorAt: string | null;
  readonly members: readonly PortfolioMemberResult[];
  readonly group: PortfolioGroupSummary;
  /** Group equity at the first valuation of every UTC day. */
  readonly equityCurve: readonly ReplayEquityPoint[];
  readonly decisions: readonly PortfolioDecision[] | null;
  readonly outputHash: string;
  readonly notes: readonly string[];
}

interface MemberRuntime {
  readonly config: PortfolioMemberConfig;
  readonly definition: NonNullable<ReturnType<typeof getStrategy>>;
  readonly book: PortfolioBook;
  readonly profiles: ReadonlyMap<string, ReplayProfile>;
  readonly configs: ReadonlyMap<string, ReplayConfig>;
  readonly evaluate: (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1;
  readonly groupRejections: Record<string, number>;
  groupRejected: number;
}

function validate(market: ReplayMarketData, config: PortfolioReplayConfig): void {
  if (config.members.length === 0) throw new Error("A portfolio replay needs at least one strategy portfolio.");
  const keys = new Set<string>();
  for (const member of config.members) {
    if (keys.has(member.key)) throw new Error(`Duplicate portfolio key ${member.key}.`);
    keys.add(member.key);
    if (getStrategy(member.strategyKey) === null) throw new Error(`Unknown strategy ${member.strategyKey} (portfolio ${member.key}).`);
    if (!dec(member.startingCash).isPositive()) throw new Error(`Portfolio ${member.key} needs positive starting cash.`);
    if (member.symbols.length === 0) throw new Error(`Portfolio ${member.key} trades no symbol.`);
    const symbols = new Set<string>();
    for (const entry of member.symbols) {
      if (symbols.has(entry.symbol)) throw new Error(`Portfolio ${member.key} lists ${entry.symbol} twice.`);
      symbols.add(entry.symbol);
      if (!market.series.some((series) => series.symbol === entry.symbol)) throw new Error(`No candles for ${entry.symbol}`);
    }
  }
  if (dec(config.reserveCash).isNegative()) throw new Error("The reserve cannot be negative.");
}

/** Total capital of a comparison frame: every portfolio's starting cash plus the reserve. */
export function portfolioTotalCapital(config: Pick<PortfolioReplayConfig, "members" | "reserveCash">): string {
  return config.members.reduce((total, member) => add(total, fixed(member.startingCash)), fixed(config.reserveCash));
}

export function runPortfolioReplay(market: ReplayMarketData, config: PortfolioReplayConfig, hooks: PortfolioReplayHooks = {}): PortfolioReplayResult {
  validate(market, config);
  const prepared = new Map<string, PreparedSeries>(market.series.map((series) => [series.symbol, prepareSeries(series)] as const));
  const scanDelayMs = (config.scanDelayMinutes ?? 5) * 60 * 1000;
  const killSwitchReviewMs = (config.killSwitchReviewHours ?? 24) * HOUR_MS;
  const fromMs = config.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(config.from);
  const toMs = config.to === undefined ? Number.POSITIVE_INFINITY : Date.parse(config.to);
  const groupCheck = config.groupRisk === "GROUP_RISK_V1" ? (hooks.groupCheck ?? evaluateGroupRisk) : null;
  const reserveCash = fixed(config.reserveCash);

  // ── Shared timeline over every traded symbol ─────────────────────────────
  const symbolsInUse = [...new Set(config.members.flatMap((member) => member.symbols.map((entry) => entry.symbol)))];
  const candleIndex = new Map(
    symbolsInUse.map((symbol) => [symbol, new Map(prepared.get(symbol)!.candles["1h"].map((candle, index) => [candle.closeTime, index] as const))] as const)
  );
  const timeline = [...new Set(symbolsInUse.flatMap((symbol) => prepared.get(symbol)!.candles["1h"].map((candle) => candle.closeTime)))].sort((a, b) => a - b);
  const fundedAtMs = timeline[0] ?? 0;

  // ── Strategy portfolios ──────────────────────────────────────────────────
  const members: MemberRuntime[] = config.members.map((member) => {
    const definition = getStrategy(member.strategyKey)!;
    const profiles = new Map(member.symbols.map((entry) => [entry.symbol, buildProfile(entry)] as const));
    const configs = new Map(
      member.symbols.map((entry) => {
        const replayConfig: ReplayConfig = {
          symbol: entry.symbol,
          strategyKey: member.strategyKey,
          mode: "SPEC",
          regimePolicy: config.regimePolicy,
          startingCash: member.startingCash,
          executionProfile: entry.executionProfile,
          codeVersion: config.codeVersion,
          ...(member.variant === undefined ? {} : { variant: member.variant })
        };
        return [entry.symbol, replayConfig] as const;
      })
    );
    const anyConfig = configs.get(member.symbols[0]!.symbol)!;
    return {
      config: member,
      definition,
      profiles,
      configs,
      evaluate: member.hooks?.evaluate ?? variantEvaluator(anyConfig),
      book: createPortfolioBook({
        startingCash: fixed(member.startingCash),
        mode: "SPEC",
        splitMs: null,
        killSwitchReviewMs,
        fundedAtMs,
        profiles,
        exitOnRegimeGate:
          member.hooks?.regimeExit?.enabled ?? (definition.parameters as { exitPolicy?: unknown }).exitPolicy === REGIME_EXIT_POLICY,
        exitGateOpen: member.hooks?.regimeExit?.gateOpen ?? regimeGateOpen
      }),
      groupRejections: {},
      groupRejected: 0
    };
  });

  // ── Research inputs, shared by every portfolio ───────────────────────────
  const regime = createRegimeTracker(market, config.regimePolicy);
  const signalTrackers = new Map(symbolsInUse.map((symbol) => [symbol, createSignalTracker(symbol)] as const));

  // ── Group state ──────────────────────────────────────────────────────────
  const totalCapital = portfolioTotalCapital(config);
  let groupStartOfDay: { day: number; asOfMs: number; equity: string } | null = null;
  let groupKillSwitchEngagedAtMs: number | null = null;
  let groupKillSwitchEngagements = 0;
  const groupEquityCurve: ReplayEquityPoint[] = [];
  const stage2Rejections: Record<string, number> = {};
  const decisions: PortfolioDecision[] = [];
  const latestClose = new Map<string, string>();
  let lastGroupEquity = totalCapital;
  let hours = 0;
  let hoursWithOpenPositions = 0;
  let openRiskSum = 0;
  let peakOpenRisk = 0;
  let capitalBoundSum = 0;
  let peakCapitalBound = 0;
  let equityPeak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  let firstAnchorMs: number | null = null;
  let lastAnchorMs: number | null = null;

  const groupEquity = (): string => members.reduce((total, member) => add(total, member.book.equity), reserveCash);
  const groupView = (): GroupRiskInput["group"] => {
    const positions: GroupPosition[] = [];
    const reservations: GroupReservation[] = [];
    let availableCash = reserveCash;
    let reservedCash = "0.000000000000";
    for (const member of members) {
      const { book } = member;
      book.openPositions.forEach((position, index) => {
        positions.push({
          assetId: position.candidate.assetId,
          symbol: position.candidate.symbol,
          status: "OPEN",
          openQuantity: position.state.openQuantity,
          marketValue: book.marks[index]?.marketValue ?? "INVALID",
          equityContribution: book.marks[index]?.equityContribution ?? "INVALID",
          reservedCollateral: position.state.reservedCollateral
        });
      });
      for (const order of book.openOrders) {
        if (!dec(order.reserved).isPositive()) continue;
        reservations.push({ assetId: order.candidate.assetId, symbol: order.candidate.symbol, purpose: "ENTRY", reservedQuoteAmount: order.reserved });
      }
      availableCash = add(availableCash, book.state.availableCash);
      reservedCash = add(reservedCash, book.state.reservedCash);
    }
    const equity = groupEquity();
    return {
      equity,
      availableCash,
      reservedCash,
      startOfDay: groupStartOfDay === null ? null : { asOf: iso(groupStartOfDay.asOfMs), equity: groupStartOfDay.equity },
      dailyPnl: groupStartOfDay === null ? "0.000000000000" : sub(equity, groupStartOfDay.equity),
      positions,
      reservations
    };
  };

  for (let cycle = 0; cycle < timeline.length; cycle += 1) {
    const closeMs = timeline[cycle]!;
    const pipelineMs = closeMs + 1;
    const asOfMs = pipelineMs + scanDelayMs;
    if (closeMs < fromMs || closeMs > toMs) continue;
    const active = symbolsInUse.filter((symbol) => candleIndex.get(symbol)!.has(closeMs) && hasHistory(prepared.get(symbol)!, pipelineMs));
    if (active.length === 0) continue;

    firstAnchorMs ??= closeMs;
    lastAnchorMs = closeMs;
    const anchors = new Map(
      active.map((symbol) => {
        const index = candleIndex.get(symbol)!.get(closeMs)!;
        const series = prepared.get(symbol)!;
        return [symbol, { anchor: series.candles["1h"][index]!, snapshot: series.snapshotCandles["1h"][index]! }] as const;
      })
    );
    for (const symbol of active) latestClose.set(symbol, anchors.get(symbol)!.snapshot.close);

    // 1–2. Fills, then position monitoring, portfolio by portfolio.
    const ledgerChanged = members.map((member) => {
      let changed = false;
      const own = member.config.symbols.map((entry) => entry.symbol).filter((symbol) => anchors.has(symbol));
      for (const symbol of own) changed = member.book.fillOrders(symbol, anchors.get(symbol)!.anchor, anchors.get(symbol)!.snapshot) || changed;
      for (const symbol of own) {
        changed = member.book.monitorPositions(symbol, anchors.get(symbol)!.anchor, anchors.get(symbol)!.snapshot, regime.report) || changed;
      }
      return changed;
    });

    // 3. Valuation of every portfolio and of the group.
    members.forEach((member, index) => {
      const benchmark = member.config.symbols.find((entry) => anchors.has(entry.symbol));
      member.book.valuate({
        closeMs,
        closeOf: (symbol) => latestClose.get(symbol)!,
        benchmarkClose: benchmark === undefined ? Number.NaN : Number(anchors.get(benchmark.symbol)!.anchor.close),
        asOfMs,
        cycleIndex: cycle,
        ledgerChanged: ledgerChanged[index]!
      });
      member.book.releaseKillSwitchIfReviewed(asOfMs);
    });
    const equityNow = groupEquity();
    lastGroupEquity = equityNow;
    const day = utcDay(asOfMs);
    if (groupStartOfDay === null || groupStartOfDay.day !== day) {
      groupStartOfDay = { day, asOfMs: day + 5 * 60 * 1000, equity: equityNow };
      groupEquityCurve.push({ at: iso(asOfMs), equity: equityNow });
    }
    if (groupKillSwitchEngagedAtMs !== null && asOfMs >= groupKillSwitchEngagedAtMs + killSwitchReviewMs) groupKillSwitchEngagedAtMs = null;

    const equityValue = Number(equityNow);
    let openRisk = 0;
    let capitalBound = 0;
    let anyOpen = false;
    for (const member of members) {
      member.book.openPositions.forEach((position, index) => {
        anyOpen = true;
        openRisk += Number(position.plannedRiskAmount);
        capitalBound += Number(member.book.marks[index]?.marketValue ?? 0);
      });
    }
    hours += 1;
    if (anyOpen) hoursWithOpenPositions += 1;
    if (equityValue > 0) {
      openRiskSum += openRisk / equityValue;
      capitalBoundSum += capitalBound / equityValue;
      peakOpenRisk = Math.max(peakOpenRisk, openRisk / equityValue);
      peakCapitalBound = Math.max(peakCapitalBound, capitalBound / equityValue);
      equityPeak = Math.max(equityPeak, equityValue);
      maxDrawdown = Math.max(maxDrawdown, (equityPeak - equityValue) / equityPeak);
    }

    // 4. Research inputs, once per symbol.
    const currentRegime = regime.update(pipelineMs);
    const signals = new Map(active.map((symbol) => [symbol, signalTrackers.get(symbol)!.derive(prepared.get(symbol)!, pipelineMs, currentRegime, regime.version)] as const));

    // 5. Decisions, portfolio by portfolio and symbol by symbol.
    for (const member of members) {
      for (const entry of member.config.symbols) {
        const symbol = entry.symbol;
        if (!anchors.has(symbol)) continue;
        const traded = prepared.get(symbol)!;
        const replayConfig = member.configs.get(symbol)!;
        member.book.funnel.cycles += 1;
        const snapshot = buildStrategySnapshot({
          config: replayConfig,
          definition: member.definition,
          traded,
          asOfMs,
          pipelineMs,
          signals: signals.get(symbol)!,
          regime: currentRegime,
          profile: member.profiles.get(symbol)!
        });
        const counted = countEvaluation(member.book.funnel, member.evaluate(snapshot));
        if (counted.candidate === null) continue;
        const candidate = counted.candidate;

        const record = (decision: Omit<PortfolioDecision, "at" | "memberKey" | "symbol" | "candidateKey">, detail: Omit<PortfolioDecisionDetail, "decision">) => {
          const full: PortfolioDecision = { at: iso(closeMs), memberKey: member.config.key, symbol, candidateKey: candidate.candidateKey, ...decision };
          if (config.recordDecisions === true) decisions.push(full);
          hooks.onDecision?.({ decision: full, ...detail });
        };

        // Stage 1: the unchanged risk engine on the own portfolio.
        const assessed = member.book.assessRisk({ config: replayConfig, candidate, asOfMs, pipelineMs, regime: currentRegime, traded });
        if (assessed === null) {
          record(
            { stage1: "REJECTED", stage1Reason: null, stage2: "NOT_RUN", stage2FailedRules: [], orderPlaced: false, approvedQuantity: null },
            { stage1: null, stage2Input: null, stage2: null }
          );
          continue;
        }

        // Stage 2: the cross-portfolio limits; only after an approval, only rejecting.
        let stage2Input: GroupRiskInput | null = null;
        let stage2: GroupRiskResult | null = null;
        if (groupCheck !== null) {
          if (groupKillSwitchEngagedAtMs !== null) {
            member.groupRejected += 1;
            bump(member.groupRejections, "GROUP_KILL_SWITCH");
            bump(stage2Rejections, "GROUP_KILL_SWITCH");
            record(
              { stage1: "APPROVED", stage1Reason: null, stage2: "GROUP_KILL_SWITCH", stage2FailedRules: ["GROUP_KILL_SWITCH"], orderPlaced: false, approvedQuantity: assessed.approvedQuantity },
              { stage1: assessed, stage2Input: null, stage2: null }
            );
            continue;
          }
          stage2Input = {
            asOfMs,
            snapshot: assessed.snapshot,
            sizing: assessed.risk.assessment.sizing,
            ownPortfolioHoldsAsset: member.book.openPositions.some((position) => position.candidate.assetId === candidate.assetId),
            group: groupView()
          };
          stage2 = groupCheck(stage2Input);
          if (stage2.directive === "ENGAGE_KILL_SWITCH" && groupKillSwitchEngagedAtMs === null) {
            groupKillSwitchEngagedAtMs = asOfMs;
            groupKillSwitchEngagements += 1;
          }
          if (!stage2.passed) {
            member.groupRejected += 1;
            for (const rule of stage2.failedRules) {
              bump(member.groupRejections, rule);
              bump(stage2Rejections, rule);
            }
            record(
              { stage1: "APPROVED", stage1Reason: null, stage2: "REJECTED", stage2FailedRules: stage2.failedRules, orderPlaced: false, approvedQuantity: assessed.approvedQuantity },
              { stage1: assessed, stage2Input, stage2 }
            );
            continue;
          }
        }

        member.book.commitApproval(asOfMs, assessed.riskAmount);
        const placed = member.book.placeOrder({ candidate, approval: assessed, anchorCloseMs: closeMs, asOfMs, regime: currentRegime });
        record(
          {
            stage1: "APPROVED",
            stage1Reason: null,
            stage2: groupCheck === null ? "NOT_RUN" : "PASSED",
            stage2FailedRules: [],
            orderPlaced: placed,
            approvedQuantity: assessed.approvedQuantity
          },
          { stage1: assessed, stage2Input, stage2 }
        );
      }
    }
  }

  // ── Results ──────────────────────────────────────────────────────────────
  const memberResults: PortfolioMemberResult[] = members.map((member) => {
    const trades = member.book.closedTrades;
    const funnel: ReplayFunnel = member.book.funnel;
    return {
      key: member.config.key,
      strategyKey: member.config.strategyKey,
      researchIdentity: member.config.researchIdentity ?? null,
      symbols: member.config.symbols.map((entry) => entry.symbol),
      startingCash: fixed(member.config.startingCash),
      finalEquity: member.book.equity,
      funnel,
      groupRejected: member.groupRejected,
      groupRejections: member.groupRejections,
      invariantViolations: member.book.invariantViolations,
      killSwitchEngagements: member.book.killSwitchEngagements,
      trades,
      equityCurve: member.book.dailyEquity,
      outputHash: canonicalHash({
        engineVersion: SHADOW_REPLAY_ENGINE_VERSION,
        trades,
        funnel,
        finalState: member.book.state,
        finalEquity: member.book.equity,
        invariantViolations: member.book.invariantViolations
      })
    };
  });

  const pct = (value: number) => (value * 100).toFixed(4);
  const group: PortfolioGroupSummary = {
    totalCapital,
    finalEquity: lastGroupEquity,
    netReturnPct: dec(totalCapital).isPositive() ? pct(Number(lastGroupEquity) / Number(totalCapital) - 1) : null,
    maxDrawdownPct: hours === 0 ? null : pct(maxDrawdown),
    averageOpenRiskPct: hours === 0 ? null : pct(openRiskSum / hours),
    peakOpenRiskPct: hours === 0 ? null : pct(peakOpenRisk),
    averageCapitalBoundPct: hours === 0 ? null : pct(capitalBoundSum / hours),
    peakCapitalBoundPct: hours === 0 ? null : pct(peakCapitalBound),
    hours,
    hoursWithOpenPositions,
    stage2Rejections,
    groupKillSwitchEngagements
  };

  const notes: string[] = [];
  if (market.synthetic) notes.push("SYNTHETISCHE TESTDATEN — keine Aussage über reale Strategieperformance.");
  notes.push(
    groupCheck === null
      ? "Gruppenprüfung aus: unabhängige Strategie-Portfolios, jede Entscheidung nur von der Risk Engine des eigenen Portfolios."
      : `Gruppenprüfung ${GROUP_RISK_VERSION}: nach jeder Risk-Engine-Freigabe zusätzlich R-010, R-013, R-014 (Exposure) und R-015 über alle Portfolios; sie kann nur ablehnen.`
  );
  for (const member of memberResults) {
    if (member.killSwitchEngagements > 0) {
      notes.push(`${member.key}: Kill-Switch ${member.killSwitchEngagements}× ausgelöst; Replay-Annahme: Operator-Freigabe nach ${config.killSwitchReviewHours ?? 24} h.`);
    }
    if (member.invariantViolations > 0) notes.push(`${member.key}: ${member.invariantViolations} Invariantenverletzungen.`);
  }
  if (groupKillSwitchEngagements > 0) {
    notes.push(`Gruppen-Kill-Switch (R-010 über alle Portfolios) ${groupKillSwitchEngagements}× ausgelöst; Freigabe nach ${config.killSwitchReviewHours ?? 24} h.`);
  }

  const outputHash = canonicalHash({
    engineVersion: PORTFOLIO_REPLAY_ENGINE_VERSION,
    groupRiskVersion: groupCheck === null ? null : GROUP_RISK_VERSION,
    members: memberResults.map((member) => ({
      key: member.key,
      outputHash: member.outputHash,
      groupRejected: member.groupRejected,
      groupRejections: member.groupRejections
    })),
    group,
    equityCurve: groupEquityCurve
  });

  return {
    engineVersion: PORTFOLIO_REPLAY_ENGINE_VERSION,
    groupRiskVersion: groupCheck === null ? null : GROUP_RISK_VERSION,
    config,
    origin: market.origin,
    synthetic: market.synthetic,
    firstAnchorAt: firstAnchorMs === null ? null : iso(firstAnchorMs),
    lastAnchorAt: lastAnchorMs === null ? null : iso(lastAnchorMs),
    members: memberResults,
    group,
    equityCurve: groupEquityCurve,
    decisions: config.recordDecisions === true ? decisions : null,
    outputHash,
    notes
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Comparison frame with fixed capital slots (gates v4, section 3.2)
// ───────────────────────────────────────────────────────────────────────────

/** A strategy portfolio of the comparison frame; its capital is the slot, never chosen per strategy. */
export type PortfolioSlotMember = Omit<PortfolioMemberConfig, "startingCash">;

export interface ComparisonFrame {
  /** Capital of every slot; part of the pre-registered method. */
  readonly slotCash: string;
  /** Existing strategies, in decision order. */
  readonly existing: readonly PortfolioSlotMember[];
  /** The candidate; it takes the reserve slot and decides last. */
  readonly candidate: PortfolioSlotMember;
  readonly shared: Omit<PortfolioReplayConfig, "members" | "reserveCash">;
}

/**
 * Comparison A (existing strategies plus one unallocated reserve slot) and
 * comparison B (the candidate on that slot). Every portfolio gets exactly one
 * equal slot, so both comparisons use the same total capital and no weight
 * can be tuned per strategy.
 */
export function comparisonPortfolios(frame: ComparisonFrame): {
  readonly baseline: PortfolioReplayConfig;
  readonly withCandidate: PortfolioReplayConfig;
  readonly totalCapital: string;
} {
  if (!dec(frame.slotCash).isPositive()) throw new Error("The slot cash must be positive.");
  if (frame.existing.length === 0) throw new Error("A comparison frame needs at least one existing strategy.");
  if (frame.existing.some((member) => member.key === frame.candidate.key)) throw new Error(`The candidate key ${frame.candidate.key} is already taken.`);
  const slot = fixed(frame.slotCash);
  const withSlot = (member: PortfolioSlotMember): PortfolioMemberConfig => ({ ...member, startingCash: slot });
  const baseline: PortfolioReplayConfig = { ...frame.shared, members: frame.existing.map(withSlot), reserveCash: slot };
  const withCandidate: PortfolioReplayConfig = { ...frame.shared, members: [...frame.existing.map(withSlot), withSlot(frame.candidate)], reserveCash: "0" };
  const totalCapital = portfolioTotalCapital(baseline);
  if (portfolioTotalCapital(withCandidate) !== totalCapital) throw new Error("Comparison frames must use the same total capital.");
  return { baseline, withCandidate, totalCapital };
}
