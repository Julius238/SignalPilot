/**
 * Shared parsing/error helpers for the `/trading` route group.
 *
 * Matches `routes/dashboard.ts`'s hand-rolled parser style exactly (this repo
 * has no Zod/TypeBox/JSON-Schema validation anywhere — see that file's own
 * bottom-of-file helpers) rather than introducing a second validation
 * approach. Kept in its own module because the trading route group spans
 * several files, unlike `dashboard.ts`'s single-file convention.
 */

import type { FastifyReply } from "fastify";

export type QueryValue = string | string[] | undefined;
export type QueryRecord = Record<string, QueryValue>;

export function asQueryRecord(query: unknown): QueryRecord {
  return (query ?? {}) as QueryRecord;
}

export function asBodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function firstQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: "Bad Request", message });
}

export function unauthorized(reply: FastifyReply, message = "Unauthorized") {
  return reply.code(401).send({ error: "Unauthorized", message });
}

export function forbidden(reply: FastifyReply, message: string) {
  return reply.code(403).send({ error: "Forbidden", message });
}

export function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: "Not Found", message });
}

/**
 * 409 with an optional machine-readable body. A client recovering from a
 * version conflict must be able to read the current version as a field, not
 * parse it out of `message` (P8, "5.": "Ergänze strukturierte
 * `currentVersion`-Informationen bei API-409-Konflikten").
 */
export function conflict(reply: FastifyReply, message: string, details?: Record<string, unknown>) {
  return reply.code(409).send({ error: "Conflict", message, ...(details ?? {}) });
}

export function serviceUnavailable(reply: FastifyReply, message: string) {
  return reply.code(503).send({ error: "Service Unavailable", message });
}

export function parseLimit(value: QueryValue, defaultValue: number, maxValue: number, reply: FastifyReply): number | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    badRequest(reply, `limit must be an integer between 1 and ${maxValue}`);
    return undefined;
  }
  return parsed;
}

export function parseOffset(value: QueryValue, reply: FastifyReply): number | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    badRequest(reply, "offset must be a non-negative integer");
    return undefined;
  }
  return parsed;
}

export function parseEnum<T extends string>(
  value: QueryValue,
  allowedValues: readonly T[],
  name: string,
  reply: FastifyReply
): T | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === "") return undefined;
  if (allowedValues.includes(raw as T)) return raw as T;
  badRequest(reply, `${name} must be one of: ${allowedValues.join(", ")}`);
  return undefined;
}

export function parseOptionalString(value: QueryValue): string | undefined {
  const raw = firstQueryValue(value);
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

export function parseOptionalDate(value: QueryValue, name: string, reply: FastifyReply): Date | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === "") return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    badRequest(reply, `${name} must be a valid ISO date`);
    return undefined;
  }
  return parsed;
}

export function parseRequiredBodyString(value: unknown, name: string, reply: FastifyReply): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    badRequest(reply, `${name} is required`);
    return undefined;
  }
  return value.trim();
}

export function parseOptionalBodyString(value: unknown, name: string, reply: FastifyReply): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    badRequest(reply, `${name} must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}

export function parseRequiredBodyInteger(value: unknown, name: string, reply: FastifyReply): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    badRequest(reply, `${name} must be a non-negative integer`);
    return undefined;
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
