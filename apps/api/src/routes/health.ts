import { prisma } from "@signalpilot/database";
import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../auth/helpers.js";

export async function registerHealthRoutes(server: FastifyInstance) {
  server.get("/health", async () => ({
    status: "ok",
    service: "signalpilot-api",
    uptime: Math.floor(process.uptime())
  }));

  server.get("/health/deep", { preHandler: requireAdmin as never }, async () => {
    let dbStatus: "ok" | "error" = "error";
    let dbLatencyMs: number | null = null;

    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
      dbStatus = "ok";
    } catch {
      // intentionally swallowed — reported in response
    }

    const redisUrl = process.env.REDIS_URL;

    return {
      status: dbStatus === "ok" ? "ok" : "degraded",
      service: "signalpilot-api",
      uptime: Math.floor(process.uptime()),
      checks: {
        database: { status: dbStatus, latencyMs: dbLatencyMs },
        redis: { status: redisUrl ? "configured" : "not_configured" }
      }
    };
  });
}
