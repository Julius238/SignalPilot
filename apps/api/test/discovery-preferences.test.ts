import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AssetUniverseRole,
  AssetUniverseSource
} from "@signalpilot/database";

import { applyUniversePreference } from "../src/routes/dashboard.js";

describe("discovery universe preferences", () => {
  it("activates a user pin without changing alertEnabled", async () => {
    const state = createPreferenceDatabase();
    const result = await applyUniversePreference(
      state.database as never,
      assetInput({
        isActive: false,
        source: AssetUniverseSource.AUTO_DISCOVERED,
        role: AssetUniverseRole.DISCOVERY,
        alertEnabled: false
      }),
      {
        isPinned: true,
        isExcluded: false,
        manualActive: false,
        observeOnly: false
      }
    );

    assert.equal(result.isActive, true);
    assert.equal(result.membership?.source, AssetUniverseSource.PINNED);
    assert.equal(result.alertEnabled, false);
    assert.equal(state.watchlistWriteCount, 0);
  });

  it("clears a pin into discovery observation and preserves alerts", async () => {
    const state = createPreferenceDatabase();
    const result = await applyUniversePreference(
      state.database as never,
      assetInput({
        isActive: true,
        source: AssetUniverseSource.PINNED,
        role: AssetUniverseRole.ACTIVE,
        alertEnabled: true
      }),
      {
        isPinned: false,
        isExcluded: false,
        manualActive: false,
        observeOnly: false
      }
    );

    assert.equal(result.isActive, false);
    assert.equal(result.membership?.role, AssetUniverseRole.DISCOVERY);
    assert.equal(result.membership?.source, AssetUniverseSource.AUTO_DISCOVERED);
    assert.equal(result.alertEnabled, true);
    assert.equal(state.watchlistWriteCount, 0);
  });
});

function assetInput(input: {
  isActive: boolean;
  role: AssetUniverseRole;
  source: AssetUniverseSource;
  alertEnabled: boolean;
}) {
  return {
    id: "asset-1",
    isActive: input.isActive,
    universePreference: {
      id: "preference-1",
      isPinned: input.source === AssetUniverseSource.PINNED,
      isExcluded: false,
      manualActive: false,
      observeOnly: false
    },
    universeMemberships: [
      {
        id: "membership-1",
        role: input.role,
        source: input.source
      }
    ],
    watchlistItem: { alertEnabled: input.alertEnabled }
  };
}

function createPreferenceDatabase() {
  let watchlistWriteCount = 0;
  const transactionClient = {
    assetUniversePreference: {
      upsert: async ({ create, update }: { create: object; update: object }) => ({
        id: "preference-1",
        assetId: "asset-1",
        ...create,
        ...update
      })
    },
    assetUniverseMembership: {
      update: async () => ({ id: "membership-1" }),
      create: async ({
        data
      }: {
        data: {
          role: AssetUniverseRole;
          source: AssetUniverseSource;
        };
      }) => ({ id: "membership-2", ...data })
    },
    asset: {
      update: async () => ({ id: "asset-1" })
    }
  };
  return {
    get watchlistWriteCount() {
      return watchlistWriteCount;
    },
    database: {
      $transaction: async (
        operation: (client: typeof transactionClient) => Promise<unknown>
      ) => operation(transactionClient),
      watchlistItem: {
        update: async () => {
          watchlistWriteCount += 1;
        }
      }
    }
  };
}
