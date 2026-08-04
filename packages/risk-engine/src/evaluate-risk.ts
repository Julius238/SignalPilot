/**
 * `evaluateRisk` — the single pure entry point of the risk engine.
 *
 * Specification: docs/trading/06-risk-engine-specification.md, "Vertrag" and
 * "Auswertungssemantik"; docs/trading/03-domain-model.md for the drafted rows.
 *
 * The function computes exposures, sizes the position conservatively, runs all
 * 26 rules and aggregates one verdict. It never persists anything, never reads
 * a clock and never returns a partially evaluated rule list: the output always
 * carries exactly `RISK_RULE_COUNT` results in `RISK_RULE_ORDER`.
 */

import {
  DecimalValue,
  buildAssessmentKey,
  buildDecisionHash,
  buildDecisionKey,
  buildInputHash,
  buildOutputHash
} from "@signalpilot/trading-domain";

import {
  RISK_INPUT_SNAPSHOT_VERSION,
  type RiskAssessmentDraftV1,
  type RiskEvaluationResultV1,
  type RiskInputSnapshotV1,
  type RiskRuleResultDraftV1,
  type RiskSizingResultV1,
  type TradeDecisionDraftV1
} from "./contracts.js";
import { computePositionSizing } from "./position-sizing.js";
import {
  RISK_ENGINE_VERSION,
  RISK_POLICY_HASH,
  RISK_RULE_SET_VERSION
} from "./policy-v1.js";
import {
  RISK_RULE_ORDER,
  RiskEvaluationOutcome,
  RiskReasonCode,
  type RiskRuleCode
} from "./reason-codes.js";
import {
  RISK_RULES,
  toRuleResult,
  type RiskDirective,
  type RiskEvaluationContext
} from "./rules.js";

const ZERO = DecimalValue.ZERO;

const decimalOrZero = (value: string | null | undefined): DecimalValue => {
  if (
    value === null ||
    value === undefined ||
    !DecimalValue.isDecimalString(value)
  )
    return ZERO;
  try {
    return DecimalValue.fromString(value);
  } catch {
    return ZERO;
  }
};

const DIRECTIVE_RANK: Readonly<Record<RiskDirective, number>> = {
  NONE: 0,
  BLOCK_NEW: 1,
  ENGAGE_KILL_SWITCH: 2,
  ERROR_LOCK: 3
};

/** A position still ties up capital while it holds quantity or sits in ERROR. */
const carriesExposure = (position: {
  openQuantity: string;
  status: string;
}): boolean =>
  decimalOrZero(position.openQuantity).isPositive() ||
  position.status === "ERROR";

function sumDecimals(values: readonly string[]): DecimalValue {
  return values.reduce<DecimalValue>(
    (total, value) => total.add(decimalOrZero(value)),
    ZERO
  );
}

/** Assessment key placeholder when no risk limit set is available. */
const MISSING_LIMIT_SET_ID = "MISSING-RISK-LIMIT-SET";

export function evaluateRisk(
  snapshot: RiskInputSnapshotV1
): RiskEvaluationResultV1 {
  const evaluatedAt =
    typeof snapshot?.asOf === "string"
      ? snapshot.asOf
      : "1970-01-01T00:00:00.000Z";

  // The `existingAssessment` probe describes what is already stored; it must not
  // change the hash it is compared against, otherwise a conflict could never
  // be detected (docs/trading/02, "Idempotenz und Concurrency").
  const { existingAssessment: _probe, ...hashedInput } = snapshot ?? {};
  void _probe;
  const inputHash = buildInputHash(hashedInput);

  if (snapshot?.snapshotVersion !== RISK_INPUT_SNAPSHOT_VERSION) {
    return unreadableSnapshot(snapshot, inputHash, evaluatedAt);
  }

  // ── Exposure, derived from positions and live order reservations ─────────
  const exposurePositions = snapshot.openPositions.filter(carriesExposure);
  const assetId = snapshot.candidate.assetId;
  const groupSymbols = new Set(snapshot.correlationGroup?.memberSymbols ?? []);

  const marketValue = sumDecimals(
    exposurePositions.map((position) => position.marketValue)
  );
  const equityContribution = sumDecimals(
    exposurePositions.map((position) => position.equityContribution)
  );
  const totalReserved = sumDecimals([
    ...snapshot.reservations.map(
      (reservation) => reservation.reservedQuoteAmount
    ),
    ...exposurePositions.map((position) => position.reservedCollateral)
  ]);
  const entryOrderReserve = sumDecimals(
    snapshot.reservations
      .filter((reservation) => reservation.purpose === "ENTRY")
      .map((reservation) => reservation.reservedQuoteAmount)
  );

  // Synthetic-short collateral is already cash backing, not a second market
  // exposure. Gross exposure is absolute position notional plus pending ENTRY
  // reserves; LONG and SHORT market values are never netted.
  const grossExposure = marketValue.add(entryOrderReserve);
  const assetExposure = sumDecimals(
    exposurePositions
      .filter((position) => position.assetId === assetId)
      .map((p) => p.marketValue)
  ).add(
    sumDecimals(
      snapshot.reservations
        .filter(
          (reservation) =>
            reservation.assetId === assetId && reservation.purpose === "ENTRY"
        )
        .map((reservation) => reservation.reservedQuoteAmount)
    )
  );
  const correlatedExposure = sumDecimals(
    exposurePositions
      .filter((position) => groupSymbols.has(position.symbol))
      .map((p) => p.marketValue)
  ).add(
    sumDecimals(
      snapshot.reservations
        .filter(
          (reservation) =>
            groupSymbols.has(reservation.symbol) &&
            reservation.purpose === "ENTRY"
        )
        .map((reservation) => reservation.reservedQuoteAmount)
    )
  );

  const assetAlreadyOpen = exposurePositions.some(
    (position) => position.assetId === assetId
  );
  const openPositionCount = exposurePositions.length;

  const equity = decimalOrZero(snapshot.portfolio.equity);
  const availableCash = decimalOrZero(snapshot.portfolio.availableCash);
  const reservedCash = decimalOrZero(snapshot.portfolio.reservedCash);
  const dailyPnl = decimalOrZero(snapshot.dailyCounters.dailyPnl);

  // ── Conservative sizing ──────────────────────────────────────────────────
  const profile = snapshot.executionProfile;
  const limits = snapshot.riskLimitSet;
  const sizing: RiskSizingResultV1 =
    profile === null || limits === null
      ? computePositionSizing({
          direction:
            snapshot?.candidate?.direction === "SHORT" ? "SHORT" : "LONG",
          // Deliberately unsatisfiable so the result reports `computable: false`
          // instead of inventing a cost model.
          referenceEntryPrice: ZERO,
          stopPrice: ZERO,
          takeProfitPrice: ZERO,
          equity: ZERO,
          availableCash: ZERO,
          currentGrossExposure: ZERO,
          currentAssetExposure: ZERO,
          currentCorrelatedExposure: ZERO,
          maxRiskPerTradePct: ZERO,
          maxGrossExposurePct: ZERO,
          maxAssetExposurePct: ZERO,
          maxCorrelatedExposurePct: ZERO,
          tickSize: ZERO,
          stepSize: ZERO,
          minQuantity: ZERO,
          minNotional: ZERO,
          maxQuantity: null,
          feeBps: 0,
          fullSpreadBps: 0,
          slippageBps: 0
        })
      : computePositionSizing({
          direction:
            snapshot.candidate.direction === "SHORT"
              ? "SHORT"
              : snapshot.candidate.direction === "LONG"
                ? "LONG"
                : (snapshot.candidate.direction as "LONG"),
          referenceEntryPrice: decimalOrZero(
            snapshot.candidate.referenceEntryPrice
          ),
          stopPrice: decimalOrZero(snapshot.candidate.stopPrice),
          takeProfitPrice: decimalOrZero(snapshot.candidate.takeProfitPrice),
          equity,
          availableCash,
          currentGrossExposure: grossExposure,
          currentAssetExposure: assetExposure,
          currentCorrelatedExposure: correlatedExposure,
          maxRiskPerTradePct: decimalOrZero(limits.maxRiskPerTradePct),
          maxGrossExposurePct: decimalOrZero(limits.maxGrossExposurePct),
          maxAssetExposurePct: decimalOrZero(limits.maxAssetExposurePct),
          maxCorrelatedExposurePct: decimalOrZero(
            limits.maxCorrelatedExposurePct
          ),
          tickSize: decimalOrZero(profile.tickSize),
          stepSize: decimalOrZero(profile.stepSize),
          minQuantity: decimalOrZero(profile.minQuantity),
          minNotional: decimalOrZero(profile.minNotional),
          maxQuantity:
            profile.maxQuantity === null
              ? null
              : decimalOrZero(profile.maxQuantity),
          feeBps: profile.feeBps,
          fullSpreadBps: profile.fullSpreadBps,
          slippageBps: profile.slippageBps
        });

  const asOfMs = Date.parse(snapshot.asOf);
  const context: RiskEvaluationContext = {
    snapshot,
    asOfMs: Number.isFinite(asOfMs) ? asOfMs : 0,
    sizing,
    equity,
    availableCash,
    reservedCash,
    dailyPnl,
    grossExposure,
    assetExposure,
    correlatedExposure,
    openPositionCount,
    postTradeOpenPositionCount: openPositionCount + (assetAlreadyOpen ? 0 : 1),
    assetAlreadyOpen,
    totalReserved,
    marketValue,
    equityContribution,
    inputHash
  };

  // ── Run all 26 rules, in order, always ───────────────────────────────────
  const ruleResults: RiskRuleResultDraftV1[] = [];
  let directive: RiskDirective = "NONE";
  let hasError = false;
  let hasFail = false;
  let primaryReasonCode: RiskReasonCode | null = null;

  for (const ruleCode of RISK_RULE_ORDER) {
    const rule = RISK_RULES[ruleCode];
    const verdict = rule(context);
    ruleResults.push(toRuleResult(ruleCode, verdict, evaluatedAt));

    if (
      verdict.directive !== undefined &&
      DIRECTIVE_RANK[verdict.directive] > DIRECTIVE_RANK[directive]
    ) {
      directive = verdict.directive;
    }
    if (verdict.outcome === "ERROR") {
      hasError = true;
      primaryReasonCode ??= verdict.reasonCode;
    } else if (verdict.outcome === "FAIL") {
      hasFail = true;
      primaryReasonCode ??= verdict.reasonCode;
    }
  }

  const outcome = hasError
    ? RiskEvaluationOutcome.ERROR
    : hasFail
      ? RiskEvaluationOutcome.REJECTED
      : RiskEvaluationOutcome.APPROVED;

  // An unresolved error must at least stop new exposure.
  if (
    outcome === RiskEvaluationOutcome.ERROR &&
    DIRECTIVE_RANK[directive] < DIRECTIVE_RANK.BLOCK_NEW
  ) {
    directive = "BLOCK_NEW";
  }

  const reasonCode = primaryReasonCode ?? RiskReasonCode.RISK_APPROVED;

  // Only an approval carries a quantity. A rejected or errored assessment
  // records the size it would have taken as `requestedQuantity` and approves 0.
  const approvedQuantity =
    outcome === RiskEvaluationOutcome.APPROVED
      ? sizing.approvedQuantity
      : ZERO.toString();
  const riskAmount =
    outcome === RiskEvaluationOutcome.APPROVED
      ? sizing.riskAmount
      : ZERO.toString();

  const riskLimitSetId = limits?.id ?? null;
  const assessmentKey = buildAssessmentKey({
    tradeCandidateId: snapshot.candidate.id,
    riskLimitSetId: riskLimitSetId ?? MISSING_LIMIT_SET_ID,
    inputHash
  });

  const assessmentCore = {
    assessmentKey,
    tradeCandidateId: snapshot.candidate.id,
    portfolioId: snapshot.portfolio.id,
    riskLimitSetId,
    status:
      outcome === RiskEvaluationOutcome.APPROVED
        ? "PASS"
        : outcome === RiskEvaluationOutcome.REJECTED
          ? "FAIL"
          : "ERROR",
    ruleSetVersion: RISK_RULE_SET_VERSION,
    equity: equity.toString(),
    availableCash: availableCash.toString(),
    reservedCash: reservedCash.toString(),
    dailyPnl: dailyPnl.toString(),
    openPositionCount,
    newTradesToday: snapshot.dailyCounters.filledEntryOrdersToday,
    consecutiveLosses: snapshot.dailyCounters.consecutiveLosses,
    grossExposure: grossExposure.toString(),
    assetExposure: assetExposure.toString(),
    correlatedExposure: correlatedExposure.toString(),
    requestedQuantity: sizing.approvedQuantity,
    approvedQuantity,
    riskAmount,
    tradingDateUtc: snapshot.tradingDateUtc,
    portfolioSnapshotAsOf: snapshot.startOfDay?.asOf ?? snapshot.asOf,
    marketDataAsOf: snapshot.candidate.dataAsOf,
    sizing,
    inputHash,
    assessedAt: evaluatedAt
  } as const;

  const outputCore = {
    outcome,
    directive,
    primaryReasonCode: reasonCode,
    ruleResults,
    assessment: assessmentCore,
    policyHash: RISK_POLICY_HASH,
    engineVersion: RISK_ENGINE_VERSION,
    ruleSetVersion: RISK_RULE_SET_VERSION
  };
  const outputHash = buildOutputHash(outputCore);

  const assessment: RiskAssessmentDraftV1 = { ...assessmentCore, outputHash };

  const decision: TradeDecisionDraftV1 = {
    decisionKey: buildDecisionKey({
      tradeCandidateId: snapshot.candidate.id,
      riskLimitSetId: riskLimitSetId ?? MISSING_LIMIT_SET_ID,
      inputHash
    }),
    tradeCandidateId: snapshot.candidate.id,
    outcome:
      outcome === RiskEvaluationOutcome.APPROVED
        ? "APPROVE_SHADOW"
        : outcome === RiskEvaluationOutcome.REJECTED
          ? "REJECT"
          : "ERROR",
    reasonCode,
    inputHash,
    outputHash: buildDecisionHash({
      tradeCandidateId: snapshot.candidate.id,
      riskAssessmentId: null,
      outcome,
      reasonCode,
      inputHash,
      ruleSetVersion: RISK_RULE_SET_VERSION,
      engineVersion: RISK_ENGINE_VERSION,
      codeVersion: snapshot.policyVersions.codeVersion
    }),
    decidedAt: evaluatedAt
  };

  return {
    outcome,
    directive,
    primaryReasonCode: reasonCode,
    ruleResults: Object.freeze(ruleResults),
    assessment,
    decision,
    inputHash,
    outputHash,
    policyHash: RISK_POLICY_HASH,
    engineVersion: RISK_ENGINE_VERSION,
    ruleSetVersion: RISK_RULE_SET_VERSION,
    evaluatedAt
  };
}

/**
 * A snapshot the engine cannot read produces an `ERROR` with the full set of
 * rule results, each stating that nothing could be evaluated. That keeps the
 * "26 results" contract intact without claiming a rule actually ran.
 */
function unreadableSnapshot(
  snapshot: RiskInputSnapshotV1 | undefined,
  inputHash: string,
  evaluatedAt: string
): RiskEvaluationResultV1 {
  const reasonCode =
    snapshot === undefined || snapshot === null
      ? RiskReasonCode.RISK_SNAPSHOT_MALFORMED
      : RiskReasonCode.RISK_SNAPSHOT_VERSION_UNSUPPORTED;

  const ruleResults: RiskRuleResultDraftV1[] = RISK_RULE_ORDER.map(
    (ruleCode: RiskRuleCode) => ({
      ruleCode,
      ruleVersion: RISK_RULE_SET_VERSION,
      outcome: "ERROR" as const,
      severity: "CRITICAL" as const,
      reasonCode,
      message:
        "The risk input snapshot could not be read; no rule was evaluated.",
      actualValue: null,
      limitValue: null,
      unit: null,
      inputJson: { snapshotVersion: snapshot?.snapshotVersion ?? null },
      evaluatedAt
    })
  );

  const zero = ZERO.toString();
  const candidateId = snapshot?.candidate?.id ?? "UNKNOWN-CANDIDATE";
  const assessmentKey = buildAssessmentKey({
    tradeCandidateId: candidateId,
    riskLimitSetId: MISSING_LIMIT_SET_ID,
    inputHash
  });
  const sizing = computePositionSizing({
    direction: "LONG",
    referenceEntryPrice: ZERO,
    stopPrice: ZERO,
    takeProfitPrice: ZERO,
    equity: ZERO,
    availableCash: ZERO,
    currentGrossExposure: ZERO,
    currentAssetExposure: ZERO,
    currentCorrelatedExposure: ZERO,
    maxRiskPerTradePct: ZERO,
    maxGrossExposurePct: ZERO,
    maxAssetExposurePct: ZERO,
    maxCorrelatedExposurePct: ZERO,
    tickSize: ZERO,
    stepSize: ZERO,
    minQuantity: ZERO,
    minNotional: ZERO,
    maxQuantity: null,
    feeBps: 0,
    fullSpreadBps: 0,
    slippageBps: 0
  });

  const assessmentCore = {
    assessmentKey,
    tradeCandidateId: candidateId,
    portfolioId: snapshot?.portfolio?.id ?? "UNKNOWN-PORTFOLIO",
    riskLimitSetId: null,
    status: "ERROR" as const,
    ruleSetVersion: RISK_RULE_SET_VERSION,
    equity: zero,
    availableCash: zero,
    reservedCash: zero,
    dailyPnl: zero,
    openPositionCount: 0,
    newTradesToday: 0,
    consecutiveLosses: 0,
    grossExposure: zero,
    assetExposure: zero,
    correlatedExposure: zero,
    requestedQuantity: zero,
    approvedQuantity: zero,
    riskAmount: zero,
    tradingDateUtc: snapshot?.tradingDateUtc ?? evaluatedAt.slice(0, 10),
    portfolioSnapshotAsOf: evaluatedAt,
    marketDataAsOf: evaluatedAt,
    sizing,
    inputHash,
    assessedAt: evaluatedAt
  };

  const outputHash = buildOutputHash({
    outcome: RiskEvaluationOutcome.ERROR,
    directive: "ERROR_LOCK",
    primaryReasonCode: reasonCode,
    ruleResults,
    assessment: assessmentCore,
    policyHash: RISK_POLICY_HASH,
    engineVersion: RISK_ENGINE_VERSION,
    ruleSetVersion: RISK_RULE_SET_VERSION
  });

  return {
    outcome: RiskEvaluationOutcome.ERROR,
    directive: "ERROR_LOCK",
    primaryReasonCode: reasonCode,
    ruleResults: Object.freeze(ruleResults),
    assessment: { ...assessmentCore, outputHash },
    decision: {
      decisionKey: buildDecisionKey({
        tradeCandidateId: candidateId,
        riskLimitSetId: MISSING_LIMIT_SET_ID,
        inputHash
      }),
      tradeCandidateId: candidateId,
      outcome: "ERROR",
      reasonCode,
      inputHash,
      outputHash,
      decidedAt: evaluatedAt
    },
    inputHash,
    outputHash,
    policyHash: RISK_POLICY_HASH,
    engineVersion: RISK_ENGINE_VERSION,
    ruleSetVersion: RISK_RULE_SET_VERSION,
    evaluatedAt
  };
}
