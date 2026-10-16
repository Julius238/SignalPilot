/**
 * Version identity and lineage of evolution candidates.
 *
 * Every candidate gets an immutable key (`EVO-BRK-0007`), its family, its
 * generation and exactly one parent: either another candidate or one of the
 * frozen generation-0 roots (champion / challenger). A lineage is read by
 * walking parent links back to the root, e.g.
 * CRYPTO_TREND_CORE_LONG_V1 → EVO-BRK-0002 → EVO-BRK-0007. An independent
 * family has no root: its lineage starts at the pre-registered seed, e.g.
 * SEED:REGIME_PULLBACK_LONG_V1 → EVO-RPB-0001 (generation 1).
 */

import { FAMILY_SPECS, rootByKey, type EvolutionFamily } from "./genome.js";

export const FAMILY_CODES: Readonly<Record<EvolutionFamily, string>> = Object.freeze({
  BREAKOUT_LONG: "BRK",
  REGIME_LONG: "REG",
  REGIME_PULLBACK_LONG: "RPB"
});

export function candidateKeyFor(family: EvolutionFamily, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Invalid candidate sequence ${sequence}.`);
  return `EVO-${FAMILY_CODES[family]}-${String(sequence).padStart(4, "0")}`;
}

const KEY_PATTERN = /^EVO-(BRK|REG|RPB)-(\d{4,})$/;

export function parseCandidateKey(key: string): { family: EvolutionFamily; sequence: number } | null {
  const match = KEY_PATTERN.exec(key);
  if (match === null) return null;
  const family = (Object.entries(FAMILY_CODES).find(([, code]) => code === match[1])![0]) as EvolutionFamily;
  return { family, sequence: Number(match[2]) };
}

/** "Breakout-Long · G2 · EVO-BRK-0007" */
export function versionLabel(family: EvolutionFamily, generation: number, key: string): string {
  return `${FAMILY_SPECS[family].label} · G${generation} · ${key}`;
}

export interface LineageNode {
  readonly key: string;
  readonly parentKey: string | null;
}

/**
 * Lineage from the root to `key` (inclusive). Stops at a root key, an unknown
 * key or a cycle — a broken chain is reported as far as it can be read.
 */
export function lineageChain(key: string, lookup: (key: string) => LineageNode | null, maxDepth = 64): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = key;
  while (current !== null && chain.length < maxDepth) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.unshift(current);
    if (rootByKey(current) !== null) break;
    current = lookup(current)?.parentKey ?? null;
  }
  return chain;
}

/** Display name of a lineage element: roots by their strategy key, candidates by their key. */
export function lineageLabel(key: string): string {
  const root = rootByKey(key);
  return root === null ? key : root.strategyKey;
}
