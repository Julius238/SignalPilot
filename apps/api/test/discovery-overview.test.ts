import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify from "fastify";
import {
  AssetDiscoveryAction,
  AssetDiscoveryRunKind,
  AssetType,
  AssetUniverseRole,
  AssetUniverseSource,
  BotRunStatus
} from "@signalpilot/database";

import {
  registerDashboardRoutes,
  setDashboardDatabaseForTests
} from "../src/routes/dashboard.js";

// Regression: `/discovery/overview` lud `asset.discoveryCandidates` nur, wenn ein
// erfolgreicher Discovery-Lauf existierte (`include: … : false`), griff danach aber
// unbedingt mit `[0]` darauf zu — HTTP 500 auf jeder frischen Datenbank.
// Der Datenbank-Fake unten bildet dieses Prisma-Verhalten bewusst exakt nach:
// bei `include === false` fehlt das Feld im Ergebnis komplett.

describe("GET /discovery/overview", () => {
  const originalApiAuthEnabled = process.env.API_AUTH_ENABLED;
  const originalDiscoveryEnabled = process.env.ASSET_DISCOVERY_ENABLED;

  afterEach(() => {
    restoreEnv("API_AUTH_ENABLED", originalApiAuthEnabled);
    restoreEnv("ASSET_DISCOVERY_ENABLED", originalDiscoveryEnabled);
  });

  it("answers 200 with a valid empty state when no discovery run exists", async () => {
    const server = await createServer({ runs: [] });

    const response = await server.inject({ method: "GET", url: "/discovery/overview" });

    assert.equal(response.statusCode, 200);
    const body = response.json();

    // Leerzustand ist explizit und typkonform — nicht "kein Ergebnis".
    assert.equal(body.latestRun, null);
    assert.deepEqual(body.candidates, []);
    assert.deepEqual(body.proposedAdditions, []);
    assert.deepEqual(body.proposedRemovals, []);
    assert.deepEqual(body.risers, []);
    assert.deepEqual(body.fallers, []);
    assert.equal(body.summary.candidateCount, 0);

    // Das aktive Universe existiert unabhängig vom Discovery-Lauf und wird ausgeliefert.
    assert.equal(body.activeAssets.length, 1);
    assert.equal(body.activeAssets[0].asset.symbol, "BTCUSDT");
    assert.equal(body.summary.activeCount, 1);

    // Ohne Lauf gibt es keinen Score — null, kein erfundener Ersatzwert.
    assert.equal(body.activeAssets[0].score, null);
    assert.equal(body.activeAssets[0].dataQuality, null);
  });

  it("answers 200 with candidate data when a discovery run exists", async () => {
    const server = await createServer({ runs: [createRun()] });

    const response = await server.inject({ method: "GET", url: "/discovery/overview" });

    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.notEqual(body.latestRun, null);
    assert.equal(body.candidates.length, 1);
    assert.equal(body.candidates[0].symbol, "BTCUSDT");
    assert.equal(body.summary.candidateCount, 1);
    assert.equal(body.proposedAdditions.length, 1);

    // Score und Datenqualität stammen jetzt aus dem Kandidaten des jüngsten Laufs.
    assert.equal(body.activeAssets.length, 1);
    assert.equal(body.activeAssets[0].score, 81.5);
    assert.equal(body.activeAssets[0].dataQuality, 92);
  });

  it("reports the feature flag independently of whether a run exists", async () => {
    process.env.ASSET_DISCOVERY_ENABLED = "false";
    const withoutRun = await createServer({ runs: [] });
    const disabledBody = (
      await withoutRun.inject({ method: "GET", url: "/discovery/overview" })
    ).json();

    // "deaktiviert" und "noch kein Lauf" sind zwei getrennte Aussagen.
    assert.equal(disabledBody.config.enabled, false);
    assert.equal(disabledBody.latestRun, null);

    process.env.ASSET_DISCOVERY_ENABLED = "true";
    const enabled = await createServer({ runs: [] });
    const enabledBody = (
      await enabled.inject({ method: "GET", url: "/discovery/overview" })
    ).json();

    assert.equal(enabledBody.config.enabled, true);
    assert.equal(enabledBody.latestRun, null);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

type Run = ReturnType<typeof createRun>;

async function createServer({ runs }: { runs: Run[] }) {
  process.env.API_AUTH_ENABLED = "false";

  const server = Fastify({ logger: false });
  setDashboardDatabaseForTests(createDatabase(runs) as never);
  await registerDashboardRoutes(server);

  return server;
}

function createDatabase(runs: Run[]) {
  return {
    assetDiscoveryRun: {
      findMany: async () => runs,
      findFirst: async () => null
    },
    assetUniverseMembership: {
      findMany: async (args: {
        include?: {
          asset?: { include?: { discoveryCandidates?: unknown } };
        };
        select?: unknown;
      }) => {
        // Zweiter Aufruf im Handler: Verweildauer-Statistik über ein `select`.
        if (args.select) {
          return [
            {
              activatedAt: new Date("2026-07-01T00:00:00.000Z"),
              deactivatedAt: null,
              validTo: null
            }
          ];
        }

        const includeCandidates = args.include?.asset?.include?.discoveryCandidates;
        const asset: Record<string, unknown> = {
          id: "asset-btc",
          symbol: "BTCUSDT",
          name: "Bitcoin / Tether USD",
          assetType: AssetType.CRYPTO,
          exchange: "BINANCE",
          sector: null,
          provider: "BINANCE",
          isActive: true,
          universePreference: null,
          watchlistItem: { alertEnabled: true }
        };

        // Genau wie Prisma: Bei `include: false` fehlt die Relation im Ergebnis.
        if (includeCandidates) {
          asset.discoveryCandidates = [createCandidate()];
        }

        return [
          {
            id: "membership-1",
            assetId: "asset-btc",
            role: AssetUniverseRole.ACTIVE,
            source: AssetUniverseSource.AUTO_DISCOVERED,
            reason: null,
            activatedAt: new Date("2026-07-01T00:00:00.000Z"),
            cooldownUntil: null,
            asset
          }
        ];
      }
    },
    paperSignalEvaluation: {
      findMany: async () => []
    }
  };
}

function createRun() {
  return {
    id: "run-1",
    kind: AssetDiscoveryRunKind.ACTIVE_SELECTION,
    status: BotRunStatus.SUCCESS,
    policyVersion: "discovery-v1.0.0",
    dryRun: true,
    scannedAssetCount: 120,
    excludedAssetCount: 40,
    candidateCount: 1,
    proposedAdditionCount: 1,
    proposedRemovalCount: 0,
    activatedCount: 0,
    deactivatedCount: 0,
    providerRequestCount: 12,
    estimatedApiUnits: 24,
    errorCount: 0,
    exclusionReasonsJson: {},
    metricsJson: { stabilityRate: 96 },
    startedAt: new Date("2026-08-06T02:30:00.000Z"),
    finishedAt: new Date("2026-08-06T02:31:00.000Z"),
    candidates: [createCandidate()]
  };
}

function createCandidate() {
  return {
    id: "candidate-1",
    discoveryRunId: "run-1",
    assetId: "asset-btc",
    rank: 1,
    score: 81.5,
    confidence: 70,
    dataQuality: 92,
    liquidity: 88,
    status: "SELECTED",
    proposedAction: AssetDiscoveryAction.ADD,
    reasons: ["STRONG_LIQUIDITY"],
    exclusionReasons: [],
    componentsJson: { liquidity: 88, tradingVolume: 74 },
    scoreSnapshot: {
      id: "snapshot-1",
      componentsJson: { liquidity: 88, tradingVolume: 74 }
    },
    asset: {
      id: "asset-btc",
      symbol: "BTCUSDT",
      name: "Bitcoin / Tether USD",
      assetType: AssetType.CRYPTO,
      exchange: "BINANCE",
      sector: null,
      provider: "BINANCE",
      isActive: true,
      universePreference: null,
      universeMemberships: [
        {
          id: "membership-1",
          role: AssetUniverseRole.ACTIVE,
          source: AssetUniverseSource.AUTO_DISCOVERED,
          isCurrent: true
        }
      ]
    }
  };
}
