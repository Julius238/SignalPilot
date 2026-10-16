/**
 * Stages of an independent family's pre-registration (gates v4):
 *
 *  - stage 1: its seed genome, evaluated exactly once and without AI
 *    (`evolution evaluate-seed`); `seedPreflight` lists every reason that run
 *    would be refused, and the research cycle checks the same again;
 *  - stage 2: the AI search inside the family, open only after the seed passed
 *    screening, after the operator opened it (`EVOLUTION_INDEPENDENT_FAMILY_SEARCH`),
 *    under gates v4 and within the family's pre-registered budget.
 *
 * Nothing here runs a backtest, calls an AI provider or writes a row.
 */

import {
  EVOLUTION_DATA_SPLIT_V1,
  EVOLUTION_FAMILY_SEEDS,
  FAMILY_SPECS,
  genomeHash,
  isGatesV4,
  lineageTThreshold,
  type EvolutionDataSplit,
  type EvolutionFamily,
  type EvolutionGateSet,
  type FamilySeed,
  type ParameterValue,
  type ResearchAiProvider
} from "@signalpilot/evolution";
import { canonicalHash } from "@signalpilot/trading-domain";

import type { EvolutionWorkerConfig } from "../config.js";
import type { EvolutionDb } from "../database.js";
import { evaluatedConfigurations, familyScreeningCounts, familyScreeningsThisMonth, seedEvaluation } from "../persistence/store.js";

/** The provider of a seed evaluation: there is no AI step, and any call is a programming error. */
export const NO_AI_PROVIDER: ResearchAiProvider = Object.freeze({
  name: "none",
  billable: false,
  async complete(): Promise<never> {
    throw new Error("A seed evaluation never calls an AI provider.");
  }
});

export const priorTrainingConfigurations = (split: EvolutionDataSplit): number =>
  split.priorExposure.filter((entry) => entry.role === "TRAINING").reduce((sum, entry) => sum + entry.configurationsTried, 0);

export interface SeedPreflight {
  readonly ok: boolean;
  /** Every reason the seed evaluation is refused; empty when it may run. */
  readonly problems: readonly string[];
  /** Worth knowing, never blocking. */
  readonly warnings: readonly string[];
  readonly family: string;
  readonly seed: { readonly key: string; readonly genomeHash: string; readonly parameters: Readonly<Record<string, ParameterValue>> } | null;
  readonly preregistration: { readonly hash: string | null; readonly pinned: string | null; readonly intact: boolean };
  readonly gates: { readonly version: string; readonly hash: string; readonly portfolioPath: boolean };
  readonly trials: { readonly now: number; readonly afterScreening: number; readonly ifFinalist: number; readonly alphaThresholdAfterScreening: number };
  readonly budget: {
    readonly family: { readonly month: number; readonly total: number; readonly maxPerMonth: number | null; readonly maxTotal: number | null };
    readonly gatesMonthly: { readonly used: number; readonly limit: number | null };
  };
  readonly previous: { readonly candidateKey: string; readonly status: string; readonly passedScreening: boolean } | null;
  readonly agentStatus: string;
  readonly codeVersion: string;
}

export function familySeed(family: string): FamilySeed | null {
  return EVOLUTION_FAMILY_SEEDS[family as EvolutionFamily] ?? null;
}

/** Whether the code still matches the family's pinned pre-registration. */
export function preregistrationIntact(seed: FamilySeed): boolean {
  const spec = FAMILY_SPECS[seed.family];
  return spec.independence?.preregistrationHash === seed.pinnedPreregistrationHash && seed.preregistrationHash === seed.pinnedPreregistrationHash;
}

export async function seedPreflight(
  db: EvolutionDb,
  input: {
    readonly family: string;
    readonly gates: EvolutionGateSet;
    readonly config: EvolutionWorkerConfig;
    readonly now: Date;
    readonly split?: EvolutionDataSplit;
    /** Production: the gates must be exactly the pre-registered ones (hash). Tests that inject lower thresholds pass false. */
    readonly requirePreregisteredGates?: boolean;
  }
): Promise<SeedPreflight> {
  const split = input.split ?? EVOLUTION_DATA_SPLIT_V1;
  const problems: string[] = [];
  const warnings: string[] = [];
  const spec = FAMILY_SPECS[input.family as EvolutionFamily];
  const seed = familySeed(input.family);
  if (spec === undefined) problems.push(`Unbekannte Familie ${input.family}.`);
  else if (spec.independence === undefined || seed === null) problems.push(`${input.family} ist keine eigenständige Familie mit vorregistriertem Startgenom.`);

  const portfolioPath = isGatesV4(input.gates);
  if (!portfolioPath) {
    problems.push(`Eine eigenständige Familie wird nur nach Gates v4 im Portfolio geprüft; ${input.gates.version} ist dafür nicht zulässig (EVOLUTION_GATES_VERSION=v4).`);
  }
  if (portfolioPath && seed !== null && input.requirePreregisteredGates !== false && canonicalHash(input.gates) !== seed.gates.hash) {
    problems.push(`Die Familie ist nach ${seed.gates.version} (${seed.gates.hash.slice(0, 12)}…) vorregistriert; die gewählten Gates (${input.gates.version}) weichen davon ab.`);
  }
  const intact = seed !== null && preregistrationIntact(seed);
  if (seed !== null && !intact) {
    problems.push(`Vorregistrierungs-Hash im Code (${seed.preregistrationHash.slice(0, 12)}…) weicht vom festgeschriebenen Wert (${seed.pinnedPreregistrationHash.slice(0, 12)}…) ab — eine Änderung braucht eine neue Vorregistrierung.`);
  }

  const previous = seed === null ? null : await seedEvaluation(db, seed.genome);
  if (previous !== null) problems.push(`Das Startgenom wurde bereits als ${previous.candidateKey} bewertet (Status ${previous.status}); ein zweiter Lauf desselben Startgenoms wird verweigert.`);

  const counts = seed === null ? { month: 0, total: 0 } : await familyScreeningCounts(db, seed.family, input.now);
  if (seed !== null && counts.month >= seed.budget.maxScreeningsPerMonth) problems.push(`Monatsgrenze der Vorregistrierung erreicht (${counts.month} von ${seed.budget.maxScreeningsPerMonth} Prüfungen).`);
  if (seed !== null && counts.total >= seed.budget.maxScreeningsTotal) problems.push(`Gesamtgrenze der Vorregistrierung erreicht (${counts.total} von ${seed.budget.maxScreeningsTotal} Prüfungen).`);
  const gatesLimit = "lineage" in input.gates ? (input.gates as { lineage: { maxScreeningsPerFamilyPerMonth: number } }).lineage.maxScreeningsPerFamilyPerMonth : null;
  const gatesUsed = (await familyScreeningsThisMonth(db, input.now)).get(input.family) ?? 0;
  if (gatesLimit !== null && gatesUsed >= gatesLimit) problems.push(`Monatslimit von ${gatesLimit} Prüfungen der Familie nach ${input.gates.version} erreicht.`);

  const state = await db.evolutionAgentState.findFirst();
  const agentStatus = state?.status ?? "NOT_INITIALISED";
  if (agentStatus === "DISABLED") problems.push("Der Evolution-Agent ist deaktiviert.");
  if (state?.leaseOwner && (state.leaseExpiresAt === null || state.leaseExpiresAt > input.now)) problems.push("Ein anderer Forschungsdurchlauf läuft bereits.");
  if (input.config.codeVersion === "local") warnings.push("EVOLUTION_CODE_VERSION ist nicht gesetzt; für einen nachvollziehbaren Lauf den Commit eintragen.");
  if (input.config.holdoutEnabled === false) warnings.push("EVOLUTION_HOLDOUT_ENABLED=false: Ein Finalist kann ohne Holdout-Schutz nicht vorgeschlagen werden.");

  const trialsNow = priorTrainingConfigurations(split) + (await evaluatedConfigurations(db));
  return {
    ok: problems.length === 0,
    problems,
    warnings,
    family: input.family,
    seed: seed === null ? null : { key: seed.key, genomeHash: genomeHash(seed.genome), parameters: seed.genome.parameters },
    preregistration: { hash: seed?.preregistrationHash ?? null, pinned: seed?.pinnedPreregistrationHash ?? null, intact },
    gates: { version: input.gates.version, hash: canonicalHash(input.gates), portfolioPath },
    trials: {
      now: trialsNow,
      afterScreening: trialsNow + 1,
      ifFinalist: trialsNow + 1 + (seed?.neighbours.length ?? 0),
      // max(2, √(2·ln N)) at N + 1; the Student-t quantile of the test itself depends on its months and can only raise it.
      alphaThresholdAfterScreening: Math.round(lineageTThreshold(2, trialsNow + 1, 0) * 100) / 100
    },
    budget: {
      family: { month: counts.month, total: counts.total, maxPerMonth: seed?.budget.maxScreeningsPerMonth ?? null, maxTotal: seed?.budget.maxScreeningsTotal ?? null },
      gatesMonthly: { used: gatesUsed, limit: gatesLimit }
    },
    previous,
    agentStatus,
    codeVersion: input.config.codeVersion
  };
}

export interface IndependentSearchStatus {
  readonly family: EvolutionFamily;
  readonly open: boolean;
  /** Why the AI may not work on the family; null when open. */
  readonly reason: string | null;
  readonly remainingThisMonth: number;
  readonly remainingTotal: number;
  readonly maxHypothesesPerRun: number;
}

/** Stage 2: whether the AI path of a cycle may test hypotheses of an independent family. */
export async function independentSearchStatus(
  db: EvolutionDb,
  input: { readonly family: EvolutionFamily; readonly gates: EvolutionGateSet; readonly config: EvolutionWorkerConfig; readonly now: Date; readonly requirePreregisteredGates?: boolean }
): Promise<IndependentSearchStatus> {
  const seed = familySeed(input.family);
  const closed = (reason: string, remainingThisMonth = 0, remainingTotal = 0): IndependentSearchStatus => ({
    family: input.family,
    open: false,
    reason,
    remainingThisMonth,
    remainingTotal,
    maxHypothesesPerRun: seed?.budget.maxHypothesesPerRun ?? 0
  });
  if (seed === null) return closed("Familie ohne vorregistriertes Startgenom.");
  if (!isGatesV4(input.gates)) return closed(`Eigenständige Familien werden nur nach Gates v4 geprüft (${input.gates.version} lehnt sie ab).`);
  if (input.requirePreregisteredGates !== false && canonicalHash(input.gates) !== seed.gates.hash) return closed(`Die Familie ist nach ${seed.gates.version} vorregistriert; die gewählten Gates weichen davon ab.`);
  if (!preregistrationIntact(seed)) return closed("Der Code passt nicht mehr zur festgeschriebenen Vorregistrierung.");
  const evaluated = await seedEvaluation(db, seed.genome);
  if (evaluated === null) return closed("Stufe 1 fehlt: Das Startgenom ist noch nicht bewertet (evolution evaluate-seed).");
  if (!evaluated.passedScreening) return closed(`Abbruch nach F4: Das Startgenom ${evaluated.candidateKey} hat das Screening nicht bestanden; die Familie ist unter dieser Vorregistrierung geschlossen.`);
  const counts = await familyScreeningCounts(db, input.family, input.now);
  const remainingThisMonth = Math.max(0, seed.budget.maxScreeningsPerMonth - counts.month);
  const remainingTotal = Math.max(0, seed.budget.maxScreeningsTotal - counts.total);
  if (!input.config.independentFamilySearch.includes(input.family)) return closed("Stufe 2 ist nicht freigegeben (EVOLUTION_INDEPENDENT_FAMILY_SEARCH).", remainingThisMonth, remainingTotal);
  if (remainingThisMonth === 0 || remainingTotal === 0) return closed("Das vorregistrierte Prüfbudget der Familie ist ausgeschöpft.", remainingThisMonth, remainingTotal);
  return { family: input.family, open: true, reason: null, remainingThisMonth, remainingTotal, maxHypothesesPerRun: seed.budget.maxHypothesesPerRun };
}
