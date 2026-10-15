/**
 * Persistence helpers of the research cycle: backtest cache, data-exposure
 * ledger, candidate sequence numbers and the history the AI may see.
 */

import { createHash } from "node:crypto";

import {
  EVOLUTION_COST_MODEL_V1,
  EVOLUTION_ENGINE_VERSION,
  genomeHash,
  type BacktestSummary,
  type CandidateGenome,
  type EvolutionFamily,
  type GateResult,
  type HistoryEntry,
  type ParameterDiff,
  type ScreeningVerdict,
  type DiscoverySnapshot
} from "@signalpilot/evolution";
import { SHADOW_REPLAY_ENGINE_VERSION } from "@signalpilot/shadow-replay";

import type { EvolutionDb } from "../database.js";
import type { BacktestJob } from "../backtest/execute.js";

export type BacktestRole = "BENCHMARK" | "CANDIDATE" | "NEIGHBOUR";
export type ExposurePurpose = "SEARCH" | "SELECTION" | "HOLDOUT_CHECK" | "BENCHMARK";

export function backtestCacheKey(input: { subjectHash: string; job: BacktestJob; dataFingerprint: string; codeVersion: string }): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        EVOLUTION_ENGINE_VERSION,
        SHADOW_REPLAY_ENGINE_VERSION,
        EVOLUTION_COST_MODEL_V1.key,
        input.codeVersion,
        input.dataFingerprint,
        input.subjectHash,
        input.job.symbol,
        input.job.windowKey,
        input.job.from,
        input.job.to,
        input.job.splitAt ?? null
      ])
    )
    .digest("hex");
}

export async function findCachedBacktest(db: EvolutionDb, cacheKey: string): Promise<BacktestSummary | null> {
  const row = await db.evolutionBacktest.findUnique({ where: { cacheKey } });
  return row === null ? null : (row.summaryJson as unknown as BacktestSummary);
}

export async function saveBacktest(
  db: EvolutionDb,
  input: { cacheKey: string; job: BacktestJob; summary: BacktestSummary; role: BacktestRole; candidateId: string | null; dataFingerprint: string; codeVersion: string }
): Promise<void> {
  const { job, summary } = input;
  await db.evolutionBacktest.upsert({
    where: { cacheKey: input.cacheKey },
    create: {
      cacheKey: input.cacheKey,
      subjectKey: job.subjectKey,
      candidateId: input.candidateId,
      role: input.role,
      symbol: job.symbol,
      windowKey: job.windowKey,
      fromAt: new Date(job.from),
      toAt: new Date(job.to),
      replayEngineVersion: summary.replayEngineVersion,
      codeVersion: input.codeVersion,
      dataFingerprint: input.dataFingerprint,
      costModel: EVOLUTION_COST_MODEL_V1.key,
      configJson: { subject: job.subject, splitAt: job.splitAt ?? null } as never,
      summaryJson: summary as never,
      outputHash: summary.outputHash,
      invariantViolations: summary.invariantViolations,
      tradeCount: summary.trades.length,
      durationMs: summary.durationMs
    },
    update: {}
  });
}

export async function recordExposure(
  db: EvolutionDb,
  input: { runId: string; windowKey: string; purpose: ExposurePurpose; subjectKey: string; candidateId: string | null; symbol: string; occurredAt: Date }
): Promise<void> {
  const exposureKey = `${input.runId}:${input.subjectKey}:${input.symbol}:${input.windowKey}:${input.purpose}`;
  await db.evolutionDataExposure.upsert({
    where: { exposureKey },
    create: { exposureKey, ...input },
    update: {}
  });
}

export async function nextSequence(db: EvolutionDb, family: EvolutionFamily): Promise<number> {
  const result = await db.evolutionCandidate.aggregate({ _max: { sequence: true }, where: { family } });
  return (result._max.sequence ?? 0) + 1;
}

/** Number of distinct configurations evaluated on discovery + validation so far (for the multiple-testing bar). */
export async function evaluatedConfigurations(db: EvolutionDb): Promise<number> {
  const rows = await db.evolutionBacktest.findMany({
    where: { role: { in: ["CANDIDATE", "NEIGHBOUR"] }, windowKey: "DISCOVERY_VALIDATION" },
    distinct: ["subjectKey"],
    select: { subjectKey: true }
  });
  return rows.length;
}

export interface StoredCandidateMetrics {
  readonly discovery?: DiscoverySnapshot & Record<string, unknown>;
}

/** Leak-free history for the research context: screening verdicts and discovery numbers only. */
export async function loadHistory(db: EvolutionDb, limit = 40): Promise<HistoryEntry[]> {
  const rows = await db.evolutionCandidate.findMany({
    where: { status: { notIn: ["INVALID", "DUPLICATE"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { hypothesis: { select: { title: true } } }
  });
  return rows.reverse().map((row) => {
    const gates = (row.gatesJson as unknown as GateResult[] | null) ?? [];
    const screening = gates.filter((gate) => gate.stage === "SCREENING");
    const verdict: ScreeningVerdict =
      screening.length === 0 ? "NOT_EVALUATED" : screening.every((gate) => gate.passed) ? "PASSED_SCREENING" : "FAILED_SCREENING";
    const metrics = (row.metricsJson as { discoverySnapshot?: DiscoverySnapshot } | null) ?? null;
    const genome = row.genomeJson as unknown as CandidateGenome;
    return {
      candidateKey: row.candidateKey,
      family: row.family as EvolutionFamily,
      parentKey: row.parentKey,
      generation: row.generation,
      hypothesis: row.hypothesis?.title ?? "",
      changes: (row.changesJson as unknown as ParameterDiff[]) ?? [],
      parameters: genome.parameters,
      verdict: row.status === "TECHNICAL_FAILED" ? "FAILED_SCREENING" : verdict,
      failedGates: row.status === "TECHNICAL_FAILED" ? ["TECHNICAL_TESTS_FAILED"] : screening.filter((gate) => !gate.passed).map((gate) => gate.reasonCode),
      discovery: metrics?.discoverySnapshot ?? null
    };
  });
}

/** Genome hashes of every neighbour variant evaluated so far (any gate version). */
export async function evaluatedNeighbourGenomeHashes(db: EvolutionDb): Promise<Set<string>> {
  const rows = await db.evolutionBacktest.findMany({ where: { role: "NEIGHBOUR" }, select: { configJson: true } });
  const hashes = new Set<string>();
  for (const row of rows) {
    const subject = (row.configJson as { subject?: { kind?: string; genome?: CandidateGenome } } | null)?.subject;
    if (subject?.kind === "GENOME" && subject.genome !== undefined) hashes.add(genomeHash(subject.genome));
  }
  return hashes;
}

/**
 * Successor screenings of a root in the calendar month (UTC) of `now`,
 * across earlier runs — the current run counts its own on top.
 */
export async function successorScreeningsThisMonth(db: EvolutionDb, rootStrategyKey: string, now: Date): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await db.evolutionCandidate.findMany({ where: { rootStrategyKey, createdAt: { gte: monthStart } }, select: { gatesJson: true } });
  return rows.filter((row) => ((row.gatesJson as unknown as GateResult[] | null) ?? []).some((gate) => gate.reasonCode === "ROUTED_TO_SUCCESSOR_CHECK")).length;
}
