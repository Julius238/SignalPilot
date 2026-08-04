/**
 * Business idempotency keys, hashes and concurrency guards.
 *
 * Specification:
 *   docs/trading/02-shadow-trading-target-architecture.md, "Idempotenz und Concurrency"
 *   docs/trading/03-domain-model.md (the `*Key` columns and their unique constraints)
 *   docs/trading/04-state-machines.md, "Gemeinsame Regeln":
 *     a retry with the same key returns the existing result; the same key with a
 *     different payload hash leads to ERROR_LOCKED.
 *
 * Keys are readable and stable rather than opaque so an operator can trace a
 * unique-constraint violation back to the aggregate that produced it.
 */

import { canonicalHash } from "./canonical-json.js";
import {
  TradingDomainError,
  TradingReasonCode,
  guardFail,
  guardOk,
  type GuardResult,
  type PortfolioLedgerEntryType,
  type RiskEventType,
  type RiskLimitScope,
  type ShadowFillTriggerType,
  type ShadowOrderPurpose,
  type TradeEvidenceType
} from "./types.js";

const KEY_VERSION = "v1";
const KEY_SEPARATOR = "|";
const KEY_PART_PATTERN = /^[A-Za-z0-9._:+-]{1,128}$/;

function keyPart(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value;
  if (text === "") {
    throw new TradingDomainError(
      TradingReasonCode.IDEMPOTENCY_KEY_PART_EMPTY,
      "An idempotency key part must not be empty."
    );
  }
  if (!KEY_PART_PATTERN.test(text)) {
    throw new TradingDomainError(
      TradingReasonCode.IDEMPOTENCY_KEY_PART_INVALID,
      `Idempotency key part contains an unsupported character or is too long: ${JSON.stringify(text)}`
    );
  }
  return text;
}

function buildKey(
  namespace: string,
  parts: readonly (string | number)[]
): string {
  return [`${namespace}.${KEY_VERSION}`, ...parts.map(keyPart)].join(
    KEY_SEPARATOR
  );
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TradingDomainError(
      TradingReasonCode.SEQUENCE_MUST_BE_POSITIVE,
      `${label} must be a non-negative safe integer, got ${String(value)}.`
    );
  }
  return value;
}

// ───────────────────────────────────────────────────────────────────────────
// Hashes
// ───────────────────────────────────────────────────────────────────────────

/** SHA-256 over the canonical input snapshot of an engine call. */
export const buildInputHash = (snapshot: unknown): string =>
  canonicalHash(snapshot);

/** SHA-256 over the canonical output of an engine call. */
export const buildOutputHash = (output: unknown): string =>
  canonicalHash(output);

/** SHA-256 over a canonical specification (strategy, limit set, exit plan, profile). */
export const buildSpecificationHash = (specification: unknown): string =>
  canonicalHash(specification);

/** SHA-256 over a canonical evidence payload. */
export const buildPayloadHash = (payload: unknown): string =>
  canonicalHash(payload);

export interface DecisionHashInput {
  readonly tradeCandidateId: string;
  readonly riskAssessmentId: string | null;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly inputHash: string;
  readonly ruleSetVersion: string;
  readonly engineVersion: string;
  readonly codeVersion: string;
}

/**
 * Reproducibility hash of a final pre-trade decision. Identical inputs and
 * identical engine versions must produce an identical hash on every host
 * (docs/trading/03, TradeDecision `outputHash`).
 */
export const buildDecisionHash = (input: DecisionHashInput): string =>
  canonicalHash(input);

// ───────────────────────────────────────────────────────────────────────────
// Aggregate keys
// ───────────────────────────────────────────────────────────────────────────

/** `TradeCandidate.candidateKey` — assignment, version, asset, anchor candle. */
export const buildCandidateKey = (input: {
  readonly strategyAssignmentId: string;
  readonly strategyVersionId: string;
  readonly assetId: string;
  readonly anchorCandleId: string;
}): string =>
  buildKey("candidate", [
    input.strategyAssignmentId,
    input.strategyVersionId,
    input.assetId,
    input.anchorCandleId
  ]);

/**
 * Deterministic substitute for a nullable evidence source, so that
 * `(tradeCandidateId, type, sourceType, sourceKey)` stays unique even when the
 * source system has no own identifier (docs/trading/03, TradeCandidateEvidence).
 */
export const buildEvidenceSourceKey = (input: {
  readonly type: TradeEvidenceType;
  readonly sourceType: string;
  readonly sourceId: string | null;
}): string =>
  input.sourceId !== null && input.sourceId !== ""
    ? keyPart(input.sourceId)
    : buildKey("evidence-source", ["NONE", input.type, input.sourceType]);

/** `RiskAssessment.assessmentKey` — candidate, limit set, candidate input hash. */
export const buildAssessmentKey = (input: {
  readonly tradeCandidateId: string;
  readonly riskLimitSetId: string;
  readonly inputHash: string;
}): string =>
  buildKey("risk-assessment", [
    input.tradeCandidateId,
    input.riskLimitSetId,
    input.inputHash
  ]);

/** `TradeDecision.decisionKey` — same scope as the risk job's idempotency key. */
export const buildDecisionKey = (input: {
  readonly tradeCandidateId: string;
  readonly riskLimitSetId: string;
  readonly inputHash: string;
}): string =>
  buildKey("trade-decision", [
    input.tradeCandidateId,
    input.riskLimitSetId,
    input.inputHash
  ]);

/** `ShadowOrder.orderKey` for the single entry order of a decision. */
export const buildEntryOrderKey = (input: {
  readonly tradeDecisionId: string;
}): string => buildKey("shadow-order.entry", [input.tradeDecisionId]);

/** `ShadowOrder.orderKey` for an exit order of a position. */
export const buildExitOrderKey = (input: {
  readonly shadowPositionId: string;
  readonly exitPlanVersion: number;
  readonly sourceCandleId: string;
  readonly triggerType: ShadowFillTriggerType;
}): string =>
  buildKey("shadow-order.exit", [
    input.shadowPositionId,
    assertNonNegativeInteger(input.exitPlanVersion, "exitPlanVersion"),
    input.sourceCandleId,
    input.triggerType
  ]);

/**
 * `ShadowOrder.clientOrderId` — internally idempotent and already shaped so a
 * later exchange adapter could reuse it (lower-case, 35 characters, no
 * separators that a venue might reject). It carries no account information.
 */
export const buildClientOrderId = (orderKey: string): string => {
  if (orderKey === "") {
    throw new TradingDomainError(
      TradingReasonCode.IDEMPOTENCY_KEY_PART_EMPTY,
      "A client order id needs a non-empty order key."
    );
  }
  return `sp-${canonicalHash(orderKey).slice(0, 32)}`;
};

/** `ShadowFill.fillKey` — order, source candle, sequence. */
export const buildFillKey = (input: {
  readonly shadowOrderId: string;
  readonly sourceCandleId: string;
  readonly sequence: number;
}): string =>
  buildKey("shadow-fill", [
    input.shadowOrderId,
    input.sourceCandleId,
    assertNonNegativeInteger(input.sequence, "sequence")
  ]);

/** `ShadowPosition.positionKey` — portfolio, asset, originating entry order. */
export const buildPositionKey = (input: {
  readonly portfolioId: string;
  readonly assetId: string;
  readonly entryOrderId: string;
}): string =>
  buildKey("shadow-position", [
    input.portfolioId,
    input.assetId,
    input.entryOrderId
  ]);

/** `ShadowPositionEvent.eventKey` — position and gapless sequence. */
export const buildPositionEventKey = (input: {
  readonly shadowPositionId: string;
  readonly sequence: number;
}): string =>
  buildKey("position-event", [
    input.shadowPositionId,
    assertNonNegativeInteger(input.sequence, "sequence")
  ]);

/** `PortfolioLedgerEntry.entryKey` — portfolio, booking type and its cause. */
export const buildLedgerEntryKey = (input: {
  readonly portfolioId: string;
  readonly type: PortfolioLedgerEntryType;
  readonly causeType: string;
  readonly causeId: string;
}): string =>
  buildKey("ledger-entry", [
    input.portfolioId,
    input.type,
    input.causeType,
    input.causeId
  ]);

/** `RiskEvent.eventKey` — type, affected aggregate and evidence hash. */
export const buildRiskEventKey = (input: {
  readonly type: RiskEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly inputHash: string;
}): string =>
  buildKey("risk-event", [
    input.type,
    input.aggregateType,
    input.aggregateId,
    input.inputHash
  ]);

/** `TradingAuditEvent.eventKey` — action, target and the caller's idempotency key. */
export const buildAuditEventKey = (input: {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
}): string =>
  buildKey("trading-audit", [
    input.eventType,
    input.aggregateType,
    input.aggregateId,
    input.idempotencyKey
  ]);

/** `TradingSession.sessionKey` — portfolio and activation ordinal. */
export const buildSessionKey = (input: {
  readonly portfolioId: string;
  readonly sequence: number;
}): string =>
  buildKey("trading-session", [
    input.portfolioId,
    assertNonNegativeInteger(input.sequence, "sequence")
  ]);

/** `TradingJobCursor.scopeKey` — assignment, order or position scope of a job. */
export const buildJobScopeKey = (parts: readonly string[]): string =>
  buildKey("job-scope", parts);

// ───────────────────────────────────────────────────────────────────────────
// "At most one active" keys
// ───────────────────────────────────────────────────────────────────────────
//
// PostgreSQL treats NULLs as distinct in a unique index, so a nullable key
// column expresses "at most one active row per scope" without a partial index
// that Prisma cannot represent. The application sets the column while the row
// is active and clears it when the row leaves that state.

/** At most one time-active assignment per portfolio, asset and strategy family. */
export const buildActiveAssignmentScopeKey = (input: {
  readonly portfolioId: string;
  readonly assetId: string;
  readonly strategyId: string;
}): string =>
  buildKey("active-assignment", [
    input.portfolioId,
    input.assetId,
    input.strategyId
  ]);

/** At most one active execution profile per asset. */
export const buildActiveExecutionProfileKey = (input: {
  readonly assetId: string;
}): string => buildKey("active-execution-profile", [input.assetId]);

/** At most one active risk limit set per scope. */
export const buildActiveRiskLimitSetKey = (input: {
  readonly scope: RiskLimitScope;
}): string => buildKey("active-risk-limit-set", [input.scope]);

/**
 * At most one non-terminal position per portfolio and asset.
 *
 * Deliberately **direction-free**, which is what makes long and short exposure
 * on the same asset mutually exclusive by database constraint rather than by
 * convention (ADR 0013). Do not add `direction` to this key.
 */
export const buildOpenPositionScopeKey = (input: {
  readonly portfolioId: string;
  readonly assetId: string;
}): string => buildKey("open-position", [input.portfolioId, input.assetId]);

/** At most one non-closed session per portfolio. */
export const buildActiveSessionScopeKey = (input: {
  readonly portfolioId: string;
}): string => buildKey("active-session", [input.portfolioId]);

/** At most one non-terminal exit plan per position. */
export const buildActiveExitPlanScopeKey = (input: {
  readonly shadowPositionId: string;
}): string => buildKey("active-exit-plan", [input.shadowPositionId]);

/**
 * At most one non-terminal entry order per portfolio and asset (no scale-in).
 *
 * Deliberately **direction-free**: this is the key that makes a long and a
 * short entry order for the same asset mutually exclusive at the database
 * level, not merely at scheduler level (ADR 0013). Adding `direction` here
 * would let a long and a short entry order coexist and is therefore forbidden;
 * `ShadowPosition.openScopeKey` (`buildOpenPositionScopeKey`) is direction-free
 * for exactly the same reason.
 */
export const buildOpenEntryOrderScopeKey = (input: {
  readonly portfolioId: string;
  readonly assetId: string;
  readonly purpose: ShadowOrderPurpose;
}): string =>
  buildKey("open-order", [input.portfolioId, input.assetId, input.purpose]);

// ───────────────────────────────────────────────────────────────────────────
// Concurrency and replay guards
// ───────────────────────────────────────────────────────────────────────────

/**
 * Optimistic concurrency: every status change runs as
 * `UPDATE ... WHERE id = ? AND status = ? AND version = ?`. Zero affected rows
 * means a concurrent update, never a blind overwrite (docs/trading/02).
 */
export function checkExpectedVersion(
  actualVersion: number,
  expectedVersion: number
): GuardResult {
  return actualVersion === expectedVersion
    ? guardOk()
    : guardFail(
        TradingReasonCode.VERSION_CONFLICT,
        `Expected version ${expectedVersion}, found ${actualVersion}.`
      );
}

export function assertExpectedVersion(
  actualVersion: number,
  expectedVersion: number
): void {
  const result = checkExpectedVersion(actualVersion, expectedVersion);
  if (!result.ok)
    throw new TradingDomainError(result.reasonCode, result.message);
}

/** The next version an aggregate must carry after a successful transition. */
export const nextVersion = (currentVersion: number): number =>
  assertNonNegativeInteger(currentVersion, "version") + 1;

export const ReplayVerdict = {
  /** New work: no row exists for this key yet. */
  FRESH: "FRESH",
  /** Safe retry: same key, same payload — return the stored result. */
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  /** Same key, different payload — critical risk event and ERROR_LOCKED. */
  CONFLICT: "CONFLICT"
} as const;
export type ReplayVerdict = (typeof ReplayVerdict)[keyof typeof ReplayVerdict];

/**
 * Classify a retry. A conflicting payload never wins: the caller must raise a
 * critical risk event and lock the session (docs/trading/04, "Gemeinsame Regeln").
 */
export function classifyReplay(
  existingPayloadHash: string | null,
  incomingPayloadHash: string
): ReplayVerdict {
  if (existingPayloadHash === null) return ReplayVerdict.FRESH;
  return existingPayloadHash === incomingPayloadHash
    ? ReplayVerdict.IDEMPOTENT_REPLAY
    : ReplayVerdict.CONFLICT;
}

export function assertNoIdempotencyConflict(
  key: string,
  existingPayloadHash: string | null,
  incomingPayloadHash: string
): ReplayVerdict {
  const verdict = classifyReplay(existingPayloadHash, incomingPayloadHash);
  if (verdict === ReplayVerdict.CONFLICT) {
    throw new TradingDomainError(
      TradingReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT,
      `Idempotency key ${key} was already used with a different payload hash.`,
      {
        key,
        existingPayloadHash: existingPayloadHash ?? "",
        incomingPayloadHash
      }
    );
  }
  return verdict;
}

/**
 * Ledger, fill and position-event sequences must be gapless and monotonic so a
 * replay reproduces the exact same aggregate state (docs/trading/03).
 */
export function checkNextSequence(
  lastSequence: number,
  nextSequenceValue: number
): GuardResult {
  assertNonNegativeInteger(lastSequence, "lastSequence");
  assertNonNegativeInteger(nextSequenceValue, "nextSequence");
  return nextSequenceValue === lastSequence + 1
    ? guardOk()
    : guardFail(
        TradingReasonCode.SEQUENCE_NOT_CONTIGUOUS,
        `Expected sequence ${lastSequence + 1}, got ${nextSequenceValue}.`
      );
}

export function assertNextSequence(
  lastSequence: number,
  nextSequenceValue: number
): void {
  const result = checkNextSequence(lastSequence, nextSequenceValue);
  if (!result.ok)
    throw new TradingDomainError(result.reasonCode, result.message);
}

// ───────────────────────────────────────────────────────────────────────────
// Work package 8: performance snapshots and the alert outbox
// ───────────────────────────────────────────────────────────────────────────

/**
 * A key part that may legitimately contain characters the readable key format
 * forbids (a regime name with a space, an operator note). Such a part is
 * replaced by a short hash instead of throwing — the key stays unique and
 * stable, it just stops being readable for that one part.
 */
function safeKeyPart(value: string): string {
  if (value === "") {
    throw new TradingDomainError(
      TradingReasonCode.IDEMPOTENCY_KEY_PART_EMPTY,
      "An idempotency key part must not be empty."
    );
  }
  return KEY_PART_PATTERN.test(value)
    ? value
    : `h.${canonicalHash(value).slice(0, 16)}`;
}

/**
 * `StrategyPerformance.snapshotKey` — the full identity of one computed
 * segment. It includes `engineVersion` and `inputHash`, so a recomputation
 * with changed logic or changed source data writes a NEW row and never
 * overwrites a historical result (P8, "2. Persistenz").
 */
export const buildStrategyPerformanceSnapshotKey = (input: {
  readonly portfolioId: string;
  readonly window: string;
  readonly asOf: string;
  readonly segmentType: string;
  readonly segmentKey: string;
  readonly engineVersion: string;
  readonly inputHash: string;
}): string =>
  buildKey("strategy-performance", [
    input.portfolioId,
    input.window,
    safeKeyPart(input.asOf),
    input.segmentType,
    safeKeyPart(input.segmentKey),
    safeKeyPart(input.engineVersion),
    input.inputHash
  ]);

/**
 * `TradingAlertOutbox.idempotencyKey` — derived from the triggering aggregate
 * so the same observed condition never enqueues a second alert. `occurrence`
 * is what makes a *repeat* of the same condition a new alert (a new
 * `RiskEvent.eventKey`, a new session version, a new UTC day) — it is never a
 * timestamp of the observation itself, which would defeat deduplication.
 */
export const buildTradingAlertIdempotencyKey = (input: {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurrence: string;
}): string =>
  buildKey("trading-alert", [
    input.eventType,
    input.aggregateType,
    input.aggregateId,
    safeKeyPart(input.occurrence)
  ]);
