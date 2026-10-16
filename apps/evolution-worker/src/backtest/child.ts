/**
 * Backtest child process. Receives jobs over IPC, runs them against the
 * snapshot market (loaded once per process) and answers with the result.
 *
 * Started by `ChildProcessBacktestPool` with a minimal environment: no API
 * key, no database URL — a backtest never needs either.
 */

import { EVOLUTION_DATA_SPLIT_V1 } from "@signalpilot/evolution";

import { loadEvolutionMarket, type EvolutionMarketSnapshot } from "../market/snapshots.js";
import { executeBacktest, executePortfolioJob, executeTechnicalCheck, type BacktestJobResult, type EvolutionJob } from "./execute.js";

let snapshot: Promise<EvolutionMarketSnapshot> | null = null;

async function handle(job: EvolutionJob): Promise<BacktestJobResult> {
  const dir = process.env.EVOLUTION_SNAPSHOT_DIR;
  if (!dir) return { jobId: job.jobId, ok: false, error: "EVOLUTION_SNAPSHOT_DIR is not set in the backtest child." };
  snapshot ??= loadEvolutionMarket(dir, EVOLUTION_DATA_SPLIT_V1);
  const loaded = await snapshot;
  if (job.kind === "PORTFOLIO") {
    return { jobId: job.jobId, ok: true, dataFingerprint: loaded.fingerprint, portfolio: executePortfolioJob(loaded.market, job) };
  }
  if (job.kind === "TECHNICAL") {
    return { jobId: job.jobId, ok: true, dataFingerprint: loaded.fingerprint, technical: executeTechnicalCheck(loaded.market, job) };
  }
  return { jobId: job.jobId, ok: true, dataFingerprint: loaded.fingerprint, summary: executeBacktest(loaded.market, job) };
}

process.on("message", (message: EvolutionJob) => {
  handle(message)
    .catch((error: unknown): BacktestJobResult => ({ jobId: message.jobId, ok: false, error: error instanceof Error ? error.message : String(error) }))
    .then((result) => process.send?.(result));
});

process.send?.({ ready: true });
