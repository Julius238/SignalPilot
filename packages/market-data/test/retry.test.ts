import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retryProviderRequest } from "../src/retry.js";

describe("provider retry", () => {
  it("retries rate-limit results with bounded exponential backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const outcome = await retryProviderRequest(
      async () => {
        attempts += 1;
        return attempts < 3 ? { kind: "rate_limit" } : { kind: "ok" };
      },
      {
        maxAttempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 150,
        shouldRetryResult: (result) => result.kind === "rate_limit",
        resultKind: (result) => result.kind.toUpperCase(),
        sleep: async (ms) => {
          delays.push(ms);
        }
      }
    );

    assert.equal(outcome.value.kind, "ok");
    assert.equal(outcome.retryCount, 2);
    assert.deepEqual(delays, [100, 150]);
  });
});
