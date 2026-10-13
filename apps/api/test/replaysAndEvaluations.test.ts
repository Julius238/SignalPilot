import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Fastify from "fastify";

import { registerReplayRoutes, setReplaysDatabaseForTests } from "../src/routes/replays.js";
import { registerTradingReadRoutes, setTradingReadsDatabaseForTests } from "../src/routes/trading/reads.js";

const decimal = (value: string) => ({ toString: () => value });

describe("replay routes", () => {
  const run = {
    id: "run-1",
    label: "BTCUSDT SPEC",
    startingCash: decimal("10000.000000000000"),
    finalEquity: decimal("10123.450000000000"),
    metricsJson: { overall: { closedTrades: 3 } },
    createdAt: new Date("2026-10-13T07:00:00.000Z")
  };
  const db = {
    shadowReplayRun: {
      findMany: async (args: { take: number }) => [run].slice(0, args.take),
      findUnique: async (args: { where: { id: string } }) => (args.where.id === run.id ? { ...run, tradesJson: [] } : null)
    }
  };

  it("lists runs with decimals as strings and serves a single run", async () => {
    setReplaysDatabaseForTests(db as never);
    const server = Fastify({ logger: false });
    await server.register(registerReplayRoutes);

    const list = await server.inject({ method: "GET", url: "/replays?limit=500" });
    assert.equal(list.statusCode, 200);
    const [first] = list.json() as Array<Record<string, unknown>>;
    assert.equal(first.finalEquity, "10123.450000000000");

    const detail = await server.inject({ method: "GET", url: "/replays/run-1" });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual((detail.json() as { tradesJson: unknown[] }).tradesJson, []);

    const missing = await server.inject({ method: "GET", url: "/replays/unknown" });
    assert.equal(missing.statusCode, 404);
    await server.close();
  });
});

describe("GET /trading/strategy-evaluations", () => {
  it("returns every evaluation with its failed conditions", async () => {
    const events = [
      {
        id: "evt-1",
        eventType: "STRATEGY_EVALUATION_REJECTED",
        aggregateId: "assignment-1",
        reasonCode: "BREAKOUT_NOT_CONFIRMED",
        occurredAt: new Date("2026-10-13T08:05:00.000Z"),
        metadataJson: {
          symbol: "BTCUSDT",
          outcome: "NO_CANDIDATE",
          checks: [
            { checkId: "TREND_1H", passed: true, reasonCode: "TREND_FILTER_1H_PASSED", actual: null, limit: null },
            { checkId: "BREAKOUT_PRIOR_HIGH", passed: false, reasonCode: "BREAKOUT_NOT_CONFIRMED", actual: "100.5", limit: "101.2" }
          ]
        }
      },
      {
        id: "evt-2",
        eventType: "STRATEGY_CANDIDATE_CREATED",
        aggregateId: "candidate-9",
        reasonCode: "CANDIDATE_CREATED",
        occurredAt: new Date("2026-10-13T07:05:00.000Z"),
        metadataJson: { symbol: "BTCUSDT", checks: [{ checkId: "X", passed: true, reasonCode: "OK", actual: null, limit: null }] }
      }
    ];
    let seenWhere: unknown = null;
    const db = {
      tradingAuditEvent: {
        findMany: async (args: { where: unknown; take: number; skip: number }) => {
          seenWhere = args.where;
          return events.slice(args.skip, args.skip + args.take);
        }
      }
    };
    setTradingReadsDatabaseForTests(db as never);
    const server = Fastify({ logger: false });
    await server.register(registerTradingReadRoutes);

    const response = await server.inject({ method: "GET", url: "/trading/strategy-evaluations?limit=10" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as Array<Record<string, unknown>>;
    assert.deepEqual(seenWhere, {
      eventType: { in: ["STRATEGY_EVALUATION_REJECTED", "STRATEGY_CANDIDATE_CREATED"] }
    });
    assert.equal(body[0].outcome, "NO_CANDIDATE");
    assert.equal(body[0].checksPassed, 1);
    assert.equal(body[0].checksTotal, 2);
    assert.deepEqual(body[0].failedChecks, [
      { checkId: "BREAKOUT_PRIOR_HIGH", reasonCode: "BREAKOUT_NOT_CONFIRMED", actual: "100.5", limit: "101.2" }
    ]);
    assert.equal(body[1].outcome, "CANDIDATE");
    assert.equal(body[1].tradeCandidateId, "candidate-9");

    const invalid = await server.inject({ method: "GET", url: "/trading/strategy-evaluations?limit=0" });
    assert.equal(invalid.statusCode, 400);
    await server.close();
  });
});
