import {
  AssetDiscoveryRunKind,
  BotRunStatus,
  Prisma,
  type PrismaClient
} from "@signalpilot/database";

import { discoveryRunKey, type AssetDiscoverySettings } from "./discoveryConfig.js";

export type DiscoveryRunContext = {
  discoveryRunId: string;
  botRunId: string;
  resumed: boolean;
};

export async function startDiscoveryRun(
  database: PrismaClient,
  input: {
    kind: AssetDiscoveryRunKind;
    jobName: string;
    settings: AssetDiscoverySettings;
    now?: Date;
  }
): Promise<DiscoveryRunContext> {
  const now = input.now ?? new Date();
  const runKey = discoveryRunKey(input.kind, now);
  const existing = await database.assetDiscoveryRun.findUnique({
    where: { runKey },
    select: { id: true, status: true }
  });
  const discoveryRun = await database.assetDiscoveryRun.upsert({
    where: { runKey },
    create: {
      runKey,
      kind: input.kind,
      status: BotRunStatus.RUNNING,
      enabled: input.settings.enabled,
      dryRun: input.settings.dryRun,
      policyVersion: input.settings.policy.version,
      startedAt: now
    },
    update: {
      status: BotRunStatus.RUNNING,
      enabled: input.settings.enabled,
      dryRun: input.settings.dryRun,
      policyVersion: input.settings.policy.version,
      finishedAt: null,
      errorJson: Prisma.JsonNull
    }
  });
  const botRun = await database.botRun.create({
    data: {
      jobName: input.jobName,
      status: BotRunStatus.RUNNING,
      startedAt: now,
      metadataJson: {
        discoveryRunId: discoveryRun.id,
        runKey,
        enabled: input.settings.enabled,
        dryRun: input.settings.dryRun,
        policyVersion: input.settings.policy.version,
        resumed: existing !== null
      }
    }
  });
  return {
    discoveryRunId: discoveryRun.id,
    botRunId: botRun.id,
    resumed: existing !== null
  };
}

export async function finishDiscoveryRun(
  database: PrismaClient,
  context: DiscoveryRunContext,
  input: {
    status: BotRunStatus;
    metrics: Record<string, unknown>;
    error?: string;
  }
) {
  const finishedAt = new Date();
  const metadata = {
    discoveryRunId: context.discoveryRunId,
    resumed: context.resumed,
    ...input.metrics
  } as Prisma.InputJsonObject;
  await database.$transaction([
    database.assetDiscoveryRun.update({
      where: { id: context.discoveryRunId },
      data: {
        status: input.status,
        finishedAt,
        checkedAssetCount: integerMetric(input.metrics.checkedAssetCount),
        excludedAssetCount: integerMetric(input.metrics.excludedAssetCount),
        candidateCount: integerMetric(input.metrics.candidateCount),
        proposedAdditionCount: integerMetric(input.metrics.proposedAdditionCount),
        proposedRemovalCount: integerMetric(input.metrics.proposedRemovalCount),
        activatedCount: integerMetric(input.metrics.activatedCount),
        deactivatedCount: integerMetric(input.metrics.deactivatedCount),
        providerRequestCount: integerMetric(input.metrics.providerRequestCount),
        estimatedApiUnits: integerMetric(input.metrics.estimatedApiUnits),
        errorCount: integerMetric(input.metrics.errorCount),
        metricsJson: metadata,
        errorJson: input.error ? { message: input.error } : Prisma.JsonNull
      }
    }),
    database.botRun.update({
      where: { id: context.botRunId },
      data: {
        status: input.status,
        finishedAt,
        metadataJson: input.error ? { ...metadata, error: input.error } : metadata
      }
    })
  ]);
}

export async function writeDiscoveryLog(
  database: PrismaClient,
  level: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  await database.botLog.create({
    data: {
      level,
      service: "asset-discovery",
      message,
      metadataJson: metadata as Prisma.InputJsonObject | undefined
    }
  });
}

function integerMetric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}
