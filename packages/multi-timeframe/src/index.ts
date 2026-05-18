import type {
  SignalDecisionDirection,
  SignalDecisionRiskLevel,
  SignalDecisionStatus,
  SignalDecisionType
} from "@signalpilot/shared";

export type MultiTimeframe = "1h" | "4h" | "1d";

export type MultiTimeframeAlignment =
  | "BULLISH_ALIGNED"
  | "BEARISH_ALIGNED"
  | "MIXED"
  | "SHORT_TERM_ONLY"
  | "HIGHER_TIMEFRAME_CONFIRMATION"
  | "CONFLICT"
  | "NO_EDGE";

export type MultiTimeframeSignalInput = {
  symbol: string;
  timeframe: string;
  status: SignalDecisionStatus;
  direction: SignalDecisionDirection;
  signalType: SignalDecisionType | string;
  score: number;
  riskLevel: SignalDecisionRiskLevel;
  riskScore?: number | null;
  createdAt: Date | string;
};

export type MultiTimeframeSignal = MultiTimeframeSignalInput & {
  timeframe: MultiTimeframe;
};

export type MultiTimeframeSummary = {
  symbol: string;
  alignment: MultiTimeframeAlignment;
  alignmentScore: number;
  primaryTimeframe: MultiTimeframe | null;
  confirmingTimeframes: MultiTimeframe[];
  conflictingTimeframes: MultiTimeframe[];
  strongestSignal: MultiTimeframeSignal | null;
  weakestSignal: MultiTimeframeSignal | null;
  riskLevel: SignalDecisionRiskLevel;
  summary: string;
  riskNote: string;
  nextFocus: string;
};

type TimeframeBias = "BULLISH" | "BEARISH" | "NEUTRAL";

type EvaluatedSignal = {
  signal: MultiTimeframeSignal;
  bias: TimeframeBias;
  strength: number;
  weightedScore: number;
};

const timeframes: MultiTimeframe[] = ["1d", "4h", "1h"];

const weights: Record<MultiTimeframe, number> = {
  "1d": 0.45,
  "4h": 0.35,
  "1h": 0.2
};

const statusStrength: Record<SignalDecisionStatus, number> = {
  STRONG_WATCH: 1,
  WATCH: 0.75,
  WAIT: 0.25,
  NO_EDGE: 0,
  AVOID: -1
};

export function calculateMultiTimeframeSummary(signals: MultiTimeframeSignalInput[]): MultiTimeframeSummary {
  const latestSignals = selectLatestSignals(signals);
  const evaluatedSignals = timeframes
    .map((timeframe) => latestSignals.get(timeframe))
    .filter((signal): signal is MultiTimeframeSignal => Boolean(signal))
    .map(evaluateSignal);

  const symbol = evaluatedSignals[0]?.signal.symbol ?? signals[0]?.symbol ?? "UNKNOWN";
  const strongestSignal = findStrongestSignal(evaluatedSignals);
  const weakestSignal = findWeakestSignal(evaluatedSignals);
  const riskLevel = determineRiskLevel(evaluatedSignals);
  const alignment = determineAlignment(evaluatedSignals);
  const primaryTimeframe = determinePrimaryTimeframe(evaluatedSignals, alignment);
  const confirmingTimeframes = determineConfirmingTimeframes(evaluatedSignals, primaryTimeframe);
  const conflictingTimeframes = determineConflictingTimeframes(evaluatedSignals, primaryTimeframe);
  const alignmentScore = calculateAlignmentScore(evaluatedSignals, alignment);
  const avoidSignals = evaluatedSignals.filter(({ signal }) => signal.status === "AVOID");

  return {
    symbol,
    alignment,
    alignmentScore,
    primaryTimeframe,
    confirmingTimeframes,
    conflictingTimeframes,
    strongestSignal,
    weakestSignal,
    riskLevel,
    summary: buildSummary(symbol, alignment, primaryTimeframe, confirmingTimeframes, conflictingTimeframes, evaluatedSignals),
    riskNote: buildRiskNote(riskLevel, avoidSignals, evaluatedSignals),
    nextFocus: buildNextFocus(alignment, primaryTimeframe, evaluatedSignals)
  };
}

function selectLatestSignals(signals: MultiTimeframeSignalInput[]): Map<MultiTimeframe, MultiTimeframeSignal> {
  const latestSignals = new Map<MultiTimeframe, MultiTimeframeSignal>();

  for (const signal of signals) {
    if (!isSupportedTimeframe(signal.timeframe)) {
      continue;
    }

    const current = latestSignals.get(signal.timeframe);
    if (!current || toTime(signal.createdAt) > toTime(current.createdAt)) {
      latestSignals.set(signal.timeframe, {
        ...signal,
        timeframe: signal.timeframe
      });
    }
  }

  return latestSignals;
}

function isSupportedTimeframe(timeframe: string): timeframe is MultiTimeframe {
  return timeframe === "1h" || timeframe === "4h" || timeframe === "1d";
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function evaluateSignal(signal: MultiTimeframeSignal): EvaluatedSignal {
  const strength = calculateStrength(signal);
  const bias = determineBias(signal);
  const directionMultiplier = bias === "BULLISH" ? 1 : bias === "BEARISH" ? -1 : 0;

  return {
    signal,
    bias,
    strength,
    weightedScore: directionMultiplier * strength * weights[signal.timeframe]
  };
}

function calculateStrength(signal: MultiTimeframeSignal): number {
  const scoreStrength = clamp(signal.score, 0, 100) / 100;
  const statusImpact = statusStrength[signal.status];

  if (statusImpact < 0) {
    return Math.max(0.7, scoreStrength);
  }

  return clamp(scoreStrength * 0.65 + statusImpact * 0.35, 0, 1);
}

function determineBias(signal: MultiTimeframeSignal): TimeframeBias {
  if (signal.status === "AVOID") {
    return "BEARISH";
  }

  if ((signal.timeframe === "1d" || signal.timeframe === "4h") && signal.riskLevel === "HIGH") {
    return signal.direction === "BULLISH" ? "NEUTRAL" : "BEARISH";
  }

  if (signal.status === "NO_EDGE") {
    return "NEUTRAL";
  }

  if (signal.direction === "BULLISH") {
    return "BULLISH";
  }

  if (signal.direction === "BEARISH") {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function determineAlignment(evaluatedSignals: EvaluatedSignal[]): MultiTimeframeAlignment {
  if (evaluatedSignals.length === 0 || isNoEdge(evaluatedSignals)) {
    return "NO_EDGE";
  }

  const daily = findEvaluation(evaluatedSignals, "1d");
  const fourHour = findEvaluation(evaluatedSignals, "4h");
  const oneHour = findEvaluation(evaluatedSignals, "1h");

  if (oneHour && isStrongBias(oneHour, "BULLISH") && hasHigherTimeframeBias(evaluatedSignals, "BEARISH")) {
    return "CONFLICT";
  }

  if (oneHour && isStrongBias(oneHour, "BEARISH") && hasHigherTimeframeBias(evaluatedSignals, "BULLISH")) {
    return "CONFLICT";
  }

  if (fourHour) {
    // 3-timeframe mode (crypto): require 1d and 4h agreement
    if (daily?.bias === "BULLISH" && fourHour.bias === "BULLISH" && oneHour?.bias !== "BEARISH") {
      return "BULLISH_ALIGNED";
    }

    if (daily?.bias === "BEARISH" && fourHour.bias === "BEARISH" && oneHour?.bias !== "BULLISH") {
      return "BEARISH_ALIGNED";
    }

    if (daily && oneHour && daily.bias === oneHour.bias && daily.bias !== "NEUTRAL" && fourHour.bias === "NEUTRAL") {
      return "HIGHER_TIMEFRAME_CONFIRMATION";
    }

    if (oneHour && oneHour.bias !== "NEUTRAL" && oneHour.strength >= 0.65 && daily?.bias !== oneHour.bias && fourHour.bias !== oneHour.bias) {
      return "SHORT_TERM_ONLY";
    }
  } else {
    // 2-timeframe mode (equity/ETF): 1d is the primary higher timeframe
    if (daily?.bias === "BULLISH" && oneHour?.bias !== "BEARISH") {
      return "BULLISH_ALIGNED";
    }

    if (daily?.bias === "BEARISH" && oneHour?.bias !== "BULLISH") {
      return "BEARISH_ALIGNED";
    }

    if (oneHour && oneHour.bias !== "NEUTRAL" && oneHour.strength >= 0.65 && daily?.bias !== oneHour.bias) {
      return "SHORT_TERM_ONLY";
    }
  }

  return "MIXED";
}

function isNoEdge(evaluatedSignals: EvaluatedSignal[]): boolean {
  return evaluatedSignals.every(({ signal }) => {
    const lowScore = signal.score <= 55;
    return lowScore && (signal.status === "NO_EDGE" || signal.status === "WAIT");
  });
}

function findEvaluation(evaluatedSignals: EvaluatedSignal[], timeframe: MultiTimeframe): EvaluatedSignal | undefined {
  return evaluatedSignals.find(({ signal }) => signal.timeframe === timeframe);
}

function isStrongBias(evaluation: EvaluatedSignal, bias: TimeframeBias): boolean {
  return evaluation.bias === bias && evaluation.strength >= 0.55;
}

function hasHigherTimeframeBias(evaluatedSignals: EvaluatedSignal[], bias: TimeframeBias): boolean {
  return evaluatedSignals.some(
    (evaluation) =>
      (evaluation.signal.timeframe === "1d" || evaluation.signal.timeframe === "4h") && isStrongBias(evaluation, bias)
  );
}

function determinePrimaryTimeframe(
  evaluatedSignals: EvaluatedSignal[],
  alignment: MultiTimeframeAlignment
): MultiTimeframe | null {
  if (alignment === "NO_EDGE") {
    return null;
  }

  if (alignment === "SHORT_TERM_ONLY") {
    return findEvaluation(evaluatedSignals, "1h")?.signal.timeframe ?? null;
  }

  return timeframes.find((timeframe) => {
    const evaluation = findEvaluation(evaluatedSignals, timeframe);
    return evaluation && evaluation.bias !== "NEUTRAL";
  }) ?? strongestByTimeframeWeight(evaluatedSignals)?.signal.timeframe ?? null;
}

function determineConfirmingTimeframes(
  evaluatedSignals: EvaluatedSignal[],
  primaryTimeframe: MultiTimeframe | null
): MultiTimeframe[] {
  if (!primaryTimeframe) {
    return [];
  }

  const primary = findEvaluation(evaluatedSignals, primaryTimeframe);
  if (!primary || primary.bias === "NEUTRAL") {
    return [];
  }

  return evaluatedSignals
    .filter((evaluation) => evaluation.signal.timeframe !== primaryTimeframe && evaluation.bias === primary.bias)
    .map(({ signal }) => signal.timeframe);
}

function determineConflictingTimeframes(
  evaluatedSignals: EvaluatedSignal[],
  primaryTimeframe: MultiTimeframe | null
): MultiTimeframe[] {
  if (!primaryTimeframe) {
    return [];
  }

  const primary = findEvaluation(evaluatedSignals, primaryTimeframe);
  if (!primary || primary.bias === "NEUTRAL") {
    return [];
  }

  return evaluatedSignals
    .filter(
      (evaluation) =>
        evaluation.signal.timeframe !== primaryTimeframe &&
        evaluation.bias !== "NEUTRAL" &&
        evaluation.bias !== primary.bias
    )
    .map(({ signal }) => signal.timeframe);
}

function calculateAlignmentScore(
  evaluatedSignals: EvaluatedSignal[],
  alignment: MultiTimeframeAlignment
): number {
  if (alignment === "NO_EDGE" || evaluatedSignals.length === 0) {
    return 0;
  }

  const availableWeight = evaluatedSignals.reduce((total, { signal }) => total + weights[signal.timeframe], 0);
  const weightedDirection = evaluatedSignals.reduce((total, evaluation) => total + evaluation.weightedScore, 0);
  const normalizedDirection = Math.abs(weightedDirection) / availableWeight;
  const baseScore = normalizedDirection * 100;
  const conflictPenalty = alignment === "CONFLICT" ? 25 : 0;
  const shortTermPenalty = alignment === "SHORT_TERM_ONLY" ? 15 : 0;

  return Math.round(clamp(baseScore - conflictPenalty - shortTermPenalty, 0, 100));
}

function determineRiskLevel(evaluatedSignals: EvaluatedSignal[]): SignalDecisionRiskLevel {
  if (
    evaluatedSignals.some(
      ({ signal }) => (signal.timeframe === "1d" || signal.timeframe === "4h") && signal.riskLevel === "HIGH"
    )
  ) {
    return "HIGH";
  }

  if (evaluatedSignals.some(({ signal }) => signal.riskLevel === "HIGH")) {
    return "HIGH";
  }

  if (evaluatedSignals.some(({ signal }) => signal.riskLevel === "MEDIUM")) {
    return "MEDIUM";
  }

  return "LOW";
}

function findStrongestSignal(evaluatedSignals: EvaluatedSignal[]): MultiTimeframeSignal | null {
  return strongestByTimeframeWeight(evaluatedSignals)?.signal ?? null;
}

function findWeakestSignal(evaluatedSignals: EvaluatedSignal[]): MultiTimeframeSignal | null {
  return [...evaluatedSignals].sort((left, right) => {
    const strengthDifference = left.strength - right.strength;
    return strengthDifference === 0 ? weights[right.signal.timeframe] - weights[left.signal.timeframe] : strengthDifference;
  })[0]?.signal ?? null;
}

function strongestByTimeframeWeight(evaluatedSignals: EvaluatedSignal[]): EvaluatedSignal | undefined {
  return [...evaluatedSignals].sort((left, right) => {
    const strengthDifference = right.strength - left.strength;
    return strengthDifference === 0 ? weights[right.signal.timeframe] - weights[left.signal.timeframe] : strengthDifference;
  })[0];
}

function buildSummary(
  symbol: string,
  alignment: MultiTimeframeAlignment,
  primaryTimeframe: MultiTimeframe | null,
  confirmingTimeframes: MultiTimeframe[],
  conflictingTimeframes: MultiTimeframe[],
  evaluatedSignals: EvaluatedSignal[]
): string {
  const has4h = evaluatedSignals.some(({ signal }) => signal.timeframe === "4h");
  const primaryText = primaryTimeframe ? `${primaryTimeframe} ist der fuehrende Timeframe` : "kein fuehrender Timeframe";
  const confirmationText =
    confirmingTimeframes.length > 0 ? ` Bestaetigung kommt von ${confirmingTimeframes.join(", ")}.` : "";
  const conflictText =
    conflictingTimeframes.length > 0 ? ` Konflikt kommt von ${conflictingTimeframes.join(", ")}.` : "";

  switch (alignment) {
    case "BULLISH_ALIGNED":
      return has4h
        ? `${symbol}: 1d und 4h sind konstruktiv ausgerichtet; ${primaryText}.${confirmationText}${conflictText}`
        : `${symbol}: 1d gibt die konstruktive Richtung vor; ${primaryText}.${confirmationText}${conflictText}`;
    case "BEARISH_ALIGNED":
      return has4h
        ? `${symbol}: 1d und 4h zeigen eine defensive Ausrichtung; ${primaryText}.${confirmationText}${conflictText}`
        : `${symbol}: 1d zeigt eine defensive Ausrichtung; ${primaryText}.${confirmationText}${conflictText}`;
    case "HIGHER_TIMEFRAME_CONFIRMATION":
      return has4h
        ? `${symbol}: 1d gibt die Richtung vor, 4h ist neutral, 1h liefert den kurzfristigen Trigger.`
        : `${symbol}: 1d gibt die Richtung vor, 1h liefert den kurzfristigen Trigger.`;
    case "SHORT_TERM_ONLY":
      return has4h
        ? `${symbol}: Das Signal liegt vor allem im 1h-Chart; 4h und 1d bestaetigen es noch nicht.`
        : `${symbol}: Das Signal liegt vor allem im 1h-Chart; 1d bestaetigt es noch nicht.`;
    case "CONFLICT":
      return `${symbol}: Die Timeframes widersprechen sich. ${primaryText}.${conflictText}`;
    case "NO_EDGE":
      return `${symbol}: Ueber die beobachteten Timeframes liegt aktuell kein belastbarer Vorteil vor.`;
    case "MIXED":
      return `${symbol}: Die Timeframes liefern verwertbare, aber nicht einheitliche Signale. ${primaryText}.${confirmationText}${conflictText}`;
  }
}

function buildRiskNote(
  riskLevel: SignalDecisionRiskLevel,
  avoidSignals: EvaluatedSignal[],
  evaluatedSignals: EvaluatedSignal[]
): string {
  if (avoidSignals.length > 0) {
    const timeframesText = avoidSignals.map(({ signal }) => signal.timeframe).join(", ");
    return `AVOID auf ${timeframesText}: Risiko hat Vorrang vor Alignment. Gesamt-Risiko: ${riskLevel}.`;
  }

  const highHigherTimeframe = evaluatedSignals.find(
    ({ signal }) => (signal.timeframe === "1d" || signal.timeframe === "4h") && signal.riskLevel === "HIGH"
  );

  if (highHigherTimeframe) {
    return `${highHigherTimeframe.signal.timeframe} meldet HIGH Risk; Gesamt-Risiko bleibt mindestens HIGH.`;
  }

  return `Gesamt-Risiko ist ${riskLevel}. Keine AVOID-Warnung in den beruecksichtigten Timeframes.`;
}

function buildNextFocus(
  alignment: MultiTimeframeAlignment,
  primaryTimeframe: MultiTimeframe | null,
  evaluatedSignals: EvaluatedSignal[]
): string {
  const has4h = evaluatedSignals.some(({ signal }) => signal.timeframe === "4h");

  if (alignment === "NO_EDGE") {
    return has4h
      ? "Als naechstes 4h und 1d auf ein staerkeres Signal beobachten."
      : "Als naechstes 1d auf ein staerkeres Signal beobachten.";
  }

  if (alignment === "SHORT_TERM_ONLY") {
    return has4h
      ? "Als naechstes 4h beobachten, ob der kurzfristige 1h-Trigger bestaetigt wird."
      : "Als naechstes 1d beobachten, ob der kurzfristige 1h-Trigger bestaetigt wird.";
  }

  if (alignment === "CONFLICT") {
    return has4h
      ? "Als naechstes 1d und 4h beobachten, bis der Konflikt zum 1h-Trigger aufgeloest ist."
      : "Als naechstes 1d beobachten, bis der Konflikt zum 1h-Trigger aufgeloest ist.";
  }

  const missingTimeframe = timeframes.find(
    (timeframe) => !findEvaluation(evaluatedSignals, timeframe) && (has4h || timeframe !== "4h")
  );
  if (missingTimeframe) {
    return `Als naechstes ${missingTimeframe} aktualisieren, um die Multi-Timeframe-Lage zu vervollstaendigen.`;
  }

  if (primaryTimeframe === "1d") {
    return has4h
      ? "Als naechstes 4h beobachten, ob die hoehere Timeframe-Lage weiter bestaetigt wird."
      : "Als naechstes 1h beobachten, ob die hoehere Timeframe-Lage weiter bestaetigt wird.";
  }

  return `Als naechstes ${primaryTimeframe ?? (has4h ? "4h" : "1h")} beobachten und die 1d-Lage als Kontext halten.`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
