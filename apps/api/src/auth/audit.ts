import { Prisma, prisma } from "@signalpilot/database";
import type { FastifyRequest } from "fastify";

let auditDatabase = prisma;

export function setAuditDatabaseForTests(db: typeof prisma) {
  auditDatabase = db;
}

export type AuditParams = {
  action: string;
  actor: string;
  ip: string;
  userAgent: string;
  targetType?: string;
  targetId?: string;
  metadata?: unknown;
};

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    await auditDatabase.auditLog.create({
      data: {
        action: params.action,
        actor: params.actor,
        ip: params.ip,
        userAgent: params.userAgent,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadataJson: params.metadata !== undefined ? (params.metadata as Prisma.InputJsonValue) : undefined
      }
    });
  } catch {
    // Never fail a request due to audit log errors
  }
}

export function extractRequestContext(request: FastifyRequest) {
  return {
    ip: request.ip ?? "unknown",
    userAgent: (request.headers["user-agent"] ?? "unknown").slice(0, 500)
  };
}
