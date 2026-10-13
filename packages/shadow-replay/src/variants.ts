/**
 * Pre-registered research variants of the long breakout strategy.
 *
 * Each variant changes exactly the rules named in its rationale, chosen
 * BEFORE looking at real-data results (no tuning on the test period). They
 * exist only inside the replay: an identity with research overrides is never
 * registered or seeded as a StrategyVersion, so the live pipeline cannot run
 * one. A variant that looks better on TRAINING still has to hold up on TEST.
 */

import type { BreakoutResearchOverrides } from "@signalpilot/strategy-engine";

export interface StrategyVariant {
  readonly key: string;
  readonly label: string;
  readonly rationale: string;
  readonly overrides: BreakoutResearchOverrides;
}

const variant = (key: string, label: string, rationale: string, overrides: BreakoutResearchOverrides): StrategyVariant =>
  Object.freeze({ key, label, rationale, overrides: Object.freeze(overrides) });

export const STRATEGY_VARIANTS: Readonly<Record<string, StrategyVariant>> = Object.freeze({
  BASELINE: variant("BASELINE", "Spezifikation", "Unveränderte Regeln von CRYPTO_MTF_BREAKOUT_LONG_V1.", {}),
  WIDE_STOP: variant(
    "WIDE_STOP",
    "Stop ≥ 1,75 %",
    "Mindest-Stopabstand 1,75 % statt 0,75 %: unter realistischen Kosten erfüllt jeder Plan die Netto-2R-Regel (R-008 braucht ≥ 1,68 %); Positionsgröße sinkt entsprechend.",
    { stopDistanceFloorPct: "0.0175" }
  ),
  TP_3R: variant(
    "TP_3R",
    "Ziel 3R, Stop ≥ 1 %",
    "Ziel 3R statt 2,5R und Mindest-Stop 1 %: Netto-2R ab 0,84 % Stop erreichbar; weniger, aber größere Gewinner.",
    { takeProfitRMultiple: "3", stopDistanceFloorPct: "0.01" }
  ),
  NO_HTF_SIGNALS: variant(
    "NO_HTF_SIGNALS",
    "Ohne 4h/1d-Signale",
    "4h-/1d-Signalbestätigung und MTF-Alignment entfallen (SMA-Trendfilter auf 4h/1d bleiben): prüft, ob die dreifache Signal-Konjunktion zu restriktiv ist.",
    { skipHigherTimeframeSignals: true }
  ),
  PRICE_ONLY: variant(
    "PRICE_ONLY",
    "Nur Preisregeln",
    "Alle Signal-Engine-Bestätigungen entfallen; Trend-, Ausbruchs-, RSI-, Volumen-, ATR- und Regime-Regeln bleiben.",
    { skipOneHourSignal: true, skipHigherTimeframeSignals: true }
  ),
  RELAXED_ENTRY: variant(
    "RELAXED_ENTRY",
    "Volumen ≥ 1,2, RSI ≤ 78",
    "Relatives Volumen ab 1,2 statt 1,5 und RSI bis 78 statt 72: starke Ausbrüche haben oft hohen RSI.",
    { relativeVolumeMinimum: "1.2", rsiMaximum: "78" }
  ),
  NO_REGIME: variant(
    "NO_REGIME",
    "Ohne Regime-Filter",
    "Markt-Regime-Anforderung (RISK_ON ≥ 60) entfällt: misst den Beitrag des Regime-Filters.",
    { skipRegime: true }
  ),
  COMBINED: variant(
    "COMBINED",
    "Kombiniert",
    "Nur Preisregeln + Ziel 3R/Stop ≥ 1 % + Volumen ≥ 1,2/RSI ≤ 78.",
    {
      skipOneHourSignal: true,
      skipHigherTimeframeSignals: true,
      takeProfitRMultiple: "3",
      stopDistanceFloorPct: "0.01",
      relativeVolumeMinimum: "1.2",
      rsiMaximum: "78"
    }
  )
});
