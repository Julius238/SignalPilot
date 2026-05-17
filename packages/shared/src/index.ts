export interface HealthResponse {
  status: "ok";
  service: "signalpilot-api";
}

export type AssetClass = "stock" | "etf" | "crypto";

export interface IndicatorSnapshot {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  atr14: number | null;
  averageVolume20: number | null;
  relativeVolume: number | null;
  periodHigh20: number | null;
  periodLow20: number | null;
  lastClose: number | null;
  lastVolume: number | null;
  candleCount: number;
}

export type SignalDecisionType =
  | "MOMENTUM_ALERT"
  | "TREND_ALERT"
  | "VOLUME_SPIKE"
  | "VOLATILITY_SPIKE"
  | "BREAKOUT_ALERT"
  | "NO_SIGNAL";

export type SignalDecisionStatus = "STRONG_WATCH" | "WATCH" | "WAIT" | "AVOID" | "NO_EDGE";

export type SignalDecisionDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";

export type SignalDecisionRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface SignalDecision {
  symbol: string;
  assetType: AssetClass;
  timeframe: string;
  signalType: SignalDecisionType;
  status: SignalDecisionStatus;
  direction: SignalDecisionDirection;
  score: number;
  riskLevel: SignalDecisionRiskLevel;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  volatilityScore: number;
  rsiScore: number;
  newsScore: number;
  socialScore: number;
  eventScore: number;
  riskScore: number;
  reasons: string[];
  counterArguments: string[];
  nextTrigger: string;
}

export interface IntelligenceContext {
  newsSummary?: string;
  socialSummary?: string;
  eventSummary?: string;
  impactSummary?: string;
  sources: string[];
}

export interface SignalOutputDraft {
  shortConclusion: string;
  technicalJson: Record<string, unknown>;
  intelligenceJson: Record<string, unknown>;
  marketConfirmationJson: Record<string, unknown>;
  counterArgument: string;
  nextTrigger: string;
  multiTimeframeSummary?: unknown;
  telegramText: string;
  dashboardJson: Record<string, unknown>;
}
