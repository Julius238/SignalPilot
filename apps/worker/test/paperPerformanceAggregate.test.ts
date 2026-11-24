/**
 * Paper performance aggregation against a real PostgreSQL instance.
 *
 * The signal rules read this report, so the database aggregate must equal the
 * former in-process calculation to the last bit: same sums (float addition
 * depends on the row order), same bucket order, same JSON text.
 *
 * Requires `DATABASE_URL` on a database whose name ends with `_test`; skipped
 * otherwise. Works in its own schema with a copy of the table definition, so
 * no shared table is written.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import {
  buildPerformanceBucketsFromAggregate,
  buildPerformanceReportFromAggregate,
  type PerformanceGroupBy
} from "@signalpilot/performance-intelligence";
import {
  buildPaperAggregateSql,
  loadPaperPerformanceAggregate,
  PAPER_AGGREGATE_SETTINGS_SQL,
  type PaperAggregateDatabase
} from "@signalpilot/performance-intelligence/paper-aggregate";

import * as legacy from "../../../packages/performance-intelligence/test/support/legacy-performance-report.js";
import { loadPerformanceReport } from "../src/lib/paperPerformance.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = /\/([^/?]+)(\?|$)/.exec(databaseUrl.replace(/^[a-z]+:\/\//, ""))?.[1] ?? "";
const skip = databaseName.endsWith("_test") ? false : "DATABASE_URL does not point to a *_test database";

const schema = `paper_agg_${randomUUID().replaceAll("-", "")}`;
const generatedAt = new Date("2026-11-24T00:00:00.000Z");
const groupBys: PerformanceGroupBy[] = [
  "signalType",
  "timeframe",
  "symbol",
  "status",
  "riskLevel",
  "evaluationKind",
  "scoreBucket"
];

let database: PrismaClient;
const text = (value: unknown) => JSON.stringify(value);
const aggregateDatabase = () => database as unknown as PaperAggregateDatabase;

// Values have at most 15 significant digits, like everything Prisma stores: the
// former path read them through Prisma, which keeps no more than 16.
const insertRows = (from: number, to: number) => `
INSERT INTO "${schema}"."PaperSignalEvaluation" (
  "id", "signalId", "assetId", "symbol", "timeframe", "direction", "status", "signalType", "score", "riskLevel",
  "entryPrice", "evaluationKind", "evaluationStatus", "skipReason", "openedAt", "returnAfter1h", "returnAfter4h",
  "returnAfter1d", "returnAfter3d", "maxFavorableMove", "maxAdverseMove", "outcome", "updatedAt")
SELECT 'e' || i, 's' || i, 'a' || i % 14, 'SYM' || i % 14, (ARRAY['1h','4h','1d'])[1 + i % 3],
  (enum_range(NULL::public."SignalDirection"))[1 + floor(random() * cardinality(enum_range(NULL::public."SignalDirection")))::int],
  (enum_range(NULL::public."SignalStatus"))[1 + floor(random() * cardinality(enum_range(NULL::public."SignalStatus")))::int],
  (enum_range(NULL::public."SignalType"))[1 + floor(random() * cardinality(enum_range(NULL::public."SignalType")))::int],
  (ARRAY[0, 49.999, 50, 64.999, 65, 79.999, 80, 100, round((random() * 100)::numeric, 3)]::float8[])[1 + floor(random() * 9)::int],
  (enum_range(NULL::public."RiskLevel"))[1 + floor(random() * cardinality(enum_range(NULL::public."RiskLevel")))::int],
  1,
  (enum_range(NULL::public."PaperEvaluationKind"))[1 + floor(random() * cardinality(enum_range(NULL::public."PaperEvaluationKind")))::int],
  (enum_range(NULL::public."PaperEvaluationStatus"))[1 + floor(random() * cardinality(enum_range(NULL::public."PaperEvaluationStatus")))::int],
  (ARRAY[NULL, 'Unspecified', 'no direction', 'low score'])[1 + floor(random() * 4)::int],
  timestamp '2026-01-01' + i * interval '1 minute',
  ${Array.from({ length: 6 }, () => "CASE WHEN random() < 0.1 THEN NULL WHEN random() < 0.02 THEN '-0'::float8 ELSE round(((random() - 0.5) * power(10, floor(random() * 14 - 7)))::numeric, 12)::float8 END").join(", ")},
  (enum_range(NULL::public."PaperEvaluationOutcome") || NULL::public."PaperEvaluationOutcome")[1 + floor(random() * (1 + cardinality(enum_range(NULL::public."PaperEvaluationOutcome"))))::int],
  now()
FROM generate_series(${from}, ${to}) i`;

async function legacyRows() {
  // Exactly the former query: no filter, no order, every column.
  return (await database.paperSignalEvaluation.findMany()) as unknown as Parameters<
    typeof legacy.buildPerformanceReport
  >[0];
}

describe("paper performance aggregate on PostgreSQL", { skip }, () => {
  before(async () => {
    const admin = prisma;
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${schema}"."PaperSignalEvaluation" (LIKE public."PaperSignalEvaluation" INCLUDING ALL)`
    );
    const url = new URL(databaseUrl);
    url.searchParams.set("schema", schema);
    url.searchParams.set("connection_limit", "1");
    const Client = prisma.constructor as new (options: unknown) => PrismaClient;
    database = new Client({ datasources: { db: { url: url.toString() } } });
    await database.$executeRawUnsafe("SELECT setseed(0.4242)");
  });

  after(async () => {
    await database?.$disconnect();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("returns an empty aggregate and no report for an empty table", async () => {
    const aggregate = await loadPaperPerformanceAggregate(aggregateDatabase());
    assert.equal(aggregate.overall.total, 0);
    assert.deepEqual(aggregate.skippedByReason, []);
    assert.equal(
      text(buildPerformanceReportFromAggregate(aggregate, { generatedAt })),
      text(legacy.buildPerformanceReport([], { generatedAt }))
    );
    assert.equal(await loadPerformanceReport(database), null);
  });

  it("equals the former calculation bit by bit on an irregular table", async () => {
    await database.$executeRawUnsafe(insertRows(1, 20_000));
    // Updates and deletes move rows and leave holes, like months of production.
    await database.$executeRawUnsafe(
      `UPDATE "PaperSignalEvaluation" SET "returnAfter1d" = round((random() - 0.5)::numeric, 12)::float8 WHERE random() < 0.3`
    );
    await database.$executeRawUnsafe(`DELETE FROM "PaperSignalEvaluation" WHERE random() < 0.1`);
    await database.$executeRawUnsafe(`VACUUM ANALYZE "PaperSignalEvaluation"`);
    await database.$executeRawUnsafe(insertRows(20_001, 30_000));
    await database.$executeRawUnsafe(`ANALYZE "PaperSignalEvaluation"`);

    const rows = await legacyRows();
    assert.ok(rows.length > 25_000);
    for (const includeSkipped of [true, false]) {
      const aggregate = await loadPaperPerformanceAggregate(aggregateDatabase(), { includeSkipped });
      const active = includeSkipped ? rows : rows.filter((row) => row.evaluationStatus !== "SKIPPED");
      for (const minEvaluated of [0, 30]) {
        assert.equal(
          text(buildPerformanceReportFromAggregate(aggregate, { generatedAt, minEvaluated })),
          text(legacy.buildPerformanceReport(rows, { generatedAt, minEvaluated, includeSkipped }))
        );
      }
      for (const groupBy of groupBys) {
        assert.equal(
          text(buildPerformanceBucketsFromAggregate(aggregate, groupBy, 47.25)),
          text(legacy.buildPerformanceBuckets(active, groupBy, 47.25))
        );
      }
    }

    const report = await loadPerformanceReport(database);
    assert.equal(
      text({ ...report, generatedAt: null }),
      text({ ...legacy.buildPerformanceReport(rows), generatedAt: null })
    );
  });

  it("applies symbol, timeframe and time filters like the former queries", async () => {
    const from = new Date("2026-01-03T00:00:00.000Z");
    const to = new Date("2026-01-12T12:34:00.000Z");
    const cases = [
      { filter: { symbol: "SYM3" }, where: { symbol: "SYM3" } },
      { filter: { timeframe: "4h" }, where: { timeframe: "4h" } },
      { filter: { from, to }, where: { openedAt: { gte: from, lte: to } } },
      {
        filter: { symbol: "SYM5", timeframe: "1h", from },
        where: { symbol: "SYM5", timeframe: "1h", openedAt: { gte: from } }
      }
    ];
    for (const { filter, where } of cases) {
      const rows = (await database.paperSignalEvaluation.findMany({ where })) as unknown as Awaited<
        ReturnType<typeof legacyRows>
      >;
      const report = buildPerformanceReportFromAggregate(
        await loadPaperPerformanceAggregate(aggregateDatabase(), filter),
        { generatedAt }
      );
      const expected = legacy.buildPerformanceReport(rows, { generatedAt });
      assert.equal(report.totalEvaluations, rows.length);
      assert.ok(rows.length > 0);
      assert.equal(report.overallWinRate, expected.overallWinRate);
      assert.deepEqual(report.skippedByReason, expected.skippedByReason);
      assert.deepEqual(
        report.bestSignalTypes.map((bucket) => [bucket.key, bucket.total, bucket.winRate]),
        expected.bestSignalTypes.map((bucket) => [bucket.key, bucket.total, bucket.winRate])
      );
    }
  });

  it("filters by asset type deterministically inside the scan", async () => {
    await database.$executeRawUnsafe(`CREATE TABLE "Asset" (LIKE public."Asset" INCLUDING DEFAULTS)`);
    await database.$executeRawUnsafe(`INSERT INTO "Asset" ("id", "symbol", "name", "exchange", "assetType", "updatedAt")
      SELECT 'a' || i, 'SYM' || i, 'SYM' || i, 'TEST',
        (CASE WHEN i % 2 = 0 THEN 'CRYPTO' ELSE 'STOCK' END)::public."AssetType", now()
      FROM generate_series(0, 13) i`);
    const rows = await legacyRows();
    const even = (row: unknown) => Number((row as { assetId: string }).assetId.slice(1)) % 2 === 0;
    for (const [assetType, expectedRows] of [
      ["CRYPTO", rows.filter(even)],
      ["STOCK", rows.filter((row) => !even(row))],
      ["ETF", []]
    ] as const) {
      const report = text(
        buildPerformanceReportFromAggregate(
          await loadPaperPerformanceAggregate(aggregateDatabase(), { assetType }),
          { generatedAt }
        )
      );
      // Same rows in table order: the sums are exact and repeatable.
      assert.equal(report, text(legacy.buildPerformanceReport([...expectedRows], { generatedAt })));
    }

    const { sql, values } = buildPaperAggregateSql({ assetType: "CRYPTO" });
    const [, plan] = (await database.$transaction([
      database.$queryRawUnsafe(PAPER_AGGREGATE_SETTINGS_SQL),
      database.$queryRawUnsafe(`EXPLAIN ${sql}`, ...values)
    ])) as [unknown, Array<{ "QUERY PLAN": string }>];
    assert.doesNotMatch(plan.map((row) => row["QUERY PLAN"]).join("\n"), /Join|Sort|Gather|Parallel|Nested Loop/);
  });

  it("reads the table once in row order and returns only aggregates", async () => {
    const { sql } = buildPaperAggregateSql({});
    const [, plan] = (await database.$transaction([
      database.$queryRawUnsafe(PAPER_AGGREGATE_SETTINGS_SQL),
      database.$queryRawUnsafe(`EXPLAIN ${sql}`)
    ])) as [unknown, Array<{ "QUERY PLAN": string }>];
    const lines = plan.map((row) => row["QUERY PLAN"]).join("\n");
    assert.match(lines, /^MixedAggregate/);
    assert.equal(lines.match(/Scan/g)?.length, 1);
    assert.match(lines, /Seq Scan on "PaperSignalEvaluation"/);
    assert.doesNotMatch(lines, /Sort|Gather|Parallel|Index|Bitmap/);

    const [, rows] = (await database.$transaction([
      database.$queryRawUnsafe(PAPER_AGGREGATE_SETTINGS_SQL),
      database.$queryRawUnsafe(sql)
    ])) as [unknown, unknown[]];
    assert.ok(rows.length < 100, `expected a few aggregate rows, got ${rows.length}`);
  });

  it("leaves the session's plan settings untouched", async () => {
    await loadPaperPerformanceAggregate(aggregateDatabase());
    const [settings] = (await database.$queryRawUnsafe(
      `SELECT current_setting('enable_sort') AS a, current_setting('enable_indexscan') AS b,
        current_setting('synchronize_seqscans') AS c`
    )) as [Record<string, string>];
    assert.deepEqual(settings, { a: "on", b: "on", c: "on" });
  });
});

describe("paper aggregate SQL", () => {
  it("binds every filter value and never writes one into the statement", () => {
    const hostile = `x'; DROP TABLE "Signal"; --`;
    const { sql, values } = buildPaperAggregateSql({
      symbol: hostile,
      timeframe: hostile,
      assetType: hostile,
      from: new Date(0),
      to: new Date(1),
      includeSkipped: false
    });
    assert.ok(!sql.includes("DROP"));
    assert.deepEqual(values, [hostile, hostile, new Date(0), new Date(1), hostile]);
    assert.match(sql.trim(), /^WITH/);
    assert.doesNotMatch(sql, /;/);
  });
});

describe("no unbounded paper evaluation load", () => {
  const files = ["apps/worker/src", "apps/api/src"].flatMap((folder) =>
    readdirSync(join(repoRoot, folder), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name))
  );

  it("never reads the evaluation table without a filter or limit", () => {
    assert.ok(files.length > 30);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/paperSignalEvaluation\??\.findMany\(/g)) {
        const call = source.slice(match.index, match.index + 260);
        assert.match(call, /\b(where|take):/, `${file}: unbounded paperSignalEvaluation.findMany`);
      }
    }
  });
});
