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

/**
 * `${table}.${whereKey}` -> how to resolve a to-one relation filter such as
 * `where: { outbox: { status: "SENT" } }`. Only the relations a test actually
 * filters on are listed; anything else falls through to plain field matching.
 */
const RELATION_FILTERS: Record<
  string,
  { readonly table: string; readonly foreignKey: string }
> = {
  "tradingAlertOutboxAttempt.outbox": {
    table: "tradingAlertOutbox",
    foreignKey: "outboxId"
  }
};

let relationFilterTables: (() => Map<string, Table>) | null = null;

function matchesWhere(
  row: Row,
  where: Record<string, unknown> | undefined,
  tableName?: string
): boolean {
  if (where === undefined) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;

    // `OR: [...]` — any branch may match.
    if (key === "OR" && Array.isArray(condition)) {
      const branches = condition as Record<string, unknown>[];
      if (!branches.some((branch) => matchesWhere(row, branch, tableName)))
        return false;
      continue;
    }

    const relation =
      tableName === undefined
        ? undefined
        : RELATION_FILTERS[`${tableName}.${key}`];
    if (relation !== undefined && relationFilterTables !== null) {
      const target = relationFilterTables().get(relation.table);
      const parent = target?.rows.find(
        (candidate) => candidate.id === row[relation.foreignKey]
      );
      if (parent === undefined) return false;
      if (
        !matchesWhere(
          parent,
          condition as Record<string, unknown>,
          relation.table
        )
      )
        return false;
      continue;
    }

    const value = row[key];
    if (
      condition !== null &&
      typeof condition === "object" &&
      !(condition instanceof Date)
    ) {
      const cond = condition as Record<string, unknown>;
      if ("in" in cond && !(cond.in as unknown[]).includes(value)) return false;
      if ("notIn" in cond && (cond.notIn as unknown[]).includes(value))
        return false;
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
    // A real Postgres column omitted at `create()` reads back as NULL, not
    // `undefined` — normalise both to `null` so a `where: { field: null }`
    // matches a row this fake DB never explicitly set.
    const normalizedValue = value === undefined ? null : value;
    if (normalizedValue !== condition) return false;
  }
  return true;
}

const FILTER_OPERATOR_KEYS = new Set([
  "in",
  "notIn",
  "not",
  "lte",
  "gte",
  "lt",
  "gt",
  "is",
  "none"
]);

/**
 * Prisma's compound-unique `findUnique` syntax (`where: { jobKey_scopeKey: {
 * jobKey, scopeKey } }`) has no field on the row literally named
 * `jobKey_scopeKey` — flatten it into its constituent fields before matching.
 * Only triggers for a plain nested object that is not itself a filter
 * operator object, so an ordinary `{ status: { not: "ARCHIVED" } }` clause is
 * untouched.
 */
function flattenCompoundUniqueWhere(
  where: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !(value instanceof Date)
    ) {
      const innerKeys = Object.keys(value as Record<string, unknown>);
      const looksLikeOperator = innerKeys.some((innerKey) =>
        FILTER_OPERATOR_KEYS.has(innerKey)
      );
      if (!looksLikeOperator) {
        Object.assign(result, value);
        continue;
      }
    }
    result[key] = value;
  }
  return result;
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/**
 * `${sourceTable}.${includeKey}` -> how to resolve a relation.
 *
 * `foreignKey: "id"` means the source row carries `<table>Id` (or the explicit
 * `localKey`) pointing at the target — a to-one lookup. Any other value is the
 * column ON THE TARGET that points back at this row's id. `many: true` returns
 * the full list instead of the first match.
 */
const RELATIONS: Record<
  string,
  {
    readonly table: string;
    readonly foreignKey: string;
    readonly localKey?: string;
    readonly many?: boolean;
  }
> = {
  "tradeCandidate.decision": {
    table: "tradeDecision",
    foreignKey: "tradeCandidateId"
  },
  "tradeCandidate.riskAssessments": {
    table: "riskAssessment",
    foreignKey: "tradeCandidateId",
    many: true
  },
  "tradeCandidate.shadowOrders": {
    table: "shadowOrder",
    foreignKey: "tradeCandidateId",
    many: true
  },
  "tradeCandidate.strategyAssignment": {
    table: "strategyAssignment",
    foreignKey: "id"
  },
  "tradeCandidate.strategyVersion": {
    table: "strategyVersion",
    foreignKey: "id"
  },
  "strategyVersion.strategy": { table: "strategy", foreignKey: "id" },
  "shadowOrder.tradeCandidate": { table: "tradeCandidate", foreignKey: "id" },
  "shadowOrder.portfolio": { table: "portfolio", foreignKey: "id" },
  "shadowOrder.tradingSession": { table: "tradingSession", foreignKey: "id" },
  "shadowPosition.portfolio": { table: "portfolio", foreignKey: "id" },
  "shadowPosition.asset": { table: "asset", foreignKey: "id" },
  "shadowPosition.strategyAssignment": {
    table: "strategyAssignment",
    foreignKey: "id"
  },
  "shadowPosition.strategyVersion": {
    table: "strategyVersion",
    foreignKey: "id"
  },
  "shadowPosition.entryOrder": {
    table: "shadowOrder",
    foreignKey: "id",
    localKey: "entryOrderId"
  },
  "shadowPosition.fills": {
    table: "shadowFill",
    foreignKey: "shadowPositionId",
    many: true
  },
  "shadowPosition.events": {
    table: "shadowPositionEvent",
    foreignKey: "shadowPositionId",
    many: true
  },
  "shadowPosition.exitPlans": {
    table: "exitPlan",
    foreignKey: "shadowPositionId",
    many: true
  },
  "shadowFill.shadowOrder": {
    table: "shadowOrder",
    foreignKey: "id",
    localKey: "shadowOrderId"
  },
  "tradingAlertOutbox.attempts": {
    table: "tradingAlertOutboxAttempt",
    foreignKey: "outboxId",
    many: true
  },
  "strategyAssignment.asset": { table: "asset", foreignKey: "id" },
  "strategyAssignment.strategy": { table: "strategy", foreignKey: "id" },
  "strategyAssignment.strategyVersion": {
    table: "strategyVersion",
    foreignKey: "id"
  }
};

/** A nested `include`/`select` spec inside a relation entry, if there is one. */
function nestedSpec(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.include ?? record.select;
  return nested !== null && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : undefined;
}

/** Treat a `select` map as a relation spec; a non-object select is ignored. */
function asSpec(select: unknown): Record<string, unknown> | undefined {
  return select !== null && typeof select === "object" && !Array.isArray(select)
    ? (select as Record<string, unknown>)
    : undefined;
}

class Table {
  readonly rows: Row[] = [];
  constructor(
    readonly name: string,
    readonly allTables: () => Map<string, Table>
  ) {}

  /**
   * Prisma resolves relations named in `select` exactly like ones named in
   * `include`, so both are funnelled through here. Scalar keys in a `select`
   * are ignored: the fake always returns the whole row, which is a superset.
   */
  private applyIncludes(
    row: Row | null,
    include: Record<string, unknown> | undefined
  ): Row | null {
    if (row === null || include === undefined) return row;
    const result = { ...row };
    for (const [key, spec] of Object.entries(include)) {
      const relation = RELATIONS[`${this.name}.${key}`];
      if (relation === undefined) continue;
      const target = this.allTables().get(relation.table);
      if (target === undefined) {
        result[key] = relation.many === true ? [] : null;
        continue;
      }
      const sub = nestedSpec(spec);
      const orderBy = (spec as { orderBy?: Record<string, "asc" | "desc"> })
        ?.orderBy;
      const take = (spec as { take?: number })?.take;

      // A relation whose FK lives on THIS row ("id") is a to-one lookup; any
      // other foreignKey names the column on the TARGET pointing back here.
      if (relation.foreignKey === "id") {
        const fkFieldOnRow = relation.localKey ?? `${relation.table}Id`;
        const fkValue = row[fkFieldOnRow];
        const found =
          fkValue === undefined || fkValue === null
            ? null
            : (target.rows.find((r) => r.id === fkValue) ?? null);
        result[key] = target.applyIncludes(found, sub);
        continue;
      }

      const matches = target.rows.filter(
        (r) => r[relation.foreignKey] === row.id
      );
      if (relation.many === true) {
        const sorted = sortRows(matches, orderBy);
        const limited = take === undefined ? sorted : sorted.slice(0, take);
        result[key] = limited.map((match) => target.applyIncludes(match, sub));
      } else {
        result[key] = target.applyIncludes(matches[0] ?? null, sub);
      }
    }
    return result;
  }

  findUnique(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
    select?: unknown;
  }): Row | null {
    const where = flattenCompoundUniqueWhere(args.where);
    const row =
      this.rows.find((candidate) =>
        matchesWhere(candidate, where, this.name)
      ) ?? null;
    return this.applyIncludes(row, args.include ?? asSpec(args.select));
  }

  findFirst(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
    include?: Record<string, unknown>;
    select?: unknown;
  }): Row | null {
    const matches = this.rows.filter((row) =>
      matchesWhere(row, args.where, this.name)
    );
    const sorted = sortRows(matches, args.orderBy);
    return this.applyIncludes(
      sorted[0] ?? null,
      args.include ?? asSpec(args.select)
    );
  }

  findMany(
    args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
      take?: number;
      skip?: number;
      include?: Record<string, unknown>;
      select?: unknown;
    } = {}
  ): Row[] {
    const matches = this.rows.filter((row) =>
      matchesWhere(row, args.where, this.name)
    );
    const sorted = sortRows(matches, args.orderBy);
    const skipped = args.skip === undefined ? sorted : sorted.slice(args.skip);
    const limited =
      args.take === undefined ? skipped : skipped.slice(0, args.take);
    return limited.map(
      (row) => this.applyIncludes(row, args.include ?? asSpec(args.select))!
    );
  }

  count(args: { where?: Record<string, unknown> } = {}): number {
    return this.rows.filter((row) => matchesWhere(row, args.where, this.name))
      .length;
  }

  deleteMany(args: { where?: Record<string, unknown> } = {}): {
    count: number;
  } {
    const doomed = this.rows.filter((row) =>
      matchesWhere(row, args.where, this.name)
    );
    for (const row of doomed) {
      const index = this.rows.indexOf(row);
      if (index >= 0) this.rows.splice(index, 1);
    }
    return { count: doomed.length };
  }

  groupBy(args: {
    by: readonly string[];
    where?: Record<string, unknown>;
    _count?: unknown;
    _max?: Record<string, boolean>;
  }): Row[] {
    const matches = this.rows.filter((row) =>
      matchesWhere(row, args.where, this.name)
    );
    const groups = new Map<string, Row[]>();
    for (const row of matches) {
      const key = args.by.map((field) => String(row[field])).join("\u0000");
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    return [...groups.values()].map((bucket) => {
      const result: Row = {};
      for (const field of args.by) result[field] = bucket[0][field];
      if (args._count !== undefined) result._count = { _all: bucket.length };
      if (args._max !== undefined) {
        const maxima: Row = {};
        for (const field of Object.keys(args._max)) {
          let best: unknown = null;
          for (const row of bucket) {
            const value = row[field];
            if (value === undefined || value === null) continue;
            if (best === null || compare(value, best) > 0) best = value;
          }
          maxima[field] = best;
        }
        result._max = maxima;
      }
      return result;
    });
  }

  aggregate(args: {
    where?: Record<string, unknown>;
    _sum?: Record<string, boolean>;
    _min?: Record<string, boolean>;
    _max?: Record<string, boolean>;
  }): Record<string, Record<string, unknown>> {
    const matches = this.rows.filter((row) =>
      matchesWhere(row, args.where, this.name)
    );

    const extreme = (
      fields: Record<string, boolean> | undefined,
      keepGreater: boolean
    ) => {
      const output: Record<string, unknown> = {};
      for (const field of Object.keys(fields ?? {})) {
        let best: unknown = null;
        for (const row of matches) {
          const value = row[field];
          if (value === undefined || value === null) continue;
          if (
            best === null ||
            (keepGreater ? compare(value, best) > 0 : compare(value, best) < 0)
          )
            best = value;
        }
        output[field] = best;
      }
      return output;
    };

    const sums: Record<string, string | null> = {};
    for (const field of Object.keys(args._sum ?? {})) {
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
    return {
      _sum: sums,
      _min: extreme(args._min, false),
      _max: extreme(args._max, true)
    };
  }

  create(args: { data: Row; select?: unknown }): Row {
    const row: Row = {
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
      ...args.data
    };
    this.rows.push(row);
    return row;
  }

  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Row {
    const row = this.rows.find((candidate) =>
      matchesWhere(candidate, args.where)
    );
    if (row === undefined)
      throw new Error(
        `${this.name}.update: no row matches ${JSON.stringify(args.where)}`
      );
    applyData(row, args.data);
    return row;
  }

  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): { count: number } {
    const matches = this.rows.filter((row) =>
      matchesWhere(row, args.where, this.name)
    );
    for (const row of matches) applyData(row, args.data);
    return { count: matches.length };
  }

  upsert(args: {
    where: Record<string, unknown>;
    update: Record<string, unknown>;
    create: Row;
  }): Row {
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
    if (
      value !== null &&
      typeof value === "object" &&
      "increment" in (value as Record<string, unknown>)
    ) {
      row[key] =
        Number(row[key] ?? 0) +
        Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

function sortRows(
  rows: Row[],
  orderBy: Record<string, "asc" | "desc"> | undefined
): Row[] {
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
  "strategy",
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
  "candleDataQuality",
  "signal",
  "marketRegimeSnapshot",
  "tradingAuditEvent",
  "botRun",
  "botLog",
  "tradingJobCursor",
  // Work package 8
  "strategyPerformance",
  "strategyVersion",
  "tradingAlertOutbox",
  "tradingAlertOutboxAttempt",
  "alert",
  "asset"
] as const;

export function createFakeExecutionDatabase() {
  const tables = new Map<string, Table>();
  for (const name of MODEL_NAMES)
    tables.set(name, new Table(name, () => tables));
  relationFilterTables = () => tables;

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
      upsert: (args: never) => Promise.resolve(table.upsert(args)),
      deleteMany: (args: never) => Promise.resolve(table.deleteMany(args)),
      groupBy: (args: never) => Promise.resolve(table.groupBy(args))
    };
  }
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { database: db, tables };
}
