/**
 * Wire shapes for the P8 performance, outbox and eligibility reads.
 *
 * Every Decimal is serialised as a string, exactly like the P6 schemas — a
 * `Decimal(30,12)` does not survive JSON's float. A metric that the engine
 * could not compute stays `null` on the wire and keeps its machine-readable
 * reason in `nullReasons`, so no consumer has to guess whether a `0` means
 * "zero" or "unknown".
 */

import { toIso, toIsoOrNull } from "./common.js";

const decimalOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const decimalString = (value: unknown): string =>
  value === null || value === undefined ? "0" : String(value);

export interface StrategyPerformanceSegmentRow {
  readonly id: string;
  readonly snapshotKey: string;
  readonly strategyVersionId: string | null;
  readonly portfolioId: string;
  readonly window: string;
  readonly segmentType: string;
  readonly segmentKey: string;
  readonly segmentLabel: string;
  readonly asOf: Date;
  readonly from: Date;
  readonly to: Date;
  readonly closedTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly breakeven: number;
  readonly grossPnl: unknown;
  readonly netPnl: unknown;
  readonly fees: unknown;
  readonly averageR: unknown;
  readonly profitFactor: unknown;
  readonly maxDrawdownPct: unknown;
  readonly averageHoldMinutes: unknown;
  readonly expectancy: unknown;
  readonly winRatePct: unknown;
  readonly grossProfit: unknown;
  readonly grossLoss: unknown;
  readonly simulatedExecutionCost: unknown;
  readonly averageWin: unknown;
  readonly averageLoss: unknown;
  readonly cumulativeR: unknown;
  readonly tradesWithPlannedRisk: number;
  readonly maxWinStreak: number;
  readonly maxLossStreak: number;
  readonly maxDrawdownAmount: unknown;
  readonly recoveryFactor: unknown;
  readonly exposureMinutes: unknown;
  readonly exposurePct: unknown;
  readonly averageMaePct: unknown;
  readonly averageMfePct: unknown;
  readonly sharpeRatio: unknown;
  readonly sortinoRatio: unknown;
  readonly returnObservations: number;
  readonly assessedCandidates: number;
  readonly riskRejectedCandidates: number;
  readonly invalidCandidates: number;
  readonly expiredCandidates: number;
  readonly riskRejectionRatePct: unknown;
  readonly metricsJson: unknown;
  readonly engineVersion: string;
  readonly codeVersion: string;
  readonly dataThroughAt: Date | null;
  readonly computedAt: Date | null;
  readonly sourceThroughPositionEventId: string | null;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly createdAt: Date;
}

/**
 * Extract `{ metric: reason }` for every metric the engine reported as null.
 * Reading it from the stored `metricsJson` rather than re-deriving it keeps
 * the API's answer identical to what the engine actually decided.
 */
function extractNullReasons(metricsJson: unknown): Record<string, string> {
  if (metricsJson === null || typeof metricsJson !== "object" || Array.isArray(metricsJson)) return {};
  const reasons: Record<string, string> = {};
  for (const [key, value] of Object.entries(metricsJson as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const metric = value as { value?: unknown; reason?: unknown };
    if (metric.value === null && typeof metric.reason === "string") reasons[key] = metric.reason;
  }
  return reasons;
}

export function toPerformanceSegment(row: StrategyPerformanceSegmentRow) {
  return {
    id: row.id,
    snapshotKey: row.snapshotKey,
    portfolioId: row.portfolioId,
    strategyVersionId: row.strategyVersionId,
    window: row.window,
    segmentType: row.segmentType,
    segmentKey: row.segmentKey,
    segmentLabel: row.segmentLabel,
    asOf: toIso(row.asOf),
    from: toIso(row.from),
    to: toIso(row.to),

    closedTrades: row.closedTrades,
    wins: row.wins,
    losses: row.losses,
    breakeven: row.breakeven,
    winRatePct: decimalOrNull(row.winRatePct),

    grossPnl: decimalString(row.grossPnl),
    netPnl: decimalString(row.netPnl),
    fees: decimalString(row.fees),
    simulatedExecutionCost: decimalString(row.simulatedExecutionCost),
    grossProfit: decimalString(row.grossProfit),
    grossLoss: decimalString(row.grossLoss),

    averageWin: decimalOrNull(row.averageWin),
    averageLoss: decimalOrNull(row.averageLoss),
    profitFactor: decimalString(row.profitFactor),
    expectancy: decimalString(row.expectancy),

    averageR: decimalString(row.averageR),
    cumulativeR: decimalOrNull(row.cumulativeR),
    tradesWithPlannedRisk: row.tradesWithPlannedRisk,

    maxWinStreak: row.maxWinStreak,
    maxLossStreak: row.maxLossStreak,

    maxDrawdownAmount: decimalOrNull(row.maxDrawdownAmount),
    maxDrawdownPct: decimalString(row.maxDrawdownPct),
    recoveryFactor: decimalOrNull(row.recoveryFactor),

    averageHoldMinutes: decimalString(row.averageHoldMinutes),
    exposureMinutes: decimalString(row.exposureMinutes),
    exposurePct: decimalOrNull(row.exposurePct),

    averageMaePct: decimalOrNull(row.averageMaePct),
    averageMfePct: decimalOrNull(row.averageMfePct),

    sharpeRatio: decimalOrNull(row.sharpeRatio),
    sortinoRatio: decimalOrNull(row.sortinoRatio),
    returnObservations: row.returnObservations,

    assessedCandidates: row.assessedCandidates,
    riskRejectedCandidates: row.riskRejectedCandidates,
    invalidCandidates: row.invalidCandidates,
    expiredCandidates: row.expiredCandidates,
    riskRejectionRatePct: decimalOrNull(row.riskRejectionRatePct),

    // Provenance — P8, "6.": "Datenbasis, Berechnungsversion und
    // Aktualisierungszeitpunkt".
    provenance: {
      engineVersion: row.engineVersion,
      codeVersion: row.codeVersion,
      inputHash: row.inputHash,
      outputHash: row.outputHash,
      dataThroughAt: toIsoOrNull(row.dataThroughAt),
      computedAt: toIsoOrNull(row.computedAt),
      sourceThroughPositionEventId: row.sourceThroughPositionEventId,
      createdAt: toIso(row.createdAt)
    },
    nullReasons: extractNullReasons(row.metricsJson)
  };
}

export interface AlertOutboxAttemptRow {
  readonly id: string;
  readonly attempt: number;
  readonly status: string;
  readonly error: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export interface AlertOutboxRow {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly severity: string;
  readonly status: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly portfolioId: string | null;
  readonly tradingSessionId: string | null;
  readonly reasonCode: string;
  readonly payloadJson: unknown;
  readonly payloadHash: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date;
  readonly lastAttemptAt: Date | null;
  readonly lastError: string | null;
  readonly sentAt: Date | null;
  readonly deadLetteredAt: Date | null;
  readonly alertId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly attempts?: readonly AlertOutboxAttemptRow[];
}

export function toAlertOutboxEntry(row: AlertOutboxRow) {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    eventType: row.eventType,
    severity: row.severity,
    status: row.status,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    portfolioId: row.portfolioId,
    tradingSessionId: row.tradingSessionId,
    reasonCode: row.reasonCode,
    // Already sanitised at enqueue time by the worker — no secret, token or
    // env value can be in here by construction.
    payload: row.payloadJson,
    payloadHash: row.payloadHash,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: toIso(row.nextAttemptAt),
    lastAttemptAt: toIsoOrNull(row.lastAttemptAt),
    lastError: row.lastError,
    sentAt: toIsoOrNull(row.sentAt),
    deadLetteredAt: toIsoOrNull(row.deadLetteredAt),
    alertId: row.alertId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    attempts: (row.attempts ?? []).map((attempt) => ({
      id: attempt.id,
      attempt: attempt.attempt,
      status: attempt.status,
      error: attempt.error,
      startedAt: toIso(attempt.startedAt),
      finishedAt: toIso(attempt.finishedAt),
      durationMs: attempt.finishedAt.getTime() - attempt.startedAt.getTime()
    }))
  };
}
