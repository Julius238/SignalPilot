/**
 * Read model of the Evolution Engine for the dashboard (Trading → Evolution).
 *
 * Read-only and separate from every forward-evidence read model: it reads
 * only the Evolution* tables, never a portfolio, session, order or arena
 * row. Everything it returns is historical research. A database without the
 * evolution migration yields `available: false` instead of an error, so the
 * page degrades cleanly wherever the engine is not deployed.
 */

import type { PrismaClient } from "@signalpilot/database";

type Json = Record<string, unknown>;

const MISSING_TABLE = "P2021";
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

interface MetricSubset {
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  averageR: number | null;
  expectancy: number | null;
  netReturnPct: number | null;
  annualizedReturnPct: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  exposurePct: number | null;
  averageHoldHours: number | null;
  tradesPerYear: number | null;
  costShareOfGrossProfitPct: number | null;
  stressedAverageR: number | null;
  stressedNetPnl: number | null;
  buyAndHoldReturnPct: number | null;
  buyAndHoldMaxDrawdownPct: number | null;
  tStatR: number | null;
}

function metrics(value: unknown): MetricSubset | null {
  if (value === null || typeof value !== "object") return null;
  const m = value as Json & { stressed?: Json };
  return {
    trades: Number(m.trades ?? 0),
    winRatePct: num(m.winRatePct),
    profitFactor: num(m.profitFactor),
    averageR: num(m.averageR),
    expectancy: num(m.expectancy),
    netReturnPct: num(m.netReturnPct),
    annualizedReturnPct: num(m.annualizedReturnPct),
    maxDrawdownPct: num(m.maxDrawdownPct),
    sharpe: num(m.sharpe),
    sortino: num(m.sortino),
    calmar: num(m.calmar),
    exposurePct: num(m.exposurePct),
    averageHoldHours: num(m.averageHoldHours),
    tradesPerYear: num(m.tradesPerYear),
    costShareOfGrossProfitPct: num(m.costShareOfGrossProfitPct),
    stressedAverageR: num(m.stressed?.averageR),
    stressedNetPnl: num(m.stressed?.netPnl),
    buyAndHoldReturnPct: num(m.buyAndHoldReturnPct),
    buyAndHoldMaxDrawdownPct: num(m.buyAndHoldMaxDrawdownPct),
    tStatR: num(m.tStatR)
  };
}

interface GateDto {
  gate: string;
  stage: string;
  passed: boolean;
  /** Gates v3: sub-check of the path that did not carry the decision — shown, never blocking. */
  informational: boolean;
  reasonCode: string;
  message: string;
}

const gatesOf = (value: unknown): GateDto[] =>
  Array.isArray(value)
    ? value.map((gate: Json) => ({
        gate: String(gate.gate),
        stage: String(gate.stage),
        passed: gate.passed === true,
        informational: gate.informational === true,
        reasonCode: String(gate.reasonCode),
        message: String(gate.message)
      }))
    : [];

function isMissingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === MISSING_TABLE;
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getEvolutionOverview(db: PrismaClient, now: Date = new Date()) {
  try {
    return await buildOverview(db, now);
  } catch (error) {
    if (isMissingTable(error)) return { available: false as const, asOf: now.toISOString(), reason: "Die Evolution-Tabellen existieren in dieser Datenbank noch nicht (Migration nicht angewendet)." };
    throw error;
  }
}

async function buildOverview(db: PrismaClient, now: Date) {
  const month = now.toISOString().slice(0, 7);
  const [state, runs, hypotheses, candidates, callsMonth, callsAll, exposureGroups, lastCall] = await Promise.all([
    db.evolutionAgentState.findUnique({ where: { key: "EVOLUTION_V1" } }),
    db.evolutionRun.findMany({ orderBy: { startedAt: "desc" }, take: 12 }),
    db.evolutionHypothesis.findMany({ orderBy: { createdAt: "desc" }, take: 16, include: { candidate: { select: { candidateKey: true, status: true } }, run: { select: { runKey: true } } } }),
    db.evolutionCandidate.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { hypothesis: { select: { title: true } } } }),
    db.evolutionAiCall.groupBy({ by: ["billable"], where: { budgetMonth: month }, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _count: true }),
    db.evolutionAiCall.groupBy({ by: ["billable"], _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _count: true }),
    db.evolutionDataExposure.groupBy({ by: ["windowKey", "purpose"], _count: true }),
    db.evolutionAiCall.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, requestedModel: true, servedModel: true, provider: true } })
  ]);
  const latestRun = runs[0] ?? null;
  const manifest = (latestRun?.dataManifestJson as Json | undefined) ?? null;
  const budgetConfig = (manifest?.budget as { monthlyBudgetUsd?: number; perRunBudgetUsd?: number } | undefined) ?? {};
  const monthlyBudgetUsd = budgetConfig.monthlyBudgetUsd ?? 20;
  const sumOf = (rows: typeof callsMonth, billable: boolean) => {
    const row = rows.find((entry) => entry.billable === billable);
    return { usd: Number(row?._sum.costUsd ?? 0), calls: row?._count ?? 0, inputTokens: row?._sum.inputTokens ?? 0, outputTokens: row?._sum.outputTokens ?? 0 };
  };
  const spentMonth = sumOf(callsMonth, true);
  const benchmarks = ((latestRun?.analysisJson as Json | null)?.benchmarks as Record<string, Json> | undefined) ?? {};
  const championEntry = Object.entries(benchmarks).find(([, entry]) => entry.role === "CHAMPION");
  const championInSample = championEntry ? metrics(championEntry[1].inSample) : null;

  const candidateDtos = candidates.map((candidate) => {
    const m = (candidate.metricsJson as Json | null) ?? {};
    const inSample = metrics(m.inSample);
    const gates = gatesOf(candidate.gatesJson);
    return {
      key: candidate.candidateKey,
      family: candidate.family,
      generation: candidate.generation,
      parentKey: candidate.parentKey,
      rootStrategyKey: candidate.rootStrategyKey,
      status: candidate.status,
      statusReasons: candidate.statusReasons,
      researchScore: num(candidate.researchScore),
      evidenceGrade: candidate.evidenceGrade,
      hypothesisTitle: candidate.hypothesis?.title ?? null,
      changes: (candidate.changesJson as { parameter: string; from: unknown; to: unknown }[]) ?? [],
      windowsSeen: candidate.windowsSeen,
      holdoutEvaluated: candidate.holdoutEvaluated,
      createdAt: candidate.createdAt.toISOString(),
      proposedAt: iso(candidate.proposedAt),
      decidedAt: iso(candidate.decidedAt),
      decidedBy: candidate.decidedBy,
      discovery: metrics(m.discovery),
      validation: metrics(m.validation),
      inSample,
      holdout: metrics(m.holdout),
      versusChampion:
        inSample === null || championInSample === null
          ? null
          : {
              sharpeDelta: inSample.sharpe === null || championInSample.sharpe === null ? null : inSample.sharpe - championInSample.sharpe,
              averageRDelta: inSample.averageR === null || championInSample.averageR === null ? null : inSample.averageR - championInSample.averageR,
              netReturnDeltaPct: inSample.netReturnPct === null || championInSample.netReturnPct === null ? null : inSample.netReturnPct - championInSample.netReturnPct,
              maxDrawdownDeltaPct: inSample.maxDrawdownPct === null || championInSample.maxDrawdownPct === null ? null : inSample.maxDrawdownPct - championInSample.maxDrawdownPct
            },
      successorOf: ((m.successor as { rootKey?: string } | null | undefined)?.rootKey ?? null)?.replace(/^ROOT:/, "") ?? null,
      gateVersion: (m.gateVersion as string | undefined) ?? null,
      // Gates v3: the path that carried the decision (VALUE / DIVERSIFICATION), null when neither held.
      lineageChecked: m.lineage !== undefined && m.lineage !== null,
      lineagePath: ((m.lineage as { path?: string | null } | null | undefined)?.path ?? null) as string | null,
      gatesPassed: gates.filter((gate) => gate.passed && !gate.informational).length,
      gatesTotal: gates.filter((gate) => !gate.informational).length,
      failedGates: gates.filter((gate) => !gate.passed && !gate.informational)
    };
  });

  const exposure: Record<string, Record<string, number>> = {};
  for (const group of exposureGroups) {
    exposure[group.windowKey] ??= {};
    exposure[group.windowKey]![group.purpose] = group._count;
  }

  return {
    available: true as const,
    asOf: now.toISOString(),
    notice: "Historische Forschung. Kein Forward-Ergebnis, keine Prognose, keine Handelsempfehlung.",
    agent: {
      status: state?.status ?? "NOT_INITIALISED",
      statusReason: state?.statusReason ?? null,
      pausedUntil: iso(state?.pausedUntil),
      lastRunAt: iso(state?.lastRunAt),
      nextRunAt: iso(state?.nextRunAt),
      runInProgress: state?.leaseOwner !== null && state?.leaseOwner !== undefined && (state.leaseExpiresAt === null || state.leaseExpiresAt > now)
    },
    provider: latestRun === null ? null : { name: latestRun.providerName, billable: latestRun.billable, models: (manifest?.models as Json | undefined) ?? null, lastCall: lastCall && { at: lastCall.createdAt.toISOString(), model: lastCall.servedModel ?? lastCall.requestedModel, provider: lastCall.provider } },
    budget: {
      month,
      monthStart: monthStart(now).toISOString(),
      monthlyBudgetUsd,
      perRunBudgetUsd: budgetConfig.perRunBudgetUsd ?? 1,
      spentUsd: spentMonth.usd,
      remainingUsd: Math.max(0, monthlyBudgetUsd - spentMonth.usd),
      billableCallsThisMonth: spentMonth.calls,
      simulatedUsdThisMonth: sumOf(callsMonth, false).usd,
      totalSpentUsd: sumOf(callsAll, true).usd,
      totalBillableCalls: sumOf(callsAll, true).calls,
      totalTokens: { input: sumOf(callsAll, true).inputTokens + sumOf(callsAll, false).inputTokens, output: sumOf(callsAll, true).outputTokens + sumOf(callsAll, false).outputTokens }
    },
    split: manifest?.split ?? null,
    exposure,
    benchmarks: Object.fromEntries(
      Object.entries(benchmarks).map(([key, entry]) => [key, { label: entry.label, role: entry.role, strategyKey: entry.strategyKey, discovery: metrics(entry.discovery), validation: metrics(entry.validation), inSample: metrics(entry.inSample) }])
    ),
    runs: runs.map((run) => ({
      runKey: run.runKey,
      trigger: run.trigger,
      status: run.status,
      gatesVersion: ((run.dataManifestJson as Json | null)?.gatesVersion as string | undefined) ?? null,
      provider: run.providerName,
      billable: run.billable,
      startedAt: run.startedAt.toISOString(),
      finishedAt: iso(run.finishedAt),
      durationMs: run.finishedAt === null ? null : run.finishedAt.getTime() - run.startedAt.getTime(),
      hypothesesRequested: run.hypothesesRequested,
      candidatesGenerated: run.candidatesGenerated,
      candidatesRejected: run.candidatesRejected,
      candidatesProposed: run.candidatesProposed,
      aiInputTokens: run.aiInputTokens,
      aiOutputTokens: run.aiOutputTokens,
      aiCostUsd: Number(run.aiCostUsd),
      backtestCount: run.backtestCount,
      backtestMs: run.backtestMs,
      errorMessage: run.errorMessage,
      aiSummary: run.aiSummary,
      findings: (((run.analysisJson as Json | null)?.findings as { sentence: string }[] | undefined) ?? []).map((finding) => finding.sentence)
    })),
    hypotheses: hypotheses.map((hypothesis) => ({
      key: hypothesis.hypothesisKey,
      runKey: hypothesis.run.runKey,
      title: hypothesis.title,
      family: hypothesis.family,
      parentKey: hypothesis.parentKey,
      marketObservation: hypothesis.marketObservation,
      rationale: hypothesis.rationale,
      expectedEffect: hypothesis.expectedEffect,
      falsificationCriterion: hypothesis.falsificationCriterion,
      changes: hypothesis.changesJson,
      outcome: hypothesis.outcome,
      outcomeReasons: hypothesis.outcomeReasons,
      candidateKey: hypothesis.candidate?.candidateKey ?? null,
      candidateStatus: hypothesis.candidate?.status ?? null,
      createdAt: hypothesis.createdAt.toISOString()
    })),
    candidates: candidateDtos,
    lineage: candidateDtos.map((candidate) => ({ key: candidate.key, parentKey: candidate.parentKey, generation: candidate.generation, status: candidate.status, family: candidate.family })),
    awaitingApproval: candidateDtos.filter((candidate) => candidate.status === "PROPOSED").map((candidate) => candidate.key),
    approved: candidateDtos.filter((candidate) => candidate.status === "APPROVED_FOR_FORWARD_TEST").map((candidate) => candidate.key)
  };
}

export async function getEvolutionCandidate(db: PrismaClient, key: string) {
  try {
    const candidate = await db.evolutionCandidate.findUnique({
      where: { candidateKey: key },
      include: { hypothesis: true, run: { select: { runKey: true, providerName: true, billable: true, startedAt: true, dataManifestJson: true } }, backtests: { select: { subjectKey: true, role: true, symbol: true, windowKey: true, tradeCount: true, outputHash: true, durationMs: true, createdAt: true } } }
    });
    if (candidate === null) return null;
    const chain: string[] = [candidate.candidateKey];
    let parent = candidate.parentKey;
    for (let depth = 0; depth < 32 && parent.startsWith("EVO-"); depth += 1) {
      chain.unshift(parent);
      const row = await db.evolutionCandidate.findUnique({ where: { candidateKey: parent }, select: { parentKey: true } });
      if (row === null) break;
      parent = row.parentKey;
    }
    chain.unshift(parent.replace(/^ROOT:/, ""));
    const m = (candidate.metricsJson as Json | null) ?? {};
    const benchmarks = (m.benchmarks as Record<string, { inSample?: unknown; discovery?: unknown; validation?: unknown }> | undefined) ?? {};
    return {
      available: true as const,
      notice: "Historische Forschung. Kein Forward-Ergebnis, keine Prognose, keine Handelsempfehlung.",
      key: candidate.candidateKey,
      family: candidate.family,
      generation: candidate.generation,
      parentKey: candidate.parentKey,
      rootStrategyKey: candidate.rootStrategyKey,
      lineage: chain,
      status: candidate.status,
      statusReasons: candidate.statusReasons,
      researchScore: num(candidate.researchScore),
      score: candidate.scoreJson,
      evidenceGrade: candidate.evidenceGrade,
      evidence: m.evidence ?? null,
      genome: candidate.genomeJson,
      genomeHash: candidate.genomeHash,
      changes: candidate.changesJson,
      windowsSeen: candidate.windowsSeen,
      holdoutEvaluated: candidate.holdoutEvaluated,
      hypothesis: candidate.hypothesis && {
        title: candidate.hypothesis.title,
        marketObservation: candidate.hypothesis.marketObservation,
        rationale: candidate.hypothesis.rationale,
        expectedEffect: candidate.hypothesis.expectedEffect,
        falsificationCriterion: candidate.hypothesis.falsificationCriterion
      },
      run: { runKey: candidate.run.runKey, provider: candidate.run.providerName, billable: candidate.run.billable, startedAt: candidate.run.startedAt.toISOString() },
      metrics: { discovery: metrics(m.discovery), validation: metrics(m.validation), inSample: metrics(m.inSample), holdout: metrics(m.holdout) },
      benchmarks: Object.fromEntries(Object.entries(benchmarks).map(([key, entry]) => [key, { inSample: metrics(entry.inSample), discovery: metrics(entry.discovery), validation: metrics(entry.validation) }])),
      folds: m.folds ?? [],
      correlations: m.correlations ?? [],
      walkForward: m.walkForward ?? null,
      successor: m.successor ?? null,
      lineageCheck: m.lineage ?? null,
      // Candidates of v1 runs carry no version of their own; their run's manifest does.
      gateVersion: (m.gateVersion as string | undefined) ?? ((candidate.run.dataManifestJson as Json | null)?.gatesVersion as string | undefined) ?? null,
      neighbours: Array.isArray(m.neighbours) ? (m.neighbours as { key: string; inSample: unknown }[]).map((entry) => ({ key: entry.key, inSample: metrics(entry.inSample) })) : [],
      technical: candidate.technicalJson,
      gates: gatesOf(candidate.gatesJson),
      backtests: candidate.backtests.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
      decision: { proposedAt: iso(candidate.proposedAt), decidedAt: iso(candidate.decidedAt), decidedBy: candidate.decidedBy, note: candidate.decisionNote },
      reportMarkdown: candidate.reportMarkdown
    };
  } catch (error) {
    if (isMissingTable(error)) return { available: false as const };
    throw error;
  }
}
