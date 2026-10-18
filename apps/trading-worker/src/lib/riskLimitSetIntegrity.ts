/**
 * One mapping and one integrity check for stored `RiskLimitSet` rows.
 *
 * Specification: docs/trading/decisions/0021-risk-limit-set-value-integrity.md
 *
 * The risk input assembler, the eligibility report, the post-fill recheck and
 * the bootstrap all read the same row shape, so they share this mapping and
 * the engine's pure `riskLimitSetDeviations`. The trusted reference is the
 * pinned `RISK_LIMIT_SET_V1` in the risk engine, never the row: a row that
 * copies the expected hash but carries other numbers is refused.
 *
 * The mapping never invents a value. A decimal column that is neither a
 * Prisma `Decimal` nor a plain string is passed on as its string form, which
 * the integrity check refuses, instead of being defaulted to zero.
 */

import {
  riskLimitSetDeviations,
  type RiskLimitSetInputV1,
  type RiskLimitSetIntegrityField
} from "@signalpilot/risk-engine";

/** The columns of a `RiskLimitSet` row that the risk path reads. */
export interface RiskLimitSetRow {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly status: string;
  readonly scope: string;
  readonly maxRiskPerTradePct: unknown;
  readonly maxDailyLossPct: unknown;
  readonly minRewardRisk: unknown;
  readonly maxOpenPositions: number;
  readonly maxNewTradesPerDay: number;
  readonly maxConsecutiveLosses: number;
  readonly maxGrossExposurePct: unknown;
  readonly maxAssetExposurePct: unknown;
  readonly maxCorrelatedExposurePct: unknown;
  readonly maxSpreadBps: number;
  readonly maxSlippageBps: number;
  readonly specificationHash: string;
}

/**
 * `Decimal(30,12)` as the 12-place string the snapshot always carried; a
 * plain string is kept as it is and judged by value later.
 */
function limitDecimal(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  ) {
    return (value as { toFixed: (digits: number) => string }).toFixed(12);
  }
  if (typeof value === "number") return value.toFixed(12);
  return String(value);
}

/** The snapshot form of a stored row, identical for every caller. */
export function riskLimitSetInputFromRow(
  row: RiskLimitSetRow
): RiskLimitSetInputV1 {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    status: row.status,
    scope: row.scope,
    maxRiskPerTradePct: limitDecimal(row.maxRiskPerTradePct),
    maxDailyLossPct: limitDecimal(row.maxDailyLossPct),
    minRewardRisk: limitDecimal(row.minRewardRisk),
    maxOpenPositions: row.maxOpenPositions,
    maxNewTradesPerDay: row.maxNewTradesPerDay,
    maxConsecutiveLosses: row.maxConsecutiveLosses,
    maxGrossExposurePct: limitDecimal(row.maxGrossExposurePct),
    maxAssetExposurePct: limitDecimal(row.maxAssetExposurePct),
    maxCorrelatedExposurePct: limitDecimal(row.maxCorrelatedExposurePct),
    maxSpreadBps: row.maxSpreadBps,
    maxSlippageBps: row.maxSlippageBps,
    specificationHash: row.specificationHash
  };
}

/** Fields in which a stored row deviates from the pinned v1 policy; empty = approved. */
export function riskLimitSetRowDeviations(
  row: RiskLimitSetRow
): readonly RiskLimitSetIntegrityField[] {
  return riskLimitSetDeviations(riskLimitSetInputFromRow(row));
}
