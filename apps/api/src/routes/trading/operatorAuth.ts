/**
 * "Trading-Operator" authorization for `/trading/operations/*`.
 *
 * The repo's entire role model is a single admin (`auth/session.ts`:
 * `AdminSessionPayload.role` is always `"admin"` — no `User` table, no RBAC).
 * There is no distinguishable "operator" permission to check beyond
 * "authenticated as the one admin". This function still exists as its own
 * named choke point — rather than calling `requireAdmin` directly from every
 * trading-operations route — so that if a real operator role is introduced
 * later, exactly one place needs to change.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import { requireAdmin } from "../../auth/helpers.js";

export async function requireTradingOperator(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAdmin(request, reply);
}
