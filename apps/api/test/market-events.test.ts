import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify from "fastify";

import {
  UNASSIGNED_REGION_KEY,
  registerDashboardRoutes,
  setDashboardDatabaseForTests
} from "../src/routes/dashboard.js";

// Die Weltlage-Seite filtert Zeitraum und Region serverseitig. Ohne diese Parameter
// müsste das Dashboard immer alle Ereignisse laden und selbst aussieben.

describe("GET /market-events", () => {
  const originalApiAuthEnabled = process.env.API_AUTH_ENABLED;

  afterEach(() => {
    if (originalApiAuthEnabled === undefined) {
      delete process.env.API_AUTH_ENABLED;
      return;
    }
    process.env.API_AUTH_ENABLED = originalApiAuthEnabled;
  });

  it("translates maxAgeHours into a detectedAt lower bound", async () => {
    const { server, calls } = await createServer();

    const response = await server.inject({
      method: "GET",
      url: "/market-events?maxAgeHours=48"
    });

    assert.equal(response.statusCode, 200);
    const where = calls.at(-1)?.where as { detectedAt?: { gte: Date } };
    assert.ok(where.detectedAt?.gte instanceof Date);
    const hours = (Date.now() - where.detectedAt.gte.getTime()) / 3_600_000;
    assert.ok(Math.abs(hours - 48) < 0.1, `Fenster war ${hours} Stunden`);
  });

  it("does not restrict the time window when maxAgeHours is absent", async () => {
    const { server, calls } = await createServer();

    await server.inject({ method: "GET", url: "/market-events" });

    const where = calls.at(-1)?.where as { detectedAt?: unknown };
    assert.equal(where.detectedAt, undefined);
  });

  it("selects events without a region for the unassigned sentinel", async () => {
    const { server, calls } = await createServer();

    await server.inject({
      method: "GET",
      url: `/market-events?region=${encodeURIComponent(UNASSIGNED_REGION_KEY)}`
    });

    const where = calls.at(-1)?.where as { region?: unknown };
    // Nur `null` trifft Zeilen ohne Region — ein leerer String täte das nicht.
    assert.equal(where.region, null);
  });

  it("still filters by a concrete region name", async () => {
    const { server, calls } = await createServer();

    await server.inject({ method: "GET", url: "/market-events?region=Naher%20Osten" });

    const where = calls.at(-1)?.where as { region?: unknown };
    assert.equal(where.region, "Naher Osten");
  });

  it("rejects a non-numeric maxAgeHours instead of silently ignoring it", async () => {
    const { server } = await createServer();

    const response = await server.inject({
      method: "GET",
      url: "/market-events?maxAgeHours=viele"
    });

    assert.equal(response.statusCode, 400);
  });

  it("returns the fields the detail view needs", async () => {
    const { server } = await createServer();

    const response = await server.inject({ method: "GET", url: "/market-events" });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    for (const field of [
      "title",
      "summary",
      "region",
      "source",
      "sourceUrl",
      "severity",
      "confidence",
      "eventType",
      "affectedAssetClasses",
      "positiveImpact",
      "negativeImpact",
      "detectedAt"
    ]) {
      assert.ok(field in body[0], `${field} fehlt in der Antwort`);
    }
  });
});

async function createServer() {
  process.env.API_AUTH_ENABLED = "false";

  const calls: Array<Record<string, unknown>> = [];
  const server = Fastify({ logger: false });

  setDashboardDatabaseForTests({
    marketEvent: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args);
        return [
          {
            id: "event-1",
            eventType: "CONFLICT",
            severity: "WATCH",
            confidence: 0.45,
            title: "Oil supply disrupted",
            summary: null,
            region: "Naher Osten",
            source: "Reuters",
            sourceUrl: "https://example.invalid/story",
            affectedAssetClasses: ["Rohstoffe"],
            affectedSectors: [],
            affectedSymbols: [],
            positiveImpact: ["Gold"],
            negativeImpact: ["Aktien"],
            reasoning: "Keyword-basierte Einordnung als CONFLICT: oil.",
            publishedAt: new Date("2026-08-06T10:00:00.000Z"),
            detectedAt: new Date("2026-08-06T10:00:00.000Z"),
            alertSentAt: null
          }
        ];
      }
    }
  } as never);

  await registerDashboardRoutes(server);

  return { server, calls };
}
