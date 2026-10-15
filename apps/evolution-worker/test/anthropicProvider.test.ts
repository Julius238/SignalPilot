import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Anthropic from "@anthropic-ai/sdk";
import { AiProviderError, HYPOTHESIS_RESPONSE_SCHEMA, costOfModelUsage, type AiRequest } from "@signalpilot/evolution";

import { AnthropicResearchProvider, SERVER_SIDE_FALLBACK_BETA, classifyError, usageByModelOf, type MessagesCreateClient } from "../src/ai/anthropicProvider.js";

const request = (model = "claude-opus-5-5"): AiRequest => ({
  task: "HYPOTHESIS_GENERATION",
  tier: "ADVANCED",
  model,
  system: "system prompt",
  prompt: "user prompt",
  jsonSchema: HYPOTHESIS_RESPONSE_SCHEMA,
  maxOutputTokens: 16000,
  effort: "medium"
});

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify({ summary: "s", hypotheses: [] }), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: null },
    _request_id: "req_123",
    ...overrides
  } as never;
}

function fakeClient(responses: (() => unknown)[]): MessagesCreateClient & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    async create(params) {
      calls.push(params as never);
      const next = responses.shift();
      if (next === undefined) throw new Error("no more fake responses");
      return next() as never;
    }
  };
}

const headers = (retryAfter?: string) => new Headers(retryAfter === undefined ? {} : { "retry-after": retryAfter });
const noSleep = async () => undefined;

describe("Anthropic research provider", () => {
  it("sends the schema as structured output and returns parsed JSON with usage and request id", async () => {
    const client = fakeClient([() => message()]);
    const provider = new AnthropicResearchProvider({ client, maxRetries: 2, timeoutMs: 60_000, refusalFallback: "default", sleep: noSleep });
    const response = await provider.complete(request());
    assert.deepEqual(response.json, { summary: "s", hypotheses: [] });
    assert.equal(response.requestId, "req_123");
    assert.equal(response.attempts, 1);
    assert.deepEqual(response.usage, { inputTokens: 1200, outputTokens: 800, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    const params = client.calls[0]!;
    assert.deepEqual(params.output_config, { effort: "medium", format: { type: "json_schema", schema: HYPOTHESIS_RESPONSE_SCHEMA } });
    assert.equal(params.max_tokens, 16000);
    assert.equal("thinking" in params, false, "Opus 5.5 thinks adaptively; no thinking parameter is sent");
    assert.deepEqual(params.betas, [SERVER_SIDE_FALLBACK_BETA]);
    assert.equal(params.fallbacks, "default");
    assert.equal(provider.billable, true);
  });

  it("does not request a server-side fallback for Haiku or when it is switched off", async () => {
    const haiku = fakeClient([() => message({ model: "claude-haiku-5-5" })]);
    await new AnthropicResearchProvider({ client: haiku, maxRetries: 0, timeoutMs: 60_000, refusalFallback: "default" }).complete(request("claude-haiku-5-5"));
    assert.equal("fallbacks" in haiku.calls[0]!, false);
    const off = fakeClient([() => message()]);
    await new AnthropicResearchProvider({ client: off, maxRetries: 0, timeoutMs: 60_000, refusalFallback: "off" }).complete(request());
    assert.equal("betas" in off.calls[0]!, false);
  });

  it("retries rate limits, overload and connection errors with back-off, honouring retry-after", async () => {
    const waits: number[] = [];
    const client = fakeClient([
      () => {
        throw new Anthropic.RateLimitError(429, undefined, "rate limited", headers("7"));
      },
      () => {
        throw new Anthropic.InternalServerError(529, undefined, "overloaded", headers());
      },
      () => {
        throw new Anthropic.APIConnectionError({ message: "socket hang up" });
      },
      () => message()
    ]);
    const provider = new AnthropicResearchProvider({ client, maxRetries: 3, timeoutMs: 60_000, refusalFallback: "off", sleep: async (ms) => void waits.push(ms) });
    const response = await provider.complete(request());
    assert.equal(response.attempts, 4);
    assert.equal(waits.length, 3);
    assert.ok(waits[0]! >= 7000, "retry-after of 7 s is honoured");
  });

  it("gives up after the configured retries and never retries a bad request or auth error", async () => {
    const always429 = fakeClient(Array.from({ length: 5 }, () => () => {
      throw new Anthropic.RateLimitError(429, undefined, "rate limited", headers());
    }));
    await assert.rejects(new AnthropicResearchProvider({ client: always429, maxRetries: 2, timeoutMs: 60_000, refusalFallback: "off", sleep: noSleep }).complete(request()), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.kind, "RATE_LIMIT");
      assert.equal(error.attempts, 3);
      return true;
    });
    for (const [failure, kind] of [
      [new Anthropic.BadRequestError(400, undefined, "bad", headers()), "BAD_REQUEST"],
      [new Anthropic.AuthenticationError(401, undefined, "no key", headers()), "AUTH"]
    ] as const) {
      const client = fakeClient([() => {
        throw failure;
      }, () => message()]);
      await assert.rejects(new AnthropicResearchProvider({ client, maxRetries: 3, timeoutMs: 60_000, refusalFallback: "off", sleep: noSleep }).complete(request()), (error: unknown) => (error as AiProviderError).kind === kind);
      assert.equal(client.calls.length, 1);
    }
  });

  it("reports refusals, truncation and malformed output with the tokens already used", async () => {
    for (const [overrides, kind] of [
      [{ stop_reason: "refusal", content: [] }, "REFUSAL"],
      [{ stop_reason: "max_tokens" }, "TRUNCATED"],
      [{ content: [{ type: "text", text: "not json", citations: null }] }, "MALFORMED"]
    ] as const) {
      const client = fakeClient([() => message(overrides)]);
      await assert.rejects(new AnthropicResearchProvider({ client, maxRetries: 3, timeoutMs: 60_000, refusalFallback: "off", sleep: noSleep }).complete(request()), (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.kind, kind);
        assert.equal(error.usageByModel[0]!.usage.outputTokens, 800);
        return true;
      });
      assert.equal(client.calls.length, 1, `${kind} is never retried`);
    }
  });

  it("prices a server-side fallback per attempt with each model's own price", () => {
    const usage = usageByModelOf(
      {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          iterations: [
            { type: "message", model: null, input_tokens: 1000, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
          ]
        }
      } as never,
      "claude-opus-5-5"
    );
    assert.deepEqual(usage.map((entry) => entry.model), ["claude-opus-5-5", "claude-opus-4-8"]);
    // Opus 5.5 declined attempt: 1000 × $4 + 20 × $20; Opus 4.8 rescue: 1000 × $5 + 500 × $25 (per million).
    assert.equal(costOfModelUsage(usage), (1000 * 4 + 20 * 20 + 1000 * 5 + 500 * 25) / 1_000_000);
  });

  it("classifies typed SDK errors, never by message text", () => {
    assert.equal(classifyError(new Anthropic.InternalServerError(500, undefined, "x", headers())).kind, "SERVER");
    assert.equal(classifyError(new Anthropic.APIConnectionTimeoutError({ message: "t" })).kind, "TIMEOUT");
    assert.equal(classifyError(new Error("rate limit exceeded")).kind, "UNKNOWN");
  });

  it("refuses to start without a key and never exposes it", () => {
    assert.throws(() => new AnthropicResearchProvider({ maxRetries: 0, timeoutMs: 60_000, refusalFallback: "off" }), (error: unknown) => (error as AiProviderError).kind === "NOT_CONFIGURED");
    const provider = new AnthropicResearchProvider({ apiKey: "sk-ant-test-secret", maxRetries: 0, timeoutMs: 60_000, refusalFallback: "off" });
    assert.equal(JSON.stringify(provider).includes("sk-ant-test-secret"), false);
    assert.equal(JSON.stringify(provider.buildParams(request())).includes("sk-ant-test-secret"), false);
  });
});
