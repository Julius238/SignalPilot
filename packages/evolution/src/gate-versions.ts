/**
 * Registry of the pre-registered gate versions. Each version is frozen and
 * fingerprinted in its own module; a run records the version and hash it was
 * decided by, so earlier decisions are never re-evaluated by a later version.
 */

import type { EvolutionGates } from "./gates.js";
import { EVOLUTION_GATES_V1 } from "./gates.js";
import { EVOLUTION_GATES_V2, type EvolutionGatesV2 } from "./gates-v2.js";
import { EVOLUTION_GATES_V3, type EvolutionGatesV3 } from "./gates-v3.js";
import { EVOLUTION_GATES_V4, type EvolutionGatesV4 } from "./gates-v4.js";

export type EvolutionGateSet = EvolutionGates | EvolutionGatesV2 | EvolutionGatesV3 | EvolutionGatesV4;

export type GateVersionKey = "v1" | "v2" | "v3" | "v4";

export const EVOLUTION_GATE_VERSIONS: Readonly<Record<GateVersionKey, EvolutionGateSet>> = Object.freeze({
  v1: EVOLUTION_GATES_V1,
  v2: EVOLUTION_GATES_V2,
  v3: EVOLUTION_GATES_V3,
  v4: EVOLUTION_GATES_V4
});

export function isGateVersionKey(value: string): value is GateVersionKey {
  return Object.prototype.hasOwnProperty.call(EVOLUTION_GATE_VERSIONS, value);
}
