/**
 * Read model of the SignalPilot Arena for API and dashboard: per cohort the
 * policy, the leaderboard (newest evaluation per participant), each
 * participant's live activity, lifecycle history and post-mortem cases — and,
 * strictly apart, the historical replay of the same strategies.
 *
 * Strictly read-only. Served by the API (`GET /trading/arena`).
 */

import { Prisma, type PrismaClient } from "@signalpilot/database";
import { parseArenaPolicy } from "@signalpilot/arena";

import {
  loadCryptoNativeRegime,
  loadPortfolioForwardActivity,
  loadReplayResults,
  type ForwardComparisonDto,
  type ForwardComparisonEntryDto,
  type ReplayResultDto
} from "./forwardComparison.js";

const LIFECYCLE_EVENTS_SHOWN = 10;

const str = (value: Prisma.Decimal | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toString();

export interface ArenaEvaluationDto {
  readonly asOf: string;
  readonly evidenceStatus: string;
  readonly evidenceProgress: string;
  readonly forwardDays: string;
  readonly closedTrades: number;
  readonly equity: string;
  readonly netPnl: string;
  readonly returnPct: string;
  readonly logGrowth: string | null;
  readonly maxDrawdownPct: string;
  readonly profitFactor: string | null;
  readonly averageR: string | null;
  readonly winRatePct: string | null;
  readonly maxLossStreak: number;
  readonly costs: string;
  readonly exposurePct: string | null;
  readonly rawFitness: string;
  readonly fitness: string;
  readonly rank: number | null;
  readonly survivalFloor: string | null;
  readonly survivalFloorBreached: boolean;
  readonly hardStop: boolean;
  readonly recommendation: string;
  readonly recommendedStatus: string | null;
  readonly reasonCodes: readonly string[];
  readonly riskCeiling: number | null;
  readonly components: unknown;
  readonly outputHash: string;
}

export interface ArenaParticipantDto {
  readonly id: string;
  readonly participantKey: string;
  readonly strategyKey: string;
  readonly strategyVersion: number;
  readonly engineVersion: string;
  readonly specificationHash: string;
  readonly portfolioKey: string;
  readonly status: string;
  readonly statusChangedAt: string;
  readonly forwardStartAt: string | null;
  readonly initialCapital: string;
  readonly parentParticipantKey: string | null;
  readonly evaluation: ArenaEvaluationDto | null;
  readonly openPosition: ForwardComparisonEntryDto["openPosition"];
  readonly lastTrade: ForwardComparisonEntryDto["lastTrade"];
  readonly lastStrategyEvaluation: ForwardComparisonEntryDto["lastEvaluation"];
  readonly lifecycle: readonly {
    readonly occurredAt: string;
    readonly fromStatus: string | null;
    readonly toStatus: string;
    readonly reasonCode: string;
    readonly actorId: string;
    readonly note: string | null;
  }[];
  readonly postMortems: readonly {
    readonly id: string;
    readonly status: string;
    readonly triggerStatus: string;
    readonly createdAt: string;
    readonly dossierHash: string;
    readonly hypothesis: string | null;
    readonly successorParticipantId: string | null;
  }[];
}

export interface ArenaCohortDto {
  readonly key: string;
  readonly name: string;
  /** LOCAL_SHAKEDOWN results are a system test, never official forward results. */
  readonly phase: string;
  readonly description: string | null;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly policy: unknown;
  readonly participants: readonly ArenaParticipantDto[];
}

export interface ArenaOverviewDto {
  readonly asOf: string;
  readonly regime: ForwardComparisonDto["regime"];
  readonly cohorts: readonly ArenaCohortDto[];
  /** Known history, never forward evidence; kept out of every arena number. */
  readonly replay: readonly ReplayResultDto[];
}

export async function getArenaOverview(database: PrismaClient, asOf: Date = new Date()): Promise<ArenaOverviewDto> {
  const cohorts = await database.arenaCohort.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      participants: {
        include: {
          portfolio: true,
          strategyVersion: true,
          parent: { select: { participantKey: true } },
          events: { orderBy: { occurredAt: "desc" }, take: LIFECYCLE_EVENTS_SHOWN },
          postMortems: { orderBy: { createdAt: "desc" } }
        }
      }
    }
  });

  const cohortDtos: ArenaCohortDto[] = [];
  for (const cohort of cohorts) {
    const participants: ArenaParticipantDto[] = [];
    for (const participant of cohort.participants) {
      const [evaluation, assignments] = await Promise.all([
        database.arenaEvaluation.findFirst({
          where: { participantId: participant.id },
          orderBy: [{ asOf: "desc" }, { createdAt: "desc" }]
        }),
        database.strategyAssignment.findMany({
          where: { portfolioId: participant.portfolioId, strategyVersionId: participant.strategyVersionId },
          select: { id: true }
        })
      ]);
      const activity =
        participant.forwardStartAt === null
          ? null
          : await loadPortfolioForwardActivity(database, {
              portfolioId: participant.portfolioId,
              assignmentIds: assignments.map((entry) => entry.id),
              forwardStart: participant.forwardStartAt,
              asOf
            });
      const metrics = (evaluation?.metricsJson ?? null) as { survivalFloor?: string; riskCeiling?: number } | null;
      participants.push({
        id: participant.id,
        participantKey: participant.participantKey,
        strategyKey: participant.strategyKey,
        strategyVersion: participant.strategyVersion.version,
        engineVersion: participant.strategyVersion.engineVersion,
        specificationHash: participant.specificationHash,
        portfolioKey: participant.portfolio.key,
        status: participant.status,
        statusChangedAt: participant.statusChangedAt.toISOString(),
        forwardStartAt: participant.forwardStartAt?.toISOString() ?? null,
        initialCapital: participant.initialCapital.toString(),
        parentParticipantKey: participant.parent?.participantKey ?? null,
        evaluation:
          evaluation === null
            ? null
            : {
                asOf: evaluation.asOf.toISOString(),
                evidenceStatus: evaluation.evidenceStatus,
                evidenceProgress: evaluation.evidenceProgress.toString(),
                forwardDays: evaluation.forwardDays.toString(),
                closedTrades: evaluation.closedTrades,
                equity: evaluation.equity.toString(),
                netPnl: evaluation.netPnl.toString(),
                returnPct: evaluation.returnPct.toString(),
                logGrowth: str(evaluation.logGrowth),
                maxDrawdownPct: evaluation.maxDrawdownPct.toString(),
                profitFactor: str(evaluation.profitFactor),
                averageR: str(evaluation.averageR),
                winRatePct: str(evaluation.winRatePct),
                maxLossStreak: evaluation.maxLossStreak,
                costs: evaluation.costs.toString(),
                exposurePct: str(evaluation.exposurePct),
                rawFitness: evaluation.rawFitness.toString(),
                fitness: evaluation.fitness.toString(),
                rank: evaluation.rank,
                survivalFloor: metrics?.survivalFloor ?? null,
                survivalFloorBreached: evaluation.survivalFloorBreached,
                hardStop: evaluation.hardStop,
                recommendation: evaluation.recommendation,
                recommendedStatus: evaluation.recommendedStatus,
                reasonCodes: evaluation.reasonCodes,
                riskCeiling: typeof metrics?.riskCeiling === "number" ? metrics.riskCeiling : null,
                components: evaluation.componentsJson,
                outputHash: evaluation.outputHash
              },
        openPosition: activity?.openPosition ?? null,
        lastTrade: activity?.lastTrade ?? null,
        lastStrategyEvaluation: activity?.lastEvaluation ?? null,
        lifecycle: participant.events.map((event) => ({
          occurredAt: event.occurredAt.toISOString(),
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          reasonCode: event.reasonCode,
          actorId: event.actorId,
          note: event.note
        })),
        postMortems: participant.postMortems.map((postMortem) => ({
          id: postMortem.id,
          status: postMortem.status,
          triggerStatus: postMortem.triggerStatus,
          createdAt: postMortem.createdAt.toISOString(),
          dossierHash: postMortem.dossierHash,
          hypothesis: postMortem.hypothesis,
          successorParticipantId: postMortem.successorParticipantId
        }))
      });
    }
    // Leaderboard order: rank first, unranked (candidates, retired) last.
    participants.sort(
      (left, right) =>
        (left.evaluation?.rank ?? Number.MAX_SAFE_INTEGER) - (right.evaluation?.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.participantKey.localeCompare(right.participantKey)
    );
    cohortDtos.push({
      key: cohort.key,
      name: cohort.name,
      phase: cohort.phase,
      description: cohort.description,
      policyVersion: cohort.policyVersion,
      policyHash: cohort.policyHash,
      policy: parseArenaPolicy(cohort.policyJson),
      participants
    });
  }

  const strategyKeys = [
    ...new Set(cohortDtos.flatMap((cohort) => cohort.participants.map((participant) => participant.strategyKey)))
  ];
  const [regime, replay] = await Promise.all([loadCryptoNativeRegime(database), loadReplayResults(database, strategyKeys)]);
  return { asOf: asOf.toISOString(), regime, cohorts: cohortDtos, replay };
}
