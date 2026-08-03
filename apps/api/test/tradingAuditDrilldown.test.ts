import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getAuditDrilldown,
  isDrilldownAggregateType,
  sanitiseState
} from "../src/services/trading/auditDrilldownService.js";
import { createFakeTradingDatabase } from "./support/tradingFixtures.js";

const OCCURRED_AT = new Date("2026-08-10T12:00:00.000Z");

describe("sanitiseState", () => {
  it("redacts every key that could carry a secret, at any depth", () => {
    const output = sanitiseState({
      portfolioId: "pf-1",
      AUTH_SESSION_SECRET: "s3cret",
      accessToken: "t0ken",
      adminPassword: "pw",
      n8nWebhookUrl: "https://hooks.example/x",
      DATABASE_URL: "postgres://user:pw@host/db",
      csrfToken: "c",
      nested: { authorization: "Bearer x", assetId: "btc" }
    }) as Record<string, unknown>;

    assert.equal(output.portfolioId, "pf-1");
    for (const key of [
      "AUTH_SESSION_SECRET",
      "accessToken",
      "adminPassword",
      "n8nWebhookUrl",
      "DATABASE_URL",
      "csrfToken"
    ]) {
      assert.equal(output[key], "[redacted]", `${key} must be redacted`);
    }
    const nested = output.nested as Record<string, unknown>;
    assert.equal(nested.assetId, "btc");
    assert.equal(nested.authorization, "[redacted]");
  });

  it("marks a withheld field rather than silently dropping it", () => {
    const output = sanitiseState({ apiKey: "k" }) as Record<string, unknown>;
    assert.ok("apiKey" in output, "a reviewer must see that something was withheld");
    assert.equal(output.apiKey, "[redacted]");
  });

  it("bounds depth, string length and array size", () => {
    const output = sanitiseState({
      long: "x".repeat(5_000),
      many: Array.from({ length: 500 }, (_value, index) => index),
      deep: { a: { b: { c: { d: { e: { f: { g: "way too deep" } } } } } } }
    }) as Record<string, unknown>;

    assert.ok(String(output.long).length <= 2_001);
    assert.equal((output.many as unknown[]).length, 50);
    const deep = output.deep as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    assert.equal(deep.a.b.c.d.e, "[truncated]");
  });

  it("serialises dates and never returns a function", () => {
    const output = sanitiseState({ at: OCCURRED_AT, fn: () => "x" }) as Record<string, unknown>;
    assert.equal(output.at, OCCURRED_AT.toISOString());
    assert.equal(output.fn, null);
  });
});

describe("isDrilldownAggregateType", () => {
  it("accepts only the documented entry points", () => {
    assert.equal(isDrilldownAggregateType("ShadowPosition"), true);
    assert.equal(isDrilldownAggregateType("TradeCandidate"), true);
    assert.equal(isDrilldownAggregateType("Portfolio"), false);
    assert.equal(isDrilldownAggregateType("DROP TABLE"), false);
  });
});

/** One candidate → assessment → decision → order → position chain. */
function seedChain() {
  const { database, tables } = createFakeTradingDatabase();

  const asset = tables.get("asset")!.create({ data: { symbol: "BTCUSDT", assetType: "CRYPTO" } });
  const portfolio = tables.get("portfolio")!.create({ data: { key: "pf", name: "pf", status: "ACTIVE" } });
  const session = tables.get("tradingSession")!.create({
    data: { sessionKey: "s1", portfolioId: portfolio.id, status: "SHADOW_ACTIVE", mode: "SHADOW", version: 1 }
  });

  const candidate = tables.get("tradeCandidate")!.create({
    data: {
      candidateKey: "c1",
      portfolioId: portfolio.id,
      assetId: asset.id,
      direction: "LONG",
      status: "APPROVED_FOR_SHADOW",
      decisionTime: OCCURRED_AT,
      invalidReasonCode: null,
      cancelReasonCode: null,
      version: 3
    }
  });
  tables.get("riskAssessment")!.create({
    data: {
      assessmentKey: "ra1",
      tradeCandidateId: candidate.id,
      portfolioId: portfolio.id,
      status: "PASS",
      ruleSetVersion: "v1",
      assessedAt: OCCURRED_AT
    }
  });
  tables.get("tradeDecision")!.create({
    data: {
      decisionKey: "d1",
      tradeCandidateId: candidate.id,
      outcome: "APPROVE_SHADOW",
      reasonCode: "OK",
      decidedAt: OCCURRED_AT
    }
  });
  const order = tables.get("shadowOrder")!.create({
    data: {
      orderKey: "o1",
      tradeCandidateId: candidate.id,
      portfolioId: portfolio.id,
      assetId: asset.id,
      tradingSessionId: session.id,
      purpose: "ENTRY",
      status: "FILLED",
      createdAt: OCCURRED_AT,
      version: 2,
      rejectionReasonCode: null,
      cancelReasonCode: null,
      shadowPositionId: null
    }
  });
  const position = tables.get("shadowPosition")!.create({
    data: {
      positionKey: "p1",
      portfolioId: portfolio.id,
      assetId: asset.id,
      entryOrderId: order.id,
      status: "CLOSED",
      openedAt: OCCURRED_AT,
      version: 5
    }
  });

  tables.get("tradingAuditEvent")!.create({
    data: {
      eventKey: "ae-1",
      eventType: "TRADE_CANDIDATE_CREATED",
      aggregateType: "TradeCandidate",
      aggregateId: candidate.id,
      actorType: "SYSTEM",
      actorId: "job",
      reasonCode: "CREATED",
      correlationId: "corr-1",
      causationId: "corr-1",
      idempotencyKey: "idem-1",
      engineVersion: "strategy-v1",
      codeVersion: "abc",
      beforeState: null,
      afterState: { status: "CREATED", AUTH_SESSION_SECRET: "leak", nested: { apiKey: "leak" } },
      occurredAt: OCCURRED_AT
    }
  });
  tables.get("tradingAuditEvent")!.create({
    data: {
      eventKey: "ae-2",
      eventType: "SHADOW_POSITION_CLOSED",
      aggregateType: "ShadowPosition",
      aggregateId: position.id,
      actorType: "SYSTEM",
      actorId: "job",
      reasonCode: "TAKE_PROFIT",
      correlationId: "corr-2",
      causationId: "corr-1",
      idempotencyKey: "idem-2",
      beforeState: { status: "OPEN" },
      afterState: { status: "CLOSED" },
      occurredAt: new Date(OCCURRED_AT.getTime() + 60_000)
    }
  });

  return { database, tables, candidate, order, position, session };
}

describe("getAuditDrilldown", () => {
  it("resolves the whole chain from the position entry point", async () => {
    const { database, position, candidate, order } = seedChain();

    const drilldown = await getAuditDrilldown(database as never, {
      aggregateType: "ShadowPosition",
      aggregateId: position.id,
      limit: 100
    });

    assert.equal(drilldown.found, true);
    const types = drilldown.chain.map((node) => node.aggregateType);
    for (const expected of ["TradeCandidate", "RiskAssessment", "TradeDecision", "ShadowOrder", "ShadowPosition"]) {
      assert.ok(types.includes(expected), `chain must include ${expected}`);
    }
    assert.ok(drilldown.chain.some((node) => node.aggregateId === candidate.id));
    assert.ok(drilldown.chain.some((node) => node.aggregateId === order.id));
  });

  it("resolves the same chain from the candidate entry point", async () => {
    const { database, candidate, position } = seedChain();

    const drilldown = await getAuditDrilldown(database as never, {
      aggregateType: "TradeCandidate",
      aggregateId: candidate.id,
      limit: 100
    });

    assert.ok(drilldown.chain.some((node) => node.aggregateId === position.id));
    assert.ok(drilldown.chain.some((node) => node.aggregateType === "TradingSession"));
  });

  it("collects the audit events of every aggregate in the chain with versions and reason codes", async () => {
    const { database, position } = seedChain();

    const drilldown = await getAuditDrilldown(database as never, {
      aggregateType: "ShadowPosition",
      aggregateId: position.id,
      limit: 100
    });

    const eventTypes = drilldown.events.map((event) => event.eventType);
    assert.deepEqual(eventTypes, ["TRADE_CANDIDATE_CREATED", "SHADOW_POSITION_CLOSED"]);
    assert.deepEqual(drilldown.correlationIds.sort(), ["corr-1", "corr-2"]);
    assert.equal(drilldown.events[0].engineVersion, "strategy-v1");
    assert.equal(drilldown.events[0].codeVersion, "abc");
    assert.equal(drilldown.events[1].reasonCode, "TAKE_PROFIT");
  });

  it("removes sensitive fields from before/after state before they leave the server", async () => {
    const { database, position } = seedChain();

    const drilldown = await getAuditDrilldown(database as never, {
      aggregateType: "ShadowPosition",
      aggregateId: position.id,
      limit: 100
    });

    const created = drilldown.events.find((event) => event.eventType === "TRADE_CANDIDATE_CREATED");
    assert.ok(created);
    const after = created.afterState as Record<string, unknown>;
    assert.equal(after.status, "CREATED");
    assert.equal(after.AUTH_SESSION_SECRET, "[redacted]");
    assert.equal((after.nested as Record<string, unknown>).apiKey, "[redacted]");

    // And nothing in the serialised response carries the raw value.
    assert.ok(!JSON.stringify(drilldown).includes("leak"));
  });

  it("reports not found for an id with no chain and no audit trail", async () => {
    const { database } = seedChain();
    const drilldown = await getAuditDrilldown(database as never, {
      aggregateType: "ShadowPosition",
      aggregateId: "does-not-exist",
      limit: 100
    });
    assert.equal(drilldown.found, false);
  });

  it("flags truncation instead of silently dropping events", async () => {
    const { database, position } = seedChain();
    const drilldown = await getAuditDrilldown(database as never, {
      aggregateType: "ShadowPosition",
      aggregateId: position.id,
      limit: 1
    });

    assert.equal(drilldown.events.length, 1);
    assert.equal(drilldown.truncated, true);
  });

  it("never writes — the drilldown is read-only", async () => {
    const { database, tables, position } = seedChain();
    const before = new Map(
      [...tables.entries()].map(([name, table]) => [name, JSON.stringify(table.rows)] as const)
    );

    await getAuditDrilldown(database as never, {
      aggregateType: "ShadowPosition",
      aggregateId: position.id,
      limit: 100
    });

    for (const [name, snapshot] of before) {
      assert.equal(JSON.stringify(tables.get(name)!.rows), snapshot, `${name} was modified`);
    }
  });
});
