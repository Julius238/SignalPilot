/**
 * One research cycle of the Evolution Engine V1 (docs/trading/20-evolution-engine.md):
 *
 *  1. analyse discovery data and completed results (benchmarks, history);
 *  2. find conditions that favoured or hurt the existing strategies;
 *  3. ask the AI for falsifiable hypotheses (leak-checked context, budget-guarded);
 *  4. turn each hypothesis into a versioned genome candidate — or refuse it;
 *  5. technical test, then backtests on discovery + validation (both symbols);
 *  6. reject automatically on any screening gate;
 *  7. finalists: neighbour robustness, rolling walk-forward, holdout; propose
 *     the survivors with full results and a report.
 *
 * Candidates of an independent family (gates v4, `FamilySpec.independence`)
 * are decided in step 5d by the portfolio path: comparison A (existing
 * strategies plus a cash reserve slot) once per run and window, comparison B
 * (the candidate on that slot) per candidate, both chronological portfolio
 * replays. Such a family needs gates v4; under v1–v3 it is refused. Its
 * pre-registered seed is evaluated by a cycle in seed mode (`options.seed`,
 * `evolution evaluate-seed`): no AI call, the seed instead of hypotheses,
 * every later step identical.
 *
 * The cycle never touches a trading, portfolio, session or arena table, and
 * never replays data from the official forward period.
 */

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import {
  AI_TASK_TIER,
  EVOLUTION_COST_MODEL_V1,
  EVOLUTION_DATA_SPLIT_V1,
  EVOLUTION_DATA_SPLIT_V1_HASH,
  EVOLUTION_ENGINE_VERSION,
  EVOLUTION_FAMILY_SEEDS,
  EVOLUTION_GATE_VERSIONS,
  EVOLUTION_ROOTS,
  FAMILY_SPECS,
  HYPOTHESIS_RESPONSE_SCHEMA,
  HYPOTHESIS_SYSTEM_PROMPT,
  PROMPT_VERSION,
  REVIEW_RESPONSE_SCHEMA,
  REVIEW_SYSTEM_PROMPT,
  STATUS_LABEL_DE,
  analyzeMarketConditions,
  applyChanges,
  assertContextLeakFree,
  buildResearchContext,
  candidateKeyFor,
  combineDailyEquity,
  correlationOfDailyReturns,
  diffGenomes,
  digestPortfolioSummary,
  discoverySnapshot,
  estimateInputTokens,
  evidenceGrade,
  familyResearchIdentity,
  finalGates,
  foldMetrics,
  curveStats,
  isBlockingFailure,
  isGatesV2,
  isGatesV3,
  lineageHoldoutGate,
  lineageRedundancyGate,
  lineageScreeningGates,
  pairedMonthlyTest,
  portfolioComparison,
  portfolioCurve,
  signalOverlap,
  routedRedundancyGate,
  successorHoldoutGate,
  successorRoute,
  successorScreeningGates,
  successorTThreshold,
  foldStability,
  genomeHash,
  genomeReplayPlan,
  independentFamilyStructure,
  isGatesV4,
  isIndependentFamily,
  lineageChain,
  neighbourGenomes,
  parseHypothesisResponse,
  parseReviewResponse,
  renderCandidateReport,
  renderHypothesisPrompt,
  renderRunReport,
  rollingWalkForward,
  rootByKey,
  researchScore,
  screeningGates,
  selectFinalists,
  statusAfterFinal,
  versionLabel,
  windowMetrics,
  worstCaseCallCost,
  type AiRequest,
  type AiTask,
  type BacktestSummary,
  type CandidateGenome,
  type CandidateStatus,
  type CompactTrade,
  type DailyBar,
  type DailyEquityPoint,
  type EvolutionDataSplit,
  type EvolutionFamily,
  type EvolutionGateSet,
  type FamilySeed,
  type GateResult,
  type GateResultV4,
  type LineageAssessment,
  type LineageReference,
  type LineageRole,
  type PairedMonthlyTest,
  type ParsedReview,
  type PortfolioCheckRecord,
  type PortfolioMemberSpec,
  type PortfolioSummary,
  type ResearchAiProvider,
  type WindowMetrics
} from "@signalpilot/evolution";

import { canonicalHash } from "@signalpilot/trading-domain";

import { callResearchAi } from "../ai/budgetedAi.js";
import type { BacktestJob, BacktestSubject, TechnicalResult } from "../backtest/execute.js";
import type { BacktestRunner } from "../backtest/pool.js";
import type { EvolutionWorkerConfig } from "../config.js";
import type { EvolutionDb } from "../database.js";
import type { Logger } from "../logger.js";
import { acquireRunLease, ensureAgentState, releaseExpiredBudgetPause, releaseRunLease, setAgentStatus } from "../persistence/agentState.js";
import { recordAuditEvent } from "../persistence/audit.js";
import { finalIndependentCandidate, screenIndependentCandidate, type PortfolioRunContext } from "./portfolioAssessment.js";
import { familySeed, independentSearchStatus, priorTrainingConfigurations, seedPreflight, type IndependentSearchStatus } from "./seed.js";
import {
  backtestCacheKey,
  evaluatedConfigurations,
  evaluatedNeighbourGenomeHashes,
  familyScreeningsThisMonth,
  findCachedBacktest,
  loadHistory,
  nextSequence,
  recordExposure,
  saveBacktest,
  successorScreeningsThisMonth,
  type BacktestRole,
  type ExposurePurpose
} from "../persistence/store.js";

export interface MarketInfo {
  readonly fingerprint: string;
  readonly cutoffAt: string;
  readonly files: readonly unknown[];
  readonly dir: string;
  /** Daily bars per symbol, from the first candle up to the end of DISCOVERY. */
  readonly discoveryBars: Readonly<Record<string, readonly DailyBar[]>>;
}

export interface CycleDeps {
  readonly db: EvolutionDb;
  readonly config: EvolutionWorkerConfig;
  readonly provider: ResearchAiProvider;
  readonly runner: BacktestRunner;
  readonly market: MarketInfo;
  readonly log: Pick<Logger, "info" | "warn" | "error">;
  readonly now: () => Date;
  readonly split?: EvolutionDataSplit;
  /** Pre-registered gates (default: the configured version); tests may inject lower thresholds to exercise the final stage. */
  readonly gates?: EvolutionGateSet;
  /**
   * Tests only: wraps the gates-v4 portfolio path, e.g. to force a screening
   * verdict so a short synthetic market can walk through the final stage
   * (whose OWN_ALPHA needs 36 months). Production always uses the real functions.
   */
  readonly portfolioPath?: { readonly screen?: typeof screenIndependentCandidate; readonly final?: typeof finalIndependentCandidate };
}

export interface CycleOptions {
  readonly trigger: "SCHEDULED" | "MANUAL";
  /** Run although the agent is PAUSED (never past a budget pause with a billable provider). */
  readonly force?: boolean;
  readonly nextRunAt?: Date | null;
  /**
   * Stage 1 of an independent family: evaluate its pre-registered seed
   * instead of asking the AI (`evolution evaluate-seed`). Runs while the agent
   * is paused, never with a billable provider, only under gates v4, once.
   */
  readonly seed?: EvolutionFamily;
}

export interface CycleOutcome {
  readonly status: "SKIPPED" | "COMPLETED" | "FAILED" | "ABORTED";
  readonly reason: string | null;
  readonly runKey: string | null;
  readonly candidates: readonly { readonly key: string; readonly status: CandidateStatus; readonly score: number | null }[];
  readonly aiCostUsd: number;
}

interface WorkingCandidate {
  id: string;
  key: string;
  family: EvolutionFamily;
  generation: number;
  parentKey: string;
  genome: CandidateGenome;
  hypothesisTitle: string;
  hypothesis: { title: string; marketObservation: string; rationale: string; expectedEffect: string; falsificationCriterion: string };
  changes: ReturnType<typeof diffGenomes>;
  status: CandidateStatus;
  reasons: string[];
  technical: TechnicalResult | null;
  backtests: BacktestSummary[];
  discovery: WindowMetrics | null;
  validation: WindowMetrics | null;
  inSample: WindowMetrics | null;
  holdout: WindowMetrics | null;
  screening: GateResult[];
  final: GateResult[];
  score: ReturnType<typeof researchScore> | null;
  correlations: { key: string; value: number | null }[];
  folds: ReturnType<typeof foldMetrics>;
  walkForward: ReturnType<typeof rollingWalkForward> | null;
  neighbours: { key: string; inSample: WindowMetrics }[];
  windowsSeen: Set<string>;
  /** `ROOT:<strategy key>` of the frozen root this lineage descends from. */
  rootKey: string;
  successor: {
    rootKey: string;
    correlation: number | null;
    candidateSharpe: number | null;
    referenceSharpe: number | null;
    paired: PairedMonthlyTest;
    threshold: number;
    trials: number;
    screeningsThisMonth: number;
  } | null;
  /** Gates v3: screening of this family on validation data this month, this candidate included. */
  familyScreening: number;
  /** Gates v3: lineage and diversification assessment, and the lineage references it was measured against. */
  lineage: LineageAssessment | null;
  lineageReferenceKeys: string[];
  /** The pre-registered seed of an independent family (stage 1). */
  isSeed: boolean;
  /** Gates v4: the portfolio path of an independent family. */
  portfolio: PortfolioCheckRecord | null;
}

/** An existing strategy the cycle compares with: a frozen root or an operator-approved candidate. */
interface ExistingStrategy {
  key: string;
  family: EvolutionFamily;
  subject: BacktestSubject;
  subjectHash: string;
  backtests: BacktestSummary[];
  metrics: { discovery: WindowMetrics; validation: WindowMetrics; inSample: WindowMetrics; folds: ReturnType<typeof foldMetrics>; stability: ReturnType<typeof foldStability> };
  curve: DailyEquityPoint[];
  startingCash: number;
  trades: CompactTrade[];
}

const skipped = (reason: string): CycleOutcome => ({ status: "SKIPPED", reason, runKey: null, candidates: [], aiCostUsd: 0 });
/** Gate results of v4 share `GateResult`'s shape; only the identifier union differs (v1's `GateId` stays unchanged). */
const asGateResults = (gates: readonly GateResultV4[]): GateResult[] => gates as unknown as GateResult[];
const PORTFOLIO_BASELINE_SUBJECT = "PORTFOLIO:A";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runResearchCycle(deps: CycleDeps, options: CycleOptions): Promise<CycleOutcome> {
  const { db, config, provider, log } = deps;
  const split = deps.split ?? EVOLUTION_DATA_SPLIT_V1;
  const gates = deps.gates ?? EVOLUTION_GATE_VERSIONS[config.gatesVersion];
  const gatesHash = canonicalHash(gates);
  const splitHash = split === EVOLUTION_DATA_SPLIT_V1 ? EVOLUTION_DATA_SPLIT_V1_HASH : canonicalHash(split);
  const startedAt = deps.now();
  const seed: FamilySeed | null = options.seed === undefined ? null : familySeed(options.seed);
  if (options.seed !== undefined && seed === null) return skipped(`${options.seed} hat kein vorregistriertes Startgenom.`);

  await releaseExpiredBudgetPause(db, startedAt);
  const state = await ensureAgentState(db);
  if (state.status === "DISABLED") return skipped("Agent ist deaktiviert.");
  if (state.status === "PAUSED_BUDGET" && provider.billable) return skipped(state.statusReason ?? "Monatsbudget ausgeschöpft.");
  // The seed evaluation is an operator command without AI: it runs while the agent is paused.
  if (state.status === "PAUSED" && options.force !== true && seed === null) return skipped("Agent ist pausiert.");
  if (seed !== null) {
    if (provider.billable) return skipped("Ein Startgenom wird ohne KI bewertet; ein abrechenbarer Anbieter ist nicht zulässig.");
    const preflight = await seedPreflight(db, { family: seed.family, gates, config, now: startedAt, split, requirePreregisteredGates: deps.gates === undefined });
    if (!preflight.ok) return skipped(`Startgenom ${seed.key} wird nicht bewertet: ${preflight.problems.join(" ")}`);
  }

  if (provider.billable) {
    // Do not even start the backtests of a cycle whose hypothesis call could not be paid.
    const worstCase = worstCaseCallCost(config.models.ADVANCED, estimateInputTokens(HYPOTHESIS_SYSTEM_PROMPT) + 20_000, config.maxOutputTokens.ADVANCED);
    const month = startedAt.toISOString().slice(0, 7);
    const spent = Number((await db.evolutionAiCall.aggregate({ _sum: { costUsd: true }, where: { billable: true, budgetMonth: month } }))._sum.costUsd ?? 0);
    if (config.monthlyBudgetUsd - spent < worstCase) {
      await setAgentStatus(db, {
        status: "PAUSED_BUDGET",
        reason: `Restbudget ${(config.monthlyBudgetUsd - spent).toFixed(4)} USD reicht nicht für einen Forschungsdurchlauf (bis ${worstCase.toFixed(4)} USD).`,
        actor: "budget-guard",
        actorType: "SYSTEM",
        pausedUntil: new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth() + 1, 1)),
        now: startedAt
      });
      return skipped("Monatsbudget reicht nicht für einen weiteren Durchlauf.");
    }
  }

  const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  if (!(await acquireRunLease(db, owner, startedAt, config.leaseMs))) return skipped("Ein anderer Forschungsdurchlauf läuft bereits.");

  const runKey = `EVO-RUN-${startedAt.toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomUUID().slice(0, 6)}`;
  const manifest = {
    engineVersion: EVOLUTION_ENGINE_VERSION,
    promptVersion: PROMPT_VERSION,
    gatesVersion: gates.version,
    gatesHash,
    split: { key: split.key, hash: splitHash, windows: split.windows, forwardFrom: split.forwardFrom, folds: split.folds, priorExposure: split.priorExposure },
    budget: { monthlyBudgetUsd: config.monthlyBudgetUsd, perRunBudgetUsd: config.runBudgetUsd },
    costModel: EVOLUTION_COST_MODEL_V1,
    data: { dir: deps.market.dir, fingerprint: deps.market.fingerprint, cutoffAt: deps.market.cutoffAt, files: deps.market.files },
    forwardDataUsed: false,
    provider: provider.name,
    billable: provider.billable,
    models: seed === null ? config.models : null,
    mode: seed === null ? "AI_HYPOTHESES" : "PREREGISTERED_SEED",
    ...(seed === null
      ? {}
      : { seed: { family: seed.family, key: seed.key, genomeHash: genomeHash(seed.genome), parameters: seed.genome.parameters, preregistrationHash: seed.preregistrationHash, pinnedPreregistrationHash: seed.pinnedPreregistrationHash } }),
    // Every independent family the code knows, with the pre-registration hash it is decided under.
    independentFamilies: Object.fromEntries(
      Object.values(FAMILY_SPECS)
        .filter((spec) => spec.independence !== undefined)
        .map((spec) => [
          spec.family,
          {
            researchIdentity: spec.independence!.researchIdentity,
            entryEvaluator: spec.independence!.entryEvaluator,
            preregistrationHash: spec.independence!.preregistrationHash,
            frozenExits: spec.independence!.frozenExits,
            replayHull: spec.replayStrategyKey,
            portfolioPath: isGatesV4(gates)
          }
        ])
    )
  };
  const run = await db.evolutionRun.create({
    data: {
      runKey,
      trigger: options.trigger,
      status: "RUNNING",
      providerName: provider.name,
      billable: provider.billable,
      engineVersion: EVOLUTION_ENGINE_VERSION,
      codeVersion: config.codeVersion,
      splitKey: split.key,
      splitHash,
      dataManifestJson: manifest as never,
      hypothesesRequested: seed === null ? config.hypothesesPerRun : 1,
      startedAt
    }
  });
  await recordAuditEvent(db, {
    eventKey: `run:${runKey}:started`,
    eventType: "RUN_STARTED",
    aggregateType: "EvolutionRun",
    aggregateId: run.id,
    actorType: "SYSTEM",
    actorId: owner,
    payload: { runKey, trigger: options.trigger, dataFingerprint: deps.market.fingerprint, provider: provider.name, mode: manifest.mode, seed: seed?.key ?? null },
    occurredAt: startedAt
  });
  log.info({ runKey, provider: provider.name }, "research cycle started");

  const working: WorkingCandidate[] = [];
  let backtestCount = 0;
  let backtestMs = 0;

  // ── Backtest helper: cache, persistence, exposure ledger, integrity ──────
  const D = split.windows.DISCOVERY;
  const V = split.windows.VALIDATION;
  const H = split.windows.HOLDOUT;
  const integrityProblems = (summary: BacktestSummary, job: BacktestJob, fingerprint: string): string[] => {
    const problems: string[] = [];
    if (fingerprint !== deps.market.fingerprint) problems.push("Datenstand des Backtests weicht vom Durchlauf ab");
    const forward = Date.parse(split.forwardFrom);
    if (summary.lastAnchorAt !== null && Date.parse(summary.lastAnchorAt) >= forward) problems.push("Backtest enthält Forward-Daten");
    if (summary.firstAnchorAt !== null && Date.parse(summary.firstAnchorAt) < Date.parse(job.from)) problems.push("Backtest beginnt vor seinem Fenster");
    if (summary.lastAnchorAt !== null && Date.parse(summary.lastAnchorAt) > Date.parse(job.to)) problems.push("Backtest endet nach seinem Fenster");
    if (summary.trades.some((trade) => Date.parse(trade.anchorAt) < Date.parse(job.from) || Date.parse(trade.anchorAt) > Date.parse(job.to))) {
      problems.push("Trade außerhalb des Fensters");
    }
    return problems;
  };

  async function backtest(input: {
    subjectKey: string;
    subject: BacktestSubject;
    subjectHash: string;
    symbol: string;
    window: "DISCOVERY_VALIDATION" | "HOLDOUT";
    role: BacktestRole;
    candidateId: string | null;
  }): Promise<{ ok: true; summary: BacktestSummary } | { ok: false; error: string }> {
    const job: BacktestJob = {
      jobId: randomUUID(),
      kind: "BACKTEST",
      subjectKey: input.subjectKey,
      subject: input.subject,
      symbol: input.symbol,
      windowKey: input.window,
      from: input.window === "HOLDOUT" ? H.from : D.from,
      to: input.window === "HOLDOUT" ? H.to : V.to,
      splitAt: input.window === "HOLDOUT" ? undefined : V.from,
      codeVersion: config.codeVersion
    };
    const cacheKey = backtestCacheKey({ subjectHash: input.subjectHash, job, dataFingerprint: deps.market.fingerprint, codeVersion: config.codeVersion });
    let summary = await findCachedBacktest(db, cacheKey);
    if (summary === null) {
      const result = await deps.runner.run(job);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.summary === undefined) return { ok: false, error: "Backtest lieferte kein Ergebnis." };
      const problems = integrityProblems(result.summary, job, result.dataFingerprint);
      if (problems.length > 0) return { ok: false, error: `DATA_INTEGRITY: ${problems.join("; ")}` };
      summary = result.summary;
      backtestCount += 1;
      backtestMs += summary.durationMs;
      await saveBacktest(db, { cacheKey, job, summary, role: input.role, candidateId: input.candidateId, dataFingerprint: deps.market.fingerprint, codeVersion: config.codeVersion });
    }
    const occurredAt = deps.now();
    const purposes: [string, "SEARCH" | "SELECTION" | "HOLDOUT_CHECK" | "BENCHMARK"][] =
      input.window === "HOLDOUT"
        ? [["HOLDOUT", input.role === "BENCHMARK" ? "BENCHMARK" : "HOLDOUT_CHECK"]]
        : input.role === "BENCHMARK"
          ? [["DISCOVERY", "BENCHMARK"], ["VALIDATION", "BENCHMARK"]]
          : [["DISCOVERY", "SEARCH"], ["VALIDATION", "SELECTION"]];
    for (const [windowKey, purpose] of purposes) {
      await recordExposure(db, { runId: run.id, windowKey, purpose, subjectKey: input.subjectKey, candidateId: input.candidateId, symbol: input.symbol, occurredAt });
    }
    return { ok: true, summary };
  }

  const evaluate = (backtests: readonly BacktestSummary[]) => {
    const discovery = windowMetrics({ label: "Entdeckung", from: D.from, to: D.to, backtests, periodKey: "discovery" });
    const validation = windowMetrics({ label: "Validierung", from: V.from, to: V.to, backtests, periodKey: "validation" });
    const inSample = windowMetrics({ label: "Entdeckung + Validierung", from: D.from, to: V.to, backtests, periodKey: "overall" });
    const folds = foldMetrics(split, backtests);
    return { discovery, validation, inSample, folds, stability: foldStability(folds) };
  };
  const combined = (backtests: readonly BacktestSummary[]) =>
    combineDailyEquity(
      backtests.map((entry) => entry.dailyEquity),
      backtests.map((entry) => entry.startingCash)
    );

  try {
    // ── 1. Benchmarks: the frozen roots on discovery + validation ──────────
    const roots: Record<string, { backtests: BacktestSummary[]; metrics: ReturnType<typeof evaluate> }> = {};
    const rootResults = await Promise.all(
      EVOLUTION_ROOTS.map((root) =>
        Promise.all(
          split.symbols.map((symbol) =>
            backtest({ subjectKey: root.key, subject: { kind: "ROOT", rootKey: root.key }, subjectHash: root.specificationHash, symbol, window: "DISCOVERY_VALIDATION", role: "BENCHMARK", candidateId: null })
          )
        )
      )
    );
    for (const [index, root] of EVOLUTION_ROOTS.entries()) {
      const results = rootResults[index]!;
      const failed = results.find((result) => !result.ok);
      if (failed !== undefined && !failed.ok) throw new Error(`Benchmark ${root.key} failed: ${failed.error}`);
      const backtests = results.map((result) => (result as { summary: BacktestSummary }).summary);
      roots[root.key] = { backtests, metrics: evaluate(backtests) };
    }
    const champion = EVOLUTION_ROOTS.find((root) => root.role === "CHAMPION")!;

    // Existing strategies: the frozen roots; under gates v3 also every operator-approved
    // candidate, replayed with the current code as a reference (BENCHMARK, never new evidence).
    const strategyOf = (key: string, family: EvolutionFamily, subject: BacktestSubject, subjectHash: string, backtests: BacktestSummary[]): ExistingStrategy => ({
      key,
      family,
      subject,
      subjectHash,
      backtests,
      metrics: evaluate(backtests),
      curve: combined(backtests),
      startingCash: backtests.reduce((sum, entry) => sum + entry.startingCash, 0),
      trades: backtests.flatMap((entry) => entry.trades)
    });
    const strategies = new Map<string, Promise<ExistingStrategy>>();
    const referenceStrategy = (key: string, family: EvolutionFamily, subject: BacktestSubject, subjectHash: string): Promise<ExistingStrategy> => {
      const cached = strategies.get(key);
      if (cached !== undefined) return cached;
      const loading = Promise.all(
        split.symbols.map((symbol) => backtest({ subjectKey: key, subject, subjectHash, symbol, window: "DISCOVERY_VALIDATION", role: "BENCHMARK", candidateId: null }))
      ).then((results) => {
        const failed = results.find((result) => !result.ok);
        if (failed !== undefined && !failed.ok) throw new Error(`Reference ${key} failed: ${failed.error}`);
        return strategyOf(key, family, subject, subjectHash, results.map((result) => (result as { summary: BacktestSummary }).summary));
      });
      strategies.set(key, loading);
      return loading;
    };
    for (const root of EVOLUTION_ROOTS) {
      strategies.set(root.key, Promise.resolve(strategyOf(root.key, root.genome.family, { kind: "ROOT", rootKey: root.key }, root.specificationHash, roots[root.key]!.backtests)));
    }
    const candidateStrategy = async (key: string): Promise<ExistingStrategy | null> => {
      if (strategies.has(key)) return strategies.get(key)!;
      const row = await db.evolutionCandidate.findUnique({ where: { candidateKey: key } });
      if (row === null) return null;
      const genome = row.genomeJson as unknown as CandidateGenome;
      return referenceStrategy(key, genome.family, { kind: "GENOME", genome }, genomeHash(genome));
    };
    const existing: ExistingStrategy[] = await Promise.all(EVOLUTION_ROOTS.map((root) => strategies.get(root.key)!));
    if (isGatesV3(gates)) {
      const approved = await db.evolutionCandidate.findMany({ where: { status: "APPROVED_FOR_FORWARD_TEST" }, orderBy: { candidateKey: "asc" }, select: { candidateKey: true } });
      for (const row of approved) {
        const strategy = await candidateStrategy(row.candidateKey);
        if (strategy !== null) existing.push(strategy);
      }
    }

    // ── 2. Market conditions on discovery data (roots + recent candidates) ─
    const historyRows = await db.evolutionCandidate.findMany({
      where: { status: { in: ["REJECTED", "RESERVE", "PROPOSED", "APPROVED_FOR_FORWARD_TEST", "REJECTED_BY_OPERATOR"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { backtests: { where: { windowKey: "DISCOVERY_VALIDATION", role: "CANDIDATE" } } }
    });
    const discoveryOnly = (backtests: readonly BacktestSummary[]) =>
      backtests.flatMap((entry) => entry.trades.filter((trade) => Date.parse(trade.anchorAt) >= Date.parse(D.from) && Date.parse(trade.anchorAt) <= Date.parse(D.to)));
    const analysis = analyzeMarketConditions({
      split,
      referenceSymbol: "BTCUSDT",
      bars: deps.market.discoveryBars,
      subjects: [
        ...EVOLUTION_ROOTS.map((root) => ({ key: root.key, trades: discoveryOnly(roots[root.key]!.backtests) })),
        ...historyRows.map((row) => ({ key: row.candidateKey, trades: discoveryOnly(row.backtests.map((entry) => entry.summaryJson as unknown as BacktestSummary)) }))
      ]
    });

    // ── 3. Hypotheses from the AI (leak-checked context, budget-guarded) ───
    const history = await loadHistory(db);
    // Gates v3: validation screenings per family this month (every gate version counts).
    const familyUsed = isGatesV3(gates) ? await familyScreeningsThisMonth(db, startedAt) : new Map<string, number>();
    const familyLimit = isGatesV3(gates) ? gates.lineage.maxScreeningsPerFamilyPerMonth : Number.POSITIVE_INFINITY;
    const benchmarks = Object.fromEntries(
      EVOLUTION_ROOTS.map((root) => [
        root.key,
        { label: root.label, role: root.role, strategyKey: root.strategyKey, discovery: roots[root.key]!.metrics.discovery, validation: roots[root.key]!.metrics.validation, inSample: roots[root.key]!.metrics.inSample, folds: roots[root.key]!.metrics.folds }
      ])
    );

    // One place creates every candidate row, from a hypothesis or from the pre-registered seed.
    async function admitCandidate(input: {
      family: EvolutionFamily;
      generation: number;
      parentKey: string;
      parentCandidateId: string | null;
      rootStrategyKey: string;
      parentGenome: CandidateGenome;
      genome: CandidateGenome;
      hypothesisId: string;
      hypothesis: WorkingCandidate["hypothesis"];
      isSeed: boolean;
    }): Promise<void> {
      const sequence = await nextSequence(db, input.family);
      const key = candidateKeyFor(input.family, sequence);
      const changes = diffGenomes(input.parentGenome, input.genome);
      const row = await db.evolutionCandidate.create({
        data: {
          candidateKey: key,
          family: input.family,
          generation: input.generation,
          sequence,
          parentKey: input.parentKey,
          parentCandidateId: input.parentCandidateId,
          rootStrategyKey: input.rootStrategyKey,
          runId: run.id,
          hypothesisId: input.hypothesisId,
          genomeJson: input.genome as never,
          genomeHash: genomeHash(input.genome),
          changesJson: changes as never,
          status: "GENERATED",
          statusReasons: [],
          windowsSeen: []
        }
      });
      await recordAuditEvent(db, {
        eventKey: `candidate:${key}:created`,
        eventType: "CANDIDATE_CREATED",
        aggregateType: "EvolutionCandidate",
        aggregateId: row.id,
        actorType: "SYSTEM",
        payload: {
          runKey,
          key,
          parentKey: input.parentKey,
          generation: input.generation,
          genomeHash: genomeHash(input.genome),
          changes,
          ...(isIndependentFamily(input.family) ? { researchIdentity: familyResearchIdentity(input.family), seed: input.isSeed } : {})
        },
        occurredAt: deps.now()
      });
      working.push({
        id: row.id,
        key,
        family: input.family,
        generation: input.generation,
        parentKey: input.parentKey,
        genome: input.genome,
        hypothesisTitle: input.hypothesis.title,
        hypothesis: input.hypothesis,
        changes,
        status: "GENERATED",
        reasons: [],
        technical: null,
        backtests: [],
        discovery: null,
        validation: null,
        inSample: null,
        holdout: null,
        screening: [],
        final: [],
        score: null,
        correlations: [],
        folds: [],
        walkForward: null,
        neighbours: [],
        windowsSeen: new Set(),
        // An independent family has no root: its lineage starts at the pre-registered seed.
        rootKey: EVOLUTION_FAMILY_SEEDS[input.family]?.key ?? `ROOT:${input.rootStrategyKey}`,
        successor: null,
        familyScreening: familyUsed.get(input.family) ?? 0,
        lineage: null,
        lineageReferenceKeys: [],
        isSeed: input.isSeed,
        portfolio: null
      });
    }

    let aiSummary: string | null = null;
    // The review call exists only after an AI hypothesis step; a seed evaluation has neither.
    let reviewRequest: ((text: string) => AiRequest) | null = null;
    if (seed !== null) {
      // ── 3–4 in seed mode: the pre-registered seed instead of AI hypotheses ──
      await db.evolutionRun.update({ where: { id: run.id }, data: { analysisJson: JSON.parse(JSON.stringify({ ...analysis, benchmarks })) as never } });
      const hypothesisRow = await db.evolutionHypothesis.create({
        data: {
          hypothesisKey: `${runKey}:SEED`,
          runId: run.id,
          aiCallId: null,
          ...seed.hypothesis,
          family: seed.family,
          parentKey: seed.key,
          changesJson: [] as never,
          outcome: "PREREGISTERED_SEED",
          outcomeReasons: [`Vorregistrierung ${seed.preregistrationHash}`]
        }
      });
      familyUsed.set(seed.family, (familyUsed.get(seed.family) ?? 0) + 1);
      await admitCandidate({
        family: seed.family,
        generation: 1,
        parentKey: seed.key,
        parentCandidateId: null,
        rootStrategyKey: familyResearchIdentity(seed.family)!,
        parentGenome: seed.genome,
        genome: seed.genome,
        hypothesisId: hypothesisRow.id,
        hypothesis: { ...seed.hypothesis },
        isSeed: true
      });
    } else {
      // Stage 2 of every independent family: open only after its seed passed screening and the operator's approval.
      const independentStatus = new Map<EvolutionFamily, IndependentSearchStatus>();
      for (const spec of Object.values(FAMILY_SPECS).filter((entry) => entry.independence !== undefined)) {
        independentStatus.set(spec.family, await independentSearchStatus(db, { family: spec.family, gates, config, now: startedAt, requirePreregisteredGates: deps.gates === undefined }));
      }
      const openIndependent = [...independentStatus.values()].filter((status) => status.open);
      const context = buildResearchContext({
        split,
        benchmarks: EVOLUTION_ROOTS.map((root) => ({ key: root.key, label: root.label, discovery: roots[root.key]!.metrics.discovery })),
        analysis,
        history,
        hypotheses: config.hypothesesPerRun,
        successorRule: isGatesV2(gates),
        ...(isGatesV3(gates)
          ? {
              lineageRule: {
                remainingScreenings: Object.fromEntries(
                  Object.values(FAMILY_SPECS)
                    .filter((spec) => spec.independence === undefined)
                    .map((spec) => [spec.family, Math.max(0, familyLimit - (familyUsed.get(spec.family) ?? 0))])
                )
              }
            }
          : {}),
        ...(openIndependent.length > 0
          ? {
              independentFamilies: Object.fromEntries(
                openIndependent.map((status) => [
                  status.family,
                  {
                    remainingThisMonth: Math.min(status.remainingThisMonth, Math.max(0, familyLimit - (familyUsed.get(status.family) ?? 0))),
                    remainingTotal: status.remainingTotal,
                    maxHypothesesPerRun: status.maxHypothesesPerRun
                  }
                ])
              )
            }
          : {})
      });
      assertContextLeakFree(context, split);
      const prompt = renderHypothesisPrompt(context);
      const contextHash = createHash("sha256").update(prompt).digest("hex");
      await db.evolutionRun.update({ where: { id: run.id }, data: { contextHash, analysisJson: JSON.parse(JSON.stringify({ ...analysis, benchmarks })) as never } });

      const aiRequest = (task: AiTask, system: string, text: string, schema: Readonly<Record<string, unknown>>): AiRequest => {
        const tier = AI_TASK_TIER[task];
        return { task, tier, model: config.models[tier], system, prompt: text, jsonSchema: schema, maxOutputTokens: config.maxOutputTokens[tier], effort: config.effort[tier] };
      };
      reviewRequest = (text: string) => aiRequest("RESULT_REVIEW", REVIEW_SYSTEM_PROMPT, text, REVIEW_RESPONSE_SCHEMA);
      const hypothesisCall = await callResearchAi(
        { db, provider, config, now: deps.now, log },
        { runId: run.id, request: aiRequest("HYPOTHESIS_GENERATION", HYPOTHESIS_SYSTEM_PROMPT, prompt, HYPOTHESIS_RESPONSE_SCHEMA) }
      );
      if (!hypothesisCall.ok) {
        return await finish("ABORTED", `KI-Aufruf vom Budget blockiert: ${hypothesisCall.decision.reason}.`, null, null);
      }
      const parsed = parseHypothesisResponse(hypothesisCall.response.json, config.hypothesesPerRun);
      aiSummary = parsed.summary || null;

      // ── 4. Hypotheses → versioned candidates (or refusals) ─────────────────
      const allowedParents = new Set(context.allowedParents);
      const rootHashes = new Set(EVOLUTION_ROOTS.map((root) => genomeHash(root.genome)));
      // Genomes already evaluated as neighbour variants: their discovery + validation result is known, so
      // they can never come back as a "new" candidate whose result would count as independent evidence.
      const neighbourHashes = await evaluatedNeighbourGenomeHashes(db);
      const seenThisRun = new Set<string>();
      const independentAccepted = new Map<EvolutionFamily, number>();
      // An independent family is tested only under gates v4, in stage 2 and within its pre-registered budget.
      const independentRefusal = (family: EvolutionFamily): { outcome: string; reason: string } | null => {
        if (!isIndependentFamily(family)) return null;
        if (!isGatesV4(gates)) return { outcome: "GATES_VERSION_UNSUITABLE", reason: `Eigenständige Familie ${family} wird nur nach Gates v4 im Portfolio geprüft; ${gates.version} lehnt sie ohne Test ab.` };
        const status = independentStatus.get(family);
        if (status === undefined || !status.open) return { outcome: "FAMILY_STAGE_CLOSED", reason: `${family}: ${status?.reason ?? "Stufe 2 ist nicht offen."} Nicht getestet.` };
        const accepted = independentAccepted.get(family) ?? 0;
        const limit = Math.min(status.maxHypothesesPerRun, status.remainingThisMonth, status.remainingTotal);
        if (accepted >= limit) {
          return { outcome: "FAMILY_PREREGISTRATION_LIMIT", reason: `${family}: Grenze der Vorregistrierung erreicht (höchstens ${status.maxHypothesesPerRun} je Durchlauf, verbleibend ${status.remainingThisMonth} im Monat und ${status.remainingTotal} insgesamt) — nicht getestet.` };
        }
        return null;
      };
      let index = 0;
      for (const hypothesis of parsed.hypotheses) {
        index += 1;
        const hypothesisKey = `${runKey}:H${index}`;
        const reasons: string[] = [];
        let outcome = "INVALID";
        let parentGenome: CandidateGenome | null = null;
        let parentGeneration = 0;
        let parentCandidateId: string | null = null;
        let rootStrategyKey = "";
        const root = rootByKey(hypothesis.parentKey);
        const refusal = independentRefusal(hypothesis.family);
        if (refusal !== null) {
          outcome = refusal.outcome;
          reasons.push(refusal.reason);
        } else if (!allowedParents.has(hypothesis.parentKey)) {
          reasons.push(`Elternstrategie ${hypothesis.parentKey} ist nicht zugelassen (nur Wurzeln und bestandene Kandidaten).`);
        } else if (root !== null) {
          parentGenome = root.genome;
          rootStrategyKey = root.strategyKey;
        } else {
          const parent = await db.evolutionCandidate.findUnique({ where: { candidateKey: hypothesis.parentKey } });
          if (parent === null) reasons.push(`Elternstrategie ${hypothesis.parentKey} existiert nicht.`);
          else {
            parentGenome = parent.genomeJson as unknown as CandidateGenome;
            parentGeneration = parent.generation;
            parentCandidateId = parent.id;
            rootStrategyKey = parent.rootStrategyKey;
          }
        }
        if (parentGenome !== null && parentGenome.family !== hypothesis.family) {
          reasons.push(`Familie ${hypothesis.family} passt nicht zur Elternstrategie (${parentGenome.family}).`);
        }
        let genome: CandidateGenome | null = null;
        if (reasons.length === 0 && parentGenome !== null) {
          const applied = applyChanges(parentGenome, hypothesis.changes);
          reasons.push(...applied.issues.map((issue) => `${issue.code}: ${issue.message}`));
          if (applied.applied.length > context.request.maxChangesPerHypothesis) {
            reasons.push(`TOO_MANY_CHANGES: ${applied.applied.length} Änderungen, erlaubt sind ${context.request.maxChangesPerHypothesis}.`);
          }
          if (reasons.length === 0) {
            const hash = genomeHash(applied.genome);
            const existing = await db.evolutionCandidate.findUnique({ where: { genomeHash: hash } });
            if (rootHashes.has(hash) || existing !== null || seenThisRun.has(hash) || neighbourHashes.has(hash)) {
              outcome = "DUPLICATE";
              reasons.push(
                existing !== null
                  ? `Genom bereits getestet als ${existing.candidateKey}.`
                  : neighbourHashes.has(hash)
                    ? "Genom bereits als Nachbarvariante geprüft — sein historisches Ergebnis ist bekannt und zählt nicht als neuer Nachweis."
                    : "Genom bereits getestet."
              );
            } else if ((familyUsed.get(hypothesis.family) ?? 0) >= familyLimit) {
              outcome = "LINEAGE_BUDGET_EXHAUSTED";
              reasons.push(`Monatslimit von ${familyLimit} Prüfungen der Familie ${hypothesis.family} erreicht — nicht getestet, die Validierungsdaten werden geschont.`);
            } else {
              outcome = "ACCEPTED";
              genome = applied.genome;
              seenThisRun.add(hash);
              familyUsed.set(hypothesis.family, (familyUsed.get(hypothesis.family) ?? 0) + 1);
              if (isIndependentFamily(hypothesis.family)) independentAccepted.set(hypothesis.family, (independentAccepted.get(hypothesis.family) ?? 0) + 1);
            }
          }
        }
        const hypothesisRow = await db.evolutionHypothesis.create({
          data: {
            hypothesisKey,
            runId: run.id,
            aiCallId: hypothesisCall.callId,
            title: hypothesis.title,
            marketObservation: hypothesis.marketObservation,
            rationale: hypothesis.rationale,
            expectedEffect: hypothesis.expectedEffect,
            falsificationCriterion: hypothesis.falsificationCriterion,
            family: hypothesis.family,
            parentKey: hypothesis.parentKey,
            changesJson: hypothesis.changes as never,
            outcome,
            outcomeReasons: reasons
          }
        });
        if (genome === null || parentGenome === null) continue;
        await admitCandidate({
          family: hypothesis.family,
          generation: parentGeneration + 1,
          parentKey: hypothesis.parentKey,
          parentCandidateId,
          rootStrategyKey,
          parentGenome,
          genome,
          hypothesisId: hypothesisRow.id,
          hypothesis,
          isSeed: false
        });
      }
    }

    // ── 5a. Technical tests ─────────────────────────────────────────────────
    await Promise.all(
      working.map(async (candidate) => {
        const result = await deps.runner.run({
          jobId: randomUUID(),
          kind: "TECHNICAL",
          subjectKey: candidate.key,
          subject: { kind: "GENOME", genome: candidate.genome },
          symbol: split.symbols[0]!,
          windowKey: "TECHNICAL",
          from: D.from,
          to: new Date(Date.parse(D.from) + 21 * 86_400_000).toISOString(),
          codeVersion: config.codeVersion
        });
        if (!result.ok || result.technical === undefined) {
          candidate.status = "TECHNICAL_FAILED";
          candidate.reasons.push(`TECHNICAL_TESTS_FAILED: ${result.ok ? "kein Ergebnis" : result.error}`);
          return;
        }
        candidate.technical = result.technical;
        const failures: string[] = [];
        if (!result.technical.deterministic) failures.push("zwei Läufe liefern verschiedene Ergebnisse");
        if (result.technical.invariantViolations > 0) failures.push(`${result.technical.invariantViolations} Portfolio-Invarianten verletzt`);
        if (result.technical.cycles === 0 || result.technical.invalidInput === result.technical.cycles) failures.push("keine gültige Entscheidung im Testfenster");
        if (failures.length > 0) {
          candidate.status = "TECHNICAL_FAILED";
          candidate.reasons.push(`TECHNICAL_TESTS_FAILED: ${failures.join("; ")}`);
        }
      })
    );

    // ── 5b. Screening backtests on discovery + validation ──────────────────
    const existingCurves = existing.map((strategy) => ({ key: strategy.key, curve: strategy.curve }));
    await Promise.all(
      working
        .filter((candidate) => candidate.status === "GENERATED")
        .map(async (candidate) => {
          const results = await Promise.all(
            split.symbols.map((symbol) =>
              backtest({ subjectKey: candidate.key, subject: { kind: "GENOME", genome: candidate.genome }, subjectHash: genomeHash(candidate.genome), symbol, window: "DISCOVERY_VALIDATION", role: "CANDIDATE", candidateId: candidate.id })
            )
          );
          const failure = results.find((result) => !result.ok);
          const dataLeak = failure !== undefined && !failure.ok && failure.error.startsWith("DATA_INTEGRITY");
          if (failure !== undefined && !failure.ok && !dataLeak) {
            candidate.status = "TECHNICAL_FAILED";
            candidate.reasons.push(`TECHNICAL_TESTS_FAILED: ${failure.error}`);
            return;
          }
          candidate.windowsSeen.add("DISCOVERY").add("VALIDATION");
          const backtests = results.filter((result) => result.ok).map((result) => (result as { summary: BacktestSummary }).summary);
          candidate.backtests = backtests;
          const metrics = evaluate(backtests);
          candidate.discovery = metrics.discovery;
          candidate.validation = metrics.validation;
          candidate.inSample = metrics.inSample;
          candidate.folds = metrics.folds;
          const curve = combined(backtests);
          candidate.correlations = existingCurves.map((existing) => ({ key: existing.key, value: correlationOfDailyReturns(curve, existing.curve) }));
          const technical = candidate.technical;
          candidate.screening = screeningGates({
            technical: {
              passed: technical !== null && technical.deterministic && technical.invariantViolations === 0 && backtests.every((entry) => entry.invariantViolations === 0),
              failures: backtests.some((entry) => entry.invariantViolations > 0) ? ["Invarianten im Backtest verletzt"] : []
            },
            dataIntegrity: dataLeak && failure !== undefined && !failure.ok ? { passed: false, failures: [failure.error] } : { passed: true, failures: [] },
            discovery: metrics.discovery,
            validation: metrics.validation,
            inSample: metrics.inSample,
            folds: metrics.stability,
            correlations: candidate.correlations,
            champion: roots[champion.key]!.metrics.inSample
          }, gates);
          const maxCorrelation = Math.max(...candidate.correlations.map((entry) => entry.value ?? 0));
          candidate.score = researchScore({ discovery: metrics.discovery, validation: metrics.validation, inSample: metrics.inSample, folds: metrics.stability, maxCorrelation, genome: candidate.genome });
        })
    );

    // ── 5c. Gates v2: near-copies of the own root go through the successor rule ─
    // Sequential and in key order, so the monthly attempt limit is deterministic.
    if (isGatesV2(gates)) {
      const policy = gates.successor;
      const trials =
        split.priorExposure.filter((entry) => entry.role === "TRAINING").reduce((sum, entry) => sum + entry.configurationsTried, 0) + (await evaluatedConfigurations(db));
      const attempts = new Map<string, number>();
      for (const candidate of [...working].filter((entry) => entry.screening.length > 0 && !isIndependentFamily(entry.family)).sort((a, b) => a.key.localeCompare(b.key))) {
        const route = successorRoute({ rootKey: candidate.rootKey, correlations: candidate.correlations, policy });
        if (!route.routed || roots[route.rootKey] === undefined) continue;
        const reference = roots[route.rootKey]!.metrics;
        if (!attempts.has(route.rootKey)) attempts.set(route.rootKey, await successorScreeningsThisMonth(db, route.rootKey.replace(/^ROOT:/, ""), deps.now()));
        const screeningsThisMonth = attempts.get(route.rootKey)! + 1;
        attempts.set(route.rootKey, screeningsThisMonth);
        const paired = pairedMonthlyTest(combined(candidate.backtests), combined(roots[route.rootKey]!.backtests), D.from, V.to);
        candidate.screening = [
          ...candidate.screening.map((gate) => (gate.gate === "REDUNDANCY" ? routedRedundancyGate(route) : gate)),
          ...successorScreeningGates(
            {
              rootKey: route.rootKey,
              correlation: route.correlation!,
              candidate: { discovery: candidate.discovery!, validation: candidate.validation!, inSample: candidate.inSample! },
              reference: { discovery: reference.discovery, validation: reference.validation, inSample: reference.inSample },
              paired,
              trials,
              screeningsThisMonth
            },
            policy
          )
        ];
        candidate.successor = {
          rootKey: route.rootKey,
          correlation: route.correlation,
          candidateSharpe: candidate.inSample?.sharpe ?? null,
          referenceSharpe: reference.inSample.sharpe,
          paired,
          threshold: successorTThreshold(policy, trials, paired.criticalT),
          trials,
          screeningsThisMonth
        };
      }
    }

    // ── 5d. Gates v3: every candidate against its lineage, or as a genuine diversifier ─
    // Independent of correlation: root, parent and the best existing family representative,
    // each compared separately. Sequential in key order, so references load deterministically.
    // Candidates of an independent family are decided by the gates-v4 portfolio path below instead.
    if (isGatesV3(gates)) {
      const trials =
        split.priorExposure.filter((entry) => entry.role === "TRAINING").reduce((sum, entry) => sum + entry.configurationsTried, 0) + (await evaluatedConfigurations(db));
      const diversification = gates.lineage.diversification;
      for (const candidate of [...working].filter((entry) => entry.screening.length > 0 && !isIndependentFamily(entry.family)).sort((a, b) => a.key.localeCompare(b.key))) {
        const roles = new Map<string, LineageRole[]>();
        const addRole = (key: string, role: LineageRole) => roles.set(key, [...(roles.get(key) ?? []), role]);
        addRole(candidate.rootKey, "ROOT");
        if (rootByKey(candidate.parentKey) !== null) addRole(candidate.parentKey, "PARENT");
        else if ((await candidateStrategy(candidate.parentKey)) !== null) addRole(candidate.parentKey, "PARENT");
        const family = existing
          .filter((strategy) => strategy.family === candidate.family)
          .sort((a, b) => (b.metrics.inSample.sharpe ?? Number.NEGATIVE_INFINITY) - (a.metrics.inSample.sharpe ?? Number.NEGATIVE_INFINITY) || a.key.localeCompare(b.key));
        if (family[0] !== undefined) addRole(family[0].key, "FAMILY_BEST");
        const candidateCurve = combined(candidate.backtests);
        const references: LineageReference[] = [];
        for (const [key, keyRoles] of [...roles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const strategy = rootByKey(key) !== null ? await strategies.get(key)! : await candidateStrategy(key);
          if (strategy === null || strategy === undefined) continue;
          references.push({
            key,
            roles: keyRoles,
            metrics: { discovery: strategy.metrics.discovery, validation: strategy.metrics.validation, inSample: strategy.metrics.inSample, folds: strategy.metrics.stability },
            paired: pairedMonthlyTest(candidateCurve, strategy.curve, D.from, V.to)
          });
        }
        const candidateTrades = candidate.backtests.flatMap((entry) => entry.trades);
        const relations = existing.map((strategy) => ({
          key: strategy.key,
          correlation: candidate.correlations.find((entry) => entry.key === strategy.key)?.value ?? null,
          signalOverlap: signalOverlap(candidateTrades, strategy.trades, diversification.signalWindowHours)
        }));
        const portfolio = portfolioComparison({
          existing: existing.map((strategy) => ({ key: strategy.key, curve: strategy.curve, startingCash: strategy.startingCash })),
          candidate: { key: candidate.key, curve: candidateCurve, startingCash: candidate.backtests.reduce((sum, entry) => sum + entry.startingCash, 0) },
          windows: { discovery: D, validation: V }
        });
        const metrics = evaluate(candidate.backtests);
        const assessed = lineageScreeningGates(
          {
            family: candidate.family,
            candidate: { discovery: metrics.discovery, validation: metrics.validation, inSample: metrics.inSample, folds: metrics.stability },
            references,
            existing: relations,
            portfolio,
            trials,
            screeningsThisMonth: candidate.familyScreening
          },
          gates
        );
        const lineageKeys = references.map((reference) => reference.key);
        candidate.screening = [
          ...candidate.screening.map((gate) => (gate.gate === "REDUNDANCY" ? lineageRedundancyGate({ correlations: candidate.correlations, lineageKeys }, gates) : gate)),
          ...assessed.gates
        ];
        candidate.lineage = assessed.assessment;
        candidate.lineageReferenceKeys = lineageKeys;
      }
    }

    // ── 5d. Gates v4: independent families are decided by the portfolio path ─
    // Comparison A (the existing strategies plus a cash reserve slot) runs once per
    // window and run and comes from the cache; comparison B puts the candidate on the
    // reserve slot. Same total capital, unchanged risk engine, chronological replay.
    // Sequential in key order, so the result never depends on timing.
    const portfolioContext: PortfolioRunContext = {
      runner: deps.runner,
      existing: existing.map((strategy): PortfolioMemberSpec => ({ key: strategy.key, subject: strategy.subject })),
      codeVersion: config.codeVersion,
      split,
      baselineCache: new Map(),
      jobId: (label) => `${runKey}:${label}:${randomUUID().slice(0, 8)}`
    };
    const independentMember = (candidate: WorkingCandidate, key = candidate.key, genome = candidate.genome): PortfolioMemberSpec => ({
      key,
      subject: { kind: "GENOME", genome },
      researchIdentity: familyResearchIdentity(candidate.family)!
    });
    const portfolioIntegrity = (summary: PortfolioSummary, window: { from: string; to: string }, fingerprint: string): string[] => {
      const problems: string[] = [];
      if (fingerprint !== deps.market.fingerprint) problems.push("Datenstand der Portfolio-Simulation weicht vom Durchlauf ab");
      if (summary.lastAnchorAt !== null && Date.parse(summary.lastAnchorAt) >= Date.parse(split.forwardFrom)) problems.push("Portfolio-Simulation enthält Forward-Daten");
      if (summary.firstAnchorAt !== null && Date.parse(summary.firstAnchorAt) < Date.parse(window.from)) problems.push("Portfolio-Simulation beginnt vor ihrem Fenster");
      if (summary.lastAnchorAt !== null && Date.parse(summary.lastAnchorAt) > Date.parse(window.to)) problems.push("Portfolio-Simulation endet nach ihrem Fenster");
      if (summary.members.some((member) => member.trades.some((trade) => Date.parse(trade.anchorAt) < Date.parse(window.from) || Date.parse(trade.anchorAt) > Date.parse(window.to)))) {
        problems.push("Portfolio-Trade außerhalb des Fensters");
      }
      if (summary.members.some((member) => member.invariantViolations > 0)) problems.push("Portfolio-Invarianten verletzt");
      return problems;
    };
    const recordPortfolioExposure = async (subjectKey: string, candidateId: string | null, entries: readonly (readonly [string, ExposurePurpose])[]) => {
      const occurredAt = deps.now();
      for (const symbol of split.symbols) {
        for (const [windowKey, purpose] of entries) await recordExposure(db, { runId: run.id, windowKey, purpose, subjectKey, candidateId, symbol, occurredAt });
      }
    };
    const independentCandidates = [...working].filter((entry) => entry.screening.length > 0 && isIndependentFamily(entry.family)).sort((a, b) => a.key.localeCompare(b.key));
    if (independentCandidates.length > 0 && !isGatesV4(gates)) {
      // Defence in depth: hypotheses of such a family are refused before any backtest under v1–v3.
      for (const candidate of independentCandidates) {
        candidate.screening = [
          ...candidate.screening,
          ...asGateResults([
            {
              gate: "INDEPENDENT_FAMILY",
              stage: "SCREENING",
              passed: false,
              reasonCode: "INDEPENDENT_FAMILY_REQUIRES_GATES_V4",
              message: `Familie ${candidate.family} ist eigenständig und wird nur nach Gates v4 im Portfolio geprüft; ${gates.version} lehnt sie ab.`,
              actual: gates.version,
              limit: "evolution-gates-v4"
            }
          ])
        ];
      }
    } else if (independentCandidates.length > 0 && isGatesV4(gates)) {
      const trials = priorTrainingConfigurations(split) + (await evaluatedConfigurations(db));
      const inSampleWindow = { from: D.from, to: V.to };
      for (const candidate of independentCandidates) {
        const spec = FAMILY_SPECS[candidate.family];
        const structure = independentFamilyStructure(spec);
        try {
          const result = await (deps.portfolioPath?.screen ?? screenIndependentCandidate)(portfolioContext, {
            family: candidate.family,
            candidate: independentMember(candidate),
            structure,
            gates,
            trials,
            screeningsThisMonth: candidate.familyScreening
          });
          const problems = [...portfolioIntegrity(result.baseline, inSampleWindow, result.dataFingerprint), ...portfolioIntegrity(result.withCandidate, inSampleWindow, result.dataFingerprint)];
          await recordPortfolioExposure(PORTFOLIO_BASELINE_SUBJECT, null, [["DISCOVERY", "BENCHMARK"], ["VALIDATION", "BENCHMARK"]]);
          await recordPortfolioExposure(candidate.key, candidate.id, [["DISCOVERY", "SEARCH"], ["VALIDATION", "SELECTION"]]);
          if (problems.length > 0) {
            candidate.status = "TECHNICAL_FAILED";
            candidate.reasons.push(`DATA_INTEGRITY: ${[...new Set(problems)].join("; ")}`);
            continue;
          }
          candidate.screening = [...candidate.screening, ...asGateResults(result.gates)];
          candidate.portfolio = {
            gatesVersion: gates.version,
            gatesHash,
            preregistrationHash: structure.preregistrationHash,
            researchIdentity: familyResearchIdentity(candidate.family)!,
            replayHull: spec.replayStrategyKey,
            dataFingerprint: result.dataFingerprint,
            baseline: digestPortfolioSummary(result.baseline),
            withCandidate: digestPortfolioSummary(result.withCandidate),
            assessment: result.assessment,
            decision: result.decision,
            neighbours: null,
            holdout: null
          };
        } catch (error) {
          candidate.status = "TECHNICAL_FAILED";
          candidate.reasons.push(`TECHNICAL_TESTS_FAILED: Portfolio-Simulation: ${errorText(error).slice(0, 300)}`);
        }
      }
    }

    // ── 6. Automatic rejection and finalist selection ───────────────────────
    // A candidate whose portfolio simulation failed technically is not screened.
    const screened = working.filter((candidate) => candidate.screening.length > 0 && candidate.status !== "TECHNICAL_FAILED");
    for (const candidate of screened) {
      // Informational sub-checks (gates v3) never reject on their own.
      const failedScreening = candidate.screening.filter(isBlockingFailure);
      if (failedScreening.length > 0) {
        candidate.status = "REJECTED";
        candidate.reasons.push(...failedScreening.map((gate) => gate.reasonCode));
      }
    }
    const finalists = new Set(
      selectFinalists(
        screened.map((candidate) => ({ key: candidate.key, score: candidate.score?.score ?? 0, passedScreening: candidate.status !== "REJECTED", successor: candidate.successor !== null, group: candidate.family })),
        gates.maxFinalists,
        isGatesV2(gates) ? { maxSuccessors: gates.successor.maxFinalistsPerRun } : isGatesV3(gates) ? { maxPerGroup: gates.lineage.maxFinalistsPerFamilyPerRun } : {}
      )
    );
    for (const candidate of screened) {
      if (candidate.status !== "REJECTED" && !finalists.has(candidate.key)) {
        candidate.status = "RESERVE";
        candidate.reasons.push("NOT_SELECTED_AS_FINALIST");
      }
    }

    // Holdout replays of existing strategies (reference data, BENCHMARK exposure), shared by all finalists.
    const holdoutBacktests = new Map<string, BacktestSummary[]>();
    const holdouts = new Map<string, Promise<{ metrics: WindowMetrics | null; curve: DailyEquityPoint[] | null; input: { key: string; curve: DailyEquityPoint[]; startingCash: number } | null }>>();
    const holdoutOf = (strategy: ExistingStrategy) => {
      const cached = holdouts.get(strategy.key);
      if (cached !== undefined) return cached;
      const loading = Promise.all(
        split.symbols.map((symbol) => backtest({ subjectKey: strategy.key, subject: strategy.subject, subjectHash: strategy.subjectHash, symbol, window: "HOLDOUT", role: "BENCHMARK", candidateId: null }))
      ).then((results) => {
        if (!results.every((result) => result.ok)) return { metrics: null, curve: null, input: null };
        const backtests = results.map((result) => (result as { summary: BacktestSummary }).summary);
        const curve = combined(backtests);
        return {
          metrics: windowMetrics({ label: "Holdout", from: H.from, to: H.to, backtests, periodKey: "overall" }),
          curve,
          input: { key: strategy.key, curve, startingCash: backtests.reduce((sum, entry) => sum + entry.startingCash, 0) }
        };
      });
      holdouts.set(strategy.key, loading);
      return loading;
    };

    // ── 7. Finalists: neighbours, walk-forward, holdout ─────────────────────
    // All final backtests are queued at once; the runner's concurrency limit
    // decides how many run in parallel (1 on the VPS). Results are collected
    // in neighbour order, so the outcome does not depend on timing.
    await Promise.all(
      screened
        .filter((entry) => finalists.has(entry.key))
        .map(async (candidate) => {
          const spec = FAMILY_SPECS[candidate.family];
          const preferred = [...candidate.changes.map((change) => change.parameter), ...spec.parameters.filter((parameter) => parameter.kind !== "boolean").map((parameter) => parameter.name)];
          // The seed's neighbours are pre-registered; every other candidate moves its changed parameters first.
          const neighbours = candidate.isSeed
            ? [...(EVOLUTION_FAMILY_SEEDS[candidate.family]?.neighbours ?? [])]
            : neighbourGenomes(candidate.genome, [...new Set(preferred)], gates.neighbourCount);
          const neighbourRuns = neighbours.map((neighbour, index) => {
            const neighbourKey = `${candidate.key}~N${index + 1}`;
            return {
              neighbour,
              neighbourKey,
              results: Promise.all(
                split.symbols.map((symbol) =>
                  backtest({ subjectKey: neighbourKey, subject: { kind: "GENOME", genome: neighbour }, subjectHash: genomeHash(neighbour), symbol, window: "DISCOVERY_VALIDATION", role: "NEIGHBOUR", candidateId: candidate.id })
                )
              )
            };
          });
          const holdoutRun = config.holdoutEnabled
            ? Promise.all(
                split.symbols.map((symbol) =>
                  backtest({ subjectKey: candidate.key, subject: { kind: "GENOME", genome: candidate.genome }, subjectHash: genomeHash(candidate.genome), symbol, window: "HOLDOUT", role: "CANDIDATE", candidateId: candidate.id })
                )
              )
            : null;
          // One await over every job, so a failing job can never become an unhandled rejection.
          const [neighbourResults, holdoutResults] = await Promise.all([Promise.all(neighbourRuns.map((run) => run.results)), holdoutRun ?? Promise.resolve(null)]);
          const variants = [{ key: candidate.key, trades: candidate.backtests.flatMap((entry) => entry.trades) }];
          for (const [index, run] of neighbourRuns.entries()) {
            const results = neighbourResults[index]!;
            if (results.some((result) => !result.ok)) continue;
            const backtests = results.map((result) => (result as { summary: BacktestSummary }).summary);
            const label = diffGenomes(candidate.genome, run.neighbour)
              .map((diff) => `${diff.parameter}=${String(diff.to)}`)
              .join(", ");
            candidate.neighbours.push({ key: `${run.neighbourKey} (${label})`, inSample: evaluate(backtests).inSample });
            variants.push({ key: run.neighbourKey, trades: backtests.flatMap((entry) => entry.trades) });
          }
          candidate.walkForward = rollingWalkForward(split, candidate.key, variants);
          let holdout: WindowMetrics | null = null;
          if (holdoutResults !== null) {
            const results = holdoutResults;
            if (results.every((result) => result.ok)) {
              const backtests = results.map((result) => (result as { summary: BacktestSummary }).summary);
              holdout = windowMetrics({ label: "Holdout", from: H.from, to: H.to, backtests, periodKey: "overall" });
              holdoutBacktests.set(candidate.key, backtests);
              candidate.windowsSeen.add("HOLDOUT");
            }
          }
          candidate.holdout = holdout;
          candidate.final =
            holdout === null
              ? [
                  ...finalGates({ neighbours: candidate.neighbours, walkForward: candidate.walkForward, holdout: candidate.inSample! }, gates).filter((gate) => gate.gate !== "HOLDOUT"),
                  { gate: "HOLDOUT", stage: "FINAL", passed: false, reasonCode: "HOLDOUT_NOT_EVALUATED", message: "Holdout wurde nicht ausgewertet; ohne ihn wird kein Kandidat vorgeschlagen.", actual: null, limit: null }
                ]
              : finalGates({ neighbours: candidate.neighbours, walkForward: candidate.walkForward, holdout }, gates);
          if (candidate.successor !== null && isGatesV2(gates)) {
            // The root's holdout is reference data, not candidate evidence: recorded as BENCHMARK exposure.
            const rootHoldout = await Promise.all(
              split.symbols.map((symbol) => {
                const root = rootByKey(candidate.successor!.rootKey)!;
                return backtest({ subjectKey: root.key, subject: { kind: "ROOT", rootKey: root.key }, subjectHash: root.specificationHash, symbol, window: "HOLDOUT", role: "BENCHMARK", candidateId: null });
              })
            );
            const referenceHoldout = rootHoldout.every((entry) => entry.ok)
              ? windowMetrics({ label: "Holdout", from: H.from, to: H.to, backtests: rootHoldout.map((entry) => (entry as { summary: BacktestSummary }).summary), periodKey: "overall" })
              : null;
            candidate.final = [...candidate.final, successorHoldoutGate({ rootKey: candidate.successor.rootKey, candidate: candidate.holdout, reference: referenceHoldout }, gates.successor)];
          }
          if (candidate.lineage?.path != null && isGatesV3(gates)) {
            // Holdouts of the references are reference data, not candidate evidence: recorded as BENCHMARK exposure.
            if (candidate.lineage.path === "VALUE") {
              const references = await Promise.all(
                candidate.lineageReferenceKeys.map(async (key) => {
                  const strategy = rootByKey(key) !== null ? await strategies.get(key)! : await candidateStrategy(key);
                  return { key, holdout: strategy === null ? null : (await holdoutOf(strategy)).metrics };
                })
              );
              candidate.final = [...candidate.final, lineageHoldoutGate({ path: "VALUE", candidate: candidate.holdout, references, portfolio: null }, gates)];
            } else {
              const members = await Promise.all(existing.map((strategy) => holdoutOf(strategy)));
              const ownCurve = candidate.holdout === null ? null : combined(holdoutBacktests.get(candidate.key) ?? []);
              const portfolio =
                members.some((member) => member.curve === null) || ownCurve === null
                  ? null
                  : {
                      sharpeWithout: curveStats(portfolioCurve(members.map((member) => member.input!)), H.from, H.to).sharpe,
                      sharpeWith: curveStats(portfolioCurve([...members.map((member) => member.input!), { key: candidate.key, curve: ownCurve, startingCash: candidate.backtests.reduce((sum, entry) => sum + entry.startingCash, 0) }]), H.from, H.to).sharpe
                    };
              candidate.final = [...candidate.final, lineageHoldoutGate({ path: "DIVERSIFICATION", candidate: candidate.holdout, references: [], portfolio }, gates)];
            }
          }
          if (candidate.portfolio !== null && isGatesV4(gates)) {
            // Gates v4 final stage: every one-step neighbour must add to the portfolio too; the holdout can only stop.
            const failedFinal = (reasonCode: string, message: string): GateResult[] =>
              asGateResults([{ gate: "PORTFOLIO_HOLDOUT_GUARD", stage: "FINAL", passed: false, reasonCode, message, actual: null, limit: null }]);
            if (holdoutResults === null) {
              candidate.final = [...candidate.final, ...failedFinal("HOLDOUT_NOT_EVALUATED", "Holdout wurde nicht ausgewertet; ohne Portfolio-Holdout-Schutz wird kein Kandidat vorgeschlagen.")];
            } else {
              const neighbourMembers = neighbourRuns
                .filter((_, index) => neighbourResults[index]!.every((result) => result.ok))
                .map((entry) => independentMember(candidate, entry.neighbourKey, entry.neighbour));
              try {
                const finals = await (deps.portfolioPath?.final ?? finalIndependentCandidate)(portfolioContext, { candidate: independentMember(candidate), neighbours: neighbourMembers, gates });
                const holdoutWindow = { from: H.from, to: H.to };
                const problems = [
                  ...portfolioIntegrity(finals.holdoutPair.baseline, holdoutWindow, finals.holdoutPair.dataFingerprint),
                  ...portfolioIntegrity(finals.holdoutPair.withCandidate, holdoutWindow, finals.holdoutPair.dataFingerprint),
                  ...(finals.neighbourFingerprints.some((fingerprint) => fingerprint !== deps.market.fingerprint) ? ["Datenstand der Nachbar-Simulation weicht vom Durchlauf ab"] : [])
                ];
                // The holdout of comparison A is reference data; the candidate's holdout check and the neighbours were recorded with their backtests.
                await recordPortfolioExposure(PORTFOLIO_BASELINE_SUBJECT, null, [["HOLDOUT", "BENCHMARK"]]);
                await recordPortfolioExposure(candidate.key, candidate.id, [["HOLDOUT", "HOLDOUT_CHECK"]]);
                for (const member of neighbourMembers) await recordPortfolioExposure(member.key, candidate.id, [["DISCOVERY", "SEARCH"], ["VALIDATION", "SELECTION"]]);
                candidate.final = [
                  ...candidate.final,
                  ...(problems.length > 0 ? failedFinal("DATA_INTEGRITY", `Portfolio-Finale verworfen: ${[...new Set(problems)].join("; ")}.`) : asGateResults(finals.gates))
                ];
                candidate.portfolio = { ...candidate.portfolio, neighbours: finals.neighbours, holdout: finals.holdout };
              } catch (error) {
                candidate.final = [...candidate.final, ...failedFinal("PORTFOLIO_FINAL_FAILED", `Portfolio-Finale technisch gescheitert: ${errorText(error).slice(0, 300)}`)];
              }
            }
          }
          candidate.status = statusAfterFinal(candidate.screening, candidate.final);
          candidate.reasons.push(...candidate.final.filter(isBlockingFailure).map((gate) => gate.reasonCode));
        })
    );

    // ── Evidence, reports, persistence of every decision ────────────────────
    const trials = split.priorExposure.filter((entry) => entry.role === "TRAINING").reduce((sum, entry) => sum + entry.configurationsTried, 0) + (await evaluatedConfigurations(db));
    const parents = new Map((await db.evolutionCandidate.findMany({ select: { candidateKey: true, parentKey: true } })).map((row) => [row.candidateKey, row.parentKey] as const));
    for (const candidate of working) {
      const evidence = candidate.inSample === null ? null : { ...evidenceGrade(candidate.inSample.tStatR, trials), tStat: candidate.inSample.tStatR };
      // Independent family: every stored row names the research identity; the registered key it ran under is only the replay hull.
      const research = isIndependentFamily(candidate.family) ? genomeReplayPlan(candidate.genome).researchIdentity ?? null : null;
      const identity =
        research === null
          ? null
          : {
              researchIdentity: research.key,
              engineVersion: research.engineVersion,
              specificationHash: research.specificationHash,
              preregistrationHash: FAMILY_SPECS[candidate.family].independence!.preregistrationHash,
              seed: candidate.isSeed,
              replayHull: { strategyKey: FAMILY_SPECS[candidate.family].replayStrategyKey, role: "technisch (Registry, R-005); keine Zuordnung, keine Forward-Freigabe" }
            };
      const lineage = lineageChain(candidate.key, (key) => (parents.has(key) ? { key, parentKey: parents.get(key)! } : null));
      const report = renderCandidateReport({
        candidateKey: candidate.key,
        versionLabel: versionLabel(candidate.family, candidate.generation, candidate.key),
        lineage: lineage.map((key) => rootByKey(key)?.strategyKey ?? key),
        hypothesis: candidate.hypothesis,
        changes: candidate.changes,
        status: STATUS_LABEL_DE[candidate.status],
        windowsSeen: [...candidate.windowsSeen].map((window) => split.windows[window as "DISCOVERY"]?.label ?? window),
        discovery: candidate.discovery,
        validation: candidate.validation,
        holdout: candidate.holdout,
        champion: candidate.inSample === null ? null : roots[champion.key]!.metrics.inSample,
        challenger: candidate.inSample === null ? null : roots[EVOLUTION_ROOTS.find((root) => root.role === "CHALLENGER")!.key]!.metrics.inSample,
        folds: candidate.folds,
        gates: [...candidate.screening, ...candidate.final],
        score: candidate.score,
        evidence,
        walkForward: candidate.walkForward,
        correlations: candidate.correlations,
        successor: candidate.successor,
        lineageCheck: candidate.lineage,
        portfolioCheck: candidate.portfolio,
        gateVersion: gates.version
      });
      const metricsJson = {
        discovery: candidate.discovery,
        validation: candidate.validation,
        inSample: candidate.inSample,
        holdout: candidate.holdout,
        folds: candidate.folds,
        correlations: candidate.correlations,
        walkForward: candidate.walkForward,
        neighbours: candidate.neighbours,
        discoverySnapshot: candidate.discovery === null ? null : discoverySnapshot(candidate.discovery),
        benchmarks: Object.fromEntries(EVOLUTION_ROOTS.map((root) => [root.key, { inSample: roots[root.key]!.metrics.inSample, discovery: roots[root.key]!.metrics.discovery, validation: roots[root.key]!.metrics.validation }])),
        evidence,
        technical: candidate.technical,
        successor: candidate.successor,
        lineage: candidate.lineage,
        identity,
        portfolio: candidate.portfolio,
        gateVersion: gates.version
      };
      await db.evolutionCandidate.update({
        where: { id: candidate.id },
        data: {
          status: candidate.status,
          statusReasons: candidate.reasons,
          technicalJson: candidate.technical as never,
          gatesJson: [...candidate.screening, ...candidate.final] as never,
          metricsJson: JSON.parse(JSON.stringify(metricsJson)) as never,
          scoreJson: candidate.score as never,
          researchScore: candidate.score?.score ?? null,
          evidenceGrade: evidence?.grade ?? null,
          windowsSeen: [...candidate.windowsSeen],
          holdoutEvaluated: candidate.windowsSeen.has("HOLDOUT"),
          reportMarkdown: report,
          proposedAt: candidate.status === "PROPOSED" ? deps.now() : null,
          version: { increment: 1 }
        }
      });
      await recordAuditEvent(db, {
        eventKey: `candidate:${candidate.key}:${candidate.status}`,
        eventType: candidate.status === "PROPOSED" ? "CANDIDATE_PROPOSED" : candidate.status === "RESERVE" ? "CANDIDATE_RESERVED" : "CANDIDATE_REJECTED",
        aggregateType: "EvolutionCandidate",
        aggregateId: candidate.id,
        actorType: "SYSTEM",
        payload: {
          runKey,
          key: candidate.key,
          status: candidate.status,
          reasons: candidate.reasons,
          score: candidate.score?.score ?? null,
          evidence: evidence?.grade ?? null,
          ...(identity === null ? {} : { researchIdentity: identity.researchIdentity, portfolioDecision: candidate.portfolio?.decision.passed ?? null })
        },
        occurredAt: deps.now()
      });
    }

    // ── Review by the cheap model (leak-free, optional) ─────────────────────
    let review: ParsedReview | null = null;
    if (config.reviewEnabled && working.length > 0 && reviewRequest !== null) {
      const request = reviewRequest;
      const lines = working.map(
        (candidate) =>
          `- ${candidate.key} (${candidate.family}, Eltern ${candidate.parentKey}): ${candidate.hypothesisTitle}; Screening ${candidate.screening.length === 0 ? "nicht erreicht" : !candidate.screening.some(isBlockingFailure) ? "bestanden" : `gescheitert (${candidate.screening.filter(isBlockingFailure).map((gate) => gate.reasonCode).join(", ")})`}; Entdeckung ${candidate.discovery?.trades ?? 0} Trades, Ø ${candidate.discovery?.averageR?.toFixed(2) ?? "–"}R, PF ${candidate.discovery?.profitFactor?.toFixed(2) ?? "–"}`
      );
      const reviewPrompt = ["Forschungsdurchlauf mit folgenden Kandidaten (nur Entdeckungsdaten und Screening-Urteile):", ...lines, "", `Bedingungsbefunde: ${analysis.findings.map((finding) => finding.sentence).join(" ") || "keine"}`].join("\n");
      assertContextLeakFree({ reviewPrompt }, split);
      try {
        const reviewCall = await callResearchAi({ db, provider, config, now: deps.now, log }, { runId: run.id, request: request(reviewPrompt) });
        if (reviewCall.ok) review = parseReviewResponse(reviewCall.response.json);
      } catch (error) {
        log.warn({ error: errorText(error) }, "review call failed; the cycle result stands without it");
      }
    }

    return await finish("COMPLETED", null, aiSummary, review);
  } catch (error) {
    log.error({ error: errorText(error), stack: error instanceof Error ? error.stack : undefined, runKey }, "research cycle failed");
    for (const candidate of working.filter((entry) => entry.status === "GENERATED")) {
      candidate.status = "TECHNICAL_FAILED";
      await db.evolutionCandidate.update({ where: { id: candidate.id }, data: { status: "TECHNICAL_FAILED", statusReasons: [`RUN_FAILED: ${errorText(error).slice(0, 300)}`] } });
    }
    return await finish("FAILED", errorText(error), null, null);
  } finally {
    await releaseRunLease(db, owner, { lastRunAt: deps.now(), nextRunAt: options.nextRunAt });
  }

  async function finish(status: "COMPLETED" | "FAILED" | "ABORTED", reason: string | null, aiSummary: string | null, review: ParsedReview | null): Promise<CycleOutcome> {
    const finishedAt = deps.now();
    const current = await db.evolutionRun.findUniqueOrThrow({ where: { id: run.id } });
    const simulated = await db.evolutionAiCall.aggregate({ _sum: { costUsd: true }, where: { runId: run.id } });
    const reportMarkdown = renderRunReport({
      runKey,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      provider: provider.name,
      models: seed === null ? [config.models.ADVANCED, config.models.STANDARD] : [],
      dataManifest: { split: split.key, splitHash, dataFingerprint: deps.market.fingerprint, cutoffAt: deps.market.cutoffAt, forwardDataUsed: false },
      findings: ((current.analysisJson as { findings?: { sentence: string }[] } | null)?.findings ?? []).map((finding) => finding.sentence),
      aiSummary,
      candidates: working.map((candidate) => ({
        key: candidate.key,
        title: candidate.hypothesisTitle,
        status: STATUS_LABEL_DE[candidate.status],
        score: candidate.score?.score ?? null,
        reason: candidate.status === "PROPOSED" ? "Alle Prüfungen bestanden" : candidate.reasons.join(", ")
      })),
      cost: {
        inputTokens: current.aiInputTokens,
        outputTokens: current.aiOutputTokens,
        usd: provider.billable ? Number(current.aiCostUsd) : Number(simulated._sum.costUsd ?? 0),
        billable: provider.billable
      },
      review
    });
    await db.evolutionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        aiSummary,
        reviewJson: review as never,
        reportMarkdown,
        errorClass: status === "COMPLETED" ? null : status,
        errorMessage: reason?.slice(0, 1000) ?? null,
        candidatesGenerated: working.length,
        candidatesRejected: working.filter((candidate) => candidate.status === "REJECTED" || candidate.status === "TECHNICAL_FAILED").length,
        candidatesProposed: working.filter((candidate) => candidate.status === "PROPOSED").length,
        backtestCount,
        backtestMs
      }
    });
    await recordAuditEvent(db, {
      eventKey: `run:${runKey}:${status}`,
      eventType: status === "COMPLETED" ? "RUN_COMPLETED" : status === "ABORTED" ? "RUN_ABORTED" : "RUN_FAILED",
      aggregateType: "EvolutionRun",
      aggregateId: run.id,
      actorType: "SYSTEM",
      payload: { runKey, status, reason, candidates: working.map((candidate) => ({ key: candidate.key, status: candidate.status })), aiCostUsd: Number(current.aiCostUsd), backtestCount },
      occurredAt: finishedAt
    });
    log.info({ runKey, status, candidates: working.length, proposed: working.filter((candidate) => candidate.status === "PROPOSED").length }, "research cycle finished");
    return {
      status,
      reason,
      runKey,
      candidates: working.map((candidate) => ({ key: candidate.key, status: candidate.status, score: candidate.score?.score ?? null })),
      aiCostUsd: Number(current.aiCostUsd)
    };
  }
}
