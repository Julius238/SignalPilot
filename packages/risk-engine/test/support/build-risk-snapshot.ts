/**
 * Deterministic `RiskInputSnapshotV1` builder for the risk engine tests.
 *
 * No clock, no randomness, no environment: two calls with the same overrides
 * produce byte-identical snapshots, which the golden and determinism tests rely
 * on (docs/trading/06, "Risk-Engine-Goldenfälle" case 2).
 */

import {
  CRYPTO_MAJOR_GROUP_KEY,
  CRYPTO_MAJOR_MEMBERS,
  RISK_COST_POLICY_VERSION,
  RISK_ENGINE_VERSION,
  RISK_INPUT_SNAPSHOT_VERSION,
  RISK_LIMIT_SET_KEY,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RISK_LIMIT_SET_VERSION,
  RISK_RULE_SET_VERSION,
  RISK_SIZING_POLICY_VERSION,
  type RiskInputSnapshotV1
} from "../../src/index.js";

export const AS_OF = "2026-08-02T09:05:00.000Z";
export const TRADING_DATE_UTC = "2026-08-02";

/** Reference entry and stop taken from a real `CRYPTO_MTF_BREAKOUT_V1` candidate. */
export const REFERENCE_ENTRY = "24100.000000000000";
export const STOP_PRICE = "23598.030000000000";

/**
 * The strategy's own 2R plan. Kept as a named constant because it is the case
 * that fails `R-008` once spread, slippage and round-trip fees are priced in.
 */
export const STRATEGY_V1_TAKE_PROFIT = "25103.940000000000";

/** A take profit wide enough to clear a net reward/risk of 2.0 after costs. */
export const APPROVABLE_TAKE_PROFIT = "25706.300000000000";

export type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

export function clone<T>(value: T): DeepMutable<T> {
  return JSON.parse(JSON.stringify(value)) as DeepMutable<T>;
}

export interface RiskSnapshotOverrides {
  readonly takeProfitPrice?: string;
  readonly equity?: string;
  readonly availableCash?: string;
  readonly symbol?: string;
  readonly assetId?: string;
}

/** A snapshot that satisfies every one of the 26 rules. */
export function buildApprovableSnapshot(
  overrides: RiskSnapshotOverrides = {}
): RiskInputSnapshotV1 {
  const equity = overrides.equity ?? "10000.000000000000";
  const availableCash = overrides.availableCash ?? equity;
  const symbol = overrides.symbol ?? "BTCUSDT";
  const assetId = overrides.assetId ?? "asset-btc";

  return {
    snapshotVersion: RISK_INPUT_SNAPSHOT_VERSION,
    asOf: AS_OF,
    tradingDateUtc: TRADING_DATE_UTC,
    capability: {
      buildCapability: "SHADOW_ONLY",
      tradingMode: "SHADOW",
      enableLiveTrading: false,
      shadowMasterFlagEnabled: true,
      riskJobEnabled: true,
      strategyLongV1Enabled: true,
      strategyShortV1Enabled: false,
      shadowShortEnabled: false,
      exchangeExecutionEnabled: false,
      marginTradingEnabled: false,
      futuresTradingEnabled: false
    },
    candidate: {
      id: "trade-candidate-1",
      candidateKey:
        "candidate.v1|assignment-btcusdt|strategy-version-1|asset-btc|btcusdt-1h-249",
      status: "CREATED",
      direction: "LONG",
      entryType: "MARKET",
      symbol,
      assetId,
      portfolioId: "portfolio-shadow-1",
      strategyAssignmentId: "assignment-btcusdt",
      strategyVersionId: "strategy-version-1",
      strategyVersionStatus: "ACTIVE",
      strategyKey: "CRYPTO_MTF_BREAKOUT_V1",
      strategyDirection: "LONG",
      assignmentEnabled: true,
      assignmentDirection: "LONG",
      anchorCandleId: "btcusdt-1h-249",
      referenceEntryPrice: REFERENCE_ENTRY,
      stopPrice: STOP_PRICE,
      takeProfitPrice: overrides.takeProfitPrice ?? APPROVABLE_TAKE_PROFIT,
      minimumRewardRisk: "2.000000000000",
      stopDistance: "501.970000000000",
      stopDistancePct: "0.020828000000",
      plannedRewardRisk: "2.000000000000",
      plannedEntryMinimum: STOP_PRICE,
      plannedEntryMaximum: "24267.320000000000",
      maximumEntryGapDistance: "167.320000000000",
      validFrom: "2026-08-02T08:59:59.999Z",
      earliestFillAt: "2026-08-02T08:59:59.999Z",
      maxHoldHours: 72,
      dataAsOf: AS_OF,
      decisionTime: AS_OF,
      expiresAt: "2026-08-02T10:59:59.999Z",
      inputHash: "a".repeat(64),
      strategyOutputHash: "b".repeat(64),
      strategySpecificationHash: "c".repeat(64),
      strategyEngineVersion: "crypto-mtf-breakout-v1/1.0.0",
      hasFinalDecision: false
    },
    asset: {
      id: assetId,
      symbol,
      assetType: "CRYPTO",
      quoteCurrency: "USDT",
      isTradable: true,
      isActive: true,
      isLeveraged: false,
      isInverse: false,
      isStablecoin: false,
      instrumentStatus: "ACTIVE"
    },
    session: {
      id: "session-1",
      sessionKey: "trading-session.v1|portfolio-shadow-1|1",
      portfolioId: "portfolio-shadow-1",
      mode: "SHADOW",
      status: "SHADOW_ACTIVE",
      killSwitchEngaged: false,
      reconciledAt: "2026-08-02T09:03:00.000Z",
      heartbeatAt: "2026-08-02T09:04:30.000Z",
      version: 2
    },
    portfolio: {
      id: "portfolio-shadow-1",
      key: "SHADOW_V1",
      status: "ACTIVE",
      baseCurrency: "USDT",
      startingCash: "10000.000000000000",
      availableCash,
      reservedCash: "0.000000000000",
      realizedPnl: "0.000000000000",
      feesPaid: "0.000000000000",
      equity,
      highWaterMark: equity,
      ledgerSequence: 1,
      lastReconciledAt: "2026-08-02T09:03:00.000Z",
      version: 1
    },
    ledgerReplay: {
      sequence: 1,
      entryCount: 1,
      availableCash,
      reservedCash: "0.000000000000",
      realizedPnl: "0.000000000000",
      feesPaid: "0.000000000000",
      orphanReferenceCount: 0,
      sequenceGapCount: 0
    },
    startOfDay: {
      asOf: "2026-08-02T00:02:00.000Z",
      sourceLedgerSequence: 1,
      equity: "10000.000000000000"
    },
    openPositions: [],
    reservations: [],
    dailyCounters: {
      tradingDateUtc: TRADING_DATE_UTC,
      filledEntryOrdersToday: 0,
      consecutiveLosses: 0,
      dailyPnl: "0.000000000000",
      closedTradeSequence: 0
    },
    executionProfile: {
      id: "execution-profile-btc",
      assetId,
      version: 1,
      status: "ACTIVE",
      tickSize: "0.010000000000",
      stepSize: "0.000010000000",
      minQuantity: "0.000010000000",
      minNotional: "10.000000000000",
      maxQuantity: null,
      feeBps: 10,
      fullSpreadBps: 10,
      slippageBps: 10,
      maxParticipationRate: "0.010000000000",
      sourceObservedAt: "2026-08-01T00:00:00.000Z",
      specificationHash: "d".repeat(64)
    },
    riskLimitSet: {
      id: "risk-limit-set-1",
      key: RISK_LIMIT_SET_KEY,
      version: RISK_LIMIT_SET_VERSION,
      status: "ACTIVE",
      scope: "PORTFOLIO",
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
      specificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH
    },
    freshness: {
      candleAgeMs: { "1h": 300_001, "4h": 3_900_001, "1d": 32_700_001 },
      dataQualityAgeMs: 300_000,
      regimeAgeMs: 300_000,
      portfolioSnapshotAgeMs: 120_000,
      hasFutureTimestamp: false
    },
    dataQuality: {
      minimumClosedCandles: { "1h": 250, "4h": 250, "1d": 250 },
      gapCount: { "1h": 0, "4h": 0, "1d": 0 },
      providerErrorCount: { "1h": 0, "4h": 0, "1d": 0 },
      ohlcContradiction: false
    },
    marketRegime: {
      id: "regime-1",
      generatedAt: "2026-08-02T09:00:00.000Z",
      cryptoRegime: "RISK_ON",
      riskMode: "NORMAL",
      confidence: 72
    },
    correlationGroup: {
      key: CRYPTO_MAJOR_GROUP_KEY,
      memberSymbols: [...CRYPTO_MAJOR_MEMBERS]
    },
    sizeOverride: {
      manualQuantity: null,
      riskMultiplier: null,
      requestedBy: null
    },
    previousApproval: null,
    existingAssessment: null,
    policyVersions: {
      riskEngineVersion: RISK_ENGINE_VERSION,
      ruleSetVersion: RISK_RULE_SET_VERSION,
      sizingPolicyVersion: RISK_SIZING_POLICY_VERSION,
      costPolicyVersion: RISK_COST_POLICY_VERSION,
      inputAssemblerVersion: "risk-input-assembler-v1/1.0.0",
      codeVersion: "test-code-version"
    }
  };
}

/** Mirror-image, fully gated synthetic SHORT snapshot for RISK_OFF. */
export function buildApprovableShortSnapshot(): RiskInputSnapshotV1 {
  const snapshot = clone(buildApprovableSnapshot()) as RiskInputSnapshotV1;
  return {
    ...snapshot,
    capability: {
      ...snapshot.capability,
      strategyLongV1Enabled: false,
      strategyShortV1Enabled: true,
      shadowShortEnabled: true
    },
    candidate: {
      ...snapshot.candidate,
      candidateKey:
        "candidate.v1|assignment-btcusdt-short|strategy-version-short-1|asset-btc|btcusdt-1h-249",
      direction: "SHORT",
      strategyAssignmentId: "assignment-btcusdt-short",
      strategyVersionId: "strategy-version-short-1",
      strategyKey: "CRYPTO_MTF_BREAKDOWN_SHORT_V1",
      strategyDirection: "SHORT",
      assignmentDirection: "SHORT",
      referenceEntryPrice: "24100.000000000000",
      stopPrice: "24602.000000000000",
      takeProfitPrice: "22400.000000000000",
      plannedEntryMinimum: "23932.680000000000",
      plannedEntryMaximum: "24602.000000000000",
      strategyEngineVersion: "crypto-mtf-breakdown-short-v1/1.0.0"
    },
    marketRegime:
      snapshot.marketRegime === null
        ? null
        : {
            ...snapshot.marketRegime,
            cryptoRegime: "RISK_OFF"
          }
  };
}

/** An open BTC position that ties up `marketValue` USDT. */
export function openPosition(overrides: {
  readonly assetId?: string;
  readonly symbol?: string;
  readonly marketValue: string;
  readonly status?: string;
}) {
  return {
    id: `position-${overrides.symbol ?? "ETHUSDT"}`,
    positionKey: `shadow-position.v1|portfolio-shadow-1|${overrides.assetId ?? "asset-eth"}|order-1`,
    assetId: overrides.assetId ?? "asset-eth",
    symbol: overrides.symbol ?? "ETHUSDT",
    status: overrides.status ?? "OPEN",
    direction: "LONG",
    openQuantity: "1.000000000000",
    averageEntryPrice: overrides.marketValue,
    marketValue: overrides.marketValue,
    equityContribution: overrides.marketValue,
    reservedCollateral: "0.000000000000"
  };
}
