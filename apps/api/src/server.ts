import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { HealthResponse } from "@signalpilot/shared";

import { requireAdmin } from "./auth/helpers.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAuditLogRoutes } from "./routes/audit-logs.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";

export async function buildServer() {
  const server = Fastify({ logger: true });

  await server.register(helmet, {
    contentSecurityPolicy: false
  });

  await server.register(cors, {
    origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000",
    credentials: true
  });

  await server.register(cookie);

  await server.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute"
  });

  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    reply.code(500).send({
      error: "Internal Server Error",
      message: "Unexpected API error"
    });
  });

  server.get("/health", async (): Promise<HealthResponse> => {
    return { status: "ok", service: "signalpilot-api" };
  });

  await server.register(registerAuthRoutes);

  await server.register(async (protectedScope) => {
    protectedScope.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0];
      if (path === "/config/public") return;
      await requireAdmin(request, reply);
    });

    await protectedScope.register(registerDashboardRoutes);
    await protectedScope.register(registerAuditLogRoutes);
  });

  return server;
}
