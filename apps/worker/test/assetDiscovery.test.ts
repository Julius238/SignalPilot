import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  AssetDiscoveryAction,
  AssetUniverseRole,
  AssetUniverseSource,
  BotRunStatus
} from "@signalpilot/database";

import { reconcileActiveUniverse } from "../src/jobs/reconcileActiveUniverse.js";
import {
  discoveryRunKey,
  resolveAssetDiscoverySettings
} from "../src/lib/discoveryConfig.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("asset discovery settings", () => {
  it("starts disabled and in dry-run with conservative limits", () => {
    const settings = resolveAssetDiscoverySettings({});

    assert.equal(settings.enabled, false);
    assert.equal(settings.dryRun, true);
    assert.equal(settings.maxCandidates, 45);
    assert.equal(settings.policy.maxAdditionsPerRun, 3);
    assert.equal(settings.policy.maxRemovalsPerRun, 3);
    assert.equal(settings.policy.allowLeveragedEtfs, false);
    assert.equal(settings.policy.allowStablecoins, false);
  });

  it("bounds provider-facing candidate and candle limits", () => {
    const settings = resolveAssetDiscoverySettings({
      ASSET_DISCOVERY_MAX_CANDIDATES: "99999",
      ASSET_DISCOVERY_VERIFICATION_CANDLE_LIMIT: "99999",
      MARKET_DATA_REQUEST_DELAY_MS: "250"
    });

    assert.equal(settings.maxCandidates, 500);
    assert.equal(settings.verificationCandleLimit, 500);
    assert.equal(settings.requestDelayMs, 250);
  });

  it("resumes the same daily snapshot but keeps subsequent days historical", () => {
    const first = discoveryRunKey(
      "DISCOVERY_SCAN",
      new Date("2026-07-26T01:00:00.000Z"),
      {}
    );
    const resumed = discoveryRunKey(
      "DISCOVERY_SCAN",
      new Date("2026-07-26T20:00:00.000Z"),
      {}
    );
    const nextDay = discoveryRunKey(
      "DISCOVERY_SCAN",
      new Date("2026-07-27T01:00:00.000Z"),
      {}
    );

    assert.equal(first, resumed);
    assert.notEqual(first, nextDay);
  });
});

describe("active universe reconciliation", () => {
  it("changes no productive membership and starts no backfill in dry-run", async () => {
    process.env.ASSET_DISCOVERY_ENABLED = "true";
    process.env.ASSET_DISCOVERY_DRY_RUN = "true";
    process.env.ASSET_DISCOVERY_RUN_KEY = "dry-run-test";
    const state = createReconciliationDatabase({ active: false });
    let backfillCalls = 0;

    const summary = await reconcileActiveUniverse(
      state.database as never,
      new Date("2026-07-26T12:00:00.000Z"),
      (async () => {
        backfillCalls += 1;
        return createBackfillSummary();
      }) as never
    );

    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.activatedCount, 0);
    assert.equal(summary.deactivatedCount, 0);
    assert.equal(state.assetUpdateCount, 0);
    assert.equal(state.membershipCreateCount, 0);
    assert.equal(backfillCalls, 0);
    assert.equal("alert" in state.database, false);
  });

  it("backfills only a newly activated asset and is idempotent on repetition", async () => {
    process.env.ASSET_DISCOVERY_ENABLED = "true";
    process.env.ASSET_DISCOVERY_DRY_RUN = "false";
    process.env.ASSET_DISCOVERY_RUN_KEY = "activation-test";
    const state = createReconciliationDatabase({ active: false });
    const backfilledIds: string[][] = [];
    const runBackfill = (async (_database: unknown, options: { assetIds?: string[] }) => {
      backfilledIds.push(options.assetIds ?? []);
      return createBackfillSummary();
    }) as never;

    const first = await reconcileActiveUniverse(
      state.database as never,
      new Date("2026-07-26T12:00:00.000Z"),
      runBackfill
    );
    const second = await reconcileActiveUniverse(
      state.database as never,
      new Date("2026-07-26T12:05:00.000Z"),
      runBackfill
    );

    assert.equal(first.activatedCount, 1);
    assert.equal(first.backfillStarted, true);
    assert.deepEqual(backfilledIds, [["asset-new"]]);
    assert.equal(second.activatedCount, 0);
    assert.equal(second.backfillStarted, false);
    assert.equal(state.assetUpdateCount, 1);
    assert.equal(state.membershipCreateCount, 1);
  });

  it("keeps successful asset changes when another candidate fails", async () => {
    process.env.ASSET_DISCOVERY_ENABLED = "true";
    process.env.ASSET_DISCOVERY_DRY_RUN = "false";
    process.env.ASSET_DISCOVERY_RUN_KEY = "partial-failure-test";
    const state = createReconciliationDatabase({ active: false });
    const database = state.database as {
      assetDiscoveryRun: {
        findFirst: () => Promise<{
          id: string;
          candidates: Array<{
            assetId: string;
            proposedAction: AssetDiscoveryAction;
            asset: { symbol: string };
          }>;
        }>;
      };
      asset: {
        findUniqueOrThrow: (input: {
          where: { id: string };
        }) => Promise<unknown>;
      };
    };
    database.assetDiscoveryRun.findFirst = async () => ({
      id: "selection-run",
      candidates: [
        {
          assetId: "asset-broken",
          proposedAction: AssetDiscoveryAction.ADD,
          asset: { symbol: "BROKEN" }
        },
        {
          assetId: "asset-new",
          proposedAction: AssetDiscoveryAction.ADD,
          asset: { symbol: "NEW" }
        }
      ]
    });
    const originalFind = database.asset.findUniqueOrThrow;
    database.asset.findUniqueOrThrow = async (input) => {
      if (input.where.id === "asset-broken") throw new Error("simulated candidate failure");
      return originalFind(input);
    };
    const backfilledIds: string[][] = [];

    const summary = await reconcileActiveUniverse(
      state.database as never,
      new Date("2026-07-26T12:00:00.000Z"),
      (async (_database: unknown, options: { assetIds?: string[] }) => {
        backfilledIds.push(options.assetIds ?? []);
        return createBackfillSummary();
      }) as never
    );

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.activatedCount, 1);
    assert.deepEqual(backfilledIds, [["asset-new"]]);
    assert.equal(state.assetUpdateCount, 1);
  });
});

function createReconciliationDatabase({ active }: { active: boolean }) {
  let isActive = active;
  let membership = {
    id: "membership-discovery",
    role: active ? AssetUniverseRole.ACTIVE : AssetUniverseRole.DISCOVERY,
    source: active
      ? AssetUniverseSource.AUTO_DISCOVERED
      : AssetUniverseSource.AUTO_DISCOVERED
  };
  const state = {
    assetUpdateCount: 0,
    membershipCreateCount: 0,
    database: {} as Record<string, unknown>
  };
  const database = {
    assetDiscoveryRun: {
      findUnique: async () => null,
      upsert: async () => ({
        id: "reconciliation-run",
        status: BotRunStatus.RUNNING
      }),
      findFirst: async () => ({
        id: "selection-run",
        candidates: [
          {
            assetId: "asset-new",
            proposedAction: AssetDiscoveryAction.ADD,
            asset: { symbol: "NEW" }
          }
        ]
      }),
      update: async () => ({ id: "reconciliation-run" })
    },
    botRun: {
      create: async () => ({ id: "bot-run-reconciliation" }),
      update: async () => ({ id: "bot-run-reconciliation" })
    },
    botLog: {
      create: async () => ({ id: "log" })
    },
    asset: {
      findUniqueOrThrow: async () => ({
        id: "asset-new",
        isActive,
        universePreference: {
          isPinned: false,
          isExcluded: false,
          manualActive: false,
          observeOnly: false
        },
        universeMemberships: [membership]
      }),
      update: async () => {
        state.assetUpdateCount += 1;
        isActive = true;
        return { id: "asset-new", isActive: true };
      }
    },
    assetUniverseMembership: {
      update: async () => ({ ...membership, isCurrent: false }),
      create: async (operation: {
        data: {
          role: AssetUniverseRole;
          source: AssetUniverseSource;
        };
      }) => {
        state.membershipCreateCount += 1;
        membership = {
          id: "membership-active",
          role: operation.data.role,
          source: operation.data.source
        };
        return membership;
      }
    },
    $transaction: async (
      operation:
        | Array<Promise<unknown>>
        | ((client: typeof database) => Promise<unknown>)
    ) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      return operation(database);
    }
  };
  state.database = database;
  return state;
}

function createBackfillSummary() {
  return {
    status: BotRunStatus.SUCCESS,
    assetCount: 1,
    seriesCount: 3,
    completedSeriesCount: 3,
    resumedSeriesCount: 0,
    requestCount: 3,
    savedCandleCount: 100,
    skippedOpenCandleCount: 0,
    noDataCount: 0,
    rateLimitCount: 0,
    invalidApiKeyCount: 0,
    entitlementErrorCount: 0,
    unsupportedSymbolCount: 0,
    temporaryErrorCount: 0,
    providerErrorCount: 0
  };
}
