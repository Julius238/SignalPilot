import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CircuitBreakerScope,
  CircuitBreakerState,
  CircuitBreakerTripReason,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLDS,
  evaluateCircuitBreaker
} from "../src/lib/circuitBreaker.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const ASOF = new Date("2026-08-10T12:00:00.000Z");

function seed() {
  const { database, tables } = createFakeExecutionDatabase();
  const portfolio = tables.get("portfolio")!.create({ data: { key: "p", name: "p", status: "ACTIVE" } });
  return { database, tables, portfolio };
}

function botRun(tables: ReturnType<typeof createFakeExecutionDatabase>["tables"], overrides: Record<string, unknown>) {
  return tables.get("botRun")!.create({
    data: {
      jobName: "job-x",
      status: "SUCCESS",
      startedAt: ASOF,
      finishedAt: ASOF,
      ...overrides
    }
  });
}

describe("evaluateCircuitBreaker — closed by default", () => {
  it("is CLOSED when there is no run history at all", async () => {
    const { database, portfolio } = seed();
    const result = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: ASOF
    });
    assert.equal(result.state, CircuitBreakerState.CLOSED);
    assert.equal(result.allowed, true);
  });
});

describe("evaluateCircuitBreaker — consecutive job failures", () => {
  it("trips after the configured number of consecutive FAILED runs", async () => {
    const { database, tables, portfolio } = seed();
    for (let i = 0; i < 3; i += 1) {
      botRun(tables, { status: "FAILED", startedAt: new Date(ASOF.getTime() - i * 1000) });
    }
    const result = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: ASOF
    });
    assert.equal(result.state, CircuitBreakerState.OPEN);
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, CircuitBreakerTripReason.CONSECUTIVE_JOB_FAILURES);
  });

  it("does not trip when a success breaks the failure streak", async () => {
    const { database, tables, portfolio } = seed();
    botRun(tables, { status: "FAILED", startedAt: new Date(ASOF.getTime() - 3000) });
    botRun(tables, { status: "SUCCESS", startedAt: new Date(ASOF.getTime() - 2000) });
    botRun(tables, { status: "FAILED", startedAt: new Date(ASOF.getTime() - 1000) });
    const result = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: ASOF
    });
    assert.equal(result.state, CircuitBreakerState.CLOSED);
  });

  it("allows exactly one probe run once the cooldown has elapsed (half-open)", async () => {
    const { database, tables, portfolio } = seed();
    for (let i = 0; i < 3; i += 1) {
      botRun(tables, { status: "FAILED", startedAt: new Date(ASOF.getTime() - i * 1000), finishedAt: new Date(ASOF.getTime() - i * 1000) });
    }
    const stillOpen = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: new Date(ASOF.getTime() + 1000)
    });
    assert.equal(stillOpen.allowed, false);

    const afterCooldown = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: new Date(ASOF.getTime() + DEFAULT_CIRCUIT_BREAKER_THRESHOLDS.cooldownMs + 1000)
    });
    assert.equal(afterCooldown.state, CircuitBreakerState.HALF_OPEN);
    assert.equal(afterCooldown.allowed, true);
  });
});

describe("evaluateCircuitBreaker — unexpected job duration", () => {
  it("trips when a recent run exceeded the configured maximum duration", async () => {
    const { database, tables, portfolio } = seed();
    botRun(tables, {
      status: "SUCCESS",
      startedAt: new Date(ASOF.getTime() - 10 * 60 * 1000),
      finishedAt: ASOF
    });
    const result = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.MONITORING,
      asOf: ASOF
    });
    assert.equal(result.reasonCode, CircuitBreakerTripReason.UNEXPECTED_JOB_DURATION);
  });
});

describe("evaluateCircuitBreaker — portfolio/ledger and stale-data signals", () => {
  it("trips an ENTRY-scoped job on a single unacknowledged critical reconciliation finding", async () => {
    const { database, tables, portfolio } = seed();
    tables.get("riskEvent")!.create({
      data: {
        eventKey: "re-1",
        type: "RECONCILIATION_FINDING",
        severity: "CRITICAL",
        reasonCode: "PORTFOLIO_CACHE_MISMATCH_LEDGER_REPLAY",
        portfolioId: portfolio.id,
        payloadJson: {},
        inputHash: "h",
        acknowledgedAt: null,
        createdAt: ASOF
      }
    });

    const entryResult = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: ASOF
    });
    assert.equal(entryResult.allowed, false);
    assert.equal(entryResult.reasonCode, CircuitBreakerTripReason.PORTFOLIO_OR_LEDGER_DEVIATION);

    const monitoringResult = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.MONITORING,
      asOf: ASOF
    });
    assert.equal(
      monitoringResult.allowed,
      true,
      "monitoring/reconciliation jobs must keep running even when an entry-blocking finding exists"
    );
  });

  it("ignores an acknowledged critical finding", async () => {
    const { database, tables, portfolio } = seed();
    tables.get("riskEvent")!.create({
      data: {
        eventKey: "re-2",
        type: "DATA_STALE",
        severity: "CRITICAL",
        reasonCode: "DATA_STALE_CANDLES_1H",
        portfolioId: portfolio.id,
        payloadJson: {},
        inputHash: "h",
        acknowledgedAt: ASOF,
        createdAt: ASOF
      }
    });
    const result = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: ASOF
    });
    assert.equal(result.state, CircuitBreakerState.CLOSED);
  });

  it("ignores a critical finding for a different portfolio", async () => {
    const { database, tables, portfolio } = seed();
    tables.get("riskEvent")!.create({
      data: {
        eventKey: "re-3",
        type: "DATA_STALE",
        severity: "CRITICAL",
        reasonCode: "DATA_STALE_CANDLES_1H",
        portfolioId: "some-other-portfolio",
        payloadJson: {},
        inputHash: "h",
        acknowledgedAt: null,
        createdAt: ASOF
      }
    });
    const result = await evaluateCircuitBreaker(database as never, {
      jobKey: "job-x",
      portfolioId: portfolio.id,
      scope: CircuitBreakerScope.ENTRY,
      asOf: ASOF
    });
    assert.equal(result.state, CircuitBreakerState.CLOSED);
  });
});
