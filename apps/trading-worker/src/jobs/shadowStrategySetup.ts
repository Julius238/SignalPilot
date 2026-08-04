/**
 * Idempotent metadata/setup job for the legacy LONG identity and the explicit
 * LONG/SHORT strategy families. Every assignment is created disabled and no
 * portfolio/session/kill-switch state is changed.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetType,
  BotRunStatus,
  Prisma,
  StrategyStatus,
  StrategyVersionStatus,
  TradingActorType,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
} from "@signalpilot/strategy-engine";
import {
  buildAuditEventKey,
  buildSpecificationHash
} from "@signalpilot/trading-domain";
import { config } from "dotenv";
import pino from "pino";

import {
  checkShadowBootstrapAllowed,
  type TradingFlagSnapshot
} from "../lib/tradingSafety.js";
import { SHADOW_PORTFOLIO_KEY } from "./shadowBootstrap.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowStrategySetup";
export const SHADOW_STRATEGY_SETUP_JOB_KEY = "trading:shadow-strategy-setup";
export const SHADOW_STRATEGY_VERSION = 1;
export const SHADOW_ASSIGNMENT_SYMBOL = "BTCUSDT";
export const SHADOW_ASSIGNMENT_SYMBOLS = Object.freeze([
  "BTCUSDT",
  "ETHUSDT"
] as const);
export const SHADOW_ASSIGNMENT_TIMEFRAME = "1h";

const DEFINITIONS = Object.freeze([
  Object.freeze({
    key: CRYPTO_MTF_BREAKOUT_V1_KEY,
    name: "Crypto MTF Breakout v1 (legacy)",
    description:
      "Legacy deterministic long identity retained for replay compatibility.",
    direction: "LONG" as const,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    parameters: CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    assignmentSymbols: ["BTCUSDT"] as const,
    legacy: true
  }),
  Object.freeze({
    key: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
    name: "Crypto MTF Breakout LONG v1",
    description: "Pinned deterministic BTC/ETH spot-USDT long shadow strategy.",
    direction: "LONG" as const,
    engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
    parameters: CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS,
    specificationHash: CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
    assignmentSymbols: SHADOW_ASSIGNMENT_SYMBOLS,
    legacy: false
  }),
  Object.freeze({
    key: CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    name: "Crypto MTF Breakdown SHORT v1",
    description:
      "Synthetic unleveraged BTC/ETH shadow short; no exchange position or borrowing.",
    direction: "SHORT" as const,
    engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
    parameters: CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
    specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
    assignmentSymbols: SHADOW_ASSIGNMENT_SYMBOLS,
    legacy: false
  })
]);

export interface ShadowStrategySetupEntry {
  readonly strategyKey: string;
  readonly direction: "LONG" | "SHORT";
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly specificationHash: string;
  readonly assignments: readonly {
    readonly symbol: string;
    readonly strategyAssignmentId: string;
    readonly enabled: false;
  }[];
}

export interface ShadowStrategySetupSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  /** Legacy compatibility aliases: the BTC legacy assignment. */
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly strategyAssignmentId: string | null;
  readonly assignmentEnabled: boolean | null;
  readonly specificationHash: string;
  readonly entries: readonly ShadowStrategySetupEntry[];
  readonly createdCount: number;
  readonly existingCount: number;
  readonly flags: TradingFlagSnapshot | null;
}

export interface RunShadowStrategySetupOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly actorId?: string;
  readonly codeVersion?: string;
}

const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export async function runShadowStrategySetup(
  database: PrismaClient = prisma,
  options: RunShadowStrategySetupOptions = {}
): Promise<ShadowStrategySetupSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const actorId = options.actorId ?? "operations-strategy-setup";
  const codeVersion = (
    options.codeVersion ??
    env.TRADING_CODE_VERSION ??
    ""
  ).trim();
  const gate = checkShadowBootstrapAllowed(env);

  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: asJson({
        correlationId,
        strategyKeys: DEFINITIONS.map((definition) => definition.key),
        symbols: SHADOW_ASSIGNMENT_SYMBOLS,
        activation: false
      })
    }
  });

  const blocked = async (
    reasonCode: string,
    message: string
  ): Promise<ShadowStrategySetupSummary> => {
    const summary: ShadowStrategySetupSummary = {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: reasonCode,
      correlationId,
      strategyId: null,
      strategyVersionId: null,
      strategyAssignmentId: null,
      assignmentEnabled: null,
      specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
      entries: [],
      createdCount: 0,
      existingCount: 0,
      flags: gate.flags
    };
    await database.botLog.create({
      data: {
        level: "error",
        service: "trading-worker",
        message: `${JOB_NAME} refused`,
        metadataJson: asJson({
          botRunId: botRun.id,
          correlationId,
          reasonCode,
          message
        })
      }
    });
    await database.botRun.update({
      where: { id: botRun.id },
      data: {
        status: BotRunStatus.FAILED,
        finishedAt: new Date(),
        metadataJson: asJson(summary)
      }
    });
    return summary;
  };

  if (!gate.allowed) return blocked(gate.reasonCode, gate.message);
  if (codeVersion === "") {
    return blocked(
      "TRADING_CODE_VERSION_REQUIRED",
      "TRADING_CODE_VERSION must identify the immutable build."
    );
  }

  const portfolio = await database.portfolio.findUnique({
    where: { key: SHADOW_PORTFOLIO_KEY }
  });
  if (portfolio === null) {
    return blocked(
      "SHADOW_PORTFOLIO_MISSING",
      `${SHADOW_PORTFOLIO_KEY} is missing; run shadow bootstrap first.`
    );
  }
  const assets = await database.asset.findMany({
    where: {
      symbol: { in: [...SHADOW_ASSIGNMENT_SYMBOLS] },
      assetType: AssetType.CRYPTO
    },
    orderBy: { createdAt: "asc" }
  });
  const assetBySymbol = new Map(
    assets.map((asset) => [asset.symbol, asset] as const)
  );
  for (const symbol of SHADOW_ASSIGNMENT_SYMBOLS) {
    if (!assetBySymbol.has(symbol)) {
      return blocked(
        `${symbol}_ASSET_MISSING`,
        `${symbol} CRYPTO asset is missing; run the existing seed first.`
      );
    }
  }

  let createdCount = 0;
  let existingCount = 0;
  const entries: ShadowStrategySetupEntry[] = [];

  for (const definition of DEFINITIONS) {
    const existingStrategy = await database.strategy.findUnique({
      where: { key: definition.key }
    });
    const strategy =
      existingStrategy ??
      (await database.strategy.create({
        data: {
          key: definition.key,
          name: definition.name,
          description: definition.description,
          status: StrategyStatus.ACTIVE
        }
      }));
    if (existingStrategy === null) createdCount += 1;
    else existingCount += 1;
    if (strategy.status !== StrategyStatus.ACTIVE) {
      return blocked(
        "STRATEGY_NOT_ACTIVE",
        `${definition.key} is ${strategy.status}, not ACTIVE.`
      );
    }

    const existingVersion = await database.strategyVersion.findFirst({
      where: { strategyId: strategy.id, version: SHADOW_STRATEGY_VERSION }
    });
    const strategyVersion =
      existingVersion ??
      (await database.strategyVersion.create({
        data: {
          strategyId: strategy.id,
          version: SHADOW_STRATEGY_VERSION,
          status: StrategyVersionStatus.ACTIVE,
          engineVersion: definition.engineVersion,
          codeVersion,
          parametersJson: asJson(definition.parameters),
          specificationHash: definition.specificationHash,
          effectiveFrom: asOf,
          createdBy: actorId,
          approvedBy: actorId,
          approvedAt: asOf
        }
      }));
    if (existingVersion === null) createdCount += 1;
    else existingCount += 1;
    if (
      strategyVersion.status !== StrategyVersionStatus.ACTIVE ||
      strategyVersion.engineVersion !== definition.engineVersion ||
      (!definition.legacy && strategyVersion.codeVersion !== codeVersion) ||
      strategyVersion.specificationHash !== definition.specificationHash ||
      buildSpecificationHash(strategyVersion.parametersJson) !==
        definition.specificationHash
    ) {
      return blocked(
        "STRATEGY_VERSION_CONFLICT",
        `${definition.key} v${SHADOW_STRATEGY_VERSION} does not match its immutable engine, parameters, build or hash.`
      );
    }

    const assignments: ShadowStrategySetupEntry["assignments"][number][] = [];
    for (const symbol of definition.assignmentSymbols) {
      const asset = assetBySymbol.get(symbol)!;
      const existingAssignments = await database.strategyAssignment.findMany({
        where: {
          strategyId: strategy.id,
          portfolioId: portfolio.id,
          assetId: asset.id,
          timeframe: SHADOW_ASSIGNMENT_TIMEFRAME
        },
        orderBy: { createdAt: "asc" }
      });
      if (existingAssignments.length > 1) {
        return blocked(
          "DUPLICATE_ASSIGNMENT",
          `${definition.key}/${symbol} has duplicate assignments.`
        );
      }
      const assignment =
        existingAssignments[0] ??
        (await database.strategyAssignment.create({
          data: {
            strategyId: strategy.id,
            strategyVersionId: strategyVersion.id,
            portfolioId: portfolio.id,
            assetId: asset.id,
            timeframe: SHADOW_ASSIGNMENT_TIMEFRAME,
            enabled: false,
            validFrom: null,
            validTo: null,
            assignmentConfigJson: asJson({
              strategyKey: definition.key,
              direction: definition.direction,
              symbol,
              timeframe: SHADOW_ASSIGNMENT_TIMEFRAME,
              syntheticShadowShort: definition.direction === "SHORT",
              leverageAllowed: false,
              marginAllowed: false,
              futuresAllowed: false
            }),
            activeScopeKey: null,
            createdBy: actorId
          }
        }));
      if (existingAssignments.length === 0) createdCount += 1;
      else existingCount += 1;
      if (
        assignment.strategyVersionId !== strategyVersion.id ||
        assignment.enabled
      ) {
        return blocked(
          assignment.enabled
            ? "ASSIGNMENT_ALREADY_ENABLED"
            : "ASSIGNMENT_VERSION_CONFLICT",
          `${definition.key}/${symbol} must reference the pinned version and remain disabled.`
        );
      }

      const idempotencyKey = buildSpecificationHash({
        portfolioKey: SHADOW_PORTFOLIO_KEY,
        strategyKey: definition.key,
        specificationHash: definition.specificationHash,
        symbol,
        direction: definition.direction
      });
      const eventKey = buildAuditEventKey({
        eventType: "SHADOW_STRATEGY_SETUP_APPLIED",
        aggregateType: "StrategyAssignment",
        aggregateId: assignment.id,
        idempotencyKey
      });
      await database.tradingAuditEvent.upsert({
        where: { eventKey },
        update: {},
        create: {
          eventKey,
          eventType: "SHADOW_STRATEGY_SETUP_APPLIED",
          aggregateType: "StrategyAssignment",
          aggregateId: assignment.id,
          actorType: TradingActorType.ADMIN,
          actorId,
          correlationId,
          causationId: correlationId,
          idempotencyKey,
          reasonCode: "SHADOW_STRATEGY_SETUP_APPLIED",
          afterState: asJson({
            strategyKey: definition.key,
            direction: definition.direction,
            strategyVersionId: strategyVersion.id,
            strategyAssignmentId: assignment.id,
            assignmentEnabled: false,
            symbol,
            syntheticShadowShort: definition.direction === "SHORT"
          }),
          engineVersion: definition.engineVersion,
          codeVersion,
          occurredAt: asOf
        }
      });
      assignments.push({
        symbol,
        strategyAssignmentId: assignment.id,
        enabled: false
      });
    }
    entries.push({
      strategyKey: definition.key,
      direction: definition.direction,
      strategyId: strategy.id,
      strategyVersionId: strategyVersion.id,
      specificationHash: definition.specificationHash,
      assignments
    });
  }

  const legacy = entries.find(
    (entry) => entry.strategyKey === CRYPTO_MTF_BREAKOUT_V1_KEY
  )!;
  const summary: ShadowStrategySetupSummary = {
    status: BotRunStatus.SUCCESS,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    strategyId: legacy.strategyId,
    strategyVersionId: legacy.strategyVersionId,
    strategyAssignmentId: legacy.assignments[0]?.strategyAssignmentId ?? null,
    assignmentEnabled: false,
    specificationHash: legacy.specificationHash,
    entries,
    createdCount,
    existingCount,
    flags: gate.flags
  };
  await database.botRun.update({
    where: { id: botRun.id },
    data: {
      status: BotRunStatus.SUCCESS,
      finishedAt: new Date(),
      metadataJson: asJson(summary)
    }
  });
  await database.botLog.create({
    data: {
      level: "info",
      service: "trading-worker",
      message: `${JOB_NAME} completed without activation`,
      metadataJson: asJson({ botRunId: botRun.id, ...summary })
    }
  });
  return summary;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runShadowStrategySetup()
    .then((summary) => {
      if (summary.blocked) {
        logger.error(
          { reasonCode: summary.blockReasonCode },
          `${SHADOW_STRATEGY_SETUP_JOB_KEY} refused to run`
        );
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${SHADOW_STRATEGY_SETUP_JOB_KEY} completed`);
    })
    .catch((error) => {
      logger.error({ error }, `${SHADOW_STRATEGY_SETUP_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
