/**
 * One-off, idempotent operations bootstrap for shadow trading.
 *
 * Specification:
 *   docs/trading/03-domain-model.md (Portfolio, RiskLimitSet,
 *     InstrumentExecutionProfile, TradingSession, PortfolioLedgerEntry)
 *   docs/trading/06-risk-engine-specification.md, "Verbindliches Limitset v1"
 *   docs/trading/decisions/0006-fail-closed-session-and-kill-switch.md
 *
 * Creates the structures the risk engine needs and nothing else:
 *
 *   - a shadow portfolio funded with 10 000 USDT plus its `INITIAL_CASH`
 *     ledger entry and the matching opening snapshot;
 *   - the pinned `RiskLimitSet` v1;
 *   - a conservative `InstrumentExecutionProfile` for BTCUSDT and ETHUSDT;
 *   - a `TradingSession` in `STOPPED` with the kill switch engaged.
 *
 * It never creates a `StrategyAssignment`, never activates a session, never
 * releases the kill switch and never starts anything. The portfolio stays
 * `DRAFT` unless the operator explicitly asks for activation, so the default
 * run leaves the system unable to approve a trade.
 */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BotRunStatus,
  InstrumentExecutionProfileStatus,
  PortfolioLedgerEntryType,
  PortfolioStatus,
  Prisma,
  RiskLimitScope,
  RiskLimitSetStatus,
  TradingActorType,
  TradingSessionMode,
  TradingSessionStatus,
  prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  RISK_LIMIT_SET_KEY,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RISK_LIMIT_SET_VERSION
} from "@signalpilot/risk-engine";
import {
  buildActiveExecutionProfileKey,
  buildActiveRiskLimitSetKey,
  buildActiveSessionScopeKey,
  buildAuditEventKey,
  buildLedgerEntryKey,
  buildSessionKey,
  buildSpecificationHash
} from "@signalpilot/trading-domain";
import { config } from "dotenv";
import pino from "pino";

import { checkShadowBootstrapAllowed, type TradingFlagSnapshot } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowBootstrap";
export const BOOTSTRAP_JOB_KEY = "trading:shadow-bootstrap";

export const SHADOW_PORTFOLIO_KEY = "SHADOW_V1";
export const SHADOW_PORTFOLIO_STARTING_CASH = "10000.000000000000";
export const BOOTSTRAP_SYMBOLS: readonly string[] = ["BTCUSDT", "ETHUSDT"];

/**
 * Conservative, modelled execution parameters. Fee and participation rate are
 * the values docs/trading/07 pins; spread and slippage are operations choices
 * well below the `R-018`/`R-019` caps of 20 bp and 15 bp. None of these is a
 * measured venue value, which is why the source is recorded as modelled.
 */
export const BOOTSTRAP_EXECUTION_PROFILES: Readonly<
  Record<string, {
    readonly tickSize: string;
    readonly stepSize: string;
    readonly minQuantity: string;
    readonly minNotional: string;
    readonly maxQuantity: string | null;
  }>
> = Object.freeze({
  BTCUSDT: {
    tickSize: "0.010000000000",
    stepSize: "0.000010000000",
    minQuantity: "0.000010000000",
    minNotional: "10.000000000000",
    maxQuantity: null
  },
  ETHUSDT: {
    tickSize: "0.010000000000",
    stepSize: "0.000100000000",
    minQuantity: "0.000100000000",
    minNotional: "10.000000000000",
    maxQuantity: null
  }
});

const EXECUTION_PROFILE_COMMON = Object.freeze({
  feeBps: 10,
  fullSpreadBps: 10,
  slippageBps: 10,
  maxParticipationRate: "0.010000000000",
  source: "MANUAL_CONSERVATIVE_V1"
});

export interface ShadowBootstrapSummary {
  readonly status: BotRunStatus;
  readonly blocked: boolean;
  readonly blockReasonCode: string | null;
  readonly correlationId: string;
  readonly portfolioId: string | null;
  readonly portfolioStatus: string | null;
  readonly riskLimitSetId: string | null;
  readonly executionProfileIds: readonly string[];
  readonly tradingSessionId: string | null;
  readonly createdCount: number;
  readonly existingCount: number;
  readonly flags: TradingFlagSnapshot | null;
}

export interface RunShadowBootstrapOptions {
  readonly asOf?: Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly correlationId?: string;
  readonly codeVersion?: string;
  /**
   * Opt-in portfolio activation. Off by default so a plain bootstrap leaves the
   * portfolio in `DRAFT` and the risk engine keeps refusing with
   * `PORTFOLIO_NOT_ACTIVE` (docs/trading/02, safe defaults).
   */
  readonly activatePortfolio?: boolean;
  readonly actorId?: string;
}

type Json = Prisma.InputJsonValue;
const asJson = (value: unknown): Json => value as Json;

export async function runShadowBootstrap(
  database: PrismaClient = prisma,
  options: RunShadowBootstrapOptions = {}
): Promise<ShadowBootstrapSummary> {
  const env = options.env ?? process.env;
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? randomUUID();
  const codeVersion = options.codeVersion ?? env.TRADING_CODE_VERSION ?? "unversioned-local-build";
  const actorId = options.actorId ?? "operations-bootstrap";
  const activatePortfolio = options.activatePortfolio === true;

  const gate = checkShadowBootstrapAllowed(env);
  const botRun = await database.botRun.create({
    data: {
      jobName: JOB_NAME,
      status: BotRunStatus.RUNNING,
      startedAt: new Date(),
      metadataJson: {
        correlationId,
        asOf: asOf.toISOString(),
        activatePortfolio,
        symbols: [...BOOTSTRAP_SYMBOLS]
      } as Prisma.InputJsonObject
    }
  });

  if (!gate.allowed) {
    const summary: ShadowBootstrapSummary = {
      status: BotRunStatus.FAILED,
      blocked: true,
      blockReasonCode: gate.reasonCode,
      correlationId,
      portfolioId: null,
      portfolioStatus: null,
      riskLimitSetId: null,
      executionProfileIds: [],
      tradingSessionId: null,
      createdCount: 0,
      existingCount: 0,
      flags: gate.flags
    };
    await writeBotLog(database, "warn", `${JOB_NAME} blocked by safety configuration`, {
      botRunId: botRun.id,
      reasonCode: gate.reasonCode,
      message: gate.message
    });
    await finishBotRun(database, botRun.id, BotRunStatus.FAILED, { ...summary, message: gate.message });
    return summary;
  }

  let created = 0;
  let existing = 0;

  // ── Portfolio ────────────────────────────────────────────────────────────
  const existingPortfolio = await database.portfolio.findUnique({
    where: { key: SHADOW_PORTFOLIO_KEY }
  });
  const portfolio =
    existingPortfolio ??
    (await database.portfolio.create({
      data: {
        key: SHADOW_PORTFOLIO_KEY,
        name: "SignalPilot Shadow Portfolio v1",
        baseCurrency: "USDT",
        status: activatePortfolio ? PortfolioStatus.ACTIVE : PortfolioStatus.DRAFT,
        startingCash: SHADOW_PORTFOLIO_STARTING_CASH,
        availableCash: SHADOW_PORTFOLIO_STARTING_CASH,
        reservedCash: "0",
        realizedPnl: "0",
        feesPaid: "0",
        equity: SHADOW_PORTFOLIO_STARTING_CASH,
        highWaterMark: SHADOW_PORTFOLIO_STARTING_CASH,
        ledgerSequence: 1,
        lastReconciledAt: asOf
      }
    }));
  if (existingPortfolio === null) created += 1;
  else existing += 1;

  // Opening balance as an append-only ledger entry, so R-003's ledger replay
  // matches the portfolio caches from the very first assessment.
  const ledgerKey = buildLedgerEntryKey({
    portfolioId: portfolio.id,
    type: PortfolioLedgerEntryType.INITIAL_CASH,
    causeType: "Bootstrap",
    causeId: portfolio.id
  });
  await database.portfolioLedgerEntry.upsert({
    where: { entryKey: ledgerKey },
    update: {},
    create: {
      entryKey: ledgerKey,
      portfolioId: portfolio.id,
      sequence: 1,
      type: PortfolioLedgerEntryType.INITIAL_CASH,
      availableCashDelta: SHADOW_PORTFOLIO_STARTING_CASH,
      reservedCashDelta: "0",
      realizedPnlDelta: "0",
      feeDelta: "0",
      balanceAfterJson: asJson({
        availableCash: SHADOW_PORTFOLIO_STARTING_CASH,
        reservedCash: "0.000000000000",
        equity: SHADOW_PORTFOLIO_STARTING_CASH
      }),
      occurredAt: asOf
    }
  });

  // Opening projection so R-010 has a start-of-day equity to compare against.
  const tradingDateUtc = new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const snapshotExists = await database.portfolioSnapshot.findFirst({
    where: { portfolioId: portfolio.id, tradingDateUtc }
  });
  if (snapshotExists === null) {
    await database.portfolioSnapshot.create({
      data: {
        portfolioId: portfolio.id,
        asOf,
        tradingDateUtc,
        sourceLedgerSequence: 1,
        availableCash: SHADOW_PORTFOLIO_STARTING_CASH,
        reservedCash: "0",
        marketValue: "0",
        equity: SHADOW_PORTFOLIO_STARTING_CASH,
        realizedPnl: "0",
        unrealizedPnl: "0",
        feesPaid: "0",
        dailyPnl: "0",
        highWaterMark: SHADOW_PORTFOLIO_STARTING_CASH,
        drawdownAmount: "0",
        drawdownPct: "0",
        grossExposure: "0",
        openPositionCount: 0,
        valuationJson: asJson({ positions: [], source: BOOTSTRAP_JOB_KEY }),
        inputHash: buildSpecificationHash({
          portfolioId: portfolio.id,
          sourceLedgerSequence: 1,
          equity: SHADOW_PORTFOLIO_STARTING_CASH
        })
      }
    });
  }

  // ── Risk limit set ───────────────────────────────────────────────────────
  const existingLimitSet = await database.riskLimitSet.findFirst({
    where: { key: RISK_LIMIT_SET_KEY, version: RISK_LIMIT_SET_VERSION }
  });
  const riskLimitSet =
    existingLimitSet ??
    (await database.riskLimitSet.create({
      data: {
        key: RISK_LIMIT_SET_KEY,
        version: RISK_LIMIT_SET_VERSION,
        status: RiskLimitSetStatus.ACTIVE,
        scope: RiskLimitScope.PORTFOLIO,
        maxRiskPerTradePct: RISK_LIMIT_SET_V1.maxRiskPerTradePct,
        maxDailyLossPct: RISK_LIMIT_SET_V1.maxDailyLossPct,
        minRewardRisk: RISK_LIMIT_SET_V1.minRewardRisk,
        maxOpenPositions: RISK_LIMIT_SET_V1.maxOpenPositions,
        maxNewTradesPerDay: RISK_LIMIT_SET_V1.maxNewTradesPerDay,
        maxConsecutiveLosses: RISK_LIMIT_SET_V1.maxConsecutiveLosses,
        maxGrossExposurePct: RISK_LIMIT_SET_V1.maxGrossExposurePct,
        maxAssetExposurePct: RISK_LIMIT_SET_V1.maxAssetExposurePct,
        maxCorrelatedExposurePct: RISK_LIMIT_SET_V1.maxCorrelatedExposurePct,
        maxSpreadBps: RISK_LIMIT_SET_V1.maxSpreadBps,
        maxSlippageBps: RISK_LIMIT_SET_V1.maxSlippageBps,
        parametersJson: asJson(RISK_LIMIT_SET_V1),
        specificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH,
        activeScopeKey: buildActiveRiskLimitSetKey({ scope: RiskLimitScope.PORTFOLIO }),
        effectiveFrom: asOf,
        createdBy: actorId,
        approvedBy: actorId,
        approvedAt: asOf
      }
    }));
  if (existingLimitSet === null) created += 1;
  else existing += 1;

  // ── Execution profiles ───────────────────────────────────────────────────
  const executionProfileIds: string[] = [];
  for (const symbol of BOOTSTRAP_SYMBOLS) {
    const asset = await database.asset.findFirst({
      where: { symbol, assetType: "CRYPTO" },
      orderBy: { createdAt: "asc" }
    });
    if (asset === null) {
      await writeBotLog(database, "warn", `${JOB_NAME} skipped an execution profile`, {
        botRunId: botRun.id,
        symbol,
        reason: "ASSET_RECORD_MISSING"
      });
      continue;
    }

    const parameters = BOOTSTRAP_EXECUTION_PROFILES[symbol];
    const existingProfile = await database.instrumentExecutionProfile.findFirst({
      where: { assetId: asset.id, version: 1 }
    });
    const profile =
      existingProfile ??
      (await database.instrumentExecutionProfile.create({
        data: {
          assetId: asset.id,
          version: 1,
          status: InstrumentExecutionProfileStatus.ACTIVE,
          tickSize: parameters.tickSize,
          stepSize: parameters.stepSize,
          minQuantity: parameters.minQuantity,
          minNotional: parameters.minNotional,
          maxQuantity: parameters.maxQuantity,
          feeBps: EXECUTION_PROFILE_COMMON.feeBps,
          fullSpreadBps: EXECUTION_PROFILE_COMMON.fullSpreadBps,
          slippageBps: EXECUTION_PROFILE_COMMON.slippageBps,
          maxParticipationRate: EXECUTION_PROFILE_COMMON.maxParticipationRate,
          source: EXECUTION_PROFILE_COMMON.source,
          sourceObservedAt: asOf,
          specificationHash: buildSpecificationHash({
            symbol,
            version: 1,
            ...parameters,
            ...EXECUTION_PROFILE_COMMON
          }),
          activeAssetKey: buildActiveExecutionProfileKey({ assetId: asset.id }),
          effectiveFrom: asOf
        }
      }));
    executionProfileIds.push(profile.id);
    if (existingProfile === null) created += 1;
    else existing += 1;
  }

  // ── Trading session: stopped, kill switch engaged ────────────────────────
  const sessionKey = buildSessionKey({ portfolioId: portfolio.id, sequence: 1 });
  const existingSession = await database.tradingSession.findUnique({ where: { sessionKey } });
  const session =
    existingSession ??
    (await database.tradingSession.create({
      data: {
        sessionKey,
        portfolioId: portfolio.id,
        mode: TradingSessionMode.SHADOW,
        status: TradingSessionStatus.STOPPED,
        killSwitchEngaged: true,
        activePortfolioKey: buildActiveSessionScopeKey({ portfolioId: portfolio.id }),
        lastChangedBy: actorId
      }
    }));
  if (existingSession === null) created += 1;
  else existing += 1;

  // ── Audit ────────────────────────────────────────────────────────────────
  const auditKey = buildAuditEventKey({
    eventType: "SHADOW_BOOTSTRAP_APPLIED",
    aggregateType: "Portfolio",
    aggregateId: portfolio.id,
    idempotencyKey: buildSpecificationHash({
      portfolioKey: SHADOW_PORTFOLIO_KEY,
      riskLimitSetKey: RISK_LIMIT_SET_KEY,
      riskLimitSetVersion: RISK_LIMIT_SET_VERSION,
      symbols: [...BOOTSTRAP_SYMBOLS]
    })
  });
  await database.tradingAuditEvent.upsert({
    where: { eventKey: auditKey },
    update: {},
    create: {
      eventKey: auditKey,
      eventType: "SHADOW_BOOTSTRAP_APPLIED",
      aggregateType: "Portfolio",
      aggregateId: portfolio.id,
      actorType: TradingActorType.ADMIN,
      actorId,
      correlationId,
      causationId: correlationId,
      idempotencyKey: auditKey,
      reasonCode: "SHADOW_BOOTSTRAP_APPLIED",
      afterState: asJson({
        portfolioId: portfolio.id,
        portfolioStatus: portfolio.status,
        startingCash: SHADOW_PORTFOLIO_STARTING_CASH,
        riskLimitSetId: riskLimitSet.id,
        riskLimitSetSpecificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH,
        executionProfileIds,
        tradingSessionId: session.id,
        sessionStatus: TradingSessionStatus.STOPPED,
        killSwitchEngaged: true
      }),
      metadataJson: asJson({ jobKey: BOOTSTRAP_JOB_KEY, activatePortfolio, createdCount: created }),
      codeVersion,
      occurredAt: asOf
    }
  });

  const summary: ShadowBootstrapSummary = {
    status: BotRunStatus.SUCCESS,
    blocked: false,
    blockReasonCode: null,
    correlationId,
    portfolioId: portfolio.id,
    portfolioStatus: portfolio.status,
    riskLimitSetId: riskLimitSet.id,
    executionProfileIds,
    tradingSessionId: session.id,
    createdCount: created,
    existingCount: existing,
    flags: gate.flags
  };

  await finishBotRun(database, botRun.id, BotRunStatus.SUCCESS, { ...summary });
  await writeBotLog(database, "info", `${JOB_NAME} finished`, { botRunId: botRun.id, ...summary });
  return summary;
}

async function finishBotRun(
  database: PrismaClient,
  botRunId: string,
  status: BotRunStatus,
  metadataJson: Record<string, unknown>
): Promise<void> {
  await database.botRun.update({
    where: { id: botRunId },
    data: { status, finishedAt: new Date(), metadataJson: metadataJson as Prisma.InputJsonObject }
  });
}

async function writeBotLog(
  database: PrismaClient,
  level: "info" | "warn" | "error",
  message: string,
  metadataJson: Record<string, unknown>
): Promise<void> {
  await database.botLog.create({
    data: { level, service: "worker", message, metadataJson: metadataJson as Prisma.InputJsonObject }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runShadowBootstrap(prisma, { activatePortfolio: process.argv.includes("--activate-portfolio") })
    .then((summary) => {
      if (summary.blocked) {
        logger.error(
          { reasonCode: summary.blockReasonCode },
          `${BOOTSTRAP_JOB_KEY} refused to run: safety configuration is not shadow-enabled`
        );
        process.exitCode = 1;
        return;
      }
      logger.info(summary, `${BOOTSTRAP_JOB_KEY} completed`);
    })
    .catch((error) => {
      logger.error({ error }, `${BOOTSTRAP_JOB_KEY} failed`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
