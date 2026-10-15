/**
 * AI provider boundary, model routing, pricing and budget rules.
 *
 * The research engine talks to an AI only through `ResearchAiProvider`. The
 * provider receives text and a JSON schema and returns text, parsed JSON and
 * token usage — it never sees a database, a file, a key or a trading API, and
 * nothing it returns is executed: hypotheses are parsed into closed parameter
 * genomes (genome.ts) or refused.
 *
 * Costs are computed from the token usage the API actually reports, priced
 * with the table below (USD per million tokens, Anthropic first-party list
 * prices as of 2026-10). An unknown model is never called: without a price
 * the budget cannot be enforced.
 */

export type AiTask = "HYPOTHESIS_GENERATION" | "RESULT_REVIEW";
/** STANDARD: cheap model for simple evaluation; ADVANCED: strong model for research design. */
export type AiTier = "STANDARD" | "ADVANCED";
export type AiEffort = "low" | "medium" | "high";

export const AI_TASK_TIER: Readonly<Record<AiTask, AiTier>> = Object.freeze({
  HYPOTHESIS_GENERATION: "ADVANCED",
  RESULT_REVIEW: "STANDARD"
});

export interface AiRequest {
  readonly task: AiTask;
  readonly tier: AiTier;
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  /** JSON schema the response must follow (structured output). */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
  readonly effort: AiEffort;
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

/** Usage attributed to the model that produced it (server-side fallbacks can involve several). */
export interface AiModelUsage {
  readonly model: string;
  readonly usage: AiUsage;
}

export interface AiResponse {
  readonly servedModel: string;
  readonly text: string;
  readonly json: unknown;
  readonly usage: AiUsage;
  readonly usageByModel: readonly AiModelUsage[];
  readonly stopReason: string | null;
  readonly requestId: string | null;
  readonly attempts: number;
}

export type AiErrorKind =
  | "RATE_LIMIT"
  | "OVERLOADED"
  | "SERVER"
  | "CONNECTION"
  | "TIMEOUT"
  | "AUTH"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "REFUSAL"
  | "TRUNCATED"
  | "MALFORMED"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(["RATE_LIMIT", "OVERLOADED", "SERVER", "CONNECTION", "TIMEOUT"]);

export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly attempts: number;
  /** Tokens already billed before the failure (e.g. a refusal mid-stream), if known. */
  readonly usageByModel: readonly AiModelUsage[];

  constructor(kind: AiErrorKind, message: string, options: { status?: number | null; attempts?: number; usageByModel?: readonly AiModelUsage[] } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
    this.retryable = RETRYABLE.has(kind);
    this.status = options.status ?? null;
    this.attempts = options.attempts ?? 1;
    this.usageByModel = options.usageByModel ?? [];
  }
}

export interface ResearchAiProvider {
  /** e.g. `anthropic`, `mock`. */
  readonly name: string;
  /** False for the mock: its token counts are simulated and never count against the budget. */
  readonly billable: boolean;
  complete(request: AiRequest): Promise<AiResponse>;
}

// ───────────────────────────────────────────────────────────────────────────
// Pricing
// ───────────────────────────────────────────────────────────────────────────

export interface ModelPricing {
  /** USD per million tokens. */
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
  /** Prompts above this many input tokens are priced with `longContext`. */
  readonly longContextThreshold?: number;
  readonly longContext?: { readonly input: number; readonly output: number };
}

export const AI_PRICING_VERSION = "anthropic-list-prices-2026-10";

export const AI_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    longContextThreshold: 100_000,
    longContext: { input: 0.5, output: 2.5 }
  },
  // Possible server-side refusal fallbacks of the models above.
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }
});

export function pricingFor(model: string, table: Readonly<Record<string, ModelPricing>> = AI_MODEL_PRICING): ModelPricing | null {
  return table[model] ?? null;
}

const usd = (value: number) => Math.round(value * 1e8) / 1e8;

/** Cost of reported usage in USD (8 decimals). Throws for an unpriced model. */
export function costOfUsage(model: string, usage: AiUsage, table: Readonly<Record<string, ModelPricing>> = AI_MODEL_PRICING): number {
  const pricing = pricingFor(model, table);
  if (pricing === null) throw new Error(`No price for model ${model}; refusing to account it as free.`);
  const promptTokens = usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  const long = pricing.longContext !== undefined && pricing.longContextThreshold !== undefined && promptTokens > pricing.longContextThreshold;
  const input = long ? pricing.longContext!.input : pricing.input;
  const output = long ? pricing.longContext!.output : pricing.output;
  return usd(
    (usage.inputTokens * input +
      usage.outputTokens * output +
      usage.cacheCreationInputTokens * pricing.cacheWrite +
      usage.cacheReadInputTokens * pricing.cacheRead) /
      1_000_000
  );
}

/** Sum of the per-model usage; an unknown served model is priced like the most expensive known model. */
export function costOfModelUsage(entries: readonly AiModelUsage[], table: Readonly<Record<string, ModelPricing>> = AI_MODEL_PRICING): number {
  const priciest = Object.keys(table).sort((a, b) => table[b]!.output - table[a]!.output)[0]!;
  return usd(entries.reduce((sum, entry) => sum + costOfUsage(table[entry.model] === undefined ? priciest : entry.model, entry.usage, table), 0));
}

/** Conservative token estimate before a call: ~3 characters per token plus overhead. */
export function estimateInputTokens(...texts: readonly string[]): number {
  return Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 3) + 256;
}

/** Worst case of one call: estimated prompt plus every allowed output token (thinking included). */
export function worstCaseCallCost(model: string, estimatedInputTokens: number, maxOutputTokens: number, table: Readonly<Record<string, ModelPricing>> = AI_MODEL_PRICING): number {
  return costOfUsage(model, { inputTokens: estimatedInputTokens, outputTokens: maxOutputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, table);
}

// ───────────────────────────────────────────────────────────────────────────
// Budget
// ───────────────────────────────────────────────────────────────────────────

export interface BudgetPolicy {
  readonly monthlyBudgetUsd: number;
  readonly perRunBudgetUsd: number;
}

export type BudgetDecisionReason = "WITHIN_BUDGET" | "MONTHLY_BUDGET_EXHAUSTED" | "RUN_BUDGET_EXHAUSTED" | "NOT_BILLABLE";

export interface BudgetDecision {
  readonly allowed: boolean;
  readonly reason: BudgetDecisionReason;
  readonly remainingMonthUsd: number;
  readonly remainingRunUsd: number;
  readonly worstCaseUsd: number;
}

/**
 * A call is allowed only if its worst case fits into both the remaining
 * monthly and the remaining per-run budget. There is no top-up: an exhausted
 * month stays exhausted until the next calendar month (UTC).
 */
export function checkBudget(input: {
  readonly policy: BudgetPolicy;
  readonly billable: boolean;
  readonly spentThisMonthUsd: number;
  readonly spentThisRunUsd: number;
  readonly worstCaseUsd: number;
}): BudgetDecision {
  const remainingMonthUsd = usd(Math.max(0, input.policy.monthlyBudgetUsd - input.spentThisMonthUsd));
  const remainingRunUsd = usd(Math.max(0, input.policy.perRunBudgetUsd - input.spentThisRunUsd));
  if (!input.billable) return { allowed: true, reason: "NOT_BILLABLE", remainingMonthUsd, remainingRunUsd, worstCaseUsd: input.worstCaseUsd };
  if (input.worstCaseUsd > remainingMonthUsd) {
    return { allowed: false, reason: "MONTHLY_BUDGET_EXHAUSTED", remainingMonthUsd, remainingRunUsd, worstCaseUsd: input.worstCaseUsd };
  }
  if (input.worstCaseUsd > remainingRunUsd) {
    return { allowed: false, reason: "RUN_BUDGET_EXHAUSTED", remainingMonthUsd, remainingRunUsd, worstCaseUsd: input.worstCaseUsd };
  }
  return { allowed: true, reason: "WITHIN_BUDGET", remainingMonthUsd, remainingRunUsd, worstCaseUsd: input.worstCaseUsd };
}

/** Budget month of an instant, UTC: `2026-10`. */
export function budgetMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function startOfNextMonthUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

export function startOfMonthUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}
