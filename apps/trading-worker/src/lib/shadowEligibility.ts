/**
 * Shadow-Eligibility-Report (P8, "7. Shadow-Eligibility-Report").
 *
 * Answers exactly one question — "is SignalPilot ready for a longer shadow
 * test phase?" — as `READY`, `NOT_READY` or `ERROR`, with a concrete reason
 * per failed check.
 *
 * The report is strictly read-only. It contains no write of any kind: no
 * activation, no flag change, no session transition, no bootstrap, no
 * migration. Running it a thousand times changes nothing (P8: "Der Report darf
 * nichts aktivieren").
 *
 * A single failed BLOCKER check makes the whole report `NOT_READY` — there is
 * no "mostly ready". `ERROR` is reserved for the report itself failing to
 * establish the facts (a database error), which is not the same as knowing the
 * system is not ready.
 */

import {
  InstrumentExecutionProfileStatus,
  PortfolioStatus,
  RiskLimitSetStatus,
  RiskSeverity,
  ShadowPositionStatus,
  StrategyVersionStatus,
  TradingAlertOutboxStatus,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";

import { CircuitBreakerScope, evaluateCircuitBreaker } from "./circuitBreaker.js";
import { checkShadowBaseAllowed, type EnvSource } from "./tradingSafety.js";

export const EligibilityStatus = {
  READY: "READY",
  NOT_READY: "NOT_READY",
  ERROR: "ERROR"
} as const;
export type EligibilityStatus = (typeof EligibilityStatus)[keyof typeof EligibilityStatus];

export const CheckOutcome = {
  PASS: "PASS",
  FAIL: "FAIL",
  /** True but not disqualifying — the operator should still see it. */
  WARN: "WARN"
} as const;
export type CheckOutcome = (typeof CheckOutcome)[keyof typeof CheckOutcome];

export interface EligibilityCheck {
  readonly code: string;
  readonly label: string;
  readonly outcome: CheckOutcome;
  /** A failed BLOCKER makes the whole report NOT_READY; a WARN never does. */
  readonly blocking: boolean;
  readonly reason: string;
  readonly details?: Record<string, unknown>;
}

export interface EligibilityReport {
  readonly status: EligibilityStatus;
  readonly asOf: string;
  readonly reportVersion: string;
  readonly checks: readonly EligibilityCheck[];
  readonly blockingFailures: readonly string[];
  readonly warnings: readonly string[];
}

export const ELIGIBILITY_REPORT_VERSION = "shadow-eligibility-v1";

/** Heartbeat age past which the worker counts as absent. */
const HEARTBEAT_STALE_MS = 15 * 60_000;
/** Reconciliation age past which the ledger check counts as stale. */
const RECONCILE_STALE_MS = 24 * 60 * 60_000;
/** Minimum closed candles per active asset before the data history is credible. */
const MIN_CANDLES_PER_ASSET = 500;

const pass = (code: string, label: string, reason: string, details?: Record<string, unknown>): EligibilityCheck => ({
  code,
  label,
  outcome: CheckOutcome.PASS,
  blocking: true,
  reason,
  details
});

const fail = (code: string, label: string, reason: string, details?: Record<string, unknown>): EligibilityCheck => ({
  code,
  label,
  outcome: CheckOutcome.FAIL,
  blocking: true,
  reason,
  details
});

const warn = (code: string, label: string, reason: string, details?: Record<string, unknown>): EligibilityCheck => ({
  code,
  label,
  outcome: CheckOutcome.WARN,
  blocking: false,
  reason,
  details
});

export interface BuildEligibilityReportOptions {
  readonly asOf: Date;
  readonly env?: EnvSource;
}

/**
 * Gather every fact and grade it. Only reads; never writes.
 */
export async function buildEligibilityReport(
  database: PrismaClient,
  options: BuildEligibilityReportOptions
): Promise<EligibilityReport> {
  const asOf = options.asOf;
  const env = options.env ?? process.env;
  const checks: EligibilityCheck[] = [];

  try {
    // ── 1. Migrations present ────────────────────────────────────────────
    // The shadow trading tables are the migration's own visible effect; if a
    // query against them succeeds, the migration ran.
    const migrationProbe = await database.portfolio.count();
    checks.push(
      pass("MIGRATIONS_PRESENT", "Migrationen vorhanden", "Die Shadow-Trading-Tabellen sind abfragbar.", {
        portfolioCount: migrationProbe
      })
    );

    // ── 2. No exchange or live-trading capability ─────────────────────────
    const base = checkShadowBaseAllowed(env);
    checks.push(
      base.allowed
        ? pass(
            "SHADOW_ONLY_CAPABILITY",
            "Keine Exchange- oder Live-Trading-Capability",
            "Build ist SHADOW_ONLY, TRADING_MODE=SHADOW, ENABLE_LIVE_TRADING=false.",
            { buildCapability: base.flags.buildCapability, tradingMode: base.flags.tradingMode }
          )
        : fail(
            "SHADOW_ONLY_CAPABILITY",
            "Keine Exchange- oder Live-Trading-Capability",
            `Shadow-Only-Basiskonfiguration nicht erfüllt: ${base.reasonCode} — ${base.message}`
          )
    );

    // ── 3. Portfolio ──────────────────────────────────────────────────────
    const portfolio = await database.portfolio.findFirst({
      where: { status: { not: PortfolioStatus.ARCHIVED } },
      orderBy: { createdAt: "asc" }
    });

    if (portfolio === null) {
      checks.push(
        fail("PORTFOLIO_PRESENT", "Bootstrap vollständig", "Es existiert kein nicht-archiviertes Portfolio.")
      );
    } else {
      checks.push(
        portfolio.status === PortfolioStatus.ERROR_LOCKED
          ? fail(
              "PORTFOLIO_PRESENT",
              "Bootstrap vollständig",
              `Portfolio ${portfolio.key} steht auf ERROR_LOCKED.`,
              { portfolioId: portfolio.id, status: portfolio.status }
            )
          : pass("PORTFOLIO_PRESENT", "Bootstrap vollständig", `Portfolio ${portfolio.key} ist ${portfolio.status}.`, {
              portfolioId: portfolio.id,
              status: portfolio.status
            })
      );

      // ── 4. Portfolio consistent (reconciliation fresh and clean) ────────
      const reconcileAge =
        portfolio.lastReconciledAt === null ? null : asOf.getTime() - portfolio.lastReconciledAt.getTime();
      checks.push(
        portfolio.lastReconciledAt === null
          ? fail("RECONCILIATION_FRESH", "Reconciliation aktuell", "Das Portfolio wurde noch nie abgeglichen.")
          : reconcileAge !== null && reconcileAge > RECONCILE_STALE_MS
            ? fail(
                "RECONCILIATION_FRESH",
                "Reconciliation aktuell",
                `Letzter Abgleich liegt ${Math.floor(reconcileAge / 3_600_000)} Stunden zurück.`,
                { lastReconciledAt: portfolio.lastReconciledAt.toISOString() }
              )
            : pass("RECONCILIATION_FRESH", "Reconciliation aktuell", "Der letzte Abgleich ist frisch.", {
                lastReconciledAt: portfolio.lastReconciledAt.toISOString()
              })
      );

      const ledgerCount = await database.portfolioLedgerEntry.count({ where: { portfolioId: portfolio.id } });
      checks.push(
        ledgerCount === portfolio.ledgerSequence
          ? pass(
              "PORTFOLIO_CONSISTENT",
              "Portfolio konsistent",
              `Ledger-Sequenz ${portfolio.ledgerSequence} entspricht ${ledgerCount} Einträgen.`
            )
          : fail(
              "PORTFOLIO_CONSISTENT",
              "Portfolio konsistent",
              `Ledger-Sequenz ${portfolio.ledgerSequence} passt nicht zu ${ledgerCount} Einträgen.`,
              { ledgerSequence: portfolio.ledgerSequence, ledgerCount }
            )
      );

      const snapshotCount = await database.portfolioSnapshot.count({ where: { portfolioId: portfolio.id } });
      checks.push(
        snapshotCount > 0
          ? pass("PORTFOLIO_SNAPSHOTS", "Portfolio-Snapshots vorhanden", `${snapshotCount} Snapshots vorhanden.`)
          : warn(
              "PORTFOLIO_SNAPSHOTS",
              "Portfolio-Snapshots vorhanden",
              "Noch kein Portfolio-Snapshot — Equity-Kurve und Sharpe/Sortino bleiben leer."
            )
      );

      // ── 5. Session state and kill switch ────────────────────────────────
      const session = await database.tradingSession.findFirst({
        where: { portfolioId: portfolio.id, status: { not: TradingSessionStatus.CLOSED } },
        orderBy: { createdAt: "desc" }
      });

      if (session === null) {
        checks.push(
          fail("SESSION_PRESENT", "Sessionzustand", "Es existiert keine offene TradingSession für das Portfolio.")
        );
      } else {
        checks.push(
          session.status === TradingSessionStatus.ERROR_LOCKED
            ? fail("SESSION_NOT_ERROR_LOCKED", "Kein ERROR_LOCKED", "Die TradingSession steht auf ERROR_LOCKED.", {
                sessionId: session.id,
                killReasonCode: session.killReasonCode
              })
            : pass("SESSION_NOT_ERROR_LOCKED", "Kein ERROR_LOCKED", `Session-Status ist ${session.status}.`, {
                sessionId: session.id,
                status: session.status
              })
        );

        // A closed kill switch is the SAFE state before a test phase, not a
        // defect — it is reported, never demanded to be open.
        checks.push(
          warn(
            "KILL_SWITCH_STATE",
            "Kill Switch",
            session.killSwitchEngaged
              ? "Kill Switch ist aktiv — das ist der sichere Ausgangszustand, muss für den Testlauf aber bewusst gelöst werden."
              : "Kill Switch ist gelöst.",
            { killSwitchEngaged: session.killSwitchEngaged, killReasonCode: session.killReasonCode }
          )
        );

        const heartbeatAge =
          session.heartbeatAt === null ? null : asOf.getTime() - session.heartbeatAt.getTime();
        checks.push(
          session.heartbeatAt === null
            ? warn(
                "WORKER_HEARTBEAT",
                "Scheduler-/Worker-Konfiguration",
                "Es wurde noch kein Worker-Heartbeat aufgezeichnet."
              )
            : heartbeatAge !== null && heartbeatAge > HEARTBEAT_STALE_MS
              ? fail(
                  "WORKER_HEARTBEAT",
                  "Scheduler-/Worker-Konfiguration",
                  `Der letzte Heartbeat liegt ${Math.floor(heartbeatAge / 60_000)} Minuten zurück.`,
                  { heartbeatAt: session.heartbeatAt.toISOString() }
                )
              : pass("WORKER_HEARTBEAT", "Scheduler-/Worker-Konfiguration", "Der Worker-Heartbeat ist frisch.", {
                  heartbeatAt: session.heartbeatAt.toISOString()
                })
        );
      }

      // ── 6. No unacknowledged critical risk events ───────────────────────
      const criticalRiskEvents = await database.riskEvent.count({
        where: { portfolioId: portfolio.id, severity: RiskSeverity.CRITICAL, acknowledgedAt: null }
      });
      checks.push(
        criticalRiskEvents === 0
          ? pass("NO_CRITICAL_RISK_EVENTS", "Keine kritischen Risk Events", "Keine offenen CRITICAL-Risk-Events.")
          : fail(
              "NO_CRITICAL_RISK_EVENTS",
              "Keine kritischen Risk Events",
              `${criticalRiskEvents} unbestätigte CRITICAL-Risk-Events.`,
              { criticalRiskEvents }
            )
      );

      // ── 7. Assignment and strategy version ──────────────────────────────
      const assignments = await database.strategyAssignment.findMany({
        where: { portfolioId: portfolio.id, enabled: true },
        select: { id: true, assetId: true, strategyVersionId: true, timeframe: true }
      });
      checks.push(
        assignments.length > 0
          ? pass(
              "ACTIVE_ASSIGNMENT",
              "Aktive StrategyVersion und Assignment",
              `${assignments.length} aktivierte Assignments.`,
              { assignmentCount: assignments.length }
            )
          : fail(
              "ACTIVE_ASSIGNMENT",
              "Aktive StrategyVersion und Assignment",
              "Kein aktiviertes StrategyAssignment für das Portfolio."
            )
      );

      const versionIds = [...new Set(assignments.map((entry) => entry.strategyVersionId))];
      const activeVersions =
        versionIds.length === 0
          ? 0
          : await database.strategyVersion.count({
              where: { id: { in: versionIds }, status: StrategyVersionStatus.ACTIVE }
            });
      checks.push(
        versionIds.length > 0 && activeVersions === versionIds.length
          ? pass(
              "ACTIVE_STRATEGY_VERSION",
              "Aktive StrategyVersion",
              `${activeVersions} aktive StrategyVersions hinter den Assignments.`
            )
          : fail(
              "ACTIVE_STRATEGY_VERSION",
              "Aktive StrategyVersion",
              `${activeVersions} von ${versionIds.length} referenzierten StrategyVersions sind ACTIVE.`,
              { referenced: versionIds.length, active: activeVersions }
            )
      );

      // ── 8. Execution profiles for every assigned asset ──────────────────
      const assignedAssetIds = [...new Set(assignments.map((entry) => entry.assetId))];
      const profileAssetIds =
        assignedAssetIds.length === 0
          ? []
          : (
              await database.instrumentExecutionProfile.findMany({
                where: {
                  assetId: { in: assignedAssetIds },
                  status: InstrumentExecutionProfileStatus.ACTIVE
                },
                select: { assetId: true }
              })
            ).map((entry) => entry.assetId);
      const missingProfiles = assignedAssetIds.filter((assetId) => !profileAssetIds.includes(assetId));
      checks.push(
        assignedAssetIds.length > 0 && missingProfiles.length === 0
          ? pass(
              "EXECUTION_PROFILES",
              "Execution Profiles vorhanden",
              `Für alle ${assignedAssetIds.length} zugewiesenen Assets existiert ein aktives Profil.`
            )
          : fail(
              "EXECUTION_PROFILES",
              "Execution Profiles vorhanden",
              assignedAssetIds.length === 0
                ? "Keine zugewiesenen Assets, daher kein prüfbares Execution Profile."
                : `${missingProfiles.length} zugewiesene Assets ohne aktives Execution Profile.`,
              { missingProfiles }
            )
      );

      // ── 9. Data history and quality ─────────────────────────────────────
      const thinAssets: string[] = [];
      for (const assetId of assignedAssetIds) {
        // Candle has no `isClosed` column — a persisted candle is by
        // definition a closed one (the fetchers only write finished bars).
        const candles = await database.candle.count({ where: { assetId, timeframe: "1h" } });
        if (candles < MIN_CANDLES_PER_ASSET) thinAssets.push(assetId);
      }
      checks.push(
        assignedAssetIds.length > 0 && thinAssets.length === 0
          ? pass(
              "DATA_HISTORY",
              "Datenhistorie und Datenqualität",
              `Alle zugewiesenen Assets haben mindestens ${MIN_CANDLES_PER_ASSET} geschlossene 1h-Kerzen.`
            )
          : fail(
              "DATA_HISTORY",
              "Datenhistorie und Datenqualität",
              assignedAssetIds.length === 0
                ? "Keine zugewiesenen Assets, daher keine prüfbare Datenhistorie."
                : `${thinAssets.length} Assets unter ${MIN_CANDLES_PER_ASSET} geschlossenen 1h-Kerzen.`,
              { thinAssets, minimum: MIN_CANDLES_PER_ASSET }
            )
      );

      // ── 10. Circuit breakers closed ─────────────────────────────────────
      const breakerJobs = [
        { jobKey: "trading:monitor-positions", scope: CircuitBreakerScope.MONITORING },
        { jobKey: "trading:reconcile", scope: CircuitBreakerScope.MONITORING }
      ] as const;
      const openBreakers: string[] = [];
      for (const job of breakerJobs) {
        const breaker = await evaluateCircuitBreaker(database, {
          jobKey: job.jobKey,
          portfolioId: portfolio.id,
          scope: job.scope,
          asOf
        });
        if (!breaker.allowed) openBreakers.push(`${job.jobKey}:${breaker.reasonCode ?? breaker.state}`);
      }
      checks.push(
        openBreakers.length === 0
          ? pass("CIRCUIT_BREAKERS_CLOSED", "Circuit Breaker", "Kein Monitoring-Circuit-Breaker ist offen.")
          : fail("CIRCUIT_BREAKERS_CLOSED", "Circuit Breaker", `Offene Circuit Breaker: ${openBreakers.join(", ")}.`, {
              openBreakers
            })
      );

      // ── 11. Every open position has a live exit plan ────────────────────
      const positionsWithoutExit = await database.shadowPosition.count({
        where: {
          portfolioId: portfolio.id,
          status: {
            in: [
              ShadowPositionStatus.OPENING,
              ShadowPositionStatus.OPEN,
              ShadowPositionStatus.PARTIALLY_CLOSED,
              ShadowPositionStatus.ERROR
            ]
          },
          activeExitPlanVersion: null
        }
      });
      checks.push(
        positionsWithoutExit === 0
          ? pass("POSITIONS_HAVE_EXITS", "Positionen mit sicherem Exit", "Jede offene Position hat einen aktiven ExitPlan.")
          : fail(
              "POSITIONS_HAVE_EXITS",
              "Positionen mit sicherem Exit",
              `${positionsWithoutExit} offene Positionen ohne aktiven ExitPlan.`,
              { positionsWithoutExit }
            )
      );
    }

    // ── 12. Valid risk limit set ──────────────────────────────────────────
    const activeLimitSet = await database.riskLimitSet.findFirst({
      where: { status: RiskLimitSetStatus.ACTIVE },
      orderBy: { version: "desc" }
    });
    checks.push(
      activeLimitSet === null
        ? fail("ACTIVE_RISK_LIMIT_SET", "Gültiges RiskLimitSet", "Kein aktives RiskLimitSet vorhanden.")
        : pass(
            "ACTIVE_RISK_LIMIT_SET",
            "Gültiges RiskLimitSet",
            `RiskLimitSet ${activeLimitSet.key} v${activeLimitSet.version} ist aktiv.`,
            { riskLimitSetId: activeLimitSet.id, version: activeLimitSet.version }
          )
    );

    // ── 13. Alert outbox operable ─────────────────────────────────────────
    const [deadAlerts, pendingAlerts] = await Promise.all([
      database.tradingAlertOutbox.count({ where: { status: TradingAlertOutboxStatus.DEAD } }),
      database.tradingAlertOutbox.count({ where: { status: TradingAlertOutboxStatus.PENDING } })
    ]);
    checks.push(
      deadAlerts === 0
        ? pass("ALERT_OUTBOX_HEALTHY", "Alert-Outbox funktionsfähig", "Keine Dead-Letter-Einträge in der Outbox.", {
            pendingAlerts
          })
        : fail(
            "ALERT_OUTBOX_HEALTHY",
            "Alert-Outbox funktionsfähig",
            `${deadAlerts} Alerts konnten endgültig nicht zugestellt werden.`,
            { deadAlerts, pendingAlerts }
          )
    );
    checks.push(
      base.allowed && base.flags.alertOutboxEnabled
        ? pass("ALERT_OUTBOX_ENABLED", "Alert-Outbox aktiviert", "TRADING_ALERT_OUTBOX_ENABLED ist true.")
        : fail(
            "ALERT_OUTBOX_ENABLED",
            "Alert-Outbox aktiviert",
            "TRADING_ALERT_OUTBOX_ENABLED ist nicht true — sicherheitsrelevante Ereignisse würden nicht erfasst."
          )
    );
  } catch (error) {
    // The report could not establish the facts. That is explicitly not the
    // same as "the system is not ready" and is reported as its own status.
    return {
      status: EligibilityStatus.ERROR,
      asOf: asOf.toISOString(),
      reportVersion: ELIGIBILITY_REPORT_VERSION,
      checks: [
        {
          code: "REPORT_FAILED",
          label: "Report konnte nicht erstellt werden",
          outcome: CheckOutcome.FAIL,
          blocking: true,
          reason: error instanceof Error ? error.message : "Unbekannter Fehler beim Erstellen des Reports."
        }
      ],
      blockingFailures: ["REPORT_FAILED"],
      warnings: []
    };
  }

  const blockingFailures = checks
    .filter((check) => check.blocking && check.outcome === CheckOutcome.FAIL)
    .map((check) => check.code);
  const warnings = checks.filter((check) => check.outcome === CheckOutcome.WARN).map((check) => check.code);

  return {
    status: blockingFailures.length === 0 ? EligibilityStatus.READY : EligibilityStatus.NOT_READY,
    asOf: asOf.toISOString(),
    reportVersion: ELIGIBILITY_REPORT_VERSION,
    checks,
    blockingFailures,
    warnings
  };
}
