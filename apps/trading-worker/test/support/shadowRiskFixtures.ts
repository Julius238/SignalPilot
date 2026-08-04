/**
 * In-memory Prisma double for the risk assessment job.
 *
 * Only the queries the risk path uses are implemented. Every model a later work
 * package owns — fills, ledger bookings, exit plans — throws on access, so an
 * accidental write fails the test loudly instead of passing silently.
 */

import { Prisma } from "@signalpilot/database";
import {
  RISK_LIMIT_SET_KEY,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RISK_LIMIT_SET_VERSION
} from "@signalpilot/risk-engine";

export const AS_OF = new Date("2026-08-02T09:05:00.000Z");
export const TRADING_DATE_UTC = new Date("2026-08-02T00:00:00.000Z");

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

/** Reward/risk wide enough to clear the costed 2.0 threshold. */
export const APPROVABLE_TAKE_PROFIT = "25706.30";
/** The strategy's own 2R plan, which `R-008` rejects once costs are priced in. */
export const STRATEGY_V1_TAKE_PROFIT = "25103.94";

export interface RiskWorldOptions {
  readonly takeProfitPrice?: string;
  readonly portfolioStatus?: string;
  readonly sessionStatus?: string;
  readonly killSwitchEngaged?: boolean;
  readonly withRiskLimitSet?: boolean;
  readonly withExecutionProfile?: boolean;
  readonly candidateStatus?: string;
  readonly withDecision?: boolean;
  readonly candlePlanComplete?: boolean;
}

export function buildRiskWorld(options: RiskWorldOptions = {}) {
  const planComplete = options.candlePlanComplete !== false;

  const asset = {
    id: "asset-btc",
    symbol: "BTCUSDT",
    assetType: "CRYPTO",
    exchange: "BINANCE",
    quoteCurrency: "USDT",
    isTradable: true,
    isActive: true,
    isLeveraged: false,
    isInverse: false,
    isStablecoin: false,
    instrumentStatus: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };

  const candidate = {
    id: "trade-candidate-1",
    candidateKey:
      "candidate.v1|assignment-btcusdt|strategy-version-1|asset-btc|btcusdt-1h-249",
    strategyAssignmentId: "assignment-btcusdt",
    strategyVersionId: "strategy-version-1",
    portfolioId: "portfolio-shadow-1",
    assetId: asset.id,
    anchorCandleId: "btcusdt-1h-249",
    anchorSignalId: "signal-1h",
    direction: "LONG",
    entryType: "MARKET",
    status: options.candidateStatus ?? "CREATED",
    referenceEntryPrice: decimal("24100"),
    stopPrice: decimal("23598.03"),
    takeProfitPrice: decimal(options.takeProfitPrice ?? APPROVABLE_TAKE_PROFIT),
    minimumRewardRisk: decimal("2"),
    stopDistance: planComplete ? decimal("501.97") : null,
    stopDistancePct: planComplete ? decimal("0.020828") : null,
    plannedRewardRisk: planComplete ? decimal("2") : null,
    plannedEntryMinimum: planComplete ? decimal("23598.03") : null,
    plannedEntryMaximum: planComplete ? decimal("24267.32") : null,
    maximumEntryGapDistance: planComplete ? decimal("167.32") : null,
    validFrom: planComplete ? new Date("2026-08-02T08:59:59.999Z") : null,
    earliestFillAt: planComplete ? new Date("2026-08-02T08:59:59.999Z") : null,
    maxHoldHours: planComplete ? 72 : null,
    strategyEngineVersion: planComplete ? "crypto-mtf-breakout-v1/1.0.0" : null,
    strategySpecificationHash: planComplete ? "c".repeat(64) : null,
    strategyOutputHash: planComplete ? "b".repeat(64) : null,
    dataAsOf: AS_OF,
    decisionTime: AS_OF,
    expiresAt: new Date("2026-08-02T10:59:59.999Z"),
    inputHash: "a".repeat(64),
    version: 0,
    asset,
    strategyVersion: {
      id: "strategy-version-1",
      status: "ACTIVE",
      version: 1,
      parametersJson: { direction: "LONG" }
    },
    strategyAssignment: {
      id: "assignment-btcusdt",
      enabled: true,
      assignmentConfigJson: { direction: "LONG" },
      strategyId: "strategy-1",
      strategy: { key: "CRYPTO_MTF_BREAKOUT_V1" }
    },
    decision: options.withDecision === true ? { id: "decision-existing" } : null
  };

  return {
    assets: [asset],
    candidates: [candidate],
    portfolios: [
      {
        id: "portfolio-shadow-1",
        key: "SHADOW_V1",
        status: options.portfolioStatus ?? "ACTIVE",
        baseCurrency: "USDT",
        startingCash: decimal("10000"),
        availableCash: decimal("10000"),
        reservedCash: decimal("0"),
        realizedPnl: decimal("0"),
        feesPaid: decimal("0"),
        equity: decimal("10000"),
        highWaterMark: decimal("10000"),
        ledgerSequence: 1,
        lastReconciledAt: new Date("2026-08-02T09:03:00.000Z"),
        version: 1
      }
    ],
    sessions: [
      {
        id: "session-1",
        sessionKey: "trading-session.v1|portfolio-shadow-1|1",
        portfolioId: "portfolio-shadow-1",
        mode: "SHADOW",
        status: options.sessionStatus ?? "SHADOW_ACTIVE",
        killSwitchEngaged: options.killSwitchEngaged ?? false,
        reconciledAt: new Date("2026-08-02T09:03:00.000Z"),
        heartbeatAt: new Date("2026-08-02T09:04:30.000Z"),
        version: 2,
        createdAt: new Date("2026-08-02T08:00:00.000Z")
      }
    ],
    ledgerEntries: [
      {
        id: "ledger-1",
        portfolioId: "portfolio-shadow-1",
        sequence: 1,
        availableCashDelta: decimal("10000"),
        reservedCashDelta: decimal("0"),
        realizedPnlDelta: decimal("0"),
        feeDelta: decimal("0")
      }
    ],
    snapshots: [
      {
        id: "portfolio-snapshot-1",
        portfolioId: "portfolio-shadow-1",
        asOf: new Date("2026-08-02T00:02:00.000Z"),
        tradingDateUtc: TRADING_DATE_UTC,
        sourceLedgerSequence: 1,
        equity: decimal("10000")
      }
    ],
    executionProfiles:
      options.withExecutionProfile === false
        ? []
        : [
            {
              id: "execution-profile-btc",
              assetId: asset.id,
              version: 1,
              status: "ACTIVE",
              tickSize: decimal("0.01"),
              stepSize: decimal("0.00001"),
              minQuantity: decimal("0.00001"),
              minNotional: decimal("10"),
              maxQuantity: null,
              feeBps: 10,
              fullSpreadBps: 10,
              slippageBps: 10,
              maxParticipationRate: decimal("0.01"),
              sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
              specificationHash: "d".repeat(64)
            }
          ],
    riskLimitSets:
      options.withRiskLimitSet === false
        ? []
        : [
            {
              id: "risk-limit-set-1",
              key: RISK_LIMIT_SET_KEY,
              version: RISK_LIMIT_SET_VERSION,
              status: "ACTIVE",
              scope: "PORTFOLIO",
              maxRiskPerTradePct: decimal(RISK_LIMIT_SET_V1.maxRiskPerTradePct),
              maxDailyLossPct: decimal(RISK_LIMIT_SET_V1.maxDailyLossPct),
              minRewardRisk: decimal(RISK_LIMIT_SET_V1.minRewardRisk),
              maxOpenPositions: RISK_LIMIT_SET_V1.maxOpenPositions,
              maxNewTradesPerDay: RISK_LIMIT_SET_V1.maxNewTradesPerDay,
              maxConsecutiveLosses: RISK_LIMIT_SET_V1.maxConsecutiveLosses,
              maxGrossExposurePct: decimal(
                RISK_LIMIT_SET_V1.maxGrossExposurePct
              ),
              maxAssetExposurePct: decimal(
                RISK_LIMIT_SET_V1.maxAssetExposurePct
              ),
              maxCorrelatedExposurePct: decimal(
                RISK_LIMIT_SET_V1.maxCorrelatedExposurePct
              ),
              maxSpreadBps: RISK_LIMIT_SET_V1.maxSpreadBps,
              maxSlippageBps: RISK_LIMIT_SET_V1.maxSlippageBps,
              specificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH
            }
          ],
    regimes: [
      {
        id: "regime-1",
        generatedAt: new Date("2026-08-02T09:00:00.000Z"),
        cryptoRegime: "RISK_ON",
        riskMode: "NORMAL",
        confidence: 72
      }
    ],
    dataQuality: (["1h", "4h", "1d"] as const).map((timeframe) => ({
      id: `dq-${timeframe}`,
      assetId: asset.id,
      timeframe,
      lastAuditAt: new Date("2026-08-02T09:00:00.000Z"),
      updatedAt: new Date("2026-08-02T09:00:00.000Z"),
      candleCount: 250,
      gapCount: 0,
      providerErrorCount: 0
    })),
    candles: [
      {
        assetId: asset.id,
        timeframe: "1h",
        openTime: new Date("2026-08-02T08:00:00.000Z"),
        closeTime: new Date("2026-08-02T08:59:59.999Z")
      },
      {
        assetId: asset.id,
        timeframe: "4h",
        openTime: new Date("2026-08-02T04:00:00.000Z"),
        closeTime: new Date("2026-08-02T07:59:59.999Z")
      },
      {
        assetId: asset.id,
        timeframe: "1d",
        openTime: new Date("2026-08-01T00:00:00.000Z"),
        closeTime: new Date("2026-08-01T23:59:59.999Z")
      }
    ]
  };
}

export type RiskWorld = ReturnType<typeof buildRiskWorld>;

export interface RiskWrites {
  readonly botRuns: Record<string, unknown>[];
  readonly botRunUpdates: Record<string, unknown>[];
  readonly botLogs: Record<string, unknown>[];
  readonly riskAssessments: Record<string, unknown>[];
  readonly riskRuleResults: Record<string, unknown>[];
  readonly tradeDecisions: Record<string, unknown>[];
  readonly candidateUpdates: Record<string, unknown>[];
  readonly auditEvents: Record<string, unknown>[];
  readonly riskEvents: Record<string, unknown>[];
  readonly portfolios: Record<string, unknown>[];
  readonly ledgerEntries: Record<string, unknown>[];
  readonly portfolioSnapshots: Record<string, unknown>[];
  readonly riskLimitSets: Record<string, unknown>[];
  readonly executionProfiles: Record<string, unknown>[];
  readonly sessions: Record<string, unknown>[];
  readonly forbiddenWrites: string[];
}

export function createFakeRiskDatabase(world: RiskWorld) {
  const writes: RiskWrites = {
    botRuns: [],
    botRunUpdates: [],
    botLogs: [],
    riskAssessments: [],
    riskRuleResults: [],
    tradeDecisions: [],
    candidateUpdates: [],
    auditEvents: [],
    riskEvents: [],
    portfolios: [],
    ledgerEntries: [],
    portfolioSnapshots: [],
    riskLimitSets: [],
    executionProfiles: [],
    sessions: [],
    forbiddenWrites: []
  };

  const candidates = world.candidates.map((candidate) => ({ ...candidate }));

  const forbidden = (model: string) =>
    new Proxy(
      {},
      {
        get: () => () => {
          writes.forbiddenWrites.push(model);
          throw new Error(`Work package 3 must not touch ${model}.`);
        }
      }
    );

  const database = {
    tradeCandidate: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        candidates.find((candidate) => candidate.id === where.id) ?? null,
      findMany: async ({
        where
      }: {
        where?: {
          id?: string;
          status?: { in: string[] };
          direction?: { in: string[] };
        };
      } = {}) =>
        candidates.filter(
          (candidate) =>
            (where?.id === undefined || candidate.id === where.id) &&
            (where?.status === undefined ||
              where.status.in.includes(candidate.status)) &&
            (where?.direction === undefined ||
              where.direction.in.includes(candidate.direction)) &&
            candidate.decision === null
        ),
      updateMany: async ({
        where,
        data
      }: {
        where: { id: string; status: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        const target = candidates.find(
          (candidate) =>
            candidate.id === where.id &&
            where.status.in.includes(candidate.status)
        );
        if (target === undefined) return { count: 0 };
        target.status = data.status as string;
        writes.candidateUpdates.push({ id: where.id, ...data });
        return { count: 1 };
      }
    },
    portfolio: {
      findUnique: async ({ where }: { where: { id?: string; key?: string } }) =>
        world.portfolios.find(
          (portfolio) =>
            portfolio.id === where.id || portfolio.key === where.key
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `portfolio-${writes.portfolios.length + 1}`,
          ...data
        };
        writes.portfolios.push(row);
        return row;
      }
    },
    tradingSession: {
      findFirst: async () => world.sessions[0] ?? null,
      findUnique: async ({ where }: { where: { sessionKey: string } }) =>
        world.sessions.find(
          (session) => session.sessionKey === where.sessionKey
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `session-${writes.sessions.length + 1}`, ...data };
        writes.sessions.push(row);
        return row;
      }
    },
    portfolioLedgerEntry: {
      aggregate: async () => ({
        _sum: {
          availableCashDelta:
            world.ledgerEntries[0]?.availableCashDelta ?? decimal("0"),
          reservedCashDelta: decimal("0"),
          realizedPnlDelta: decimal("0"),
          feeDelta: decimal("0")
        }
      }),
      count: async () => world.ledgerEntries.length,
      findFirst: async () => world.ledgerEntries.at(-1) ?? null,
      upsert: async ({
        where,
        create
      }: {
        where: { entryKey: string };
        create: Record<string, unknown>;
      }) => {
        const existing = writes.ledgerEntries.find(
          (row) => row.entryKey === where.entryKey
        );
        if (existing !== undefined) return existing;
        writes.ledgerEntries.push(create);
        return create;
      }
    },
    portfolioSnapshot: {
      findFirst: async () =>
        world.snapshots[0] ?? writes.portfolioSnapshots[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.portfolioSnapshots.push(data);
        return data;
      }
    },
    shadowPosition: { findMany: async () => [] },
    shadowOrder: { findMany: async () => [] },
    instrumentExecutionProfile: {
      findFirst: async () =>
        world.executionProfiles[0] ?? writes.executionProfiles[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `execution-profile-${writes.executionProfiles.length + 1}`,
          ...data
        };
        writes.executionProfiles.push(row);
        return row;
      }
    },
    riskLimitSet: {
      findFirst: async () =>
        world.riskLimitSets[0] ?? writes.riskLimitSets[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `risk-limit-set-${writes.riskLimitSets.length + 1}`,
          ...data
        };
        writes.riskLimitSets.push(row);
        return row;
      }
    },
    marketRegimeSnapshot: { findFirst: async () => world.regimes[0] ?? null },
    candleDataQuality: { findMany: async () => world.dataQuality },
    candle: {
      findFirst: async ({ where }: { where: { timeframe: string } }) =>
        world.candles.find((candle) => candle.timeframe === where.timeframe) ??
        null
    },
    asset: {
      findFirst: async ({ where }: { where: { symbol: string } }) =>
        world.assets.find((entry) => entry.symbol === where.symbol) ?? null
    },

    riskAssessment: {
      findUnique: async ({ where }: { where: { assessmentKey: string } }) =>
        writes.riskAssessments.find(
          (row) => row.assessmentKey === where.assessmentKey
        ) ?? null,
      findFirst: async ({ where }: { where: { status?: string } }) =>
        writes.riskAssessments.find(
          (row) => where.status === undefined || row.status === where.status
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `risk-assessment-${writes.riskAssessments.length + 1}`,
          ...data
        };
        writes.riskAssessments.push(row);
        return row;
      }
    },
    riskRuleResult: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        writes.riskRuleResults.push(...data);
        return { count: data.length };
      }
    },
    tradeDecision: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `trade-decision-${writes.tradeDecisions.length + 1}`,
          ...data
        };
        writes.tradeDecisions.push(row);
        const candidate = candidates.find(
          (entry) => entry.id === data.tradeCandidateId
        );
        if (candidate !== undefined) candidate.decision = { id: row.id };
        return row;
      }
    },
    tradingAuditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.auditEvents.push(data);
        return data;
      },
      upsert: async ({
        where,
        create
      }: {
        where: { eventKey: string };
        create: Record<string, unknown>;
      }) => {
        const existing = writes.auditEvents.find(
          (row) => row.eventKey === where.eventKey
        );
        if (existing !== undefined) return existing;
        writes.auditEvents.push(create);
        return create;
      }
    },
    riskEvent: {
      upsert: async ({
        where,
        create
      }: {
        where: { eventKey: string };
        create: Record<string, unknown>;
      }) => {
        const existing = writes.riskEvents.find(
          (row) => row.eventKey === where.eventKey
        );
        if (existing !== undefined) return existing;
        writes.riskEvents.push(create);
        return create;
      }
    },

    botRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `bot-run-${writes.botRuns.length + 1}`, ...data };
        writes.botRuns.push(row);
        return row;
      },
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        writes.botRunUpdates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }
    },
    botLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.botLogs.push(data);
        return data;
      }
    },

    shadowFill: forbidden("shadowFill"),
    shadowPositionEvent: forbidden("shadowPositionEvent"),
    exitPlan: forbidden("exitPlan"),

    $transaction: async <T>(handler: (tx: unknown) => Promise<T>): Promise<T> =>
      handler(database)
  };

  return { database, writes, candidates };
}

/** Environment that satisfies every flag the risk job needs. */
export const RISK_ENABLED_ENV: Readonly<Record<string, string | undefined>> =
  Object.freeze({
    ENABLE_LIVE_TRADING: "false",
    TRADING_MODE: "SHADOW",
    TRADING_SHADOW_ENABLED: "true",
    TRADING_RISK_V1_ENABLED: "true",
    TRADING_STRATEGY_LONG_V1_ENABLED: "true",
    TRADING_CODE_VERSION: "test-code-version"
  });

/** Environment that additionally allows the operations bootstrap. */
export const BOOTSTRAP_ENABLED_ENV: Readonly<
  Record<string, string | undefined>
> = Object.freeze({
  ...RISK_ENABLED_ENV,
  TRADING_BOOTSTRAP_ENABLED: "true"
});
