/**
 * Anthropic Messages API behind the research provider boundary.
 *
 * - Structured output: every request carries the JSON schema of its task
 *   (`output_config.format`), the answer is parsed and validated again by
 *   the engine — model output is untrusted input.
 * - Retries: own loop (the SDK's built-in retries are off so every attempt
 *   is counted and audited): rate limits, overload, 5xx, timeouts and
 *   connection errors back off exponentially and honour `retry-after`; bad
 *   requests, authentication and refusals are never retried.
 * - Refusals: with `refusalFallback: "default"` the API re-runs a declined
 *   request server-side on Anthropic's recommended fallback model
 *   (beta `server-side-fallback-2026-07-01`). Usage is then read per attempt
 *   from `usage.iterations`, so the fallback's tokens are priced with the
 *   fallback model.
 * - The key lives only inside the SDK client; nothing here logs or returns it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AiProviderError, type AiErrorKind, type AiModelUsage, type AiRequest, type AiResponse, type AiUsage, type ResearchAiProvider } from "@signalpilot/evolution";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** The one SDK call the provider needs — injectable for tests. */
export interface MessagesCreateClient {
  create(params: CreateParams): Promise<BetaMessage & { _request_id?: string | null }>;
}

export interface AnthropicProviderOptions {
  readonly apiKey?: string;
  readonly client?: MessagesCreateClient;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  readonly refusalFallback: "default" | "off";
  /** Test seam for the back-off wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Models with a server-side refusal fallback (Haiku 5.5 has none). */
const FALLBACK_CAPABLE = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const toUsage = (usage: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined): AiUsage => ({
  inputTokens: usage?.input_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
  cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0
});

/** Per-model usage of a response: every sampling attempt when the API reports them, else the top level. */
export function usageByModelOf(message: Pick<BetaMessage, "model" | "usage">, requestedModel: string): AiModelUsage[] {
  const iterations = (message.usage as { iterations?: readonly { type: string; model?: string | null }[] | null } | undefined)?.iterations;
  const sampled = (iterations ?? []).filter((entry) => entry.type === "message" || entry.type === "fallback_message");
  if (sampled.length === 0) return [{ model: message.model ?? requestedModel, usage: toUsage(message.usage) }];
  return sampled.map((entry) => ({ model: entry.model ?? requestedModel, usage: toUsage(entry as never) }));
}

const sumUsage = (entries: readonly AiModelUsage[]): AiUsage =>
  entries.reduce(
    (total, entry) => ({
      inputTokens: total.inputTokens + entry.usage.inputTokens,
      outputTokens: total.outputTokens + entry.usage.outputTokens,
      cacheCreationInputTokens: total.cacheCreationInputTokens + entry.usage.cacheCreationInputTokens,
      cacheReadInputTokens: total.cacheReadInputTokens + entry.usage.cacheReadInputTokens
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
  );

/** Typed SDK errors → provider error kinds (never by matching message text). */
export function classifyError(error: unknown): { kind: AiErrorKind; status: number | null; retryAfterMs: number | null } {
  const retryAfter = (headers: unknown): number | null => {
    const value = headers instanceof Headers ? headers.get("retry-after") : null;
    const seconds = value === null ? Number.NaN : Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 120_000) : null;
  };
  if (error instanceof Anthropic.RateLimitError) return { kind: "RATE_LIMIT", status: 429, retryAfterMs: retryAfter(error.headers) };
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return { kind: "AUTH", status: error.status, retryAfterMs: null };
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) return { kind: "BAD_REQUEST", status: error.status, retryAfterMs: null };
  if (error instanceof Anthropic.NotFoundError) return { kind: "NOT_FOUND", status: 404, retryAfterMs: null };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { kind: "TIMEOUT", status: null, retryAfterMs: null };
  if (error instanceof Anthropic.APIConnectionError) return { kind: "CONNECTION", status: null, retryAfterMs: null };
  if (error instanceof Anthropic.ConflictError) return { kind: "SERVER", status: 409, retryAfterMs: retryAfter(error.headers) };
  if (error instanceof Anthropic.InternalServerError) return { kind: error.status === 529 ? "OVERLOADED" : "SERVER", status: error.status, retryAfterMs: retryAfter(error.headers) };
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500) return { kind: "SERVER", status: error.status, retryAfterMs: null };
  return { kind: "UNKNOWN", status: null, retryAfterMs: null };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AnthropicResearchProvider implements ResearchAiProvider {
  readonly name = "anthropic";
  readonly billable = true;
  private readonly client: MessagesCreateClient;
  /** Options without the key: the key lives only inside the SDK client. */
  private readonly options: Omit<AnthropicProviderOptions, "apiKey">;

  constructor(options: AnthropicProviderOptions) {
    const { apiKey: _apiKey, ...rest } = options;
    void _apiKey;
    this.options = rest;
    if (options.client !== undefined) {
      this.client = options.client;
    } else {
      if (!options.apiKey) throw new AiProviderError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not configured.");
      // maxRetries 0: the retry loop below owns retries so each attempt is counted.
      const sdk = new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs });
      this.client = { create: (params) => sdk.beta.messages.create(params) };
    }
  }

  buildParams(request: AiRequest): CreateParams {
    const params: CreateParams = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      output_config: { effort: request.effort, format: { type: "json_schema", schema: request.jsonSchema as Record<string, unknown> } }
    };
    if (this.options.refusalFallback === "default" && FALLBACK_CAPABLE.has(request.model)) {
      return { ...params, betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: "default" };
    }
    return params;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    const sleep = this.options.sleep ?? defaultSleep;
    const params = this.buildParams(request);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let message: BetaMessage & { _request_id?: string | null };
      try {
        message = await this.client.create(params);
      } catch (error) {
        const { kind, status, retryAfterMs } = classifyError(error);
        const failure = new AiProviderError(kind, error instanceof Error ? error.message : String(error), { status, attempts: attempt });
        if (!failure.retryable || attempt > this.options.maxRetries) throw failure;
        const backoff = Math.min(60_000, 2_000 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
        await sleep(Math.max(backoff, retryAfterMs ?? 0));
        continue;
      }
      const usageByModel = usageByModelOf(message, request.model);
      const requestId = message._request_id ?? null;
      if (message.stop_reason === "refusal") {
        throw new AiProviderError("REFUSAL", `The model declined the request (${requestId ?? "no request id"}).`, { attempts: attempt, usageByModel });
      }
      if (message.stop_reason === "max_tokens") {
        throw new AiProviderError("TRUNCATED", `Output hit max_tokens=${request.maxOutputTokens}; the JSON answer is incomplete.`, { attempts: attempt, usageByModel });
      }
      const text = message.content
        .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiProviderError("MALFORMED", "The response is not valid JSON despite the output schema.", { attempts: attempt, usageByModel });
      }
      return {
        servedModel: message.model,
        text,
        json,
        usage: sumUsage(usageByModel),
        usageByModel,
        stopReason: message.stop_reason ?? null,
        requestId,
        attempts: attempt
      };
    }
  }
}
