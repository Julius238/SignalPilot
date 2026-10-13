import { prisma } from "@signalpilot/database";
import type { FastifyInstance } from "fastify";

// Historical shadow replays (`pnpm trading-worker:shadow-replay`). Research
// output only: read-only routes, no trading capability, so they are not
// behind the trading API flags.

let database = prisma;

export function setReplaysDatabaseForTests(db: typeof prisma) {
  database = db;
}

const summarySelect = {
  id: true,
  label: true,
  symbol: true,
  strategyKey: true,
  mode: true,
  regimePolicy: true,
  costProfile: true,
  dataOrigin: true,
  isSynthetic: true,
  engineVersion: true,
  firstAnchorAt: true,
  lastAnchorAt: true,
  cycles: true,
  candidates: true,
  closedTrades: true,
  startingCash: true,
  finalEquity: true,
  outputHash: true,
  durationMs: true,
  metricsJson: true,
  createdAt: true
} as const;

export async function registerReplayRoutes(server: FastifyInstance) {
  server.get("/replays", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const rawLimit = Number(query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 200) : 50;
    const rows = await database.shadowReplayRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: summarySelect
    });
    return rows.map((row) => ({
      ...row,
      startingCash: row.startingCash.toString(),
      finalEquity: row.finalEquity.toString()
    }));
  });

  server.get("/replays/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await database.shadowReplayRun.findUnique({ where: { id } });
    if (row === null) return reply.code(404).send({ error: "Replay run not found" });
    return { ...row, startingCash: row.startingCash.toString(), finalEquity: row.finalEquity.toString() };
  });
}
