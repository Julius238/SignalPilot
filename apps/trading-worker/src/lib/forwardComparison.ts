/**
 * Champion vs. challenger: the forward shadow test of each strategy in its own
 * virtual portfolio, side by side, plus the historical replay of the same
 * identity — kept strictly apart.
 *
 * Forward metrics come from the same engine the performance refresh uses
 * (`computeShadowPerformance`), but bounded to each portfolio's forward start
 * (the activation of its current session), so nothing before the test counts.
 * Replay rows are research results over known history (`ShadowReplayRun`);
 * they are returned in their own block and never merged into forward numbers.
 *
 * Strictly read-only. Served by the API (`GET /trading/forward-comparison`).
 */

import {
  ShadowPositionStatus,
  StrategyPerformanceWindow,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import { computeShadowPerformance } from "@signalpilot/performance-intelligence/shadow";
import { regimeGateOpen } from "@signalpilot/strategy-engine";

import { assembleShadowPerformanceInput } from "./shadowPerformancePersistence.js";
import { SHADOW_CHALLENGER_PORTFOLIO_KEY, SHADOW_PORTFOLIO_KEY } from "./shadowPortfolios.js";

const ROLES = [
  { role: "CHAMPION", portfolioKey: SHADOW_PORTFOLIO_KEY },
  { role: "CHALLENGER", portfolioKey: SHADOW_CHALLENGER_PORTFOLIO_KEY }
] as const;

const OPEN_POSITION_STATUSES = [
  ShadowPositionStatus.OPENING,
  ShadowPositionStatus.OPEN,
  ShadowPositionStatus.PARTIALLY_CLOSED
];
const CLOSED_POSITION_STATUSES = [
  ShadowPositionStatus.CLOSED,
  ShadowPositionStatus.STOPPED_OUT,
  ShadowPositionStatus.INVALIDATED
];

type Metric = { readonly value: string | null; readonly reason: string | null };

export interface ForwardStrategyDto {
  readonly strategyKey: string;
  readonly strategyVersionId: string;
  readonly version: number;
  readonly engineVersion: string;
  readonly specificationHash: string;
  readonly symbol: string;
}

export interface ForwardComparisonEntryDto {
  readonly role: "CHAMPION" | "CHALLENGER";
  readonly portfolioKey: string;
  readonly portfolioId: string | null;
  readonly portfolioStatus: string | null;
  readonly sessionStatus: string | null;
  readonly killSwitchEngaged: boolean | null;
  /** Activation of the current session — every forward number starts here. */
  readonly forwardStartAt: string | null;
  readonly strategies: readonly ForwardStrategyDto[];
  readonly startingCash: string | null;
  readonly equity: string | null;
  readonly netPnl: string | null;
  readonly netPnlPct: string | null;
  readonly closedTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: Metric;
  readonly profitFactor: Metric;
  readonly averageR: Metric;
  readonly maxDrawdownPct: Metric;
  readonly exposurePct: Metric;
  readonly fees: string;
  readonly simulatedExecutionCost: string;
  /** Closed trades of this portfolio before the forward start; must stay 0. */
  readonly tradesBeforeForwardStart: number;
  readonly openPosition: {
    readonly id: string;
    readonly symbol: string;
    readonly status: string;
    readonly openedAt: string | null;
    readonly quantity: string;
    readonly averageEntryPrice: string;
    readonly stopPrice: string;
    readonly takeProfitPrice: string;
    readonly maxHoldUntil: string;
  } | null;
  readonly lastTrade: {
    readonly id: string;
    readonly symbol: string;
    readonly status: string;
    readonly openedAt: string | null;
    readonly closedAt: string | null;
    readonly netPnl: string;
    readonly averageEntryPrice: string;
    readonly averageExitPrice: string | null;
  } | null;
  readonly lastEvaluation: {
    readonly occurredAt: string;
    readonly outcome: "CANDIDATE" | "NO_CANDIDATE";
    readonly reasonCode: string;
  } | null;
}

export interface ReplayResultDto {
  readonly strategyKey: string;
  readonly runId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly costProfile: string;
  readonly regimePolicy: string;
  readonly engineVersion: string;
  readonly firstAnchorAt: string | null;
  readonly lastAnchorAt: string | null;
  readonly closedTrades: number;
  readonly startingCash: string;
  readonly finalEquity: string;
  /** `metricsJson` periods as the replay engine wrote them (overall, training, test). */
  readonly periods: readonly {
    readonly label: string;
    readonly closedTrades: number | null;
    readonly netPnl: string | null;
    readonly returnPct: string | null;
    readonly profitFactor: string | null;
    readonly winRatePct: string | null;
    readonly averageR: string | null;
    readonly maxDrawdownPct: string | null;
    readonly exposurePct: string | null;
    readonly totalExecutionCost: string | null;
    readonly buyAndHoldReturnPct: string | null;
  }[];
}

export interface ForwardComparisonDto {
  readonly asOf: string;
  readonly regime: {
    readonly generatedAt: string;
    readonly source: "crypto-native-regime-v1";
    readonly cryptoRegime: string | null;
    readonly riskMode: string | null;
    readonly confidence: number | null;
    /** The entry/exit gate of CRYPTO_REGIME_LONG_V1 on this report. */
    readonly regimeGateOpen: boolean;
  } | null;
  readonly forward: readonly ForwardComparisonEntryDto[];
  readonly replay: readonly ReplayResultDto[];
}

const toStringOrNull = (value: { toString(): string } | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toString();

const metric = (value: { value: unknown; reason?: unknown } | null | undefined): Metric => ({
  value: typeof value?.value === "string" ? value.value : null,
  reason: typeof value?.reason === "string" ? value.reason : null
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : null;

async function loadRegime(database: PrismaClient): Promise<ForwardComparisonDto["regime"]> {
  const snapshot = await database.marketRegimeSnapshot.findFirst({ orderBy: { generatedAt: "desc" } });
  const native = asRecord(asRecord(snapshot?.reportJson)?.cryptoNative);
  if (snapshot === null || native === null) return null;
  const cryptoRegime = asString(native.cryptoRegime);
  const riskMode = asString(native.riskMode);
  const confidence = typeof native.confidence === "number" ? native.confidence : null;
  return {
    generatedAt: snapshot.generatedAt.toISOString(),
    source: "crypto-native-regime-v1",
    cryptoRegime,
    riskMode,
    confidence,
    regimeGateOpen:
      cryptoRegime !== null &&
      riskMode !== null &&
      confidence !== null &&
      regimeGateOpen({ cryptoRegime, riskMode, confidence })
  };
}

async function loadForwardEntry(
  database: PrismaClient,
  role: "CHAMPION" | "CHALLENGER",
  portfolioKey: string,
  asOf: Date
): Promise<ForwardComparisonEntryDto> {
  const portfolio = await database.portfolio.findUnique({ where: { key: portfolioKey } });
  const session =
    portfolio === null
      ? null
      : await database.tradingSession.findFirst({
          where: { portfolioId: portfolio.id, status: { not: TradingSessionStatus.CLOSED } },
          orderBy: { createdAt: "desc" }
        });
  const assignments =
    portfolio === null
      ? []
      : await database.strategyAssignment.findMany({
          where: { portfolioId: portfolio.id, enabled: true },
          include: { strategy: true, strategyVersion: true, asset: true },
          orderBy: { createdAt: "asc" }
        });
  const forwardStart = session?.startedAt ?? null;

  const empty: ForwardComparisonEntryDto = {
    role,
    portfolioKey,
    portfolioId: portfolio?.id ?? null,
    portfolioStatus: portfolio?.status ?? null,
    sessionStatus: session?.status ?? null,
    killSwitchEngaged: session?.killSwitchEngaged ?? null,
    forwardStartAt: forwardStart?.toISOString() ?? null,
    strategies: assignments.map((assignment) => ({
      strategyKey: assignment.strategy.key,
      strategyVersionId: assignment.strategyVersionId,
      version: assignment.strategyVersion.version,
      engineVersion: assignment.strategyVersion.engineVersion,
      specificationHash: assignment.strategyVersion.specificationHash,
      symbol: assignment.asset.symbol
    })),
    startingCash: toStringOrNull(portfolio?.startingCash),
    equity: toStringOrNull(portfolio?.equity),
    netPnl: null,
    netPnlPct: null,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRatePct: { value: null, reason: "NOT_STARTED" },
    profitFactor: { value: null, reason: "NOT_STARTED" },
    averageR: { value: null, reason: "NOT_STARTED" },
    maxDrawdownPct: { value: null, reason: "NOT_STARTED" },
    exposurePct: { value: null, reason: "NOT_STARTED" },
    fees: "0",
    simulatedExecutionCost: "0",
    tradesBeforeForwardStart: 0,
    openPosition: null,
    lastTrade: null,
    lastEvaluation: null
  };
  if (portfolio === null || forwardStart === null) return empty;

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [input, tradesBeforeForwardStart, openPosition, lastTrade, lastRejection, lastCandidate] = await Promise.all([
    assembleShadowPerformanceInput(database, {
      portfolioId: portfolio.id,
      window: StrategyPerformanceWindow.ALL_TIME,
      asOf,
      notBefore: forwardStart
    }),
    database.shadowPosition.count({
      where: {
        portfolioId: portfolio.id,
        status: { in: CLOSED_POSITION_STATUSES },
        closedAt: { lt: forwardStart }
      }
    }),
    database.shadowPosition.findFirst({
      where: { portfolioId: portfolio.id, status: { in: OPEN_POSITION_STATUSES } },
      include: { asset: true },
      orderBy: { createdAt: "desc" }
    }),
    database.shadowPosition.findFirst({
      where: {
        portfolioId: portfolio.id,
        status: { in: CLOSED_POSITION_STATUSES },
        closedAt: { gte: forwardStart }
      },
      include: { asset: true },
      orderBy: { closedAt: "desc" }
    }),
    // A refusal is recorded against the assignment, a candidate as its own row.
    database.tradingAuditEvent.findFirst({
      where: {
        eventType: "STRATEGY_EVALUATION_REJECTED",
        aggregateId: { in: assignmentIds },
        occurredAt: { gte: forwardStart }
      },
      orderBy: { occurredAt: "desc" }
    }),
    database.tradeCandidate.findFirst({
      where: { strategyAssignmentId: { in: assignmentIds }, createdAt: { gte: forwardStart } },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const lastEvaluation: ForwardComparisonEntryDto["lastEvaluation"] =
    lastCandidate !== null &&
    (lastRejection === null || lastCandidate.createdAt.getTime() >= lastRejection.occurredAt.getTime())
      ? { occurredAt: lastCandidate.createdAt.toISOString(), outcome: "CANDIDATE", reasonCode: lastCandidate.status }
      : lastRejection === null
        ? null
        : {
            occurredAt: lastRejection.occurredAt.toISOString(),
            outcome: "NO_CANDIDATE",
            reasonCode: lastRejection.reasonCode
          };

  const report = computeShadowPerformance(input);
  const overall = report.segments.find((segment) => segment.segmentType === "OVERALL")?.metrics;
  const netPnl = portfolio.equity.minus(portfolio.startingCash);

  return {
    ...empty,
    netPnl: netPnl.toFixed(2),
    netPnlPct: portfolio.startingCash.isZero()
      ? null
      : netPnl.div(portfolio.startingCash).mul(100).toFixed(2),
    closedTrades: overall?.closedTrades ?? 0,
    wins: overall?.wins ?? 0,
    losses: overall?.losses ?? 0,
    winRatePct: metric(overall?.winRatePct),
    profitFactor: metric(overall?.profitFactor),
    averageR: metric(overall?.averageR),
    maxDrawdownPct: metric(overall?.maxDrawdownPct),
    exposurePct: metric(overall?.exposurePct),
    fees: overall?.fees ?? "0",
    simulatedExecutionCost: overall?.simulatedExecutionCost ?? "0",
    tradesBeforeForwardStart,
    openPosition:
      openPosition === null
        ? null
        : {
            id: openPosition.id,
            symbol: openPosition.asset.symbol,
            status: openPosition.status,
            openedAt: openPosition.openedAt?.toISOString() ?? null,
            quantity: openPosition.openQuantity.toString(),
            averageEntryPrice: openPosition.averageEntryPrice.toString(),
            stopPrice: openPosition.stopPrice.toString(),
            takeProfitPrice: openPosition.takeProfitPrice.toString(),
            maxHoldUntil: openPosition.maxHoldUntil.toISOString()
          },
    lastTrade:
      lastTrade === null
        ? null
        : {
            id: lastTrade.id,
            symbol: lastTrade.asset.symbol,
            status: lastTrade.status,
            openedAt: lastTrade.openedAt?.toISOString() ?? null,
            closedAt: lastTrade.closedAt?.toISOString() ?? null,
            netPnl: lastTrade.realizedPnl.toString(),
            averageEntryPrice: lastTrade.averageEntryPrice.toString(),
            averageExitPrice: toStringOrNull(lastTrade.averageExitPrice)
          },
    lastEvaluation
  };
}

function replayPeriods(metricsJson: unknown): ReplayResultDto["periods"] {
  const metrics = asRecord(metricsJson);
  if (metrics === null) return [];
  return (["overall", "training", "test"] as const).flatMap((key) => {
    const period = asRecord(metrics[key]);
    if (period === null) return [];
    return [
      {
        label: asString(period.label) ?? key,
        closedTrades: typeof period.closedTrades === "number" ? period.closedTrades : null,
        netPnl: asString(period.netPnl),
        returnPct: asString(period.returnPct),
        profitFactor: asString(period.profitFactor),
        winRatePct: asString(period.winRatePct),
        averageR: asString(period.averageR),
        maxDrawdownPct: asString(period.maxDrawdownPct),
        exposurePct: asString(period.exposurePct),
        totalExecutionCost: asString(period.totalExecutionCost),
        buyAndHoldReturnPct: asString(period.buyAndHoldReturnPct)
      }
    ];
  });
}

/** The newest real-data replay of each strategy that is in a forward test. */
async function loadReplays(
  database: PrismaClient,
  strategyKeys: readonly string[]
): Promise<ReplayResultDto[]> {
  const runs = await Promise.all(
    strategyKeys.map((strategyKey) =>
      database.shadowReplayRun.findFirst({
        where: { strategyKey, isSynthetic: false, mode: "SPEC", costProfile: "REALISTIC" },
        orderBy: { createdAt: "desc" }
      })
    )
  );
  return runs.flatMap((run) =>
    run === null
      ? []
      : [
          {
            strategyKey: run.strategyKey,
            runId: run.id,
            label: run.label,
            createdAt: run.createdAt.toISOString(),
            costProfile: run.costProfile,
            regimePolicy: run.regimePolicy,
            engineVersion: run.engineVersion,
            firstAnchorAt: run.firstAnchorAt?.toISOString() ?? null,
            lastAnchorAt: run.lastAnchorAt?.toISOString() ?? null,
            closedTrades: run.closedTrades,
            startingCash: run.startingCash.toString(),
            finalEquity: run.finalEquity.toString(),
            periods: replayPeriods(run.metricsJson)
          }
        ]
  );
}

export async function getForwardComparison(
  database: PrismaClient,
  asOf: Date = new Date()
): Promise<ForwardComparisonDto> {
  const [regime, forward] = await Promise.all([
    loadRegime(database),
    Promise.all(ROLES.map(({ role, portfolioKey }) => loadForwardEntry(database, role, portfolioKey, asOf)))
  ]);
  const strategyKeys = [...new Set(forward.flatMap((entry) => entry.strategies.map((strategy) => strategy.strategyKey)))];
  return {
    asOf: asOf.toISOString(),
    regime,
    forward,
    replay: await loadReplays(database, strategyKeys)
  };
}
