import { prisma, type PrismaClient, type RiskAssessmentStatus } from "@signalpilot/database";

export interface ListRiskAssessmentsFilters {
  readonly tradeCandidateId?: string;
  readonly portfolioId?: string;
  readonly status?: RiskAssessmentStatus;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listRiskAssessments(database: PrismaClient = prisma, filters: ListRiskAssessmentsFilters) {
  return database.riskAssessment.findMany({
    where: {
      tradeCandidateId: filters.tradeCandidateId,
      portfolioId: filters.portfolioId,
      status: filters.status,
      assessedAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { assessedAt: "desc" },
    skip: filters.offset,
    take: filters.limit,
    include: { ruleResults: true, decision: true }
  });
}
