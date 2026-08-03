/**
 * Scheduler-level precondition guard for the entry-side jobs (candidate,
 * risk, order, fill).
 *
 * Specification: P5 task, "Workflow und Reihenfolge" — "Neue Exposition
 * blockiert, wenn Voraussetzungen fehlen: Session `SHADOW_ACTIVE`; Kill
 * Switch aus; Portfolio aktiv und erfolgreich reconciled; Tages-Snapshot vor
 * neuen Trades des UTC-Tages."
 *
 * This does NOT replace the existing enforcement — `R-002-SESSION`,
 * `R-003-PORTFOLIO-CONSISTENCY`, `R-016-DATA-FRESHNESS` and
 * `R-010-DAILY-LOSS` already refuse a `RiskAssessment` (and therefore any
 * downstream order/fill) under exactly these conditions, and
 * `shadowOrderPersistence.ts` re-checks session/kill-switch/portfolio status
 * defensively before reserving cash. This guard sits one layer further out,
 * at the scheduler: when the whole portfolio is obviously blocked there is
 * no reason to spend a strategy evaluation, a risk assessment or a fill
 * attempt only to have it rejected downstream, and gating the fill job here
 * closes the one real gap in the existing chain — `processEntryOrderFillForCandle`
 * itself does not re-check the session before turning an already-accepted
 * order into a new open position.
 *
 * Shadow v1 has exactly one non-archived portfolio and one non-`CLOSED`
 * session per portfolio (docs/trading/03), so a single guard call resolves
 * one verdict for the whole entry pipeline rather than a per-job, per-symbol
 * lookup.
 */

import {
  PortfolioStatus,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import { RISK_FRESHNESS_LIMITS_MS } from "@signalpilot/risk-engine";

export const EntryWorkflowReasonCode = {
  NO_PORTFOLIO: "ENTRY_GUARD_NO_PORTFOLIO",
  PORTFOLIO_NOT_ACTIVE: "ENTRY_GUARD_PORTFOLIO_NOT_ACTIVE",
  NO_SESSION: "ENTRY_GUARD_NO_SESSION",
  SESSION_NOT_ACTIVE: "ENTRY_GUARD_SESSION_NOT_ACTIVE",
  KILL_SWITCH_ENGAGED: "ENTRY_GUARD_KILL_SWITCH_ENGAGED",
  RECONCILIATION_STALE: "ENTRY_GUARD_RECONCILIATION_STALE",
  DAILY_SNAPSHOT_MISSING: "ENTRY_GUARD_DAILY_SNAPSHOT_MISSING"
} as const;
export type EntryWorkflowReasonCode =
  (typeof EntryWorkflowReasonCode)[keyof typeof EntryWorkflowReasonCode];

export type EntryWorkflowGuardResult =
  | { readonly allowed: true; readonly portfolioId: string; readonly sessionId: string }
  | {
      readonly allowed: false;
      readonly reasonCode: EntryWorkflowReasonCode;
      readonly message: string;
      readonly portfolioId: string | null;
      readonly sessionId: string | null;
    };

const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export async function resolveEntryWorkflowGuard(
  database: PrismaClient,
  asOf: Date
): Promise<EntryWorkflowGuardResult> {
  const portfolio = await database.portfolio.findFirst({
    where: { status: { not: PortfolioStatus.ARCHIVED } },
    orderBy: { createdAt: "asc" }
  });
  if (portfolio === null) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.NO_PORTFOLIO,
      message: "No non-archived Portfolio exists yet.",
      portfolioId: null,
      sessionId: null
    };
  }
  if (portfolio.status !== PortfolioStatus.ACTIVE) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.PORTFOLIO_NOT_ACTIVE,
      message: `Portfolio ${portfolio.id} is ${portfolio.status}, not ACTIVE.`,
      portfolioId: portfolio.id,
      sessionId: null
    };
  }

  const session = await database.tradingSession.findFirst({
    where: { portfolioId: portfolio.id, status: { not: TradingSessionStatus.CLOSED } },
    orderBy: { createdAt: "desc" }
  });
  if (session === null) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.NO_SESSION,
      message: `Portfolio ${portfolio.id} has no open TradingSession.`,
      portfolioId: portfolio.id,
      sessionId: null
    };
  }
  if (session.status !== TradingSessionStatus.SHADOW_ACTIVE) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.SESSION_NOT_ACTIVE,
      message: `TradingSession ${session.id} is ${session.status}, not SHADOW_ACTIVE.`,
      portfolioId: portfolio.id,
      sessionId: session.id
    };
  }
  if (session.killSwitchEngaged) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.KILL_SWITCH_ENGAGED,
      message: `TradingSession ${session.id} has the kill switch engaged.`,
      portfolioId: portfolio.id,
      sessionId: session.id
    };
  }

  const reconciledAgeMs =
    portfolio.lastReconciledAt === null
      ? Number.POSITIVE_INFINITY
      : asOf.getTime() - portfolio.lastReconciledAt.getTime();
  if (reconciledAgeMs > RISK_FRESHNESS_LIMITS_MS.portfolioSnapshot) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.RECONCILIATION_STALE,
      message: `Portfolio ${portfolio.id} was last reconciled ${
        portfolio.lastReconciledAt === null ? "never" : portfolio.lastReconciledAt.toISOString()
      }, older than the ${RISK_FRESHNESS_LIMITS_MS.portfolioSnapshot}ms ceiling.`,
      portfolioId: portfolio.id,
      sessionId: session.id
    };
  }

  const tradingDateUtc = startOfUtcDay(asOf);
  const snapshot = await database.portfolioSnapshot.findFirst({
    where: { portfolioId: portfolio.id, tradingDateUtc }
  });
  if (snapshot === null) {
    return {
      allowed: false,
      reasonCode: EntryWorkflowReasonCode.DAILY_SNAPSHOT_MISSING,
      message: `Portfolio ${portfolio.id} has no start-of-day snapshot for ${tradingDateUtc.toISOString()}.`,
      portfolioId: portfolio.id,
      sessionId: session.id
    };
  }

  return { allowed: true, portfolioId: portfolio.id, sessionId: session.id };
}
