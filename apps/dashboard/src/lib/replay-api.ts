// DTOs der Replay-Routen (`/replays`). Dezimalwerte kommen als Strings.

export type ReplayPeriodMetrics = {
  label: string;
  from: string | null;
  to: string | null;
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: string | null;
  profitFactor: string | null;
  expectancy: string | null;
  averageR: string | null;
  netPnl: string;
  fees: string;
  returnPct: string | null;
  maxDrawdownPct: string | null;
  sharpeRatio: string | null;
  averageHoldHours: string | null;
  /** Missing on runs stored before the benchmark existed. */
  buyAndHoldReturnPct?: string | null;
  buyAndHoldMaxDrawdownPct?: string | null;
  exposurePct?: string | null;
};

export type ForwardReturnStats = {
  samples: number;
  avgReturn24hPct: string | null;
  avgReturn72hPct: string | null;
  positive24hPct: string | null;
  positive72hPct: string | null;
};

export type ReplayMetrics = {
  overall: ReplayPeriodMetrics;
  training: ReplayPeriodMetrics | null;
  test: ReplayPeriodMetrics | null;
  /** Ab Replay-Engine mit Beinahe-Treffer-Analyse; ältere Läufe haben es nicht. */
  nearMiss?: {
    baseline: ForwardReturnStats;
    candidates: ForwardReturnStats;
    blockers: (ForwardReturnStats & { blocker: string })[];
  };
};

export type ReplayRunSummary = {
  id: string;
  label: string;
  symbol: string;
  strategyKey: string;
  mode: string;
  regimePolicy: string;
  costProfile: string;
  dataOrigin: string;
  isSynthetic: boolean;
  engineVersion: string;
  firstAnchorAt: string | null;
  lastAnchorAt: string | null;
  cycles: number;
  candidates: number;
  closedTrades: number;
  startingCash: string;
  finalEquity: string;
  outputHash: string;
  durationMs: number;
  metricsJson: ReplayMetrics;
  createdAt: string;
};

export type ReplayFunnel = {
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
  failedStrategyChecks?: Record<string, number>;
  riskReasons: Record<string, number>;
  failedRiskRules: Record<string, number>;
};

export type ReplayTrade = {
  positionId: string;
  symbol: string;
  period: "TRAINING" | "TEST";
  anchorAt: string;
  openedAt: string;
  closedAt: string;
  exitReason: string;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  stopPrice: string;
  takeProfitPrice: string;
  netPnl: string;
  fees: string;
  rMultiple: string | null;
};

export type ReplayRunDetail = ReplayRunSummary & {
  codeVersion: string;
  configJson: Record<string, unknown>;
  funnelJson: ReplayFunnel;
  tradesJson: ReplayTrade[];
  equityCurveJson: { at: string; equity: string }[];
  notesJson: string[];
};

export const REPLAY_MODE_LABELS: Record<string, string> = {
  SPEC: "Spezifikation (alle Risk-Regeln)",
  SIGNAL_EDGE: "Signalqualität (ohne Risk-Gates)"
};

export const REPLAY_COST_LABELS: Record<string, string> = {
  BOOTSTRAP: "Startprofil 10/10/10 bp",
  REALISTIC: "Realistisch 10/2/3 bp"
};

export const EXIT_REASON_LABELS: Record<string, string> = {
  STOP: "Stop-Loss",
  TAKE_PROFIT: "Take-Profit",
  TIME_EXIT: "Zeitlimit",
  MANUAL_RISK_CLOSE: "Risiko-Schließung"
};

export function formatPct(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)} %` : "—";
}

export function formatSignedPct(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)} %`;
}

export function formatAmount(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}

export function formatRatio(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}
