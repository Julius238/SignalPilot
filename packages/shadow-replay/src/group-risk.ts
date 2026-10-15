/**
 * Stage 2 of the portfolio replay: the limits that genuinely span several
 * strategy portfolios — capital, exposure and the daily loss of the whole
 * group — checked with the **unchanged** rule functions of the risk engine.
 *
 * Stage 1 is the complete `evaluateRisk` against the candidate's own
 * portfolio, exactly as live. Stage 2 runs only after a stage-1 approval,
 * never changes the approved quantity and can only reject. Specification and
 * the rule-by-rule selection: docs/trading/research/2026-10-15-evolution-gates-v4-draft.md
 * (sections 4.2–4.6).
 *
 * Why not `evaluateRisk` on a group snapshot: it would size a new quantity from
 * the group equity, and its per-portfolio exclusivity rules (R-011, R-012,
 * R-021, R-022 and the duplicate-asset branch of R-014) would stop a
 * strategy only because another, independent portfolio holds the same asset.
 */

import {
  RISK_RULES,
  RiskRuleCode,
  type RiskDirective,
  type RiskEvaluationContext,
  type RiskInputSnapshotV1,
  type RiskSizingResultV1,
  type RuleVerdict
} from "@signalpilot/risk-engine";
import { DecimalValue, canonicalHash } from "@signalpilot/trading-domain";

export const GROUP_RISK_VERSION = "group-risk-v1/1.0.0";

/**
 * The cross-portfolio rules. Every other rule is either about the candidate's
 * own portfolio (sizing basis, position count, trades per day, loss streak,
 * scale-in, ledger, version) or about the candidate itself (mode, data,
 * regime, reward/risk) and is fully checked in stage 1.
 */
export const GROUP_RISK_RULE_CODES = Object.freeze([
  RiskRuleCode.DAILY_LOSS,
  RiskRuleCode.GROSS_EXPOSURE,
  RiskRuleCode.ASSET_EXPOSURE,
  RiskRuleCode.CORRELATION
] as const);

export interface GroupPosition {
  readonly assetId: string;
  readonly symbol: string;
  readonly status: string;
  readonly openQuantity: string;
  readonly marketValue: string;
  readonly equityContribution: string;
  readonly reservedCollateral: string;
}

export interface GroupReservation {
  readonly assetId: string;
  readonly symbol: string;
  readonly purpose: string;
  readonly reservedQuoteAmount: string;
}

/** All strategy portfolios of the comparison frame (and its unallocated reserve) as one capital pool. */
export interface GroupRiskView {
  readonly equity: string;
  readonly availableCash: string;
  readonly reservedCash: string;
  readonly startOfDay: { readonly asOf: string; readonly equity: string } | null;
  readonly dailyPnl: string;
  readonly positions: readonly GroupPosition[];
  readonly reservations: readonly GroupReservation[];
}

export interface GroupRiskInput {
  readonly asOfMs: number;
  /** The candidate's stage-1 risk input (its own portfolio). */
  readonly snapshot: RiskInputSnapshotV1;
  /** The stage-1 sizing; its quantity is never changed. */
  readonly sizing: RiskSizingResultV1;
  /**
   * Whether the candidate's **own** portfolio already holds the asset — the
   * meaning `assetAlreadyOpen` has in `evaluateRisk`. After a stage-1 approval
   * it is always false (R-014 and R-022 of stage 1 rule it out).
   */
  readonly ownPortfolioHoldsAsset: boolean;
  readonly group: GroupRiskView;
}

export interface GroupRuleVerdict extends RuleVerdict {
  readonly ruleCode: string;
}

export interface GroupRiskResult {
  readonly version: string;
  readonly passed: boolean;
  readonly directive: RiskDirective;
  readonly verdicts: readonly GroupRuleVerdict[];
  /** `ruleCode:reasonCode` of every FAIL or ERROR. */
  readonly failedRules: readonly string[];
}

const ZERO = DecimalValue.ZERO;
const decimalOrZero = (value: string | null | undefined): DecimalValue =>
  value === null || value === undefined || !DecimalValue.isDecimalString(value) ? ZERO : DecimalValue.fromString(value);
const sumDecimals = (values: readonly string[]): DecimalValue => values.reduce<DecimalValue>((total, value) => total.add(decimalOrZero(value)), ZERO);
// Same test `evaluateRisk` applies before counting a position as exposure.
const carriesExposure = (position: { readonly openQuantity: string; readonly status: string }): boolean =>
  decimalOrZero(position.openQuantity).isPositive() || position.status === "ERROR";

const DIRECTIVE_RANK: Readonly<Record<RiskDirective, number>> = { NONE: 0, BLOCK_NEW: 1, ENGAGE_KILL_SWITCH: 2, ERROR_LOCK: 3 };

/**
 * The rule context of the group view. Exposure aggregation uses the same
 * formulas as `evaluateRisk` (market value of every position that carries
 * exposure plus pending ENTRY reservations, filtered by asset or correlation
 * group); the post-trade values add the stage-1 notional to the group totals.
 */
export function buildGroupRiskContext(input: GroupRiskInput): RiskEvaluationContext {
  const { snapshot, sizing, group } = input;
  const exposurePositions = group.positions.filter(carriesExposure);
  const assetId = snapshot.candidate.assetId;
  const groupSymbols = new Set(snapshot.correlationGroup?.memberSymbols ?? []);
  const entryReservations = group.reservations.filter((reservation) => reservation.purpose === "ENTRY");

  const marketValue = sumDecimals(exposurePositions.map((position) => position.marketValue));
  const equityContribution = sumDecimals(exposurePositions.map((position) => position.equityContribution));
  const totalReserved = sumDecimals([
    ...group.reservations.map((reservation) => reservation.reservedQuoteAmount),
    ...exposurePositions.map((position) => position.reservedCollateral)
  ]);
  const grossExposure = marketValue.add(sumDecimals(entryReservations.map((reservation) => reservation.reservedQuoteAmount)));
  const assetExposure = sumDecimals(exposurePositions.filter((position) => position.assetId === assetId).map((position) => position.marketValue)).add(
    sumDecimals(entryReservations.filter((reservation) => reservation.assetId === assetId).map((reservation) => reservation.reservedQuoteAmount))
  );
  const correlatedExposure = sumDecimals(
    exposurePositions.filter((position) => groupSymbols.has(position.symbol)).map((position) => position.marketValue)
  ).add(sumDecimals(entryReservations.filter((reservation) => groupSymbols.has(reservation.symbol)).map((reservation) => reservation.reservedQuoteAmount)));

  const notional = decimalOrZero(sizing.notional);
  const groupSizing: RiskSizingResultV1 = {
    ...sizing,
    postTradeGrossExposure: grossExposure.add(notional).toString(),
    postTradeAssetExposure: assetExposure.add(notional).toString(),
    postTradeCorrelatedExposure: correlatedExposure.add(notional).toString()
  };
  const groupSnapshot: RiskInputSnapshotV1 = {
    ...snapshot,
    startOfDay:
      group.startOfDay === null
        ? null
        : {
            asOf: group.startOfDay.asOf,
            sourceLedgerSequence: snapshot.startOfDay?.sourceLedgerSequence ?? 0,
            equity: group.startOfDay.equity
          },
    dailyCounters: { ...snapshot.dailyCounters, dailyPnl: group.dailyPnl }
  };
  const openPositionCount = exposurePositions.length;
  return {
    snapshot: groupSnapshot,
    asOfMs: input.asOfMs,
    sizing: groupSizing,
    equity: decimalOrZero(group.equity),
    availableCash: decimalOrZero(group.availableCash),
    reservedCash: decimalOrZero(group.reservedCash),
    dailyPnl: decimalOrZero(group.dailyPnl),
    grossExposure,
    assetExposure,
    correlatedExposure,
    openPositionCount,
    postTradeOpenPositionCount: openPositionCount + (input.ownPortfolioHoldsAsset ? 0 : 1),
    assetAlreadyOpen: input.ownPortfolioHoldsAsset,
    totalReserved,
    marketValue,
    equityContribution,
    inputHash: canonicalHash({ engine: GROUP_RISK_VERSION, candidateKey: snapshot.candidate.candidateKey, asOf: snapshot.asOf, group })
  };
}

/** Stage 2: the four cross-portfolio rules, unchanged, on the group context. Only PASS keeps the entry. */
export function evaluateGroupRisk(input: GroupRiskInput): GroupRiskResult {
  const context = buildGroupRiskContext(input);
  const verdicts: GroupRuleVerdict[] = GROUP_RISK_RULE_CODES.map((ruleCode) => {
    const rule = RISK_RULES[ruleCode];
    if (rule === undefined) throw new Error(`Risk rule ${ruleCode} is missing from the risk engine.`);
    return { ruleCode, ...rule(context) };
  });
  let directive: RiskDirective = "NONE";
  for (const verdict of verdicts) {
    if (verdict.directive !== undefined && DIRECTIVE_RANK[verdict.directive] > DIRECTIVE_RANK[directive]) directive = verdict.directive;
  }
  const failed = verdicts.filter((verdict) => verdict.outcome === "FAIL" || verdict.outcome === "ERROR");
  return {
    version: GROUP_RISK_VERSION,
    passed: failed.length === 0,
    directive,
    verdicts,
    failedRules: failed.map((verdict) => `${verdict.ruleCode}:${verdict.reasonCode}`)
  };
}
