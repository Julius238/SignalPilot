import Fastify from "fastify";
import type { HealthResponse } from "@signalpilot/shared";

export function buildServer() {
  const server = Fastify({
    logger: true
  });

  server.get("/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      service: "signalpilot-api"
    };
  });

  return server;
}
