import { prisma } from "@signalpilot/database";
import type { FastifyInstance } from "fastify";

let database = prisma;

export function setAuditLogsDatabaseForTests(db: typeof prisma) {
  database = db;
}

export async function registerAuditLogRoutes(server: FastifyInstance) {
  server.get("/audit-logs", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const action = query.action;
    const rawLimit = Number(query.limit ?? 100);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 500);

    if (limit > 500) {
      return reply.code(400).send({ error: "limit must be at most 500" });
    }

    const logs = await database.auditLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return logs;
  });
}
