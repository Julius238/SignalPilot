/**
 * Assembles the shadow-performance engine's input from the database and
 * persists its output as versioned `StrategyPerformance` snapshots (P8,
 * "1. Performance Engine" and "2. Persistenz").
 *
 * The split is strict: every read lives here, every calculation lives in
 * `@signalpilot/performance-intelligence/shadow`. This module never invents a
 * metric and never rounds one — it only maps `{ value, reason }` pairs onto
 * nullable columns and keeps the full engine result in `metricsJson`.
 *
 * Idempotency: `snapshotKey` covers portfolio, window, `asOf`, segment, engine
 * version and input hash. Re-running over unchanged data writes nothing;
 * re-running after the engine version or the data changed writes a NEW row and
 * leaves every historical row untouched.
 *
 * Nothing in here writes an order, a position, a fill, a ledger entry or a
 * risk decision. The only table it inserts into is `StrategyPerformance`.
 */

import {
  Prisma,
  RiskAssessmentStatus,
  ShadowPositionStatus,
  StrategyPerformanceWindow,
  TradeCandidateStatus,
  type PrismaClient
} from "@signalpilot/database";
import {
  SHADOW_PERFORMANCE_ENGINE_VERSION,
  ShadowPerformanceSegment,
  computeShadowPerformance,
  type ClosedShadowTradeInput,
  type ComputeShadowPerformanceInput,
  type NullableMetric,
  type PortfolioEquityPointInput,
  type ShadowPerformanceReport
} from "@signalpilot/performance-intelligence/shadow";
import {
  DecimalValue,
  RoundingMode,
  buildStrategyPerformanceSnapshotKey
} from "@signalpilot/trading-domain";

export const SHADOW_PERFORMANCE_JOB_KEY = "trading:performance-refresh";

/** Position statuses that represent a finished trade with a realised result. */
const CLOSED_POSITION_STATUSES = [
  ShadowPositionStatus.CLOSED,
  ShadowPositionStatus.STOPPED_OUT,
  ShadowPositionStatus.INVALIDATED
];

/** Bounded read size — a refresh never issues an unbounded table scan. */
const MAX_TRADES_PER_WINDOW = 5_000;
const MAX_EQUITY_POINTS = 1_000;

const decimalString = (value: unknown): string =>
  value === null || value === undefined ? "0" : String(value);

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

/** UTC bounds of one reporting window, relative to `asOf`. */
export function resolveWindowBounds(
  window: StrategyPerformanceWindow,
  asOf: Date
): { from: Date; to: Date } {
  switch (window) {
    case StrategyPerformanceWindow.DAILY:
      return { from: startOfUtcDay(asOf), to: asOf };
    case StrategyPerformanceWindow.ROLLING_30D:
      return {
        from: new Date(asOf.getTime() - 30 * 24 * 60 * 60_000),
        to: asOf
      };
    case StrategyPerformanceWindow.ALL_TIME:
    default:
      return { from: new Date(0), to: asOf };
  }
}

/**
 * `MarketRegimeSnapshot.overallRegime` as the candidate's own immutable input
 * snapshot recorded it. Read from that snapshot rather than from the live
 * regime table on purpose: performance must be attributed to the regime that
 * was true when the trade was decided, not to today's.
 */
function extractMarketRegime(
  inputSnapshot: Prisma.JsonValue | null | undefined
): string | null {
  if (
    inputSnapshot === null ||
    typeof inputSnapshot !== "object" ||
    Array.isArray(inputSnapshot)
  )
    return null;
  const regime = (inputSnapshot as Record<string, unknown>).marketRegime;
  if (regime === null || typeof regime !== "object" || Array.isArray(regime))
    return null;
  const overall = (regime as Record<string, unknown>).overallRegime;
  return typeof overall === "string" && overall.length > 0 ? overall : null;
}

export interface AssembleShadowPerformanceOptions {
  readonly portfolioId: string;
  readonly window: StrategyPerformanceWindow;
  readonly asOf: Date;
  /**
   * Derive MAE/MFE from candles covering each position's hold window. Off by
   * default because it costs one query per trade; when off, both metrics are
   * reported as `null` with `NO_PRICE_EXTREMES` rather than guessed.
   */
  readonly derivePriceExtremes?: boolean;
}

/** Reads everything the engine needs for one portfolio and one window. */
export async function assembleShadowPerformanceInput(
  database: PrismaClient,
  options: AssembleShadowPerformanceOptions
): Promise<ComputeShadowPerformanceInput> {
  const { from, to } = resolveWindowBounds(options.window, options.asOf);

  const portfolio = await database.portfolio.findUnique({
    where: { id: options.portfolioId },
    select: { id: true, startingCash: true }
  });

  const positions = await database.shadowPosition.findMany({
    where: {
      portfolioId: options.portfolioId,
      status: { in: CLOSED_POSITION_STATUSES },
      closedAt: { gte: from, lte: to }
    },
    orderBy: { closedAt: "asc" },
    take: MAX_TRADES_PER_WINDOW,
    include: {
      asset: { select: { symbol: true } },
      entryOrder: {
        select: {
          tradeCandidateId: true,
          tradeCandidate: { select: { inputSnapshotJson: true } }
        }
      },
      fills: {
        orderBy: { occurredAt: "asc" },
        select: {
          quantity: true,
          slippageAmount: true,
          triggerType: true,
          occurredAt: true
        }
      }
    }
  });

  // One batched lookup for the planned risk amount behind each entry, instead
  // of one query per trade.
  const candidateIds = positions
    .map((position) => position.entryOrder?.tradeCandidateId)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
  const assessments =
    candidateIds.length === 0
      ? []
      : await database.riskAssessment.findMany({
          where: {
            tradeCandidateId: { in: candidateIds },
            status: RiskAssessmentStatus.PASS
          },
          orderBy: { assessedAt: "desc" },
          select: { tradeCandidateId: true, riskAmount: true }
        });
  const riskAmountByCandidate = new Map<string, string>();
  for (const assessment of assessments) {
    if (!riskAmountByCandidate.has(assessment.tradeCandidateId)) {
      riskAmountByCandidate.set(
        assessment.tradeCandidateId,
        decimalString(assessment.riskAmount)
      );
    }
  }

  const trades: ClosedShadowTradeInput[] = [];
  for (const position of positions) {
    // Σ (per-unit adverse deviation × quantity) over all fills. Fills are the
    // only place the simulation recorded its own cost.
    const executionCost = position.fills.reduce((total, fill) => {
      try {
        return total.add(
          DecimalValue.fromString(decimalString(fill.slippageAmount)).mul(
            DecimalValue.fromString(decimalString(fill.quantity)),
            RoundingMode.HALF_UP
          )
        );
      } catch {
        return total;
      }
    }, DecimalValue.ZERO);

    const exitFills = position.fills.filter(
      (fill) => fill.triggerType !== "ENTRY"
    );
    const exitReason =
      exitFills.length === 0
        ? null
        : exitFills[exitFills.length - 1].triggerType;

    const candidateId = position.entryOrder?.tradeCandidateId ?? null;
    const extremes =
      options.derivePriceExtremes === true
        ? await derivePriceExtremes(
            database,
            position.assetId,
            position.openedAt,
            position.closedAt
          )
        : { maxAdversePrice: null, maxFavorablePrice: null };

    trades.push({
      positionId: position.id,
      portfolioId: position.portfolioId,
      strategyVersionId: position.strategyVersionId,
      assetId: position.assetId,
      symbol: position.asset?.symbol ?? null,
      direction: position.direction,
      marketRegime: extractMarketRegime(
        position.entryOrder?.tradeCandidate?.inputSnapshotJson
      ),
      exitReason,
      openedAt: position.openedAt?.toISOString() ?? null,
      closedAt: position.closedAt?.toISOString() ?? null,
      initialQuantity: decimalString(position.initialQuantity),
      averageEntryPrice: decimalString(position.averageEntryPrice),
      netPnl: decimalString(position.realizedPnl),
      fees: decimalString(position.feesPaid),
      simulatedExecutionCost: executionCost.toString(),
      plannedRiskAmount:
        candidateId === null
          ? null
          : (riskAmountByCandidate.get(candidateId) ?? null),
      maxAdversePrice: extremes.maxAdversePrice,
      maxFavorablePrice: extremes.maxFavorablePrice
    });
  }

  const snapshots = await database.portfolioSnapshot.findMany({
    where: { portfolioId: options.portfolioId, asOf: { gte: from, lte: to } },
    orderBy: { asOf: "asc" },
    take: MAX_EQUITY_POINTS,
    select: { asOf: true, tradingDateUtc: true, equity: true }
  });

  // One observation per UTC trading day: the last snapshot of that day. Daily
  // returns must not be computed from several intraday snapshots of one day.
  const dailyEquity = new Map<string, PortfolioEquityPointInput>();
  for (const snapshot of snapshots) {
    const day = snapshot.tradingDateUtc.toISOString().slice(0, 10);
    dailyEquity.set(day, {
      asOf: snapshot.asOf.toISOString(),
      tradingDateUtc: day,
      equity: decimalString(snapshot.equity)
    });
  }
  const equityCurve = [...dailyEquity.values()].sort((left, right) =>
    left.tradingDateUtc.localeCompare(right.tradingDateUtc)
  );

  const [
    assessedCandidates,
    riskRejectedCandidates,
    invalidCandidates,
    expiredCandidates
  ] = await Promise.all([
    database.riskAssessment.count({
      where: {
        portfolioId: options.portfolioId,
        assessedAt: { gte: from, lte: to }
      }
    }),
    database.riskAssessment.count({
      where: {
        portfolioId: options.portfolioId,
        status: RiskAssessmentStatus.FAIL,
        assessedAt: { gte: from, lte: to }
      }
    }),
    database.tradeCandidate.count({
      where: {
        portfolioId: options.portfolioId,
        status: TradeCandidateStatus.INVALID,
        decisionTime: { gte: from, lte: to }
      }
    }),
    database.tradeCandidate.count({
      where: {
        portfolioId: options.portfolioId,
        status: TradeCandidateStatus.EXPIRED,
        decisionTime: { gte: from, lte: to }
      }
    })
  ]);

  // The data cut this snapshot is bound to: the newest position event that
  // belongs to any trade in the window.
  const lastEvent =
    trades.length === 0
      ? null
      : await database.shadowPositionEvent.findFirst({
          where: {
            shadowPositionId: { in: trades.map((entry) => entry.positionId) }
          },
          orderBy: [{ occurredAt: "desc" }, { sequence: "desc" }],
          select: { id: true, occurredAt: true }
        });

  return {
    portfolioId: options.portfolioId,
    window: {
      from: from.toISOString(),
      to: to.toISOString(),
      asOf: options.asOf.toISOString()
    },
    equityBase:
      portfolio === null ? null : decimalString(portfolio.startingCash),
    trades,
    equityCurve,
    riskFunnel: {
      assessedCandidates,
      riskRejectedCandidates,
      invalidCandidates,
      expiredCandidates
    },
    sourceThroughPositionEventId: lastEvent?.id ?? null,
    dataThroughAt: lastEvent?.occurredAt.toISOString() ?? null
  };
}

/**
 * Lowest low and highest high across the 1h candles covering the hold window.
 * Returns nulls when no candle covers it — the engine then reports MAE/MFE as
 * `null` with a reason rather than a fabricated extreme.
 */
async function derivePriceExtremes(
  database: PrismaClient,
  assetId: string,
  openedAt: Date | null,
  closedAt: Date | null
): Promise<{
  maxAdversePrice: string | null;
  maxFavorablePrice: string | null;
}> {
  if (openedAt === null || closedAt === null || closedAt < openedAt) {
    return { maxAdversePrice: null, maxFavorablePrice: null };
  }
  const aggregate = await database.candle.aggregate({
    where: {
      assetId,
      timeframe: "1h",
      closeTime: { gte: openedAt, lte: closedAt }
    },
    _min: { low: true },
    _max: { high: true }
  });
  const low = aggregate._min.low;
  const high = aggregate._max.high;
  if (low === null || high === null)
    return { maxAdversePrice: null, maxFavorablePrice: null };
  return {
    maxAdversePrice: DecimalValue.fromString(
      Number(low).toFixed(12)
    ).toString(),
    maxFavorablePrice: DecimalValue.fromString(
      Number(high).toFixed(12)
    ).toString()
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Persistence
// ───────────────────────────────────────────────────────────────────────────

/** A `{ value, reason }` metric mapped onto a nullable Decimal column. */
const metricColumn = (metric: NullableMetric): Prisma.Decimal | null =>
  metric.value === null ? null : new Prisma.Decimal(metric.value);

/** Same, but for a column that is NOT NULL and legitimately zero when unknown. */
const metricColumnOrZero = (metric: NullableMetric): Prisma.Decimal =>
  metric.value === null
    ? new Prisma.Decimal(0)
    : new Prisma.Decimal(metric.value);

export interface PersistShadowPerformanceOptions {
  readonly window: StrategyPerformanceWindow;
  readonly codeVersion: string;
  readonly asOf: Date;
}

export interface PersistShadowPerformanceSummary {
  readonly segments: number;
  readonly written: number;
  readonly unchanged: number;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly engineVersion: string;
}

/**
 * Write every segment of one report. A segment whose `snapshotKey` already
 * exists is left exactly as it is — no update, no overwrite, not even of
 * `computedAt` (P8: "Keine historischen Ergebnisse überschreiben").
 */
export async function persistShadowPerformance(
  database: PrismaClient,
  report: ShadowPerformanceReport,
  options: PersistShadowPerformanceOptions
): Promise<PersistShadowPerformanceSummary> {
  let written = 0;
  let unchanged = 0;

  for (const segment of report.segments) {
    const snapshotKey = buildStrategyPerformanceSnapshotKey({
      portfolioId: report.portfolioId,
      window: options.window,
      asOf: report.window.asOf,
      segmentType: segment.segmentType,
      segmentKey: segment.segmentKey,
      engineVersion: report.engineVersion,
      inputHash: report.inputHash
    });

    const existing = await database.strategyPerformance.findUnique({
      where: { snapshotKey }
    });
    if (existing !== null) {
      unchanged += 1;
      continue;
    }

    const metrics = segment.metrics;
    try {
      await database.strategyPerformance.create({
        data: {
          snapshotKey,
          strategyVersionId:
            segment.segmentType === ShadowPerformanceSegment.STRATEGY_VERSION
              ? segment.strategyVersionId
              : null,
          portfolioId: report.portfolioId,
          window: options.window,
          segmentType: segment.segmentType,
          segmentKey: segment.segmentKey,
          segmentLabel: segment.segmentLabel,
          asOf: new Date(report.window.asOf),
          from: new Date(report.window.from),
          to: new Date(report.window.to),
          closedTrades: metrics.closedTrades,
          wins: metrics.wins,
          losses: metrics.losses,
          breakeven: metrics.breakeven,
          grossPnl: new Prisma.Decimal(metrics.grossPnl),
          netPnl: new Prisma.Decimal(metrics.netPnl),
          fees: new Prisma.Decimal(metrics.fees),
          averageR: metricColumnOrZero(metrics.averageR),
          profitFactor: metricColumnOrZero(metrics.profitFactor),
          maxDrawdownPct: metricColumnOrZero(metrics.maxDrawdownPct),
          averageHoldMinutes: metricColumnOrZero(metrics.averageHoldMinutes),
          expectancy: metricColumnOrZero(metrics.expectancy),
          winRatePct: metricColumn(metrics.winRatePct),
          grossProfit: new Prisma.Decimal(metrics.grossProfit),
          grossLoss: new Prisma.Decimal(metrics.grossLoss),
          simulatedExecutionCost: new Prisma.Decimal(
            metrics.simulatedExecutionCost
          ),
          averageWin: metricColumn(metrics.averageWin),
          averageLoss: metricColumn(metrics.averageLoss),
          cumulativeR: metricColumn(metrics.cumulativeR),
          tradesWithPlannedRisk: metrics.tradesWithPlannedRisk,
          maxWinStreak: metrics.maxWinStreak,
          maxLossStreak: metrics.maxLossStreak,
          maxDrawdownAmount: metricColumn(metrics.maxDrawdownAmount),
          recoveryFactor: metricColumn(metrics.recoveryFactor),
          exposureMinutes: new Prisma.Decimal(metrics.exposureMinutes),
          exposurePct: metricColumn(metrics.exposurePct),
          averageMaePct: metricColumn(metrics.averageMaePct),
          averageMfePct: metricColumn(metrics.averageMfePct),
          sharpeRatio: metricColumn(metrics.sharpeRatio),
          sortinoRatio: metricColumn(metrics.sortinoRatio),
          returnObservations: metrics.returnObservations,
          assessedCandidates: metrics.assessedCandidates,
          riskRejectedCandidates: metrics.riskRejectedCandidates,
          invalidCandidates: metrics.invalidCandidates,
          expiredCandidates: metrics.expiredCandidates,
          riskRejectionRatePct: metricColumn(metrics.riskRejectionRatePct),
          // The authoritative, complete result — including every null reason
          // the typed columns above cannot express.
          metricsJson: metrics as unknown as Prisma.InputJsonObject,
          engineVersion: report.engineVersion,
          codeVersion: options.codeVersion,
          dataThroughAt:
            report.dataThroughAt === null
              ? null
              : new Date(report.dataThroughAt),
          computedAt: options.asOf,
          sourceThroughPositionEventId: report.sourceThroughPositionEventId,
          inputHash: report.inputHash,
          outputHash: report.outputHash
        }
      });
      written += 1;
    } catch (error) {
      // A concurrent refresh already wrote this exact snapshot.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        unchanged += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    segments: report.segments.length,
    written,
    unchanged,
    inputHash: report.inputHash,
    outputHash: report.outputHash,
    engineVersion: report.engineVersion
  };
}

export interface RefreshShadowPerformanceOptions extends AssembleShadowPerformanceOptions {
  readonly codeVersion: string;
}

/** Assemble, compute, persist — one portfolio, one window. */
export async function refreshShadowPerformance(
  database: PrismaClient,
  options: RefreshShadowPerformanceOptions
): Promise<PersistShadowPerformanceSummary> {
  const input = await assembleShadowPerformanceInput(database, options);
  const report = computeShadowPerformance(input);
  return persistShadowPerformance(database, report, {
    window: options.window,
    codeVersion: options.codeVersion,
    asOf: options.asOf
  });
}

export { SHADOW_PERFORMANCE_ENGINE_VERSION };
