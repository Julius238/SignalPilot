import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { DirectionBadge } from "../../../../components/badges";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { OperationConfirm } from "../../../../components/trading/operation-confirm";
import {
  CircuitBreakerBadge,
  KillSwitchBadge,
  SessionStatusBadge
} from "../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import {
  CONFIRM_PHRASES,
  fetchAlertOutbox,
  fetchAlertOutboxSummary,
  fetchEligibilityReport,
  fetchShadowPositions,
  fetchStrategyAssignments,
  fetchTradingPortfolio,
  fetchTradingSessions,
  fetchWorkerStatus,
  RUN_JOB_ALLOWLIST,
  RUN_JOB_LABELS
} from "../../../../lib/trading-api";
import {
  formatDecimalAmount,
  formatUtcDateTime
} from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

export default async function TradingOperationsPage() {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const [
    portfolioResult,
    sessionsResult,
    workerResult,
    openPositionsResult,
    eligibilityResult,
    outboxSummaryResult,
    outboxResult,
    assignmentsResult
  ] = await Promise.all([
    fetchTradingPortfolio(),
    fetchTradingSessions({ limit: 5 }),
    fetchWorkerStatus(),
    fetchShadowPositions({ open: "true", limit: 100 }),
    fetchEligibilityReport(),
    fetchAlertOutboxSummary(),
    fetchAlertOutbox({ limit: 25 }),
    fetchStrategyAssignments({ limit: 20 })
  ]);

  const portfolio = portfolioResult.data;
  const sessions = sessionsResult.data ?? [];
  const session = sessions[0] ?? null;
  const worker = workerResult.data;
  const openPositions = openPositionsResult.data ?? [];
  const eligibility = eligibilityResult.data ?? null;
  const outboxSummary = outboxSummaryResult.data ?? null;
  const outboxEntries = outboxResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Operations"
        subtitle="Administrative Aktionen — jede Aktion verlangt Grund, Bestätigungstext, Version, CSRF und Idempotency-Key"
      />

      <p className="muted small" style={{ marginBottom: 16 }}>
        Diese Seite ist Teil des regulär authentifizierten Dashboards; es gibt
        nur eine Administrator-Rolle (kein separates Trading-Operator-Konto).
        Jede Aktion ruft die API mit einem frisch geholten CSRF-Token auf und
        erwartet serverseitig eine erlaubte Zustandsübergangs — das UI erzwingt
        keine eigene Trading-Logik.
      </p>

      {portfolioResult.error &&
      !portfolioResult.error.toLowerCase().includes("no portfolio exists") ? (
        <ErrorState
          title="Portfolio konnte nicht geladen werden"
          message={portfolioResult.error}
        />
      ) : null}
      {sessionsResult.error ? (
        <ErrorState
          title="Sessions konnten nicht geladen werden"
          message={sessionsResult.error}
        />
      ) : null}
      {workerResult.error ? (
        <ErrorState
          title="Worker-Status konnte nicht geladen werden"
          message={workerResult.error}
        />
      ) : null}

      <SectionCard
        title="Portfolio"
        subtitle={
          portfolio
            ? `${portfolio.name} · Status ${portfolio.status} · Version ${portfolio.version}`
            : "Kein Portfolio vorhanden"
        }
      >
        {portfolio ? (
          <div className="stack-list compact" style={{ marginBottom: 12 }}>
            <div className="list-row">
              <span>Equity</span>
              <strong>{formatDecimalAmount(portfolio.equity)}</strong>
            </div>
            <div className="list-row">
              <span>Verfügbares Cash</span>
              <strong>{formatDecimalAmount(portfolio.availableCash)}</strong>
            </div>
            <div className="list-row">
              <span>Letztes Reconcile</span>
              <strong>{formatUtcDateTime(portfolio.lastReconciledAt)}</strong>
            </div>
          </div>
        ) : null}

        <OperationConfirm
          title="Portfolio aktivieren"
          impact={
            portfolio
              ? `Setzt das Portfolio "${portfolio.name}" (aktuelle Version ${portfolio.version}) in den aktiven Status. Wirkt sich auf nachgelagerte Session-/Order-Gates aus.`
              : "Kein Portfolio vorhanden."
          }
          confirmPhrase={CONFIRM_PHRASES.activatePortfolio}
          endpoint="/trading/operations/activate-portfolio"
          reasonFieldName="reason"
          body={{
            base: {
              portfolioId: portfolio?.id,
              expectedVersion: portfolio?.version
            }
          }}
          disabledReason={
            portfolio
              ? null
              : "Kein Portfolio vorhanden — Aktion nicht verfügbar."
          }
        />
      </SectionCard>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Strategy Assignments"
          subtitle="BTCUSDT und ETHUSDT je Richtung einzeln; Änderungen sind versioniert und explizit bestätigt"
        >
          {assignmentsResult.error ? (
            <ErrorState
              title="Assignments konnten nicht geladen werden"
              message={assignmentsResult.error}
            />
          ) : null}
          {assignments.length > 0 ? (
            <div className="stack-list">
              {assignments.map((assignment) => {
                const action = assignment.enabled ? "DISABLE" : "ENABLE";
                const confirmation = `${action}_${assignment.symbol}_${assignment.direction ?? "UNKNOWN"}_${assignment.strategyKey}_V${assignment.version}`;
                const blocked =
                  !assignment.enabled &&
                  (!assignment.directionConsistent ||
                    assignment.direction === null ||
                    !assignment.syntheticShadowOnly ||
                    assignment.strategyStatus !== "ACTIVE" ||
                    assignment.strategyVersionStatus !== "ACTIVE");
                return (
                  <div
                    key={assignment.id}
                    className="list-row"
                    style={{ alignItems: "flex-start", gap: 16 }}
                  >
                    <div>
                      <strong>{assignment.symbol}</strong>{" "}
                      {assignment.direction ? (
                        <DirectionBadge value={assignment.direction} />
                      ) : (
                        "UNKNOWN"
                      )}
                      <div className="muted small">
                        {assignment.strategyKey} v{assignment.strategyVersion} ·
                        Assignment v{assignment.version} ·{" "}
                        {assignment.enabled ? "aktiv" : "deaktiviert"}
                      </div>
                    </div>
                    <div style={{ minWidth: 360 }}>
                      <OperationConfirm
                        title={
                          assignment.enabled
                            ? "Assignment deaktivieren"
                            : "Assignment aktivieren"
                        }
                        impact={
                          assignment.enabled
                            ? "Entzieht nur diesem Assignment die Berechtigung für neue Candidates; bestehende Exits bleiben möglich."
                            : "Erlaubt Candidates nur bei erfüllten Feature-Flags und Risk-/Session-Gates. Aktiviert weder Portfolio noch Session."
                        }
                        dangerous={!assignment.enabled}
                        confirmPhrase={confirmation}
                        endpoint="/trading/operations/set-assignment"
                        reasonFieldName="reason"
                        body={{
                          base: {
                            assignmentId: assignment.id,
                            expectedVersion: assignment.version,
                            enabled: !assignment.enabled
                          }
                        }}
                        disabledReason={
                          blocked
                            ? "Inkonsistentes oder nicht freigegebenes Shadow-Assignment — Änderung blockiert."
                            : null
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Keine Assignments vorhanden." />
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Session"
          subtitle={
            session
              ? `${session.sessionKey} · Version ${session.version}`
              : "Keine Session vorhanden"
          }
        >
          {session ? (
            <div className="stack-list compact" style={{ marginBottom: 12 }}>
              <div className="list-row">
                <span>Status</span>
                <div className="right-meta">
                  <SessionStatusBadge value={session.status} />
                  <KillSwitchBadge engaged={session.killSwitchEngaged} />
                </div>
              </div>
              <div className="list-row">
                <span>Heartbeat</span>
                <strong>{formatUtcDateTime(session.heartbeatAt)}</strong>
              </div>
              <div className="list-row">
                <span>Letztes Reconcile</span>
                <strong>{formatUtcDateTime(session.reconciledAt)}</strong>
              </div>
            </div>
          ) : null}

          {!session ? (
            <EmptyState title="Keine Trading-Session vorhanden." />
          ) : (
            <>
              <OperationConfirm
                title="Shadow aktivieren"
                impact="Aktiviert die Session für Shadow-Trading. Scheitert fail-closed, wenn Guards (Reconcile-Freshness, Konfiguration, Kill-Switch) nicht erfüllt sind."
                dangerous
                confirmPhrase={CONFIRM_PHRASES.activateSession}
                endpoint="/trading/operations/activate-session"
                reasonFieldName="reason"
                body={{
                  base: {
                    sessionId: session.id,
                    expectedVersion: session.version
                  }
                }}
              />
              <OperationConfirm
                title="Session pausieren"
                impact="Pausiert die Session. Neue Entries werden blockiert; bestehende Positionen werden weiter überwacht."
                confirmPhrase={CONFIRM_PHRASES.pauseSession}
                endpoint="/trading/operations/pause-session"
                reasonFieldName="reason"
                body={{
                  base: {
                    sessionId: session.id,
                    expectedVersion: session.version
                  }
                }}
              />
              <OperationConfirm
                title="Kill-Switch aktivieren"
                impact="Blockiert sofort neue Entries und storniert wartende Entry-Orders. Bestehende Stops/Exits bleiben aktiv — keine automatische Sofortliquidation."
                dangerous
                confirmPhrase={CONFIRM_PHRASES.engageKillSwitch}
                endpoint="/trading/operations/engage-kill-switch"
                reasonFieldName="reasonCode"
                reasonLabel="Grund (reasonCode)"
                body={{
                  base: {
                    sessionId: session.id,
                    expectedVersion: session.version
                  }
                }}
              />
              <OperationConfirm
                title="Kill-Switch kontrolliert lösen"
                impact="Löst den Kill-Switch. Die Session bleibt in ihrem sonstigen Status — Entries sind erst nach expliziter Aktivierung wieder möglich."
                dangerous
                confirmPhrase={CONFIRM_PHRASES.releaseKillSwitch}
                endpoint="/trading/operations/release-kill-switch"
                reasonFieldName="reason"
                body={{
                  base: {
                    sessionId: session.id,
                    expectedVersion: session.version
                  }
                }}
              />
              <OperationConfirm
                title="Session entsperren (ERROR_LOCKED → STOPPED)"
                impact="Nur verwenden, nachdem die Ursache der Sperre geprüft und ein erfolgreiches Reconcile durchgeführt wurde. Setzt die Session auf STOPPED zurück."
                dangerous
                confirmPhrase={CONFIRM_PHRASES.unlockSession}
                endpoint="/trading/operations/unlock-session"
                reasonFieldName="reason"
                extraFields={[
                  {
                    name: "confirmCauseResolved",
                    label: "Ich bestätige: Ursache wurde geprüft und behoben",
                    type: "checkbox",
                    required: true
                  }
                ]}
                body={{
                  base: {
                    sessionId: session.id,
                    expectedVersion: session.version
                  },
                  passthrough: ["confirmCauseResolved"]
                }}
              />
            </>
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Manueller Risk Close"
          subtitle="Nur für aktuell offene Positionen verfügbar"
        >
          {openPositions.length > 0 ? (
            <OperationConfirm
              title="Position risikoreduzierend schließen"
              impact="Fordert einen manuellen, risikoreduzierenden Shadow-Exit für die ausgewählte offene Position an. Kein Bypass von Risk Rules."
              dangerous
              confirmPhrase={CONFIRM_PHRASES.manualRiskClose}
              endpoint="/trading/operations/manual-risk-close"
              reasonFieldName="reasonNote"
              reasonLabel="Grund (reasonNote)"
              extraFields={[
                {
                  name: "positionId",
                  label: "Offene Position",
                  type: "select",
                  required: true,
                  options: openPositions.map((position) => ({
                    value: `${position.id}::${position.version}`,
                    label: `${position.symbol ?? position.assetId} · ${position.positionKey} · v${position.version}`
                  }))
                }
              ]}
              body={{
                split: {
                  from: "positionId",
                  separator: "::",
                  idKey: "shadowPositionId",
                  versionKey: "expectedVersion"
                }
              }}
            />
          ) : (
            <EmptyState
              title="Keine offenen Positionen vorhanden."
              tone="calm"
            />
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Worker & geplante Jobs"
          subtitle="Lease-, Circuit-Breaker- und Laufstatus je Job"
        >
          {worker && worker.jobs.length > 0 ? (
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Letzter Lauf</th>
                    <th>Lease</th>
                    <th>Circuit Breaker</th>
                  </tr>
                </thead>
                <tbody>
                  {worker.jobs.map((job) => (
                    <tr key={job.jobKey}>
                      <td data-label="Job">{job.jobKey}</td>
                      <td data-label="Letzter Lauf">
                        {job.lastRun
                          ? `${job.lastRun.status} · ${formatUtcDateTime(job.lastRun.startedAt)}`
                          : "Noch nie gelaufen"}
                      </td>
                      <td data-label="Lease">
                        {job.lease?.active
                          ? `aktiv · ${job.lease.claimedBy ?? "—"}`
                          : "frei"}
                      </td>
                      <td data-label="Circuit Breaker">
                        <CircuitBreakerBadge
                          allowed={job.circuitBreaker.allowed}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Kein Worker-Status verfügbar." />
          )}

          <OperationConfirm
            title="Shadow-Job manuell starten"
            impact="Führt einen erlaubten Shadow-Job synchron aus derselben Allowlist wie der Scheduler aus. Umgeht den Cron-Takt, nicht die jobinternen Flag-/Circuit-Breaker-Gates."
            confirmPhrase={CONFIRM_PHRASES.runJob}
            endpoint="/trading/operations/run-job"
            reasonFieldName="reason"
            extraFields={[
              {
                name: "jobName",
                label: "Job (feste Allowlist)",
                type: "select",
                required: true,
                options: RUN_JOB_ALLOWLIST.map((jobName) => ({
                  value: jobName,
                  label: RUN_JOB_LABELS[jobName]
                }))
              }
            ]}
            body={{
              allowlisted: {
                from: "jobName",
                to: "jobName",
                allowed: RUN_JOB_ALLOWLIST
              }
            }}
          />
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Shadow-Eligibility-Report"
          subtitle={
            eligibility
              ? `${eligibility.status} · ${eligibility.reportVersion} · Stand ${formatUtcDateTime(eligibility.asOf)}`
              : "Freigabekriterien für eine längere Shadow-Testphase"
          }
        >
          <p className="muted small" style={{ marginBottom: 12 }}>
            Der Report ist rein lesend. Er aktiviert nichts, löst keinen Kill
            Switch und ändert kein Flag — ein einziges fehlgeschlagenes
            Blocker-Kriterium macht den Gesamtstatus NOT_READY.
          </p>

          {eligibilityResult.error ? (
            <ErrorState
              title="Eligibility-Report konnte nicht geladen werden"
              message={eligibilityResult.error}
            />
          ) : null}

          {eligibility ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ergebnis</th>
                    <th>Kriterium</th>
                    <th>Blockierend</th>
                    <th>Begründung</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibility.checks.map((check) => (
                    <tr key={check.code}>
                      <td className="nowrap">{check.outcome}</td>
                      <td>{check.label}</td>
                      <td>{check.blocking ? "ja" : "nein"}</td>
                      <td className="muted small">{check.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : eligibilityResult.error ? null : (
            <EmptyState title="Kein Eligibility-Report verfügbar." />
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Alert-Outbox"
          subtitle={
            outboxSummary
              ? `PENDING ${outboxSummary.pending} · PROCESSING ${outboxSummary.processing} · SENT ${outboxSummary.sent} · FAILED ${outboxSummary.failed} · DEAD ${outboxSummary.dead}`
              : "Nur sicherheits- und betriebsrelevante Ereignisse"
          }
        >
          <p className="muted small" style={{ marginBottom: 12 }}>
            Ausschließlich sicherheits- und betriebsrelevante Ereignisse. Ein
            Zustellungsausfall blockiert weder die Positionsüberwachung noch
            risikoreduzierende Exits — die Zustellung läuft in einem eigenen
            Job. DEAD bedeutet: alle Versuche verbraucht, kein weiterer Retry.
          </p>

          {outboxResult.error ? (
            <ErrorState
              title="Alert-Outbox konnte nicht geladen werden"
              message={outboxResult.error}
            />
          ) : null}

          {outboxEntries.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Erstellt (UTC)</th>
                    <th>Ereignis</th>
                    <th>Schwere</th>
                    <th>Status</th>
                    <th>Versuche</th>
                    <th>Nächster Versuch</th>
                    <th>Aggregat</th>
                    <th>Letzter Fehler</th>
                  </tr>
                </thead>
                <tbody>
                  {outboxEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">
                        {formatUtcDateTime(entry.createdAt)}
                      </td>
                      <td>{entry.eventType}</td>
                      <td>{entry.severity}</td>
                      <td>{entry.status}</td>
                      <td>
                        {entry.attemptCount} / {entry.maxAttempts}
                      </td>
                      <td className="nowrap">
                        {entry.status === "SENT" || entry.status === "DEAD"
                          ? "—"
                          : formatUtcDateTime(entry.nextAttemptAt)}
                      </td>
                      <td className="muted small">
                        {entry.aggregateType} · {entry.aggregateId}
                      </td>
                      <td className="muted small">{entry.lastError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : outboxResult.error ? null : (
            <EmptyState
              title="Keine Alert-Outbox-Einträge."
              description="Die Outbox ist standardmäßig deaktiviert (TRADING_ALERT_OUTBOX_ENABLED)."
            />
          )}
        </SectionCard>
      </div>
    </>
  );
}
