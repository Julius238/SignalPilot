/**
 * REGIME_PULLBACK_LONG ("Regime-Rücksetzer") — the first independent family
 * of the Evolution Engine (gates v4).
 *
 * Pre-registration: docs/trading/research/2026-10-16-evolution-family-regime-pullback-preregistration.md
 * (draft and derivation: 2026-10-15-evolution-family-regime-pullback-draft.md).
 *
 * Everything that decides what the family is — entry rules E1–E5, the fixed
 * price plan and exits, the closed parameter space, the seed genome and its
 * neighbours, the budget, the stages, the gate version, the split and the cost
 * model — is one frozen object here. Its `canonicalHash` is the family's
 * pre-registration hash: `FamilySpec.independence` carries it, every run
 * manifest records it, and `evaluate-seed` refuses to run when it no longer
 * equals the pinned value. Changing any of it needs a new pre-registration.
 *
 * Imports only the strategy engine and the domain hash (types aside), so the
 * genome module can build on it without an import cycle.
 */

import {
  CRYPTO_REGIME_LONG_V1_KEY,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
  REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
  REGIME_PULLBACK_RESEARCH_V1_KEY,
  REGIME_PULLBACK_RESEARCH_V1_RULES
} from "@signalpilot/strategy-engine";
import { canonicalHash } from "@signalpilot/trading-domain";

import type { ParameterSpec, ParameterValue } from "./genome.js";

export const REGIME_PULLBACK_FAMILY = "REGIME_PULLBACK_LONG" as const;
/** Pre-registered start of the family's lineage (generation 0, never a strategy of its own). */
export const REGIME_PULLBACK_SEED_KEY = "SEED:REGIME_PULLBACK_LONG_V1";

/** The closed parameter space: entry parameters only (240 configurations). */
export const REGIME_PULLBACK_PARAMETERS: readonly ParameterSpec[] = Object.freeze([
  Object.freeze({
    name: "pullbackLookbackHours",
    kind: "integer",
    description: "Fenster in geschlossenen 1h-Kerzen vor der Signalkerze, dessen höchstes Hoch den Rücksetzer bestimmt.",
    allowed: Object.freeze([24, 48, 72, 120, 168])
  } satisfies ParameterSpec),
  Object.freeze({
    name: "pullbackDepthAtr1d",
    kind: "decimal",
    description: "Mindesttiefe des Rücksetzers unter dem Fensterhoch, in ATR(14, 1d).",
    min: 0.75,
    max: 2.5,
    step: 0.25
  } satisfies ParameterSpec),
  Object.freeze({
    name: "requireReversalCandle",
    kind: "boolean",
    description: "Umkehrkerze verlangen: Schluss über Eröffnung und über dem Schluss der Vorkerze."
  } satisfies ParameterSpec),
  Object.freeze({
    name: "capitulationVolumeMinimum",
    kind: "decimal",
    description: "Mindestwert des höchsten relativen Volumens der letzten 6 Stunden-Kerzen (0 = aus).",
    allowed: Object.freeze([0, 2, 3])
  } satisfies ParameterSpec)
]);

/** Generation 1, fixed before any data was seen: 72 h window, 1.5 × ATR(1d), reversal candle, no volume filter. */
export const REGIME_PULLBACK_SEED_PARAMETERS: Readonly<Record<string, ParameterValue>> = Object.freeze({
  pullbackLookbackHours: 72,
  pullbackDepthAtr1d: "1.5",
  requireReversalCandle: true,
  capitulationVolumeMinimum: "0"
});

/** Pre-registered one-step neighbours of the seed for the final stage: depth 1.25 and 1.75, everything else equal. */
export const REGIME_PULLBACK_SEED_NEIGHBOUR_PARAMETERS: readonly Readonly<Record<string, ParameterValue>>[] = Object.freeze([
  Object.freeze({ ...REGIME_PULLBACK_SEED_PARAMETERS, pullbackDepthAtr1d: "1.25" }),
  Object.freeze({ ...REGIME_PULLBACK_SEED_PARAMETERS, pullbackDepthAtr1d: "1.75" })
]);

/** Stop, target and holding time of the whole family; the genome cannot reach them. */
export const REGIME_PULLBACK_FROZEN_EXITS = Object.freeze({
  stopAtrMultiple1d: REGIME_PULLBACK_RESEARCH_V1_RULES.stopAtrMultiple1d,
  takeProfitRMultiple: REGIME_PULLBACK_RESEARCH_V1_RULES.takeProfitRMultiple,
  minimumRewardRisk: REGIME_PULLBACK_RESEARCH_V1_RULES.minimumRewardRisk,
  maxHoldHours: REGIME_PULLBACK_RESEARCH_V1_RULES.maxHoldHours,
  regimeExit: REGIME_PULLBACK_RESEARCH_V1_RULES.regimeExit
});

/** Stricter than the gates-v3/v4 family limit (10 per month): validation exposure of this family. */
export const REGIME_PULLBACK_BUDGET = Object.freeze({
  maxScreeningsPerMonth: 4,
  maxScreeningsTotal: 9,
  maxHypothesesPerRun: 2,
  maxAiRunsPerMonth: 2
});

/** The pre-registered hypothesis of the seed (stored with the seed candidate instead of an AI hypothesis). */
export const REGIME_PULLBACK_SEED_HYPOTHESIS = Object.freeze({
  title: "Startgenom Regime-Rücksetzer (vorregistriert, ohne KI)",
  marketObservation:
    "In Krypto-Aufwärtsphasen ist viel Hebel im Markt; schnelle Rückgänge lösen Liquidationen und Margin-Verkäufe aus, also Verkäufe unabhängig vom Informationsstand.",
  rationale:
    "Wer in diesen Momenten Liquidität stellt, wird über eine kurzfristige, teilweise Umkehr bezahlt. Der Rücksetzer wird in Tagesvolatilität (ATR 1d) über ein kurzes Fenster gemessen, eine Umkehrkerze schützt vor dem Griff ins fallende Messer. Die Familie kennt kein Regime: Nur die unveränderte Risk Engine (R-020) lässt Einstiege bei RISK_ON zu.",
  expectedEffect:
    "Ein eigener kurzfristiger Ertrag an Tagen, an denen der Challenger nur Beta hält, bei geringer Kapitalbindung: Das Gesamtportfolio wird in der chronologischen Simulation bei gleichem Kapital nach Kosten besser (Vergleich B gegen A).",
  falsificationCriterion:
    "Scheitert das Startgenom an einer Screening-Prüfung von Gates v4, ist die Familie unter dieser Vorregistrierung geschlossen (F4); es gibt keine Rastersuche, um doch noch eine passende Konfiguration zu finden."
});

const parameterSpace = REGIME_PULLBACK_PARAMETERS.map((parameter) => ({
  name: parameter.name,
  kind: parameter.kind,
  ...(parameter.allowed !== undefined ? { allowed: [...parameter.allowed] } : {}),
  ...(parameter.min !== undefined ? { min: parameter.min, max: parameter.max, step: parameter.step } : {})
}));

/** Everything the pre-registration fixes; its hash is the family's pre-registration hash. */
export const REGIME_PULLBACK_LONG_V1_PREREGISTRATION = Object.freeze({
  key: "evolution-family-regime-pullback-long-v1",
  family: REGIME_PULLBACK_FAMILY,
  preregisteredOn: "2026-10-16",
  document: "docs/trading/research/2026-10-16-evolution-family-regime-pullback-preregistration.md",
  researchIdentity: { key: REGIME_PULLBACK_RESEARCH_V1_KEY, engineVersion: REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION },
  replayHull: {
    strategyKey: CRYPTO_REGIME_LONG_V1_KEY,
    specificationHash: CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
    regimeExit: false,
    role: "technical replay hull only (registry lookup and R-005); its evaluator is never called; never an attribution, never a forward approval"
  },
  entry: {
    E1: "(highest high of the pullbackLookbackHours closed 1h candles before C0 - close C0) / ATR(14, 1d) >= pullbackDepthAtr1d; C0 is not in the window",
    E2: "if requireReversalCandle: close C0 > open C0 and close C0 > close C-1",
    E3: "if capitulationVolumeMinimum > 0: highest relative volume of the last 6 closed 1h candles (C0 included, each against the mean of the 20 candles before it) >= minimum",
    E4: "a critical bearish context event blocks",
    E5: "validity 2 h, entry gap <= 0.5 x ATR(14, 1h)",
    regime: "no regime rule in the evaluator and no regime exit; R-020 of the unchanged risk engine alone"
  },
  fixedRules: REGIME_PULLBACK_RESEARCH_V1_RULES,
  frozenExits: REGIME_PULLBACK_FROZEN_EXITS,
  parameterSpace,
  gridSize: 240,
  maxChangesPerHypothesis: 3,
  seed: { key: REGIME_PULLBACK_SEED_KEY, generation: 1, parameters: REGIME_PULLBACK_SEED_PARAMETERS },
  seedNeighbours: REGIME_PULLBACK_SEED_NEIGHBOUR_PARAMETERS,
  budget: REGIME_PULLBACK_BUDGET,
  stages: {
    stage1: "the seed only, without AI (evolution evaluate-seed); a second run of the seed is refused",
    abort: "F4: the seed fails screening -> the family is closed under this pre-registration; no grid search",
    stage2: "only after the seed passed screening and a separate operator approval; parents are the seed candidate and family candidates that passed screening",
    forward: "never under the hull key; needs an own registered key and a separate decision on the risk engine's approved long keys"
  },
  sizing: "0.25 % risk per trade, risk engine mode SPEC, every risk rule unchanged",
  costModel: "BINANCE_SPOT_VIP0_ESTIMATE_V1",
  regimePolicy: "CRYPTO_NATIVE_V1",
  split: { key: "evolution-split-v1", hash: "838ce3bfe2ee7740f053435c3300337a4a7b3c4fbd1cb0fbcfbba88388e22f00" },
  gates: { version: "evolution-gates-v4", hash: "8f55cf8e14b9ca82923f2aae7bab4ed12c318e45c28f31c9f5e03e1ba054554c" },
  multipleTesting: { counter: "gates v3/v4 trials counter (30 prior training configurations + every configuration evaluated), never reset", atPreregistration: 52 },
  dataStatus: {
    inSample: "discovery 2018-04-01..2022-06-30 and validation 2022-07-01..2023-12-31 were analysed by earlier research (training study 2018-03..2023-12, 22 evolution configurations, regime study); no pullback rule was ever computed on them",
    holdout: "2024-01-01..2026-10-14 PREVIOUSLY_ANALYZED: a guard that can only stop, never evidence",
    forward: "from 2026-10-15 never replayed; the only clean evidence",
    languageModel: "BTC and ETH price history up to about mid-2026 is part of the prior knowledge of the language model that wrote the draft"
  }
});

export const REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH = canonicalHash(REGIME_PULLBACK_LONG_V1_PREREGISTRATION);

/** Pinned at the pre-registration (2026-10-16); the document and the tests carry the same value. */
export const REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH = "b96bcc97c4d6d1f9e2af5d66c896a0f3e233125934401292e694961421cf1c44";

/** Whether the code still matches the pinned pre-registration. */
export function regimePullbackPreregistrationIntact(): boolean {
  return REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH === REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH;
}

/** Specification hash of one genome of the family (research identity, never a registered strategy's hash). */
export function regimePullbackSpecificationHash(parameters: Readonly<Record<string, ParameterValue>>): string {
  return canonicalHash({
    researchKey: REGIME_PULLBACK_RESEARCH_V1_KEY,
    engineVersion: REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
    preregistrationHash: REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH,
    parameters
  });
}
