/**
 * Runs backtests in child processes: bounded concurrency, a heap limit per
 * child, a hard timeout per job (the child is killed and replaced) and a
 * minimal environment without secrets. A crashing or hanging backtest can
 * therefore only fail its own job — never the worker, and never anything
 * outside the evolution container.
 */

import { fork, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReplayMarketData } from "@signalpilot/shadow-replay";

import { executeBacktest, executePortfolioJob, executeTechnicalCheck, type BacktestJobResult, type EvolutionJob } from "./execute.js";

export interface BacktestRunner {
  run(job: EvolutionJob): Promise<BacktestJobResult>;
  close(): Promise<void>;
}

/** Same-process runner for tests and small synthetic markets. */
export class InProcessBacktestRunner implements BacktestRunner {
  constructor(
    private readonly market: ReplayMarketData,
    private readonly fingerprint: string
  ) {}

  async run(job: EvolutionJob): Promise<BacktestJobResult> {
    try {
      if (job.kind === "PORTFOLIO") return { jobId: job.jobId, ok: true, dataFingerprint: this.fingerprint, portfolio: executePortfolioJob(this.market, job) };
      if (job.kind === "TECHNICAL") return { jobId: job.jobId, ok: true, dataFingerprint: this.fingerprint, technical: executeTechnicalCheck(this.market, job) };
      return { jobId: job.jobId, ok: true, dataFingerprint: this.fingerprint, summary: executeBacktest(this.market, job) };
    } catch (error) {
      return { jobId: job.jobId, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> {}
}

interface Slot {
  child: ChildProcess | null;
  ready: Promise<void> | null;
  busy: boolean;
}

export interface ChildPoolOptions {
  readonly snapshotDir: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly maxOldSpaceMb: number;
}

function childEntry(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), here.endsWith(".ts") ? "child.ts" : "child.js");
}

export class ChildProcessBacktestPool implements BacktestRunner {
  private readonly slots: Slot[];
  private readonly waiting: (() => void)[] = [];
  private closed = false;

  constructor(private readonly options: ChildPoolOptions) {
    this.slots = Array.from({ length: options.concurrency }, () => ({ child: null, ready: null, busy: false }));
  }

  private spawn(slot: Slot): void {
    const child = fork(childEntry(), [], {
      execArgv: [...process.execArgv.filter((arg) => !arg.startsWith("--max-old-space-size")), `--max-old-space-size=${this.options.maxOldSpaceMb}`],
      // Minimal environment: no API key, no database URL, no other secret.
      env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "production", TZ: "UTC", EVOLUTION_SNAPSHOT_DIR: this.options.snapshotDir },
      stdio: ["ignore", "ignore", "inherit", "ipc"]
    });
    slot.child = child;
    slot.ready = new Promise((resolve, reject) => {
      const onMessage = (message: unknown) => {
        if ((message as { ready?: boolean })?.ready === true) {
          child.off("message", onMessage);
          resolve();
        }
      };
      child.on("message", onMessage);
      child.once("exit", (code) => reject(new Error(`backtest child exited before ready (${code})`)));
    });
    child.once("exit", () => {
      if (slot.child === child) {
        slot.child = null;
        slot.ready = null;
      }
    });
  }

  private async acquire(): Promise<Slot> {
    for (;;) {
      if (this.closed) throw new Error("Backtest pool is closed.");
      const free = this.slots.find((slot) => !slot.busy);
      if (free !== undefined) {
        free.busy = true;
        return free;
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
  }

  private release(slot: Slot): void {
    slot.busy = false;
    this.waiting.shift()?.();
  }

  async run(job: EvolutionJob): Promise<BacktestJobResult> {
    const slot = await this.acquire();
    try {
      if (slot.child === null) this.spawn(slot);
      await slot.ready;
      const child = slot.child!;
      return await new Promise<BacktestJobResult>((resolve) => {
        const timer = setTimeout(() => {
          cleanup();
          child.kill("SIGKILL");
          resolve({ jobId: job.jobId, ok: false, error: `Backtest timed out after ${this.options.timeoutMs} ms.` });
        }, this.options.timeoutMs);
        const onMessage = (message: unknown) => {
          const result = message as BacktestJobResult;
          if (result?.jobId !== job.jobId) return;
          cleanup();
          resolve(result);
        };
        const onExit = (code: number | null, signal: string | null) => {
          cleanup();
          resolve({ jobId: job.jobId, ok: false, error: `Backtest child exited (${code ?? signal}); out of memory or crashed.` });
        };
        const cleanup = () => {
          clearTimeout(timer);
          child.off("message", onMessage);
          child.off("exit", onExit);
        };
        child.on("message", onMessage);
        child.once("exit", onExit);
        child.send(job);
      });
    } catch (error) {
      return { jobId: job.jobId, ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.release(slot);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const slot of this.slots) slot.child?.kill("SIGTERM");
    this.waiting.splice(0).forEach((resolve) => resolve());
  }
}
