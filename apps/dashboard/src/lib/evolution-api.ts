// Spiegelt apps/api/src/services/evolution/evolutionService.ts.
// Alles hier ist historische Forschung — nie ein Forward-Ergebnis.

import { fetchApi } from "./signalpilot-api";

export type EvolutionMetrics = {
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  averageR: number | null;
  expectancy: number | null;
  netReturnPct: number | null;
  annualizedReturnPct: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  exposurePct: number | null;
  averageHoldHours: number | null;
  tradesPerYear: number | null;
  costShareOfGrossProfitPct: number | null;
  stressedAverageR: number | null;
  stressedNetPnl: number | null;
  buyAndHoldReturnPct: number | null;
  buyAndHoldMaxDrawdownPct: number | null;
  tStatR: number | null;
};

export type EvolutionGate = { gate: string; stage: string; passed: boolean; reasonCode: string; message: string };

export type EvolutionCandidateStatus =
  | "GENERATED"
  | "INVALID"
  | "DUPLICATE"
  | "TECHNICAL_FAILED"
  | "REJECTED"
  | "RESERVE"
  | "PROPOSED"
  | "APPROVED_FOR_FORWARD_TEST"
  | "REJECTED_BY_OPERATOR";

export type EvolutionParameterChange = { parameter: string; from: unknown; to: unknown };

export type EvolutionCandidateItem = {
  key: string;
  family: string;
  generation: number;
  parentKey: string;
  rootStrategyKey: string;
  status: EvolutionCandidateStatus;
  statusReasons: string[];
  researchScore: number | null;
  evidenceGrade: string | null;
  hypothesisTitle: string | null;
  changes: EvolutionParameterChange[];
  windowsSeen: string[];
  holdoutEvaluated: boolean;
  createdAt: string;
  proposedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  discovery: EvolutionMetrics | null;
  validation: EvolutionMetrics | null;
  inSample: EvolutionMetrics | null;
  holdout: EvolutionMetrics | null;
  versusChampion: { sharpeDelta: number | null; averageRDelta: number | null; netReturnDeltaPct: number | null; maxDrawdownDeltaPct: number | null } | null;
  /** Gates v2: strategy key of the root this candidate was checked against as successor. */
  successorOf: string | null;
  gateVersion: string | null;
  gatesPassed: number;
  gatesTotal: number;
  failedGates: EvolutionGate[];
};

export type EvolutionWindow = {
  key: string;
  label: string;
  from: string;
  to: string;
  role: string;
  aiVisibility: "METRICS" | "VERDICT_ONLY" | "NEVER";
  integrity: "IN_SAMPLE" | "PREVIOUSLY_ANALYZED";
};

export type EvolutionOverviewAvailable = {
  available: true;
  asOf: string;
  notice: string;
  agent: { status: string; statusReason: string | null; pausedUntil: string | null; lastRunAt: string | null; nextRunAt: string | null; runInProgress: boolean };
  provider: { name: string; billable: boolean; models: Record<string, string> | null; lastCall: { at: string; model: string; provider: string } | null } | null;
  budget: {
    month: string;
    monthStart: string;
    monthlyBudgetUsd: number;
    perRunBudgetUsd: number;
    spentUsd: number;
    remainingUsd: number;
    billableCallsThisMonth: number;
    simulatedUsdThisMonth: number;
    totalSpentUsd: number;
    totalBillableCalls: number;
    totalTokens: { input: number; output: number };
  };
  split: {
    key: string;
    hash: string;
    windows: Record<string, EvolutionWindow>;
    forwardFrom: string;
    priorExposure?: { source: string; from: string; to: string; role: string; configurationsTried: number; note: string }[];
  } | null;
  exposure: Record<string, Record<string, number>>;
  benchmarks: Record<string, { label: string; role: string; strategyKey: string; discovery: EvolutionMetrics | null; validation: EvolutionMetrics | null; inSample: EvolutionMetrics | null }>;
  runs: {
    runKey: string;
    trigger: string;
    status: string;
    gatesVersion: string | null;
    provider: string;
    billable: boolean;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    hypothesesRequested: number;
    candidatesGenerated: number;
    candidatesRejected: number;
    candidatesProposed: number;
    aiInputTokens: number;
    aiOutputTokens: number;
    aiCostUsd: number;
    backtestCount: number;
    backtestMs: number;
    errorMessage: string | null;
    aiSummary: string | null;
    findings: string[];
  }[];
  hypotheses: {
    key: string;
    runKey: string;
    title: string;
    family: string;
    parentKey: string;
    marketObservation: string;
    rationale: string;
    expectedEffect: string;
    falsificationCriterion: string;
    changes: { parameter: string; value: string }[];
    outcome: string;
    outcomeReasons: string[];
    candidateKey: string | null;
    candidateStatus: EvolutionCandidateStatus | null;
    createdAt: string;
  }[];
  candidates: EvolutionCandidateItem[];
  lineage: { key: string; parentKey: string; generation: number; status: EvolutionCandidateStatus; family: string }[];
  awaitingApproval: string[];
  approved: string[];
};

export type EvolutionOverview = EvolutionOverviewAvailable | { available: false; asOf: string; reason: string };

export type EvolutionCandidateDetail =
  | {
      available: true;
      notice: string;
      key: string;
      family: string;
      generation: number;
      parentKey: string;
      rootStrategyKey: string;
      lineage: string[];
      status: EvolutionCandidateStatus;
      statusReasons: string[];
      researchScore: number | null;
      score: { score: number; complexityPenalty: number; components: { key: string; label: string; weight: number; value: number }[] } | null;
      evidenceGrade: string | null;
      evidence: { grade: string; threshold: number; trials: number; tStat: number | null } | null;
      genome: { family: string; parameters: Record<string, string | number | boolean> };
      genomeHash: string;
      changes: EvolutionParameterChange[];
      windowsSeen: string[];
      holdoutEvaluated: boolean;
      hypothesis: { title: string; marketObservation: string; rationale: string; expectedEffect: string; falsificationCriterion: string } | null;
      run: { runKey: string; provider: string; billable: boolean; startedAt: string };
      metrics: { discovery: EvolutionMetrics | null; validation: EvolutionMetrics | null; inSample: EvolutionMetrics | null; holdout: EvolutionMetrics | null };
      benchmarks: Record<string, { inSample: EvolutionMetrics | null; discovery: EvolutionMetrics | null; validation: EvolutionMetrics | null }>;
      folds: { key: string; window: string; trades: number; netPnl: number; averageR: number | null; profitFactor: number | null; winRatePct: number | null }[];
      correlations: { key: string; value: number | null }[];
      walkForward: {
        steps: { foldKey: string; selectedVariant: string; inSampleTrades: number; inSampleAverageR: number; outOfSampleTrades: number; outOfSampleAverageR: number | null }[];
        outOfSampleTrades: number;
        outOfSampleAverageR: number | null;
        inSampleAverageR: number | null;
        efficiency: number | null;
        candidateSelectedShare: number | null;
      } | null;
      neighbours: { key: string; inSample: EvolutionMetrics | null }[];
      successor: {
        rootKey: string;
        correlation: number | null;
        candidateSharpe: number | null;
        referenceSharpe: number | null;
        threshold: number;
        trials: number;
        screeningsThisMonth: number;
        paired: { months: number; informativeMonths: number; meanDifference: number | null; tStat: number | null; naiveTStat: number | null; lag: number | null; criticalT: number | null };
      } | null;
      gateVersion: string | null;
      technical: { deterministic: boolean; invariantViolations: number; cycles: number } | null;
      gates: EvolutionGate[];
      backtests: { subjectKey: string; role: string; symbol: string; windowKey: string; tradeCount: number; outputHash: string; durationMs: number; createdAt: string }[];
      decision: { proposedAt: string | null; decidedAt: string | null; decidedBy: string | null; note: string | null };
      reportMarkdown: string | null;
    }
  | { available: false };

export function fetchEvolutionOverview() {
  return fetchApi<EvolutionOverview>("/trading/evolution");
}

export function fetchEvolutionCandidate(key: string) {
  return fetchApi<EvolutionCandidateDetail>(`/trading/evolution/candidates/${encodeURIComponent(key)}`);
}
