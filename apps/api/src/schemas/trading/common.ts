/**
 * Shared serialization primitives for every `/trading` response.
 *
 * Specification: P6 task, "Response-Schemas" — "Decimal-Werte als Strings;
 * Zeitpunkte als ISO-UTC; keine ungefilterten Prisma-Objekte."
 *
 * Every `toXxx` mapper elsewhere in `schemas/trading/*` builds a plain
 * object field-by-field from a Prisma row — never spreads the row — so a
 * schema change on the Prisma model can never silently leak a new column
 * into an API response.
 */

export function decimalToString(value: unknown): string {
  return value === null || value === undefined ? "0" : String(value);
}

export function nullableDecimalToString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function toIso(value: Date): string {
  return value.toISOString();
}

export function toIsoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
