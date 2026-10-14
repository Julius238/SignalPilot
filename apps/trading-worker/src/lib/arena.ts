/**
 * SignalPilot Arena: strategies compete for survival on their own virtual
 * capital (docs/trading/17-arena.md).
 *
 * A participant is one immutable strategy version trading in its own shadow
 * portfolio. Its capital is that portfolio's ledger and nothing else: profits
 * grow it, losses and every fee, spread and slippage shrink it, nothing tops
 * it up. The arena reads that state and writes only its own tables:
 *
 *   - registration of existing portfolios without any reset;
 *   - an append-only, hash-chained evaluation per participant (fitness,
 *     evidence gate, survival floor, hard stops, recommendation, rank);
 *   - explicit, guarded operator transitions with a lifecycle history;
 *   - a frozen post-mortem dossier when a participant lands on PROBATION or
 *     RETIRED.
 *
 * It never changes a portfolio, ledger, session, assignment, strategy version
 * or risk limit, and Arena V1 never applies its own recommendations.
 */

import {
  PortfolioLedgerEntryType,
  PortfolioStatus,
  Prisma,
  RiskSeverity,
  TradingActorType,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import {
  ARENA_FITNESS_ENGINE_VERSION,
  ARENA_POLICY_V1,
  ArenaEvidenceStatus,
  ArenaParticipantStatus,
  ArenaRecommendation,
  ArenaTransitionReason,
  applyChampionSuccession,
  arenaPolicyHash,
  checkArenaTransition,
  computeArenaFitness,
  parseArenaPolicy,
  rankArenaCohort,
  recommendArenaAction,
  type ArenaCohortEntry,
  type ArenaFitnessResult,
  type ArenaPolicy,
  type ArenaRecommendationResult
} from "@signalpilot/arena";
import { buildSpecificationHash } from "@signalpilot/trading-domain";

import { loadPortfolioForwardActivity, type PortfolioForwardActivity } from "./forwardComparison.js";
import { loadShadowPortfolioValuation } from "./shadowPortfolioValuation.js";

export const ARENA_V1_COHORT_KEY = "ARENA_V1";
/** The official 24/7 forward test on the server (OFFICIAL_V1 portfolios). */
export const ARENA_OFFICIAL_V1_COHORT_KEY = "ARENA_OFFICIAL_V1";
export type ArenaCohortPhaseKey = "UNLABELED" | "LOCAL_SHAKEDOWN" | "OFFICIAL";
export const ARENA_DOSSIER_VERSION = "arena-dossier-v1";
export const ARENA_EVALUATION_ENGINE_VERSION = `arena-evaluation-v1/1.0.0+${ARENA_FITNESS_ENGINE_VERSION}`;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ArenaOpsResult<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };

const fail = <T>(reasonCode: string, message: string): ArenaOpsResult<T> => ({ ok: false, reasonCode, message });
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
/** Fixed-scale string of a finite number for a Decimal column; null otherwise. */
const fixed = (value: number | null | undefined, digits = 12): string | null =>
  value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(digits);
const numberOrNull = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * JSON as it survives a round trip through PostgreSQL: every non-integer
 * number at 15 significant digits (the database returns no more), so a hash
 * over the stored JSON can be recomputed from the row bit for bit.
 */
function storableJson<T>(value: T): T {
  if (typeof value === "number") {
    return (Number.isInteger(value) ? value : Number(value.toPrecision(15))) as T;
  }
  if (Array.isArray(value)) return value.map((entry) => storableJson(entry)) as T;
  if (value !== null && typeof value === "object" && !(value instanceof Date) && !(value instanceof Prisma.Decimal)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, storableJson(entry)])) as T;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cohort
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterArenaCohortInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly policy?: ArenaPolicy;
  readonly actorId: string;
  /** Which kind of run the cohort's results belong to; never mixed across phases. */
  readonly phase: ArenaCohortPhaseKey;
}

/** Idempotent: the same key with the same policy returns the existing cohort. */
export async function registerArenaCohort(
  database: PrismaClient,
  input: RegisterArenaCohortInput
): Promise<ArenaOpsResult<{ readonly cohortId: string; readonly created: boolean; readonly policyHash: string }>> {
  const policy = parseArenaPolicy(input.policy ?? ARENA_POLICY_V1);
  const policyHash = arenaPolicyHash(policy);
  const existing = await database.arenaCohort.findUnique({ where: { key: input.key } });
  if (existing !== null) {
    if (existing.phase !== input.phase) {
      return fail(
        "ARENA_COHORT_PHASE_CONFLICT",
        `Cohort ${input.key} is ${existing.phase}; change it with set-phase, never by re-registering.`
      );
    }
    if (existing.policyHash !== policyHash) {
      return fail(
        "ARENA_COHORT_POLICY_CONFLICT",
        `Cohort ${input.key} exists with policy ${existing.policyHash}; change it with set-policy, never by re-registering.`
      );
    }
    return { ok: true, result: { cohortId: existing.id, created: false, policyHash } };
  }
  const cohort = await database.arenaCohort.create({
    data: {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      policyVersion: policy.version,
      policyJson: asJson(policy),
      policyHash,
      phase: input.phase,
      createdBy: input.actorId
    }
  });
  return { ok: true, result: { cohortId: cohort.id, created: true, policyHash } };
}

/**
 * Replaces a cohort's policy (thresholds, weights, floor) — an explicit,
 * audited operator decision. Past evaluations keep the policy hash they were
 * computed with; nothing is recomputed retroactively.
 */
export async function setArenaCohortPolicy(
  database: PrismaClient,
  input: { readonly cohortKey: string; readonly policy: unknown; readonly actorId: string; readonly reason: string; readonly asOf: Date }
): Promise<ArenaOpsResult<{ readonly policyHash: string }>> {
  const policy = parseArenaPolicy(input.policy);
  const policyHash = arenaPolicyHash(policy);
  const cohort = await database.arenaCohort.findUnique({ where: { key: input.cohortKey } });
  if (cohort === null) return fail("ARENA_COHORT_NOT_FOUND", `No arena cohort ${input.cohortKey}.`);
  if (input.reason.trim() === "") return fail("ARENA_REASON_REQUIRED", "A policy change needs a reason.");
  if (cohort.policyHash === policyHash) return { ok: true, result: { policyHash } };
  await database.$transaction(async (tx) => {
    await tx.arenaCohort.update({
      where: { id: cohort.id },
      data: { policyVersion: policy.version, policyJson: asJson(policy), policyHash }
    });
    const idempotencyKey = buildSpecificationHash({ cohortId: cohort.id, from: cohort.policyHash, to: policyHash });
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: `arena-policy:${idempotencyKey}`,
        eventType: "ARENA_POLICY_CHANGED",
        aggregateType: "ArenaCohort",
        aggregateId: cohort.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: idempotencyKey,
        causationId: idempotencyKey,
        idempotencyKey,
        reasonCode: "ARENA_POLICY_CHANGED",
        beforeState: asJson({ policyHash: cohort.policyHash, policy: cohort.policyJson }),
        afterState: asJson({ policyHash, policy, reason: input.reason }),
        codeVersion: process.env.TRADING_CODE_VERSION ?? "unversioned-local-build",
        occurredAt: input.asOf
      }
    });
  });
  return { ok: true, result: { policyHash } };
}

/**
 * Labels which kind of run a cohort's results belong to (e.g. the local
 * system test as LOCAL_SHAKEDOWN), an audited operator decision. Changes no
 * evaluation, participant or capital — only how the results are presented
 * and exported, so they are never mixed with an official forward test.
 */
export async function setArenaCohortPhase(
  database: PrismaClient,
  input: {
    readonly cohortKey: string;
    readonly phase: ArenaCohortPhaseKey;
    readonly actorId: string;
    readonly reason: string;
    readonly asOf: Date;
  }
): Promise<ArenaOpsResult<{ readonly phase: ArenaCohortPhaseKey }>> {
  const cohort = await database.arenaCohort.findUnique({ where: { key: input.cohortKey } });
  if (cohort === null) return fail("ARENA_COHORT_NOT_FOUND", `No arena cohort ${input.cohortKey}.`);
  if (input.reason.trim() === "") return fail("ARENA_REASON_REQUIRED", "A phase change needs a reason.");
  if (cohort.phase === input.phase) return { ok: true, result: { phase: input.phase } };
  await database.$transaction(async (tx) => {
    await tx.arenaCohort.update({ where: { id: cohort.id }, data: { phase: input.phase } });
    const idempotencyKey = buildSpecificationHash({ cohortId: cohort.id, from: cohort.phase, to: input.phase });
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: `arena-phase:${idempotencyKey}`,
        eventType: "ARENA_PHASE_CHANGED",
        aggregateType: "ArenaCohort",
        aggregateId: cohort.id,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        correlationId: idempotencyKey,
        causationId: idempotencyKey,
        idempotencyKey,
        reasonCode: "ARENA_PHASE_CHANGED",
        beforeState: asJson({ phase: cohort.phase }),
        afterState: asJson({ phase: input.phase, reason: input.reason }),
        codeVersion: process.env.TRADING_CODE_VERSION ?? "unversioned-local-build",
        occurredAt: input.asOf
      }
    });
  });
  return { ok: true, result: { phase: input.phase } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Participants
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterArenaParticipantInput {
  readonly cohortKey: string;
  readonly portfolioKey: string;
  /** CHAMPION is an operator designation; ACTIVE a running forward test; CANDIDATE not started. */
  readonly status: "CANDIDATE" | "ACTIVE" | "CHAMPION";
  readonly actorId: string;
  readonly asOf: Date;
  /** Needed for a CANDIDATE whose assignments are not enabled yet. */
  readonly strategyVersionId?: string;
  /** The participant whose post-mortem produced this one. */
  readonly parentParticipantId?: string;
}

/**
 * Registers an existing portfolio as a participant without touching it: the
 * forward start is the activation of its session, the initial capital its
 * starting cash, the strategy the one version its enabled assignments trade.
 */
export async function registerArenaParticipant(
  database: PrismaClient,
  input: RegisterArenaParticipantInput
): Promise<ArenaOpsResult<{ readonly participantId: string; readonly participantKey: string; readonly created: boolean }>> {
  const cohort = await database.arenaCohort.findUnique({ where: { key: input.cohortKey } });
  if (cohort === null) return fail("ARENA_COHORT_NOT_FOUND", `No arena cohort ${input.cohortKey}.`);
  const portfolio = await database.portfolio.findUnique({ where: { key: input.portfolioKey } });
  if (portfolio === null) return fail("ARENA_PORTFOLIO_NOT_FOUND", `No portfolio ${input.portfolioKey}.`);

  const existing = await database.arenaParticipant.findUnique({ where: { portfolioId: portfolio.id } });
  if (existing !== null) {
    return existing.cohortId === cohort.id
      ? { ok: true, result: { participantId: existing.id, participantKey: existing.participantKey, created: false } }
      : fail("ARENA_PORTFOLIO_TAKEN", `Portfolio ${input.portfolioKey} already belongs to another cohort's participant.`);
  }

  // A participant lives only on its own trades: every enabled assignment of
  // its portfolio must be the one strategy version it is registered with.
  const assignments = await database.strategyAssignment.findMany({
    where: { portfolioId: portfolio.id },
    include: { strategy: true, strategyVersion: true }
  });
  const enabledVersionIds = [...new Set(assignments.filter((entry) => entry.enabled).map((entry) => entry.strategyVersionId))];
  const versionId = input.strategyVersionId ?? (enabledVersionIds.length === 1 ? enabledVersionIds[0] : undefined);
  if (versionId === undefined) {
    return fail(
      "ARENA_PORTFOLIO_STRATEGY_AMBIGUOUS",
      `Portfolio ${input.portfolioKey} must trade exactly one strategy version; it has ${enabledVersionIds.length} enabled.`
    );
  }
  if (enabledVersionIds.some((id) => id !== versionId)) {
    return fail("ARENA_PORTFOLIO_FOREIGN_STRATEGY", `Portfolio ${input.portfolioKey} trades a strategy version other than ${versionId}.`);
  }
  const assignment = assignments.find((entry) => entry.strategyVersionId === versionId);
  if (assignment === undefined) {
    return fail("ARENA_STRATEGY_NOT_ASSIGNED", `Strategy version ${versionId} has no assignment in ${input.portfolioKey}.`);
  }

  const session = await database.tradingSession.findFirst({
    where: { portfolioId: portfolio.id, status: { not: TradingSessionStatus.CLOSED } },
    orderBy: { createdAt: "desc" }
  });
  const started = session?.status === TradingSessionStatus.SHADOW_ACTIVE && session.startedAt !== null;
  if (input.status !== "CANDIDATE" && !started) {
    return fail("ARENA_FORWARD_NOT_STARTED", `${input.portfolioKey} has no activated session; register it as CANDIDATE.`);
  }
  if (input.status === "CHAMPION") {
    const champion = await database.arenaParticipant.findFirst({ where: { cohortId: cohort.id, status: "CHAMPION" } });
    if (champion !== null) return fail("ARENA_CHAMPION_EXISTS", `Cohort ${cohort.key} already has champion ${champion.participantKey}.`);
  }

  const capital = await checkInitialCapital(database, portfolio.id, portfolio.startingCash);
  if (capital !== null) return fail("ARENA_CAPITAL_INTEGRITY", capital);

  if (input.parentParticipantId !== undefined) {
    const parent = await database.arenaParticipant.findUnique({ where: { id: input.parentParticipantId } });
    if (parent === null || parent.cohortId !== cohort.id) {
      return fail("ARENA_PARENT_NOT_FOUND", `Parent ${input.parentParticipantId} is not in cohort ${cohort.key}.`);
    }
  }

  const participantKey = `${cohort.key}:${assignment.strategy.key}:v${assignment.strategyVersion.version}`;
  const forwardStartAt = input.status === "CANDIDATE" ? null : session!.startedAt;
  const reasonCode =
    input.status === "CHAMPION"
      ? ArenaTransitionReason.OPERATOR_DESIGNATION
      : input.status === "ACTIVE"
        ? ArenaTransitionReason.FORWARD_TEST_STARTED
        : "REGISTERED_AS_CANDIDATE";

  const participant = await database.$transaction(async (tx) => {
    const created = await tx.arenaParticipant.create({
      data: {
        participantKey,
        cohortId: cohort.id,
        portfolioId: portfolio.id,
        strategyVersionId: versionId,
        strategyKey: assignment.strategy.key,
        specificationHash: assignment.strategyVersion.specificationHash,
        status: input.status,
        initialCapital: portfolio.startingCash,
        forwardStartAt,
        parentParticipantId: input.parentParticipantId ?? null,
        registeredBy: input.actorId,
        statusChangedAt: input.asOf
      }
    });
    await tx.arenaParticipantEvent.create({
      data: {
        eventKey: `arena-registered:${created.id}`,
        participantId: created.id,
        eventType: "REGISTERED",
        fromStatus: null,
        toStatus: input.status,
        reasonCode,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        payloadJson: asJson({
          portfolioKey: portfolio.key,
          portfolioId: portfolio.id,
          strategyVersionId: versionId,
          specificationHash: assignment.strategyVersion.specificationHash,
          engineVersion: assignment.strategyVersion.engineVersion,
          initialCapital: portfolio.startingCash.toString(),
          forwardStartAt: forwardStartAt?.toISOString() ?? null,
          // Registration never resets: the capital it found is the capital it keeps.
          capitalAtRegistration: portfolio.equity.toString()
        }),
        occurredAt: input.asOf
      }
    });
    if (input.parentParticipantId !== undefined) {
      await tx.arenaPostMortem.updateMany({
        where: {
          participantId: input.parentParticipantId,
          status: { in: ["OPEN", "HYPOTHESIS_RECORDED"] },
          successorParticipantId: null
        },
        data: { successorParticipantId: created.id, status: "SUCCESSOR_REGISTERED" }
      });
    }
    return created;
  });
  return { ok: true, result: { participantId: participant.id, participantKey, created: true } };
}

/** Null when the portfolio was funded exactly once with its starting cash. */
async function checkInitialCapital(
  database: PrismaClient,
  portfolioId: string,
  startingCash: Prisma.Decimal
): Promise<string | null> {
  const initial = await database.portfolioLedgerEntry.findMany({
    where: { portfolioId, type: PortfolioLedgerEntryType.INITIAL_CASH },
    select: { availableCashDelta: true }
  });
  if (initial.length !== 1) return `Expected exactly one INITIAL_CASH entry, found ${initial.length}.`;
  if (!decimal(initial[0]!.availableCashDelta).equals(startingCash)) {
    return `INITIAL_CASH ${initial[0]!.availableCashDelta.toString()} differs from starting cash ${startingCash.toString()}.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

type ParticipantRow = Prisma.ArenaParticipantGetPayload<{ include: { portfolio: true; strategyVersion: true } }>;
type ArenaEvaluationRow = Prisma.ArenaEvaluationGetPayload<object>;

export interface ArenaParticipantFacts {
  readonly forwardDays: number;
  readonly equity: Prisma.Decimal;
  readonly maxDrawdownFraction: number;
  readonly activity: PortfolioForwardActivity;
  /** Violations that stop a participant at once, whatever the evidence. */
  readonly hardStopReasons: readonly string[];
  /** Observations that are not violations (a paused session, no enabled assignment). */
  readonly notes: readonly string[];
}

/** Everything one evaluation reads, from the participant's own portfolio only. */
export async function collectArenaParticipantFacts(
  database: PrismaClient,
  participant: ParticipantRow,
  asOf: Date
): Promise<ArenaParticipantFacts> {
  const { portfolio } = participant;
  const forwardStart = participant.forwardStartAt!;
  const [session, assignments, criticalEvents, unexplainedEntries, initialCapitalIssue, equityPoints] = await Promise.all([
    database.tradingSession.findFirst({
      where: { portfolioId: portfolio.id, status: { not: TradingSessionStatus.CLOSED } },
      orderBy: { createdAt: "desc" }
    }),
    database.strategyAssignment.findMany({ where: { portfolioId: portfolio.id, enabled: true } }),
    database.riskEvent.count({
      where: { portfolioId: portfolio.id, severity: RiskSeverity.CRITICAL, acknowledgedAt: null }
    }),
    // Every ledger booking after the initial funding belongs to an order, a
    // fill or a position. Anything else would be capital from nowhere.
    database.portfolioLedgerEntry.count({
      where: {
        portfolioId: portfolio.id,
        type: { not: PortfolioLedgerEntryType.INITIAL_CASH },
        shadowOrderId: null,
        shadowFillId: null,
        shadowPositionId: null,
        correctionOfId: null
      }
    }),
    checkInitialCapital(database, portfolio.id, participant.initialCapital),
    database.portfolioEquityPoint.findMany({
      where: { portfolioId: portfolio.id, asOf: { gte: forwardStart, lte: asOf } },
      orderBy: { asOf: "asc" },
      select: { equity: true }
    })
  ]);

  const { valuation } = await loadShadowPortfolioValuation(database, {
    portfolioId: portfolio.id,
    asOf,
    availableCash: portfolio.availableCash.toString(),
    reservedCash: portfolio.reservedCash.toString(),
    realizedPnl: portfolio.realizedPnl.toString(),
    feesPaid: portfolio.feesPaid.toString(),
    highWaterMark: portfolio.highWaterMark.toString(),
    startOfDayEquity: null
  });
  const equity = decimal(valuation.equity);

  // Capital curve since the forward start: initial capital, every hourly
  // point, the mark now. The high-water mark starts at the initial capital.
  let highWater = Number(participant.initialCapital);
  let maxDrawdownFraction = 0;
  for (const value of [...equityPoints.map((point) => Number(point.equity)), Number(equity)]) {
    highWater = Math.max(highWater, value);
    if (highWater > 0) maxDrawdownFraction = Math.max(maxDrawdownFraction, (highWater - value) / highWater);
  }

  const hardStopReasons: string[] = [];
  const notes: string[] = [];
  if (portfolio.status === PortfolioStatus.ERROR_LOCKED) hardStopReasons.push("PORTFOLIO_ERROR_LOCKED");
  if (session === null) hardStopReasons.push("SESSION_MISSING");
  else {
    if (session.status === TradingSessionStatus.ERROR_LOCKED) hardStopReasons.push("SESSION_ERROR_LOCKED");
    if (session.status === TradingSessionStatus.KILLED) hardStopReasons.push("SESSION_KILLED");
    if (session.killSwitchEngaged && session.killReasonCode !== null) hardStopReasons.push(`KILL_SWITCH:${session.killReasonCode}`);
    if (session.status !== TradingSessionStatus.SHADOW_ACTIVE) notes.push(`SESSION_${session.status}`);
  }
  if (criticalEvents > 0) hardStopReasons.push("CRITICAL_RISK_EVENTS");
  if (assignments.some((entry) => entry.strategyVersionId !== participant.strategyVersionId)) {
    hardStopReasons.push("STRATEGY_VERSION_DRIFT");
  }
  if (participant.strategyVersion.specificationHash !== participant.specificationHash) {
    hardStopReasons.push("STRATEGY_SPECIFICATION_DRIFT");
  }
  if (assignments.length === 0) notes.push("NO_ENABLED_ASSIGNMENT");
  if (initialCapitalIssue !== null || !portfolio.startingCash.equals(participant.initialCapital)) {
    hardStopReasons.push("CAPITAL_INTEGRITY_INITIAL_CASH");
  }
  if (unexplainedEntries > 0) hardStopReasons.push("CAPITAL_INTEGRITY_UNEXPLAINED_ENTRY");

  const activity = await loadPortfolioForwardActivity(database, {
    portfolioId: portfolio.id,
    assignmentIds: assignments.map((entry) => entry.id),
    forwardStart,
    asOf
  });
  if (activity.tradesBeforeForwardStart > 0) notes.push("TRADES_BEFORE_FORWARD_START_IGNORED");

  return {
    forwardDays: Math.max(0, (asOf.getTime() - forwardStart.getTime()) / DAY_MS),
    equity,
    maxDrawdownFraction,
    activity,
    hardStopReasons,
    notes
  };
}

function fitnessInput(participant: ParticipantRow, facts: ArenaParticipantFacts) {
  const metrics = facts.activity.metrics;
  const value = (metric: { value: string | null } | undefined) => numberOrNull(metric?.value ?? null);
  const winRatePct = value(metrics?.winRatePct);
  return {
    initialCapital: Number(participant.initialCapital),
    equity: Number(facts.equity),
    forwardDays: facts.forwardDays,
    closedTrades: metrics?.closedTrades ?? 0,
    wins: metrics?.wins ?? 0,
    losses: metrics?.losses ?? 0,
    maxDrawdownFraction: facts.maxDrawdownFraction,
    profitFactor: value(metrics?.profitFactor),
    averageR: value(metrics?.averageR),
    winRate: winRatePct === null ? null : winRatePct / 100,
    averageWin: value(metrics?.averageWin),
    averageLoss: value(metrics?.averageLoss),
    maxLossStreak: metrics?.maxLossStreak ?? 0,
    costs: Number(metrics?.fees ?? "0") + Number(metrics?.simulatedExecutionCost ?? "0"),
    closedNetPnl: Number(metrics?.netPnl ?? "0"),
    exposureFraction: value(metrics?.exposurePct) === null ? null : value(metrics?.exposurePct)! / 100
  };
}

export interface ArenaEvaluationSummaryEntry {
  readonly participantKey: string;
  readonly outcome: "WRITTEN" | "ALREADY_EVALUATED" | "SKIPPED" | "FAILED";
  readonly fitness: number | null;
  readonly evidence: string | null;
  readonly recommendation: string | null;
  readonly rank: number | null;
  readonly message?: string;
}

/**
 * Evaluates every participant with a running forward test, ranks the cohort
 * and appends one evaluation per participant. Idempotent per (participant,
 * asOf). One participant that cannot be valued (e.g. a missing candle) is
 * reported and skipped; it never stops the others or writes a guess.
 */
export async function evaluateArenaCohort(
  database: PrismaClient,
  input: { readonly cohortKey: string; readonly asOf: Date; readonly codeVersion: string }
): Promise<ArenaOpsResult<{ readonly entries: readonly ArenaEvaluationSummaryEntry[] }>> {
  const cohort = await database.arenaCohort.findUnique({ where: { key: input.cohortKey } });
  if (cohort === null) return fail("ARENA_COHORT_NOT_FOUND", `No arena cohort ${input.cohortKey}.`);
  const policy = parseArenaPolicy(cohort.policyJson);
  const participants = await database.arenaParticipant.findMany({
    where: { cohortId: cohort.id },
    include: { portfolio: true, strategyVersion: true },
    orderBy: { createdAt: "asc" }
  });

  const summary: ArenaEvaluationSummaryEntry[] = [];
  const evaluated: Array<{
    participant: ParticipantRow;
    facts: ArenaParticipantFacts;
    fitness: ArenaFitnessResult;
    survivalFloorBreached: boolean;
    entry: ArenaCohortEntry;
  }> = [];

  for (const participant of participants) {
    if (participant.status === "RETIRED" || participant.status === "CANDIDATE" || participant.forwardStartAt === null) {
      summary.push({
        participantKey: participant.participantKey,
        outcome: "SKIPPED",
        fitness: null,
        evidence: null,
        recommendation: null,
        rank: null,
        message: participant.status === "RETIRED" ? "Retired participants are no longer evaluated." : "Forward test not started."
      });
      continue;
    }
    try {
      const facts = await collectArenaParticipantFacts(database, participant, input.asOf);
      const fitness = computeArenaFitness(fitnessInput(participant, facts), policy);
      const survivalFloorBreached = facts.equity.lessThan(
        participant.initialCapital.mul(policy.survival.floorFraction)
      );
      const recommendation = recommendArenaAction(
        {
          status: participant.status,
          evidence: fitness.evidence,
          fitness: fitness.fitness,
          netPnl: Number(facts.equity.minus(participant.initialCapital)),
          survivalFloorBreached,
          hardStopReasons: facts.hardStopReasons
        },
        policy
      );
      evaluated.push({
        participant,
        facts,
        fitness,
        survivalFloorBreached,
        entry: {
          participantId: participant.id,
          participantKey: participant.participantKey,
          status: participant.status,
          evidence: fitness.evidence.status,
          fitness: fitness.fitness,
          rawFitness: fitness.rawFitness,
          recommendation
        }
      });
    } catch (error) {
      summary.push({
        participantKey: participant.participantKey,
        outcome: "FAILED",
        fitness: null,
        evidence: null,
        recommendation: null,
        rank: null,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const entries = evaluated.map((item) => item.entry);
  const ranks = rankArenaCohort(entries);
  const recommendations = applyChampionSuccession(entries, policy);
  const policyHash = cohort.policyHash;

  for (const item of evaluated) {
    const recommendation = recommendations.get(item.participant.id) ?? item.entry.recommendation;
    const rank = ranks.get(item.participant.id) ?? null;
    const outcome = await persistArenaEvaluation(database, {
      cohortId: cohort.id,
      policy,
      policyHash,
      asOf: input.asOf,
      codeVersion: input.codeVersion,
      participant: item.participant,
      facts: item.facts,
      fitness: item.fitness,
      survivalFloorBreached: item.survivalFloorBreached,
      recommendation,
      rank
    });
    summary.push({
      participantKey: item.participant.participantKey,
      outcome,
      fitness: item.fitness.fitness,
      evidence: item.fitness.evidence.status,
      recommendation: recommendation.recommendation,
      rank
    });
  }
  return { ok: true, result: { entries: summary } };
}

async function persistArenaEvaluation(
  database: PrismaClient,
  input: {
    readonly cohortId: string;
    readonly policy: ArenaPolicy;
    readonly policyHash: string;
    readonly asOf: Date;
    readonly codeVersion: string;
    readonly participant: ParticipantRow;
    readonly facts: ArenaParticipantFacts;
    readonly fitness: ArenaFitnessResult;
    readonly survivalFloorBreached: boolean;
    readonly recommendation: ArenaRecommendationResult;
    readonly rank: number | null;
  }
): Promise<"WRITTEN" | "ALREADY_EVALUATED"> {
  const { participant, facts, fitness } = input;
  const evaluationKey = buildSpecificationHash({ participantId: participant.id, asOf: input.asOf.toISOString() });
  const existing = await database.arenaEvaluation.findUnique({ where: { evaluationKey } });
  if (existing !== null) return "ALREADY_EVALUATED";

  const metrics = facts.activity.metrics;
  const equity = facts.equity;
  const netPnl = equity.minus(participant.initialCapital);
  const costs = decimal(metrics?.fees ?? "0").plus(metrics?.simulatedExecutionCost ?? "0");
  const metricsJson = storableJson({
    forward: metrics,
    equity: equity.toString(),
    maxDrawdownFraction: facts.maxDrawdownFraction,
    tradesBeforeForwardStart: facts.activity.tradesBeforeForwardStart,
    notes: facts.notes,
    hardStopReasons: facts.hardStopReasons,
    evidence: fitness.evidence,
    returnFraction: fitness.returnFraction,
    annualizedLogGrowth: fitness.annualizedLogGrowth,
    drawdownLog: fitness.drawdownLog,
    weightedScore: fitness.weightedScore,
    riskCeiling: fitness.riskCeiling,
    survivalFloor: participant.initialCapital.mul(input.policy.survival.floorFraction).toString()
  });
  const inputHash = buildSpecificationHash({
    participantId: participant.id,
    status: participant.status,
    strategyVersionId: participant.strategyVersionId,
    asOf: input.asOf.toISOString(),
    policyHash: input.policyHash,
    metrics: metricsJson
  });

  const previous = await database.arenaEvaluation.findFirst({
    where: { participantId: participant.id },
    orderBy: [{ asOf: "desc" }, { createdAt: "desc" }],
    select: { outputHash: true }
  });
  const reasonCodes = [...input.recommendation.reasonCodes, ...facts.notes];
  const stored = {
    evaluationKey,
    asOf: input.asOf,
    status: participant.status,
    evidenceStatus: fitness.evidence.status,
    equity,
    netPnl,
    rawFitness: decimal(fixed(fitness.rawFitness)!),
    fitness: decimal(fixed(fitness.fitness)!),
    rank: input.rank,
    recommendation: input.recommendation.recommendation,
    recommendedStatus: input.recommendation.targetStatus,
    reasonCodes,
    componentsJson: storableJson(fitness.components) as unknown,
    metricsJson: metricsJson as unknown
  };
  const previousOutputHash = previous?.outputHash ?? null;
  const outputHash = evaluationOutputHash({ ...stored, inputHash, previousOutputHash });

  try {
    await database.arenaEvaluation.create({
      data: {
        evaluationKey,
        participantId: participant.id,
        cohortId: input.cohortId,
        asOf: input.asOf,
        status: stored.status,
        policyVersion: input.policy.version,
        policyHash: input.policyHash,
        engineVersion: ARENA_EVALUATION_ENGINE_VERSION,
        codeVersion: input.codeVersion,
        evidenceStatus: stored.evidenceStatus,
        evidenceProgress: fixed(fitness.evidence.progress)!,
        forwardDays: fixed(facts.forwardDays)!,
        closedTrades: metrics?.closedTrades ?? 0,
        initialCapital: participant.initialCapital,
        equity,
        netPnl,
        returnPct: netPnl.div(participant.initialCapital).mul(100),
        logGrowth: fixed(fitness.logGrowth),
        maxDrawdownPct: fixed(facts.maxDrawdownFraction * 100)!,
        profitFactor: metrics?.profitFactor.value ?? null,
        averageR: metrics?.averageR.value ?? null,
        winRatePct: metrics?.winRatePct.value ?? null,
        maxLossStreak: metrics?.maxLossStreak ?? 0,
        costs,
        exposurePct: metrics?.exposurePct.value ?? null,
        rawFitness: stored.rawFitness,
        fitness: stored.fitness,
        rank: stored.rank,
        survivalFloorBreached: input.survivalFloorBreached,
        hardStop: facts.hardStopReasons.length > 0,
        recommendation: stored.recommendation,
        recommendedStatus: stored.recommendedStatus,
        reasonCodes,
        componentsJson: asJson(stored.componentsJson),
        metricsJson: asJson(stored.metricsJson),
        inputHash,
        previousOutputHash,
        outputHash
      }
    });
  } catch (error) {
    // A concurrent run wrote the same (participant, asOf) first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "ALREADY_EVALUATED";
    throw error;
  }
  return "WRITTEN";
}

/** Recomputes every output hash of a participant's chain; false at the first break. */
export async function verifyArenaEvaluationChain(
  database: PrismaClient,
  participantId: string
): Promise<{ readonly ok: boolean; readonly checked: number; readonly brokenAt: string | null }> {
  const rows = await database.arenaEvaluation.findMany({
    where: { participantId },
    orderBy: [{ asOf: "asc" }, { createdAt: "asc" }]
  });
  let previous: string | null = null;
  for (const row of rows) {
    if (row.previousOutputHash !== previous || recomputeOutputHash(row) !== row.outputHash) {
      return { ok: false, checked: rows.length, brokenAt: row.id };
    }
    previous = row.outputHash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}

/**
 * The hash covers every stored field a reader relies on, in the exact form the
 * database returns it (decimals at their column scale, JSON as stored), so a
 * later recomputation from the row reproduces it bit for bit.
 */
function evaluationOutputHash(row: {
  readonly evaluationKey: string;
  readonly asOf: Date;
  readonly status: string;
  readonly evidenceStatus: string;
  readonly equity: Prisma.Decimal;
  readonly netPnl: Prisma.Decimal;
  readonly rawFitness: Prisma.Decimal;
  readonly fitness: Prisma.Decimal;
  readonly rank: number | null;
  readonly recommendation: string;
  readonly recommendedStatus: string | null;
  readonly reasonCodes: readonly string[];
  readonly componentsJson: unknown;
  readonly metricsJson: unknown;
  readonly inputHash: string;
  readonly previousOutputHash: string | null;
}): string {
  return buildSpecificationHash({
    evaluationKey: row.evaluationKey,
    asOf: row.asOf.toISOString(),
    status: row.status,
    evidenceStatus: row.evidenceStatus,
    equity: row.equity.toFixed(12),
    netPnl: row.netPnl.toFixed(12),
    rawFitness: row.rawFitness.toFixed(12),
    fitness: row.fitness.toFixed(12),
    rank: row.rank,
    recommendation: row.recommendation,
    recommendedStatus: row.recommendedStatus,
    reasonCodes: [...row.reasonCodes],
    components: row.componentsJson,
    metrics: row.metricsJson,
    inputHash: row.inputHash,
    previousOutputHash: row.previousOutputHash
  });
}

function recomputeOutputHash(row: ArenaEvaluationRow): string {
  return evaluationOutputHash(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle transitions (operator commands) and post-mortems
// ─────────────────────────────────────────────────────────────────────────────

export interface TransitionArenaParticipantInput {
  readonly participantId: string;
  readonly to: ArenaParticipantStatus;
  readonly reason: ArenaTransitionReason;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly note?: string;
  readonly asOf: Date;
}

/**
 * One explicit status change, checked against the newest evaluation's
 * evidence, survival floor and hard stops. PROBATION and RETIRED open a
 * post-mortem case with a frozen dossier. RETIRED additionally requires the
 * participant's session to be stopped first — the arena never stops trading
 * on its own.
 */
export async function transitionArenaParticipant(
  database: PrismaClient,
  input: TransitionArenaParticipantInput
): Promise<ArenaOpsResult<{ readonly participantId: string; readonly status: ArenaParticipantStatus; readonly postMortemId: string | null }>> {
  if (input.actorId.trim() === "" || input.idempotencyKey.trim() === "") {
    return fail("ARENA_OPERATOR_INPUT_REQUIRED", "Operator and idempotency key are required.");
  }
  const participant = await database.arenaParticipant.findUnique({ where: { id: input.participantId } });
  if (participant === null) return fail("ARENA_PARTICIPANT_NOT_FOUND", `No arena participant ${input.participantId}.`);
  const eventKey = `arena-transition:${buildSpecificationHash({ participantId: participant.id, idempotencyKey: input.idempotencyKey })}`;
  const replay = await database.arenaParticipantEvent.findUnique({ where: { eventKey } });
  if (replay !== null) return { ok: true, result: { participantId: participant.id, status: replay.toStatus, postMortemId: null } };

  const [latest, otherChampion, session] = await Promise.all([
    database.arenaEvaluation.findFirst({
      where: { participantId: participant.id },
      orderBy: [{ asOf: "desc" }, { createdAt: "desc" }]
    }),
    database.arenaParticipant.findFirst({
      where: { cohortId: participant.cohortId, status: "CHAMPION", id: { not: participant.id } }
    }),
    database.tradingSession.findFirst({
      where: { portfolioId: participant.portfolioId, status: { not: TradingSessionStatus.CLOSED } },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const guard = checkArenaTransition(participant.status, input.to, {
    reason: input.reason,
    evidence: latest === null ? null : (latest.evidenceStatus as ArenaEvidenceStatus),
    survivalFloorBreached: latest?.survivalFloorBreached ?? false,
    hardStop: latest?.hardStop ?? false,
    forwardStarted: session?.status === TradingSessionStatus.SHADOW_ACTIVE && session.startedAt !== null,
    cohortHasOtherChampion: otherChampion !== null
  });
  if (!guard.ok) return guard;
  if (input.to === ArenaParticipantStatus.RETIRED && session?.status === TradingSessionStatus.SHADOW_ACTIVE) {
    return fail("ARENA_SESSION_STILL_ACTIVE", "Pause the participant's session before retiring it; the arena never stops trading itself.");
  }

  const forwardStartAt =
    participant.status === "CANDIDATE" && input.to === "ACTIVE" ? (session?.startedAt ?? null) : participant.forwardStartAt;
  await database.$transaction(async (tx) => {
    const changed = await tx.arenaParticipant.updateMany({
      where: { id: participant.id, version: participant.version, status: participant.status },
      data: { status: input.to, statusChangedAt: input.asOf, forwardStartAt, version: { increment: 1 } }
    });
    if (changed.count !== 1) throw new Error(`Arena participant ${participant.id} changed concurrently.`);
    await tx.arenaParticipantEvent.create({
      data: {
        eventKey,
        participantId: participant.id,
        eventType: "STATUS_CHANGED",
        fromStatus: participant.status,
        toStatus: input.to,
        reasonCode: input.reason,
        note: input.note ?? null,
        actorType: TradingActorType.ADMIN,
        actorId: input.actorId,
        evaluationId: latest?.id ?? null,
        payloadJson: asJson({
          evidence: latest?.evidenceStatus ?? null,
          fitness: latest?.fitness.toString() ?? null,
          recommendation: latest?.recommendation ?? null,
          equity: latest?.equity.toString() ?? null
        }),
        occurredAt: input.asOf
      }
    });
  });

  let postMortemId: string | null = null;
  if (input.to === ArenaParticipantStatus.PROBATION || input.to === ArenaParticipantStatus.RETIRED) {
    const opened = await openArenaPostMortem(database, {
      participantId: participant.id,
      triggerStatus: input.to,
      triggerEvaluationId: latest?.id ?? null,
      actorId: input.actorId,
      asOf: input.asOf
    });
    postMortemId = opened.ok ? opened.result.postMortemId : null;
  }
  return { ok: true, result: { participantId: participant.id, status: input.to, postMortemId } };
}

/**
 * Freezes the evidence a later analysis works from: the strategy version,
 * every forward trade with costs, R, exit reason and the regime it was
 * entered in, the strategy's refusals by reason, the regime timeline, the
 * daily capital curve and the arena's own evaluations and lifecycle.
 * Deterministic for a given database state and asOf.
 */
export async function buildArenaPostMortemDossier(
  database: PrismaClient,
  participantId: string,
  asOf: Date
): Promise<Record<string, unknown> | null> {
  const participant = await database.arenaParticipant.findUnique({
    where: { id: participantId },
    include: { strategyVersion: true, portfolio: true, cohort: true, events: { orderBy: { occurredAt: "asc" } } }
  });
  if (participant === null) return null;
  const from = participant.forwardStartAt ?? participant.createdAt;
  const assignmentIds = (
    await database.strategyAssignment.findMany({
      where: { portfolioId: participant.portfolioId, strategyVersionId: participant.strategyVersionId },
      select: { id: true }
    })
  ).map((entry) => entry.id);

  const [positions, evaluations, regimes, equityPoints, refusals, candidates] = await Promise.all([
    database.shadowPosition.findMany({
      where: { portfolioId: participant.portfolioId, openedAt: { gte: from, lte: asOf } },
      include: {
        asset: true,
        entryOrder: {
          include: {
            tradeCandidate: {
              include: { riskAssessments: { where: { status: "PASS" }, orderBy: { assessedAt: "desc" }, take: 1 } }
            }
          }
        },
        fills: { orderBy: { occurredAt: "asc" } }
      },
      orderBy: { openedAt: "asc" }
    }),
    database.arenaEvaluation.findMany({
      where: { participantId: participant.id, asOf: { lte: asOf } },
      orderBy: { asOf: "asc" }
    }),
    database.marketRegimeSnapshot.findMany({
      where: { generatedAt: { gte: new Date(from.getTime() - DAY_MS), lte: asOf } },
      orderBy: { generatedAt: "asc" },
      select: { generatedAt: true, overallRegime: true, reportJson: true }
    }),
    database.portfolioEquityPoint.findMany({
      where: { portfolioId: participant.portfolioId, asOf: { gte: from, lte: asOf } },
      orderBy: { asOf: "asc" },
      select: { asOf: true, equity: true, drawdownPct: true }
    }),
    database.tradingAuditEvent.groupBy({
      by: ["reasonCode"],
      where: {
        eventType: "STRATEGY_EVALUATION_REJECTED",
        occurredAt: { gte: from, lte: asOf },
        aggregateId: { in: assignmentIds }
      },
      _count: { _all: true }
    }),
    database.tradeCandidate.groupBy({
      by: ["status"],
      where: { portfolioId: participant.portfolioId, createdAt: { gte: from, lte: asOf } },
      _count: { _all: true }
    })
  ]);

  const lastPerDay = <T extends { asOf: Date }>(rows: readonly T[]): T[] => {
    const byDay = new Map<string, T>();
    for (const row of rows) byDay.set(row.asOf.toISOString().slice(0, 10), row);
    return [...byDay.values()];
  };
  const regimeOf = (snapshotJson: unknown) => {
    const regime = (snapshotJson as { marketRegime?: Record<string, unknown> } | null)?.marketRegime ?? null;
    return regime === null
      ? null
      : {
          source: regime.source ?? null,
          cryptoRegime: regime.cryptoRegime ?? null,
          riskMode: regime.riskMode ?? null,
          confidence: regime.confidence ?? null,
          overallRegime: regime.overallRegime ?? null
        };
  };

  const dossier = {
    dossierVersion: ARENA_DOSSIER_VERSION,
    asOf: asOf.toISOString(),
    participant: {
      id: participant.id,
      participantKey: participant.participantKey,
      cohortKey: participant.cohort.key,
      cohortPhase: participant.cohort.phase,
      cohortPolicyHash: participant.cohort.policyHash,
      status: participant.status,
      forwardStartAt: participant.forwardStartAt?.toISOString() ?? null,
      initialCapital: participant.initialCapital.toString(),
      portfolioKey: participant.portfolio.key,
      parentParticipantId: participant.parentParticipantId
    },
    strategy: {
      strategyKey: participant.strategyKey,
      strategyVersionId: participant.strategyVersionId,
      version: participant.strategyVersion.version,
      engineVersion: participant.strategyVersion.engineVersion,
      specificationHash: participant.strategyVersion.specificationHash,
      parameters: participant.strategyVersion.parametersJson
    },
    lifecycle: participant.events.map((event) => ({
      occurredAt: event.occurredAt.toISOString(),
      eventType: event.eventType,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reasonCode: event.reasonCode,
      actorId: event.actorId,
      note: event.note
    })),
    trades: positions.map((position) => {
      const candidate = position.entryOrder.tradeCandidate;
      const plannedRisk = candidate?.riskAssessments[0]?.riskAmount ?? null;
      const exit = [...position.fills].reverse().find((fill) => fill.triggerType !== "ENTRY") ?? null;
      return {
        positionId: position.id,
        symbol: position.asset.symbol,
        direction: position.direction,
        status: position.status,
        openedAt: position.openedAt?.toISOString() ?? null,
        closedAt: position.closedAt?.toISOString() ?? null,
        holdHours:
          position.openedAt !== null && position.closedAt !== null
            ? (position.closedAt.getTime() - position.openedAt.getTime()) / 3_600_000
            : null,
        quantity: position.initialQuantity.toString(),
        averageEntryPrice: position.averageEntryPrice.toString(),
        averageExitPrice: position.averageExitPrice?.toString() ?? null,
        stopPrice: position.stopPrice.toString(),
        takeProfitPrice: position.takeProfitPrice.toString(),
        netPnl: position.realizedPnl.toString(),
        fees: position.feesPaid.toString(),
        spreadAndSlippage: position.fills
          .reduce((sum, fill) => sum.plus(fill.slippageAmount.mul(fill.quantity)), decimal(0))
          .toString(),
        plannedRisk: plannedRisk?.toString() ?? null,
        rMultiple:
          plannedRisk !== null && !plannedRisk.isZero() && position.closedAt !== null
            ? position.realizedPnl.div(plannedRisk).toFixed(4)
            : null,
        exitReason: exit?.triggerType ?? null,
        regimeAtEntry: regimeOf(candidate?.inputSnapshotJson ?? null)
      };
    }),
    strategyRefusals: refusals
      .map((row) => ({ reasonCode: row.reasonCode, count: row._count._all }))
      .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode)),
    candidatesByStatus: candidates
      .map((row) => ({ status: row.status, count: row._count._all }))
      .sort((left, right) => left.status.localeCompare(right.status)),
    regimeTimeline: regimes.map((snapshot) => {
      const native = (snapshot.reportJson as { cryptoNative?: Record<string, unknown> } | null)?.cryptoNative ?? null;
      return {
        generatedAt: snapshot.generatedAt.toISOString(),
        overallRegime: snapshot.overallRegime,
        cryptoNative:
          native === null
            ? null
            : { cryptoRegime: native.cryptoRegime ?? null, riskMode: native.riskMode ?? null, confidence: native.confidence ?? null }
      };
    }),
    capitalCurveDaily: lastPerDay(equityPoints).map((point) => ({
      asOf: point.asOf.toISOString(),
      equity: point.equity.toString(),
      drawdownPct: point.drawdownPct.toString()
    })),
    evaluationsDaily: lastPerDay(evaluations).map((evaluation) => ({
      asOf: evaluation.asOf.toISOString(),
      status: evaluation.status,
      evidenceStatus: evaluation.evidenceStatus,
      fitness: evaluation.fitness.toString(),
      rawFitness: evaluation.rawFitness.toString(),
      equity: evaluation.equity.toString(),
      maxDrawdownPct: evaluation.maxDrawdownPct.toString(),
      closedTrades: evaluation.closedTrades,
      recommendation: evaluation.recommendation,
      reasonCodes: evaluation.reasonCodes,
      outputHash: evaluation.outputHash
    }))
  };
  return dossier;
}

/** Opens (idempotently per participant, status and day) a case with a frozen dossier. */
export async function openArenaPostMortem(
  database: PrismaClient,
  input: {
    readonly participantId: string;
    readonly triggerStatus: ArenaParticipantStatus;
    readonly triggerEvaluationId: string | null;
    readonly actorId: string;
    readonly asOf: Date;
  }
): Promise<ArenaOpsResult<{ readonly postMortemId: string; readonly created: boolean; readonly dossierHash: string }>> {
  const dossier = await buildArenaPostMortemDossier(database, input.participantId, input.asOf);
  if (dossier === null) return fail("ARENA_PARTICIPANT_NOT_FOUND", `No arena participant ${input.participantId}.`);
  const dossierHash = buildSpecificationHash(dossier);
  const caseKey = buildSpecificationHash({
    participantId: input.participantId,
    triggerStatus: input.triggerStatus,
    day: input.asOf.toISOString().slice(0, 10)
  });
  const existing = await database.arenaPostMortem.findUnique({ where: { caseKey } });
  if (existing !== null) {
    return { ok: true, result: { postMortemId: existing.id, created: false, dossierHash: existing.dossierHash } };
  }
  const created = await database.arenaPostMortem.create({
    data: {
      caseKey,
      participantId: input.participantId,
      triggerStatus: input.triggerStatus,
      triggerEvaluationId: input.triggerEvaluationId,
      dossierVersion: ARENA_DOSSIER_VERSION,
      dossierJson: asJson(dossier),
      dossierHash,
      createdBy: input.actorId
    }
  });
  return { ok: true, result: { postMortemId: created.id, created: true, dossierHash } };
}

/** Records the analysis' hypothesis and the proposed successor version (no code change). */
export async function recordArenaPostMortemHypothesis(
  database: PrismaClient,
  input: {
    readonly postMortemId: string;
    readonly author: string;
    readonly hypothesis: string;
    readonly proposedStrategyKey?: string;
    readonly proposedSpecificationHash?: string;
    readonly asOf: Date;
  }
): Promise<ArenaOpsResult<{ readonly postMortemId: string }>> {
  if (input.hypothesis.trim() === "" || input.author.trim() === "") {
    return fail("ARENA_HYPOTHESIS_REQUIRED", "A hypothesis and its author are required.");
  }
  const updated = await database.arenaPostMortem.updateMany({
    where: { id: input.postMortemId, status: "OPEN" },
    data: {
      status: "HYPOTHESIS_RECORDED",
      hypothesis: input.hypothesis,
      hypothesisAuthor: input.author,
      hypothesisRecordedAt: input.asOf,
      proposedStrategyKey: input.proposedStrategyKey ?? null,
      proposedSpecificationHash: input.proposedSpecificationHash ?? null
    }
  });
  return updated.count === 1
    ? { ok: true, result: { postMortemId: input.postMortemId } }
    : fail("ARENA_POST_MORTEM_NOT_OPEN", `Post-mortem ${input.postMortemId} is not OPEN.`);
}

export { ArenaParticipantStatus, ArenaRecommendation, ArenaTransitionReason };
