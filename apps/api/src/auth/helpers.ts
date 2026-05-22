import "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getCookieName, isAuthEnabled, verifySession } from "./session.js";

export async function getSessionPayload(request: FastifyRequest) {
  if (!isAuthEnabled()) return { role: "admin" as const };
  const token = request.cookies?.[getCookieName()];
  if (!token) return null;
  return verifySession(token);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthEnabled()) return;
  const payload = await getSessionPayload(request);
  if (!payload) {
    await reply.code(401).send({ error: "Unauthorized" });
  }
}
