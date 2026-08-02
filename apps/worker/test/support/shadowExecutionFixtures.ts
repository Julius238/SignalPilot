/**
 * Minimal in-memory Prisma double for the P4 execution/monitor/reconcile
 * integration tests.
 *
 * This is deliberately generic rather than hand-rolled per model: it
 * implements the small slice of the Prisma Client API the P4 lib modules
 * actually call (`findUnique`, `findFirst`, `findMany`, `create`, `update`,
 * `updateMany`, `count`, `aggregate`, `upsert`, `$transaction`) against plain
 * in-memory arrays, keyed by model name. `$transaction` runs its callback
 * against the same store — there is no real rollback — which is an accepted
 * simplification for these tests; the underlying financial arithmetic is
 * exhaustively covered by `packages/trading-simulation` and
 * `packages/portfolio`'s own unit tests.
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (where === undefined) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    const value = row[key];
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ("in" in cond && !(cond.in as unknown[]).includes(value)) return false;
      if ("notIn" in cond && (cond.notIn as unknown[]).includes(value)) return false;
      if ("not" in cond) {
        const notVal = cond.not;
        if (notVal === null ? value === null : value === notVal) return false;
      }
      if ("lte" in cond && !(compare(value, cond.lte) <= 0)) return false;
      if ("gte" in cond && !(compare(value, cond.gte) >= 0)) return false;
      if ("lt" in cond && !(compare(value, cond.lt) < 0)) return false;
      if ("gt" in cond && !(compare(value, cond.gt) > 0)) return false;
      if ("is" in cond && value !== cond.is) return false;
      if ("none" in cond) {
        // Only used for `shadowOrders: { none: {} }` in shadowCreateOrders.
        continue;
      }
      continue;
    }
    if (value instanceof Date && condition instanceof Date) {
      if (value.getTime() !== condition.getTime()) return false;
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/** `${sourceTable}.${includeKey}` -> the target table and the FK field on the source row. */
const RELATIONS: Record<string, { readonly table: string; readonly foreignKey: string }> = {
  "tradeCandidate.decision": { table: "tradeDecision", foreignKey: "tradeCandidateId" },
  "shadowOrder.tradeCandidate": { table: "tradeCandidate", foreignKey: "id" },
  "shadowOrder.portfolio": { table: "portfolio", foreignKey: "id" },
  "shadowOrder.tradingSession": { table: "tradingSession", foreignKey: "id" },
  "shadowPosition.portfolio": { table: "portfolio", foreignKey: "id" }
};

class Table {
  readonly rows: Row[] = [];
  constructor(readonly name: string, readonly allTables: () => Map<string, Table>) {}

  private applyIncludes(row: Row | null, include: Record<string, unknown> | undefined): Row | null {
    if (row === null || include === undefined) return row;
    const result = { ...row };
    for (const key of Object.keys(include)) {
      const relation = RELATIONS[`${this.name}.${key}`];
      if (relation === undefined) continue;
      const target = this.allTables().get(relation.table);
      if (target === undefined) continue;
      // Self-referencing FK ("id") means the *target* row points back at
      // `row.<relation table>Id`; a foreign-key-on-target relation
      // ("tradeCandidateId") means the target points at this row's id.
      if (relation.foreignKey === "id") {
        const fkFieldOnRow = `${relation.table}Id`;
        const fkValue = row[fkFieldOnRow];
        result[key] = fkValue === undefined || fkValue === null ? null : target.rows.find((r) => r.id === fkValue) ?? null;
      } else {
        result[key] = target.rows.find((r) => r[relation.foreignKey] === row.id) ?? null;
      }
    }
    return result;
  }

  findUnique(args: { where: Record<string, unknown>; include?: Record<string, unknown>; select?: unknown }): Row | null {
    const row = this.rows.find((candidate) => matchesWhere(candidate, args.where)) ?? null;
    return this.applyIncludes(row, args.include);
  }

  findFirst(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
    include?: Record<string, unknown>;
    select?: unknown;
  }): Row | null {
    const matches = this.rows.filter((row) => matchesWhere(row, args.where));
    const sorted = sortRows(matches, args.orderBy);
    return this.applyIncludes(sorted[0] ?? null, args.include);
  }

  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
    take?: number;
    include?: Record<string, unknown>;
    select?: unknown;
  } = {}): Row[] {
    const matches = this.rows.filter((row) => matchesWhere(row, args.where));
    const sorted = sortRows(matches, args.orderBy);
    const limited = args.take === undefined ? sorted : sorted.slice(0, args.take);
    return limited.map((row) => this.applyIncludes(row, args.include)!);
  }

  count(args: { where?: Record<string, unknown> } = {}): number {
    return this.rows.filter((row) => matchesWhere(row, args.where)).length;
  }

  aggregate(args: { where?: Record<string, unknown>; _sum: Record<string, boolean> }): {
    _sum: Record<string, string | null>;
  } {
    const matches = this.rows.filter((row) => matchesWhere(row, args.where));
    const sums: Record<string, string | null> = {};
    for (const field of Object.keys(args._sum)) {
      let total = 0;
      let any = false;
      for (const row of matches) {
        const value = row[field];
        if (value === undefined || value === null) continue;
        any = true;
        total += Number.parseFloat(String(value));
      }
      sums[field] = any ? total.toFixed(12) : null;
    }
    return { _sum: sums };
  }

  create(args: { data: Row; select?: unknown }): Row {
    const row: Row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), version: 0, ...args.data };
    this.rows.push(row);
    return row;
  }

  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Row {
    const row = this.rows.find((candidate) => matchesWhere(candidate, args.where));
    if (row === undefined) throw new Error(`${this.name}.update: no row matches ${JSON.stringify(args.where)}`);
    applyData(row, args.data);
    return row;
  }

  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): { count: number } {
    const matches = this.rows.filter((row) => matchesWhere(row, args.where));
    for (const row of matches) applyData(row, args.data);
    return { count: matches.length };
  }

  upsert(args: { where: Record<string, unknown>; update: Record<string, unknown>; create: Row }): Row {
    const existing = this.rows.find((row) => matchesWhere(row, args.where));
    if (existing !== undefined) {
      applyData(existing, args.update);
      return existing;
    }
    return this.create({ data: args.create });
  }
}

function applyData(row: Row, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && "increment" in (value as Record<string, unknown>)) {
      row[key] = (Number(row[key] ?? 0) + Number((value as { increment: number }).increment));
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

function sortRows(rows: Row[], orderBy: Record<string, "asc" | "desc"> | undefined): Row[] {
  if (orderBy === undefined) return rows;
  const [field, direction] = Object.entries(orderBy)[0] ?? [];
  if (field === undefined) return rows;
  const sorted = [...rows].sort((a, b) => compare(a[field], b[field]));
  return direction === "desc" ? sorted.reverse() : sorted;
}

const MODEL_NAMES = [
  "portfolio",
  "tradingSession",
  "tradeCandidate",
  "tradeDecision",
  "riskAssessment",
  "riskLimitSet",
  "riskEvent",
  "strategyAssignment",
  "shadowOrder",
  "shadowFill",
  "shadowPosition",
  "shadowPositionEvent",
  "exitPlan",
  "portfolioLedgerEntry",
  "portfolioSnapshot",
  "instrumentExecutionProfile",
  "candle",
  "tradingAuditEvent",
  "botRun",
  "botLog"
] as const;

export function createFakeExecutionDatabase() {
  const tables = new Map<string, Table>();
  for (const name of MODEL_NAMES) tables.set(name, new Table(name, () => tables));

  const db: Record<string, unknown> = {};
  for (const name of MODEL_NAMES) {
    const table = tables.get(name)!;
    db[name] = {
      findUnique: (args: never) => Promise.resolve(table.findUnique(args)),
      findFirst: (args: never) => Promise.resolve(table.findFirst(args)),
      findMany: (args: never) => Promise.resolve(table.findMany(args)),
      count: (args: never) => Promise.resolve(table.count(args)),
      aggregate: (args: never) => Promise.resolve(table.aggregate(args)),
      create: (args: never) => Promise.resolve(table.create(args)),
      update: (args: never) => Promise.resolve(table.update(args)),
      updateMany: (args: never) => Promise.resolve(table.updateMany(args)),
      upsert: (args: never) => Promise.resolve(table.upsert(args))
    };
  }
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { database: db, tables };
}
