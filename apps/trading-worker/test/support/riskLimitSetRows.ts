/**
 * A stored `RiskLimitSet` row exactly as Prisma returns the pinned v1 policy:
 * `Decimal(30,12)` columns as `Prisma.Decimal`, which the worker renders as
 * `0.002500000000`. Tests that need a deviating row override single fields.
 */

import { Prisma } from "@signalpilot/database";
import {
  RISK_LIMIT_SET_KEY,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RISK_LIMIT_SET_VERSION
} from "@signalpilot/risk-engine";

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

export function pinnedRiskLimitSetRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
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
    maxGrossExposurePct: decimal(RISK_LIMIT_SET_V1.maxGrossExposurePct),
    maxAssetExposurePct: decimal(RISK_LIMIT_SET_V1.maxAssetExposurePct),
    maxCorrelatedExposurePct: decimal(RISK_LIMIT_SET_V1.maxCorrelatedExposurePct),
    maxSpreadBps: RISK_LIMIT_SET_V1.maxSpreadBps,
    maxSlippageBps: RISK_LIMIT_SET_V1.maxSlippageBps,
    specificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH,
    ...overrides
  };
}
