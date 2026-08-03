/**
 * Minimal in-memory Prisma double for the trading API's own tests — same
 * generic Table approach as `apps/trading-worker/test/support/shadowExecutionFixtures.ts`
 * (not shared across app boundaries, so duplicated here in miniature).
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

const FILTER_OPERATOR_KEYS = new Set(["in", "notIn", "not", "lte", "gte", "lt", "gt", "is"]);

function flattenCompoundUniqueWhere(where: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const innerKeys = Object.keys(value as Record<string, unknown>);
      const looksLikeOperator = innerKeys.some((innerKey) => FILTER_OPERATOR_KEYS.has(innerKey));
      if (!looksLikeOperator) {
        Object.assign(result, value);
        continue;
      }
    }
    result[key] = value;
  }
  return result;
}

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (where === undefined) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "OR" && Array.isArray(condition)) {
      const branches = condition as Record<string, unknown>[];
      if (!branches.some((branch) => matchesWhere(row, branch))) return false;
      continue;
    }
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
      continue;
    }
    if (value instanceof Date && condition instanceof Date) {
      if (value.getTime() !== condition.getTime()) return false;
      continue;
    }
    const normalizedValue = value === undefined ? null : value;
    if (normalizedValue !== condition) return false;
  }
  return true;
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/**
 * `foreignKey: "id"` means the source row carries `<table>Id` (or the explicit
 * `localKey`) pointing at the target. Any other value is the column ON THE
 * TARGET pointing back at this row's id; `many: true` returns the whole list.
 */
const RELATIONS: Record<
  string,
  { readonly table: string; readonly foreignKey: string; readonly localKey?: string; readonly many?: boolean }
> = {
  "tradeCandidate.asset": { table: "asset", foreignKey: "id" },
  "shadowOrder.asset": { table: "asset", foreignKey: "id" },
  "shadowFill.asset": { table: "asset", foreignKey: "id" },
  "shadowPosition.asset": { table: "asset", foreignKey: "id" },
  "riskAssessment.ruleResults": { table: "riskRuleResult", foreignKey: "riskAssessmentId", many: true },
  "riskAssessment.decision": { table: "tradeDecision", foreignKey: "riskAssessmentId" },
  "shadowPosition.events": { table: "shadowPositionEvent", foreignKey: "shadowPositionId", many: true },
  // P8 audit drilldown
  "tradeCandidate.decision": { table: "tradeDecision", foreignKey: "tradeCandidateId" },
  "tradeCandidate.riskAssessments": { table: "riskAssessment", foreignKey: "tradeCandidateId", many: true },
  "tradeCandidate.shadowOrders": { table: "shadowOrder", foreignKey: "tradeCandidateId", many: true },
  "shadowPosition.fills": { table: "shadowFill", foreignKey: "shadowPositionId", many: true },
  "shadowPosition.exitPlans": { table: "exitPlan", foreignKey: "shadowPositionId", many: true },
  "shadowPosition.entryOrder": { table: "shadowOrder", foreignKey: "id", localKey: "entryOrderId" },
  "shadowFill.shadowOrder": { table: "shadowOrder", foreignKey: "id", localKey: "shadowOrderId" },
  "tradingAlertOutbox.attempts": { table: "tradingAlertOutboxAttempt", foreignKey: "outboxId", many: true }
};

/** A nested `include`/`select` spec inside a relation entry, if there is one. */
function nestedSpec(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.include ?? record.select;
  return nested !== null && typeof nested === "object" ? (nested as Record<string, unknown>) : undefined;
}

/** Treat a `select` map as a relation spec; a non-object select is ignored. */
function asSpec(select: unknown): Record<string, unknown> | undefined {
  return select !== null && typeof select === "object" && !Array.isArray(select)
    ? (select as Record<string, unknown>)
    : undefined;
}

class Table {
  readonly rows: Row[] = [];
  constructor(readonly name: string, readonly allTables: () => Map<string, Table>) {}

  /**
   * Prisma resolves relations named in `select` exactly like ones named in
   * `include`, so both are funnelled through here. Scalar keys in a `select`
   * are ignored: the fake always returns the whole row, which is a superset.
   */
  private applyIncludes(row: Row | null, include: Record<string, unknown> | undefined): Row | null {
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
      const orderBy = (spec as { orderBy?: Record<string, "asc" | "desc"> })?.orderBy;
      const take = (spec as { take?: number })?.take;

      if (relation.foreignKey === "id") {
        const fkFieldOnRow = relation.localKey ?? `${relation.table}Id`;
        const fkValue = row[fkFieldOnRow];
        const found =
          fkValue === undefined || fkValue === null ? null : target.rows.find((r) => r.id === fkValue) ?? null;
        result[key] = target.applyIncludes(found, sub);
        continue;
      }

      const matches = target.rows.filter((r) => r[relation.foreignKey] === row.id);
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
    const row = this.rows.find((candidate) => matchesWhere(candidate, where)) ?? null;
    return this.applyIncludes(row, args.include ?? asSpec(args.select));
  }

  findFirst(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc"> | readonly Record<string, "asc" | "desc">[];
    include?: Record<string, unknown>;
    select?: unknown;
  }): Row | null {
    const matches = this.rows.filter((row) => matchesWhere(row, args.where));
    const sorted = sortRows(matches, args.orderBy);
    return this.applyIncludes(sorted[0] ?? null, args.include ?? asSpec(args.select));
  }

  findMany(
    args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc"> | readonly Record<string, "asc" | "desc">[];
      take?: number;
      skip?: number;
      include?: Record<string, unknown>;
      select?: unknown;
    } = {}
  ): Row[] {
    const matches = this.rows.filter((row) => matchesWhere(row, args.where));
    const sorted = sortRows(matches, args.orderBy);
    const skipped = args.skip === undefined ? sorted : sorted.slice(args.skip);
    const limited = args.take === undefined ? skipped : skipped.slice(0, args.take);
    return limited.map((row) => this.applyIncludes(row, args.include ?? asSpec(args.select))!);
  }

  count(args: { where?: Record<string, unknown> } = {}): number {
    return this.rows.filter((row) => matchesWhere(row, args.where)).length;
  }

  create(args: { data: Row }): Row {
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
}

function applyData(row: Row, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && "increment" in (value as Record<string, unknown>)) {
      row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

function sortRows(
  rows: Row[],
  orderBy: Record<string, "asc" | "desc"> | readonly Record<string, "asc" | "desc">[] | undefined
): Row[] {
  if (orderBy === undefined) return rows;
  // Prisma accepts an array of single-key order clauses; the fake only honours
  // the first one, which is enough to make ordering deterministic in tests.
  const primary = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (primary === undefined) return rows;
  const [field, direction] = Object.entries(primary)[0] ?? [];
  if (field === undefined) return rows;
  const sorted = [...rows].sort((a, b) => compare(a[field], b[field]));
  return direction === "desc" ? sorted.reverse() : sorted;
}

const MODEL_NAMES = [
  "asset",
  "portfolio",
  "tradingSession",
  "tradeCandidate",
  "tradeDecision",
  "riskAssessment",
  "riskRuleResult",
  "riskLimitSet",
  "riskEvent",
  "shadowOrder",
  "shadowFill",
  "shadowPosition",
  "shadowPositionEvent",
  "exitPlan",
  "portfolioLedgerEntry",
  "portfolioSnapshot",
  "strategyPerformance",
  "instrumentExecutionProfile",
  "candle",
  "tradingAuditEvent",
  "botRun",
  "botLog",
  "tradingJobCursor",
  // Work package 8
  "strategyVersion",
  "tradingAlertOutbox",
  "tradingAlertOutboxAttempt"
] as const;

export function createFakeTradingDatabase() {
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
      create: (args: never) => Promise.resolve(table.create(args)),
      update: (args: never) => Promise.resolve(table.update(args)),
      updateMany: (args: never) => Promise.resolve(table.updateMany(args))
    };
  }
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { database: db, tables };
}
