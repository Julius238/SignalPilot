/**
 * Evidence gate: how much forward evidence a participant has. Until the gate
 * is passed every fitness value is PROVISIONAL and no performance-based
 * lifecycle recommendation (probation for weak fitness, proven, champion,
 * retirement) is made. Hard technical or risk stops do not wait for it.
 */

import type { ArenaEvidencePolicy } from "./policy.js";

export const ArenaEvidenceStatus = {
  PROVISIONAL: "PROVISIONAL",
  SUFFICIENT: "SUFFICIENT"
} as const;
export type ArenaEvidenceStatus = (typeof ArenaEvidenceStatus)[keyof typeof ArenaEvidenceStatus];

export interface ArenaEvidenceResult {
  readonly status: ArenaEvidenceStatus;
  /** 0–1: the further of the two paths toward the gate. */
  readonly progress: number;
  /** Which path passed the gate, if any. */
  readonly passedBy: "TRADES" | "TIME" | null;
  readonly closedTrades: number;
  readonly forwardDays: number;
}

const ratio = (value: number, required: number) => (required <= 0 ? 1 : Math.min(1, value / required));

export function evaluateArenaEvidence(
  input: { readonly closedTrades: number; readonly forwardDays: number },
  policy: ArenaEvidencePolicy
): ArenaEvidenceResult {
  // Each path needs both of its dimensions; its progress is the weaker one.
  const tradesPath = Math.min(
    ratio(input.closedTrades, policy.minClosedTrades),
    ratio(input.forwardDays, policy.minForwardDays)
  );
  const timePath = Math.min(
    ratio(input.forwardDays, policy.longRunForwardDays),
    ratio(input.closedTrades, policy.longRunMinClosedTrades)
  );
  const passedBy = tradesPath >= 1 ? "TRADES" : timePath >= 1 ? "TIME" : null;
  return {
    status: passedBy === null ? ArenaEvidenceStatus.PROVISIONAL : ArenaEvidenceStatus.SUFFICIENT,
    progress: Math.max(tradesPath, timePath),
    passedBy,
    closedTrades: input.closedTrades,
    forwardDays: input.forwardDays
  };
}
