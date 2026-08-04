/**
 * Assembles a `StrategyInputSnapshotV1` from persisted SignalPilot data.
 *
 * Specification:
 *   docs/trading/05-strategy-v1-specification.md, "Eingangsdaten-Snapshot"
 *   docs/trading/02-shadow-trading-target-architecture.md, "Datenfluss v1" step 2–3
 *
 * The assembler is the only place that talks to the database for the strategy
 * path. It reads existing analysis tables and writes nothing. It also performs
 * no business judgement: every threshold, every freshness rule and every
 * refusal lives in the pure engine, so a snapshot can be replayed later and
 * produce the same verdict.
 *
 * Reuse over reimplementation: candles, candle data quality, signals, the
 * multi-timeframe summary and the market regime all come from the existing
 * packages and tables (docs/trading/10, P2 "Bestehende Funktionen wiederverwenden").
 */

import { AssetType, Prisma, type PrismaClient } from "@signalpilot/database";
import {
  calculateMultiTimeframeSummary,
  type MultiTimeframeSignalInput
} from "@signalpilot/multi-timeframe";
import {
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  INDICATORS_V1_VERSION,
  STRATEGY_INPUT_SNAPSHOT_VERSION,
  STRATEGY_TIMEFRAMES,
  StrategyReasonCode,
  getStrategy,
  type SnapshotCandleV1,
  type SnapshotContextEventV1,
  type SnapshotDataQualityV1,
  type SnapshotSignalV1,
  type StrategyInputSnapshotV1,
  type StrategyTimeframe
} from "@signalpilot/strategy-engine";

export const STRATEGY_INPUT_ASSEMBLER_VERSION =
  "strategy-input-assembler-v1/1.0.0";
export const MULTI_TIMEFRAME_VERSION = "multi-timeframe/1.0.0";

/**
 * How radar, news and market events become snapshot context. Pinned so a change
 * is visible in the input hash (docs/trading/05, "News/Event ist optionaler
 * Evidenzkontext").
 *
 * - `RadarEvent` and `MarketEvent` carry an explicit severity enum; a `CRITICAL`
 *   entry classified bearish blocks the candidate.
 * - `NewsItem` has no impact severity in the persisted model, so it enters as
 *   `INFO` evidence and can never block on its own.
 */
export const CONTEXT_POLICY_VERSION = "strategy-context-policy-v1/1.0.0";

/** Look-back window for context evidence, relative to `asOf`. */
const CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Reasons the assembler cannot even produce a snapshot. */
export const AssemblerReasonCode = {
  ASSET_RECORD_MISSING: "ASSET_RECORD_MISSING",
  ASSIGNMENT_MISSING: StrategyReasonCode.ASSIGNMENT_MISSING,
  STRATEGY_VERSION_NOT_ACTIVE: StrategyReasonCode.STRATEGY_VERSION_NOT_ACTIVE
} as const;
export type AssemblerReasonCode =
  (typeof AssemblerReasonCode)[keyof typeof AssemblerReasonCode];

export interface AssembleStrategyInputOptions {
  readonly symbol: string;
  readonly asOf: Date;
  /** Closed registry key; an unknown key is refused before market data is read. */
  readonly strategyKey?: string;
  /** Optional exact assignment pin for scheduler and replay callers. */
  readonly strategyAssignmentId?: string;
  /** Git commit or immutable build identifier of the running worker. */
  readonly codeVersion: string;
}

export type AssembleStrategyInputResult =
  | { readonly ok: true; readonly snapshot: StrategyInputSnapshotV1 }
  | {
      readonly ok: false;
      readonly reasonCode: AssemblerReasonCode;
      readonly message: string;
    };

// ───────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ───────────────────────────────────────────────────────────────────────────

/** Prisma `Decimal(30,12)` to the canonical fixed-scale string. */
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
  return String(value ?? "0");
}

const isoString = (value: Date): string => value.toISOString();

/** 0–100 alignment score to the `[0, 1]` decimal rate the strategy compares. */
function normalizedAlignmentScore(raw: number): string {
  const clamped = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), 100);
  return (clamped / 100).toFixed(12);
}

function classifyMarketEventBias(
  symbol: string,
  positiveImpact: readonly string[],
  negativeImpact: readonly string[]
): SnapshotContextEventV1["directionalBias"] {
  const needles = new Set([
    symbol.toUpperCase(),
    "CRYPTO",
    "CRYPTOCURRENCY",
    "DIGITAL_ASSETS"
  ]);
  const matches = (list: readonly string[]): boolean =>
    list.some((entry) => needles.has(entry.trim().toUpperCase()));

  const bearish = matches(negativeImpact);
  const bullish = matches(positiveImpact);
  if (bearish && !bullish) return "BEARISH";
  if (bullish && !bearish) return "BULLISH";
  return "NEUTRAL";
}

function classifyNewsBias(
  sentiment: string | null
): SnapshotContextEventV1["directionalBias"] {
  const normalized = (sentiment ?? "").trim().toUpperCase();
  if (normalized === "NEGATIVE" || normalized === "BEARISH") return "BEARISH";
  if (normalized === "POSITIVE" || normalized === "BULLISH") return "BULLISH";
  return "NEUTRAL";
}

function classifyRadarBias(
  movePercent: number | null
): SnapshotContextEventV1["directionalBias"] {
  if (
    movePercent === null ||
    !Number.isFinite(movePercent) ||
    movePercent === 0
  )
    return "NEUTRAL";
  return movePercent < 0 ? "BEARISH" : "BULLISH";
}

// ───────────────────────────────────────────────────────────────────────────
// Assembly
// ───────────────────────────────────────────────────────────────────────────

export async function assembleStrategyInput(
  database: PrismaClient,
  options: AssembleStrategyInputOptions
): Promise<AssembleStrategyInputResult> {
  const {
    symbol,
    asOf,
    codeVersion,
    strategyKey = CRYPTO_MTF_BREAKOUT_V1_KEY,
    strategyAssignmentId
  } = options;
  const definition = getStrategy(strategyKey);
  if (definition === null) {
    return {
      ok: false,
      reasonCode: AssemblerReasonCode.ASSIGNMENT_MISSING,
      message: `Unregistered strategy ${strategyKey}.`
    };
  }
  const params = definition.parameters;
  const requestedCandlesPerTimeframe = params.requestedCandlesPerTimeframe;
  const freshnessPolicyVersion = params.freshnessPolicyVersion;
  const directionalPolicyVersion =
    "breakoutPolicyVersion" in params
      ? params.breakoutPolicyVersion
      : params.breakdownPolicyVersion;
  if (
    typeof requestedCandlesPerTimeframe !== "number" ||
    !Number.isInteger(requestedCandlesPerTimeframe) ||
    requestedCandlesPerTimeframe <= 0 ||
    typeof freshnessPolicyVersion !== "string" ||
    typeof directionalPolicyVersion !== "string"
  ) {
    return {
      ok: false,
      reasonCode: AssemblerReasonCode.ASSIGNMENT_MISSING,
      message: `Registered strategy ${strategyKey} has unreadable immutable parameters.`
    };
  }

  const asset = await database.asset.findFirst({
    where: { symbol, assetType: AssetType.CRYPTO },
    orderBy: { createdAt: "asc" }
  });
  if (asset === null) {
    return {
      ok: false,
      reasonCode: AssemblerReasonCode.ASSET_RECORD_MISSING,
      message: `No CRYPTO asset row for ${symbol}.`
    };
  }

  // Only an explicit, enabled assignment of the pinned strategy family counts.
  // `Asset.isActive` or discovery membership never substitutes for it
  // (docs/trading/03, StrategyAssignment).
  const assignment = await database.strategyAssignment.findFirst({
    where: {
      assetId: asset.id,
      enabled: true,
      strategy: { key: strategyKey },
      ...(strategyAssignmentId === undefined
        ? {}
        : { id: strategyAssignmentId })
    },
    include: { strategyVersion: true, strategy: true },
    orderBy: { createdAt: "desc" }
  });
  if (assignment === null) {
    return {
      ok: false,
      reasonCode: AssemblerReasonCode.ASSIGNMENT_MISSING,
      message: `No enabled ${strategyKey} assignment for ${symbol}.`
    };
  }

  const [series, signals, marketRegime, executionProfile, contextEvents] =
    await Promise.all([
      loadSeries(database, asset.id, asOf, requestedCandlesPerTimeframe),
      loadSignals(database, asset.id, asOf),
      database.marketRegimeSnapshot.findFirst({
        where: { generatedAt: { lte: asOf } },
        orderBy: { generatedAt: "desc" }
      }),
      database.instrumentExecutionProfile.findFirst({
        where: { assetId: asset.id, status: "ACTIVE" },
        orderBy: { version: "desc" }
      }),
      loadContextEvents(database, asset.id, symbol, asOf)
    ]);

  const multiTimeframeInputs: MultiTimeframeSignalInput[] =
    STRATEGY_TIMEFRAMES.flatMap((timeframe) => {
      const signal = signals[timeframe];
      return signal === null
        ? []
        : [
            {
              symbol: asset.symbol,
              timeframe,
              status: signal.record.status,
              direction: signal.record.direction,
              signalType: signal.record.signalType,
              score: signal.record.score,
              riskLevel: signal.record.riskLevel,
              riskScore: signal.record.riskScore,
              createdAt: signal.record.createdAt
            } as MultiTimeframeSignalInput
          ];
    });

  const multiTimeframe =
    multiTimeframeInputs.length === 0
      ? null
      : calculateMultiTimeframeSummary(multiTimeframeInputs);

  const snapshot: StrategyInputSnapshotV1 = {
    snapshotVersion: STRATEGY_INPUT_SNAPSHOT_VERSION,
    asOf: isoString(asOf),
    asset: {
      id: asset.id,
      symbol: asset.symbol,
      assetType: asset.assetType,
      exchange: asset.exchange,
      provider: asset.provider,
      baseCurrency: asset.baseCurrency,
      quoteCurrency: asset.quoteCurrency,
      instrumentStatus: asset.instrumentStatus,
      isActive: asset.isActive,
      isTradable: asset.isTradable,
      isLeveraged: asset.isLeveraged,
      isInverse: asset.isInverse,
      isStablecoin: asset.isStablecoin
    },
    strategy: {
      strategyId: assignment.strategyId,
      strategyKey: assignment.strategy.key,
      strategyVersionId: assignment.strategyVersionId,
      version: assignment.strategyVersion.version,
      status: assignment.strategyVersion.status,
      engineVersion: assignment.strategyVersion.engineVersion,
      codeVersion,
      specificationHash: assignment.strategyVersion.specificationHash
    },
    assignment: {
      id: assignment.id,
      portfolioId: assignment.portfolioId,
      timeframe: assignment.timeframe,
      enabled: assignment.enabled,
      validFrom:
        assignment.validFrom === null ? null : isoString(assignment.validFrom),
      validTo:
        assignment.validTo === null ? null : isoString(assignment.validTo)
    },
    series: {
      "1h": series["1h"],
      "4h": series["4h"],
      "1d": series["1d"]
    },
    signals: {
      "1h": signals["1h"]?.snapshot ?? null,
      "4h": signals["4h"]?.snapshot ?? null,
      "1d": signals["1d"]?.snapshot ?? null
    },
    multiTimeframe:
      multiTimeframe === null
        ? null
        : {
            version: MULTI_TIMEFRAME_VERSION,
            alignment: multiTimeframe.alignment,
            alignmentScore: normalizedAlignmentScore(
              multiTimeframe.alignmentScore
            ),
            alignmentScoreRaw: multiTimeframe.alignmentScore,
            primaryTimeframe: multiTimeframe.primaryTimeframe,
            confirmingTimeframes: [...multiTimeframe.confirmingTimeframes],
            conflictingTimeframes: [...multiTimeframe.conflictingTimeframes],
            riskLevel: multiTimeframe.riskLevel,
            sourceSignalIds: STRATEGY_TIMEFRAMES.flatMap((timeframe) => {
              const signal = signals[timeframe];
              return signal === null ? [] : [signal.snapshot.id];
            })
          },
    marketRegime:
      marketRegime === null
        ? null
        : {
            id: marketRegime.id,
            generatedAt: isoString(marketRegime.generatedAt),
            equityRegime: marketRegime.equityRegime,
            cryptoRegime: marketRegime.cryptoRegime,
            overallRegime: marketRegime.overallRegime,
            riskMode: marketRegime.riskMode,
            confidence: marketRegime.confidence
          },
    executionProfile:
      executionProfile === null
        ? null
        : {
            id: executionProfile.id,
            version: executionProfile.version,
            status: executionProfile.status,
            tickSize: decimalString(executionProfile.tickSize),
            stepSize: decimalString(executionProfile.stepSize),
            minQuantity: decimalString(executionProfile.minQuantity),
            minNotional: decimalString(executionProfile.minNotional),
            feeBps: executionProfile.feeBps,
            fullSpreadBps: executionProfile.fullSpreadBps,
            slippageBps: executionProfile.slippageBps,
            maxParticipationRate: decimalString(
              executionProfile.maxParticipationRate
            ),
            source: executionProfile.source,
            sourceObservedAt: isoString(executionProfile.sourceObservedAt),
            specificationHash: executionProfile.specificationHash
          },
    contextEvents,
    policyVersions: {
      inputAssemblerVersion: STRATEGY_INPUT_ASSEMBLER_VERSION,
      indicatorVersion: INDICATORS_V1_VERSION,
      multiTimeframeVersion: MULTI_TIMEFRAME_VERSION,
      breakoutPolicyVersion: directionalPolicyVersion,
      freshnessPolicyVersion
    }
  };

  return { ok: true, snapshot };
}

type SnapshotSeriesMap = Record<
  StrategyTimeframe,
  {
    readonly timeframe: StrategyTimeframe;
    readonly candles: SnapshotCandleV1[];
    readonly dataQuality: SnapshotDataQualityV1 | null;
  }
>;

async function loadSeries(
  database: PrismaClient,
  assetId: string,
  asOf: Date,
  requestedCandlesPerTimeframe: number
): Promise<SnapshotSeriesMap> {
  const entries = await Promise.all(
    STRATEGY_TIMEFRAMES.map(async (timeframe) => {
      // Only closed candles enter the snapshot; an open candle would be refused
      // by the engine anyway (docs/trading/05, "Vorvalidierung" item 3).
      const rows = await database.candle.findMany({
        where: { assetId, timeframe, closeTime: { lte: asOf } },
        orderBy: { openTime: "desc" },
        take: requestedCandlesPerTimeframe
      });

      const candles: SnapshotCandleV1[] = rows
        .slice()
        .reverse()
        .map((row) => ({
          id: row.id,
          openTime: isoString(row.openTime),
          closeTime: isoString(row.closeTime),
          open: decimalString(row.open),
          high: decimalString(row.high),
          low: decimalString(row.low),
          close: decimalString(row.close),
          volume: decimalString(row.volume),
          source: row.source
        }));

      const quality = await database.candleDataQuality.findFirst({
        where: { assetId, timeframe },
        orderBy: { updatedAt: "desc" }
      });

      const dataQuality: SnapshotDataQualityV1 | null =
        quality === null
          ? null
          : {
              id: quality.id,
              provider: quality.provider,
              timeframe,
              observedAt: isoString(quality.lastAuditAt ?? quality.updatedAt),
              latestClosedCandle:
                quality.latestClosedCandle === null
                  ? null
                  : isoString(quality.latestClosedCandle),
              candleCount: quality.candleCount,
              expectedCandleCount: quality.expectedCandleCount,
              gapCount: quality.gapCount,
              missingCandleCount: quality.missingCandleCount,
              providerErrorCount: quality.providerErrorCount,
              rateLimitCount: quality.rateLimitCount,
              entitlementErrorCount: quality.entitlementErrorCount,
              noDataCount: quality.noDataCount,
              lastErrorKind: quality.lastErrorKind
            };

      return [timeframe, { timeframe, candles, dataQuality }] as const;
    })
  );

  return Object.fromEntries(entries) as SnapshotSeriesMap;
}

interface LoadedSignal {
  readonly snapshot: SnapshotSignalV1;
  readonly record: {
    readonly status: string;
    readonly direction: string;
    readonly signalType: string;
    readonly score: number;
    readonly riskLevel: string;
    readonly riskScore: number;
    readonly createdAt: Date;
  };
}

async function loadSignals(
  database: PrismaClient,
  assetId: string,
  asOf: Date
): Promise<Record<StrategyTimeframe, LoadedSignal | null>> {
  const entries = await Promise.all(
    STRATEGY_TIMEFRAMES.map(async (timeframe) => {
      const signal = await database.signal.findFirst({
        where: { assetId, timeframe, createdAt: { lte: asOf } },
        orderBy: { createdAt: "desc" },
        include: { ruleApplication: true, output: { select: { id: true } } }
      });
      if (signal === null) return [timeframe, null] as const;

      const rule = signal.ruleApplication;
      const loaded: LoadedSignal = {
        snapshot: {
          id: signal.id,
          timeframe,
          signalType: signal.signalType,
          status: signal.status,
          direction: signal.direction,
          riskLevel: rule?.finalRiskLevel ?? signal.riskLevel,
          baseScore: signal.score,
          adjustedScore: rule?.adjustedScore ?? signal.score,
          adjustedScoreSource:
            rule === null ? "BASE_SCORE" : "RULE_APPLICATION",
          adjustedStatus: rule?.adjustedStatus ?? null,
          riskScore: signal.riskScore,
          ruleApplicationId: rule?.id ?? null,
          outputId: signal.output?.id ?? null,
          createdAt: isoString(signal.createdAt)
        },
        record: {
          status: signal.status,
          direction: signal.direction,
          signalType: signal.signalType,
          score: signal.score,
          riskLevel: signal.riskLevel,
          riskScore: signal.riskScore,
          createdAt: signal.createdAt
        }
      };
      return [timeframe, loaded] as const;
    })
  );

  return Object.fromEntries(entries) as Record<
    StrategyTimeframe,
    LoadedSignal | null
  >;
}

async function loadContextEvents(
  database: PrismaClient,
  assetId: string,
  symbol: string,
  asOf: Date
): Promise<SnapshotContextEventV1[]> {
  const since = new Date(asOf.getTime() - CONTEXT_WINDOW_MS);

  const [radarEvents, marketEvents, newsItems] = await Promise.all([
    database.radarEvent.findMany({
      where: {
        symbol,
        severity: { in: ["IMPORTANT", "CRITICAL"] },
        createdAt: { gte: since, lte: asOf }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    database.marketEvent.findMany({
      where: {
        severity: { in: ["IMPORTANT", "CRITICAL"] },
        detectedAt: { gte: since, lte: asOf }
      },
      orderBy: { detectedAt: "desc" },
      take: 20
    }),
    database.newsItem.findMany({
      where: { assetId, publishedAt: { gte: since, lte: asOf } },
      orderBy: { publishedAt: "desc" },
      take: 20
    })
  ]);

  const events: SnapshotContextEventV1[] = [
    ...radarEvents.map((event) => ({
      kind: "RADAR" as const,
      id: event.id,
      observedAt: isoString(event.createdAt),
      eventType: event.eventType,
      severity: event.severity,
      directionalBias: classifyRadarBias(event.movePercent),
      summary: event.shortMessage
    })),
    ...marketEvents.map((event) => ({
      kind: "MARKET_EVENT" as const,
      id: event.id,
      observedAt: isoString(event.detectedAt),
      eventType: event.eventType,
      severity: event.severity,
      directionalBias: classifyMarketEventBias(
        symbol,
        event.positiveImpact,
        event.negativeImpact
      ),
      summary: event.title
    })),
    ...newsItems.map((item) => ({
      kind: "NEWS" as const,
      id: item.id,
      observedAt: isoString(item.publishedAt),
      eventType: item.category ?? "NEWS",
      // The persisted news model carries no impact severity, so news is
      // evidence only and never blocks on its own.
      severity: "INFO",
      directionalBias: classifyNewsBias(item.sentiment),
      summary: item.headline
    }))
  ];

  // Stable order so the input hash does not depend on query scheduling.
  return events.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
}
