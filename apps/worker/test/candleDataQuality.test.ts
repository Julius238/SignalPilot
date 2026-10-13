import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordProviderOutcome } from "../src/lib/candleDataQuality.js";

type Row = Record<string, unknown>;

/** Applies Prisma-style `{ increment }` updates so counters behave like the database. */
function fakeDatabase() {
  const rows = new Map<string, Row>();
  const apply = (row: Row, data: Row) => {
    for (const [field, value] of Object.entries(data)) {
      if (value !== null && typeof value === "object" && "increment" in (value as Row)) {
        row[field] = Number(row[field] ?? 0) + Number((value as { increment: number }).increment);
      } else {
        row[field] = value;
      }
    }
  };
  return {
    rows,
    candleDataQuality: {
      upsert: async (args: { where: { assetId_provider_timeframe: Row }; create: Row; update: Row }) => {
        const key = JSON.stringify(args.where.assetId_provider_timeframe);
        const existing = rows.get(key);
        if (existing === undefined) rows.set(key, { ...args.create });
        else apply(existing, args.update);
        return rows.get(key);
      }
    }
  };
}

const KEY = { assetId: "asset-btc", provider: "BINANCE", timeframe: "1h" } as const;

describe("recordProviderOutcome", () => {
  it("counts errors since the last success and clears them on the next success", async () => {
    const database = fakeDatabase();
    await recordProviderOutcome(database as never, { ...KEY, kind: "TEMPORARY" });
    await recordProviderOutcome(database as never, { ...KEY, kind: "TEMPORARY" });
    await recordProviderOutcome(database as never, { ...KEY, kind: "RATE_LIMIT" });
    const [afterErrors] = [...database.rows.values()];
    assert.equal(afterErrors!.providerErrorCount, 2);
    assert.equal(afterErrors!.rateLimitCount, 1);
    assert.equal(afterErrors!.lastErrorKind, "RATE_LIMIT");

    await recordProviderOutcome(database as never, { ...KEY, kind: "SUCCESS" });
    const [afterSuccess] = [...database.rows.values()];
    assert.equal(afterSuccess!.providerErrorCount, 0);
    assert.equal(afterSuccess!.rateLimitCount, 0);
    assert.equal(afterSuccess!.entitlementErrorCount, 0);
    assert.equal(afterSuccess!.noDataCount, 0);
    assert.equal(afterSuccess!.lastErrorKind, null);
    assert.ok(afterSuccess!.lastSuccessfulFetchAt instanceof Date);
  });
});
