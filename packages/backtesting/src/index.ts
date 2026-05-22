import { buildIndicatorSnapshot, type IndicatorCandle } from "@signalpilot/indicators";
import { scoreSignal, type ScoreSignalInput } from "@signalpilot/scoring-engine";
import type {
  AssetClass,
  IndicatorSnapshot,
  SignalDecision,
  SignalDecisionDirection,
  SignalDecisionRiskLevel,
  SignalDecisionStatus,
  SignalDecisionType
} from "@signalpilot/shared";
import { applySignalRules } from "@signalpilot/signal-rules";
import { applyStrategyFilter, type StrategyRuleConfig } from "@signalpilot/strategy-lab";

export type BacktestAssetType = "STOCK" | "ETF" | "CRYPTO";
export type BacktestOutcomeStatus = "OPEN" | "EVALUATED" | "EXPIRED" | "SKIPPED";
export type BacktestOutcome =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "INVALIDATED"
  | "TARGET_REACHED";

export type BacktestAsset = {
  id: string;
  symbol: string;
  assetType: BacktestAssetType;
};

export type BacktestCandle = {
  assetId: string;
  symbol: string;
  timeframe: string;
  openTime: Date;
  closeTime: Date;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
};

export type BacktestConfig = {
  symbols?: string[];
  assetType?: BacktestAssetType;
  timeframes: string[];
  from: Date;
  to: Date;
  minCandlesBeforeSignal?: number;
  maxSignalsPerAssetTimeframe?: number;
  useSignalRules?: boolean;
  minScoreToRecord?: number;
  includeNoEdge?: boolean;
  strategyConfig?: StrategyRuleConfig;
};

export type BacktestGeneratedSignal = {
  assetId: string;
  symbol: string;
  assetType: BacktestAssetType;
  timeframe: string;
  signalTime: Date;
  signalType: SignalDecisionType;
  status: SignalDecisionStatus;
  direction: SignalDecisionDirection;
  riskLevel: SignalDecisionRiskLevel;
  score: number;
  originalScore?: number;
  adjustedScore?: number;
  entryPrice: number;
  targetPrice?: number;
  invalidationPrice?: number;
  context: {
    decision: SignalDecision;
    indicatorSnapshot: IndicatorSnapshot;
    marketRegimeContext?: { marketRegime: string; overallRegime: string; riskMode: string; isAlignedWithRegime?: boolean };
    signalRules?: unknown;
    generatedWithoutLookahead: true;
  };
};

export type BacktestEvaluatedSignal = BacktestGeneratedSignal & {
  outcome: BacktestOutcome | null;
  outcomeStatus: BacktestOutcomeStatus;
  evaluatedAt?: Date;
  returnAfter1h?: number | null;
  returnAfter4h?: number | null;
  returnAfter1d?: number | null;
  returnAfter3d?: number | null;
  maxFavorableMove?: number | null;
  maxAdverseMove?: number | null;
};

export type BacktestSummary = {
  totalSignals: number;
  evaluatedCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  winRate: number;
  avgReturnAfter1h: number;
  avgReturnAfter4h: number;
  avgReturnAfter1d: number;
  avgReturnAfter3d: number;
  groupedBySymbol: Array<BacktestGroupSummary>;
  groupedByTimeframe: Array<BacktestGroupSummary>;
  groupedBySignalType: Array<BacktestGroupSummary>;
  groupedByStatus: Array<BacktestGroupSummary>;
  groupedByScoreBucket: Array<BacktestGroupSummary>;
  warnings: string[];
};

export type BacktestGroupSummary = {
  key: string;
  totalSignals: number;
  evaluatedCount: number;
  winRate: number;
  avgReturnAfter1d: number;
};

export type GenerateBacktestSignalsInput = {
  assets: BacktestAsset[];
  candles: BacktestCandle[];
  config: BacktestConfig;
  scoreSignalFn?: (input: ScoreSignalInput) => SignalDecision;
};

export type EvaluateBacktestSignalsInput = {
  signals: BacktestGeneratedSignal[];
  candles: BacktestCandle[];
  to: Date;
};

const defaultMinCandlesBeforeSignal = 220;
const defaultMaxSignalsPerAssetTimeframe = 500;
const defaultMinScoreToRecord = 50;

export function generateBacktestSignals(input: GenerateBacktestSignalsInput): BacktestGeneratedSignal[] {
  const config = normalizeConfig(input.config);
  const scoreFn = input.scoreSignalFn ?? scoreSignal;
  const signals: BacktestGeneratedSignal[] = [];
  const candlesByAssetTimeframe = groupCandles(input.candles);
  const assets = input.assets
    .filter((asset) => !config.assetType || asset.assetType === config.assetType)
    .filter((asset) => config.symbols.length === 0 || config.symbols.includes(asset.symbol));

  for (const asset of assets) {
    for (const timeframe of config.timeframes) {
      const candles = candlesByAssetTimeframe.get(key(asset.id, timeframe)) ?? [];
      let recorded = 0;

      if (candles.length < config.minCandlesBeforeSignal) {
        continue;
      }

      for (let index = config.minCandlesBeforeSignal - 1; index < candles.length; index += 1) {
        if (recorded >= config.maxSignalsPerAssetTimeframe) break;
        const candle = candles[index];
        const signalTime = candle.closeTime;

        if (signalTime < config.from || signalTime > config.to) continue;

        const historicalCandles = candles.slice(0, index + 1);
        const indicatorSnapshot = buildIndicatorSnapshot(historicalCandles.map(toIndicatorCandle));
        const decision = scoreFn({
          asset: { symbol: asset.symbol, assetType: mapAssetClass(asset.assetType) },
          timeframe,
          indicators: indicatorSnapshot,
          context: { newsScore: 50, socialScore: 50, eventScore: 50 }
        });
        const effectiveUseRules = config.strategyConfig?.useSignalRules ?? config.useSignalRules;
        const ruleResult = effectiveUseRules
          ? applySignalRules({
              asset: { symbol: asset.symbol, assetType: mapAssetClass(asset.assetType) },
              signalDecision: decision,
              newsContext: null,
              eventContext: { eventRiskLevel: "NONE" },
              marketRegimeContext: { marketRegime: "UNKNOWN", overallRegime: "UNKNOWN", riskMode: "UNKNOWN" },
              dataQuality: { hasMinimumCandles: true }
            })
          : null;
        const finalDecision = ruleResult
          ? {
              ...decision,
              score: ruleResult.adjustedScore,
              status: ruleResult.finalStatus,
              riskLevel: ruleResult.finalRiskLevel
            }
          : decision;

        const marketRegimeContext = {
          marketRegime: "UNKNOWN",
          overallRegime: "UNKNOWN",
          riskMode: "UNKNOWN",
          isAlignedWithRegime: false
        };

        if (!shouldRecord(finalDecision, config, decision, ruleResult?.adjustedScore, marketRegimeContext)) continue;

        const entryPrice = toNumber(candle.close);
        if (entryPrice === null || entryPrice <= 0) continue;
        const target = calculateTargetInvalidation(finalDecision.direction, finalDecision.status, entryPrice, indicatorSnapshot.atr14);

        signals.push({
          assetId: asset.id,
          symbol: asset.symbol,
          assetType: asset.assetType,
          timeframe,
          signalTime,
          signalType: finalDecision.signalType,
          status: finalDecision.status,
          direction: finalDecision.direction,
          riskLevel: finalDecision.riskLevel,
          score: finalDecision.score,
          originalScore: ruleResult ? ruleResult.originalScore : undefined,
          adjustedScore: ruleResult ? ruleResult.adjustedScore : undefined,
          entryPrice,
          targetPrice: target.targetPrice,
          invalidationPrice: target.invalidationPrice,
          context: {
            decision: finalDecision,
            indicatorSnapshot,
            marketRegimeContext,
            signalRules: ruleResult ?? undefined,
            generatedWithoutLookahead: true
          }
        });
        recorded += 1;
      }
    }
  }

  return signals;
}

export function evaluateBacktestSignals(input: EvaluateBacktestSignalsInput): BacktestEvaluatedSignal[] {
  const candlesByAssetTimeframe = groupCandles(input.candles);
  return input.signals.map((signal) => {
    const futureCandles = (candlesByAssetTimeframe.get(key(signal.assetId, signal.timeframe)) ?? [])
      .filter((candle) => candle.closeTime > signal.signalTime && candle.closeTime <= input.to);

    if (futureCandles.length === 0) {
      return { ...signal, outcome: null, outcomeStatus: "EXPIRED" };
    }

    const returnAfter1h = returnAtHorizon(signal, futureCandles, 1);
    const returnAfter4h = returnAtHorizon(signal, futureCandles, 4);
    const returnAfter1d = returnAtHorizon(signal, futureCandles, 24);
    const returnAfter3d = returnAtHorizon(signal, futureCandles, 72);
    const excursion = calculateExcursion(signal, futureCandles);
    const targetOutcome = findTargetOutcome(signal, futureCandles);
    const directionalReturn = returnAfter1d ?? returnAfter4h ?? returnAfter1h ?? excursion.lastReturn;
    const outcome = targetOutcome ?? classifyDirectionalOutcome(signal, directionalReturn);

    return {
      ...signal,
      outcome,
      outcomeStatus: "EVALUATED",
      evaluatedAt: futureCandles.at(-1)?.closeTime,
      returnAfter1h,
      returnAfter4h,
      returnAfter1d,
      returnAfter3d,
      maxFavorableMove: excursion.maxFavorableMove,
      maxAdverseMove: excursion.maxAdverseMove
    };
  });
}

export function summarizeBacktestRun(input: { signals: BacktestEvaluatedSignal[]; warnings?: string[] }): BacktestSummary {
  const signals = input.signals;
  const evaluated = signals.filter((signal) => signal.outcomeStatus === "EVALUATED");
  const wins = evaluated.filter(isPositiveOutcome);

  return {
    totalSignals: signals.length,
    evaluatedCount: evaluated.length,
    positiveCount: evaluated.filter((signal) => signal.outcome === "POSITIVE").length,
    negativeCount: evaluated.filter((signal) => signal.outcome === "NEGATIVE").length,
    neutralCount: evaluated.filter((signal) => signal.outcome === "NEUTRAL").length,
    targetReachedCount: evaluated.filter((signal) => signal.outcome === "TARGET_REACHED").length,
    invalidatedCount: evaluated.filter((signal) => signal.outcome === "INVALIDATED").length,
    winRate: evaluated.length === 0 ? 0 : round((wins.length / evaluated.length) * 100),
    avgReturnAfter1h: average(evaluated.map((signal) => signal.returnAfter1h)),
    avgReturnAfter4h: average(evaluated.map((signal) => signal.returnAfter4h)),
    avgReturnAfter1d: average(evaluated.map((signal) => signal.returnAfter1d)),
    avgReturnAfter3d: average(evaluated.map((signal) => signal.returnAfter3d)),
    groupedBySymbol: groupSummary(evaluated, (signal) => signal.symbol),
    groupedByTimeframe: groupSummary(evaluated, (signal) => signal.timeframe),
    groupedBySignalType: groupSummary(evaluated, (signal) => signal.signalType),
    groupedByStatus: groupSummary(evaluated, (signal) => signal.status),
    groupedByScoreBucket: groupSummary(evaluated, (signal) => scoreBucket(signal.score)),
    warnings: input.warnings ?? []
  };
}

function normalizeConfig(config: BacktestConfig) {
  const strategyConfig = config.strategyConfig;
  return {
    ...config,
    strategyConfig,
    symbols: (config.symbols ?? []).map((symbol) => symbol.toUpperCase()),
    minCandlesBeforeSignal: config.minCandlesBeforeSignal ?? defaultMinCandlesBeforeSignal,
    maxSignalsPerAssetTimeframe:
      strategyConfig?.maxSignalsPerAssetTimeframe ?? config.maxSignalsPerAssetTimeframe ?? defaultMaxSignalsPerAssetTimeframe,
    useSignalRules: strategyConfig?.useSignalRules ?? config.useSignalRules ?? true,
    minScoreToRecord: strategyConfig?.minScoreToRecord ?? config.minScoreToRecord ?? defaultMinScoreToRecord,
    includeNoEdge: config.includeNoEdge ?? false
  };
}

function shouldRecord(
  decision: SignalDecision,
  config: ReturnType<typeof normalizeConfig>,
  originalDecision: SignalDecision,
  adjustedScore: number | undefined,
  marketRegimeContext: { isAlignedWithRegime: boolean; riskMode: string }
) {
  if (!config.includeNoEdge && decision.status === "NO_EDGE") return false;

  if (config.strategyConfig) {
    return applyStrategyFilter(
      {
        score: decision.score,
        originalScore: originalDecision.score,
        adjustedScore,
        status: decision.status,
        signalType: decision.signalType,
        marketRegimeContext
      },
      config.strategyConfig
    );
  }

  if (decision.score >= config.minScoreToRecord) return true;
  if (decision.status === "WATCH" || decision.status === "STRONG_WATCH" || decision.status === "AVOID") return true;
  return decision.signalType === "BREAKOUT_ALERT" || decision.signalType === "VOLUME_SPIKE" || decision.signalType === "VOLATILITY_SPIKE";
}

function calculateTargetInvalidation(
  direction: SignalDecisionDirection,
  status: SignalDecisionStatus,
  entryPrice: number,
  atr: number | null
) {
  const warning = direction === "BEARISH" || status === "AVOID";
  const targetDistance = atr && atr > 0 ? atr * 2 : entryPrice * 0.04;
  const invalidationDistance = atr && atr > 0 ? atr : entryPrice * 0.02;
  return warning
    ? { targetPrice: entryPrice - targetDistance, invalidationPrice: entryPrice + invalidationDistance }
    : { targetPrice: entryPrice + targetDistance, invalidationPrice: entryPrice - invalidationDistance };
}

function returnAtHorizon(signal: BacktestGeneratedSignal, candles: BacktestCandle[], hours: number) {
  const targetTime = new Date(signal.signalTime.getTime() + hours * 60 * 60 * 1000);
  const candle = candles.find((candidate) => candidate.closeTime >= targetTime);
  if (!candle) return null;
  const close = toNumber(candle.close);
  if (close === null) return null;
  return round(((close - signal.entryPrice) / signal.entryPrice) * 100);
}

function calculateExcursion(signal: BacktestGeneratedSignal, candles: BacktestCandle[]) {
  let maxFavorableMove = 0;
  let maxAdverseMove = 0;
  let lastReturn = 0;
  const warning = signal.direction === "BEARISH" || signal.status === "AVOID";

  for (const candle of candles) {
    const high = toNumber(candle.high);
    const low = toNumber(candle.low);
    const close = toNumber(candle.close);
    if (high === null || low === null || close === null) continue;

    const favorable = warning
      ? ((signal.entryPrice - low) / signal.entryPrice) * 100
      : ((high - signal.entryPrice) / signal.entryPrice) * 100;
    const adverse = warning
      ? ((high - signal.entryPrice) / signal.entryPrice) * 100
      : ((signal.entryPrice - low) / signal.entryPrice) * 100;
    maxFavorableMove = Math.max(maxFavorableMove, favorable);
    maxAdverseMove = Math.max(maxAdverseMove, adverse);
    lastReturn = ((close - signal.entryPrice) / signal.entryPrice) * 100;
  }

  return {
    maxFavorableMove: round(maxFavorableMove),
    maxAdverseMove: round(maxAdverseMove),
    lastReturn: round(lastReturn)
  };
}

function findTargetOutcome(signal: BacktestGeneratedSignal, candles: BacktestCandle[]): BacktestOutcome | null {
  const warning = signal.direction === "BEARISH" || signal.status === "AVOID";
  for (const candle of candles) {
    const high = toNumber(candle.high);
    const low = toNumber(candle.low);
    if (high === null || low === null) continue;

    if (warning) {
      if (signal.targetPrice !== undefined && low <= signal.targetPrice) return "TARGET_REACHED";
      if (signal.invalidationPrice !== undefined && high >= signal.invalidationPrice) return "INVALIDATED";
    } else {
      if (signal.targetPrice !== undefined && high >= signal.targetPrice) return "TARGET_REACHED";
      if (signal.invalidationPrice !== undefined && low <= signal.invalidationPrice) return "INVALIDATED";
    }
  }
  return null;
}

function classifyDirectionalOutcome(signal: BacktestGeneratedSignal, directionalReturn: number | null): BacktestOutcome {
  if (directionalReturn === null) return "NEUTRAL";
  const warning = signal.direction === "BEARISH" || signal.status === "AVOID";
  if (warning) {
    if (directionalReturn <= -1) return "POSITIVE";
    if (directionalReturn >= 1) return "NEGATIVE";
    return "NEUTRAL";
  }
  if (directionalReturn >= 1) return "POSITIVE";
  if (directionalReturn <= -1) return "NEGATIVE";
  return "NEUTRAL";
}

function groupSummary(signals: BacktestEvaluatedSignal[], getKey: (signal: BacktestEvaluatedSignal) => string) {
  const groups = new Map<string, BacktestEvaluatedSignal[]>();
  for (const signal of signals) {
    const groupKey = getKey(signal);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), signal]);
  }
  return [...groups.entries()]
    .map(([groupKey, groupSignals]) => {
      const wins = groupSignals.filter(isPositiveOutcome).length;
      return {
        key: groupKey,
        totalSignals: groupSignals.length,
        evaluatedCount: groupSignals.length,
        winRate: groupSignals.length === 0 ? 0 : round((wins / groupSignals.length) * 100),
        avgReturnAfter1d: average(groupSignals.map((signal) => signal.returnAfter1d))
      };
    })
    .sort((left, right) => right.totalSignals - left.totalSignals || left.key.localeCompare(right.key));
}

function isPositiveOutcome(signal: BacktestEvaluatedSignal) {
  return signal.outcome === "POSITIVE" || signal.outcome === "TARGET_REACHED";
}

function groupCandles(candles: BacktestCandle[]) {
  const groups = new Map<string, BacktestCandle[]>();
  for (const candle of candles) {
    const groupKey = key(candle.assetId, candle.timeframe);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), candle]);
  }
  for (const [groupKey, groupCandles] of groups.entries()) {
    groups.set(groupKey, groupCandles.sort((left, right) => left.closeTime.getTime() - right.closeTime.getTime()));
  }
  return groups;
}

function key(assetId: string, timeframe: string) {
  return `${assetId}:${timeframe}`;
}

function toIndicatorCandle(candle: BacktestCandle): IndicatorCandle {
  return {
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
}

function mapAssetClass(assetType: BacktestAssetType): AssetClass {
  if (assetType === "CRYPTO") return "crypto";
  if (assetType === "ETF") return "etf";
  return "stock";
}

function scoreBucket(score: number) {
  if (score < 50) return "0-49";
  if (score < 65) return "50-64";
  if (score < 80) return "65-79";
  return "80-100";
}

function average(values: Array<number | null | undefined>) {
  const active = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (active.length === 0) return 0;
  return round(active.reduce((sum, value) => sum + value, 0) / active.length);
}

function toNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
