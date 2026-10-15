/**
 * CRYPTO_REGIME_LONG_V1 — the crypto-native regime as the whole entry rule.
 *
 * Parameters and rationale: `CRYPTO_REGIME_LONG_V1_PARAMETERS`
 * (specification-v1.ts). Input validation, refusal and evidence are the long
 * breakout's; this file adds only the regime gate, the daily-ATR stop, the 4R
 * target and the 1h entry-gap bound. The exit on a closed regime gate is the
 * position monitor's job (`exitPolicy`), not the evaluator's.
 */

import {
  DecimalValue,
  RoundingMode,
  buildCandidateKey,
  buildInputHash,
  buildOutputHash
} from "@signalpilot/trading-domain";

import type {
  RegimeStrategyIndicatorSnapshotV1,
  StrategyCheckV1,
  StrategyEvaluationResultV1,
  StrategyInputSnapshotV1,
  TradeCandidateDraftV1
} from "./contracts.js";
import { buildEvidence, refuse, type BreakoutIdentityV1 } from "./crypto-mtf-breakout-v1.js";
import { averageTrueRange } from "./indicators-v1.js";
import { alignStopToTick, alignTakeProfitToTick, usableTickSize } from "./price-plan.js";
import { StrategyCheckStage, StrategyEvaluationOutcome, StrategyReasonCode } from "./reason-codes.js";
import {
  CRYPTO_REGIME_LONG_V1_ENGINE_VERSION,
  CRYPTO_REGIME_LONG_V1_KEY,
  CRYPTO_REGIME_LONG_V1_PARAMETERS,
  CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH
} from "./specification-v1.js";
import { createCheckLog, validateStrategyInput } from "./validate-input.js";

const PARAMS = CRYPTO_REGIME_LONG_V1_PARAMETERS;
const ENTRY = StrategyCheckStage.ENTRY;
const PRICE_PLAN = StrategyCheckStage.PRICE_PLAN;

const MINIMUM_REWARD_RISK = DecimalValue.fromString(PARAMS.minimumRewardRisk);
const ENTRY_GAP_ATR_MULTIPLE = DecimalValue.fromString(PARAMS.entryGapAtrMultiple);

/**
 * RESEARCH ONLY: rule overrides of the regime strategy for historical replays
 * (Evolution Engine, docs/trading/20-evolution-engine.md). Same contract as
 * `BreakoutResearchOverrides`: an identity carrying them is never registered,
 * never seeded as a StrategyVersion and therefore never executable by the
 * live pipeline. Without overrides the evaluation is the specified one.
 */
export interface RegimeLongResearchOverrides {
  readonly regimeMinimumConfidence?: number;
  readonly stopAtrMultiple1d?: string;
  readonly takeProfitRMultiple?: string;
  readonly maxHoldHours?: number;
}

/** Regime identity; `regimeResearch` only ever exists inside a replay. */
export interface RegimeLongIdentityV1 extends BreakoutIdentityV1 {
  readonly regimeResearch?: RegimeLongResearchOverrides;
}

interface RegimeRules {
  readonly regimeMinimumConfidence: number;
  readonly stopAtrMultiple1d: string;
  readonly stopAtrMultiple1dValue: DecimalValue;
  readonly takeProfitRMultiple: DecimalValue;
  readonly maxHoldHours: number;
}

function compileRegimeRules(overrides: RegimeLongResearchOverrides = {}): RegimeRules {
  const stopAtrMultiple1d = overrides.stopAtrMultiple1d ?? PARAMS.stopAtrMultiple1d;
  return {
    regimeMinimumConfidence: overrides.regimeMinimumConfidence ?? PARAMS.regimeMinimumConfidence,
    stopAtrMultiple1d,
    stopAtrMultiple1dValue: DecimalValue.fromString(stopAtrMultiple1d),
    takeProfitRMultiple: DecimalValue.fromString(overrides.takeProfitRMultiple ?? PARAMS.takeProfitRMultiple),
    maxHoldHours: overrides.maxHoldHours ?? PARAMS.maxHoldHours
  };
}

const SPECIFIED_REGIME_RULES = compileRegimeRules();

/** Identity every result carries; the input validator checks the snapshot against it. */
export const REGIME_LONG_V1_IDENTITY: RegimeLongIdentityV1 = Object.freeze({
  key: CRYPTO_REGIME_LONG_V1_KEY,
  engineVersion: CRYPTO_REGIME_LONG_V1_ENGINE_VERSION,
  specificationHash: CRYPTO_REGIME_LONG_V1_SPECIFICATION_HASH,
  regimeSource: PARAMS.regimeSource,
  tickAlignedPricePlan: true
});

/**
 * Whether a regime report opens the long gate — the entry rule of this
 * strategy and, applied to the newest report while a position is open, its
 * exit rule (`REGIME_EXIT_POLICY`). `minimumConfidence` differs from the
 * specified 60 only for a research identity inside a replay.
 */
export function regimeGateOpen(
  regime: {
    readonly cryptoRegime: string;
    readonly riskMode: string;
    readonly confidence: number;
  },
  minimumConfidence: number = PARAMS.regimeMinimumConfidence
): boolean {
  return (
    regime.cryptoRegime === PARAMS.regimeRequiredCryptoRegime &&
    !PARAMS.regimeForbiddenRiskModes.includes(regime.riskMode as never) &&
    Number.isFinite(regime.confidence) &&
    regime.confidence >= minimumConfidence
  );
}

export function evaluateCryptoRegimeLongV1(
  snapshot: StrategyInputSnapshotV1,
  identity: RegimeLongIdentityV1 = REGIME_LONG_V1_IDENTITY
): StrategyEvaluationResultV1 {
  const rules = identity.regimeResearch === undefined ? SPECIFIED_REGIME_RULES : compileRegimeRules(identity.regimeResearch);
  const inputHash = buildInputHash(snapshot);
  const evaluatedAt = typeof snapshot?.asOf === "string" ? snapshot.asOf : "1970-01-01T00:00:00.000Z";

  const validation = validateStrategyInput(snapshot, identity);
  if (!validation.ok) {
    return refuse(identity, StrategyEvaluationOutcome.INVALID_INPUT, validation.checks, validation.failures, inputHash, evaluatedAt);
  }
  const validated = validation.validated;
  const log = createCheckLog();

  // ── Entry: the regime gate ───────────────────────────────────────────────
  const regime = validated.marketRegime;
  if (regime.cryptoRegime !== PARAMS.regimeRequiredCryptoRegime) {
    log.fail("REGIME", ENTRY, StrategyReasonCode.REGIME_NOT_RISK_ON, regime.cryptoRegime, PARAMS.regimeRequiredCryptoRegime);
  } else if (PARAMS.regimeForbiddenRiskModes.includes(regime.riskMode as never)) {
    log.fail("REGIME", ENTRY, StrategyReasonCode.REGIME_RISK_MODE_BLOCKED, regime.riskMode, `NOT ${PARAMS.regimeForbiddenRiskModes.join("/")}`);
  } else if (regime.confidence < rules.regimeMinimumConfidence) {
    log.fail(
      "REGIME",
      ENTRY,
      StrategyReasonCode.REGIME_CONFIDENCE_BELOW_MINIMUM,
      String(regime.confidence),
      String(rules.regimeMinimumConfidence)
    );
  } else {
    log.pass("REGIME", ENTRY, StrategyReasonCode.REGIME_RISK_ON, String(regime.confidence));
  }

  const blocking = validated.contextEvents.filter(
    (event) => event.directionalBias === "BEARISH" && PARAMS.blockingContextSeverities.includes(event.severity as never)
  );
  if (blocking.length > 0) {
    log.fail("CONTEXT_EVENTS", ENTRY, StrategyReasonCode.CONTEXT_CRITICAL_BEARISH_EVENT, blocking.map((event) => event.id).sort().join(","), "0");
  } else {
    log.pass("CONTEXT_EVENTS", ENTRY, StrategyReasonCode.CONTEXT_NO_BLOCKING_EVENT, "0", "0");
  }

  // ── Candidate validity window ────────────────────────────────────────────
  const anchor = validated.series["1h"].anchor;
  const expiresAtMs = anchor.closeTimeMs + PARAMS.candidateTtlMs;
  if (expiresAtMs <= validated.asOfMs) {
    log.fail("CANDIDATE_VALIDITY", ENTRY, StrategyReasonCode.CANDIDATE_ALREADY_EXPIRED, new Date(expiresAtMs).toISOString(), snapshot.asOf);
  } else {
    log.pass("CANDIDATE_VALIDITY", ENTRY, StrategyReasonCode.CANDIDATE_WITHIN_VALIDITY_WINDOW, new Date(expiresAtMs).toISOString(), snapshot.asOf);
  }

  // ── Price plan: protective stop 2 × ATR(1d), target 4R, both on the tick grid
  const referenceEntry = anchor.close;
  const atr1d = averageTrueRange(validated.series["1d"].candles, PARAMS.stopAtrPeriod1d);
  const atr1h = averageTrueRange(validated.series["1h"].candles, PARAMS.atrPeriod);
  const tick = usableTickSize(validated.executionProfile.tickSize);
  if (tick === null) {
    log.fail("PRICE_TICK_ALIGNMENT", PRICE_PLAN, StrategyReasonCode.PRICE_TICK_SIZE_INVALID, String(validated.executionProfile.tickSize), "> 0");
  } else {
    log.pass("PRICE_TICK_ALIGNMENT", PRICE_PLAN, StrategyReasonCode.PRICE_PLAN_TICK_ALIGNED, tick.toString());
  }

  let stopPrice: DecimalValue | null = null;
  let takeProfitPrice: DecimalValue | null = null;
  let plannedRewardRisk: DecimalValue | null = null;
  if (atr1d === null || !atr1d.isPositive() || atr1h === null || !atr1h.isPositive()) {
    log.fail("ATR_1D", PRICE_PLAN, StrategyReasonCode.ATR_UNAVAILABLE);
  } else if (tick !== null) {
    log.pass("ATR_1D", PRICE_PLAN, StrategyReasonCode.STOP_DISTANCE_ATR_APPLIED, atr1d.toString(), rules.stopAtrMultiple1d);
    stopPrice = alignStopToTick("LONG", referenceEntry.sub(rules.stopAtrMultiple1dValue.mul(atr1d, RoundingMode.CEIL)), tick);
    if (!stopPrice.isPositive()) {
      log.fail("STOP_PRICE", PRICE_PLAN, StrategyReasonCode.STOP_PRICE_NOT_POSITIVE, stopPrice.toString(), "0.000000000000");
    } else {
      log.pass("STOP_PRICE", PRICE_PLAN, StrategyReasonCode.PRICE_PLAN_VALID, stopPrice.toString());
      const stopDistance = referenceEntry.sub(stopPrice);
      takeProfitPrice = alignTakeProfitToTick(
        "LONG",
        referenceEntry.add(rules.takeProfitRMultiple.mul(stopDistance, RoundingMode.FLOOR)),
        tick
      );
      plannedRewardRisk = takeProfitPrice.sub(referenceEntry).div(stopDistance, RoundingMode.FLOOR);
      if (plannedRewardRisk.lt(MINIMUM_REWARD_RISK)) {
        log.fail("REWARD_RISK", PRICE_PLAN, StrategyReasonCode.REWARD_RISK_BELOW_MINIMUM, plannedRewardRisk.toString(), MINIMUM_REWARD_RISK.toString());
      } else {
        log.pass("REWARD_RISK", PRICE_PLAN, StrategyReasonCode.REWARD_RISK_CONFIRMED, plannedRewardRisk.toString(), MINIMUM_REWARD_RISK.toString());
      }
    }
  }

  const checks: readonly StrategyCheckV1[] = Object.freeze([...validation.checks, ...log.checks]);
  if (
    log.hasFailure ||
    atr1d === null ||
    atr1h === null ||
    stopPrice === null ||
    takeProfitPrice === null ||
    plannedRewardRisk === null
  ) {
    return refuse(identity, StrategyEvaluationOutcome.NO_CANDIDATE, checks, log.failures, inputHash, evaluatedAt);
  }

  // ── Candidate draft ──────────────────────────────────────────────────────
  const stopDistance = referenceEntry.sub(stopPrice);
  const maximumEntryGap = ENTRY_GAP_ATR_MULTIPLE.mul(atr1h, RoundingMode.FLOOR);
  const indicators: RegimeStrategyIndicatorSnapshotV1 = {
    close1h: referenceEntry.toString(),
    atr14_1h: atr1h.toString(),
    close1d: validated.series["1d"].anchor.close.toString(),
    atr14_1d: atr1d.toString(),
    cryptoRegime: regime.cryptoRegime,
    riskMode: regime.riskMode,
    regimeConfidence: regime.confidence,
    regimeSource: PARAMS.regimeSource
  };
  const reasonCodes = Object.freeze(
    [...new Set(log.checks.filter((check) => check.passed).map((check) => check.reasonCode))].sort()
  );

  const draftWithoutOutputHash = {
    candidateKey: buildCandidateKey({
      strategyAssignmentId: validated.snapshot.assignment.id,
      strategyVersionId: validated.snapshot.strategy.strategyVersionId,
      assetId: validated.snapshot.asset.id,
      anchorCandleId: anchor.id
    }),
    strategyKey: identity.key,
    strategyVersionId: validated.snapshot.strategy.strategyVersionId,
    strategyAssignmentId: validated.snapshot.assignment.id,
    portfolioId: validated.snapshot.assignment.portfolioId,
    assetId: validated.snapshot.asset.id,
    symbol: validated.snapshot.asset.symbol,
    anchorCandleId: anchor.id,
    anchorSignalId: validated.signals["1h"].id,
    direction: "LONG",
    entryType: "MARKET",
    status: "CREATED",
    dataAsOf: snapshot.asOf,
    decisionTime: snapshot.asOf,
    validFrom: anchor.closeTime,
    earliestFillAt: anchor.closeTime,
    expiresAt: new Date(expiresAtMs).toISOString(),
    referenceEntryPrice: referenceEntry.toString(),
    plannedEntryMinimum: stopPrice.toString(),
    plannedEntryMaximum: referenceEntry.add(maximumEntryGap).toString(),
    maximumEntryGapDistance: maximumEntryGap.toString(),
    stopPrice: stopPrice.toString(),
    stopDistance: stopDistance.toString(),
    stopDistancePct: stopDistance.div(referenceEntry, RoundingMode.CEIL).toString(),
    takeProfitPrice: takeProfitPrice.toString(),
    minimumRewardRisk: MINIMUM_REWARD_RISK.toString(),
    plannedRewardRisk: plannedRewardRisk.toString(),
    maxHoldHours: rules.maxHoldHours,
    indicators,
    evidence: buildEvidence(validated),
    reasonCodes,
    engineVersion: identity.engineVersion,
    specificationHash: identity.specificationHash,
    inputHash
  } as const;

  const core = {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: identity.key,
    engineVersion: identity.engineVersion,
    specificationHash: identity.specificationHash,
    inputHash,
    reasonCodes,
    checks,
    candidate: draftWithoutOutputHash
  };
  const outputHash = buildOutputHash(core);
  const candidate: TradeCandidateDraftV1 = Object.freeze({ ...draftWithoutOutputHash, outputHash });

  return {
    outcome: StrategyEvaluationOutcome.CANDIDATE,
    strategyKey: identity.key,
    engineVersion: identity.engineVersion,
    specificationHash: identity.specificationHash,
    inputHash,
    outputHash,
    evaluatedAt,
    reasonCodes,
    checks,
    candidate
  };
}
