/**
 * HTTP-facing guards every `/trading/operations/*` route applies before
 * calling into `services/trading/operationsService.ts`: an explicit
 * confirmation phrase, an idempotency key, and the caller's expected entity
 * version. These only parse the request and write a 400/409 — the actual
 * idempotency-replay lookup and version check against the database live in
 * the service layer, next to the operation they guard.
 *
 * Specification: P6 task, "Schutz der Schreiboperationen" — "expliziten
 * Bestätigungstext ... Idempotency Key ... aktuelle erwartete
 * Entity-Version ... Kritische Aktionen dürfen bei veralteter Version oder
 * widersprüchlichem Zustand nicht ausgeführt werden."
 */

import type { FastifyReply } from "fastify";

import { badRequest, conflict, parseRequiredBodyInteger, parseRequiredBodyString } from "./http.js";

export function requireConfirmation(
  body: Record<string, unknown>,
  expectedPhrase: string,
  reply: FastifyReply
): boolean {
  const confirm = typeof body.confirm === "string" ? body.confirm : undefined;
  if (confirm !== expectedPhrase) {
    badRequest(reply, `confirm must equal "${expectedPhrase}" to perform this action.`);
    return false;
  }
  return true;
}

export function requireIdempotencyKey(body: Record<string, unknown>, reply: FastifyReply): string | undefined {
  return parseRequiredBodyString(body.idempotencyKey, "idempotencyKey", reply);
}

export function requireExpectedVersion(body: Record<string, unknown>, reply: FastifyReply): number | undefined {
  return parseRequiredBodyInteger(body.expectedVersion, "expectedVersion", reply);
}

export function checkExpectedVersion(actualVersion: number, expectedVersion: number, reply: FastifyReply): boolean {
  if (actualVersion !== expectedVersion) {
    conflict(
      reply,
      `Expected version ${expectedVersion} does not match the current version ${actualVersion}. Reload and retry.`
    );
    return false;
  }
  return true;
}
