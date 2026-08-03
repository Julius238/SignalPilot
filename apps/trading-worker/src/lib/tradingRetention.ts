/**
 * Retention for expendable technical rows only (P8, "8. Retention").
 *
 * The allowlist below is the whole policy, and it is an allowlist by
 * construction: there is no code path in this module that can delete a table
 * that is not one of these three. Everything with business meaning —
 * TradeCandidate, TradeDecision, RiskAssessment, RiskRuleResult, RiskEvent,
 * ShadowOrder, ShadowFill, ShadowPosition, ShadowPositionEvent, ExitPlan,
 * PortfolioLedgerEntry, PortfolioSnapshot, StrategyPerformance,
 * TradingAuditEvent — is unreachable from here and stays unreachable.
 *
 * Dry run is the default and the only thing the flag alone permits. Actually
 * deleting requires a second, explicit `apply: true` from the caller (P8:
 * "Keine produktive Löschung ohne klaren Dry-Run und eigene Aktivierung").
 */

import { BotRunStatus, TradingAlertOutboxStatus, type PrismaClient } from "@signalpilot/database";

/** Milliseconds per day, for readable policy constants. */
const DAY_MS = 24 * 60 * 60_000;

export const RetentionTarget = {
  /** Successful `BotRun` rows older than the cutoff. Failures are kept. */
  SUCCESSFUL_BOT_RUNS: "SUCCESSFUL_BOT_RUNS",
  /** Non-error `BotLog` rows older than the cutoff. Warnings and errors are kept. */
  INFO_BOT_LOGS: "INFO_BOT_LOGS",
  /**
   * Delivery attempts of outbox entries that reached `SENT`. The outbox entry
   * itself is never deleted — only its per-attempt log.
   */
  SENT_OUTBOX_ATTEMPTS: "SENT_OUTBOX_ATTEMPTS"
} as const;
export type RetentionTarget = (typeof RetentionTarget)[keyof typeof RetentionTarget];

export interface RetentionPolicy {
  readonly successfulBotRunDays: number;
  readonly infoBotLogDays: number;
  readonly sentOutboxAttemptDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  successfulBotRunDays: 30,
  infoBotLogDays: 30,
  sentOutboxAttemptDays: 30
};

export interface RetentionTargetResult {
  readonly target: RetentionTarget;
  readonly cutoff: string;
  readonly matched: number;
  readonly deleted: number;
}

export interface RetentionResult {
  readonly applied: boolean;
  readonly asOf: string;
  readonly policy: RetentionPolicy;
  readonly targets: readonly RetentionTargetResult[];
  readonly totalMatched: number;
  readonly totalDeleted: number;
}

export interface RunTradingRetentionOptions {
  readonly asOf: Date;
  readonly policy?: RetentionPolicy;
  /**
   * `false` (the default) counts what a run would delete and deletes nothing.
   * Only an explicit `true` — separate from the feature flag — deletes.
   */
  readonly apply?: boolean;
}

const cutoffFor = (asOf: Date, days: number): Date => new Date(asOf.getTime() - days * DAY_MS);

/**
 * Count, and optionally delete, every allowlisted technical row past its
 * cutoff. Always returns what it matched, so a dry run is a complete preview
 * of what an applied run would remove.
 */
export async function runTradingRetention(
  database: PrismaClient,
  options: RunTradingRetentionOptions
): Promise<RetentionResult> {
  const policy = options.policy ?? DEFAULT_RETENTION_POLICY;
  const apply = options.apply === true;
  const targets: RetentionTargetResult[] = [];

  // ── Successful BotRuns ───────────────────────────────────────────────────
  const botRunCutoff = cutoffFor(options.asOf, policy.successfulBotRunDays);
  const botRunWhere = {
    status: BotRunStatus.SUCCESS,
    startedAt: { lt: botRunCutoff }
  } as const;
  const botRunMatched = await database.botRun.count({ where: botRunWhere });
  const botRunDeleted = apply ? (await database.botRun.deleteMany({ where: botRunWhere })).count : 0;
  targets.push({
    target: RetentionTarget.SUCCESSFUL_BOT_RUNS,
    cutoff: botRunCutoff.toISOString(),
    matched: botRunMatched,
    deleted: botRunDeleted
  });

  // ── Informational BotLogs ────────────────────────────────────────────────
  // `warn` and `error` are diagnostic evidence for an incident review and are
  // deliberately outside the cutoff.
  const botLogCutoff = cutoffFor(options.asOf, policy.infoBotLogDays);
  const botLogWhere = { level: "info", createdAt: { lt: botLogCutoff } } as const;
  const botLogMatched = await database.botLog.count({ where: botLogWhere });
  const botLogDeleted = apply ? (await database.botLog.deleteMany({ where: botLogWhere })).count : 0;
  targets.push({
    target: RetentionTarget.INFO_BOT_LOGS,
    cutoff: botLogCutoff.toISOString(),
    matched: botLogMatched,
    deleted: botLogDeleted
  });

  // ── Attempts of successfully delivered alerts ────────────────────────────
  // A FAILED or DEAD entry keeps its full attempt history — that history is
  // the evidence an operator needs.
  const attemptCutoff = cutoffFor(options.asOf, policy.sentOutboxAttemptDays);
  const attemptWhere = {
    createdAt: { lt: attemptCutoff },
    outbox: { status: TradingAlertOutboxStatus.SENT }
  } as const;
  const attemptMatched = await database.tradingAlertOutboxAttempt.count({ where: attemptWhere });
  const attemptDeleted = apply
    ? (await database.tradingAlertOutboxAttempt.deleteMany({ where: attemptWhere })).count
    : 0;
  targets.push({
    target: RetentionTarget.SENT_OUTBOX_ATTEMPTS,
    cutoff: attemptCutoff.toISOString(),
    matched: attemptMatched,
    deleted: attemptDeleted
  });

  return {
    applied: apply,
    asOf: options.asOf.toISOString(),
    policy,
    targets,
    totalMatched: targets.reduce((total, entry) => total + entry.matched, 0),
    totalDeleted: targets.reduce((total, entry) => total + entry.deleted, 0)
  };
}
