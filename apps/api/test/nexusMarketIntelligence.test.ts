import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

import {
  NEXUS_READ_REQUIRED_SCOPE,
  resolveNexusReadConfig
} from "../src/lib/nexusReadConfig.js";
import {
  registerNexusReadRoutes,
  setNexusReadDatabaseForTests
} from "../src/routes/integrations/nexusRead.js";

// The market read used to answer "what does Bitcoin cost" and nothing else.
// "Welche Coins waren auffällig?" was unanswerable for a structural reason
// rather than a hard one: the endpoint returned the alphabetically first eight
// active symbols and no change over any window, so whichever assets sorted
// last were invisible however far they had moved.
//
// These tests pin the two properties that fix carries: the ranking covers the
// whole active universe, and it never ranks an asset it has no current price
// for.

const SERVICE_TOKEN = "nexus-test-service-token-2f8c41d9a6b7";
const TOKEN_DIGEST = createHash("sha256").update(SERVICE_TOKEN, "utf8").digest("hex");

const HOUR = 3_600_000;
/** Anchored one minute back so the newest candle is unambiguously current. */
const LATEST_CLOSE = Date.now() - 60_000;

type Row = { assetId: string; closeTime: Date; close: number };

/**
 * Seven filler symbols, then a delisted one, then the two that sort last.
 * Under the old `take: 8` the response was AAA01..AAA07 plus DEADUSDT — the
 * dead pair was always in, and SOL and XRP were always out.
 */
const UNIVERSE = [
  "AAA01USDT",
  "AAA02USDT",
  "AAA03USDT",
  "AAA04USDT",
  "AAA05USDT",
  "AAA06USDT",
  "AAA07USDT",
  "DEADUSDT",
  "SOLUSDT",
  "XRPUSDT"
];

/** A flat 8-day hourly series, then a final close that moves it. */
function series(
  assetId: string,
  base: number,
  moves: Record<number, number>,
  anchor: number = LATEST_CLOSE
): Row[] {
  const rows: Row[] = [];
  for (let hoursAgo = 200; hoursAgo >= 0; hoursAgo -= 1) {
    let close = base;
    // `moves` maps a window length to the close that was in force *before* it,
    // so a 24h entry sets every candle older than 24 hours.
    for (const [hours, value] of Object.entries(moves)) {
      if (hoursAgo >= Number(hours)) close = value;
    }
    rows.push({ assetId, closeTime: new Date(anchor - hoursAgo * HOUR), close });
  }
  return rows;
}

type AgeOptions = { regimeAgeHours?: number; quoteAgeHours?: number };

function buildDatabase(options: AgeOptions = {}) {
  const anchor = LATEST_CLOSE - (options.quoteAgeHours ?? 0) * HOUR;
  const regimeAt = new Date(LATEST_CLOSE - (options.regimeAgeHours ?? 0) * HOUR);
  const assets = UNIVERSE.map((symbol) => ({ id: `id-${symbol}`, symbol }));

  const history: Row[] = [
    // +10% over 24h, +25% over 7d. Sorts ninth.
    ...series("id-SOLUSDT", 110, { 24: 100, 168: 88 }, anchor),
    // −5% over 24h. Sorts tenth.
    ...series("id-XRPUSDT", 0.95, { 24: 1.0 }, anchor),
    ...UNIVERSE.slice(0, 7).flatMap((symbol) => series(`id-${symbol}`, 10, {}, anchor))
    // DEADUSDT contributes no recent history at all.
  ];

  const newest = new Map<string, { close: number; closeTime: Date }>();
  for (const row of history) {
    const current = newest.get(row.assetId);
    if (current === undefined || row.closeTime > current.closeTime) {
      newest.set(row.assetId, { close: row.close, closeTime: row.closeTime });
    }
  }
  // The delisted pair keeps a two-year-old close for ever.
  newest.set("id-DEADUSDT", {
    close: 0.3794,
    closeTime: new Date("2024-09-10T02:59:59.999Z")
  });

  return {
    marketRegimeSnapshot: {
      findFirst: async () => ({
        generatedAt: regimeAt,
        equityRegime: "UNKNOWN",
        cryptoRegime: "RISK_ON",
        overallRegime: "NEUTRAL",
        riskMode: "NORMAL",
        confidence: 38.5,
        summary: "test",
        riskNote: "test"
      })
    },
    asset: {
      findMany: async (args: { take?: number }) => {
        assert.equal(args.take, undefined, "the market read must not slice its own universe");
        return assets;
      }
    },
    candle: {
      findFirst: async (args: { where: { assetId: string } }) =>
        newest.get(args.where.assetId) ?? null,
      findMany: async (args: { where: { openTime: { gte: Date } } }) =>
        history.filter((row) => row.closeTime >= args.where.openTime.gte)
    }
  };
}

async function readRaw(options: AgeOptions = {}) {
  setNexusReadDatabaseForTests(buildDatabase(options) as never);
  const server = Fastify({ logger: false });
  await server.register(rateLimit, { global: false });
  const resolved = resolveNexusReadConfig({
    NEXUS_READ_API_ENABLED: "true",
    NEXUS_READ_TOKEN_SHA256: TOKEN_DIGEST,
    NEXUS_READ_TOKEN_SCOPE: NEXUS_READ_REQUIRED_SCOPE
  });
  if (!resolved.ok) throw new Error(resolved.message);
  await server.register(
    async (scope) => registerNexusReadRoutes(scope, { config: resolved.config }),
    { prefix: "/integrations/nexus/v1" }
  );
  await server.ready();
  const response = await server.inject({
    method: "GET",
    url: "/integrations/nexus/v1/market",
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` }
  });
  await server.close();
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body) as {
    stale: boolean;
    sourceUpdatedAt: string | null;
    data: Data;
  };
}

const readMarket = async (): Promise<Data> => (await readRaw()).data;
const readMarketEnvelope = async (options: AgeOptions) => {
  const body = await readRaw(options);
  return { stale: body.stale, sourceUpdatedAt: body.sourceUpdatedAt };
};

type Mover = {
  window: string;
  direction: "up" | "down";
  symbol: string;
  changePercent: number;
};
type Data = {
  intelligence: {
    windows: { window: string; measuredSymbolCount: number }[];
    movers: Mover[];
    excluded: { symbol: string; reason: string }[];
    universeSize: number;
    rankedSymbolCount: number;
  };
  quotes: { symbol: string; stale: boolean }[];
  returned: number;
  freshQuoteCount: number;
  staleQuoteCount: number;
};

const windowOf = (data: Data, key: string) => {
  const found = data.intelligence.windows.find((entry) => entry.window === key);
  assert.ok(found, `window ${key} is reported`);
  const movers = data.intelligence.movers.filter((move) => move.window === key);
  return {
    measuredSymbolCount: found.measuredSymbolCount,
    gainers: movers.filter((move) => move.direction === "up"),
    losers: movers.filter((move) => move.direction === "down")
  };
};

describe("Nexus read API — crypto market intelligence", () => {
  it("covers the whole active universe rather than an alphabetical prefix", async () => {
    const data = await readMarket();
    assert.equal(data.intelligence.universeSize, 10);
    assert.equal(data.returned, 10);
    // Nine have a current price; the delisted pair does not.
    assert.equal(data.intelligence.rankedSymbolCount, 9);
  });

  it("ranks assets that the old eight-symbol prefix could never reach", async () => {
    const data = await readMarket();
    const day = windowOf(data, "24h");
    assert.equal(day.gainers[0]?.symbol, "SOLUSDT");
    assert.equal(day.gainers[0]?.changePercent, 10);
    assert.equal(day.losers[0]?.symbol, "XRPUSDT");
    assert.equal(day.losers[0]?.changePercent, -5);
  });

  it("computes each window against its own reference close", async () => {
    const data = await readMarket();
    assert.equal(windowOf(data, "24h").gainers[0]?.changePercent, 10);
    assert.equal(windowOf(data, "7d").gainers[0]?.changePercent, 25);
    // 72h sits between the two moves, so it still reads the 24h reference.
    assert.equal(windowOf(data, "72h").gainers[0]?.symbol, "SOLUSDT");
  });

  it("never ranks an asset whose newest close is years old", async () => {
    const data = await readMarket();
    const excluded = data.intelligence.excluded as { symbol: string; reason: string }[];
    assert.deepEqual(
      excluded.map((entry) => entry.symbol),
      ["DEADUSDT"]
    );
    assert.equal(excluded[0]?.reason, "no_current_candle");
    for (const key of ["24h", "72h", "7d"]) {
      const window = windowOf(data, key);
      const named = [...window.gainers, ...window.losers].map((move) => move.symbol);
      assert.ok(!named.includes("DEADUSDT"), `DEADUSDT is not ranked in ${key}`);
    }
  });

  it("still reports the delisted pair as a quote, flagged stale", async () => {
    const data = await readMarket();
    const dead = (data.quotes as { symbol: string; stale: boolean }[]).find(
      (quote) => quote.symbol === "DEADUSDT"
    );
    assert.equal(dead?.stale, true);
    assert.equal(data.staleQuoteCount, 1);
    assert.equal(data.freshQuoteCount, 9);
  });

  it("bounds each movers list", async () => {
    const data = await readMarket();
    for (const key of ["24h", "72h", "7d"]) {
      const window = windowOf(data, key);
      assert.ok(window.gainers.length <= 3);
      assert.ok(window.losers.length <= 3);
    }
  });

  it("keeps every mover field within Nexus' six-level redaction depth", async () => {
    // response -> data -> intelligence -> movers -> [i] -> field is five
    // levels. Grouping them under their window added two more and Nexus
    // replaced every symbol with "[max depth]" on the first live read.
    const data = await readMarket();
    const depthOf = (value: unknown, depth = 0): number =>
      value === null || typeof value !== "object"
        ? depth
        : Math.max(
            depth,
            ...Object.values(value as Record<string, unknown>).map((child) =>
              depthOf(child, depth + 1)
            )
          );
    // +1 for the envelope `data` key this fixture does not include.
    assert.ok(depthOf(data.intelligence) + 2 <= 6, "movers stay inside the redaction depth");
  });

  it("dates the reading by its freshest component, not by the regime alone", async () => {
    // The regime job does not run hourly. Tying the envelope to it announced
    // minutes-old prices as stale, and the first live briefing opened by
    // calling entirely current 24h moves outdated.
    const data = await readMarketEnvelope({ regimeAgeHours: 6 });
    assert.equal(data.stale, false);
    assert.equal(data.sourceUpdatedAt, new Date(LATEST_CLOSE).toISOString());
  });

  it("is stale when the prices themselves are old", async () => {
    const data = await readMarketEnvelope({ regimeAgeHours: 6, quoteAgeHours: 9 });
    assert.equal(data.stale, true);
  });

  it("counts only the symbols a window could actually be computed for", async () => {
    const data = await readMarket();
    // The nine live symbols; the delisted one contributes no history.
    assert.equal(windowOf(data, "24h").measuredSymbolCount, 9);
  });
});
