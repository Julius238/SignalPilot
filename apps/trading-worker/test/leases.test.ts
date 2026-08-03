/**
 * Lease concurrency tests against a real PostgreSQL instance.
 *
 * These exercise the one property an in-memory fake cannot prove: that two
 * genuinely concurrent callers racing to acquire the same lease can never
 * both win (docs P5: "Schutz muss prozessübergreifend in PostgreSQL
 * funktionieren; keine reine In-Memory-Sperre").
 *
 * Requires `DATABASE_URL` to point at a reachable PostgreSQL instance (the
 * same one the rest of the monorepo's dev/test setup uses). Every row this
 * file creates uses a `jobKey` unique to the test run and is deleted in a
 * top-level `after` hook.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@signalpilot/database";
import { config } from "dotenv";

const testDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(testDir, "../../../.env") });
config();

import {
  acquireLease,
  heartbeatLease,
  releaseLease,
  withJobLease,
  LeaseReasonCode
} from "../src/lib/leases.js";

const RUN_ID = randomUUID();
const jobKeysUsed: string[] = [];

function testJobKey(label: string): string {
  const key = `test:lease:${RUN_ID}:${label}`;
  jobKeysUsed.push(key);
  return key;
}

after(async () => {
  await prisma.tradingJobCursor.deleteMany({ where: { jobKey: { in: jobKeysUsed } } });
  await prisma.$disconnect();
});

describe("acquireLease — single caller", () => {
  it("acquires a fresh, unclaimed lease", async () => {
    const jobKey = testJobKey("fresh");
    const result = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      leaseDurationMs: 60_000,
      now: new Date()
    });
    assert.equal(result.acquired, true);
  });

  it("rejects a second acquire while the first lease is still valid", async () => {
    const jobKey = testJobKey("held");
    const now = new Date();
    const first = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      leaseDurationMs: 60_000,
      now
    });
    assert.equal(first.acquired, true);

    const second = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now
    });
    assert.equal(second.acquired, false);
    if (second.acquired) return;
    assert.equal(second.reasonCode, LeaseReasonCode.HELD_BY_OTHER);
    assert.equal(second.heldBy, "owner-a");
  });

  it("lets a different owner take over once the lease has expired", async () => {
    const jobKey = testJobKey("expired");
    const start = new Date("2026-01-01T00:00:00.000Z");
    const first = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      leaseDurationMs: 1_000,
      now: start
    });
    assert.equal(first.acquired, true);

    // No real sleep: the lease's own expiry is compared against the
    // caller-supplied `now`, so simulating "later" is enough.
    const later = new Date(start.getTime() + 5_000);
    const takeover = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now: later
    });
    assert.equal(takeover.acquired, true);
  });

  it("releases cleanly and lets anyone acquire next", async () => {
    const jobKey = testJobKey("release");
    const now = new Date();
    await acquireLease(prisma, { jobKey, scopeKey: "GLOBAL", ownerId: "owner-a", leaseDurationMs: 60_000, now });

    const released = await releaseLease(prisma, { jobKey, scopeKey: "GLOBAL", ownerId: "owner-a" });
    assert.equal(released.ok, true);

    const reacquired = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now
    });
    assert.equal(reacquired.acquired, true);
  });

  it("refuses to release a lease this owner does not hold", async () => {
    const jobKey = testJobKey("release-wrong-owner");
    const now = new Date();
    await acquireLease(prisma, { jobKey, scopeKey: "GLOBAL", ownerId: "owner-a", leaseDurationMs: 60_000, now });

    const released = await releaseLease(prisma, { jobKey, scopeKey: "GLOBAL", ownerId: "owner-b" });
    assert.equal(released.ok, false);

    // The original owner's lease must still be intact.
    const stillHeld = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-c",
      leaseDurationMs: 60_000,
      now
    });
    assert.equal(stillHeld.acquired, false);
  });
});

describe("heartbeatLease — extends only the caller's own current lease", () => {
  it("extends the lease when the owner and version match", async () => {
    const jobKey = testJobKey("heartbeat-ok");
    const now = new Date();
    const acquired = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      leaseDurationMs: 1_000,
      now
    });
    assert.equal(acquired.acquired, true);
    if (!acquired.acquired) return;

    const beat = await heartbeatLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      expectedVersion: acquired.version,
      leaseDurationMs: 60_000,
      now: new Date(now.getTime() + 500)
    });
    assert.equal(beat.ok, true);

    // The heartbeat's extension must actually have taken effect: a
    // competitor cannot take over even well past the original short lease.
    const stillBlocked = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now: new Date(now.getTime() + 2_000)
    });
    assert.equal(stillBlocked.acquired, false);
  });

  it("refuses to extend a lease that has already been taken over by someone else", async () => {
    const jobKey = testJobKey("heartbeat-lost");
    const start = new Date("2026-01-01T00:00:00.000Z");
    const acquired = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      leaseDurationMs: 1_000,
      now: start
    });
    assert.equal(acquired.acquired, true);
    if (!acquired.acquired) return;

    const later = new Date(start.getTime() + 5_000);
    const takeover = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now: later
    });
    assert.equal(takeover.acquired, true);

    // The original owner's stale heartbeat must not resurrect its lease.
    const staleHeartbeat = await heartbeatLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      expectedVersion: acquired.version,
      leaseDurationMs: 60_000,
      now: later
    });
    assert.equal(staleHeartbeat.ok, false);
    if (staleHeartbeat.ok) return;
    assert.equal(staleHeartbeat.reasonCode, LeaseReasonCode.LOST);
  });
});

describe("acquireLease — genuine concurrency", () => {
  it("exactly one of many truly parallel acquire attempts for the same job wins", async () => {
    const jobKey = testJobKey("race");
    const now = new Date();
    const attempts = Array.from({ length: 8 }, (_, index) =>
      acquireLease(prisma, {
        jobKey,
        scopeKey: "GLOBAL",
        ownerId: `owner-${index}`,
        leaseDurationMs: 60_000,
        now
      })
    );
    const results = await Promise.all(attempts);
    const winners = results.filter((result) => result.acquired);
    assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}`);
  });
});

describe("withJobLease — orchestration", () => {
  it("runs the callback and releases the lease afterwards", async () => {
    const jobKey = testJobKey("with-lease-success");
    const result = await withJobLease(
      prisma,
      { jobKey, ownerId: "owner-a", leaseDurationMs: 5_000, heartbeatIntervalMs: 500 },
      async () => "done"
    );
    assert.equal(result.ran, true);
    if (!result.ran) return;
    assert.equal(result.result, "done");

    const reacquired = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now: new Date()
    });
    assert.equal(reacquired.acquired, true, "lease must be released after a normal return");
  });

  it("still releases the lease when the callback throws", async () => {
    const jobKey = testJobKey("with-lease-throw");
    await assert.rejects(
      withJobLease(
        prisma,
        { jobKey, ownerId: "owner-a", leaseDurationMs: 5_000, heartbeatIntervalMs: 500 },
        async () => {
          throw new Error("boom");
        }
      )
    );

    const reacquired = await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-b",
      leaseDurationMs: 60_000,
      now: new Date()
    });
    assert.equal(reacquired.acquired, true, "lease must be released even after a thrown error");
  });

  it("refuses to run when the lease is already held", async () => {
    const jobKey = testJobKey("with-lease-busy");
    await acquireLease(prisma, {
      jobKey,
      scopeKey: "GLOBAL",
      ownerId: "owner-a",
      leaseDurationMs: 60_000,
      now: new Date()
    });

    let ranCallback = false;
    const result = await withJobLease(
      prisma,
      { jobKey, ownerId: "owner-b", leaseDurationMs: 5_000, heartbeatIntervalMs: 500 },
      async () => {
        ranCallback = true;
      }
    );
    assert.equal(result.ran, false);
    assert.equal(ranCallback, false);
  });
});
