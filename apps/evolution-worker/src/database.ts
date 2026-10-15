import { createRequire } from "node:module";

import type { PrismaClient } from "@signalpilot/database";

/**
 * Own Prisma client on `EVOLUTION_DATABASE_URL`. On the VPS that URL uses a
 * restricted role that may write only the Evolution* tables
 * (scripts/ops/evolution-db-role.sql), so even a defect in this worker cannot
 * touch a portfolio, session, order or arena row.
 */
export function createEvolutionDatabase(url: string): PrismaClient {
  const client = createRequire(import.meta.url)("@prisma/client") as typeof import("@prisma/client");
  return new client.PrismaClient({ datasourceUrl: url }) as unknown as PrismaClient;
}

export type EvolutionDb = PrismaClient;
