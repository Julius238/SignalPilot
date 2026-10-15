/**
 * Connection check of the research AI: one tiny, budget-guarded call per
 * model tier, recorded like every other call (`EvolutionAiCall`, audit).
 * Proves key, model access, structured output and — for the strong model —
 * the refusal-fallback request shape, for a fraction of a cent.
 */

import { REVIEW_RESPONSE_SCHEMA, parseReviewResponse, type AiRequest, type AiTier } from "@signalpilot/evolution";

import type { EvolutionWorkerConfig } from "../config.js";
import { callResearchAi, type BudgetedAiDeps } from "./budgetedAi.js";

export const SMOKE_SYSTEM_PROMPT =
  "Du prüfst die technische Anbindung der SignalPilot Evolution Engine. Antworte ausschließlich im vorgegebenen JSON-Format, sehr knapp, auf Deutsch, ohne Handelsempfehlung.";
export const SMOKE_PROMPT = "Verbindungstest: Bestätige in einem Satz, dass du das JSON-Format einhalten kannst. Lass keyFindings, warnings und nextSteps leer.";

export interface SmokeResult {
  readonly tier: AiTier;
  readonly model: string;
  readonly ok: boolean;
  readonly servedModel: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly requestId: string | null;
  readonly summary: string | null;
  readonly error: string | null;
}

export async function runAiSmoke(
  deps: BudgetedAiDeps & { readonly config: Pick<EvolutionWorkerConfig, "models" | "monthlyBudgetUsd" | "runBudgetUsd"> },
  tiers: readonly AiTier[] = ["STANDARD", "ADVANCED"]
): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  for (const tier of tiers) {
    const request: AiRequest = {
      task: "RESULT_REVIEW",
      tier,
      model: deps.config.models[tier],
      system: SMOKE_SYSTEM_PROMPT,
      prompt: SMOKE_PROMPT,
      jsonSchema: REVIEW_RESPONSE_SCHEMA,
      maxOutputTokens: 2048,
      effort: "low"
    };
    const started = Date.now();
    try {
      const outcome = await callResearchAi(deps, { runId: null, request });
      if (!outcome.ok) {
        results.push({ tier, model: request.model, ok: false, servedModel: null, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: Date.now() - started, requestId: null, summary: null, error: `Budget: ${outcome.decision.reason}` });
        continue;
      }
      results.push({
        tier,
        model: request.model,
        ok: true,
        servedModel: outcome.response.servedModel,
        inputTokens: outcome.response.usage.inputTokens,
        outputTokens: outcome.response.usage.outputTokens,
        costUsd: outcome.costUsd,
        latencyMs: Date.now() - started,
        requestId: outcome.response.requestId,
        summary: parseReviewResponse(outcome.response.json).summary.slice(0, 200),
        error: null
      });
    } catch (error) {
      results.push({ tier, model: request.model, ok: false, servedModel: null, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: Date.now() - started, requestId: null, summary: null, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
  return results;
}
