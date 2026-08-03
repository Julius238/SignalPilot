import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

import { validateAuthConfig } from "./auth/config.js";
import { requireAdmin } from "./auth/helpers.js";
import { resolveTradingApiConfig } from "./lib/tradingApiConfig.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAuditLogRoutes } from "./routes/audit-logs.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTradingOperationsRoutes, registerTradingReadRoutes } from "./routes/trading/index.js";

export async function buildServer() {
  validateAuthConfig();

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

  await server.register(registerHealthRoutes);
  await server.register(registerAuthRoutes);

  await server.register(async (protectedScope) => {
    protectedScope.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0];
      if (path === "/config/public") return;
      await requireAdmin(request, reply);
    });

    await protectedScope.register(registerDashboardRoutes);
    await protectedScope.register(registerAuditLogRoutes);

    // Trading API (docs/trading P6): fail-closed and off by default. A
    // malformed flag value is treated the same as "disabled" here — it
    // never takes down the rest of this API, it just leaves `/trading/*`
    // unregistered (a 404, not a 500).
    const tradingApiConfig = resolveTradingApiConfig();
    if (tradingApiConfig.ok && tradingApiConfig.config.readEnabled) {
      await protectedScope.register(registerTradingReadRoutes);
      server.log.info("Trading API read routes registered");
    }
    if (tradingApiConfig.ok && tradingApiConfig.config.operationsEnabled) {
      await protectedScope.register(registerTradingOperationsRoutes);
      server.log.info("Trading API operations routes registered");
    }
    if (!tradingApiConfig.ok) {
      server.log.warn({ reasonCode: tradingApiConfig.reasonCode }, "Trading API configuration invalid; routes not registered");
    }
  });

  return server;
}
