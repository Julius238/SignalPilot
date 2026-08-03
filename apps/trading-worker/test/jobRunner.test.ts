/**
 * `runScheduledJob` orchestration: circuit breaker, entry-workflow guard,
 * lease, and the last-resort uncaught-error `BotRun`.
 *
 * `withJobLease` itself (acquire/heartbeat/release/genuine concurrency) is
 * already exhaustively covered against real PostgreSQL in `leases.test.ts`;
 * this file only proves `runScheduledJob` wires the four layers together
 * correctly. The breaker-open and entry-guard-blocked cases never reach the
 * lease at all, so they run against the in-memory fake DB; the lease-held
 * and uncaught-error cases need `acquireLease`'s real atomic `UPDATE`, so
 * they run against the same PostgreSQL instance `leases.test.ts` uses, with
 * a run-unique `jobKey` cleaned up in `after`.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, prisma } from "@signalpilot/database";
import { config } from "dotenv";

const testDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(testDir, "../../../.env") });
config();

import { CircuitBreakerScope } from "../src/lib/circuitBreaker.js";
import { acquireLease } from "../src/lib/leases.js";
import { runScheduledJob, ScheduledJobSkipReason } from "../src/lib/jobRunner.js";
import { createFakeExecutionDatabase } from "./support/shadowExecutionFixtures.js";

const RUN_ID = randomUUID();
const jobKeysUsed: string[] = [];
function testJobKey(label: string): string {
  const key = `test:job-runner:${RUN_ID}:${label}`;
  jobKeysUsed.push(key);
  return key;
}

after(async () => {
  await prisma.tradingJobCursor.deleteMany({ where: { jobKey: { in: jobKeysUsed } } });
  await prisma.botRun.deleteMany({ where: { jobName: { in: jobKeysUsed } } });
  await prisma.$disconnect();
});

describe("runScheduledJob — circuit breaker (fake DB)", () => {
  it("skips without calling run() when the breaker is open", async () => {
    const { database } = createFakeExecutionDatabase();
    const jobKey = "job-runner-fake:breaker-open";
    const now = new Date("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < 3; i += 1) {
      await database.botRun.create({
        data: { jobName: jobKey, status: BotRunStatus.FAILED, startedAt: now, finishedAt: now }
      });
    }

    let ran = false;
    const result = await runScheduledJob({
      database: database as never,
      jobKey,
      ownerId: "owner-a",
      scope: CircuitBreakerScope.ENTRY,
      asOf: now,
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 5_000,
      checkEntryWorkflow: false,
      run: async () => {
        ran = true;
      }
    });

    assert.equal(result.ran, false);
    if (result.ran) return;
    assert.equal(result.reasonCode, ScheduledJobSkipReason.CIRCUIT_BREAKER_OPEN);
    assert.equal(ran, false);
  });
});

describe("runScheduledJob — entry workflow guard (fake DB)", () => {
  it("skips an entry-scope job when no portfolio exists yet", async () => {
    const { database } = createFakeExecutionDatabase();
    const jobKey = "job-runner-fake:entry-blocked";

    let ran = false;
    const result = await runScheduledJob({
      database: database as never,
      jobKey,
      ownerId: "owner-a",
      scope: CircuitBreakerScope.ENTRY,
      asOf: new Date(),
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 5_000,
      checkEntryWorkflow: true,
      run: async () => {
        ran = true;
      }
    });

    assert.equal(result.ran, false);
    if (result.ran) return;
    assert.equal(result.reasonCode, ScheduledJobSkipReason.ENTRY_WORKFLOW_BLOCKED);
    assert.equal(ran, false);
  });

  it("never consults the entry workflow guard for a MONITORING-scope job", async () => {
    const { database } = createFakeExecutionDatabase();
    const jobKey = "job-runner-fake:monitoring-not-guarded";

    let ran = false;
    const result = await runScheduledJob({
      database: database as never,
      jobKey,
      ownerId: "owner-a",
      scope: CircuitBreakerScope.MONITORING,
      asOf: new Date(),
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 5_000,
      checkEntryWorkflow: false,
      run: async () => {
        ran = true;
      }
    });

    assert.equal(result.ran, true);
    assert.equal(ran, true);
  });
});

describe("runScheduledJob — lease integration (real PostgreSQL)", () => {
  it("skips when another owner already holds the lease", async () => {
    const jobKey = testJobKey("lease-held");
    await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "someone-else",
      leaseDurationMs: 60_000,
      now: new Date()
    });

    let ran = false;
    const result = await runScheduledJob({
      database: prisma,
      jobKey,
      ownerId: "owner-a",
      scope: CircuitBreakerScope.MONITORING,
      asOf: new Date(),
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 5_000,
      checkEntryWorkflow: false,
      run: async () => {
        ran = true;
      }
    });

    assert.equal(result.ran, false);
    if (result.ran) return;
    assert.equal(result.reasonCode, ScheduledJobSkipReason.LEASE_HELD_BY_OTHER);
    assert.equal(ran, false);
  });

  it("runs the job and returns its result when nothing blocks it", async () => {
    const jobKey = testJobKey("lease-success");
    const result = await runScheduledJob({
      database: prisma,
      jobKey,
      ownerId: "owner-a",
      scope: CircuitBreakerScope.MONITORING,
      asOf: new Date(),
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 5_000,
      checkEntryWorkflow: false,
      run: async () => "summary"
    });

    assert.equal(result.ran, true);
    if (!result.ran) return;
    assert.equal(result.result, "summary");

    const cursor = await prisma.tradingJobCursor.findUnique({
      where: { jobKey_scopeKey: { jobKey, scopeKey: "GLOBAL" } }
    });
    assert.equal(cursor?.claimedBy, null, "lease must be released after a successful run");
  });

  it("records a FAILED BotRun with errorClass DATABASE_ERROR when run() throws past its own handling", async () => {
    const jobKey = testJobKey("uncaught-error");
    await assert.rejects(
      runScheduledJob({
        database: prisma,
        jobKey,
        ownerId: "owner-a",
        scope: CircuitBreakerScope.MONITORING,
        asOf: new Date(),
        leaseDurationMs: 60_000,
        heartbeatIntervalMs: 5_000,
        checkEntryWorkflow: false,
        run: async () => {
          throw new Error("simulated database failure");
        }
      })
    );

    const botRun = await prisma.botRun.findFirst({ where: { jobName: jobKey } });
    assert.ok(botRun !== null);
    assert.equal(botRun?.status, BotRunStatus.FAILED);
    assert.equal((botRun?.metadataJson as { errorClass?: string } | null)?.errorClass, "DATABASE_ERROR");

    const cursor = await prisma.tradingJobCursor.findUnique({
      where: { jobKey_scopeKey: { jobKey, scopeKey: "GLOBAL" } }
    });
    assert.equal(cursor?.claimedBy, null, "lease must still be released after a thrown error");
  });
});
