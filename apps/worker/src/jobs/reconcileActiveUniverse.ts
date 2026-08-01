import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetDiscoveryAction,
  AssetDiscoveryRunKind,
  AssetUniverseRole,
  AssetUniverseSource,
  BotRunStatus,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";

import {
  discoveryRunKey,
  resolveAssetDiscoverySettings
} from "../lib/discoveryConfig.js";
import {
  finishDiscoveryRun,
  startDiscoveryRun,
  writeDiscoveryLog
} from "../lib/discoveryRun.js";
import { backfillCandleHistory } from "./backfillCandleHistory.js";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

export type ActiveUniverseReconciliationSummary = {
  status: BotRunStatus;
  enabled: boolean;
  dryRun: boolean;
  checkedAssetCount: number;
  excludedAssetCount: number;
  candidateCount: number;
  proposedAdditionCount: number;
  proposedRemovalCount: number;
  activatedCount: number;
  deactivatedCount: number;
  backfillAssetCount: number;
  backfillStarted: boolean;
  providerRequestCount: number;
  estimatedApiUnits: number;
  errorCount: number;
  sourceDiscoveryRunId: string | null;
  discoveryRunId: string;
};

export async function reconcileActiveUniverse(
  database: PrismaClient = prisma,
  now: Date = new Date(),
  backfill: typeof backfillCandleHistory = backfillCandleHistory
): Promise<ActiveUniverseReconciliationSummary> {
  const settings = resolveAssetDiscoverySettings();
  const context = await startDiscoveryRun(database, {
    kind: AssetDiscoveryRunKind.RECONCILIATION,
    jobName: "assetActiveUniverseReconciliation",
    settings,
    now
  });
  const summary: ActiveUniverseReconciliationSummary = {
    status: BotRunStatus.RUNNING,
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    checkedAssetCount: 0,
    excludedAssetCount: 0,
    candidateCount: 0,
    proposedAdditionCount: 0,
    proposedRemovalCount: 0,
    activatedCount: 0,
    deactivatedCount: 0,
    backfillAssetCount: 0,
    backfillStarted: false,
    providerRequestCount: 0,
    estimatedApiUnits: 0,
    errorCount: 0,
    sourceDiscoveryRunId: null,
    discoveryRunId: context.discoveryRunId
  };

  try {
    if (!settings.enabled) {
      summary.status = BotRunStatus.SUCCESS;
      await finishDiscoveryRun(database, context, {
        status: summary.status,
        metrics: { ...summary }
      });
      return summary;
    }

    const source = await database.assetDiscoveryRun.findFirst({
      where: {
        runKey: discoveryRunKey(AssetDiscoveryRunKind.ACTIVE_SELECTION, now),
        kind: AssetDiscoveryRunKind.ACTIVE_SELECTION,
        status: BotRunStatus.SUCCESS,
        enabled: true,
        dryRun: settings.dryRun,
        policyVersion: settings.policy.version
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        candidates: {
          where: {
            proposedAction: {
              in: [AssetDiscoveryAction.ADD, AssetDiscoveryAction.REMOVE]
            }
          },
          include: {
            asset: {
              include: {
                universePreference: true,
                universeMemberships: {
                  where: { isCurrent: true },
                  take: 1
                }
              }
            }
          }
        }
      }
    });
    if (!source) throw new Error("No successful Active Universe Selection is available.");
    summary.sourceDiscoveryRunId = source.id;
    summary.checkedAssetCount = source.candidates.length;
    summary.candidateCount = source.candidates.length;
    summary.proposedAdditionCount = source.candidates.filter(
      (candidate) => candidate.proposedAction === AssetDiscoveryAction.ADD
    ).length;
    summary.proposedRemovalCount = source.candidates.filter(
      (candidate) => candidate.proposedAction === AssetDiscoveryAction.REMOVE
    ).length;

    if (settings.dryRun) {
      summary.status = BotRunStatus.SUCCESS;
      await finishDiscoveryRun(database, context, {
        status: summary.status,
        metrics: {
          ...summary,
          dryRunGuard: "NO_PRODUCTIVE_MEMBERSHIP_MUTATION",
          notificationDispatchCount: 0
        }
      });
      await writeDiscoveryLog(database, "info", "Reconciliation im Dry-Run abgeschlossen", {
        ...summary,
        productiveMutations: 0,
        notificationDispatchCount: 0
      });
      return summary;
    }

    const activatedAssetIds: string[] = [];
    for (const candidate of source.candidates) {
      try {
        if (candidate.proposedAction === AssetDiscoveryAction.ADD) {
          const changed = await activateCandidate(
            database,
            candidate.assetId,
            context.discoveryRunId,
            settings.policy.version,
            now
          );
          if (changed) {
            activatedAssetIds.push(candidate.assetId);
            summary.activatedCount += 1;
          }
        } else if (candidate.proposedAction === AssetDiscoveryAction.REMOVE) {
          const changed = await deactivateCandidate(
            database,
            candidate.assetId,
            context.discoveryRunId,
            settings.policy.version,
            settings.policy.removalCooldownDays,
            now
          );
          if (changed) summary.deactivatedCount += 1;
        }
      } catch (error) {
        summary.errorCount += 1;
        await writeDiscoveryLog(database, "error", "Universe-Änderung für Asset fehlgeschlagen", {
          discoveryRunId: context.discoveryRunId,
          assetId: candidate.assetId,
          symbol: candidate.asset.symbol,
          proposedAction: candidate.proposedAction,
          error: error instanceof Error ? error.message : "Unknown reconciliation error"
        });
      }
    }

    if (activatedAssetIds.length > 0) {
      summary.backfillStarted = true;
      summary.backfillAssetCount = activatedAssetIds.length;
      const backfillSummary = await backfill(database, {
        assetIds: activatedAssetIds,
        now
      });
      summary.providerRequestCount += backfillSummary.requestCount;
      summary.estimatedApiUnits += backfillSummary.requestCount;
      if (backfillSummary.status === BotRunStatus.FAILED) summary.errorCount += 1;
    }

    summary.status =
      summary.errorCount > 0 ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: { ...summary, notificationDispatchCount: 0 }
    });
    await writeDiscoveryLog(
      database,
      summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
      "Active Universe Reconciliation abgeschlossen",
      { ...summary, notificationDispatchCount: 0 }
    );
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    const message =
      error instanceof Error ? error.message : "Unknown active universe reconciliation error";
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: { ...summary },
      error: message
    });
    throw error;
  }
}

async function activateCandidate(
  database: PrismaClient,
  assetId: string,
  discoveryRunId: string,
  policyVersion: string,
  now: Date
) {
  return database.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: assetId },
      include: {
        universePreference: true,
        universeMemberships: {
          where: { isCurrent: true },
          take: 1
        }
      }
    });
    const preference = asset.universePreference;
    const current = asset.universeMemberships[0];
    if (preference?.isExcluded || preference?.observeOnly) return false;
    if (
      asset.isActive &&
      (current?.role === AssetUniverseRole.ACTIVE ||
        current?.role === AssetUniverseRole.CORE)
    ) {
      return false;
    }
    if (current) {
      await tx.assetUniverseMembership.update({
        where: { id: current.id },
        data: { isCurrent: false, validTo: now }
      });
    }
    const source = preference?.isPinned
      ? AssetUniverseSource.PINNED
      : preference?.manualActive
        ? AssetUniverseSource.MANUAL
        : AssetUniverseSource.AUTO_DISCOVERED;
    await tx.assetUniverseMembership.create({
      data: {
        assetId,
        role: AssetUniverseRole.ACTIVE,
        source,
        reason: "ACTIVE_SELECTION_APPROVED",
        policyVersion,
        discoveryRunId,
        activatedAt: now,
        validFrom: now,
        metadataJson: { backfillRequired: true }
      }
    });
    await tx.asset.update({ where: { id: assetId }, data: { isActive: true } });
    return true;
  });
}

async function deactivateCandidate(
  database: PrismaClient,
  assetId: string,
  discoveryRunId: string,
  policyVersion: string,
  cooldownDays: number,
  now: Date
) {
  return database.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: assetId },
      include: {
        universePreference: true,
        universeMemberships: {
          where: { isCurrent: true },
          take: 1
        }
      }
    });
    const preference = asset.universePreference;
    const current = asset.universeMemberships[0];
    if (
      !current ||
      current.role === AssetUniverseRole.CORE ||
      current.source !== AssetUniverseSource.AUTO_DISCOVERED ||
      preference?.isPinned ||
      preference?.manualActive
    ) {
      return false;
    }
    await tx.assetUniverseMembership.update({
      where: { id: current.id },
      data: {
        isCurrent: false,
        validTo: now,
        deactivatedAt: now
      }
    });
    await tx.assetUniverseMembership.create({
      data: {
        assetId,
        role: AssetUniverseRole.INACTIVE,
        source: AssetUniverseSource.INACTIVE,
        reason: "AUTO_SELECTION_REMOVED",
        policyVersion,
        discoveryRunId,
        deactivatedAt: now,
        validFrom: now,
        cooldownUntil: new Date(now.getTime() + cooldownDays * 86_400_000)
      }
    });
    await tx.asset.update({ where: { id: assetId }, data: { isActive: false } });
    return true;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await reconcileActiveUniverse();
  } finally {
    await prisma.$disconnect();
  }
}
