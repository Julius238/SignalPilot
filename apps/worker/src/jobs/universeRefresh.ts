import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateInstrumentEligibility,
  type DiscoveryInstrument
} from "@signalpilot/discovery";
import {
  AssetDiscoveryRunKind,
  AssetType,
  AssetUniverseRole,
  AssetUniverseSource,
  BotRunStatus,
  Prisma,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  createDefaultDiscoveryProviders,
  type AssetDiscoveryProvider
} from "@signalpilot/market-data";
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

export type UniverseRefreshSummary = {
  status: BotRunStatus;
  enabled: boolean;
  dryRun: boolean;
  checkedAssetCount: number;
  excludedAssetCount: number;
  candidateCount: number;
  createdAssetCount: number;
  updatedAssetCount: number;
  providerRequestCount: number;
  estimatedApiUnits: number;
  errorCount: number;
  exclusionReasons: Record<string, number>;
  discoveryRunId: string;
};

export async function universeRefresh(
  database: PrismaClient = prisma,
  providers: AssetDiscoveryProvider[] = createDefaultDiscoveryProviders(),
  now: Date = new Date()
): Promise<UniverseRefreshSummary> {
  const settings = resolveAssetDiscoverySettings();
  const context = await startDiscoveryRun(database, {
    kind: AssetDiscoveryRunKind.UNIVERSE_REFRESH,
    jobName: "assetUniverseRefresh",
    settings,
    now
  });
  const summary: UniverseRefreshSummary = {
    status: BotRunStatus.RUNNING,
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    checkedAssetCount: 0,
    excludedAssetCount: 0,
    candidateCount: 0,
    createdAssetCount: 0,
    updatedAssetCount: 0,
    providerRequestCount: 0,
    estimatedApiUnits: 0,
    errorCount: 0,
    exclusionReasons: {},
    discoveryRunId: context.discoveryRunId
  };

  try {
    if (!settings.enabled) {
      summary.status = BotRunStatus.SUCCESS;
      await finishDiscoveryRun(database, context, {
        status: summary.status,
        metrics: summary
      });
      await writeDiscoveryLog(database, "info", "Universe Refresh sicher deaktiviert", {
        discoveryRunId: context.discoveryRunId,
        dryRun: settings.dryRun
      });
      return summary;
    }

    for (const provider of providers) {
      try {
        const result = await provider.listInstruments();
        summary.providerRequestCount += result.usage.requestCount;
        summary.estimatedApiUnits += result.usage.estimatedApiUnits;
        summary.checkedAssetCount += result.data.length;

        for (const instrument of result.data) {
          const reasons = evaluateInstrumentEligibility(instrument, settings.policy);
          if (reasons.length > 0) {
            summary.excludedAssetCount += 1;
            for (const reason of reasons) {
              summary.exclusionReasons[reason] =
                (summary.exclusionReasons[reason] ?? 0) + 1;
            }
            await updateKnownIneligibleAsset(database, instrument, now);
            continue;
          }

          summary.candidateCount += 1;
          const created = await upsertDiscoveryAsset(
            database,
            instrument,
            context.discoveryRunId,
            settings.policy.version,
            now
          );
          if (created) summary.createdAssetCount += 1;
          else summary.updatedAssetCount += 1;
        }
      } catch (error) {
        summary.errorCount += 1;
        await writeDiscoveryLog(database, "error", "Discovery-Provider Refresh fehlgeschlagen", {
          discoveryRunId: context.discoveryRunId,
          provider: provider.id,
          error: error instanceof Error ? error.message : "Unknown provider error"
        });
      }
    }

    summary.status =
      summary.errorCount === providers.length && providers.length > 0
        ? BotRunStatus.FAILED
        : BotRunStatus.SUCCESS;
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: summary
    });
    await database.assetDiscoveryRun.update({
      where: { id: context.discoveryRunId },
      data: { exclusionReasonsJson: summary.exclusionReasons }
    });
    await writeDiscoveryLog(database, summary.errorCount > 0 ? "warn" : "info", "Universe Refresh abgeschlossen", {
      ...summary
    });
    return summary;
  } catch (error) {
    summary.status = BotRunStatus.FAILED;
    summary.errorCount += 1;
    const message = error instanceof Error ? error.message : "Unknown universe refresh error";
    await finishDiscoveryRun(database, context, {
      status: summary.status,
      metrics: summary,
      error: message
    });
    throw error;
  }
}

async function upsertDiscoveryAsset(
  database: PrismaClient,
  instrument: DiscoveryInstrument,
  discoveryRunId: string,
  policyVersion: string,
  now: Date
) {
  const key = {
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    assetType: toAssetType(instrument.assetType)
  };
  const existing = await database.asset.findUnique({
    where: { symbol_exchange_assetType: key },
    select: { id: true }
  });
  const asset = await database.asset.upsert({
    where: { symbol_exchange_assetType: key },
    create: {
      ...key,
      name: instrument.name,
      baseCurrency: instrument.baseCurrency,
      quoteCurrency: instrument.quoteCurrency,
      currency: instrument.currency,
      sector: instrument.sector,
      industry: instrument.industry,
      provider: instrument.provider,
      providerSymbol: instrument.providerSymbol,
      providerMetadataJson: instrument.metadata as Prisma.InputJsonObject | undefined,
      instrumentStatus: instrument.status,
      isTradable: instrument.tradable,
      isLeveraged: instrument.leveraged,
      isInverse: instrument.inverse,
      isStablecoin: instrument.stablecoin,
      lastUniverseRefreshAt: now,
      isActive: false
    },
    update: {
      name: instrument.name,
      baseCurrency: instrument.baseCurrency,
      quoteCurrency: instrument.quoteCurrency,
      currency: instrument.currency,
      sector: instrument.sector,
      industry: instrument.industry,
      provider: instrument.provider,
      providerSymbol: instrument.providerSymbol,
      providerMetadataJson: instrument.metadata as Prisma.InputJsonObject | undefined,
      instrumentStatus: instrument.status,
      isTradable: instrument.tradable,
      isLeveraged: instrument.leveraged,
      isInverse: instrument.inverse,
      isStablecoin: instrument.stablecoin,
      lastUniverseRefreshAt: now
    },
    select: { id: true }
  });
  await database.assetUniversePreference.upsert({
    where: { assetId: asset.id },
    create: { assetId: asset.id },
    update: {}
  });
  const current = await database.assetUniverseMembership.findFirst({
    where: { assetId: asset.id, isCurrent: true },
    select: { id: true }
  });
  if (!current) {
    await database.assetUniverseMembership.create({
      data: {
        assetId: asset.id,
        role: AssetUniverseRole.DISCOVERY,
        source: AssetUniverseSource.AUTO_DISCOVERED,
        reason: "PROVIDER_UNIVERSE_ELIGIBLE",
        policyVersion,
        discoveryRunId
      }
    });
  }
  return existing === null;
}

async function updateKnownIneligibleAsset(
  database: PrismaClient,
  instrument: DiscoveryInstrument,
  now: Date
) {
  const asset = await database.asset.findUnique({
    where: {
      symbol_exchange_assetType: {
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        assetType: toAssetType(instrument.assetType)
      }
    },
    select: { id: true }
  });
  if (!asset) return;
  await database.asset.update({
    where: { id: asset.id },
    data: {
      instrumentStatus: instrument.status,
      isTradable: instrument.tradable,
      isLeveraged: instrument.leveraged,
      isInverse: instrument.inverse,
      isStablecoin: instrument.stablecoin,
      providerMetadataJson: instrument.metadata as Prisma.InputJsonObject | undefined,
      lastUniverseRefreshAt: now
    }
  });
}

function toAssetType(value: DiscoveryInstrument["assetType"]) {
  if (value === "CRYPTO") return AssetType.CRYPTO;
  if (value === "ETF") return AssetType.ETF;
  return AssetType.STOCK;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await universeRefresh();
  } finally {
    await prisma.$disconnect();
  }
}
