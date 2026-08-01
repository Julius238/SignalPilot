import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  selectActiveUniverse as applySelectionPolicy,
  type UniverseSelectionCandidate
} from "@signalpilot/discovery";
import {
  AssetDiscoveryAction,
  AssetDiscoveryCandidateStatus,
  AssetDiscoveryRunKind,
  AssetType,
  BotRunStatus,
  Prisma,
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

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

type SelectionSourceCandidate = Awaited<ReturnType<typeof loadLatestScanCandidates>>[number];

export type ActiveUniverseSelectionSummary = {
  status: BotRunStatus;
  enabled: boolean;
  dryRun: boolean;
  checkedAssetCount: number;
  excludedAssetCount: number;
  candidateCount: number;
  proposedAdditionCount: number;
  proposedRemovalCount: number;
  retainedCount: number;
  stabilityRate: number;
  providerRequestCount: number;
  estimatedApiUnits: number;
  errorCount: number;
  sourceDiscoveryRunId: string | null;
  discoveryRunId: string;
};

export async function selectActiveUniverse(
  database: PrismaClient = prisma,
  now: Date = new Date()
): Promise<ActiveUniverseSelectionSummary> {
  const settings = resolveAssetDiscoverySettings();
  const context = await startDiscoveryRun(database, {
    kind: AssetDiscoveryRunKind.ACTIVE_SELECTION,
    jobName: "assetActiveUniverseSelection",
    settings,
    now
  });
  const summary: ActiveUniverseSelectionSummary = {
    status: BotRunStatus.RUNNING,
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    checkedAssetCount: 0,
    excludedAssetCount: 0,
    candidateCount: 0,
    proposedAdditionCount: 0,
    proposedRemovalCount: 0,
    retainedCount: 0,
    stabilityRate: 100,
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
        metrics: summary
      });
      return summary;
    }

    const source = await database.assetDiscoveryRun.findFirst({
      where: {
        kind: AssetDiscoveryRunKind.DISCOVERY_SCAN,
        status: BotRunStatus.SUCCESS
      },
      orderBy: { startedAt: "desc" },
      select: { id: true }
    });
    if (!source) throw new Error("No successful Discovery Scan is available for selection.");
    summary.sourceDiscoveryRunId = source.id;
    const candidates = await loadLatestScanCandidates(database, source.id);
    summary.checkedAssetCount = candidates.length;
    summary.candidateCount = candidates.length;
    const correlationMatrix = buildCorrelationMatrix(candidates);
    const policyInput: UniverseSelectionCandidate[] = candidates.map((candidate) => {
      const membership = candidate.asset.universeMemberships[0];
      const preference = candidate.asset.universePreference;
      return {
        assetId: candidate.assetId,
        symbol: candidate.asset.symbol,
        assetType: toDiscoveryAssetType(candidate.asset.assetType),
        sector: candidate.asset.sector,
        score: candidate.score,
        dataQuality: candidate.dataQuality,
        liquidity: candidate.liquidity,
        eligible: candidate.status === AssetDiscoveryCandidateStatus.ELIGIBLE,
        isActive: candidate.asset.isActive,
        isCore: membership?.role === "CORE" || membership?.source === "CORE",
        isPinned: preference?.isPinned === true || membership?.source === "PINNED",
        isManual:
          preference?.manualActive === true || membership?.source === "MANUAL",
        isExcluded: preference?.isExcluded === true || membership?.source === "EXCLUDED",
        isObserveOnly: preference?.observeOnly === true,
        activeSince: membership?.activatedAt,
        cooldownUntil: membership?.cooldownUntil,
        correlationGroup: candidate.asset.sector
          ? `${candidate.asset.assetType}:${candidate.asset.sector}`
          : null,
        correlations: correlationMatrix.get(candidate.assetId)
      };
    });
    const result = applySelectionPolicy(policyInput, settings.policy, now);
    summary.proposedAdditionCount = result.additions.length;
    summary.proposedRemovalCount = result.removals.length;
    summary.retainedCount = result.retained.length;
    summary.excludedAssetCount = result.ignored.length;
    const activeCount = policyInput.filter((candidate) => candidate.isActive).length;
    summary.stabilityRate =
      activeCount === 0
        ? 100
        : round(
            ((activeCount - result.removals.length) / Math.max(1, activeCount)) * 100
          );

    const decisionByAssetId = new Map(
      result.decisions.map((decision) => [decision.assetId, decision])
    );
    await database.assetDiscoveryCandidate.updateMany({
      where: { discoveryRunId: context.discoveryRunId },
      data: {
        proposedAction: AssetDiscoveryAction.NONE,
        selected: false
      }
    });
    for (const sourceCandidate of candidates) {
      const decision = decisionByAssetId.get(sourceCandidate.assetId);
      const proposedAction = toDiscoveryAction(decision?.action);
      const status = toCandidateStatus(sourceCandidate.status, decision?.action);
      const selected = result.selectedAssetIds.includes(sourceCandidate.assetId);
      const metrics = mergeJsonObject(sourceCandidate.metricsJson, {
        sourceDiscoveryRunId: source.id,
        selectionReason: decision?.reason ?? "NO_SELECTION_DECISION"
      });
      const target = await database.assetDiscoveryCandidate.upsert({
        where: {
          discoveryRunId_assetId: {
            discoveryRunId: context.discoveryRunId,
            assetId: sourceCandidate.assetId
          }
        },
        create: {
          discoveryRunId: context.discoveryRunId,
          assetId: sourceCandidate.assetId,
          status,
          proposedAction,
          score: sourceCandidate.score,
          confidence: sourceCandidate.confidence,
          dataQuality: sourceCandidate.dataQuality,
          liquidity: sourceCandidate.liquidity,
          rank: sourceCandidate.rank,
          selected,
          reasonsJson: appendJsonArray(
            sourceCandidate.reasonsJson,
            decision?.reason ?? "NO_SELECTION_DECISION"
          ),
          exclusionReasonsJson:
            sourceCandidate.exclusionReasonsJson as Prisma.InputJsonValue,
          metricsJson: metrics,
          providerMetadataJson:
            sourceCandidate.providerMetadataJson ?? Prisma.JsonNull
        },
        update: {
          status,
          proposedAction,
          score: sourceCandidate.score,
          confidence: sourceCandidate.confidence,
          dataQuality: sourceCandidate.dataQuality,
          liquidity: sourceCandidate.liquidity,
          rank: sourceCandidate.rank,
          selected,
          reasonsJson: appendJsonArray(
            sourceCandidate.reasonsJson,
            decision?.reason ?? "NO_SELECTION_DECISION"
          ),
          exclusionReasonsJson:
            sourceCandidate.exclusionReasonsJson as Prisma.InputJsonValue,
          metricsJson: metrics,
          providerMetadataJson:
            sourceCandidate.providerMetadataJson ?? Prisma.JsonNull
        }
      });
      if (sourceCandidate.scoreSnapshot) {
        await database.discoveryScoreSnapshot.upsert({
          where: { candidateId: target.id },
          create: {
            discoveryRunId: context.discoveryRunId,
            candidateId: target.id,
            assetId: sourceCandidate.assetId,
            score: sourceCandidate.scoreSnapshot.score,
            rawScore: sourceCandidate.scoreSnapshot.rawScore,
            confidence: sourceCandidate.scoreSnapshot.confidence,
            dataQuality: sourceCandidate.scoreSnapshot.dataQuality,
            liquidity: sourceCandidate.scoreSnapshot.liquidity,
            sampleSize: sourceCandidate.scoreSnapshot.sampleSize,
            policyVersion: sourceCandidate.scoreSnapshot.policyVersion,
            componentsJson:
              sourceCandidate.scoreSnapshot.componentsJson as Prisma.InputJsonValue,
            weightsJson:
              sourceCandidate.scoreSnapshot.weightsJson as Prisma.InputJsonValue,
            metricsJson: sourceCandidate.scoreSnapshot.metricsJson ?? Prisma.JsonNull
          },
          update: {
            score: sourceCandidate.scoreSnapshot.score,
            rawScore: sourceCandidate.scoreSnapshot.rawScore,
            confidence: sourceCandidate.scoreSnapshot.confidence,
            dataQuality: sourceCandidate.scoreSnapshot.dataQuality,
            liquidity: sourceCandidate.scoreSnapshot.liquidity,
            sampleSize: sourceCandidate.scoreSnapshot.sampleSize,
            policyVersion: sourceCandidate.scoreSnapshot.policyVersion,
            componentsJson:
              sourceCandidate.scoreSnapshot.componentsJson as Prisma.InputJsonValue,
            weightsJson:
              sourceCandidate.scoreSnapshot.weightsJson as Prisma.InputJsonValue,
            metricsJson: sourceCandidate.scoreSnapshot.metricsJson ?? Prisma.JsonNull
          }
        });
      }
    }

    summary.status = BotRunStatus.SUCCESS;
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: summary
    });
    await writeDiscoveryLog(database, "info", "Active Universe Auswahl abgeschlossen", {
      ...summary,
      notificationDispatchCount: 0
    });
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    const message =
      error instanceof Error ? error.message : "Unknown active universe selection error";
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: summary,
      error: message
    });
    throw error;
  }
}

function loadLatestScanCandidates(database: PrismaClient, discoveryRunId: string) {
  return database.assetDiscoveryCandidate.findMany({
    where: { discoveryRunId },
    include: {
      scoreSnapshot: true,
      asset: {
        include: {
          universePreference: true,
          universeMemberships: {
            where: { isCurrent: true },
            take: 1
          }
        }
      }
    },
    orderBy: [{ rank: "asc" }, { score: "desc" }]
  });
}

function buildCorrelationMatrix(candidates: SelectionSourceCandidate[]) {
  const matrix = new Map<string, Record<string, number>>();
  for (const left of candidates) {
    const leftReturns = readReturnSeries(left.metricsJson);
    const correlations: Record<string, number> = {};
    for (const right of candidates) {
      if (left.assetId === right.assetId) continue;
      const value = pearsonCorrelation(leftReturns, readReturnSeries(right.metricsJson));
      if (value !== null) correlations[right.assetId] = value;
    }
    matrix.set(left.assetId, correlations);
  }
  return matrix;
}

function readReturnSeries(value: Prisma.JsonValue | null) {
  if (!isJsonObject(value) || !Array.isArray(value.returnSeries)) return [];
  return value.returnSeries
    .map(Number)
    .filter((item) => Number.isFinite(item))
    .slice(-40);
}

function pearsonCorrelation(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  if (size < 20) return null;
  const x = left.slice(-size);
  const y = right.slice(-size);
  const meanX = x.reduce((sum, value) => sum + value, 0) / size;
  const meanY = y.reduce((sum, value) => sum + value, 0) / size;
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;
  for (let index = 0; index < size; index += 1) {
    const deltaX = x[index]! - meanX;
    const deltaY = y[index]! - meanY;
    numerator += deltaX * deltaY;
    denominatorX += deltaX ** 2;
    denominatorY += deltaY ** 2;
  }
  const denominator = Math.sqrt(denominatorX * denominatorY);
  return denominator > 0 ? numerator / denominator : null;
}

function toDiscoveryAction(action: string | undefined) {
  if (action === "ADD") return AssetDiscoveryAction.ADD;
  if (action === "REMOVE") return AssetDiscoveryAction.REMOVE;
  if (action === "KEEP") return AssetDiscoveryAction.KEEP;
  return AssetDiscoveryAction.NONE;
}

function toCandidateStatus(
  sourceStatus: AssetDiscoveryCandidateStatus,
  action: string | undefined
) {
  if (action === "ADD") return AssetDiscoveryCandidateStatus.SELECTED;
  if (action === "REMOVE") return AssetDiscoveryCandidateStatus.REMOVED;
  if (action === "KEEP") return AssetDiscoveryCandidateStatus.RETAINED;
  return sourceStatus;
}

function toDiscoveryAssetType(assetType: AssetType) {
  if (assetType === AssetType.CRYPTO) return "CRYPTO" as const;
  if (assetType === AssetType.ETF) return "ETF" as const;
  return "STOCK" as const;
}

function appendJsonArray(value: Prisma.JsonValue, item: string) {
  const values = Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
  return [...new Set([...values, item])];
}

function mergeJsonObject(
  value: Prisma.JsonValue | null,
  additions: Record<string, Prisma.InputJsonValue>
) {
  return {
    ...(isJsonObject(value) ? value : {}),
    ...additions
  } as Prisma.InputJsonObject;
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await selectActiveUniverse();
  } finally {
    await prisma.$disconnect();
  }
}
