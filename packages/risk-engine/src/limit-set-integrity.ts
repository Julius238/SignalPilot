/**
 * Integrity check of a stored risk limit set against the pinned v1 policy.
 *
 * Specification:
 *   docs/trading/decisions/0021-risk-limit-set-value-integrity.md, option A
 *   docs/trading/06-risk-engine-specification.md, "Verbindliches Limitset v1"
 *   and `R-026-IDEMPOTENCY-VERSION`
 *
 * The trusted reference is the code constant `RISK_LIMIT_SET_V1`, never the
 * row itself. A stored `specificationHash` is only an identity label: a row
 * that copies the expected hash but carries other numbers must not vouch for
 * itself, so every field is compared on its own. Decimal limits are compared
 * by value because the database returns `Decimal(30,12)` as
 * `0.002500000000` while the constant reads `0.0025`. Anything that is not a
 * plain decimal string counts as a deviation; nothing is defaulted.
 *
 * Pure: no database, clock or environment, and it never throws on malformed
 * input.
 */

import { DecimalValue } from "@signalpilot/trading-domain";

import type { RiskLimitSetInputV1 } from "./contracts.js";
import {
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1
} from "./policy-v1.js";

/** Fields that must equal the pinned value exactly (identity and integer limits). */
export const RISK_LIMIT_SET_EXACT_FIELDS = Object.freeze([
  "key",
  "version",
  "scope",
  "maxOpenPositions",
  "maxNewTradesPerDay",
  "maxConsecutiveLosses",
  "maxSpreadBps",
  "maxSlippageBps"
] as const);

/** Fields compared as decimal values, independent of their string scale. */
export const RISK_LIMIT_SET_DECIMAL_FIELDS = Object.freeze([
  "maxRiskPerTradePct",
  "maxDailyLossPct",
  "minRewardRisk",
  "maxGrossExposurePct",
  "maxAssetExposurePct",
  "maxCorrelatedExposurePct"
] as const);

export type RiskLimitSetIntegrityField =
  | (typeof RISK_LIMIT_SET_EXACT_FIELDS)[number]
  | (typeof RISK_LIMIT_SET_DECIMAL_FIELDS)[number]
  | "specificationHash";

/** The part of a limit set the integrity check reads; `id` and `status` are not policy. */
export type RiskLimitSetIntegrityInput = Pick<
  RiskLimitSetInputV1,
  RiskLimitSetIntegrityField
>;

function sameDecimal(actual: unknown, pinned: string): boolean {
  if (!DecimalValue.isDecimalString(actual)) return false;
  try {
    return DecimalValue.fromString(actual).eq(DecimalValue.fromString(pinned));
  } catch {
    return false;
  }
}

/**
 * Fields in which `set` deviates from `RISK_LIMIT_SET_V1`, in a stable order.
 * An empty list means the set is the approved v1 policy; any entry — looser
 * or stricter — means it is not.
 */
export function riskLimitSetDeviations(
  set: RiskLimitSetIntegrityInput
): readonly RiskLimitSetIntegrityField[] {
  const deviations: RiskLimitSetIntegrityField[] = [];
  for (const field of RISK_LIMIT_SET_EXACT_FIELDS) {
    if (set[field] !== RISK_LIMIT_SET_V1[field]) deviations.push(field);
  }
  for (const field of RISK_LIMIT_SET_DECIMAL_FIELDS) {
    if (!sameDecimal(set[field], RISK_LIMIT_SET_V1[field])) deviations.push(field);
  }
  if (set.specificationHash !== RISK_LIMIT_SET_SPECIFICATION_HASH) {
    deviations.push("specificationHash");
  }
  return deviations;
}
