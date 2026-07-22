import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply } from "fastify";

import { extractRequestContext, logAudit } from "../auth/audit.js";
import { getDevLoginUsername, getPublicEnvironment, isDevLoginEnabled } from "../auth/config.js";
import { getSessionPayload, requireAdmin } from "../auth/helpers.js";
import { getCookieName, isAuthEnabled, signSession } from "../auth/session.js";

function setSessionCookie(reply: FastifyReply, token: string) {
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
}

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
        await logAudit({
          action: "login_failed",
          actor: username || "unknown",
          metadata: { reason: "invalid credentials" },
          ...ctx
        });
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const token = await signSession({ role: "admin", username });
      setSessionCookie(reply, token);

      await logAudit({ action: "login_success", actor: username, ...ctx });

      return reply.code(200).send({ ok: true });
    }
  );

  server.post("/auth/dev-login", async (request, reply) => {
    if (!isAuthEnabled() || !isDevLoginEnabled()) {
      return reply.code(403).send({ error: "Dev login is not enabled" });
    }

    const username = getDevLoginUsername();
    const token = await signSession({ role: "admin", username, devLogin: true });
    setSessionCookie(reply, token);

    await logAudit({
      action: "dev_login",
      actor: username,
      metadata: { devLogin: true },
      ...extractRequestContext(request)
    });

    return reply.code(200).send({
      ok: true,
      user: { username, role: "admin", devLogin: true }
    });
  });

  server.post("/auth/logout", async (request, reply) => {
    const ctx = extractRequestContext(request);
    reply.clearCookie(getCookieName(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.AUTH_COOKIE_SECURE === "true",
      path: "/"
    });
    await logAudit({ action: "logout", actor: "admin", ...ctx });
    return reply.code(200).send({ ok: true });
  });

  server.get("/auth/me", { preHandler: requireAdmin }, async (request, reply) => {
    const payload = await getSessionPayload(request);
    if (!payload) return reply.code(401).send({ error: "Unauthorized" });
    return {
      role: payload.role,
      username: payload.username ?? process.env.ADMIN_USERNAME ?? null,
      devLogin: payload.devLogin === true
    };
  });

  server.get("/auth/status", async (request) => {
    const authEnabled = isAuthEnabled();
    const devLoginEnabled = authEnabled && isDevLoginEnabled();
    const environment = getPublicEnvironment();
    if (!authEnabled) {
      return { authenticated: true, authEnabled: false, devLoginEnabled, environment };
    }
    const payload = await getSessionPayload(request);
    return {
      authenticated: payload !== null,
      authEnabled: true,
      devLoginEnabled,
      environment
    };
  });
}
