/**
 * Portfolio comparison runs of the Evolution Engine (gates v4).
 *
 * A comparison runs the chronological multi-strategy portfolio replay
 * (`@signalpilot/shadow-replay`, `portfolio-replay-v1`) over the evolution
 * data split with the pre-registered capital frame: every strategy gets one
 * slot of `PORTFOLIO_SLOT_CASH`, comparison A (BASELINE) keeps one slot as an
 * unallocated cash reserve, comparison B (WITH_CANDIDATE) puts the candidate
 * on that slot. Weights are never chosen per strategy. Every strategy
 * portfolio trades BTCUSDT and ETHUSDT under the frozen cost model and the
 * unchanged risk engine; stage 2 (`group-risk-v1`) adds the cross-portfolio
 * limits. Nothing here touches a database, the network or the clock.
 */

import {
  comparisonPortfolios,
  runPortfolioReplay,
  type GroupRiskPolicy,
  type PortfolioMemberConfig,
  type PortfolioReplayConfig,
  type PortfolioReplayResult,
  type ReplayEquityPoint,
  type ReplayMarketData,
  type ReplayTrade
} from "@signalpilot/shadow-replay";

import { evolutionExecutionProfile } from "./costs.js";
import { replayPlanFor, rootByKey, type CandidateGenome } from "./genome.js";
import type { CompactTrade, DailyEquityPoint } from "./metrics.js";
import { EVOLUTION_DATA_SPLIT_V1 } from "./split.js";

/** Capital of every slot of the comparison frame (gates v4, T2). */
export const PORTFOLIO_SLOT_CASH = 20_000;

export type PortfolioSubject = { readonly kind: "ROOT"; readonly rootKey: string } | { readonly kind: "GENOME"; readonly genome: CandidateGenome };

export interface PortfolioMemberSpec {
  /** Attribution key of the strategy portfolio (root key or candidate key). */
  readonly key: string;
  readonly subject: PortfolioSubject;
  /** Research identity of a non-registered family, recorded with the member. */
  readonly researchIdentity?: string;
}

export type PortfolioComparisonKind = "BASELINE" | "WITH_CANDIDATE";

export interface PortfolioRunSpec {
  readonly comparison: PortfolioComparisonKind;
  /** Existing strategies in decision order: the roots, then approved candidates by key. */
  readonly existing: readonly PortfolioMemberSpec[];
  /** Required for WITH_CANDIDATE; comparison A never runs it. */
  readonly candidate?: PortfolioMemberSpec;
  readonly from: string;
  readonly to: string;
  readonly codeVersion: string;
  /** Default `GROUP_RISK_V1`; `NONE` only for diagnostics. */
  readonly groupRisk?: GroupRiskPolicy;
  /** Default `PORTFOLIO_SLOT_CASH`; another value only for tests. */
  readonly slotCash?: number;
}

export interface PortfolioMemberSummary {
  readonly key: string;
  readonly strategyKey: string;
  readonly researchIdentity: string | null;
  readonly startingCash: number;
  readonly finalEquity: number;
  readonly trades: readonly CompactTrade[];
  readonly dailyEquity: readonly DailyEquityPoint[];
  readonly funnel: {
    readonly cycles: number;
    readonly candidates: number;
    readonly riskApproved: number;
    readonly riskRejected: number;
    readonly entriesFilled: number;
  };
  readonly groupRejected: number;
  readonly groupRejections: Readonly<Record<string, number>>;
  readonly invariantViolations: number;
  readonly killSwitchEngagements: number;
  readonly outputHash: string;
}

export interface PortfolioGroupSummary {
  readonly totalCapital: number;
  readonly finalEquity: number;
  readonly netReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly averageOpenRiskPct: number | null;
  readonly peakOpenRiskPct: number | null;
  readonly averageCapitalBoundPct: number | null;
  readonly peakCapitalBoundPct: number | null;
  readonly hours: number;
  readonly hoursWithOpenPositions: number;
  readonly stage2Rejections: Readonly<Record<string, number>>;
  readonly groupKillSwitchEngagements: number;
  readonly dailyEquity: readonly DailyEquityPoint[];
}

/** Compact, IPC- and storage-friendly result of one comparison run. */
export interface PortfolioSummary {
  readonly comparison: PortfolioComparisonKind;
  readonly engineVersion: string;
  readonly groupRiskVersion: string | null;
  readonly from: string;
  readonly to: string;
  readonly firstAnchorAt: string | null;
  readonly lastAnchorAt: string | null;
  readonly reserveCash: number;
  readonly members: readonly PortfolioMemberSummary[];
  readonly group: PortfolioGroupSummary;
  readonly outputHash: string;
  readonly durationMs: number;
}

function memberConfig(spec: PortfolioMemberSpec): Omit<PortfolioMemberConfig, "startingCash"> {
  if (spec.subject.kind === "ROOT" && rootByKey(spec.subject.rootKey) === null) throw new Error(`Unknown evolution root ${spec.subject.rootKey}.`);
  const plan = replayPlanFor(spec.subject.kind === "ROOT" ? { rootKey: spec.subject.rootKey } : { genome: spec.subject.genome });
  return {
    key: spec.key,
    strategyKey: plan.strategyKey,
    ...(spec.researchIdentity === undefined ? {} : { researchIdentity: spec.researchIdentity }),
    symbols: EVOLUTION_DATA_SPLIT_V1.symbols.map((symbol) => ({ symbol, executionProfile: evolutionExecutionProfile(symbol) })),
    hooks: plan.hooks
  };
}

/** The replay configuration of one comparison, built only through the fixed-slot frame. */
export function portfolioReplayConfig(spec: PortfolioRunSpec): PortfolioReplayConfig {
  if (spec.comparison === "WITH_CANDIDATE" && spec.candidate === undefined) throw new Error("Comparison B needs the candidate.");
  // Comparison A only reserves the candidate's slot; a placeholder completes the frame and never runs.
  const candidate = spec.candidate ?? { key: "RESERVE_SLOT", subject: spec.existing[0]!.subject };
  const frame = comparisonPortfolios({
    slotCash: String(spec.slotCash ?? PORTFOLIO_SLOT_CASH),
    existing: spec.existing.map(memberConfig),
    candidate: memberConfig(candidate),
    shared: {
      regimePolicy: "CRYPTO_NATIVE_V1",
      groupRisk: spec.groupRisk ?? "GROUP_RISK_V1",
      codeVersion: spec.codeVersion,
      from: spec.from,
      to: spec.to
    }
  });
  return spec.comparison === "BASELINE" ? frame.baseline : frame.withCandidate;
}

export function compactTrade(trade: ReplayTrade): CompactTrade {
  const num = (value: string | null): number | null => (value === null ? null : Number(value));
  return {
    symbol: trade.symbol,
    anchorAt: trade.anchorAt,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    exitReason: trade.exitReason,
    entryPrice: Number(trade.entryPrice),
    quantity: Number(trade.quantity),
    plannedRisk: Number(trade.plannedRiskAmount),
    grossPnl: Number(trade.grossPnl),
    fees: Number(trade.fees),
    spreadCost: Number(trade.spreadCost),
    slippageCost: Number(trade.slippageCost),
    netPnl: Number(trade.netPnl),
    rMultiple: num(trade.rMultiple),
    holdHours: Math.round(((Date.parse(trade.closedAt) - Date.parse(trade.openedAt)) / 3_600_000) * 100) / 100,
    marketRegime: trade.marketRegime
  };
}

/** Start-of-day equity points → one point per UTC day (2 decimals), as the single-strategy backtests store them. */
export function toDailyEquity(points: readonly ReplayEquityPoint[]): DailyEquityPoint[] {
  const byDay = new Map<string, number>();
  for (const point of points) byDay.set(point.at.slice(0, 10), Math.round(Number(point.equity) * 100) / 100);
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, equity]) => ({ day, equity }));
}

const numberOrNull = (value: string | null): number | null => (value === null ? null : Number(value));

export function summarizePortfolioReplay(comparison: PortfolioComparisonKind, result: PortfolioReplayResult, durationMs: number): PortfolioSummary {
  return {
    comparison,
    engineVersion: result.engineVersion,
    groupRiskVersion: result.groupRiskVersion,
    from: result.config.from ?? "",
    to: result.config.to ?? "",
    firstAnchorAt: result.firstAnchorAt,
    lastAnchorAt: result.lastAnchorAt,
    reserveCash: Number(result.config.reserveCash),
    members: result.members.map((member) => ({
      key: member.key,
      strategyKey: member.strategyKey,
      researchIdentity: member.researchIdentity,
      startingCash: Number(member.startingCash),
      finalEquity: Number(member.finalEquity),
      trades: member.trades.map(compactTrade),
      dailyEquity: toDailyEquity(member.equityCurve),
      funnel: {
        cycles: member.funnel.cycles,
        candidates: member.funnel.candidates,
        riskApproved: member.funnel.riskApproved,
        riskRejected: member.funnel.riskRejected,
        entriesFilled: member.funnel.entriesFilled
      },
      groupRejected: member.groupRejected,
      groupRejections: member.groupRejections,
      invariantViolations: member.invariantViolations,
      killSwitchEngagements: member.killSwitchEngagements,
      outputHash: member.outputHash
    })),
    group: {
      totalCapital: Number(result.group.totalCapital),
      finalEquity: Number(result.group.finalEquity),
      netReturnPct: numberOrNull(result.group.netReturnPct),
      maxDrawdownPct: numberOrNull(result.group.maxDrawdownPct),
      averageOpenRiskPct: numberOrNull(result.group.averageOpenRiskPct),
      peakOpenRiskPct: numberOrNull(result.group.peakOpenRiskPct),
      averageCapitalBoundPct: numberOrNull(result.group.averageCapitalBoundPct),
      peakCapitalBoundPct: numberOrNull(result.group.peakCapitalBoundPct),
      hours: result.group.hours,
      hoursWithOpenPositions: result.group.hoursWithOpenPositions,
      stage2Rejections: result.group.stage2Rejections,
      groupKillSwitchEngagements: result.group.groupKillSwitchEngagements,
      dailyEquity: toDailyEquity(result.equityCurve)
    },
    outputHash: result.outputHash,
    durationMs
  };
}

/** Runs one comparison of the frame and returns its compact summary. */
export function runPortfolioComparison(market: ReplayMarketData, spec: PortfolioRunSpec, clock: () => number = () => 0): PortfolioSummary {
  const config = portfolioReplayConfig(spec);
  const started = clock();
  const result = runPortfolioReplay(market, config);
  return summarizePortfolioReplay(spec.comparison, result, clock() - started);
}
