/**
 * Execution cost calibration (operator step, shadow only):
 *
 *   TRADING_BOOTSTRAP_ENABLED=true pnpm --filter @signalpilot/trading-worker \
 *     shadow:calibrate-execution-profile --confirm=CALIBRATE_EXECUTION_PROFILE
 *
 * The bootstrap seeds every instrument with a deliberately pessimistic
 * placeholder (`MANUAL_CONSERVATIVE_V1`: 10 bp fee, 10 bp spread, 10 bp
 * slippage). With those costs the risk engine's net 2R minimum (R-008)
 * requires a stop of at least ~3.01 % — above the strategy's own 3 % stop cap
 * — so no long candidate can ever be approved. This job replaces the
 * placeholder with a documented estimate as a NEW immutable profile version;
 * it never edits the version that earlier orders were decided with, and it
 * changes no risk limit.
 *
 * `BINANCE_SPOT_VIP0_ESTIMATE_V1`:
 *   - fee 10 bp: Binance spot taker fee at the base (VIP 0) tier without the
 *     BNB discount — the highest fee a regular account pays;
 *   - full spread 2 bp: BTCUSDT/ETHUSDT trade with a one-tick (0.01 USDT)
 *     spread almost always, i.e. well below 0.01 bp at current prices; 2 bp
 *     is a deliberate cushion for thin moments;
 *   - slippage 3 bp: the shadow orders are a few hundred USDT, orders of
 *     magnitude below top-of-book depth; 3 bp again is a cushion.
 * With these costs R-008 needs a stop of at least ~1.68 % for a 2.5R target.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetType,
  BotRunStatus,
  InstrumentExecutionProfileStatus,
  TradingActorType,
  prisma,
  type Prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  buildActiveExecutionProfileKey,
  buildAuditEventKey,
  buildSpecificationHash
} from "@signalpilot/trading-domain";
import { config } from "dotenv";
import pino from "pino";

import { checkShadowBootstrapAllowed } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowExecutionProfileCalibrate";
export const CALIBRATION_CONFIRMATION = "CALIBRATE_EXECUTION_PROFILE";

export const EXECUTION_COST_ESTIMATES = Object.freeze({
  BINANCE_SPOT_VIP0_ESTIMATE_V1: Object.freeze({
    feeBps: 10,
    fullSpreadBps: 2,
    slippageBps: 3,
    maxParticipationRate: "0.010000000000",
    source: "BINANCE_SPOT_VIP0_ESTIMATE_V1"
  })
});
export type ExecutionCostEstimateKey = keyof typeof EXECUTION_COST_ESTIMATES;

const CALIBRATED_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

export interface CalibrationSymbolResult {
  readonly symbol: string;
  readonly outcome: "CREATED" | "UNCHANGED";
  readonly previousVersion: number | null;
  readonly activeVersion: number;
  readonly profileId: string;
}

export interface CalibrationSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly estimate: ExecutionCostEstimateKey;
  readonly results: readonly CalibrationSymbolResult[];
}

export interface CalibrationOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly confirmation?: string;
  readonly estimate?: ExecutionCostEstimateKey;
  readonly actorId?: string;
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export async function runExecutionProfileCalibration(
  database: PrismaClient = prisma,
  options: CalibrationOptions = {}
): Promise<CalibrationSummary> {
  const asOf = options.asOf ?? new Date();
  const env = options.env ?? process.env;
  const estimateKey = options.estimate ?? "BINANCE_SPOT_VIP0_ESTIMATE_V1";
  const estimate = EXECUTION_COST_ESTIMATES[estimateKey];
  const actorId = options.actorId ?? "operations-execution-profile";
  const correlationId = randomUUID();
  const codeVersion = (env.TRADING_CODE_VERSION ?? "").trim() || null;

  const refuse = (reasonCode: string): CalibrationSummary => ({
    status: BotRunStatus.FAILED,
    blocked: true,
    blockReasonCode: reasonCode,
    estimate: estimateKey,
    results: []
  });
  const gate = checkShadowBootstrapAllowed(env);
  if (!gate.allowed) return refuse(gate.reasonCode);
  if (options.confirmation !== CALIBRATION_CONFIRMATION) return refuse("CONFIRMATION_REQUIRED");

  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: asJson({ correlationId, estimate: estimateKey })
    }
  });

  const results: CalibrationSymbolResult[] = [];
  for (const symbol of CALIBRATED_SYMBOLS) {
    const asset = await database.asset.findFirst({
      where: { symbol, assetType: AssetType.CRYPTO },
      orderBy: { createdAt: "asc" }
    });
    if (asset === null) continue;
    const active = await database.instrumentExecutionProfile.findFirst({
      where: { assetId: asset.id, status: InstrumentExecutionProfileStatus.ACTIVE },
      orderBy: { version: "desc" }
    });
    if (active === null) continue;

    if (
      active.feeBps === estimate.feeBps &&
      active.fullSpreadBps === estimate.fullSpreadBps &&
      active.slippageBps === estimate.slippageBps &&
      active.source === estimate.source
    ) {
      results.push({
        symbol,
        outcome: "UNCHANGED",
        previousVersion: null,
        activeVersion: active.version,
        profileId: active.id
      });
      continue;
    }

    const instrument = {
      tickSize: active.tickSize.toFixed(12),
      stepSize: active.stepSize.toFixed(12),
      minQuantity: active.minQuantity.toFixed(12),
      minNotional: active.minNotional.toFixed(12),
      maxQuantity: active.maxQuantity === null ? null : active.maxQuantity.toFixed(12)
    };
    const version = active.version + 1;
    const created = await database.$transaction(async (tx) => {
      const retired = await tx.instrumentExecutionProfile.updateMany({
        where: { id: active.id, status: InstrumentExecutionProfileStatus.ACTIVE },
        data: {
          status: InstrumentExecutionProfileStatus.RETIRED,
          activeAssetKey: null,
          effectiveTo: asOf
        }
      });
      if (retired.count !== 1) throw new Error(`${symbol} profile changed concurrently.`);
      const profile = await tx.instrumentExecutionProfile.create({
        data: {
          assetId: asset.id,
          version,
          status: InstrumentExecutionProfileStatus.ACTIVE,
          ...instrument,
          feeBps: estimate.feeBps,
          fullSpreadBps: estimate.fullSpreadBps,
          slippageBps: estimate.slippageBps,
          maxParticipationRate: estimate.maxParticipationRate,
          source: estimate.source,
          sourceObservedAt: asOf,
          specificationHash: buildSpecificationHash({ symbol, version, ...instrument, ...estimate }),
          activeAssetKey: buildActiveExecutionProfileKey({ assetId: asset.id }),
          effectiveFrom: asOf
        }
      });
      const idempotencyKey = buildSpecificationHash({ from: active.id, to: version, estimate: estimateKey });
      const eventKey = buildAuditEventKey({
        eventType: "EXECUTION_PROFILE_CALIBRATED",
        aggregateType: "InstrumentExecutionProfile",
        aggregateId: profile.id,
        idempotencyKey
      });
      await tx.tradingAuditEvent.create({
        data: {
          eventKey,
          eventType: "EXECUTION_PROFILE_CALIBRATED",
          aggregateType: "InstrumentExecutionProfile",
          aggregateId: profile.id,
          actorType: TradingActorType.ADMIN,
          actorId,
          correlationId,
          causationId: correlationId,
          idempotencyKey,
          reasonCode: "EXECUTION_COST_ESTIMATE_APPLIED",
          beforeState: asJson({
            profileId: active.id,
            version: active.version,
            feeBps: active.feeBps,
            fullSpreadBps: active.fullSpreadBps,
            slippageBps: active.slippageBps,
            source: active.source
          }),
          afterState: asJson({ profileId: profile.id, version, ...estimate }),
          codeVersion,
          occurredAt: asOf
        }
      });
      return profile;
    });
    results.push({
      symbol,
      outcome: "CREATED",
      previousVersion: active.version,
      activeVersion: version,
      profileId: created.id
    });
  }

  const summary: CalibrationSummary = {
    status: BotRunStatus.SUCCESS,
    blocked: false,
    blockReasonCode: null,
    estimate: estimateKey,
    results
  };
  await database.botRun.update({
    where: { id: botRun.id },
    data: { status: BotRunStatus.SUCCESS, finishedAt: new Date(), metadataJson: asJson(summary) }
  });
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
  runExecutionProfileCalibration(prisma, { confirmation })
    .then((summary) => {
      if (summary.blocked) {
        logger.error({ reasonCode: summary.blockReasonCode }, `${JOB_NAME} refused`);
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${JOB_NAME} completed`);
    })
    .catch((error) => {
      logger.error({ error }, `${JOB_NAME} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
