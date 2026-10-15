/**
 * Every AI call of the engine goes through here: budget check before the
 * call, actual usage and cost after it, one `EvolutionAiCall` row either
 * way, and an automatic pause when the month's budget is spent.
 *
 * The check reserves the worst case of the call (estimated prompt plus every
 * allowed output token) against both the remaining monthly and the remaining
 * per-run budget, so a call that is allowed cannot overshoot either. Spend is
 * summed from recorded actual costs; nothing is ever topped up.
 */

import { createHash } from "node:crypto";

import {
  AI_PRICING_VERSION,
  AiProviderError,
  budgetMonth,
  checkBudget,
  costOfModelUsage,
  estimateInputTokens,
  startOfNextMonthUtc,
  worstCaseCallCost,
  type AiRequest,
  type AiResponse,
  type BudgetDecision,
  type ResearchAiProvider
} from "@signalpilot/evolution";

import type { EvolutionWorkerConfig } from "../config.js";
import type { EvolutionDb } from "../database.js";
import type { Logger } from "../logger.js";
import { setAgentStatus } from "../persistence/agentState.js";
import { recordAuditEvent } from "../persistence/audit.js";

export interface BudgetedAiDeps {
  readonly db: EvolutionDb;
  readonly provider: ResearchAiProvider;
  readonly config: Pick<EvolutionWorkerConfig, "monthlyBudgetUsd" | "runBudgetUsd">;
  readonly now: () => Date;
  readonly log: Pick<Logger, "info" | "warn">;
}

export type BudgetedAiResult =
  | { readonly ok: true; readonly response: AiResponse; readonly callId: string; readonly costUsd: number }
  | { readonly ok: false; readonly decision: BudgetDecision; readonly callId: string };

const requestHash = (request: AiRequest) =>
  createHash("sha256")
    .update(JSON.stringify([request.model, request.system, request.prompt, request.jsonSchema, request.maxOutputTokens, request.effort]))
    .digest("hex");

export async function spentUsd(db: EvolutionDb, where: { budgetMonth?: string; runId?: string }): Promise<number> {
  const result = await db.evolutionAiCall.aggregate({ _sum: { costUsd: true }, where: { billable: true, ...where } });
  return Number(result._sum.costUsd ?? 0);
}

export async function budgetStatus(db: EvolutionDb, config: Pick<EvolutionWorkerConfig, "monthlyBudgetUsd">, now: Date) {
  const month = budgetMonth(now);
  const spent = await spentUsd(db, { budgetMonth: month });
  return { month, budgetUsd: config.monthlyBudgetUsd, spentUsd: spent, remainingUsd: Math.max(0, config.monthlyBudgetUsd - spent) };
}

export async function callResearchAi(deps: BudgetedAiDeps, input: { readonly runId: string | null; readonly request: AiRequest }): Promise<BudgetedAiResult> {
  const { db, provider, config, log } = deps;
  const { request, runId } = input;
  const now = deps.now();
  const month = budgetMonth(now);
  const worstCaseUsd = worstCaseCallCost(request.model, estimateInputTokens(request.system, request.prompt), request.maxOutputTokens);
  const decision = checkBudget({
    policy: { monthlyBudgetUsd: config.monthlyBudgetUsd, perRunBudgetUsd: config.runBudgetUsd },
    billable: provider.billable,
    spentThisMonthUsd: await spentUsd(db, { budgetMonth: month }),
    spentThisRunUsd: runId === null ? 0 : await spentUsd(db, { runId }),
    worstCaseUsd
  });
  const base = {
    runId,
    task: request.task,
    tier: request.tier,
    provider: provider.name,
    requestedModel: request.model,
    billable: provider.billable,
    budgetMonth: month,
    requestHash: requestHash(request),
    promptChars: request.system.length + request.prompt.length,
    worstCaseUsd,
    pricingVersion: AI_PRICING_VERSION
  };

  if (!decision.allowed) {
    const blocked = await db.evolutionAiCall.create({
      data: { ...base, status: "BLOCKED_BUDGET", attempts: 0, usageJson: { decision } as never, errorKind: decision.reason }
    });
    log.warn({ task: request.task, reason: decision.reason, remainingMonthUsd: decision.remainingMonthUsd }, "AI call blocked by budget");
    if (decision.reason === "MONTHLY_BUDGET_EXHAUSTED") {
      await setAgentStatus(db, {
        status: "PAUSED_BUDGET",
        reason: `Monatsbudget ${config.monthlyBudgetUsd.toFixed(2)} USD ausgeschöpft (verbleibend ${decision.remainingMonthUsd.toFixed(4)} USD, Aufruf bräuchte bis zu ${worstCaseUsd.toFixed(4)} USD).`,
        actor: "budget-guard",
        actorType: "SYSTEM",
        pausedUntil: startOfNextMonthUtc(now),
        now
      });
    }
    return { ok: false, decision, callId: blocked.id };
  }

  const started = Date.now();
  try {
    const response = await provider.complete(request);
    const costUsd = costOfModelUsage(response.usageByModel);
    const call = await db.evolutionAiCall.create({
      data: {
        ...base,
        status: "SUCCEEDED",
        servedModel: response.servedModel,
        attempts: response.attempts,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheWriteTokens: response.usage.cacheCreationInputTokens,
        cacheReadTokens: response.usage.cacheReadInputTokens,
        costUsd,
        usageJson: { byModel: response.usageByModel } as never,
        latencyMs: Date.now() - started,
        stopReason: response.stopReason,
        requestId: response.requestId,
        responseJson: response.json as never
      }
    });
    if (runId !== null) await addRunUsage(db, runId, response.usage, provider.billable ? costUsd : 0);
    await recordAuditEvent(db, {
      eventKey: `ai-call:${call.id}`,
      eventType: "AI_CALL_SUCCEEDED",
      aggregateType: "EvolutionAiCall",
      aggregateId: call.id,
      actorType: "AI",
      actorId: response.servedModel,
      payload: { runId, task: request.task, model: request.model, servedModel: response.servedModel, costUsd, billable: provider.billable, usage: response.usage, attempts: response.attempts },
      occurredAt: deps.now()
    });
    log.info({ task: request.task, model: response.servedModel, costUsd, billable: provider.billable, usage: response.usage }, "AI call succeeded");
    return { ok: true, response, callId: call.id, costUsd };
  } catch (error) {
    const failure = error instanceof AiProviderError ? error : new AiProviderError("UNKNOWN", error instanceof Error ? error.message : String(error));
    // Reported usage is priced exactly. Without any (timeout, dropped connection) the call may still have
    // been billed: a billable call is then booked at its reserved worst case, never as free.
    const unconfirmed = failure.usageByModel.length === 0 && failure.billingUncertain && provider.billable;
    const costUsd = unconfirmed ? worstCaseUsd : costOfModelUsage(failure.usageByModel);
    const usage = failure.usageByModel.reduce(
      (total, entry) => ({ inputTokens: total.inputTokens + entry.usage.inputTokens, outputTokens: total.outputTokens + entry.usage.outputTokens }),
      { inputTokens: 0, outputTokens: 0 }
    );
    const call = await db.evolutionAiCall.create({
      data: {
        ...base,
        status: failure.kind === "REFUSAL" ? "REFUSED" : "FAILED",
        attempts: failure.attempts,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd,
        usageJson: { byModel: failure.usageByModel, costBasis: unconfirmed ? "WORST_CASE_UNCONFIRMED" : "REPORTED_USAGE" } as never,
        latencyMs: Date.now() - started,
        errorKind: failure.kind,
        errorMessage: `${failure.message.slice(0, 900)}${unconfirmed ? " — Kosten unbestätigt, konservativ mit dem schlechtesten Fall gebucht." : ""}`
      }
    });
    if (runId !== null && (failure.usageByModel.length > 0 || unconfirmed)) {
      await addRunUsage(db, runId, { ...usage, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, provider.billable ? costUsd : 0);
    }
    await recordAuditEvent(db, {
      eventKey: `ai-call:${call.id}`,
      eventType: "AI_CALL_FAILED",
      aggregateType: "EvolutionAiCall",
      aggregateId: call.id,
      actorType: "SYSTEM",
      payload: { runId, task: request.task, model: request.model, kind: failure.kind, attempts: failure.attempts, costUsd },
      occurredAt: deps.now()
    });
    throw failure;
  }
}

async function addRunUsage(
  db: EvolutionDb,
  runId: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number },
  billableCostUsd: number
) {
  await db.evolutionRun.update({
    where: { id: runId },
    data: {
      aiInputTokens: { increment: usage.inputTokens },
      aiOutputTokens: { increment: usage.outputTokens },
      aiCacheWriteTokens: { increment: usage.cacheCreationInputTokens },
      aiCacheReadTokens: { increment: usage.cacheReadInputTokens },
      aiCostUsd: { increment: billableCostUsd }
    }
  });
}
