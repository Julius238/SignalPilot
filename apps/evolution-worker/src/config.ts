/**
 * Configuration of the evolution worker, read once from the environment.
 *
 * Fails closed: a malformed number, an unknown provider, an unpriced model or
 * the (not yet existing) code-generation switch stops the process before it
 * does anything. The API key is read here and handed only to the provider;
 * it is never logged, stored or returned by `describeConfig`.
 */

import { AI_MODEL_PRICING, assertStrategyCodeGenerationDisabled, isGateVersionKey, type AiEffort, type GateVersionKey } from "@signalpilot/evolution";

export type ProviderMode = "anthropic" | "mock";

export interface EvolutionWorkerConfig {
  readonly enabled: boolean;
  readonly scheduleCron: string;
  readonly databaseUrl: string | null;
  readonly snapshotDir: string;
  readonly codeVersion: string;
  readonly provider: ProviderMode;
  readonly anthropicApiKey: string | null;
  readonly models: { readonly STANDARD: string; readonly ADVANCED: string };
  readonly effort: { readonly STANDARD: AiEffort; readonly ADVANCED: AiEffort };
  readonly maxOutputTokens: { readonly STANDARD: number; readonly ADVANCED: number };
  readonly monthlyBudgetUsd: number;
  readonly runBudgetUsd: number;
  readonly aiMaxRetries: number;
  readonly aiTimeoutMs: number;
  readonly refusalFallback: "default" | "off";
  readonly reviewEnabled: boolean;
  readonly hypothesesPerRun: number;
  readonly backtestConcurrency: number;
  readonly backtestTimeoutMs: number;
  readonly backtestMaxOldSpaceMb: number;
  readonly holdoutEnabled: boolean;
  /** Pre-registered gate version deciding new candidates (v3 since 2026-10-15; v1 and v2 stay selectable for reproduction). */
  readonly gatesVersion: GateVersionKey;
  readonly heartbeatFile: string;
  readonly leaseMs: number;
}

export class EvolutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolutionConfigError";
  }
}

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new EvolutionConfigError(`${name} must be true or false.`);
};

const number = (env: NodeJS.ProcessEnv, name: string, fallback: number, options: { min: number; max: number; integer?: boolean }): number => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < options.min || value > options.max || (options.integer === true && !Number.isInteger(value))) {
    throw new EvolutionConfigError(`${name} must be a number between ${options.min} and ${options.max}.`);
  }
  return value;
};

const effort = (env: NodeJS.ProcessEnv, name: string, fallback: AiEffort): AiEffort => {
  const raw = env[name] ?? fallback;
  if (raw !== "low" && raw !== "medium" && raw !== "high") throw new EvolutionConfigError(`${name} must be low, medium or high.`);
  return raw;
};

const model = (env: NodeJS.ProcessEnv, name: string, fallback: string): string => {
  const raw = (env[name] ?? fallback).trim();
  if (AI_MODEL_PRICING[raw] === undefined) {
    throw new EvolutionConfigError(`${name}=${raw} has no price in AI_MODEL_PRICING; an unpriced model would bypass the budget.`);
  }
  return raw;
};

export function loadEvolutionConfig(env: NodeJS.ProcessEnv = process.env): EvolutionWorkerConfig {
  assertStrategyCodeGenerationDisabled(bool(env, "EVOLUTION_CODE_GENERATION_ENABLED", false));
  const provider = (env.EVOLUTION_AI_PROVIDER ?? "mock").trim();
  if (provider !== "anthropic" && provider !== "mock") throw new EvolutionConfigError("EVOLUTION_AI_PROVIDER must be anthropic or mock.");
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  if (provider === "anthropic" && apiKey === null) {
    throw new EvolutionConfigError("EVOLUTION_AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY (secret, never committed).");
  }
  const monthlyBudgetUsd = number(env, "EVOLUTION_AI_MONTHLY_BUDGET_USD", 20, { min: 0, max: 100 });
  const runBudgetUsd = number(env, "EVOLUTION_AI_RUN_BUDGET_USD", 1, { min: 0, max: 100 });
  if (runBudgetUsd > monthlyBudgetUsd) throw new EvolutionConfigError("EVOLUTION_AI_RUN_BUDGET_USD must not exceed the monthly budget.");
  const fallback = (env.EVOLUTION_AI_REFUSAL_FALLBACK ?? "default").trim();
  if (fallback !== "default" && fallback !== "off") throw new EvolutionConfigError("EVOLUTION_AI_REFUSAL_FALLBACK must be default or off.");
  const gatesVersion = (env.EVOLUTION_GATES_VERSION ?? "v3").trim();
  if (!isGateVersionKey(gatesVersion)) throw new EvolutionConfigError("EVOLUTION_GATES_VERSION must be v1, v2, v3 or v4.");
  const maxConcurrentRuns = number(env, "EVOLUTION_MAX_CONCURRENT_RUNS", 1, { min: 1, max: 1, integer: true });
  void maxConcurrentRuns;
  return {
    enabled: bool(env, "EVOLUTION_ENABLED", false),
    scheduleCron: env.EVOLUTION_SCHEDULE_CRON?.trim() || "15 1 * * 1",
    databaseUrl: env.EVOLUTION_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || null,
    snapshotDir: env.EVOLUTION_SNAPSHOT_DIR?.trim() || "./data/market-snapshots/real",
    codeVersion: env.EVOLUTION_CODE_VERSION?.trim() || env.TRADING_CODE_VERSION?.trim() || "local",
    provider,
    anthropicApiKey: apiKey,
    models: {
      STANDARD: model(env, "EVOLUTION_AI_MODEL_STANDARD", "claude-haiku-5-5"),
      ADVANCED: model(env, "EVOLUTION_AI_MODEL_ADVANCED", "claude-opus-5-5")
    },
    effort: {
      STANDARD: effort(env, "EVOLUTION_AI_EFFORT_STANDARD", "low"),
      ADVANCED: effort(env, "EVOLUTION_AI_EFFORT_ADVANCED", "medium")
    },
    maxOutputTokens: {
      STANDARD: number(env, "EVOLUTION_AI_MAX_OUTPUT_TOKENS_STANDARD", 4000, { min: 256, max: 32000, integer: true }),
      ADVANCED: number(env, "EVOLUTION_AI_MAX_OUTPUT_TOKENS_ADVANCED", 16000, { min: 1024, max: 64000, integer: true })
    },
    monthlyBudgetUsd,
    runBudgetUsd,
    aiMaxRetries: number(env, "EVOLUTION_AI_MAX_RETRIES", 3, { min: 0, max: 6, integer: true }),
    aiTimeoutMs: number(env, "EVOLUTION_AI_TIMEOUT_MS", 300_000, { min: 10_000, max: 900_000, integer: true }),
    refusalFallback: fallback,
    reviewEnabled: bool(env, "EVOLUTION_AI_REVIEW_ENABLED", true),
    hypothesesPerRun: number(env, "EVOLUTION_HYPOTHESES_PER_RUN", 4, { min: 1, max: 8, integer: true }),
    backtestConcurrency: number(env, "EVOLUTION_BACKTEST_CONCURRENCY", 1, { min: 1, max: 8, integer: true }),
    backtestTimeoutMs: number(env, "EVOLUTION_BACKTEST_TIMEOUT_MS", 30 * 60_000, { min: 60_000, max: 4 * 3_600_000, integer: true }),
    backtestMaxOldSpaceMb: number(env, "EVOLUTION_BACKTEST_MAX_OLD_SPACE_MB", 1536, { min: 256, max: 8192, integer: true }),
    holdoutEnabled: bool(env, "EVOLUTION_HOLDOUT_ENABLED", true),
    gatesVersion,
    heartbeatFile: env.EVOLUTION_HEARTBEAT_FILE?.trim() || "/tmp/evolution-worker-heartbeat",
    leaseMs: number(env, "EVOLUTION_LEASE_MS", 6 * 3_600_000, { min: 60_000, max: 24 * 3_600_000, integer: true })
  };
}

/** Loggable view: everything except the secret (only whether one is present). */
export function describeConfig(config: EvolutionWorkerConfig): Record<string, unknown> {
  const { anthropicApiKey, databaseUrl, ...rest } = config;
  return { ...rest, anthropicApiKeyConfigured: anthropicApiKey !== null, databaseConfigured: databaseUrl !== null };
}
