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
 *
 * Since ADR 0023 the job writes only the approved profile pinned in
 * `lib/executionProfileIntegrity.ts` — filters included, never copied from
 * the previous row — and verifies its hash before writing. An active row that
 * already is the approved profile stays `UNCHANGED`; any state that cannot
 * become it in one step (a deviating row of the approved version, several
 * active rows) is `REFUSED` without a write.
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

import {
  activeExecutionProfileDeviations,
  currentApprovedExecutionProfile,
  loadActiveExecutionProfile
} from "../lib/executionProfileIntegrity.js";
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
  /**
   * `REFUSED`: the active state cannot become the approved profile in one
   * step (a deviating row of the approved version, several active rows, an
   * unexpected version or an unapproved estimate); nothing is written.
   */
  readonly outcome: "CREATED" | "UNCHANGED" | "REFUSED";
  readonly previousVersion: number | null;
  readonly activeVersion: number;
  readonly profileId: string;
  readonly deviations?: readonly string[];
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
    // The only profile this job may write is the approved one (ADR 0023):
    // its values come from the pinned reference, never from the database.
    const approved = currentApprovedExecutionProfile(symbol);
    const activeProfiles = await loadActiveExecutionProfile(database, asset.id);
    const active = activeProfiles.row;
    if (active === null || approved === null) continue;

    const deviations = activeExecutionProfileDeviations(
      activeProfiles,
      symbol,
      asset.id
    );
    if (deviations.length === 0) {
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
      tickSize: approved.tickSize,
      stepSize: approved.stepSize,
      minQuantity: approved.minQuantity,
      minNotional: approved.minNotional,
      maxQuantity: approved.maxQuantity
    };
    const estimateMatchesApproved =
      estimate.feeBps === approved.feeBps &&
      estimate.fullSpreadBps === approved.fullSpreadBps &&
      estimate.slippageBps === approved.slippageBps &&
      estimate.maxParticipationRate === approved.maxParticipationRate &&
      estimate.source === approved.source;
    const nextVersion = active.version + 1;
    if (
      activeProfiles.activeCount !== 1 ||
      nextVersion !== approved.version ||
      !estimateMatchesApproved ||
      buildSpecificationHash({ symbol, version: nextVersion, ...instrument, ...estimate }) !==
        approved.specificationHash
    ) {
      results.push({
        symbol,
        outcome: "REFUSED",
        previousVersion: active.version,
        activeVersion: active.version,
        profileId: active.id,
        deviations: [...deviations]
      });
      continue;
    }

    const version = nextVersion;
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
          specificationHash: approved.specificationHash,
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

  const refused = results.some((result) => result.outcome === "REFUSED");
  const status = refused ? BotRunStatus.FAILED : BotRunStatus.SUCCESS;
  const summary: CalibrationSummary = {
    status,
    blocked: false,
    blockReasonCode: refused ? "EXECUTION_PROFILE_CONFLICT" : null,
    estimate: estimateKey,
    results
  };
  await database.botRun.update({
    where: { id: botRun.id },
    data: { status, finishedAt: new Date(), metadataJson: asJson(summary) }
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
