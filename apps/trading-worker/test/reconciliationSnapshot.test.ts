/**
 * Reconciliation snapshot test against a real PostgreSQL instance (ADR 0025).
 *
 * The one property the in-memory fake can only emulate: every read of a
 * reconciliation comes from one REPEATABLE READ snapshot, so a writer that
 * commits between those reads cannot produce a mixed state and a false
 * finding. A second connection commits a consistent ledger booking right
 * after the reconciliation has read the portfolio row.
 *
 * Requires `DATABASE_URL` like the lease tests. Every row uses a key unique to
 * the run and is deleted in the `after` hook.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";

const testDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(testDir, "../../../.env") });
config();

import { reconcilePortfolio } from "../src/lib/shadowReconciliation.js";

const RUN_ID = randomUUID();
const portfolioIds: string[] = [];

after(async () => {
  await prisma.riskEvent.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
  await prisma.tradingAuditEvent.deleteMany({ where: { aggregateId: { in: portfolioIds } } });
  await prisma.portfolioLedgerEntry.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
  await prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
  await prisma.$disconnect();
});

async function seedPortfolio(label: string) {
  const portfolio = await prisma.portfolio.create({
    data: {
      key: `TEST_N3_${RUN_ID}_${label}`,
      name: "N3 snapshot test",
      status: "ACTIVE",
      startingCash: "10000",
      availableCash: "10000",
      reservedCash: "0",
      realizedPnl: "0",
      feesPaid: "0",
      equity: "10000",
      highWaterMark: "10000",
      ledgerSequence: 1
    }
  });
  portfolioIds.push(portfolio.id);
  await prisma.portfolioLedgerEntry.create({
    data: {
      entryKey: `test-n3|${portfolio.id}|initial-cash`,
      portfolioId: portfolio.id,
      sequence: 1,
      type: "INITIAL_CASH",
      availableCashDelta: "10000",
      balanceAfterJson: {},
      occurredAt: new Date("2026-08-01T00:00:00.000Z")
    }
  });
  return portfolio;
}

/** A consistent booking from another connection: ledger entry and cache in one transaction. */
async function commitPnlAdjustment(portfolioId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.portfolioLedgerEntry.create({
      data: {
        entryKey: `test-n3|${portfolioId}|adjustment`,
        portfolioId,
        sequence: 2,
        type: "PNL_ADJUSTMENT",
        availableCashDelta: "5",
        realizedPnlDelta: "5",
        balanceAfterJson: {},
        occurredAt: new Date("2026-08-02T00:00:00.000Z")
      }
    });
    await tx.portfolio.update({
      where: { id: portfolioId },
      data: {
        availableCash: "10005",
        realizedPnl: "5",
        equity: "10005",
        ledgerSequence: 2,
        version: { increment: 1 }
      }
    });
  });
}

/** The client the reconciliation gets: the other connection commits right after its first portfolio read. */
function clientCommittingAfterFirstRead(portfolioId: string): PrismaClient {
  let fired = false;
  return prisma.$extends({
    query: {
      portfolio: {
        async findUnique({ args, query }) {
          const row = await query(args);
          if (!fired && (args.where as { id?: string }).id === portfolioId) {
            fired = true;
            await commitPnlAdjustment(portfolioId);
          }
          return row;
        }
      }
    }
  }) as unknown as PrismaClient;
}

describe("reconciliation snapshot on PostgreSQL (ADR 0025)", () => {
  it("never mixes a booking committed between its reads: no finding, no lock, the next run is clean", async () => {
    const portfolio = await seedPortfolio("concurrent");
    const client = clientCommittingAfterFirstRead(portfolio.id);

    // The snapshot is consistent (sequence 1); the success write then sees the
    // newer version and discards the run instead of recording it.
    await assert.rejects(
      () =>
        reconcilePortfolio(client, {
          portfolioId: portfolio.id,
          asOf: new Date("2026-08-02T00:04:00.000Z"),
          codeVersion: "test",
          correlationId: `test-n3-${RUN_ID}-1`
        }),
      /version conflict during reconciliation/
    );
    const afterRace = await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } });
    assert.equal(afterRace.status, "ACTIVE");
    assert.equal(afterRace.ledgerSequence, 2, "the concurrent booking committed");
    assert.equal(afterRace.lastReconciledAt, null);
    assert.equal(await prisma.riskEvent.count({ where: { portfolioId: portfolio.id } }), 0);

    const next = await reconcilePortfolio(prisma, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T00:08:00.000Z"),
      codeVersion: "test",
      correlationId: `test-n3-${RUN_ID}-2`
    });
    assert.equal(next.consistent, true, next.violations.join(","));
  });

  it("still locks on a real deviation read from the snapshot", async () => {
    const portfolio = await seedPortfolio("deviation");
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { availableCash: "10001", equity: "10001" } });
    const result = await reconcilePortfolio(prisma, {
      portfolioId: portfolio.id,
      asOf: new Date("2026-08-02T00:04:00.000Z"),
      codeVersion: "test",
      correlationId: `test-n3-${RUN_ID}-3`
    });
    assert.equal(result.consistent, false);
    assert.ok(result.violations.includes("PORTFOLIO_CACHE_MISMATCH_LEDGER_REPLAY" as never));
    const locked = await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } });
    assert.equal(locked.status, "ERROR_LOCKED");
  });
});
