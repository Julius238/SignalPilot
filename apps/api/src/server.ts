import Fastify from "fastify";
import cors from "@fastify/cors";
import type { HealthResponse } from "@signalpilot/shared";

import { registerDashboardRoutes } from "./routes/dashboard.js";

export async function buildServer() {
  const server = Fastify({
    logger: true
  });

  // TODO: Add dashboard/API auth before exposing this beyond trusted local networks.
  await server.register(cors, {
    origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000"
  });

  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    reply.code(500).send({
      error: "Internal Server Error",
      message: "Unexpected API error"
    });
  });

  server.get("/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      service: "signalpilot-api"
    };
  });

  await server.register(registerDashboardRoutes);

  return server;
}
