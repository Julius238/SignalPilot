import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";

import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance } from "fastify";

import { requireAdmin } from "../src/auth/helpers.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import {
  registerTradingOperationsRoutes,
  setTradingOperationsDatabaseForTests
} from "../src/routes/trading/operations.js";
import {
  registerTradingReadRoutes,
  setTradingReadsDatabaseForTests
} from "../src/routes/trading/reads.js";
import { createFakeTradingDatabase } from "./support/tradingFixtures.js";

const TEST_USERNAME = "testadmin";
const TEST_PASSWORD = "correct-password-123";
const TEST_SESSION_SECRET = "test-secret-must-be-long-enough-32chars";
let TEST_PASSWORD_HASH: string;

before(async () => {
  TEST_PASSWORD_HASH = await bcrypt.hash(TEST_PASSWORD, 4);
});

const savedEnv = {
  API_AUTH_ENABLED: process.env.API_AUTH_ENABLED,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
  DEV_LOGIN_ENABLED: process.env.DEV_LOGIN_ENABLED
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function buildTestServer(
  fakeDb: unknown,
  authEnabled = true
): Promise<FastifyInstance> {
  process.env.API_AUTH_ENABLED = authEnabled ? "true" : "false";
  process.env.ADMIN_USERNAME = TEST_USERNAME;
  process.env.ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
  process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.DEV_LOGIN_ENABLED = "false";

  const server = Fastify({ logger: false });
  await server.register(cookie);
  await server.register(rateLimit, { global: false });
  await server.register(registerAuthRoutes);
  await server.register(async (protectedScope) => {
    protectedScope.addHook("onRequest", async (request, reply) => {
      await requireAdmin(request, reply);
    });
    await protectedScope.register(registerTradingReadRoutes);
    await protectedScope.register(registerTradingOperationsRoutes);
  });

  setTradingReadsDatabaseForTests(fakeDb as never);
  setTradingOperationsDatabaseForTests(fakeDb as never);
  return server;
}

async function loginAndGetCookies(
  server: FastifyInstance
): Promise<{ session: string; csrfCookie: string; csrfToken: string }> {
  const loginResponse = await server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  assert.equal(loginResponse.statusCode, 200);
  const rawSessionCookie = loginResponse.headers["set-cookie"] as
    | string
    | string[];
  const session = (
    Array.isArray(rawSessionCookie) ? rawSessionCookie[0] : rawSessionCookie
  ).split(";")[0];

  const csrfResponse = await server.inject({
    method: "GET",
    url: "/trading/csrf-token",
    headers: { cookie: session }
  });
  assert.equal(csrfResponse.statusCode, 200);
  const csrfToken = csrfResponse.json().csrfToken as string;
  const rawCsrfCookie = csrfResponse.headers["set-cookie"] as string | string[];
  const csrfCookie = (
    Array.isArray(rawCsrfCookie) ? rawCsrfCookie : [rawCsrfCookie]
  )
    .map((entry) => entry.split(";")[0])
    .find((entry) => entry.startsWith("signalpilot_trading_csrf="));
  assert.ok(csrfCookie, "csrf cookie must be set");

  return { session, csrfCookie: csrfCookie!, csrfToken };
}

describe("trading read routes — auth", () => {
  it("returns 401 for /trading/overview without a session when auth is enabled", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, true);
    const response = await server.inject("/trading/overview");
    assert.equal(response.statusCode, 401);
    await server.close();
  });

  it("allows /trading/overview with a valid session cookie", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, true);
    const { session } = await loginAndGetCookies(server);
    const response = await server.inject({
      method: "GET",
      url: "/trading/overview",
      headers: { cookie: session }
    });
    assert.equal(response.statusCode, 200);
    await server.close();
  });
});

describe("trading read routes — overview shape", () => {
  it("returns an empty-portfolio overview with decimal-as-string fields and no portfolio object when none exists", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, false);
    const response = await server.inject("/trading/overview");
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.portfolio, null);
    assert.equal(typeof body.unrealizedPnl, "string");
    assert.equal(typeof body.realizedPnl, "string");
    assert.match(body.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await server.close();
  });

  it("serializes decimals as strings and timestamps as ISO-UTC once a portfolio exists", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: {
        key: "SHADOW_V1",
        name: "Shadow v1",
        status: "ACTIVE",
        availableCash: "1000.500000000000",
        reservedCash: "0",
        realizedPnl: "12.340000000000",
        feesPaid: "0",
        equity: "1000.500000000000",
        highWaterMark: "1000.500000000000"
      }
    });
    const server = await buildTestServer(database, false);
    const response = await server.inject("/trading/overview");
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.portfolio.id, portfolio.id);
    assert.equal(typeof body.portfolio.availableCash, "string");
    assert.equal(body.portfolio.availableCash, "1000.500000000000");
    assert.equal(typeof body.realizedPnl, "string");
    await server.close();
  });
});

describe("trading read routes — 404 and filters", () => {
  it("returns 404 for an unknown candidate id", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, false);
    const response = await server.inject("/trading/candidates/does-not-exist");
    assert.equal(response.statusCode, 404);
    await server.close();
  });

  it("returns 404 for an unknown position id", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, false);
    const response = await server.inject("/trading/positions/does-not-exist");
    assert.equal(response.statusCode, 404);
    await server.close();
  });

  it("filters candidates by status and respects limit/offset", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" }
    });
    for (let i = 0; i < 3; i += 1) {
      tables.get("tradeCandidate")!.create({
        data: {
          candidateKey: `cand-${i}`,
          portfolioId: portfolio.id,
          assetId: "asset-1",
          status: i === 0 ? "APPROVED_FOR_SHADOW" : "CREATED",
          referenceEntryPrice: "1",
          stopPrice: "1",
          takeProfitPrice: "1",
          minimumRewardRisk: "2",
          dataAsOf: new Date(Date.UTC(2026, 0, 1 + i)),
          decisionTime: new Date(),
          expiresAt: new Date()
        }
      });
    }
    const server = await buildTestServer(database, false);

    const filtered = await server.inject(
      "/trading/candidates?status=APPROVED_FOR_SHADOW"
    );
    assert.equal(filtered.statusCode, 200);
    assert.equal(filtered.json().length, 1);

    const paged = await server.inject("/trading/candidates?limit=1&offset=1");
    assert.equal(paged.statusCode, 200);
    assert.equal(paged.json().length, 1);

    const badLimit = await server.inject("/trading/candidates?limit=0");
    assert.equal(badLimit.statusCode, 400);

    await server.close();
  });

  it("filters assignment direction before applying pagination", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" }
    });
    const asset = tables.get("asset")!.create({
      data: { symbol: "BTCUSDT", assetType: "CRYPTO" }
    });
    const strategies = [
      { key: "CRYPTO_MTF_BREAKOUT_LONG_V1", direction: "LONG" },
      { key: "CRYPTO_MTF_BREAKDOWN_SHORT_V1", direction: "SHORT" },
      { key: "CRYPTO_MTF_BREAKDOWN_SHORT_V1", direction: "SHORT" }
    ] as const;
    for (const [index, definition] of strategies.entries()) {
      const strategy = tables.get("strategy")!.create({
        data: {
          key: `${definition.key}-${index}`,
          name: definition.key,
          status: "ACTIVE"
        }
      });
      const version = tables.get("strategyVersion")!.create({
        data: {
          strategyId: strategy.id,
          version: 1,
          status: "ACTIVE",
          engineVersion: `engine-${index}`,
          specificationHash: `hash-${index}`,
          parametersJson: { direction: definition.direction }
        }
      });
      tables.get("strategyAssignment")!.create({
        data: {
          id: `assignment-${index}`,
          portfolioId: portfolio.id,
          assetId: asset.id,
          strategyId: strategy.id,
          strategyVersionId: version.id,
          timeframe: "1h",
          enabled: false,
          assignmentConfigJson: {
            direction: definition.direction,
            leverageAllowed: false,
            marginAllowed: false,
            futuresAllowed: false,
            syntheticShadowShort: definition.direction === "SHORT"
          },
          createdAt: new Date(`2026-08-04T00:0${index}:00.000Z`)
        }
      });
    }

    const server = await buildTestServer(database, false);
    const response = await server.inject(
      "/trading/assignments?direction=SHORT&limit=1&offset=1"
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json().map((row: { id: string; direction: string }) => ({
        id: row.id,
        direction: row.direction
      })),
      [{ id: "assignment-2", direction: "SHORT" }]
    );
    await server.close();
  });

  it("filters SHORT candidates, orders, fills and positions with strategy provenance", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "ACTIVE" }
    });
    const asset = tables
      .get("asset")!
      .create({ data: { symbol: "BTCUSDT", assetType: "CRYPTO" } });
    const strategy = tables.get("strategy")!.create({
      data: {
        key: "CRYPTO_MTF_BREAKDOWN_SHORT_V1",
        name: "Breakdown Short",
        status: "ACTIVE"
      }
    });
    const version = tables.get("strategyVersion")!.create({
      data: {
        strategyId: strategy.id,
        version: 1,
        engineVersion: "crypto-mtf-breakdown-short-v1",
        codeVersion: "test",
        specificationHash: "sha256:test-short",
        parametersJson: { direction: "SHORT" }
      }
    });
    const assignment = tables.get("strategyAssignment")!.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        assignmentConfigJson: { direction: "SHORT", syntheticShadowShort: true }
      }
    });

    const candidate = tables.get("tradeCandidate")!.create({
      data: {
        candidateKey: "short-candidate",
        portfolioId: portfolio.id,
        assetId: asset.id,
        direction: "SHORT",
        strategyAssignmentId: assignment.id,
        strategyVersionId: version.id,
        entryType: "MARKET_NEXT_BAR",
        status: "APPROVED_FOR_SHADOW",
        referenceEntryPrice: "24000",
        stopPrice: "24600",
        takeProfitPrice: "22700",
        minimumRewardRisk: "2",
        plannedRewardRisk: "2.16",
        invalidReasonCode: null,
        cancelReasonCode: null,
        dataAsOf: new Date("2026-08-04T09:00:00.000Z"),
        decisionTime: new Date("2026-08-04T09:00:01.000Z"),
        expiresAt: new Date("2026-08-04T11:00:00.000Z")
      }
    });
    const order = tables.get("shadowOrder")!.create({
      data: {
        orderKey: "short-order",
        portfolioId: portfolio.id,
        assetId: asset.id,
        tradeCandidateId: candidate.id,
        shadowPositionId: null,
        purpose: "ENTRY",
        direction: "SHORT",
        side: "SELL",
        orderType: "MARKET_NEXT_BAR",
        timeInForce: "GTC",
        status: "FILLED",
        requestedQuantity: "0.1",
        filledQuantity: "0.1",
        remainingQuantity: "0",
        referencePrice: "24000",
        reservedQuoteAmount: "2500",
        rejectionReasonCode: null,
        cancelReasonCode: null,
        earliestFillAt: null,
        expiresAt: null
      }
    });
    const position = tables.get("shadowPosition")!.create({
      data: {
        positionKey: "short-position",
        portfolioId: portfolio.id,
        assetId: asset.id,
        entryOrderId: order.id,
        strategyAssignmentId: assignment.id,
        strategyVersionId: version.id,
        direction: "SHORT",
        status: "OPEN",
        initialQuantity: "0.1",
        openQuantity: "0.1",
        closedQuantity: "0",
        averageEntryPrice: "23990",
        averageExitPrice: "0",
        grossEntryNotional: "2399",
        grossExitNotional: "0",
        realizedPnl: "0",
        feesPaid: "1.2",
        reservedCollateral: "2400.2",
        stopPrice: "24600",
        takeProfitPrice: "22700",
        maxHoldUntil: new Date("2026-08-07T10:00:00.000Z"),
        openedAt: new Date("2026-08-04T10:00:00.000Z"),
        closedAt: null,
        lastValuationAt: new Date("2026-08-04T10:00:00.000Z")
      }
    });
    tables.get("shadowOrder")!.update({
      where: { id: order.id },
      data: { shadowPositionId: position.id }
    });
    tables.get("shadowFill")!.create({
      data: {
        fillKey: "short-fill",
        shadowOrderId: order.id,
        shadowPositionId: position.id,
        assetId: asset.id,
        side: "SELL",
        quantity: "0.1",
        referencePrice: "24000",
        spreadAmount: "5",
        slippageAmount: "5",
        fillPrice: "23990",
        notional: "2399",
        feeAmount: "1.2",
        feeAsset: "USDT",
        triggerType: "ENTRY",
        occurredAt: new Date("2026-08-04T10:00:00.000Z")
      }
    });

    const server = await buildTestServer(database, false);
    for (const path of ["candidates", "orders", "fills", "positions"]) {
      const response = await server.inject(
        `/trading/${path}?direction=SHORT&strategyVersionId=${version.id}&limit=1&offset=0`
      );
      assert.equal(response.statusCode, 200, path);
      const rows = response.json();
      assert.equal(rows.length, 1, path);
      assert.equal(rows[0].direction, "SHORT", path);
      assert.equal(rows[0].strategyVersionId, version.id, path);
      assert.equal(rows[0].syntheticShadowShort, true, path);
      assert.equal(rows[0].exchangePosition, false, path);
    }
    await server.close();
  });
});

describe("trading operations — guards", () => {
  it("requires auth even with CSRF headers present", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, true);
    const response = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      payload: {
        portfolioId: "x",
        confirm: "ACTIVATE_PORTFOLIO",
        idempotencyKey: "k",
        expectedVersion: 0
      }
    });
    assert.equal(response.statusCode, 401);
    await server.close();
  });

  it("blocks a request missing the CSRF header even with a valid session", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" }
    });
    const server = await buildTestServer(database, true);
    const { session } = await loginAndGetCookies(server);

    const response = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers: { cookie: session },
      payload: {
        portfolioId: portfolio.id,
        confirm: "ACTIVATE_PORTFOLIO",
        idempotencyKey: "k",
        expectedVersion: 0
      }
    });
    assert.equal(response.statusCode, 403);
    await server.close();
  });

  it("requires confirm, idempotencyKey and expectedVersion (400 when any is missing)", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" }
    });
    const server = await buildTestServer(database, true);
    const { session, csrfCookie, csrfToken } = await loginAndGetCookies(server);
    const headers = {
      cookie: `${session}; ${csrfCookie}`,
      "x-trading-csrf-token": csrfToken
    };

    const missingConfirm = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers,
      payload: {
        portfolioId: portfolio.id,
        idempotencyKey: "k",
        expectedVersion: 0
      }
    });
    assert.equal(missingConfirm.statusCode, 400);

    const missingIdempotency = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers,
      payload: {
        portfolioId: portfolio.id,
        confirm: "ACTIVATE_PORTFOLIO",
        expectedVersion: 0
      }
    });
    assert.equal(missingIdempotency.statusCode, 400);

    const missingVersion = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers,
      payload: {
        portfolioId: portfolio.id,
        confirm: "ACTIVATE_PORTFOLIO",
        idempotencyKey: "k"
      }
    });
    assert.equal(missingVersion.statusCode, 400);

    await server.close();
  });

  it("returns 409 on a stale expectedVersion and 200 with replayed:true on a repeat of the same request", async () => {
    const { database, tables } = createFakeTradingDatabase();
    const portfolio = tables.get("portfolio")!.create({
      data: { key: "SHADOW_V1", name: "Shadow v1", status: "DRAFT" }
    });
    const server = await buildTestServer(database, true);
    const { session, csrfCookie, csrfToken } = await loginAndGetCookies(server);
    const headers = {
      cookie: `${session}; ${csrfCookie}`,
      "x-trading-csrf-token": csrfToken
    };

    const stale = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers,
      payload: {
        portfolioId: portfolio.id,
        confirm: "ACTIVATE_PORTFOLIO",
        idempotencyKey: "k1",
        expectedVersion: 7
      }
    });
    assert.equal(stale.statusCode, 409);
    // P8, "5.": the current version must be a field, not something a client
    // has to regex out of the prose message.
    const conflict = stale.json();
    assert.equal(conflict.reasonCode, "VERSION_CONFLICT");
    assert.equal(conflict.currentVersion, 0);
    assert.equal(conflict.expectedVersion, 7);
    assert.equal(conflict.entityType, "Portfolio");
    assert.equal(conflict.entityId, portfolio.id);
    assert.equal(typeof conflict.message, "string");

    const first = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers,
      payload: {
        portfolioId: portfolio.id,
        confirm: "ACTIVATE_PORTFOLIO",
        idempotencyKey: "k2",
        expectedVersion: 0
      }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().replayed, false);

    const replay = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      headers,
      payload: {
        portfolioId: portfolio.id,
        confirm: "ACTIVATE_PORTFOLIO",
        idempotencyKey: "k2",
        expectedVersion: 0
      }
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);

    await server.close();
  });

  it("run-job rejects a non-allowlisted job name over HTTP", async () => {
    const { database } = createFakeTradingDatabase();
    const server = await buildTestServer(database, true);
    const { session, csrfCookie, csrfToken } = await loginAndGetCookies(server);
    const headers = {
      cookie: `${session}; ${csrfCookie}`,
      "x-trading-csrf-token": csrfToken
    };

    const response = await server.inject({
      method: "POST",
      url: "/trading/operations/run-job",
      headers,
      payload: {
        jobName: "; rm -rf /",
        confirm: "RUN_JOB",
        idempotencyKey: "k3"
      }
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().reasonCode, "JOB_NOT_ALLOWLISTED");

    await server.close();
  });
});

describe("trading operations — disabled route registration", () => {
  it("404s on an operations route when the operations route group was never registered", async () => {
    const { database } = createFakeTradingDatabase();
    process.env.API_AUTH_ENABLED = "false";
    const server = Fastify({ logger: false });
    await server.register(cookie);
    await server.register(registerTradingReadRoutes);
    setTradingReadsDatabaseForTests(database as never);

    const response = await server.inject({
      method: "POST",
      url: "/trading/operations/activate-portfolio",
      payload: {}
    });
    assert.equal(response.statusCode, 404);
    await server.close();
  });
});
