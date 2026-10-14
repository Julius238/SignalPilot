/**
 * Research matrix over the historical shadow replay (read-only for trading):
 *
 *   RESEARCH_SNAPSHOT_DIR=./data/market-snapshots/real \
 *   RESEARCH_OUT_DIR=./data/replay-research/training \
 *   RESEARCH_PHASE=TRAINING tsx src/jobs/shadowReplayResearch.ts
 *
 * Runs every combination of symbol × variant × cost profile × mode × regime
 * policy in parallel child processes over gzip-CSV snapshots and writes one
 * JSON file per run plus `summary.json` and `report.md`. No database, no
 * trading table, no flag.
 *
 * Train/test discipline: the split is fixed below, before any real-data
 * result was looked at. `TRAINING` replays only the period before the split —
 * the test period is not even simulated — and is the only phase used to
 * design or compare new variants. `TEST` replays only the period from the
 * split with a fresh portfolio (earlier candles serve as indicator warm-up
 * only): the one-time out-of-sample check of frozen variants. `FULL` replays
 * everything in one portfolio and reports both periods.
 */

import { fork } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CRYPTO_MTF_BREAKOUT_LONG_V1_KEY } from "@signalpilot/strategy-engine";
import {
  STRATEGY_VARIANTS,
  runShadowReplay,
  type RegimePolicy,
  type ReplayMarketData,
  type ReplayMode,
  type ReplayPeriodMetrics,
  type ReplayResult
} from "@signalpilot/shadow-replay";

import { BOOTSTRAP_EXECUTION_PROFILES } from "./shadowBootstrap.js";
import { REPLAY_COST_PROFILES, loadSnapshotMarket } from "./shadowReplay.js";

/** Pre-registered 2026-10-14, before the first real-data replay: training until 2023, test from 2024. */
export const RESEARCH_SPLIT_AT = "2024-01-01T00:00:00.000Z";
export type ResearchPhase = "TRAINING" | "TEST" | "FULL";

export interface ResearchRunSpec {
  readonly key: string;
  readonly symbol: string;
  readonly variant: string;
  readonly costProfile: string;
  readonly mode: ReplayMode;
  readonly regimePolicy: RegimePolicy;
}

export interface ResearchRunSummary {
  readonly spec: ResearchRunSpec;
  readonly phase: ResearchPhase;
  readonly durationMs: number;
  readonly firstAnchorAt: string | null;
  readonly lastAnchorAt: string | null;
  readonly finalEquity: string;
  readonly invariantViolations: number;
  readonly funnel: ReplayResult["funnel"];
  readonly metrics: ReplayResult["metrics"];
}

export function buildResearchMatrix(input: {
  readonly symbols: readonly string[];
  readonly variants: readonly string[];
  readonly costProfiles: readonly string[];
  readonly modes: readonly ReplayMode[];
  readonly regimePolicies: readonly RegimePolicy[];
}): ResearchRunSpec[] {
  const specs: ResearchRunSpec[] = [];
  for (const symbol of input.symbols)
    for (const regimePolicy of input.regimePolicies)
      for (const mode of input.modes)
        for (const costProfile of input.costProfiles)
          for (const variant of input.variants) {
            if (STRATEGY_VARIANTS[variant] === undefined) throw new Error(`Unknown strategy variant ${variant}.`);
            if (REPLAY_COST_PROFILES[costProfile] === undefined) throw new Error(`Unknown cost profile ${costProfile}.`);
            specs.push({
              key: [symbol, variant, costProfile, mode, regimePolicy].join("__"),
              symbol,
              variant,
              costProfile,
              mode,
              regimePolicy
            });
          }
  return specs;
}

export function runResearchSpec(market: ReplayMarketData, spec: ResearchRunSpec, phase: ResearchPhase): ReplayResult {
  const baseProfile = BOOTSTRAP_EXECUTION_PROFILES[spec.symbol];
  if (baseProfile === undefined) throw new Error(`No execution profile for ${spec.symbol}.`);
  return runShadowReplay(market, {
    symbol: spec.symbol,
    strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
    mode: spec.mode,
    regimePolicy: spec.regimePolicy,
    startingCash: "10000",
    executionProfile: { ...baseProfile, ...REPLAY_COST_PROFILES[spec.costProfile], maxParticipationRate: "0.010000000000" },
    // TRAINING ends one millisecond before the split: no test-period anchor is replayed.
    from: phase === "TEST" ? RESEARCH_SPLIT_AT : undefined,
    to: phase === "TRAINING" ? new Date(Date.parse(RESEARCH_SPLIT_AT) - 1).toISOString() : undefined,
    trainTestSplitAt: phase === "TRAINING" ? undefined : RESEARCH_SPLIT_AT,
    codeVersion: process.env.TRADING_CODE_VERSION ?? "replay-research",
    variant: spec.variant
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────

const num = (value: string | null | undefined, digits = 2): string =>
  value === null || value === undefined ? "–" : Number(value).toFixed(digits);

function periodRow(label: string, period: ReplayPeriodMetrics | null): string {
  if (period === null) return `| ${label} | – | – | – | – | – | – | – | – | – | – | – | – | – | – |`;
  return [
    "",
    label,
    String(period.closedTrades),
    num(period.netPnl),
    num(period.returnPct),
    num(period.profitFactor),
    num(period.winRatePct, 1),
    num(period.averageWin),
    num(period.averageLoss),
    num(period.averageR, 3),
    num(period.maxDrawdownPct),
    num(period.sharpeRatio),
    num(period.exposurePct, 1),
    String(period.maxConsecutiveLosses),
    num(period.totalExecutionCost),
    num(period.buyAndHoldReturnPct),
    ""
  ].join(" | ").trim();
}

const HEADER =
  "| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |\n" +
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";

export function renderResearchReport(phase: ResearchPhase, runs: readonly ResearchRunSummary[], snapshotDir: string): string {
  const lines: string[] = [
    `# Shadow-Replay-Research (${phase === "TRAINING" ? "nur Trainingszeitraum" : phase === "TEST" ? "nur Testzeitraum, frisches Portfolio" : "Training + Test"})`,
    "",
    `Datenquelle: ${snapshotDir} · Split ${RESEARCH_SPLIT_AT} (vorab festgelegt) · ${runs.length} Läufe`,
    "",
    "Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.",
    ""
  ];
  const groups = new Map<string, ResearchRunSummary[]>();
  for (const run of runs) {
    const key = `${run.spec.symbol} · ${run.spec.mode} · Regime ${run.spec.regimePolicy} · Kosten ${run.spec.costProfile}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  for (const [group, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${group}`, "", HEADER);
    for (const run of entries.sort((a, b) => a.spec.variant.localeCompare(b.spec.variant))) {
      if (phase === "TRAINING") {
        lines.push(periodRow(run.spec.variant, run.metrics.overall));
      } else if (phase === "TEST") {
        lines.push(periodRow(`${run.spec.variant} · Test`, run.metrics.test));
      } else {
        lines.push(periodRow(`${run.spec.variant} · Training`, run.metrics.training));
        lines.push(periodRow(`${run.spec.variant} · Test`, run.metrics.test));
      }
    }
    lines.push("");
  }

  lines.push("## Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)", "");
  for (const run of runs.filter((entry) => entry.spec.variant === "BASELINE" && entry.spec.costProfile === "REALISTIC")) {
    const { funnel, metrics } = run;
    const top = (bucket: Readonly<Record<string, number>>, count: number) =>
      Object.entries(bucket)
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([code, value]) => `${code} ${value}`)
        .join(", ") || "–";
    lines.push(
      `### ${run.spec.symbol} · ${run.spec.mode} · Regime ${run.spec.regimePolicy}`,
      "",
      `Zyklen ${funnel.cycles} · ungültig ${funnel.invalidInput} · kein Kandidat ${funnel.noCandidate} · Kandidaten ${funnel.candidates} · Risk-OK ${funnel.riskApproved} · Risk-abgelehnt ${funnel.riskRejected} · Fills ${funnel.entriesFilled} · verfallen ${funnel.ordersExpired}`,
      "",
      `- Erster Ablehnungsgrund: ${top(funnel.strategyReasons, 8)}`,
      `- Alle verfehlten Bedingungen: ${top(funnel.failedStrategyChecks, 12)}`,
      `- Risk-Ablehnungen: ${top(funnel.riskReasons, 6)}`,
      "",
      "| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |",
      "|---|---:|---:|---:|---:|---:|",
      ...[
        { blocker: "Alle Stunden (Basis)", ...metrics.nearMiss.baseline },
        { blocker: "Echte Kandidaten", ...metrics.nearMiss.candidates },
        ...metrics.nearMiss.blockers.slice(0, 10)
      ].map(
        (row) =>
          `| ${row.blocker} | ${row.samples} | ${num(row.avgReturn24hPct, 3)} | ${num(row.avgReturn72hPct, 3)} | ${num(row.positive24hPct, 1)} | ${num(row.positive72hPct, 1)} |`
      ),
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

// ───────────────────────────────────────────────────────────────────────────
// Parallel execution: the parent forks workers, each loads the snapshots once.
// ───────────────────────────────────────────────────────────────────────────

interface WorkerJob {
  readonly spec: ResearchRunSpec;
  readonly phase: ResearchPhase;
  readonly snapshotDir: string;
  readonly outDir: string;
}

async function workerMain(): Promise<void> {
  const markets = new Map<string, ReplayMarketData>();
  process.on("message", async (job: WorkerJob | { readonly done: true }) => {
    if ("done" in job) {
      process.exit(0);
    }
    try {
      let market = markets.get(job.spec.symbol);
      if (market === undefined) {
        market = await loadSnapshotMarket(job.snapshotDir, job.spec.symbol);
        markets.set(job.spec.symbol, market);
      }
      const startedAt = Date.now();
      const result = runResearchSpec(market, job.spec, job.phase);
      const durationMs = Date.now() - startedAt;
      await writeFile(resolve(job.outDir, "runs", `${job.spec.key}.json`), JSON.stringify(result));
      const summary: ResearchRunSummary = {
        spec: job.spec,
        phase: job.phase,
        durationMs,
        firstAnchorAt: result.firstAnchorAt,
        lastAnchorAt: result.lastAnchorAt,
        finalEquity: result.finalEquity,
        invariantViolations: result.invariantViolations,
        funnel: result.funnel,
        metrics: result.metrics
      };
      process.send?.({ ok: true, summary });
    } catch (error) {
      process.send?.({ ok: false, key: job.spec.key, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
  });
  process.send?.({ ready: true });
}

export async function runResearch(input: {
  readonly specs: readonly ResearchRunSpec[];
  readonly phase: ResearchPhase;
  readonly snapshotDir: string;
  readonly outDir: string;
  readonly concurrency: number;
  readonly log?: (line: string) => void;
}): Promise<ResearchRunSummary[]> {
  await mkdir(resolve(input.outDir, "runs"), { recursive: true });
  const queue = [...input.specs];
  const summaries: ResearchRunSummary[] = [];
  const failures: string[] = [];
  const log = input.log ?? (() => undefined);
  const startedAt = Date.now();

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(input.concurrency, queue.length)) }, () =>
      new Promise<void>((resolveWorker, rejectWorker) => {
        const child = fork(fileURLToPath(import.meta.url), [], {
          env: { ...process.env, RESEARCH_ROLE: "worker" },
          stdio: ["ignore", "inherit", "inherit", "ipc"]
        });
        const next = () => {
          const spec = queue.shift();
          if (spec === undefined) {
            child.send({ done: true });
            return;
          }
          child.send({ spec, phase: input.phase, snapshotDir: input.snapshotDir, outDir: input.outDir } satisfies WorkerJob);
        };
        child.on("message", (message: { ready?: true; ok?: boolean; summary?: ResearchRunSummary; key?: string; error?: string }) => {
          if (message.ready) return next();
          if (message.ok && message.summary) {
            summaries.push(message.summary);
            const overall = message.summary.metrics.overall;
            log(
              `[${summaries.length + failures.length}/${input.specs.length}] ${message.summary.spec.key}: ${overall.closedTrades} Trades, Rendite ${num(overall.returnPct)} %, PF ${num(overall.profitFactor)} (${Math.round(message.summary.durationMs / 1000)} s, gesamt ${Math.round((Date.now() - startedAt) / 1000)} s)`
            );
          } else {
            failures.push(`${message.key}: ${message.error}`);
            log(`FEHLER ${message.key}: ${message.error}`);
          }
          next();
        });
        child.on("exit", (code) => (code === 0 ? resolveWorker() : rejectWorker(new Error(`Research worker exited with ${code}`))));
      })
    )
  );

  if (failures.length > 0) throw new Error(`${failures.length} research runs failed:\n${failures.join("\n")}`);
  return summaries.sort((a, b) => a.spec.key.localeCompare(b.spec.key));
}

function listEnv(name: string, fallback: readonly string[]): string[] {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? [...fallback] : value.split(",").map((entry) => entry.trim());
}

if (process.env.RESEARCH_ROLE === "worker") {
  void workerMain();
} else if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const phase = (process.env.RESEARCH_PHASE ?? "TRAINING") as ResearchPhase;
  if (phase !== "TRAINING" && phase !== "TEST" && phase !== "FULL") {
    throw new Error(`RESEARCH_PHASE must be TRAINING, TEST or FULL, not ${phase}.`);
  }
  const snapshotDir = resolve(process.env.RESEARCH_SNAPSHOT_DIR ?? "candle-snapshot");
  const outDir = resolve(process.env.RESEARCH_OUT_DIR ?? `replay-research-${phase.toLowerCase()}`);
  const specs = buildResearchMatrix({
    symbols: listEnv("RESEARCH_SYMBOLS", ["BTCUSDT", "ETHUSDT"]),
    variants: listEnv("RESEARCH_VARIANTS", Object.keys(STRATEGY_VARIANTS)),
    costProfiles: listEnv("RESEARCH_COST_PROFILES", Object.keys(REPLAY_COST_PROFILES)),
    modes: listEnv("RESEARCH_MODES", ["SPEC", "SIGNAL_EDGE"]) as ReplayMode[],
    regimePolicies: listEnv("RESEARCH_REGIME_POLICIES", ["AS_SPECIFIED", "CRYPTO_ONLY"]) as RegimePolicy[]
  });
  const concurrency = Number(process.env.RESEARCH_CONCURRENCY ?? "6");
  console.log(`${specs.length} Läufe, Phase ${phase}, ${concurrency} parallel → ${outDir}`);
  runResearch({ specs, phase, snapshotDir, outDir, concurrency, log: (line) => console.log(line) })
    .then(async (summaries) => {
      await writeFile(resolve(outDir, "summary.json"), JSON.stringify({ phase, splitAt: RESEARCH_SPLIT_AT, snapshotDir, runs: summaries }, null, 2));
      await writeFile(resolve(outDir, "report.md"), renderResearchReport(phase, summaries, snapshotDir));
      console.log(`Fertig: ${summaries.length} Läufe → ${resolve(outDir, "report.md")}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
