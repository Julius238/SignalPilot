import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DATA_QUALITY_AUDIT_WINDOW_CANDLES,
  recordProviderOutcome,
  refreshCandleDataQuality
} from "../src/lib/candleDataQuality.js";

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

const HOUR = 60 * 60 * 1000;

/** Closed hourly candles ending at `endMs`, with the hours in `missing` left out. */
function hourlyCandles(count: number, endMs: number, missing: ReadonlySet<number>) {
  const candles = [];
  for (let index = 0; index < count; index += 1) {
    if (missing.has(index)) continue;
    const openTime = new Date(endMs - (count - index) * HOUR);
    candles.push({ openTime, closeTime: new Date(openTime.getTime() + HOUR - 1) });
  }
  return candles;
}

function auditDatabase(candles: ReturnType<typeof hourlyCandles>) {
  const database = fakeDatabase();
  return Object.assign(database, { candle: { findMany: async () => candles } });
}

describe("refreshCandleDataQuality", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const total = 2_000;

  it("does not let a gap older than the audit window block the asset", async () => {
    // One missing hour far outside the newest 250 candles (an old exchange outage).
    const database = auditDatabase(hourlyCandles(total, now.getTime(), new Set([100])));
    await refreshCandleDataQuality(database as never, { ...KEY, marketKind: "CONTINUOUS", now });
    const [row] = [...database.rows.values()];
    assert.equal(row!.gapCount, 0);
    assert.equal(row!.missingCandleCount, 0);
    // Coverage and the full-history gap statistics stay visible for operations.
    assert.equal(row!.candleCount, total - 1);
    assert.equal(row!.expectedCandleCount, total);
    const metadata = row!.metadataJson as Record<string, unknown>;
    assert.equal(metadata.auditWindowCandles, DATA_QUALITY_AUDIT_WINDOW_CANDLES);
    assert.equal(metadata.lifetimeGapCount, 1);
    assert.equal(metadata.lifetimeMissingCandleCount, 1);
  });

  it("still reports a gap inside the window the indicators read", async () => {
    const database = auditDatabase(hourlyCandles(total, now.getTime(), new Set([total - 30, total - 29])));
    await refreshCandleDataQuality(database as never, { ...KEY, marketKind: "CONTINUOUS", now });
    const [row] = [...database.rows.values()];
    assert.equal(row!.gapCount, 1);
    assert.equal(row!.missingCandleCount, 2);
  });

  it("sees a gap right at the start of the window", async () => {
    // The hour just before the newest 250 candles is missing.
    const database = auditDatabase(
      hourlyCandles(total, now.getTime(), new Set([total - DATA_QUALITY_AUDIT_WINDOW_CANDLES - 1]))
    );
    await refreshCandleDataQuality(database as never, { ...KEY, marketKind: "CONTINUOUS", now });
    const [row] = [...database.rows.values()];
    assert.equal(row!.gapCount, 1);
  });
});
