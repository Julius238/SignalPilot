/**
 * Technical validation of the chronological portfolio replay on real
 * BTC/ETH history with the existing reference strategies only (champion and
 * challenger, roots of the evolution engine) and the fixed capital slots of
 * gates v4. No research candidate is evaluated here; the runs are reference
 * runs and never count as trials.
 *
 * Parts (each can run in its own process):
 *   equivalence <root> <symbol>  one strategy, one symbol: portfolio replay
 *                                (with stage 2) against the single replay —
 *                                identical output hash expected
 *   baseline-group               comparison A (champion + challenger + reserve
 *                                slot) with stage 2; consistency checks and the
 *                                utilisation of every group limit at every
 *                                stage-2 decision
 *   baseline-none                the same without stage 2 (diagnostic)
 */

import {
  EVOLUTION_DATA_SPLIT_V1,
  EVOLUTION_GATES_V4,
  EVOLUTION_ROOTS,
  assessPortfolioComparison,
  evolutionExecutionProfile,
  independentFamilyScreeningGates,
  portfolioReplayConfig,
  replayPlanFor,
  rootByKey,
  runPortfolioComparison,
  type EvolutionGatesV4,
  type PortfolioRunSpec,
  type PortfolioSummary
} from "@signalpilot/evolution";
import {
  runPortfolioReplay,
  runShadowReplay,
  type GroupRiskInput,
  type GroupRiskResult,
  type PortfolioReplayResult,
  type ReplayMarketData
} from "@signalpilot/shadow-replay";

const WINDOW = {
  from: EVOLUTION_DATA_SPLIT_V1.windows.DISCOVERY.from,
  to: EVOLUTION_DATA_SPLIT_V1.windows.VALIDATION.to
};
const SINGLE_STARTING_CASH = "10000";

export interface EquivalenceReport {
  readonly part: "equivalence";
  readonly rootKey: string;
  readonly symbol: string;
  readonly singleOutputHash: string;
  readonly portfolioOutputHash: string;
  readonly identical: boolean;
  readonly trades: number;
  readonly singleFinalEquity: string;
  readonly portfolioFinalEquity: string;
  readonly stage2Calls: number;
  readonly stage2Rejections: number;
  readonly singleMs: number;
  readonly portfolioMs: number;
}

/** One root, one symbol: the portfolio replay must reproduce the single replay exactly. */
export function validateEquivalence(market: ReplayMarketData, rootKey: string, symbol: string, codeVersion: string, clock: () => number): EquivalenceReport {
  const root = rootByKey(rootKey);
  if (root === null) throw new Error(`Unknown root ${rootKey}.`);
  const plan = replayPlanFor({ rootKey });
  const profile = evolutionExecutionProfile(symbol);
  let started = clock();
  const single = runShadowReplay(
    market,
    {
      symbol,
      strategyKey: plan.strategyKey,
      mode: plan.mode,
      regimePolicy: plan.regimePolicy,
      startingCash: SINGLE_STARTING_CASH,
      executionProfile: profile,
      from: WINDOW.from,
      to: WINDOW.to,
      codeVersion
    },
    plan.hooks
  );
  const singleMs = clock() - started;
  let stage2Calls = 0;
  started = clock();
  const portfolio = runPortfolioReplay(
    market,
    {
      members: [{ key: rootKey, strategyKey: plan.strategyKey, startingCash: SINGLE_STARTING_CASH, symbols: [{ symbol, executionProfile: profile }], hooks: plan.hooks }],
      reserveCash: "0",
      regimePolicy: plan.regimePolicy,
      groupRisk: "GROUP_RISK_V1",
      codeVersion,
      from: WINDOW.from,
      to: WINDOW.to
    },
    {
      onDecision: (detail) => {
        if (detail.stage2 !== null) stage2Calls += 1;
      }
    }
  );
  const portfolioMs = clock() - started;
  const member = portfolio.members[0]!;
  return {
    part: "equivalence",
    rootKey,
    symbol,
    singleOutputHash: single.outputHash,
    portfolioOutputHash: member.outputHash,
    identical: single.outputHash === member.outputHash,
    trades: single.trades.length,
    singleFinalEquity: single.finalEquity,
    portfolioFinalEquity: member.finalEquity,
    stage2Calls,
    stage2Rejections: member.groupRejected,
    singleMs,
    portfolioMs
  };
}

interface LimitUtilisation {
  readonly ruleCode: string;
  /** Highest post-trade value ÷ limit seen at any stage-2 decision (1 = at the limit). */
  readonly maxUtilisation: number | null;
  readonly fails: number;
  readonly errors: number;
}

export interface BaselineReport {
  readonly part: "baseline-group" | "baseline-none";
  readonly outputHash: string;
  readonly durationMs: number;
  readonly totalCapital: string;
  readonly finalEquity: string;
  readonly netReturnPct: string | null;
  readonly maxDrawdownPct: string | null;
  readonly averageOpenRiskPct: string | null;
  readonly peakOpenRiskPct: string | null;
  readonly averageCapitalBoundPct: string | null;
  readonly peakCapitalBoundPct: string | null;
  readonly hours: number;
  readonly stage2Calls: number;
  readonly stage2Rejections: Readonly<Record<string, number>>;
  readonly groupKillSwitchEngagements: number;
  readonly limits: readonly LimitUtilisation[];
  readonly members: readonly {
    readonly key: string;
    readonly outputHash: string;
    readonly trades: number;
    readonly tradesBySymbol: Readonly<Record<string, number>>;
    readonly netPnl: number;
    readonly sumR: number;
    readonly fees: number;
    readonly spreadCost: number;
    readonly slippageCost: number;
    readonly finalEquity: string;
    readonly invariantViolations: number;
    readonly killSwitchEngagements: number;
    readonly groupRejected: number;
    readonly failedRiskRules: Readonly<Record<string, number>>;
  }[];
  readonly checks: readonly { readonly check: string; readonly passed: boolean; readonly detail: string }[];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function consistencyChecks(result: PortfolioReplayResult): { check: string; passed: boolean; detail: string }[] {
  const checks: { check: string; passed: boolean; detail: string }[] = [];
  const reserve = Number(result.config.reserveCash);
  const invariants = result.members.map((member) => member.invariantViolations);
  checks.push({ check: "ledger invariants", passed: invariants.every((value) => value === 0), detail: `violations per portfolio: ${invariants.join(", ")}` });

  // Group equity equals the sum of the portfolios plus the reserve, every day and at the end.
  let dayMismatches = 0;
  let worstDayGap = 0;
  result.equityCurve.forEach((point, index) => {
    const total = sum(result.members.map((member) => Number(member.equityCurve[index]?.equity ?? Number.NaN))) + reserve;
    const gap = Math.abs(total - Number(point.equity));
    worstDayGap = Math.max(worstDayGap, gap);
    if (!(gap < 1e-6)) dayMismatches += 1;
  });
  checks.push({ check: "group equity = Σ portfolios + reserve (daily)", passed: dayMismatches === 0, detail: `${result.equityCurve.length} days, largest gap ${worstDayGap}` });
  const finalGap = Math.abs(sum(result.members.map((member) => Number(member.finalEquity))) + reserve - Number(result.group.finalEquity));
  checks.push({ check: "group final equity = Σ portfolios + reserve", passed: finalGap < 1e-6, detail: `gap ${finalGap}` });

  // Every closed trade: net = gross − fees; fees match the 10 bp fee on both legs; price impact split 1 : 3.
  let netMismatch = 0;
  let worstFeeRatio = 0;
  let impactMismatch = 0;
  for (const member of result.members) {
    for (const trade of member.trades) {
      if (Math.abs(Number(trade.grossPnl) - Number(trade.fees) - Number(trade.netPnl)) > 1e-6) netMismatch += 1;
      const notional = (Number(trade.entryPrice) + Number(trade.exitPrice)) * Number(trade.quantity);
      const feeRate = Number(trade.fees) / notional;
      worstFeeRatio = Math.max(worstFeeRatio, Math.abs(feeRate - 0.001) / 0.001);
      const impact = Number(trade.spreadCost) + Number(trade.slippageCost);
      if (impact > 0 && Math.abs(Number(trade.slippageCost) / impact - 0.75) > 0.001) impactMismatch += 1;
    }
  }
  checks.push({ check: "net PnL = gross PnL − fees", passed: netMismatch === 0, detail: `${netMismatch} mismatches` });
  checks.push({ check: "fees = 10 bp on entry and exit notional", passed: worstFeeRatio < 0.01, detail: `largest relative deviation ${worstFeeRatio.toFixed(6)}` });
  checks.push({ check: "price impact split spread 1 bp : slippage 3 bp", passed: impactMismatch === 0, detail: `${impactMismatch} mismatches` });

  // Every closed position belongs to exactly one portfolio and its symbol.
  const keys = result.members.map((member) => member.key);
  checks.push({ check: "attribution by portfolio", passed: new Set(keys).size === keys.length, detail: keys.join(", ") });
  checks.push({
    check: "capital tie-up within the gross cap",
    passed: Number(result.group.peakCapitalBoundPct ?? 0) <= 40,
    detail: `average ${result.group.averageCapitalBoundPct} %, peak ${result.group.peakCapitalBoundPct} % of group equity`
  });
  return checks;
}

/** Comparison A with the fixed slots: champion, challenger and one reserve slot. */
export function validateBaseline(market: ReplayMarketData, groupRisk: "GROUP_RISK_V1" | "NONE", codeVersion: string, clock: () => number): BaselineReport {
  const existing = EVOLUTION_ROOTS.map((root) => ({ key: root.key, subject: { kind: "ROOT" as const, rootKey: root.key } }));
  const spec: PortfolioRunSpec = {
    comparison: "BASELINE",
    existing,
    from: WINDOW.from,
    to: WINDOW.to,
    codeVersion,
    groupRisk
  };
  const utilisation = new Map<string, { max: number | null; fails: number; errors: number }>();
  let stage2Calls = 0;
  const record = (input: GroupRiskInput, result: GroupRiskResult) => {
    stage2Calls += 1;
    for (const verdict of result.verdicts) {
      const entry = utilisation.get(verdict.ruleCode) ?? { max: null, fails: 0, errors: 0 };
      if (verdict.outcome === "FAIL") entry.fails += 1;
      if (verdict.outcome === "ERROR") entry.errors += 1;
      let ratio: number | null = null;
      if (verdict.ruleCode === "R-010-DAILY-LOSS") {
        const limit = Number(input.group.startOfDay?.equity ?? Number.NaN) * 0.01;
        ratio = limit > 0 ? -Number(input.group.dailyPnl) / limit : null;
      } else if (verdict.actualValue !== undefined && verdict.actualValue !== null && verdict.limitValue !== undefined && verdict.limitValue !== null) {
        ratio = Number(verdict.actualValue) / Number(verdict.limitValue);
      } else {
        const json = verdict.inputJson as { postTradeExposure?: string; equity?: string; capPct?: string };
        if (json.postTradeExposure !== undefined && json.equity !== undefined && json.capPct !== undefined) {
          ratio = Number(json.postTradeExposure) / (Number(json.equity) * Number(json.capPct));
        }
      }
      if (ratio !== null && Number.isFinite(ratio)) entry.max = entry.max === null ? ratio : Math.max(entry.max, ratio);
      utilisation.set(verdict.ruleCode, entry);
    }
  };
  const config = portfolioReplayConfig(spec);
  const started = clock();
  const result = runPortfolioReplay(market, config, {
    onDecision: (detail) => {
      if (detail.stage2Input !== null && detail.stage2 !== null) record(detail.stage2Input, detail.stage2);
    }
  });
  const durationMs = clock() - started;
  return {
    part: groupRisk === "GROUP_RISK_V1" ? "baseline-group" : "baseline-none",
    outputHash: result.outputHash,
    durationMs,
    totalCapital: result.group.totalCapital,
    finalEquity: result.group.finalEquity,
    netReturnPct: result.group.netReturnPct,
    maxDrawdownPct: result.group.maxDrawdownPct,
    averageOpenRiskPct: result.group.averageOpenRiskPct,
    peakOpenRiskPct: result.group.peakOpenRiskPct,
    averageCapitalBoundPct: result.group.averageCapitalBoundPct,
    peakCapitalBoundPct: result.group.peakCapitalBoundPct,
    hours: result.group.hours,
    stage2Calls,
    stage2Rejections: result.group.stage2Rejections,
    groupKillSwitchEngagements: result.group.groupKillSwitchEngagements,
    limits: [...utilisation.entries()].map(([ruleCode, entry]) => ({ ruleCode, maxUtilisation: entry.max, fails: entry.fails, errors: entry.errors })),
    members: result.members.map((member) => {
      const bySymbol: Record<string, number> = {};
      for (const trade of member.trades) bySymbol[trade.symbol] = (bySymbol[trade.symbol] ?? 0) + 1;
      return {
        key: member.key,
        outputHash: member.outputHash,
        trades: member.trades.length,
        tradesBySymbol: bySymbol,
        netPnl: sum(member.trades.map((trade) => Number(trade.netPnl))),
        sumR: sum(member.trades.map((trade) => Number(trade.rMultiple ?? 0))),
        fees: sum(member.trades.map((trade) => Number(trade.fees))),
        spreadCost: sum(member.trades.map((trade) => Number(trade.spreadCost))),
        slippageCost: sum(member.trades.map((trade) => Number(trade.slippageCost))),
        finalEquity: member.finalEquity,
        invariantViolations: member.invariantViolations,
        killSwitchEngagements: member.killSwitchEngagements,
        groupRejected: member.groupRejected,
        failedRiskRules: member.funnel.failedRiskRules
      };
    }),
    checks: consistencyChecks(result)
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Counter-probe of gates v4 on known strategies (before freezing v4)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Known genomes only: exact copies of the two roots (in a fixed-slot frame a
 * copy is the existing strategy with double weight) and the regime variants
 * EVO-REG-0004 – 0010, read from the development database of the 2026-10-15
 * runs. None of them is an independent family; they run through the
 * portfolio path to show that copies, re-weightings and exit variants are not
 * counted as an additional edge. Reference runs: never a trial, never a new
 * verdict on those candidates.
 */
export const COUNTERPROBE_SUBJECTS: Readonly<Record<string, PortfolioRunSpec["existing"][number]["subject"]>> = Object.freeze({
  "COPY:CRYPTO_TREND_CORE_LONG_V1": { kind: "GENOME", genome: EVOLUTION_ROOTS.find((root) => root.role === "CHAMPION")!.genome },
  "COPY:CRYPTO_REGIME_LONG_V1": { kind: "GENOME", genome: EVOLUTION_ROOTS.find((root) => root.role === "CHALLENGER")!.genome },
  ...Object.fromEntries(
    (
      [
        ["EVO-REG-0004", 60, "2.5", "4", 336, false],
        ["EVO-REG-0005", 50, "2.5", "6", 720, true],
        ["EVO-REG-0006", 70, "2", "4", 336, false],
        ["EVO-REG-0007", 65, "2", "8", 1008, true],
        ["EVO-REG-0008", 60, "2", "6", 504, false],
        ["EVO-REG-0009", 60, "3", "5", 1008, true],
        ["EVO-REG-0010", 60, "3", "4", 504, false]
      ] as const
    ).map(([key, confidence, stop, target, hold, gateExit]) => [
      key,
      {
        kind: "GENOME" as const,
        genome: {
          family: "REGIME_LONG" as const,
          parameters: { regimeMinimumConfidence: confidence, stopAtrMultiple1d: stop, takeProfitRMultiple: target, maxHoldHours: hold, exitOnRegimeGateClosed: gateExit }
        }
      }
    ])
  )
});

const ROOT_MEMBERS = () => EVOLUTION_ROOTS.map((root) => ({ key: root.key, subject: { kind: "ROOT" as const, rootKey: root.key } }));

/** Comparison A or B of the counter-probe, as the compact summary the gates read. */
export function counterprobeRun(market: ReplayMarketData, probe: string | null, codeVersion: string, clock: () => number): PortfolioSummary {
  const spec: PortfolioRunSpec =
    probe === null
      ? { comparison: "BASELINE", existing: ROOT_MEMBERS(), from: WINDOW.from, to: WINDOW.to, codeVersion }
      : (() => {
          const subject = COUNTERPROBE_SUBJECTS[probe];
          if (subject === undefined) throw new Error(`Unknown counter-probe ${probe}.`);
          return { comparison: "WITH_CANDIDATE" as const, existing: ROOT_MEMBERS(), candidate: { key: `PROBE:${probe}`, subject }, from: WINDOW.from, to: WINDOW.to, codeVersion };
        })();
  return runPortfolioComparison(market, spec, clock);
}

export interface CounterprobeVerdict {
  readonly probe: string;
  readonly passed: boolean;
  readonly failed: readonly string[];
  readonly netReturnDelta: number | null;
  readonly sharpeDelta: number | null;
  readonly alphaT: number | null;
  readonly alphaThreshold: number;
  readonly incrementT: number | null;
  readonly incrementThreshold: number;
  readonly alphaShare: number | null;
  readonly rSquared: number | null;
  readonly correlations: readonly { readonly key: string; readonly value: number | null }[];
  readonly existingIdentical: boolean;
  readonly gates: readonly { readonly gate: string; readonly passed: boolean; readonly reasonCode: string; readonly message: string }[];
}

/**
 * The portfolio path of gates v4 on every probe. The structural check is set
 * as if the probe were an independent family, so that only the portfolio
 * checks decide: a probe must fail on value, not on paperwork.
 */
export function counterprobeVerdicts(baseline: PortfolioSummary, probes: readonly PortfolioSummary[], trials: number, gates: EvolutionGatesV4 = EVOLUTION_GATES_V4): CounterprobeVerdict[] {
  return probes.map((withCandidate) => {
    const candidate = withCandidate.members.at(-1)!;
    const assessment = assessPortfolioComparison({
      baseline,
      withCandidate,
      candidateKey: candidate.key,
      split: EVOLUTION_DATA_SPLIT_V1,
      geometryFactor: gates.independentFamily.thresholds.geometryFactor,
      costMultiplier: gates.independentFamily.thresholds.costStressMultiplier,
      minFoldTrades: gates.independentFamily.thresholds.minFoldTrades
    });
    const result = independentFamilyScreeningGates(
      {
        family: "COUNTERPROBE",
        structure: { declaredIndependent: true, entryParametersOnly: true, exitsFrozen: true, ownEntryEvaluator: true, preregistrationHash: "counterprobe" },
        assessment,
        trials,
        screeningsThisMonth: 1
      },
      gates
    );
    return {
      probe: candidate.key.replace(/^PROBE:/, ""),
      passed: result.decision.passed,
      failed: result.decision.failed,
      netReturnDelta: assessment.windows.IN_SAMPLE.netReturnDelta,
      sharpeDelta: assessment.windows.IN_SAMPLE.sharpeDelta,
      alphaT: assessment.alpha.tStat,
      alphaThreshold: result.decision.alphaThreshold,
      incrementT: assessment.incrementTest.tStat,
      incrementThreshold: result.decision.incrementThreshold,
      alphaShare: assessment.alphaShare,
      rSquared: assessment.rSquared,
      correlations: assessment.existing.map((relation) => ({ key: relation.key, value: relation.correlation })),
      existingIdentical: assessment.existing.every((relation) => relation.identicalInBothComparisons),
      gates: result.gates.map((entry) => ({ gate: entry.gate, passed: entry.passed, reasonCode: entry.reasonCode, message: entry.message }))
    };
  });
}
