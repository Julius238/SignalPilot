/**
 * Candidate genomes: the only thing the Evolution Engine V1 lets an AI change.
 *
 * A genome is a complete, closed parameter set of one strategy family. It is
 * data, never code: every value is checked against a fixed grid, unknown
 * parameters are refused, and costs, fills, sizing, risk rules and data
 * windows are not part of the space at all. A genome compiles into a research
 * identity of an already registered evaluator (the same research-override
 * mechanism the 2026-10-14 replay research used), so a candidate is always
 * executable by the existing backtest and never by the live pipeline.
 *
 * An independent family (gates v4, `FamilySpec.independence`) brings its own
 * entry evaluator instead: the registered strategy is only the replay hull
 * (registry lookup, R-005), its evaluator is never called and its regime exit
 * is switched off; the research identity labels every result.
 */

import {
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_NATIVE_REGIME_SOURCE,
  CRYPTO_REGIME_LONG_V1_KEY,
  CRYPTO_REGIME_LONG_V1_PARAMETERS,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_TREND_CORE_LONG_V1_KEY,
  CRYPTO_TREND_CORE_LONG_V1_PARAMETERS,
  CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH,
  LONG_V1_BREAKOUT_IDENTITY,
  REGIME_LONG_V1_IDENTITY,
  REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
  REGIME_PULLBACK_RESEARCH_V1_KEY,
  TREND_CORE_LONG_V1_BREAKOUT_IDENTITY,
  evaluateCryptoMtfBreakoutV1,
  evaluateCryptoRegimeLongV1,
  evaluateRegimePullbackResearchV1,
  regimeGateOpen,
  type BreakoutResearchOverrides,
  type RegimePullbackResearchIdentityV1,
  type StrategyEvaluationResultV1,
  type StrategyInputSnapshotV1
} from "@signalpilot/strategy-engine";
import type { RegimePolicy, ReplayHooks, ReplayMode } from "@signalpilot/shadow-replay";
import { canonicalHash } from "@signalpilot/trading-domain";

import { minimumStopDistanceForNet2R } from "./costs.js";
import {
  REGIME_PULLBACK_BUDGET,
  REGIME_PULLBACK_FROZEN_EXITS,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH,
  REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH,
  REGIME_PULLBACK_PARAMETERS,
  REGIME_PULLBACK_SEED_HYPOTHESIS,
  REGIME_PULLBACK_SEED_KEY,
  REGIME_PULLBACK_SEED_NEIGHBOUR_PARAMETERS,
  REGIME_PULLBACK_SEED_PARAMETERS,
  regimePullbackSpecificationHash
} from "./family-regime-pullback.js";

export type EvolutionFamily = "BREAKOUT_LONG" | "REGIME_LONG" | "REGIME_PULLBACK_LONG";
export const EVOLUTION_FAMILIES: readonly EvolutionFamily[] = Object.freeze(["BREAKOUT_LONG", "REGIME_LONG", "REGIME_PULLBACK_LONG"]);

export type ParameterValue = string | number | boolean;

export interface ParameterSpec {
  readonly name: string;
  readonly kind: "decimal" | "integer" | "boolean";
  /** German one-liner shown to the AI and in the dashboard. */
  readonly description: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Explicit value set (wins over min/max/step). */
  readonly allowed?: readonly number[];
}

/**
 * Declaration of an independent family (gates v4): its own entry evaluator,
 * entry parameters only, exits fixed in the family, its own research identity
 * and pre-registration. A family without it is decided by the v3 lineage
 * rule; REGIME_PULLBACK_LONG is the first family that declares it.
 */
export interface FamilyIndependence {
  /** Engine version of the family's own entry evaluator. */
  readonly entryEvaluator: string;
  /** The identity every stored row carries (the replay hull is recorded separately). */
  readonly researchIdentity: string;
  /** Stop, target and holding time, fixed for the whole family. */
  readonly frozenExits: Readonly<Record<string, string | number | boolean>>;
  /** Hash of the family's pre-registration document. */
  readonly preregistrationHash: string;
}

export interface FamilySpec {
  readonly family: EvolutionFamily;
  readonly label: string;
  readonly description: string;
  /** Registered evaluator the genome runs under as a research identity. */
  readonly replayStrategyKey: string;
  readonly parameters: readonly ParameterSpec[];
  /** Present only for an independent family (gates v4 portfolio path). */
  readonly independence?: FamilyIndependence;
}

/** Parameter names that change exits; an independent family may not search them. */
export const EXIT_PARAMETER_NAMES: ReadonlySet<string> = new Set([
  "stopAtrMultiple",
  "stopAtrMultiple1d",
  "stopDistanceFloorPct",
  "stopDistanceCapPct",
  "takeProfitRMultiple",
  "maxHoldHours",
  "exitOnRegimeGateClosed"
]);

/** The structural facts gates v4 checks (`INDEPENDENT_FAMILY`), read from the family specification. */
export function independentFamilyStructure(spec: FamilySpec): {
  readonly declaredIndependent: boolean;
  readonly entryParametersOnly: boolean;
  readonly exitsFrozen: boolean;
  readonly ownEntryEvaluator: boolean;
  readonly preregistrationHash: string | null;
} {
  const independence = spec.independence;
  return {
    declaredIndependent: independence !== undefined,
    entryParametersOnly: independence !== undefined && spec.parameters.every((parameter) => !EXIT_PARAMETER_NAMES.has(parameter.name)),
    exitsFrozen: independence !== undefined && Object.keys(independence.frozenExits).length > 0,
    ownEntryEvaluator: independence !== undefined && independence.entryEvaluator.trim() !== "",
    preregistrationHash: independence?.preregistrationHash ?? null
  };
}

const decimal = (name: string, description: string, min: number, max: number, step: number): ParameterSpec =>
  Object.freeze({ name, kind: "decimal", description, min, max, step });
const integer = (name: string, description: string, min: number, max: number, step: number): ParameterSpec =>
  Object.freeze({ name, kind: "integer", description, min, max, step });
const boolean = (name: string, description: string): ParameterSpec => Object.freeze({ name, kind: "boolean", description });

export const FAMILY_SPECS: Readonly<Record<EvolutionFamily, FamilySpec>> = Object.freeze({
  BREAKOUT_LONG: Object.freeze({
    family: "BREAKOUT_LONG",
    label: "Breakout-Long",
    description:
      "Long-Einstieg beim Schluss über dem Hoch der letzten N Stunden-Kerzen, SMA-Trendfilter 1h/4h/1d, crypto-natives Regime; Stop aus ATR(1h) mit Boden und Kappe, festes R-Ziel, Haltedauer-Limit. Familie des Champions CRYPTO_TREND_CORE_LONG_V1.",
    replayStrategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
    parameters: Object.freeze([
      boolean("skipOneHourSignal", "1h-Signal-Engine-Bestätigung auslassen (nur Preisregeln)."),
      boolean("skipHigherTimeframeSignals", "4h/1d-Signalbestätigung und MTF-Ausrichtung auslassen (SMA-Trendfilter bleiben)."),
      boolean("skipRegime", "Regime-Anforderung (crypto RISK_ON) komplett auslassen."),
      integer("regimeMinimumConfidence", "Mindest-Konfidenz des crypto-nativen Regimes für einen Einstieg.", 40, 90, 5),
      integer("breakoutLookback", "Anzahl geschlossener 1h-Kerzen, deren Hoch überschritten werden muss.", 10, 60, 5),
      decimal("relativeVolumeMinimum", "Mindest-Volumen der Signalkerze relativ zum Schnitt der letzten 20 (0 = aus).", 0, 2.5, 0.1),
      integer("rsiMinimum", "Untergrenze RSI(14, 1h) (0 = aus).", 0, 70, 5),
      integer("rsiMaximum", "Obergrenze RSI(14, 1h) (100 = aus).", 55, 100, 5),
      decimal("atrToCloseMinimum", "Untergrenze ATR(14, 1h)/Schluss (0 = aus).", 0, 0.02, 0.0025),
      Object.freeze({
        name: "atrToCloseMaximum",
        kind: "decimal",
        description: "Obergrenze ATR(14, 1h)/Schluss (1 = aus).",
        allowed: Object.freeze([0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 1])
      } satisfies ParameterSpec),
      decimal("stopAtrMultiple", "Stopabstand als Vielfaches von ATR(14, 1h).", 1, 4, 0.25),
      decimal("stopDistanceFloorPct", "Mindest-Stopabstand als Anteil des Einstiegs.", 0.0075, 0.04, 0.0025),
      decimal("stopDistanceCapPct", "Höchster Stopabstand als Anteil des Einstiegs (darüber kein Trade).", 0.02, 0.1, 0.01),
      decimal("takeProfitRMultiple", "Brutto-Ziel als Vielfaches des Stopabstands.", 2.5, 6, 0.25),
      integer("maxHoldHours", "Zeit-Exit nach so vielen Stunden.", 24, 336, 24)
    ])
  }),
  REGIME_LONG: Object.freeze({
    family: "REGIME_LONG",
    label: "Regime-Long",
    description:
      "Long, solange das crypto-native Regime-Gate offen ist (RISK_ON, kein DEFENSIVE/HIGH_RISK, Konfidenz ≥ Minimum); Schutz-Stop aus ATR(1d), festes R-Ziel, optional Exit bei geschlossenem Gate, Haltedauer-Backstop. Familie des Challengers CRYPTO_REGIME_LONG_V1.",
    replayStrategyKey: CRYPTO_REGIME_LONG_V1_KEY,
    parameters: Object.freeze([
      integer("regimeMinimumConfidence", "Mindest-Konfidenz des Regimes für Einstieg und Verbleib.", 40, 90, 5),
      decimal("stopAtrMultiple1d", "Schutz-Stop als Vielfaches von ATR(14, 1d).", 1, 4, 0.25),
      decimal("takeProfitRMultiple", "Brutto-Ziel als Vielfaches des Stopabstands.", 2.5, 10, 0.5),
      integer("maxHoldHours", "Zeit-Backstop in Stunden.", 168, 1440, 24),
      boolean("exitOnRegimeGateClosed", "Position schließen, sobald das Regime-Gate schließt.")
    ])
  }),
  REGIME_PULLBACK_LONG: Object.freeze({
    family: "REGIME_PULLBACK_LONG",
    label: "Regime-Rücksetzer",
    description:
      "Eigenständige Familie: kauft einen Rücksetzer von mindestens N × ATR(14, 1d) unter dem Hoch der letzten Stunden-Kerzen, optional mit Umkehrkerze und Kapitulationsvolumen; eigener Einstiegs-Evaluator ohne Regime-Regel (nur R-020 der Risk Engine). Feste Ausstiege: Stop 2 × ATR(1d), Ziel 4R, 72 h, kein Regime-Exit. Nur Einstiegsparameter sind veränderbar.",
    // Replay hull only (registry lookup, R-005); its evaluator and regime exit are never used.
    replayStrategyKey: CRYPTO_REGIME_LONG_V1_KEY,
    parameters: REGIME_PULLBACK_PARAMETERS,
    independence: Object.freeze({
      entryEvaluator: REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
      researchIdentity: REGIME_PULLBACK_RESEARCH_V1_KEY,
      frozenExits: REGIME_PULLBACK_FROZEN_EXITS,
      preregistrationHash: REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH
    })
  })
});

export interface CandidateGenome {
  readonly family: EvolutionFamily;
  /** Complete, normalised parameter set (every parameter of the family). */
  readonly parameters: Readonly<Record<string, ParameterValue>>;
}

export interface ParameterChange {
  readonly parameter: string;
  readonly value: string;
}

/** The registered, frozen strategies every lineage starts from (generation 0). */
export interface EvolutionRoot {
  readonly key: string;
  readonly label: string;
  readonly role: "CHAMPION" | "CHALLENGER";
  readonly strategyKey: string;
  readonly specificationHash: string;
  readonly genome: CandidateGenome;
}

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** Canonical decimal text: no exponent, no trailing zeros ("0.0175", "3", "0"). */
export function normalizeDecimal(value: string | number): string {
  const text = typeof value === "number" ? value.toFixed(10) : value.trim();
  if (!DECIMAL_PATTERN.test(text)) throw new Error(`Not a plain decimal: ${String(value)}`);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const result = trimmed.length > 0 ? `${whole}.${trimmed}` : whole!;
  return negative && result !== "0" ? `-${result}` : result;
}

const TREND_CORE_RULES = TREND_CORE_LONG_V1_BREAKOUT_IDENTITY.rules!;

export const EVOLUTION_ROOTS: readonly EvolutionRoot[] = Object.freeze([
  Object.freeze({
    key: `ROOT:${CRYPTO_TREND_CORE_LONG_V1_KEY}`,
    label: "CRYPTO_TREND_CORE_LONG_V1 (Champion)",
    role: "CHAMPION",
    strategyKey: CRYPTO_TREND_CORE_LONG_V1_KEY,
    specificationHash: CRYPTO_TREND_CORE_LONG_V1_SPECIFICATION_HASH,
    genome: Object.freeze({
      family: "BREAKOUT_LONG",
      parameters: Object.freeze({
        skipOneHourSignal: TREND_CORE_RULES.skipOneHourSignal === true,
        skipHigherTimeframeSignals: TREND_CORE_RULES.skipHigherTimeframeSignals === true,
        skipRegime: false,
        regimeMinimumConfidence: CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.regimeMinimumConfidence,
        breakoutLookback: CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.breakoutLookback,
        relativeVolumeMinimum: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.relativeVolumeMinimum),
        rsiMinimum: Number(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.rsiMinimum),
        rsiMaximum: Number(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.rsiMaximum),
        atrToCloseMinimum: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.atrToCloseMinimum),
        atrToCloseMaximum: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.atrToCloseMaximum),
        stopAtrMultiple: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.stopAtrMultiple),
        stopDistanceFloorPct: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.stopDistanceFloorPct),
        stopDistanceCapPct: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.stopDistanceCapPct),
        takeProfitRMultiple: normalizeDecimal(CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.takeProfitRMultiple),
        maxHoldHours: CRYPTO_TREND_CORE_LONG_V1_PARAMETERS.maxHoldHours
      })
    })
  }),
  Object.freeze({
    key: `ROOT:${CRYPTO_REGIME_LONG_V1_KEY}`,
    label: "CRYPTO_REGIME_LONG_V1 (Challenger)",
    role: "CHALLENGER",
    strategyKey: CRYPTO_REGIME_LONG_V1_KEY,
    specificationHash: CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
    genome: Object.freeze({
      family: "REGIME_LONG",
      parameters: Object.freeze({
        regimeMinimumConfidence: CRYPTO_REGIME_LONG_V1_PARAMETERS.regimeMinimumConfidence,
        stopAtrMultiple1d: normalizeDecimal(CRYPTO_REGIME_LONG_V1_PARAMETERS.stopAtrMultiple1d),
        takeProfitRMultiple: normalizeDecimal(CRYPTO_REGIME_LONG_V1_PARAMETERS.takeProfitRMultiple),
        maxHoldHours: CRYPTO_REGIME_LONG_V1_PARAMETERS.maxHoldHours,
        exitOnRegimeGateClosed: true
      })
    })
  })
]);

export function rootByKey(key: string): EvolutionRoot | null {
  return EVOLUTION_ROOTS.find((root) => root.key === key) ?? null;
}

/**
 * The pre-registered start of an independent family: evaluated once as
 * generation 1 without AI (`evaluate-seed`), never part of the existing
 * strategies and never a root.
 */
export interface FamilySeed {
  readonly key: string;
  readonly family: EvolutionFamily;
  readonly genome: CandidateGenome;
  /** Pre-registered one-step neighbours for the final stage. */
  readonly neighbours: readonly CandidateGenome[];
  readonly hypothesis: { readonly title: string; readonly marketObservation: string; readonly rationale: string; readonly expectedEffect: string; readonly falsificationCriterion: string };
  /** Stricter than the gate version's family limit. */
  readonly budget: { readonly maxScreeningsPerMonth: number; readonly maxScreeningsTotal: number; readonly maxHypothesesPerRun: number; readonly maxAiRunsPerMonth: number };
  readonly preregistrationHash: string;
  /** Value pinned at the pre-registration; a run refuses when the code no longer matches it. */
  readonly pinnedPreregistrationHash: string;
  /** The pre-registered gate version and hash the family is decided by. */
  readonly gates: { readonly version: string; readonly hash: string };
}

const pullbackGenome = (parameters: Readonly<Record<string, ParameterValue>>): CandidateGenome => Object.freeze({ family: "REGIME_PULLBACK_LONG", parameters: Object.freeze({ ...parameters }) });

export const EVOLUTION_FAMILY_SEEDS: Readonly<Partial<Record<EvolutionFamily, FamilySeed>>> = Object.freeze({
  REGIME_PULLBACK_LONG: Object.freeze({
    key: REGIME_PULLBACK_SEED_KEY,
    family: "REGIME_PULLBACK_LONG",
    genome: pullbackGenome(REGIME_PULLBACK_SEED_PARAMETERS),
    neighbours: Object.freeze(REGIME_PULLBACK_SEED_NEIGHBOUR_PARAMETERS.map(pullbackGenome)),
    hypothesis: REGIME_PULLBACK_SEED_HYPOTHESIS,
    budget: REGIME_PULLBACK_BUDGET,
    preregistrationHash: REGIME_PULLBACK_LONG_V1_PREREGISTRATION_HASH,
    pinnedPreregistrationHash: REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH,
    gates: REGIME_PULLBACK_LONG_V1_PREREGISTRATION.gates
  })
});

export function seedByKey(key: string): FamilySeed | null {
  return Object.values(EVOLUTION_FAMILY_SEEDS).find((seed) => seed.key === key) ?? null;
}

/** Research identity of an independent family (stored on every row), null for the families of the roots. */
export function familyResearchIdentity(family: EvolutionFamily): string | null {
  return FAMILY_SPECS[family]?.independence?.researchIdentity ?? null;
}

export const isIndependentFamily = (family: EvolutionFamily): boolean => FAMILY_SPECS[family]?.independence !== undefined;

// ───────────────────────────────────────────────────────────────────────────
// Normalisation and validation
// ───────────────────────────────────────────────────────────────────────────

const decimalsOf = (step: number): number => {
  const text = normalizeDecimal(step);
  return text.includes(".") ? text.split(".")[1]!.length : 0;
};

export type GenomeIssueCode =
  | "UNSUPPORTED_FAMILY"
  | "UNSUPPORTED_PARAMETER"
  | "MISSING_PARAMETER"
  | "INVALID_VALUE"
  | "OUT_OF_RANGE"
  | "OFF_GRID"
  | "INCONSISTENT_BOUNDS"
  | "COST_GEOMETRY_IMPOSSIBLE"
  | "NO_EFFECTIVE_CHANGE";

export interface GenomeIssue {
  readonly code: GenomeIssueCode;
  readonly parameter: string | null;
  readonly message: string;
}

/** Parse one proposed value against its spec; returns the normalised value or an issue. */
export function parseParameterValue(spec: ParameterSpec, raw: unknown): { ok: true; value: ParameterValue } | { ok: false; issue: GenomeIssue } {
  const fail = (code: GenomeIssueCode, message: string) => ({ ok: false as const, issue: { code, parameter: spec.name, message } });
  if (spec.kind === "boolean") {
    if (raw === true || raw === "true") return { ok: true, value: true };
    if (raw === false || raw === "false") return { ok: true, value: false };
    return fail("INVALID_VALUE", `${spec.name} erwartet true oder false.`);
  }
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (text === null || !DECIMAL_PATTERN.test(text)) return fail("INVALID_VALUE", `${spec.name} erwartet eine Dezimalzahl ohne Exponent.`);
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return fail("INVALID_VALUE", `${spec.name} ist keine endliche Zahl.`);
  if (spec.allowed !== undefined) {
    if (!spec.allowed.some((candidate) => Math.abs(candidate - numeric) < 1e-12)) {
      return fail("OFF_GRID", `${spec.name} muss einer von ${spec.allowed.join(", ")} sein.`);
    }
  } else {
    if (numeric < spec.min! - 1e-12 || numeric > spec.max! + 1e-12) {
      return fail("OUT_OF_RANGE", `${spec.name} muss zwischen ${spec.min} und ${spec.max} liegen.`);
    }
    const steps = (numeric - spec.min!) / spec.step!;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return fail("OFF_GRID", `${spec.name} muss im Raster ${spec.step} ab ${spec.min} liegen.`);
  }
  if (spec.kind === "integer") {
    if (!Number.isInteger(numeric)) return fail("INVALID_VALUE", `${spec.name} erwartet eine ganze Zahl.`);
    return { ok: true, value: numeric };
  }
  const digits = spec.step === undefined ? 10 : decimalsOf(spec.step);
  return { ok: true, value: normalizeDecimal(numeric.toFixed(Math.max(digits, 0))) };
}

const num = (value: ParameterValue | undefined): number => Number(value);

/** Cross-parameter consistency and realism; empty list = valid. */
export function validateGenome(genome: CandidateGenome): GenomeIssue[] {
  const spec = FAMILY_SPECS[genome.family];
  if (spec === undefined) return [{ code: "UNSUPPORTED_FAMILY", parameter: null, message: `Unbekannte Familie ${String(genome.family)}.` }];
  const issues: GenomeIssue[] = [];
  const names = new Set(spec.parameters.map((parameter) => parameter.name));
  for (const name of Object.keys(genome.parameters)) {
    if (!names.has(name)) issues.push({ code: "UNSUPPORTED_PARAMETER", parameter: name, message: `${name} gehört nicht zur Familie ${genome.family}.` });
  }
  for (const parameter of spec.parameters) {
    const value = genome.parameters[parameter.name];
    if (value === undefined) {
      issues.push({ code: "MISSING_PARAMETER", parameter: parameter.name, message: `${parameter.name} fehlt.` });
      continue;
    }
    const parsed = parseParameterValue(parameter, value);
    if (!parsed.ok) issues.push(parsed.issue);
    else if (parsed.value !== value) {
      issues.push({ code: "INVALID_VALUE", parameter: parameter.name, message: `${parameter.name} ist nicht normalisiert (${String(value)}).` });
    }
  }
  if (issues.length > 0) return issues;

  const p = genome.parameters;
  if (genome.family === "BREAKOUT_LONG") {
    if (num(p.rsiMinimum) >= num(p.rsiMaximum) - 10) {
      issues.push({ code: "INCONSISTENT_BOUNDS", parameter: "rsiMinimum", message: "RSI-Untergrenze muss mindestens 10 Punkte unter der Obergrenze liegen." });
    }
    if (num(p.atrToCloseMinimum) >= num(p.atrToCloseMaximum)) {
      issues.push({ code: "INCONSISTENT_BOUNDS", parameter: "atrToCloseMinimum", message: "ATR-Untergrenze muss unter der Obergrenze liegen." });
    }
    if (num(p.stopDistanceFloorPct) >= num(p.stopDistanceCapPct)) {
      issues.push({ code: "INCONSISTENT_BOUNDS", parameter: "stopDistanceFloorPct", message: "Mindest-Stop muss unter der Stop-Kappe liegen." });
    }
    // If even the widest allowed stop cannot clear the net 2R rule after
    // realistic costs, the risk engine would reject every single plan.
    const required = minimumStopDistanceForNet2R(num(p.takeProfitRMultiple));
    if (num(p.stopDistanceCapPct) < required) {
      issues.push({
        code: "COST_GEOMETRY_IMPOSSIBLE",
        parameter: "stopDistanceCapPct",
        message: `Mit Ziel ${p.takeProfitRMultiple}R braucht Netto-2R nach Kosten einen Stop ≥ ${(required * 100).toFixed(2)} %, die Kappe erlaubt nur ${(num(p.stopDistanceCapPct) * 100).toFixed(2)} %.`
      });
    }
  }
  return issues;
}

/** Apply parameter changes to a parent genome; unknown or invalid changes are reported, never guessed. */
export function applyChanges(
  parent: CandidateGenome,
  changes: readonly ParameterChange[]
): { genome: CandidateGenome; issues: GenomeIssue[]; applied: ParameterChange[] } {
  const spec = FAMILY_SPECS[parent.family];
  const parameters: Record<string, ParameterValue> = { ...parent.parameters };
  const issues: GenomeIssue[] = [];
  const applied: ParameterChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const parameter = spec.parameters.find((candidate) => candidate.name === change.parameter);
    if (parameter === undefined) {
      issues.push({ code: "UNSUPPORTED_PARAMETER", parameter: change.parameter, message: `${change.parameter} ist in der Familie ${parent.family} nicht veränderbar.` });
      continue;
    }
    if (seen.has(parameter.name)) {
      issues.push({ code: "INVALID_VALUE", parameter: parameter.name, message: `${parameter.name} wurde mehrfach geändert.` });
      continue;
    }
    seen.add(parameter.name);
    const parsed = parseParameterValue(parameter, change.value);
    if (!parsed.ok) {
      issues.push(parsed.issue);
      continue;
    }
    if (parsed.value !== parameters[parameter.name]) {
      parameters[parameter.name] = parsed.value;
      applied.push({ parameter: parameter.name, value: String(parsed.value) });
    }
  }
  const genome: CandidateGenome = Object.freeze({ family: parent.family, parameters: Object.freeze(parameters) });
  if (issues.length === 0 && applied.length === 0) {
    issues.push({ code: "NO_EFFECTIVE_CHANGE", parameter: null, message: "Die Hypothese ändert keinen Parameter gegenüber der Elternstrategie." });
  }
  return { genome, issues: [...issues, ...(issues.length === 0 ? validateGenome(genome) : [])], applied };
}

export const genomeHash = (genome: CandidateGenome): string => canonicalHash({ engine: "evolution-genome-v1", ...genome });

export interface ParameterDiff {
  readonly parameter: string;
  readonly from: ParameterValue | null;
  readonly to: ParameterValue;
}

export function diffGenomes(parent: CandidateGenome | null, child: CandidateGenome): ParameterDiff[] {
  return Object.keys(child.parameters)
    .sort()
    .filter((name) => parent === null || parent.parameters[name] !== child.parameters[name])
    .map((name) => ({ parameter: name, from: parent?.parameters[name] ?? null, to: child.parameters[name]! }));
}

/**
 * Parameters changed against the generation-0 root — the complexity the
 * evidence has to carry. A family with a pre-registered seed has no root and
 * is measured against its seed.
 */
export function distanceFromRoot(genome: CandidateGenome): number {
  const start = EVOLUTION_FAMILY_SEEDS[genome.family]?.genome ?? EVOLUTION_ROOTS.find((candidate) => candidate.genome.family === genome.family)!.genome;
  return diffGenomes(start, genome).length;
}

/**
 * One-step neighbours of a genome for the robustness and walk-forward check:
 * the given parameters moved one grid step up and down (booleans flipped).
 */
export function neighbourGenomes(genome: CandidateGenome, parameters: readonly string[], limit: number): CandidateGenome[] {
  const spec = FAMILY_SPECS[genome.family];
  const result: CandidateGenome[] = [];
  const seen = new Set([genomeHash(genome)]);
  for (const name of parameters) {
    const parameter = spec.parameters.find((candidate) => candidate.name === name);
    if (parameter === undefined) continue;
    const current = genome.parameters[name]!;
    const values: string[] = [];
    if (parameter.kind === "boolean") values.push(String(current !== true));
    else if (parameter.allowed !== undefined) {
      const index = parameter.allowed.findIndex((candidate) => Math.abs(candidate - Number(current)) < 1e-12);
      for (const next of [index - 1, index + 1]) if (next >= 0 && next < parameter.allowed.length) values.push(String(parameter.allowed[next]));
    } else {
      for (const delta of [-parameter.step!, parameter.step!]) values.push((Number(current) + delta).toFixed(decimalsOf(parameter.step!)));
    }
    for (const value of values) {
      const { genome: next, issues } = applyChanges(genome, [{ parameter: name, value }]);
      const hash = genomeHash(next);
      if (issues.length > 0 || seen.has(hash)) continue;
      seen.add(hash);
      result.push(next);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Compilation into a replay plan
// ───────────────────────────────────────────────────────────────────────────

export interface ReplayPlan {
  /** Registered strategy the replay runs under; for an independent family only the technical replay hull. */
  readonly strategyKey: string;
  readonly regimePolicy: RegimePolicy;
  readonly mode: ReplayMode;
  readonly hooks: ReplayHooks;
  /** Independent family: the identity the results belong to (never the hull's). */
  readonly researchIdentity?: { readonly key: string; readonly engineVersion: string; readonly specificationHash: string };
}

/** The research regime every V1 backtest uses: the crypto-native one the champion and challenger run on. */
export const EVOLUTION_REGIME_POLICY: RegimePolicy = "CRYPTO_NATIVE_V1";
/** Full risk engine, exactly as live shadow trading (docs/trading/06). */
export const EVOLUTION_REPLAY_MODE: ReplayMode = "SPEC";

/** Registered strategy, specified rules: the benchmark replay of a root. */
export function rootReplayPlan(root: EvolutionRoot): ReplayPlan {
  return { strategyKey: root.strategyKey, regimePolicy: EVOLUTION_REGIME_POLICY, mode: EVOLUTION_REPLAY_MODE, hooks: {} };
}

/** A genome as research identity of its family's registered evaluator. Never registered, never live. */
export function genomeReplayPlan(genome: CandidateGenome): ReplayPlan {
  const issues = validateGenome(genome);
  if (issues.length > 0) throw new Error(`Invalid genome: ${issues.map((issue) => issue.message).join(" ")}`);
  const p = genome.parameters;
  if (genome.family === "BREAKOUT_LONG") {
    const research: BreakoutResearchOverrides = {
      skipOneHourSignal: p.skipOneHourSignal === true,
      skipHigherTimeframeSignals: p.skipHigherTimeframeSignals === true,
      skipRegime: p.skipRegime === true,
      regimeMinimumConfidence: num(p.regimeMinimumConfidence),
      breakoutLookback: num(p.breakoutLookback),
      relativeVolumeMinimum: String(p.relativeVolumeMinimum),
      rsiMinimum: String(p.rsiMinimum),
      rsiMaximum: String(p.rsiMaximum),
      atrToCloseMinimum: String(p.atrToCloseMinimum),
      atrToCloseMaximum: String(p.atrToCloseMaximum),
      stopAtrMultiple: String(p.stopAtrMultiple),
      stopDistanceFloorPct: String(p.stopDistanceFloorPct),
      stopDistanceCapPct: String(p.stopDistanceCapPct),
      takeProfitRMultiple: String(p.takeProfitRMultiple),
      maxHoldHours: num(p.maxHoldHours)
    };
    const identity = { ...LONG_V1_BREAKOUT_IDENTITY, research, regimeSource: CRYPTO_NATIVE_REGIME_SOURCE };
    return {
      strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
      regimePolicy: EVOLUTION_REGIME_POLICY,
      mode: EVOLUTION_REPLAY_MODE,
      hooks: { evaluate: (snapshot: StrategyInputSnapshotV1): StrategyEvaluationResultV1 => evaluateCryptoMtfBreakoutV1(snapshot, identity) }
    };
  }
  if (genome.family === "REGIME_PULLBACK_LONG") {
    const researchIdentity = {
      key: REGIME_PULLBACK_RESEARCH_V1_KEY,
      engineVersion: REGIME_PULLBACK_RESEARCH_V1_ENGINE_VERSION,
      specificationHash: regimePullbackSpecificationHash(p)
    };
    // The challenger's identity is only the replay hull the registered snapshot is validated against.
    const identity: RegimePullbackResearchIdentityV1 = {
      ...REGIME_LONG_V1_IDENTITY,
      pullbackResearch: {
        pullbackLookbackHours: num(p.pullbackLookbackHours),
        pullbackDepthAtr1d: String(p.pullbackDepthAtr1d),
        requireReversalCandle: p.requireReversalCandle === true,
        capitulationVolumeMinimum: String(p.capitulationVolumeMinimum)
      },
      researchIdentity
    };
    return {
      strategyKey: CRYPTO_REGIME_LONG_V1_KEY,
      regimePolicy: EVOLUTION_REGIME_POLICY,
      mode: EVOLUTION_REPLAY_MODE,
      researchIdentity,
      hooks: {
        evaluate: (snapshot: StrategyInputSnapshotV1): StrategyEvaluationResultV1 => evaluateRegimePullbackResearchV1(snapshot, identity),
        // The hull declares the challenger's regime exit; the family has none (exits: stop, target, 72 h).
        regimeExit: { enabled: false, gateOpen: () => true }
      }
    };
  }
  const minimumConfidence = num(p.regimeMinimumConfidence);
  const identity = {
    ...REGIME_LONG_V1_IDENTITY,
    regimeResearch: {
      regimeMinimumConfidence: minimumConfidence,
      stopAtrMultiple1d: String(p.stopAtrMultiple1d),
      takeProfitRMultiple: String(p.takeProfitRMultiple),
      maxHoldHours: num(p.maxHoldHours)
    }
  };
  return {
    strategyKey: CRYPTO_REGIME_LONG_V1_KEY,
    regimePolicy: EVOLUTION_REGIME_POLICY,
    mode: EVOLUTION_REPLAY_MODE,
    hooks: {
      evaluate: (snapshot: StrategyInputSnapshotV1): StrategyEvaluationResultV1 => evaluateCryptoRegimeLongV1(snapshot, identity),
      regimeExit: {
        enabled: p.exitOnRegimeGateClosed === true,
        gateOpen: (regime) => regimeGateOpen(regime, minimumConfidence)
      }
    }
  };
}

/** Plan for a backtest subject: a root benchmark (registered) or a genome (research identity). */
export function replayPlanFor(subject: { readonly rootKey: string } | { readonly genome: CandidateGenome }): ReplayPlan {
  if ("rootKey" in subject) {
    const root = rootByKey(subject.rootKey);
    if (root === null) throw new Error(`Unknown evolution root ${subject.rootKey}.`);
    return rootReplayPlan(root);
  }
  return genomeReplayPlan(subject.genome);
}
