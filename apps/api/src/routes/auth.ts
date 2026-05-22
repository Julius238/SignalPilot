import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

import { extractRequestContext, logAudit } from "../auth/audit.js";
import { getSessionPayload, requireAdmin } from "../auth/helpers.js";
import { getCookieName, isAuthEnabled, signSession } from "../auth/session.js";

export async function registerAuthRoutes(server: FastifyInstance) {
  server.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 5),
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const username = typeof body?.username === "string" ? body.username : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const ctx = extractRequestContext(request);

      const adminUsername = process.env.ADMIN_USERNAME;
      const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

      const isUsernameMatch = Boolean(adminUsername && username === adminUsername);
      const isPasswordMatch =
        isUsernameMatch && adminPasswordHash
          ? await bcrypt.compare(password, adminPasswordHash)
          : false;

      if (!isUsernameMatch || !isPasswordMatch) {
        await logAudit({ action: "login_failed", actor: username || "unknown", ...ctx });
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const token = await signSession();
      const cookieName = getCookieName();
      const ttlHours = Number(process.env.AUTH_SESSION_TTL_HOURS ?? 12);
      const isSecure = process.env.AUTH_COOKIE_SECURE === "true";

      reply.setCookie(cookieName, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecure,
        maxAge: ttlHours * 3600,
        path: "/"
      });

      await logAudit({ action: "login_success", actor: username, ...ctx });

      return reply.code(200).send({ ok: true });
    }
  );

  server.post("/auth/logout", async (request, reply) => {
    const ctx = extractRequestContext(request);
    reply.clearCookie(getCookieName(), { path: "/" });
    await logAudit({ action: "logout", actor: "admin", ...ctx });
    return reply.code(200).send({ ok: true });
  });

  server.get("/auth/me", { preHandler: requireAdmin }, async (request, reply) => {
    const payload = await getSessionPayload(request);
    if (!payload) return reply.code(401).send({ error: "Unauthorized" });
    return { role: payload.role, username: process.env.ADMIN_USERNAME ?? null };
  });

  server.get("/auth/status", async (request) => {
    const authEnabled = isAuthEnabled();
    if (!authEnabled) return { authenticated: true, authEnabled: false };
    const payload = await getSessionPayload(request);
    return { authenticated: payload !== null, authEnabled: true };
  });
}
