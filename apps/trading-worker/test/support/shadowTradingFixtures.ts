/**
 * In-memory Prisma double and deterministic rows for the shadow strategy job.
 *
 * The fixtures mirror what `fetchCryptoCandles`, `analyzeCryptoSignals` and
 * `calculateMarketRegime` persist, so the assembler is exercised against the
 * real column shapes (Prisma `Decimal`, `Date`) rather than against strings.
 */

import { AssetType, Prisma } from "@signalpilot/database";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  TIMEFRAME_INTERVAL_MS,
  type StrategyTimeframe
} from "@signalpilot/strategy-engine";

export const AS_OF = new Date("2026-08-02T09:05:00.000Z");

export const ANCHOR_CLOSE: Readonly<Record<StrategyTimeframe, string>> = {
  "1h": "2026-08-02T08:59:59.999Z",
  "4h": "2026-08-02T07:59:59.999Z",
  "1d": "2026-08-01T23:59:59.999Z"
};

const CANDLE_COUNT = 250;
const WAVE = [0, 1, -1, 2, -2, 1] as const;

const decimal = (value: number): Prisma.Decimal =>
  new Prisma.Decimal(value.toFixed(6));

export interface SeriesShape {
  readonly base: number;
  readonly drift: number;
  readonly waveAmplitude: number;
  readonly halfRange: number;
  readonly volume: number;
  readonly anchorMove: number;
  readonly anchorVolume: number;
}

export const SHAPES: Readonly<Record<StrategyTimeframe, SeriesShape>> = {
  "1h": {
    base: 20000,
    drift: 15,
    waveAmplitude: 40,
    halfRange: 110,
    volume: 100,
    anchorMove: 420,
    anchorVolume: 320
  },
  "4h": {
    base: 15000,
    drift: 40,
    waveAmplitude: 60,
    halfRange: 200,
    volume: 400,
    anchorMove: 120,
    anchorVolume: 500
  },
  "1d": {
    base: 8000,
    drift: 70,
    waveAmplitude: 90,
    halfRange: 400,
    volume: 2000,
    anchorMove: 200,
    anchorVolume: 2400
  }
};

export interface CandleRow {
  id: string;
  assetId: string;
  symbol: string;
  timeframe: string;
  openTime: Date;
  closeTime: Date;
  open: Prisma.Decimal;
  high: Prisma.Decimal;
  low: Prisma.Decimal;
  close: Prisma.Decimal;
  volume: Prisma.Decimal;
  source: string;
}

export function buildCandleRows(
  timeframe: StrategyTimeframe,
  assetId: string,
  symbol: string,
  shape: SeriesShape = SHAPES[timeframe]
): CandleRow[] {
  const interval = TIMEFRAME_INTERVAL_MS[timeframe];
  const anchorCloseMs = Date.parse(ANCHOR_CLOSE[timeframe]);
  const anchorOpenMs = anchorCloseMs + 1 - interval;

  const closes: number[] = [];
  for (let index = 0; index < CANDLE_COUNT; index += 1) {
    closes.push(
      shape.base +
        index * shape.drift +
        WAVE[index % WAVE.length] * shape.waveAmplitude
    );
  }
  closes[CANDLE_COUNT - 1] = closes[CANDLE_COUNT - 2] + shape.anchorMove;

  return closes.map((close, index) => {
    const openMs = anchorOpenMs - (CANDLE_COUNT - 1 - index) * interval;
    const open = index === 0 ? close - shape.drift : closes[index - 1];
    const isAnchor = index === CANDLE_COUNT - 1;
    return {
      id: `${symbol.toLowerCase()}-${timeframe}-${String(index).padStart(3, "0")}`,
      assetId,
      symbol,
      timeframe,
      openTime: new Date(openMs),
      closeTime: new Date(openMs + interval - 1),
      open: decimal(open),
      high: decimal(Math.max(open, close) + shape.halfRange),
      low: decimal(Math.min(open, close) - shape.halfRange),
      close: decimal(close),
      volume: decimal(isAnchor ? shape.anchorVolume : shape.volume),
      source: "BINANCE"
    };
  });
}

const SIGNAL_CREATED_AT: Readonly<Record<StrategyTimeframe, string>> = {
  "1h": "2026-08-02T09:02:00.000Z",
  "4h": "2026-08-02T08:05:00.000Z",
  "1d": "2026-08-02T00:10:00.000Z"
};

export interface FakeWorldOptions {
  readonly symbol?: string;
  readonly assetId?: string;
  readonly assignmentEnabled?: boolean;
  readonly withAssignment?: boolean;
  readonly withExecutionProfile?: boolean;
  readonly cryptoRegime?: string;
  readonly candleOverrides?: Partial<Record<StrategyTimeframe, SeriesShape>>;
  readonly direction?: "LONG" | "SHORT";
}

export interface FakeWorld {
  readonly assets: Record<string, unknown>[];
  readonly assignments: Record<string, unknown>[];
  readonly candles: CandleRow[];
  readonly dataQuality: Record<string, unknown>[];
  readonly signals: Record<string, unknown>[];
  readonly regimes: Record<string, unknown>[];
  readonly executionProfiles: Record<string, unknown>[];
}

export function buildFakeWorld(options: FakeWorldOptions = {}): FakeWorld {
  const symbol = options.symbol ?? "BTCUSDT";
  const assetId = options.assetId ?? `asset-${symbol.toLowerCase()}`;
  const timeframes: StrategyTimeframe[] = ["1h", "4h", "1d"];
  const direction = options.direction ?? "LONG";
  const short = direction === "SHORT";
  const strategyKey = short
    ? CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY
    : CRYPTO_MTF_BREAKOUT_V1_KEY;
  const strategyEngineVersion = short
    ? CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION
    : CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION;
  const strategyHash = short
    ? CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH
    : CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH;
  const assignmentSuffix = `${symbol.toLowerCase()}-${direction.toLowerCase()}`;
  const shortShapes: Readonly<Record<StrategyTimeframe, SeriesShape>> = {
    "1h": { ...SHAPES["1h"], base: 30000, drift: -15, anchorMove: -420 },
    "4h": { ...SHAPES["4h"], base: 35000, drift: -40, anchorMove: -120 },
    "1d": { ...SHAPES["1d"], base: 45000, drift: -70, anchorMove: -200 }
  };

  return {
    assets: [
      {
        id: assetId,
        symbol,
        name: symbol,
        assetType: AssetType.CRYPTO,
        exchange: "BINANCE",
        provider: "BINANCE",
        baseCurrency: symbol.replace("USDT", ""),
        quoteCurrency: "USDT",
        instrumentStatus: "ACTIVE",
        isActive: true,
        isTradable: true,
        isLeveraged: false,
        isInverse: false,
        isStablecoin: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ],
    assignments:
      options.withAssignment === false
        ? []
        : [
            {
              id: `assignment-${assignmentSuffix}`,
              strategyId: `strategy-${direction.toLowerCase()}`,
              strategyVersionId: `strategy-version-${direction.toLowerCase()}`,
              portfolioId: "portfolio-shadow-1",
              assetId,
              timeframe: "1h",
              enabled: options.assignmentEnabled ?? true,
              validFrom: new Date("2026-07-01T00:00:00.000Z"),
              validTo: null,
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
              assignmentConfigJson: {
                direction,
                syntheticShadowShort: short,
                leverageAllowed: false,
                marginAllowed: false,
                futuresAllowed: false
              },
              strategy: {
                id: `strategy-${direction.toLowerCase()}`,
                key: strategyKey,
                status: "ACTIVE"
              },
              strategyVersion: {
                id: `strategy-version-${direction.toLowerCase()}`,
                version: 1,
                status: "ACTIVE",
                engineVersion: strategyEngineVersion,
                specificationHash: strategyHash
              }
            }
          ],
    candles: timeframes.flatMap((timeframe) =>
      buildCandleRows(
        timeframe,
        assetId,
        symbol,
        options.candleOverrides?.[timeframe] ??
          (short ? shortShapes[timeframe] : SHAPES[timeframe])
      )
    ),
    dataQuality: timeframes.map((timeframe) => ({
      id: `dq-${symbol.toLowerCase()}-${timeframe}`,
      assetId,
      provider: "BINANCE",
      timeframe,
      lastAuditAt: new Date("2026-08-02T09:00:00.000Z"),
      updatedAt: new Date("2026-08-02T09:00:00.000Z"),
      latestClosedCandle: new Date(ANCHOR_CLOSE[timeframe]),
      candleCount: CANDLE_COUNT,
      expectedCandleCount: CANDLE_COUNT,
      gapCount: 0,
      missingCandleCount: 0,
      providerErrorCount: 0,
      rateLimitCount: 0,
      entitlementErrorCount: 0,
      noDataCount: 0,
      lastErrorKind: null
    })),
    signals: timeframes.map((timeframe) => ({
      id: `signal-${symbol.toLowerCase()}-${timeframe}`,
      assetId,
      symbol,
      timeframe,
      signalType: short ? "BREAKDOWN" : "BREAKOUT",
      status: timeframe === "1h" ? "STRONG_WATCH" : "WATCH",
      direction: short ? "BEARISH" : "BULLISH",
      riskLevel: "MEDIUM",
      score: 74,
      riskScore: 30,
      createdAt: new Date(SIGNAL_CREATED_AT[timeframe]),
      ruleApplication: {
        id: `rule-${symbol.toLowerCase()}-${timeframe}`,
        adjustedScore: 78,
        adjustedStatus: timeframe === "1h" ? "STRONG_WATCH" : "WATCH",
        finalRiskLevel: "MEDIUM"
      },
      output: { id: `output-${symbol.toLowerCase()}-${timeframe}` }
    })),
    regimes: [
      {
        id: "regime-1",
        generatedAt: new Date("2026-08-02T09:00:00.000Z"),
        equityRegime: "RISK_ON",
        cryptoRegime: options.cryptoRegime ?? (short ? "RISK_OFF" : "RISK_ON"),
        overallRegime: short ? "RISK_OFF" : "RISK_ON",
        riskMode: "NORMAL",
        confidence: 72
      }
    ],
    executionProfiles:
      options.withExecutionProfile === false
        ? []
        : [
            {
              id: `execution-profile-${symbol.toLowerCase()}`,
              assetId,
              version: 1,
              status: "ACTIVE",
              tickSize: decimal(0.01),
              stepSize: decimal(0.00001),
              minQuantity: decimal(0.0001),
              minNotional: decimal(10),
              feeBps: 10,
              fullSpreadBps: 6,
              slippageBps: 8,
              maxParticipationRate: decimal(0.01),
              source: "MANUAL_CONSERVATIVE",
              sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
              specificationHash: "0".repeat(64)
            }
          ]
  };
}

export interface RecordedWrites {
  readonly botRuns: Record<string, unknown>[];
  readonly botRunUpdates: Record<string, unknown>[];
  readonly botLogs: Record<string, unknown>[];
  readonly tradeCandidates: Record<string, unknown>[];
  readonly evidence: Record<string, unknown>[];
  readonly auditEvents: Record<string, unknown>[];
  readonly riskEvents: Record<string, unknown>[];
  /** Anything a later work package owns must stay empty. */
  readonly forbiddenWrites: string[];
}

function matchesDateFilter(value: Date, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true;
  const range = filter as { lte?: Date; gte?: Date };
  if (range.lte !== undefined && value.getTime() > range.lte.getTime())
    return false;
  if (range.gte !== undefined && value.getTime() < range.gte.getTime())
    return false;
  return true;
}

/**
 * Minimal Prisma double. Only the queries the strategy path uses are
 * implemented; any other model access throws so an accidental write to a risk,
 * order, fill or position table fails the test loudly.
 */
export function createFakeDatabase(worlds: readonly FakeWorld[]) {
  const merged: FakeWorld = {
    assets: worlds.flatMap((world) => world.assets),
    assignments: worlds.flatMap((world) => world.assignments),
    candles: worlds.flatMap((world) => world.candles),
    dataQuality: worlds.flatMap((world) => world.dataQuality),
    signals: worlds.flatMap((world) => world.signals),
    regimes: worlds[0]?.regimes ?? [],
    executionProfiles: worlds.flatMap((world) => world.executionProfiles)
  };

  const writes: RecordedWrites = {
    botRuns: [],
    botRunUpdates: [],
    botLogs: [],
    tradeCandidates: [],
    evidence: [],
    auditEvents: [],
    riskEvents: [],
    forbiddenWrites: []
  };

  let candidateSequence = 0;

  const forbidden = (model: string) =>
    new Proxy(
      {},
      {
        get: () => () => {
          writes.forbiddenWrites.push(model);
          throw new Error(`Work package 2 must not touch ${model}.`);
        }
      }
    );

  const database = {
    asset: {
      findFirst: async ({
        where
      }: {
        where: { symbol: string; assetType: string };
      }) =>
        merged.assets.find(
          (asset) =>
            asset.symbol === where.symbol && asset.assetType === where.assetType
        ) ?? null
    },
    strategyAssignment: {
      findFirst: async ({
        where
      }: {
        where: {
          assetId: string;
          enabled: boolean;
          strategy?: { key?: string };
          id?: string;
        };
      }) =>
        merged.assignments.find(
          (assignment) =>
            assignment.assetId === where.assetId &&
            assignment.enabled === where.enabled &&
            (where.id === undefined || assignment.id === where.id) &&
            (where.strategy?.key === undefined ||
              (assignment.strategy as { key?: string } | undefined)?.key ===
                where.strategy.key)
        ) ?? null
    },
    candle: {
      findMany: async ({
        where,
        take
      }: {
        where: {
          assetId: string;
          timeframe: string;
          closeTime?: { lte?: Date };
        };
        take: number;
      }) =>
        merged.candles
          .filter(
            (candle) =>
              candle.assetId === where.assetId &&
              candle.timeframe === where.timeframe &&
              matchesDateFilter(candle.closeTime, where.closeTime)
          )
          .sort(
            (left, right) => right.openTime.getTime() - left.openTime.getTime()
          )
          .slice(0, take)
    },
    candleDataQuality: {
      findFirst: async ({
        where
      }: {
        where: { assetId: string; timeframe: string };
      }) =>
        merged.dataQuality.find(
          (quality) =>
            quality.assetId === where.assetId &&
            quality.timeframe === where.timeframe
        ) ?? null
    },
    signal: {
      findFirst: async ({
        where
      }: {
        where: {
          assetId: string;
          timeframe: string;
          createdAt?: { lte?: Date };
        };
      }) =>
        merged.signals.find(
          (signal) =>
            signal.assetId === where.assetId &&
            signal.timeframe === where.timeframe &&
            matchesDateFilter(signal.createdAt as Date, where.createdAt)
        ) ?? null
    },
    marketRegimeSnapshot: {
      findFirst: async () => merged.regimes[0] ?? null
    },
    instrumentExecutionProfile: {
      findFirst: async ({
        where
      }: {
        where: { assetId: string; status: string };
      }) =>
        merged.executionProfiles.find(
          (profile) =>
            profile.assetId === where.assetId && profile.status === where.status
        ) ?? null
    },
    radarEvent: { findMany: async () => [] },
    marketEvent: { findMany: async () => [] },
    newsItem: { findMany: async () => [] },

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
        return { id: `bot-log-${writes.botLogs.length}`, ...data };
      }
    },

    tradeCandidate: {
      findUnique: async ({ where }: { where: { candidateKey: string } }) =>
        writes.tradeCandidates.find(
          (row) => row.candidateKey === where.candidateKey
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        candidateSequence += 1;
        const row = { id: `trade-candidate-${candidateSequence}`, ...data };
        writes.tradeCandidates.push(row);
        return row;
      }
    },
    tradeCandidateEvidence: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        writes.evidence.push(...data);
        return { count: data.length };
      }
    },
    tradingAuditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.auditEvents.push(data);
        return { id: `audit-${writes.auditEvents.length}`, ...data };
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

    riskAssessment: forbidden("riskAssessment"),
    riskRuleResult: forbidden("riskRuleResult"),
    tradeDecision: forbidden("tradeDecision"),
    shadowOrder: forbidden("shadowOrder"),
    shadowFill: forbidden("shadowFill"),
    shadowPosition: forbidden("shadowPosition"),
    shadowPositionEvent: forbidden("shadowPositionEvent"),
    exitPlan: forbidden("exitPlan"),
    portfolioLedgerEntry: forbidden("portfolioLedgerEntry"),
    portfolioSnapshot: forbidden("portfolioSnapshot"),
    tradingSession: forbidden("tradingSession"),

    $transaction: async <T>(handler: (tx: unknown) => Promise<T>): Promise<T> =>
      handler(database)
  };

  return { database, writes };
}

/** Environment that satisfies all four safety flags. */
export const ENABLED_ENV: Readonly<Record<string, string | undefined>> =
  Object.freeze({
    ENABLE_LIVE_TRADING: "false",
    TRADING_MODE: "SHADOW",
    TRADING_SHADOW_ENABLED: "true",
    TRADING_STRATEGY_V1_ENABLED: "true",
    TRADING_CODE_VERSION: "test-code-version"
  });
