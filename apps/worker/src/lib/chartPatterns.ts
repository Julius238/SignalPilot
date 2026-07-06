import {
  buildIndicatorSnapshot,
  calculateRSI,
  type IndicatorCandle
} from "@signalpilot/indicators";

// Chart-Pattern-Radar: erkennt beobachtenswerte Konstellationen aus Kerzendaten.
// Bewusst einfache, deterministische Definitionen — jede Beobachtung nennt ihre
// Messwerte. Formulierungen sind Research-Hinweise ("möglicher Ausbruchsbereich",
// "Nähe Widerstandsbereich"), niemals Handlungsempfehlungen.

export type ChartPatternSettings = {
  // Nähe zum 20-Perioden-Extrem in Prozent, ab der ein Bereich als "nah" gilt
  proximityPercent: number;
  // Ab diesem relativen Volumen wird aus SR-Nähe ein möglicher Ausbruchsbereich
  breakoutMinRelativeVolume: number;
  // RSI-Mittellinie für Momentum-Wechsel
  momentumRsiMidline: number;
  // Mindestabstand von der Mittellinie nach der Kreuzung (verhindert Flattern)
  momentumConfirmBand: number;
  // Ab so vielen gleichzeitigen Beobachtungen entsteht ein Konfluenz-Ereignis
  confluenceMinObservations: number;
};

export const defaultChartPatternSettings: ChartPatternSettings = {
  proximityPercent: 1.5,
  breakoutMinRelativeVolume: 1.5,
  momentumRsiMidline: 50,
  momentumConfirmBand: 3,
  confluenceMinObservations: 3
};

export type ChartPatternType =
  | "BREAKOUT_PROXIMITY"
  | "SR_PROXIMITY"
  | "MOMENTUM_SHIFT"
  | "CONFLUENCE";

export type ChartPatternSeverity = "INFO" | "WATCH" | "IMPORTANT" | "CRITICAL";

export type ChartPatternObservation = {
  patternType: ChartPatternType;
  direction: "UP" | "DOWN" | "NEUTRAL";
  severity: ChartPatternSeverity;
  score: number;
  shortMessage: string;
  factorLabel: string;
  details: Record<string, number | string | null>;
};

export function evaluateChartPatterns(
  symbol: string,
  timeframe: string,
  candles: readonly IndicatorCandle[],
  settingsOverride: Partial<ChartPatternSettings> = {},
  baseObservations: string[] = []
): ChartPatternObservation[] {
  const settings = { ...defaultChartPatternSettings, ...settingsOverride };
  const snapshot = buildIndicatorSnapshot(candles);
  const observations: ChartPatternObservation[] = [];

  if (
    snapshot.lastClose === null ||
    snapshot.periodHigh20 === null ||
    snapshot.periodLow20 === null ||
    snapshot.periodHigh20 <= 0 ||
    snapshot.periodLow20 <= 0
  ) {
    return observations;
  }

  const distanceToHighPercent = roundPercent(
    ((snapshot.periodHigh20 - snapshot.lastClose) / snapshot.periodHigh20) * 100
  );
  const distanceToLowPercent = roundPercent(
    ((snapshot.lastClose - snapshot.periodLow20) / snapshot.periodLow20) * 100
  );
  const nearHigh = distanceToHighPercent <= settings.proximityPercent;
  const nearLow = distanceToLowPercent <= settings.proximityPercent;
  const relativeVolume = snapshot.relativeVolume;
  const volumeConfirmed =
    relativeVolume !== null && relativeVolume >= settings.breakoutMinRelativeVolume;

  // Beidseitige Nähe bedeutet nur eine extrem enge 20-Perioden-Range —
  // daraus lässt sich keine Richtung ableiten, also keine Beobachtung.
  if (nearHigh !== nearLow) {
    if (nearHigh) {
      observations.push(
        buildProximityObservation({
          symbol,
          timeframe,
          direction: "UP",
          distancePercent: distanceToHighPercent,
          relativeVolume,
          volumeConfirmed,
          settings
        })
      );
    } else {
      observations.push(
        buildProximityObservation({
          symbol,
          timeframe,
          direction: "DOWN",
          distancePercent: distanceToLowPercent,
          relativeVolume,
          volumeConfirmed,
          settings
        })
      );
    }
  }

  const momentum = detectMomentumShift(symbol, timeframe, candles, settings);

  if (momentum) {
    observations.push(momentum);
  }

  const confluenceFactors = [
    ...baseObservations,
    ...observations.map((observation) => observation.factorLabel)
  ];

  if (confluenceFactors.length >= settings.confluenceMinObservations) {
    observations.push({
      patternType: "CONFLUENCE",
      direction: "NEUTRAL",
      severity: confluenceFactors.length >= settings.confluenceMinObservations + 1 ? "CRITICAL" : "IMPORTANT",
      score: Math.min(100, confluenceFactors.length * 25),
      shortMessage: `${symbol}: mehrere Faktoren gleichzeitig auffällig (${confluenceFactors.join(", ")}) im ${timeframe} Markt-Radar.`,
      factorLabel: "Konfluenz",
      details: {
        factorCount: confluenceFactors.length,
        factors: confluenceFactors.join(", ")
      }
    });
  }

  return observations;
}

function buildProximityObservation(input: {
  symbol: string;
  timeframe: string;
  direction: "UP" | "DOWN";
  distancePercent: number;
  relativeVolume: number | null;
  volumeConfirmed: boolean;
  settings: ChartPatternSettings;
}): ChartPatternObservation {
  const { symbol, timeframe, direction, distancePercent, relativeVolume, volumeConfirmed, settings } =
    input;
  const boundaryLabel = direction === "UP" ? "20-Perioden-Hoch" : "20-Perioden-Tief";
  const relationLabel = direction === "UP" ? "unter" : "über";

  if (volumeConfirmed) {
    const strongVolume =
      relativeVolume !== null && relativeVolume >= settings.breakoutMinRelativeVolume * 2;

    return {
      patternType: "BREAKOUT_PROXIMITY",
      direction,
      severity: strongVolume ? "IMPORTANT" : "WATCH",
      score: Math.min(
        100,
        Math.round(
          ((relativeVolume ?? settings.breakoutMinRelativeVolume) / settings.breakoutMinRelativeVolume) * 40
        )
      ),
      shortMessage: `${symbol}: möglicher Ausbruchsbereich ${direction === "UP" ? "oberhalb" : "unterhalb"} — ${distancePercent}% ${relationLabel} ${boundaryLabel}, Volumen ${relativeVolume}x im ${timeframe} Markt-Radar.`,
      factorLabel: "möglicher Ausbruchsbereich",
      details: {
        distancePercent,
        relativeVolume,
        boundary: boundaryLabel
      }
    };
  }

  return {
    patternType: "SR_PROXIMITY",
    direction,
    severity: "INFO",
    score: Math.max(10, Math.round((settings.proximityPercent - distancePercent) * 20)),
    shortMessage: `${symbol}: Nähe ${direction === "UP" ? "Widerstandsbereich" : "Unterstützungsbereich"} — ${distancePercent}% ${relationLabel} ${boundaryLabel} im ${timeframe} Markt-Radar.`,
    factorLabel: direction === "UP" ? "Nähe Widerstandsbereich" : "Nähe Unterstützungsbereich",
    details: {
      distancePercent,
      relativeVolume,
      boundary: boundaryLabel
    }
  };
}

function detectMomentumShift(
  symbol: string,
  timeframe: string,
  candles: readonly IndicatorCandle[],
  settings: ChartPatternSettings
): ChartPatternObservation | null {
  const closes = candles.map((candle) => candle.close);
  const currentRsi = calculateRSI(closes, 14);
  const previousRsi = calculateRSI(closes.slice(0, -1), 14);

  if (currentRsi === null || previousRsi === null) {
    return null;
  }

  const midline = settings.momentumRsiMidline;
  const upperConfirm = midline + settings.momentumConfirmBand;
  const lowerConfirm = midline - settings.momentumConfirmBand;
  let direction: "UP" | "DOWN" | null = null;

  if (previousRsi < midline && currentRsi >= upperConfirm) {
    direction = "UP";
  } else if (previousRsi > midline && currentRsi <= lowerConfirm) {
    direction = "DOWN";
  }

  if (!direction) {
    return null;
  }

  const strength = Math.abs(currentRsi - midline);

  return {
    patternType: "MOMENTUM_SHIFT",
    direction,
    severity: strength >= 12 ? "IMPORTANT" : "WATCH",
    score: Math.min(100, Math.round(strength * 6)),
    shortMessage: `${symbol}: Momentum-Wechsel ${direction === "UP" ? "aufwärts" : "abwärts"} — RSI ${roundValue(previousRsi)} → ${roundValue(currentRsi)} im ${timeframe} Markt-Radar.`,
    factorLabel: `Momentum-Wechsel ${direction === "UP" ? "aufwärts" : "abwärts"}`,
    details: {
      previousRsi: roundValue(previousRsi),
      currentRsi: roundValue(currentRsi)
    }
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundValue(value: number): number {
  return Math.round(value * 10) / 10;
}
