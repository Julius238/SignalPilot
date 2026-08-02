/**
 * Canonical JSON serialisation and hashing.
 *
 * Specification:
 *   docs/trading/02-shadow-trading-target-architecture.md, "Idempotenz und Concurrency":
 *     JSON snapshots are canonically serialised and hashed; a retry with the
 *     same key but a different input hash is a critical risk event.
 *   docs/trading/12-test-and-acceptance-plan.md, "Domain- und Schema-Abnahme":
 *     key order irrelevant, array order relevant, Date and Decimal unambiguous.
 *
 * `node:crypto` is a runtime primitive, not a framework, network client or
 * clock — importing it keeps the package boundary from docs/trading/02 intact.
 */

import { createHash } from "node:crypto";

import { TradingDomainError, TradingReasonCode } from "./types.js";

/** Anything this module can serialise. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | Date
  | bigint
  | { toJSON(): unknown }
  | readonly CanonicalValue[]
  | { readonly [key: string]: unknown };

function serialize(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) return "null";

  const valueType = typeof value;

  if (valueType === "string") return JSON.stringify(value);

  if (valueType === "boolean") return value ? "true" : "false";

  if (valueType === "bigint") return `"${(value as bigint).toString()}"`;

  if (valueType === "number") {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) {
      throw new TradingDomainError(
        TradingReasonCode.CANONICAL_JSON_NON_FINITE_NUMBER,
        `NaN and Infinity cannot be hashed deterministically (at ${path}).`
      );
    }
    // -0 and 0 must hash identically.
    return Object.is(numeric, -0) ? "0" : String(numeric);
  }

  if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
    throw new TradingDomainError(
      TradingReasonCode.CANONICAL_JSON_UNSUPPORTED_VALUE,
      `Value of type ${valueType} is not serialisable (at ${path}).`
    );
  }

  const objectValue = value as object;

  if (seen.has(objectValue)) {
    throw new TradingDomainError(
      TradingReasonCode.CANONICAL_JSON_CIRCULAR_REFERENCE,
      `Circular reference detected (at ${path}).`
    );
  }

  if (objectValue instanceof Date) {
    const time = objectValue.getTime();
    if (Number.isNaN(time)) {
      throw new TradingDomainError(
        TradingReasonCode.CANONICAL_JSON_NON_FINITE_NUMBER,
        `Invalid Date cannot be hashed (at ${path}).`
      );
    }
    // Always UTC with milliseconds — docs/trading/03, "Alle Zeitpunkte sind DateTime in UTC".
    return JSON.stringify(objectValue.toISOString());
  }

  if (objectValue instanceof Map || objectValue instanceof Set) {
    throw new TradingDomainError(
      TradingReasonCode.CANONICAL_JSON_UNSUPPORTED_VALUE,
      `Map and Set have no canonical JSON form (at ${path}); convert to array or object first.`
    );
  }

  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      // Array order is part of the meaning and is preserved.
      const items = objectValue.map((item, index) => serialize(item, seen, `${path}[${index}]`));
      return `[${items.join(",")}]`;
    }

    const maybeJson = objectValue as { toJSON?: unknown };
    if (typeof maybeJson.toJSON === "function") {
      return serialize((maybeJson.toJSON as () => unknown)(), seen, path);
    }

    const record = objectValue as Record<string, unknown>;
    // Object key order is irrelevant and therefore normalised.
    const keys = Object.keys(record).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const entryValue = record[key];
      // An absent property and an explicit `undefined` must hash identically.
      if (entryValue === undefined) continue;
      entries.push(`${JSON.stringify(key)}:${serialize(entryValue, seen, `${path}.${key}`)}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(objectValue);
  }
}

/**
 * Deterministic string form of a snapshot.
 *
 * Object keys are sorted, array order is kept, `Date` becomes an ISO-8601 UTC
 * string, `DecimalValue` becomes its fixed-scale string via `toJSON`, and
 * `undefined` properties are dropped.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set<object>(), "$");
}

/** SHA-256 (lowercase hex) over the canonical form. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

/** SHA-256 (lowercase hex) over an already canonical string. */
export function hashCanonicalString(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
