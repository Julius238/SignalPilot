/**
 * Restart and downtime check (docs/trading/18-vps-24-7-shadow-runbook.md).
 *
 *   node dist/jobs/opsConsistency.js snapshot > before.json
 *   … stop / start the data and trading workers …
 *   node dist/jobs/opsConsistency.js compare --before=before.json   (or --before=- < before.json)
 *
 * A snapshot captures, per shadow portfolio, the ledger (sequence, entry count,
 * cash caches), orders, fills and positions, the session and kill switch, and
 * per arena participant the evaluation count and chain; plus every missing 1h
 * candle of the traded symbols since the oldest forward start. `compare`
 * verifies that a restart lost nothing, duplicated nothing, left the ledger
 * consistent, kept champion and challenger apart, preserved sessions and kill
 * switches, kept the arena history intact and that the data worker refilled
 * every candle gap. Read-only.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";

import { verifyArenaEvaluationChain } from "../lib/arena.js";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

const HOUR_MS = 3_600_000;
const SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

export interface PortfolioSnapshot {
  readonly portfolioKey: string;
  readonly status: string;
  readonly ledgerSequence: number;
  readonly ledgerEntries: number;
  /** Σ ledger cash deltas — must equal the cash caches (available + reserved). */
  readonly ledgerCash: string;
  readonly cacheCash: string;
  readonly equity: string;
  readonly orders: Readonly<Record<string, number>>;
  readonly fills: number;
  /** (order, candle) pairs that produced more than one fill — must be 0. */
  readonly duplicateFillCandles: number;
  readonly positions: Readonly<Record<string, number>>;
  readonly session: { readonly id: string; readonly status: string; readonly killSwitchEngaged: boolean; readonly version: number } | null;
  readonly enabledStrategyVersions: readonly string[];
}

export interface ConsistencySnapshot {
  readonly takenAt: string;
  readonly portfolios: readonly PortfolioSnapshot[];
  readonly arena: readonly { readonly participantKey: string; readonly evaluations: number; readonly chainOk: boolean; readonly status: string }[];
  readonly candleGaps: Readonly<Record<string, readonly string[]>>;
}

async function candleGaps(database: PrismaClient, from: Date, to: Date): Promise<Record<string, string[]>> {
  const gaps: Record<string, string[]> = {};
  // Only hours whose candle must already be closed and fetched.
  const lastClosedOpen = Math.floor((to.getTime() - HOUR_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
  const firstOpen = Math.ceil(from.getTime() / HOUR_MS) * HOUR_MS;
  for (const symbol of SYMBOLS) {
    const candles = await database.candle.findMany({
      where: { symbol, timeframe: "1h", source: "BINANCE", openTime: { gte: new Date(firstOpen), lte: new Date(lastClosedOpen) } },
      select: { openTime: true }
    });
    const present = new Set(candles.map((candle) => candle.openTime.getTime()));
    const missing: string[] = [];
    for (let open = firstOpen; open <= lastClosedOpen; open += HOUR_MS) {
      if (!present.has(open)) missing.push(new Date(open).toISOString());
    }
    gaps[symbol] = missing;
  }
  return gaps;
}

export async function takeConsistencySnapshot(database: PrismaClient, asOf: Date): Promise<ConsistencySnapshot> {
  const portfolios = await database.portfolio.findMany({
    where: { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" }
  });
  const snapshots: PortfolioSnapshot[] = [];
  for (const portfolio of portfolios) {
    const [ledger, orders, fills, duplicateFills, positions, session, assignments] = await Promise.all([
      database.portfolioLedgerEntry.aggregate({
        where: { portfolioId: portfolio.id },
        _count: { _all: true },
        _sum: { availableCashDelta: true, reservedCashDelta: true }
      }),
      database.shadowOrder.groupBy({ by: ["status"], where: { portfolioId: portfolio.id }, _count: { _all: true } }),
      database.shadowFill.count({ where: { shadowOrder: { portfolioId: portfolio.id } } }),
      database.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM (
          SELECT f."shadowOrderId", f."sourceCandleId" FROM "ShadowFill" f
          JOIN "ShadowOrder" o ON o."id" = f."shadowOrderId"
          WHERE o."portfolioId" = ${portfolio.id}
          GROUP BY f."shadowOrderId", f."sourceCandleId" HAVING count(*) > 1
        ) duplicates`,
      database.shadowPosition.groupBy({ by: ["status"], where: { portfolioId: portfolio.id }, _count: { _all: true } }),
      database.tradingSession.findFirst({
        where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, killSwitchEngaged: true, version: true }
      }),
      database.strategyAssignment.findMany({
        where: { portfolioId: portfolio.id, enabled: true },
        select: { strategyVersionId: true }
      })
    ]);
    const ledgerCash = new Prisma.Decimal(ledger._sum.availableCashDelta ?? 0).plus(ledger._sum.reservedCashDelta ?? 0);
    snapshots.push({
      portfolioKey: portfolio.key,
      status: portfolio.status,
      ledgerSequence: portfolio.ledgerSequence,
      ledgerEntries: ledger._count._all,
      ledgerCash: ledgerCash.toFixed(12),
      cacheCash: portfolio.availableCash.plus(portfolio.reservedCash).toFixed(12),
      equity: portfolio.equity.toFixed(12),
      orders: Object.fromEntries(orders.map((row) => [row.status, row._count._all])),
      fills,
      duplicateFillCandles: Number(duplicateFills[0]?.count ?? 0),
      positions: Object.fromEntries(positions.map((row) => [row.status, row._count._all])),
      session,
      enabledStrategyVersions: [...new Set(assignments.map((entry) => entry.strategyVersionId))].sort()
    });
  }

  const participants = await database.arenaParticipant.findMany({ orderBy: { createdAt: "asc" } });
  const arena = [];
  for (const participant of participants) {
    const chain = await verifyArenaEvaluationChain(database, participant.id);
    arena.push({ participantKey: participant.participantKey, evaluations: chain.checked, chainOk: chain.ok, status: participant.status });
  }
  const oldestStart = participants
    .map((participant) => participant.forwardStartAt)
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  return {
    takenAt: asOf.toISOString(),
    portfolios: snapshots,
    arena,
    candleGaps: await candleGaps(database, oldestStart ?? new Date(asOf.getTime() - 48 * HOUR_MS), asOf)
  };
}

export interface ConsistencyVerdict {
  readonly ok: boolean;
  readonly checks: readonly { readonly check: string; readonly ok: boolean; readonly detail: string }[];
}

/** What a restart must preserve, comparing a snapshot before with one after. */
export function compareConsistency(before: ConsistencySnapshot, after: ConsistencySnapshot): ConsistencyVerdict {
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });

  for (const previous of before.portfolios) {
    const current = after.portfolios.find((entry) => entry.portfolioKey === previous.portfolioKey);
    if (current === undefined) {
      add(`${previous.portfolioKey}: vorhanden`, false, "Portfolio fehlt nach dem Neustart.");
      continue;
    }
    const key = previous.portfolioKey;
    add(`${key}: Ledger nur fortgeschrieben`, current.ledgerSequence >= previous.ledgerSequence && current.ledgerEntries >= previous.ledgerEntries,
      `Sequenz ${previous.ledgerSequence} → ${current.ledgerSequence}, Einträge ${previous.ledgerEntries} → ${current.ledgerEntries}`);
    add(`${key}: Ledger = Cash-Cache`, current.ledgerCash === current.cacheCash, `Ledger ${current.ledgerCash}, Cache ${current.cacheCash}`);
    add(`${key}: keine doppelt verarbeitete Kerze`, current.duplicateFillCandles === 0, `${current.duplicateFillCandles} (Order, Kerze)-Paare mit mehr als einem Fill`);
    add(`${key}: Fills nur hinzugekommen`, current.fills >= previous.fills, `${previous.fills} → ${current.fills}`);
    const sessionKept =
      (previous.session === null && current.session === null) ||
      (previous.session !== null &&
        current.session !== null &&
        previous.session.id === current.session.id &&
        previous.session.status === current.session.status &&
        previous.session.killSwitchEngaged === current.session.killSwitchEngaged);
    add(`${key}: Session und Kill Switch erhalten`, sessionKept,
      `${previous.session?.status ?? "—"}/${previous.session?.killSwitchEngaged ?? "—"} → ${current.session?.status ?? "—"}/${current.session?.killSwitchEngaged ?? "—"}`);
    add(`${key}: dieselbe Strategieversion`, JSON.stringify(previous.enabledStrategyVersions) === JSON.stringify(current.enabledStrategyVersions),
      current.enabledStrategyVersions.join(", ") || "keine aktivierte Zuweisung");
  }

  // Champion and challenger stay apart: no strategy version trades in two portfolios.
  const owners = new Map<string, string[]>();
  for (const portfolio of after.portfolios) {
    for (const version of portfolio.enabledStrategyVersions) owners.set(version, [...(owners.get(version) ?? []), portfolio.portfolioKey]);
  }
  const shared = [...owners.entries()].filter(([, keys]) => keys.length > 1);
  add("Teilnehmer getrennt", shared.length === 0, shared.length === 0 ? "jede Strategieversion in genau einem Portfolio" : JSON.stringify(shared));

  for (const previous of before.arena) {
    const current = after.arena.find((entry) => entry.participantKey === previous.participantKey);
    add(`Arena ${previous.participantKey}: Historie intakt`,
      current !== undefined && current.chainOk && current.evaluations >= previous.evaluations && current.status === previous.status,
      `${previous.evaluations} → ${current?.evaluations ?? "—"} Bewertungen, Kette ${current?.chainOk ? "gültig" : "GEBROCHEN"}, Status ${current?.status ?? "—"}`);
  }

  for (const [symbol, missing] of Object.entries(after.candleGaps)) {
    add(`${symbol}: keine Kerzenlücke`, missing.length === 0, missing.length === 0 ? "lückenlos" : `fehlend: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}`);
  }
  return { ok: checks.every((entry) => entry.ok), checks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [mode = "snapshot", ...rest] = process.argv.slice(2);
  const beforeFile = rest.find((arg) => arg.startsWith("--before="))?.slice("--before=".length);
  takeConsistencySnapshot(prisma, new Date())
    .then((snapshot) => {
      if (mode === "compare") {
        if (beforeFile === undefined) throw new Error("compare needs --before=<snapshot.json>");
        // "-" reads the snapshot from stdin (the file lives on the host, not in the container).
        const before = JSON.parse(readFileSync(beforeFile === "-" ? 0 : beforeFile, "utf8")) as ConsistencySnapshot;
        const verdict = compareConsistency(before, snapshot);
        process.stdout.write(`${JSON.stringify({ ...verdict, after: snapshot }, null, 2)}\n`);
        process.exitCode = verdict.ok ? 0 : 1;
        return;
      }
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`consistency check failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
