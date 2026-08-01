import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetDiscoveryRunKind,
  BotRunStatus,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import { config } from "dotenv";

import { resolveAssetDiscoverySettings } from "../lib/discoveryConfig.js";
import {
  finishDiscoveryRun,
  startDiscoveryRun,
  writeDiscoveryLog
} from "../lib/discoveryRun.js";
import {
  discoveryScan,
  type DiscoveryScanSummary
} from "./discoveryScan.js";
import {
  reconcileActiveUniverse,
  type ActiveUniverseReconciliationSummary
} from "./reconcileActiveUniverse.js";
import {
  selectActiveUniverse,
  type ActiveUniverseSelectionSummary
} from "./selectActiveUniverse.js";
import {
  universeRefresh,
  type UniverseRefreshSummary
} from "./universeRefresh.js";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

export type AssetDiscoveryPipelineSummary = {
  status: BotRunStatus;
  enabled: boolean;
  dryRun: boolean;
  refresh: UniverseRefreshSummary | null;
  scan: DiscoveryScanSummary | null;
  selection: ActiveUniverseSelectionSummary | null;
  reconciliation: ActiveUniverseReconciliationSummary | null;
  checkedAssetCount: number;
  candidateCount: number;
  proposedAdditionCount: number;
  proposedRemovalCount: number;
  activatedCount: number;
  deactivatedCount: number;
  providerRequestCount: number;
  estimatedApiUnits: number;
  errorCount: number;
  discoveryRunId: string;
};

export async function runAssetDiscoveryPipeline(
  database: PrismaClient = prisma
): Promise<AssetDiscoveryPipelineSummary> {
  const now = new Date();
  const settings = resolveAssetDiscoverySettings();
  const context = await startDiscoveryRun(database, {
    kind: AssetDiscoveryRunKind.FULL_PIPELINE,
    jobName: "runAssetDiscoveryPipeline",
    settings,
    now
  });
  const summary: AssetDiscoveryPipelineSummary = {
    status: BotRunStatus.RUNNING,
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    refresh: null,
    scan: null,
    selection: null,
    reconciliation: null,
    checkedAssetCount: 0,
    candidateCount: 0,
    proposedAdditionCount: 0,
    proposedRemovalCount: 0,
    activatedCount: 0,
    deactivatedCount: 0,
    providerRequestCount: 0,
    estimatedApiUnits: 0,
    errorCount: 0,
    discoveryRunId: context.discoveryRunId
  };

  try {
    summary.refresh = await universeRefresh(database, undefined, now);
    summary.scan = await discoveryScan(database, undefined, now);
    summary.selection = await selectActiveUniverse(database, now);
    summary.reconciliation = await reconcileActiveUniverse(database, now);
    summary.checkedAssetCount = summary.scan.checkedAssetCount;
    summary.candidateCount = summary.scan.candidateCount;
    summary.proposedAdditionCount = summary.selection.proposedAdditionCount;
    summary.proposedRemovalCount = summary.selection.proposedRemovalCount;
    summary.activatedCount = summary.reconciliation.activatedCount;
    summary.deactivatedCount = summary.reconciliation.deactivatedCount;
    summary.providerRequestCount =
      summary.refresh.providerRequestCount +
      summary.scan.providerRequestCount +
      summary.reconciliation.providerRequestCount;
    summary.estimatedApiUnits =
      summary.refresh.estimatedApiUnits +
      summary.scan.estimatedApiUnits +
      summary.reconciliation.estimatedApiUnits;
    summary.errorCount =
      summary.refresh.errorCount +
      summary.scan.errorCount +
      summary.selection.errorCount +
      summary.reconciliation.errorCount;
    summary.status =
      [
        summary.refresh.status,
        summary.scan.status,
        summary.selection.status,
        summary.reconciliation.status
      ].includes(BotRunStatus.FAILED)
        ? BotRunStatus.FAILED
        : BotRunStatus.SUCCESS;
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: {
        ...summary,
        refresh: summary.refresh.discoveryRunId,
        scan: summary.scan.discoveryRunId,
        selection: summary.selection.discoveryRunId,
        reconciliation: summary.reconciliation.discoveryRunId,
        notificationDispatchCount: 0
      }
    });
    await writeDiscoveryLog(
      database,
      summary.status === BotRunStatus.SUCCESS ? "info" : "warn",
      "Asset Discovery Pipeline abgeschlossen",
      {
        discoveryRunId: context.discoveryRunId,
        enabled: summary.enabled,
        dryRun: summary.dryRun,
        candidateCount: summary.candidateCount,
        proposedAdditionCount: summary.proposedAdditionCount,
        proposedRemovalCount: summary.proposedRemovalCount,
        providerRequestCount: summary.providerRequestCount,
        estimatedApiUnits: summary.estimatedApiUnits,
        notificationDispatchCount: 0
      }
    );
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    const message = error instanceof Error ? error.message : "Unknown discovery pipeline error";
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: {
        checkedAssetCount: summary.checkedAssetCount,
        candidateCount: summary.candidateCount,
        proposedAdditionCount: summary.proposedAdditionCount,
        proposedRemovalCount: summary.proposedRemovalCount,
        activatedCount: summary.activatedCount,
        deactivatedCount: summary.deactivatedCount,
        providerRequestCount: summary.providerRequestCount,
        estimatedApiUnits: summary.estimatedApiUnits,
        errorCount: summary.errorCount
      },
      error: message
    });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runAssetDiscoveryPipeline();
  } finally {
    await prisma.$disconnect();
  }
}
