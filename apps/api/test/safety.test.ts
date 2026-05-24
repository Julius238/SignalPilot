import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { checkProductionSafety, assertProductionSafety } from "../src/lib/safety.js";

describe("production safety check", () => {
  const savedLiveTrading = process.env.ENABLE_LIVE_TRADING;

  afterEach(() => {
    if (savedLiveTrading === undefined) {
      delete process.env.ENABLE_LIVE_TRADING;
    } else {
      process.env.ENABLE_LIVE_TRADING = savedLiveTrading;
    }
  });

  it("passes when ENABLE_LIVE_TRADING is not set", () => {
    delete process.env.ENABLE_LIVE_TRADING;
    const result = checkProductionSafety();
    assert.equal(result.safe, true);
  });

  it("passes when ENABLE_LIVE_TRADING=false", () => {
    process.env.ENABLE_LIVE_TRADING = "false";
    const result = checkProductionSafety();
    assert.equal(result.safe, true);
  });

  it("fails when ENABLE_LIVE_TRADING=true", () => {
    process.env.ENABLE_LIVE_TRADING = "true";
    const result = checkProductionSafety();
    assert.equal(result.safe, false);
    if (!result.safe) {
      assert.ok(result.reason.length > 0, "reason should not be empty");
      assert.ok(
        result.reason.toLowerCase().includes("live_trading"),
        "reason should mention ENABLE_LIVE_TRADING"
      );
    }
  });

  it("assertProductionSafety calls process.exit(1) when unsafe", () => {
    process.env.ENABLE_LIVE_TRADING = "true";

    let capturedCode: number | undefined;
    const originalExit = process.exit.bind(process);
    process.exit = ((code?: number) => {
      capturedCode = code;
    }) as typeof process.exit;

    try {
      assertProductionSafety();
    } finally {
      process.exit = originalExit;
    }

    assert.equal(capturedCode, 1);
  });

  it("assertProductionSafety does not exit when safe", () => {
    delete process.env.ENABLE_LIVE_TRADING;

    let exited = false;
    const originalExit = process.exit.bind(process);
    process.exit = (() => {
      exited = true;
    }) as typeof process.exit;

    try {
      assertProductionSafety();
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exited, false);
  });

  it("/health response does not expose secrets", async () => {
    const Fastify = (await import("fastify")).default;
    const { registerHealthRoutes } = await import("../src/routes/health.js");

    const server = Fastify({ logger: false });
    await server.register(registerHealthRoutes);

    // Set a fake secret value to verify it never leaks
    process.env.AUTH_SESSION_SECRET = "super-secret-value";
    process.env.ADMIN_PASSWORD_HASH = "$2b$12$secret-hash";

    try {
      const response = await server.inject({ method: "GET", url: "/health" });
      assert.equal(response.statusCode, 200);

      const body = JSON.stringify(response.json());
      assert.ok(!body.includes("super-secret-value"), "should not expose AUTH_SESSION_SECRET");
      assert.ok(!body.includes("secret-hash"), "should not expose ADMIN_PASSWORD_HASH");
    } finally {
      delete process.env.AUTH_SESSION_SECRET;
      delete process.env.ADMIN_PASSWORD_HASH;
      await server.close();
    }
  });
});
