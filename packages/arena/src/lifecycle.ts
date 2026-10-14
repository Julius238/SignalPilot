/**
 * Arena lifecycle: the participant states, which transitions are allowed and
 * under which evidence, and the recommendation the arena derives from an
 * evaluation.
 *
 * Arena V1 only recommends. A transition is always an explicit, audited
 * operator command that this guard checks; nothing here changes a session,
 * an assignment, a risk limit or a single unit of capital.
 */

import { ArenaEvidenceStatus, type ArenaEvidenceResult } from "./evidence.js";
import type { ArenaPolicy } from "./policy.js";

export const ArenaParticipantStatus = {
  /** Registered, forward test not started. */
  CANDIDATE: "CANDIDATE",
  /** Forward test running, no verdict yet. */
  ACTIVE: "ACTIVE",
  /** Under observation: weak fitness, survival floor or a hard stop. */
  PROBATION: "PROBATION",
  /** Enough forward evidence of a real edge. */
  PROVEN: "PROVEN",
  /** The reference strategy every challenger has to beat. */
  CHAMPION: "CHAMPION",
  /** Terminal. A successor is a new participant with a new version. */
  RETIRED: "RETIRED"
} as const;
export type ArenaParticipantStatus = (typeof ArenaParticipantStatus)[keyof typeof ArenaParticipantStatus];

export const ArenaRecommendation = {
  HOLD: "HOLD",
  PROBATION: "PROBATION",
  RETIRE: "RETIRE",
  REINSTATE: "REINSTATE",
  PROMOTE_PROVEN: "PROMOTE_PROVEN",
  PROMOTE_CHAMPION: "PROMOTE_CHAMPION",
  DEMOTE_CHAMPION: "DEMOTE_CHAMPION"
} as const;
export type ArenaRecommendation = (typeof ArenaRecommendation)[keyof typeof ArenaRecommendation];

export const ArenaTransitionReason = {
  /** Registration of an existing portfolio in a designated role (no evidence implied). */
  OPERATOR_DESIGNATION: "OPERATOR_DESIGNATION",
  FORWARD_TEST_STARTED: "FORWARD_TEST_STARTED",
  /** A decision on forward performance: always needs sufficient evidence. */
  PERFORMANCE: "PERFORMANCE",
  SURVIVAL_FLOOR: "SURVIVAL_FLOOR",
  /** A hard technical or risk stop (lock, kill switch, integrity breach). */
  HARD_STOP: "HARD_STOP",
  /** Manual review: probation to look closer, or back to ACTIVE after it. */
  OPERATOR_REVIEW: "OPERATOR_REVIEW",
  /** The strategy is broken (a bug), not merely losing. */
  STRATEGY_DEFECT: "STRATEGY_DEFECT",
  OPERATOR_WITHDRAWAL: "OPERATOR_WITHDRAWAL"
} as const;
export type ArenaTransitionReason = (typeof ArenaTransitionReason)[keyof typeof ArenaTransitionReason];

const S = ArenaParticipantStatus;
const R = ArenaTransitionReason;

export const ARENA_TRANSITIONS: Readonly<Record<ArenaParticipantStatus, readonly ArenaParticipantStatus[]>> = Object.freeze({
  CANDIDATE: [S.ACTIVE, S.RETIRED],
  ACTIVE: [S.PROBATION, S.PROVEN, S.RETIRED],
  PROBATION: [S.ACTIVE, S.RETIRED],
  PROVEN: [S.CHAMPION, S.ACTIVE, S.PROBATION, S.RETIRED],
  CHAMPION: [S.PROVEN, S.PROBATION, S.RETIRED],
  RETIRED: []
});

export interface ArenaTransitionContext {
  readonly reason: ArenaTransitionReason;
  /** Evidence status of the newest evaluation, null if none exists. */
  readonly evidence: ArenaEvidenceStatus | null;
  readonly survivalFloorBreached: boolean;
  readonly hardStop: boolean;
  readonly forwardStarted: boolean;
  readonly cohortHasOtherChampion: boolean;
}

export type ArenaTransitionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };

const refuse = (reasonCode: string, message: string): ArenaTransitionResult => ({ ok: false, reasonCode, message });

/** Reasons each target status may be entered with. */
const ALLOWED_REASONS: Readonly<Record<ArenaParticipantStatus, readonly ArenaTransitionReason[]>> = Object.freeze({
  CANDIDATE: [],
  ACTIVE: [R.FORWARD_TEST_STARTED, R.PERFORMANCE, R.OPERATOR_REVIEW],
  PROBATION: [R.PERFORMANCE, R.SURVIVAL_FLOOR, R.HARD_STOP, R.OPERATOR_REVIEW],
  PROVEN: [R.PERFORMANCE],
  CHAMPION: [R.PERFORMANCE],
  RETIRED: [R.PERFORMANCE, R.SURVIVAL_FLOOR, R.STRATEGY_DEFECT, R.OPERATOR_WITHDRAWAL]
});

export function checkArenaTransition(
  from: ArenaParticipantStatus,
  to: ArenaParticipantStatus,
  context: ArenaTransitionContext
): ArenaTransitionResult {
  if (!ARENA_TRANSITIONS[from].includes(to)) {
    return refuse("ARENA_TRANSITION_NOT_ALLOWED", `${from} → ${to} is not an allowed arena transition.`);
  }
  if (!ALLOWED_REASONS[to].includes(context.reason)) {
    return refuse("ARENA_TRANSITION_REASON_NOT_ALLOWED", `${to} cannot be entered with reason ${context.reason}.`);
  }
  const sufficient = context.evidence === ArenaEvidenceStatus.SUFFICIENT;
  // Never a verdict on performance — and never a retirement for losses —
  // before the evidence gate. A withdrawn candidate never traded at all.
  const needsEvidence =
    context.reason === R.PERFORMANCE || (to === S.RETIRED && context.reason === R.SURVIVAL_FLOOR);
  if (needsEvidence && !sufficient && from !== S.CANDIDATE) {
    return refuse(
      "ARENA_EVIDENCE_INSUFFICIENT",
      `${from} → ${to} on ${context.reason} needs sufficient forward evidence; the newest evaluation is ${context.evidence ?? "missing"}.`
    );
  }
  if (context.reason === R.SURVIVAL_FLOOR && !context.survivalFloorBreached) {
    return refuse("ARENA_SURVIVAL_FLOOR_NOT_BREACHED", "The survival floor is not breached.");
  }
  if (context.reason === R.HARD_STOP && !context.hardStop) {
    return refuse("ARENA_NO_HARD_STOP", "The newest evaluation reports no hard stop.");
  }
  if (to === S.ACTIVE && from === S.CANDIDATE && !context.forwardStarted) {
    return refuse("ARENA_FORWARD_NOT_STARTED", "The participant's session has not been activated yet.");
  }
  if (to === S.CHAMPION && context.cohortHasOtherChampion) {
    return refuse("ARENA_CHAMPION_EXISTS", "Demote the current champion before promoting another.");
  }
  return { ok: true };
}

export interface ArenaRecommendationInput {
  readonly status: ArenaParticipantStatus;
  readonly evidence: ArenaEvidenceResult;
  readonly fitness: number;
  /** Capital now minus initial capital, after all costs. */
  readonly netPnl: number;
  readonly survivalFloorBreached: boolean;
  readonly hardStopReasons: readonly string[];
}

export interface ArenaRecommendationResult {
  readonly recommendation: ArenaRecommendation;
  readonly targetStatus: ArenaParticipantStatus | null;
  readonly reasonCodes: readonly string[];
}

const hold = (...reasonCodes: string[]): ArenaRecommendationResult => ({
  recommendation: ArenaRecommendation.HOLD,
  targetStatus: null,
  reasonCodes
});

/** One participant's own recommendation; champion succession is decided per cohort. */
export function recommendArenaAction(input: ArenaRecommendationInput, policy: ArenaPolicy): ArenaRecommendationResult {
  const { status, evidence, fitness } = input;
  const lifecycle = policy.lifecycle;
  if (status === S.RETIRED) return hold("RETIRED_IS_TERMINAL");
  if (status === S.CANDIDATE) return hold("FORWARD_TEST_NOT_STARTED");

  if (input.hardStopReasons.length > 0) {
    return status === S.PROBATION
      ? hold("HARD_STOP_ON_PROBATION", ...input.hardStopReasons)
      : {
          recommendation: ArenaRecommendation.PROBATION,
          targetStatus: S.PROBATION,
          reasonCodes: ["HARD_STOP", ...input.hardStopReasons]
        };
  }

  const sufficient = evidence.status === ArenaEvidenceStatus.SUFFICIENT;
  if (input.survivalFloorBreached) {
    if (sufficient) {
      return { recommendation: ArenaRecommendation.RETIRE, targetStatus: S.RETIRED, reasonCodes: ["SURVIVAL_FLOOR_BREACHED"] };
    }
    return status === S.PROBATION
      ? hold("SURVIVAL_FLOOR_BREACHED", "EVIDENCE_PROVISIONAL")
      : {
          recommendation: ArenaRecommendation.PROBATION,
          targetStatus: S.PROBATION,
          reasonCodes: ["SURVIVAL_FLOOR_BREACHED", "EVIDENCE_PROVISIONAL"]
        };
  }

  if (!sufficient) return hold("EVIDENCE_PROVISIONAL");

  switch (status) {
    case S.PROBATION:
      if (fitness < lifecycle.retireFitness) {
        return { recommendation: ArenaRecommendation.RETIRE, targetStatus: S.RETIRED, reasonCodes: ["FITNESS_BELOW_RETIRE"] };
      }
      if (fitness >= lifecycle.reinstateFitness) {
        return { recommendation: ArenaRecommendation.REINSTATE, targetStatus: S.ACTIVE, reasonCodes: ["FITNESS_RECOVERED"] };
      }
      return hold("ON_PROBATION");
    case S.ACTIVE:
      if (fitness < lifecycle.probationFitness) {
        return { recommendation: ArenaRecommendation.PROBATION, targetStatus: S.PROBATION, reasonCodes: ["FITNESS_BELOW_PROBATION"] };
      }
      if (fitness >= lifecycle.provenFitness && input.netPnl > 0) {
        return { recommendation: ArenaRecommendation.PROMOTE_PROVEN, targetStatus: S.PROVEN, reasonCodes: ["FITNESS_PROVEN"] };
      }
      return hold("WITHIN_BAND");
    case S.PROVEN:
    case S.CHAMPION:
      if (fitness < lifecycle.probationFitness) {
        return { recommendation: ArenaRecommendation.PROBATION, targetStatus: S.PROBATION, reasonCodes: ["FITNESS_BELOW_PROBATION"] };
      }
      return hold("WITHIN_BAND");
    default:
      return hold();
  }
}

export interface ArenaCohortEntry {
  readonly participantId: string;
  readonly participantKey: string;
  readonly status: ArenaParticipantStatus;
  readonly evidence: ArenaEvidenceStatus;
  readonly fitness: number;
  readonly rawFitness: number;
  readonly recommendation: ArenaRecommendationResult;
}

/**
 * Ranking (1 = best) of every participant with a forward test, by fitness,
 * then raw fitness. Exact ties share a rank (1, 1, 3): a name must never
 * decide who leads. Candidates and retired participants are not ranked.
 */
export function rankArenaCohort(entries: readonly ArenaCohortEntry[]): ReadonlyMap<string, number> {
  const ranked = entries
    .filter((entry) => entry.status !== S.CANDIDATE && entry.status !== S.RETIRED)
    .slice()
    .sort(
      (left, right) =>
        right.fitness - left.fitness ||
        right.rawFitness - left.rawFitness ||
        left.participantKey.localeCompare(right.participantKey)
    );
  const ranks = new Map<string, number>();
  ranked.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const tied = previous !== undefined && previous.fitness === entry.fitness && previous.rawFitness === entry.rawFitness;
    ranks.set(entry.participantId, tied ? ranks.get(previous.participantId)! : index + 1);
  });
  return ranks;
}

/**
 * Champion succession: the fittest PROVEN participant with sufficient
 * evidence and no negative recommendation of its own is recommended for
 * CHAMPION when there is none, or when it beats the champion by the margin;
 * the champion is then recommended down to PROVEN.
 */
export function applyChampionSuccession(
  entries: readonly ArenaCohortEntry[],
  policy: ArenaPolicy
): ReadonlyMap<string, ArenaRecommendationResult> {
  const result = new Map(entries.map((entry) => [entry.participantId, entry.recommendation]));
  const contenders = entries
    .filter(
      (entry) =>
        entry.status === S.PROVEN &&
        entry.evidence === ArenaEvidenceStatus.SUFFICIENT &&
        entry.recommendation.recommendation === ArenaRecommendation.HOLD
    )
    .sort((left, right) => right.fitness - left.fitness || left.participantKey.localeCompare(right.participantKey));
  const best = contenders[0];
  if (best === undefined) return result;

  const champion = entries.find((entry) => entry.status === S.CHAMPION);
  const margin = policy.lifecycle.championMargin;
  if (champion !== undefined && best.fitness < champion.fitness + margin) return result;

  result.set(best.participantId, {
    recommendation: ArenaRecommendation.PROMOTE_CHAMPION,
    targetStatus: S.CHAMPION,
    reasonCodes: champion === undefined ? ["NO_CHAMPION"] : ["BEATS_CHAMPION_BY_MARGIN"]
  });
  if (champion !== undefined && champion.recommendation.recommendation === ArenaRecommendation.HOLD) {
    result.set(champion.participantId, {
      recommendation: ArenaRecommendation.DEMOTE_CHAMPION,
      targetStatus: S.PROVEN,
      reasonCodes: ["CHALLENGER_BEATS_CHAMPION"]
    });
  }
  return result;
}
