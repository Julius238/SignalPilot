/**
 * Assembles a `RiskInputSnapshotV1` from persisted shadow trading state.
 *
 * Specification:
 *   docs/trading/06-risk-engine-specification.md, "Vertrag"
 *   docs/trading/02-shadow-trading-target-architecture.md, "Datenfluss v1" step 5
 *
 * Only this module talks to the database for the risk path; it writes nothing
 * and makes no business judgement. Every threshold lives in the pure engine so
 * the same snapshot always yields the same verdict.
 *
 * Safety-critical values come from typed columns. Nothing is read out of
 * `TradingAuditEvent.afterState` or any other untyped JSON payload.
 */

import { Prisma, type PrismaClient } from "@signalpilot/database";
import {
  CRYPTO_MAJOR_GROUP_KEY,
  CRYPTO_MAJOR_MEMBERS,
  RISK_COST_POLICY_VERSION,
  RISK_ENGINE_VERSION,
  RISK_INPUT_SNAPSHOT_VERSION,
  RISK_RULE_SET_VERSION,
  RISK_SIZING_POLICY_VERSION,
  type RiskInputSnapshotV1
} from "@signalpilot/risk-engine";

export const RISK_INPUT_ASSEMBLER_VERSION = "risk-input-assembler-v1/1.0.0";

/** Statuses that still tie up capital (docs/trading/06, `R-011`). */
const EXPOSURE_POSITION_STATUSES = ["OPENING", "OPEN", "PARTIALLY_CLOSED", "ERROR"] as const;
/** Order statuses that still hold a reservation. */
const RESERVING_ORDER_STATUSES = ["ACCEPTED", "WAITING_FOR_ENTRY", "PARTIALLY_FILLED"] as const;

export const AssemblerReasonCode = {
  CANDIDATE_NOT_FOUND: "CANDIDATE_NOT_FOUND",
  PORTFOLIO_NOT_FOUND: "PORTFOLIO_NOT_FOUND"
} as const;
export type AssemblerReasonCode = (typeof AssemblerReasonCode)[keyof typeof AssemblerReasonCode];

export interface AssembleRiskInputOptions {
  readonly tradeCandidateId: string;
  readonly asOf: Date;
  readonly codeVersion: string;
  readonly capability: {
    readonly buildCapability: string;
    readonly tradingMode: string;
    readonly enableLiveTrading: boolean;
    readonly shadowMasterFlagEnabled: boolean;
    readonly riskJobEnabled: boolean;
  };
}

export type AssembleRiskInputResult =
  | { readonly ok: true; readonly snapshot: RiskInputSnapshotV1 }
  | { readonly ok: false; readonly reasonCode: AssemblerReasonCode; readonly message: string };

// ───────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ───────────────────────────────────────────────────────────────────────────

function decimalString(value: unknown): string {
  if (value instanceof Prisma.Decimal) return value.toFixed(12);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  ) {
    return (value as { toFixed: (digits: number) => string }).toFixed(12);
  }
  if (typeof value === "number") return value.toFixed(12);
  return "0.000000000000";
}

const nullableDecimal = (value: unknown): string | null =>
  value === null || value === undefined ? null : decimalString(value);

const iso = (value: Date): string => value.toISOString();
const nullableIso = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toISOString();

const ageMs = (asOf: Date, at: Date | null | undefined): number | null =>
  at === null || at === undefined ? null : asOf.getTime() - at.getTime();

const utcDate = (value: Date): string => value.toISOString().slice(0, 10);

const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

// ───────────────────────────────────────────────────────────────────────────
// Assembly
// ───────────────────────────────────────────────────────────────────────────

export async function assembleRiskInput(
  database: PrismaClient,
  options: AssembleRiskInputOptions
): Promise<AssembleRiskInputResult> {
  const { tradeCandidateId, asOf, codeVersion, capability } = options;

  const candidate = await database.tradeCandidate.findUnique({
    where: { id: tradeCandidateId },
    include: {
      asset: true,
      strategyVersion: true,
      strategyAssignment: { include: { strategy: { select: { key: true } } } },
      decision: { select: { id: true } }
    }
  });
  if (candidate === null) {
    return {
      ok: false,
      reasonCode: AssemblerReasonCode.CANDIDATE_NOT_FOUND,
      message: `No TradeCandidate ${tradeCandidateId}.`
    };
  }

  const portfolio = await database.portfolio.findUnique({ where: { id: candidate.portfolioId } });
  if (portfolio === null) {
    return {
      ok: false,
      reasonCode: AssemblerReasonCode.PORTFOLIO_NOT_FOUND,
      message: `No Portfolio ${candidate.portfolioId}.`
    };
  }

  const dayStart = startOfUtcDay(asOf);

  const [
    session,
    ledgerAggregate,
    ledgerCount,
    lastLedgerEntry,
    startOfDaySnapshot,
    positions,
    reservingOrders,
    executionProfile,
    riskLimitSet,
    marketRegime,
    existingAssessment,
    previousApproval
  ] = await Promise.all([
    database.tradingSession.findFirst({
      where: { portfolioId: portfolio.id, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" }
    }),
    database.portfolioLedgerEntry.aggregate({
      where: { portfolioId: portfolio.id },
      _sum: {
        availableCashDelta: true,
        reservedCashDelta: true,
        realizedPnlDelta: true,
        feeDelta: true
      }
    }),
    database.portfolioLedgerEntry.count({ where: { portfolioId: portfolio.id } }),
    database.portfolioLedgerEntry.findFirst({
      where: { portfolioId: portfolio.id },
      orderBy: { sequence: "desc" },
      select: { sequence: true }
    }),
    database.portfolioSnapshot.findFirst({
      where: { portfolioId: portfolio.id, tradingDateUtc: dayStart },
      orderBy: { asOf: "asc" }
    }),
    database.shadowPosition.findMany({
      where: { portfolioId: portfolio.id, status: { in: [...EXPOSURE_POSITION_STATUSES] } },
      include: { asset: { select: { symbol: true } } }
    }),
    database.shadowOrder.findMany({
      where: { portfolioId: portfolio.id, status: { in: [...RESERVING_ORDER_STATUSES] } },
      include: { asset: { select: { symbol: true } } }
    }),
    database.instrumentExecutionProfile.findFirst({
      where: { assetId: candidate.assetId, status: "ACTIVE" },
      orderBy: { version: "desc" }
    }),
    database.riskLimitSet.findFirst({
      where: { status: "ACTIVE", scope: "PORTFOLIO" },
      orderBy: { version: "desc" }
    }),
    database.marketRegimeSnapshot.findFirst({
      where: { generatedAt: { lte: asOf } },
      orderBy: { generatedAt: "desc" }
    }),
    database.riskAssessment.findFirst({
      where: { tradeCandidateId: candidate.id },
      orderBy: { assessedAt: "desc" },
      select: { assessmentKey: true, inputHash: true, status: true }
    }),
    database.riskAssessment.findFirst({
      where: { portfolioId: portfolio.id, status: "PASS" },
      orderBy: { assessedAt: "desc" },
      select: { assessedAt: true, equity: true, riskAmount: true }
    })
  ]);

  const [candleFreshness, dataQuality, dailyCounters] = await Promise.all([
    loadCandleFreshness(database, candidate.assetId, asOf),
    loadDataQuality(database, candidate.assetId, asOf),
    loadDailyCounters(database, portfolio.id, dayStart, asOf)
  ]);

  const equity = decimalString(portfolio.equity);
  const startOfDayEquity =
    startOfDaySnapshot === null ? null : decimalString(startOfDaySnapshot.equity);
  const dailyPnl =
    startOfDayEquity === null
      ? "0.000000000000"
      : subtractDecimalStrings(equity, startOfDayEquity);

  const snapshot: RiskInputSnapshotV1 = {
    snapshotVersion: RISK_INPUT_SNAPSHOT_VERSION,
    asOf: iso(asOf),
    tradingDateUtc: utcDate(asOf),
    capability,
    candidate: {
      id: candidate.id,
      candidateKey: candidate.candidateKey,
      status: candidate.status,
      direction: candidate.direction,
      entryType: candidate.entryType,
      symbol: candidate.asset.symbol,
      assetId: candidate.assetId,
      portfolioId: candidate.portfolioId,
      strategyAssignmentId: candidate.strategyAssignmentId,
      strategyVersionId: candidate.strategyVersionId,
      strategyVersionStatus: candidate.strategyVersion.status,
      strategyKey: candidate.strategyAssignment.strategy.key,
      assignmentEnabled: candidate.strategyAssignment.enabled,
      anchorCandleId: candidate.anchorCandleId,
      referenceEntryPrice: decimalString(candidate.referenceEntryPrice),
      stopPrice: decimalString(candidate.stopPrice),
      takeProfitPrice: decimalString(candidate.takeProfitPrice),
      minimumRewardRisk: decimalString(candidate.minimumRewardRisk),
      stopDistance: nullableDecimal(candidate.stopDistance),
      stopDistancePct: nullableDecimal(candidate.stopDistancePct),
      plannedRewardRisk: nullableDecimal(candidate.plannedRewardRisk),
      plannedEntryMinimum: nullableDecimal(candidate.plannedEntryMinimum),
      plannedEntryMaximum: nullableDecimal(candidate.plannedEntryMaximum),
      maximumEntryGapDistance: nullableDecimal(candidate.maximumEntryGapDistance),
      validFrom: nullableIso(candidate.validFrom),
      earliestFillAt: nullableIso(candidate.earliestFillAt),
      maxHoldHours: candidate.maxHoldHours,
      dataAsOf: iso(candidate.dataAsOf),
      decisionTime: iso(candidate.decisionTime),
      expiresAt: iso(candidate.expiresAt),
      inputHash: candidate.inputHash,
      strategyOutputHash: candidate.strategyOutputHash,
      strategySpecificationHash: candidate.strategySpecificationHash,
      strategyEngineVersion: candidate.strategyEngineVersion,
      hasFinalDecision: candidate.decision !== null
    },
    asset: {
      id: candidate.asset.id,
      symbol: candidate.asset.symbol,
      assetType: candidate.asset.assetType,
      quoteCurrency: candidate.asset.quoteCurrency,
      isTradable: candidate.asset.isTradable,
      isActive: candidate.asset.isActive,
      isLeveraged: candidate.asset.isLeveraged,
      isInverse: candidate.asset.isInverse,
      isStablecoin: candidate.asset.isStablecoin,
      instrumentStatus: candidate.asset.instrumentStatus
    },
    session:
      session === null
        ? null
        : {
            id: session.id,
            sessionKey: session.sessionKey,
            portfolioId: session.portfolioId,
            mode: session.mode,
            status: session.status,
            killSwitchEngaged: session.killSwitchEngaged,
            reconciledAt: nullableIso(session.reconciledAt),
            heartbeatAt: nullableIso(session.heartbeatAt),
            version: session.version
          },
    portfolio: {
      id: portfolio.id,
      key: portfolio.key,
      status: portfolio.status,
      baseCurrency: portfolio.baseCurrency,
      startingCash: decimalString(portfolio.startingCash),
      availableCash: decimalString(portfolio.availableCash),
      reservedCash: decimalString(portfolio.reservedCash),
      realizedPnl: decimalString(portfolio.realizedPnl),
      feesPaid: decimalString(portfolio.feesPaid),
      equity,
      highWaterMark: decimalString(portfolio.highWaterMark),
      ledgerSequence: portfolio.ledgerSequence,
      lastReconciledAt: nullableIso(portfolio.lastReconciledAt),
      version: portfolio.version
    },
    ledgerReplay: {
      sequence: lastLedgerEntry?.sequence ?? 0,
      entryCount: ledgerCount,
      availableCash: decimalString(ledgerAggregate._sum.availableCashDelta ?? 0),
      reservedCash: decimalString(ledgerAggregate._sum.reservedCashDelta ?? 0),
      realizedPnl: decimalString(ledgerAggregate._sum.realizedPnlDelta ?? 0),
      feesPaid: decimalString(ledgerAggregate._sum.feeDelta ?? 0),
      // A gapless 1..n chain has its last sequence equal to the row count.
      orphanReferenceCount: 0,
      sequenceGapCount: ledgerCount === (lastLedgerEntry?.sequence ?? 0) ? 0 : 1
    },
    startOfDay:
      startOfDaySnapshot === null
        ? null
        : {
            asOf: iso(startOfDaySnapshot.asOf),
            sourceLedgerSequence: startOfDaySnapshot.sourceLedgerSequence,
            equity: decimalString(startOfDaySnapshot.equity)
          },
    openPositions: positions.map((position) => ({
      id: position.id,
      positionKey: position.positionKey,
      assetId: position.assetId,
      symbol: position.asset.symbol,
      status: position.status,
      openQuantity: decimalString(position.openQuantity),
      averageEntryPrice: decimalString(position.averageEntryPrice),
      // Conservative bid mark is a P4 projection; until then the entry notional
      // is the honest upper bound of what the position ties up.
      marketValue: multiplyDecimalStrings(
        decimalString(position.openQuantity),
        decimalString(position.averageEntryPrice)
      )
    })),
    reservations: reservingOrders.map((order) => ({
      shadowOrderId: order.id,
      assetId: order.assetId,
      symbol: order.asset.symbol,
      status: order.status,
      reservedQuoteAmount: decimalString(order.reservedQuoteAmount)
    })),
    dailyCounters: {
      tradingDateUtc: utcDate(asOf),
      filledEntryOrdersToday: dailyCounters.filledEntryOrdersToday,
      consecutiveLosses: dailyCounters.consecutiveLosses,
      dailyPnl,
      closedTradeSequence: dailyCounters.closedTradeSequence
    },
    executionProfile:
      executionProfile === null
        ? null
        : {
            id: executionProfile.id,
            assetId: executionProfile.assetId,
            version: executionProfile.version,
            status: executionProfile.status,
            tickSize: decimalString(executionProfile.tickSize),
            stepSize: decimalString(executionProfile.stepSize),
            minQuantity: decimalString(executionProfile.minQuantity),
            minNotional: decimalString(executionProfile.minNotional),
            maxQuantity: nullableDecimal(executionProfile.maxQuantity),
            feeBps: executionProfile.feeBps,
            fullSpreadBps: executionProfile.fullSpreadBps,
            slippageBps: executionProfile.slippageBps,
            maxParticipationRate: decimalString(executionProfile.maxParticipationRate),
            sourceObservedAt: iso(executionProfile.sourceObservedAt),
            specificationHash: executionProfile.specificationHash
          },
    riskLimitSet:
      riskLimitSet === null
        ? null
        : {
            id: riskLimitSet.id,
            key: riskLimitSet.key,
            version: riskLimitSet.version,
            status: riskLimitSet.status,
            scope: riskLimitSet.scope,
            maxRiskPerTradePct: decimalString(riskLimitSet.maxRiskPerTradePct),
            maxDailyLossPct: decimalString(riskLimitSet.maxDailyLossPct),
            minRewardRisk: decimalString(riskLimitSet.minRewardRisk),
            maxOpenPositions: riskLimitSet.maxOpenPositions,
            maxNewTradesPerDay: riskLimitSet.maxNewTradesPerDay,
            maxConsecutiveLosses: riskLimitSet.maxConsecutiveLosses,
            maxGrossExposurePct: decimalString(riskLimitSet.maxGrossExposurePct),
            maxAssetExposurePct: decimalString(riskLimitSet.maxAssetExposurePct),
            maxCorrelatedExposurePct: decimalString(riskLimitSet.maxCorrelatedExposurePct),
            maxSpreadBps: riskLimitSet.maxSpreadBps,
            maxSlippageBps: riskLimitSet.maxSlippageBps,
            specificationHash: riskLimitSet.specificationHash
          },
    freshness: {
      candleAgeMs: candleFreshness,
      dataQualityAgeMs: dataQuality.ageMs,
      regimeAgeMs: ageMs(asOf, marketRegime?.generatedAt ?? null),
      portfolioSnapshotAgeMs: ageMs(asOf, portfolio.lastReconciledAt),
      hasFutureTimestamp:
        candidate.dataAsOf.getTime() > asOf.getTime() ||
        (marketRegime !== null && marketRegime.generatedAt.getTime() > asOf.getTime())
    },
    dataQuality: {
      minimumClosedCandles: dataQuality.candleCount,
      gapCount: dataQuality.gapCount,
      providerErrorCount: dataQuality.providerErrorCount,
      ohlcContradiction: false
    },
    marketRegime:
      marketRegime === null
        ? null
        : {
            id: marketRegime.id,
            generatedAt: iso(marketRegime.generatedAt),
            cryptoRegime: marketRegime.cryptoRegime,
            riskMode: marketRegime.riskMode,
            confidence: marketRegime.confidence
          },
    correlationGroup: {
      key: CRYPTO_MAJOR_GROUP_KEY,
      memberSymbols: [...CRYPTO_MAJOR_MEMBERS]
    },
    // v1 has no manual sizing path at all; the fields exist so `R-023` can
    // prove their absence rather than assume it.
    sizeOverride: { manualQuantity: null, riskMultiplier: null, requestedBy: null },
    previousApproval:
      previousApproval === null
        ? null
        : {
            assessedAt: iso(previousApproval.assessedAt),
            equity: decimalString(previousApproval.equity),
            riskAmount: decimalString(previousApproval.riskAmount)
          },
    existingAssessment:
      existingAssessment === null
        ? null
        : {
            assessmentKey: existingAssessment.assessmentKey,
            inputHash: existingAssessment.inputHash,
            status: existingAssessment.status
          },
    policyVersions: {
      riskEngineVersion: RISK_ENGINE_VERSION,
      ruleSetVersion: RISK_RULE_SET_VERSION,
      sizingPolicyVersion: RISK_SIZING_POLICY_VERSION,
      costPolicyVersion: RISK_COST_POLICY_VERSION,
      inputAssemblerVersion: RISK_INPUT_ASSEMBLER_VERSION,
      codeVersion
    }
  };

  return { ok: true, snapshot };
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-loaders
// ───────────────────────────────────────────────────────────────────────────

type TimeframeMap<T> = Record<"1h" | "4h" | "1d", T>;

async function loadCandleFreshness(
  database: PrismaClient,
  assetId: string,
  asOf: Date
): Promise<TimeframeMap<number | null>> {
  const entries = await Promise.all(
    (["1h", "4h", "1d"] as const).map(async (timeframe) => {
      const latest = await database.candle.findFirst({
        where: { assetId, timeframe, closeTime: { lte: asOf } },
        orderBy: { openTime: "desc" },
        select: { closeTime: true }
      });
      return [timeframe, ageMs(asOf, latest?.closeTime ?? null)] as const;
    })
  );
  return Object.fromEntries(entries) as TimeframeMap<number | null>;
}

async function loadDataQuality(
  database: PrismaClient,
  assetId: string,
  asOf: Date
): Promise<{
  readonly ageMs: number | null;
  readonly candleCount: TimeframeMap<number | null>;
  readonly gapCount: TimeframeMap<number | null>;
  readonly providerErrorCount: TimeframeMap<number | null>;
}> {
  const rows = await database.candleDataQuality.findMany({ where: { assetId } });
  const byTimeframe = new Map(rows.map((row) => [row.timeframe, row]));

  const pick = <T>(getter: (row: (typeof rows)[number]) => T): TimeframeMap<T | null> =>
    Object.fromEntries(
      (["1h", "4h", "1d"] as const).map((timeframe) => {
        const row = byTimeframe.get(timeframe);
        return [timeframe, row === undefined ? null : getter(row)];
      })
    ) as TimeframeMap<T | null>;

  // The oldest of the three observation times is the binding freshness.
  const observedAts = (["1h", "4h", "1d"] as const)
    .map((timeframe) => byTimeframe.get(timeframe))
    .map((row) => (row === undefined ? null : (row.lastAuditAt ?? row.updatedAt)));
  const oldest = observedAts.includes(null)
    ? null
    : observedAts.reduce<Date | null>(
        (worst, current) =>
          current === null ? worst : worst === null || current < worst ? current : worst,
        null
      );

  return {
    ageMs: ageMs(asOf, oldest),
    candleCount: pick((row) => row.candleCount),
    gapCount: pick((row) => row.gapCount),
    providerErrorCount: pick((row) => row.providerErrorCount)
  };
}

async function loadDailyCounters(
  database: PrismaClient,
  portfolioId: string,
  dayStart: Date,
  asOf: Date
): Promise<{
  readonly filledEntryOrdersToday: number;
  readonly consecutiveLosses: number;
  readonly closedTradeSequence: number;
}> {
  // One entry order counts once, no matter how many partial fills it produced
  // (docs/trading/06, `R-012`).
  const filledEntryOrders = await database.shadowOrder.findMany({
    where: {
      portfolioId,
      purpose: "ENTRY",
      fills: { some: { occurredAt: { gte: dayStart, lte: asOf } } }
    },
    select: { id: true }
  });

  // Closed trades newest first: a win resets the streak, a break-even does not.
  const closedPositions = await database.shadowPosition.findMany({
    where: {
      portfolioId,
      status: { in: ["CLOSED", "STOPPED_OUT", "INVALIDATED"] },
      closedAt: { not: null }
    },
    orderBy: { closedAt: "desc" },
    select: { realizedPnl: true }
  });

  let consecutiveLosses = 0;
  for (const position of closedPositions) {
    // Sign only, compared as a decimal so no float ever decides the streak.
    const pnl = new Prisma.Decimal(decimalString(position.realizedPnl));
    if (pnl.greaterThan(0)) break;
    if (pnl.lessThan(0)) consecutiveLosses += 1;
  }

  return {
    filledEntryOrdersToday: filledEntryOrders.length,
    consecutiveLosses,
    closedTradeSequence: closedPositions.length
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Decimal string arithmetic (assembler-local, scale 12)
// ───────────────────────────────────────────────────────────────────────────

function subtractDecimalStrings(left: string, right: string): string {
  return new Prisma.Decimal(left).minus(new Prisma.Decimal(right)).toFixed(12);
}

function multiplyDecimalStrings(left: string, right: string): string {
  return new Prisma.Decimal(left).mul(new Prisma.Decimal(right)).toDecimalPlaces(12).toFixed(12);
}
