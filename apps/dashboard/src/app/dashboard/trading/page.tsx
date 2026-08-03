import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../components/ui";
import {
  CircuitBreakerBadge,
  KillSwitchBadge,
  ReconciliationFreshnessBadge,
  RiskSeverityBadge,
  SessionStatusBadge,
  StaleDataBadge
} from "../../../components/trading/trading-status";
import { TradingDisabled } from "../../../components/trading/trading-disabled";
import {
  fetchRiskEvents,
  fetchTradingOverview,
  fetchWorkerStatus,
  type TradingOverview,
  type WorkerStatus
} from "../../../lib/trading-api";
import {
  decimalTone,
  formatDecimalAmount,
  formatSignedDecimal,
  formatUtcDateTime,
  isDataStale,
  toneColor,
  UNKNOWN_LABEL
} from "../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../lib/trading-flag";

// Freshness-Schwellen: Reconcile-Grenzwert folgt OD-08
// (docs/trading/11-open-decisions.md, "maximal 5 Minuten"). Der Worker-
// Heartbeat-Schwellwert ist konservativ gewählt, da kein fester Cron-Takt im
// Dashboard bekannt ist.
const RECONCILE_STALE_MS = 5 * 60 * 1000;
const WORKER_HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export default async function TradingOverviewPage() {
  // Redundante, defensive Prüfung — das Layout blendet die Seite bereits aus,
  // aber jede Seite prüft zusätzlich selbst, bevor sie irgendeinen
  // /trading/*-Request auslöst.
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const [overviewResult, workerResult, criticalRiskEventsResult] = await Promise.all([
    fetchTradingOverview(),
    fetchWorkerStatus(),
    fetchRiskEvents({ severity: "CRITICAL", acknowledged: "false", limit: 10 })
  ]);

  const overview = overviewResult.data;
  const worker = workerResult.data;
  const criticalRiskEvents = criticalRiskEventsResult.data ?? [];
  const renderedAt = new Date();

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Übersicht"
        subtitle={
          overview
            ? `Stand ${formatUtcDateTime(overview.asOf)}`
            : "Konnte nicht geladen werden"
        }
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/trading/operations">
            Operations öffnen
          </Link>
        }
      />

      {overviewResult.error ? (
        <ErrorState title="Übersicht konnte nicht geladen werden" message={overviewResult.error} />
      ) : null}
      {workerResult.error ? (
        <ErrorState title="Worker-Status konnte nicht geladen werden" message={workerResult.error} />
      ) : null}

      {overview ? (
        <>
          <StatusRow overview={overview} worker={worker} now={renderedAt} />

          <div className="grid metrics" style={{ marginTop: 16 }}>
            <MetricCard label="Equity" value={formatDecimalAmount(overview.equity)} />
            <MetricCard
              label="Verfügbares Cash"
              value={formatDecimalAmount(overview.portfolio?.availableCash ?? null)}
              sub={overview.portfolio ? undefined : "Kein Portfolio vorhanden"}
            />
            <MetricCard
              label="Reserviertes Cash"
              value={formatDecimalAmount(overview.portfolio?.reservedCash ?? null)}
            />
            <MetricCard
              label="Tages-P&L"
              value={
                <span style={{ color: toneColor(decimalTone(overview.dailyPnl)) }}>
                  {overview.dailyPnl === null
                    ? UNKNOWN_LABEL
                    : formatSignedDecimal(overview.dailyPnl)}
                </span>
              }
              sub={
                overview.dailyPnl === null
                  ? "Noch kein Start-of-Day-Snapshot — nicht als 0 zu verstehen"
                  : undefined
              }
            />
            <MetricCard
              label="Realisiertes P&L (gesamt)"
              value={
                <span style={{ color: toneColor(decimalTone(overview.realizedPnl)) }}>
                  {formatSignedDecimal(overview.realizedPnl)}
                </span>
              }
            />
            <MetricCard
              label="Unrealisiertes P&L"
              value={
                <span style={{ color: toneColor(decimalTone(overview.unrealizedPnl)) }}>
                  {formatSignedDecimal(overview.unrealizedPnl)}
                </span>
              }
            />
            <MetricCard
              label="Drawdown"
              value={formatDecimalAmount(overview.drawdownAmount)}
              sub={`${formatDecimalAmount(overview.drawdownPct)}% vom High-Water-Mark`}
            />
            <MetricCard label="Offene Positionen" value={overview.openPositionCount} />
            <MetricCard label="Offene Orders" value={overview.openOrderCount} />
            <MetricCard label="Trades heute" value={overview.tradesToday} />
          </div>

          <div className="grid two" style={{ marginTop: 16 }}>
            <SectionCard
              title="Letzte Aktivität"
              subtitle="Jüngster Kandidat, jüngste Risikoentscheidung, jüngste Order"
            >
              <div className="stack-list compact">
                <div className="list-row">
                  <div>
                    <strong>Kandidat</strong>
                    <span className="muted small">
                      {overview.latestActivity.candidate
                        ? `${overview.latestActivity.candidate.symbol ?? "—"} · ${overview.latestActivity.candidate.status}`
                        : "Keine Kandidaten vorhanden"}
                    </span>
                  </div>
                  <div className="right-meta">
                    <span className="muted small">
                      {overview.latestActivity.candidate
                        ? formatUtcDateTime(overview.latestActivity.candidate.dataAsOf)
                        : "—"}
                    </span>
                    {overview.latestActivity.candidate ? (
                      <Link className="section-link" href="/dashboard/trading/candidates">
                        Kandidaten →
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="list-row">
                  <div>
                    <strong>Risikoentscheidung</strong>
                    <span className="muted small">
                      {overview.latestActivity.riskAssessment
                        ? overview.latestActivity.riskAssessment.status
                        : "Keine Risikoentscheidungen vorhanden"}
                    </span>
                  </div>
                  <div className="right-meta">
                    <span className="muted small">
                      {overview.latestActivity.riskAssessment
                        ? formatUtcDateTime(overview.latestActivity.riskAssessment.assessedAt)
                        : "—"}
                    </span>
                    {overview.latestActivity.riskAssessment ? (
                      <Link className="section-link" href="/dashboard/trading/risk">
                        Risiko →
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="list-row">
                  <div>
                    <strong>Order</strong>
                    <span className="muted small">
                      {overview.latestActivity.order
                        ? overview.latestActivity.order.status
                        : "Keine Orders vorhanden"}
                    </span>
                  </div>
                  <div className="right-meta">
                    <span className="muted small">
                      {overview.latestActivity.order
                        ? formatUtcDateTime(overview.latestActivity.order.createdAt)
                        : "—"}
                    </span>
                    {overview.latestActivity.order ? (
                      <Link className="section-link" href="/dashboard/trading/orders">
                        Orders →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Worker & Scheduler"
              subtitle="Job-, Lease- und Circuit-Breaker-Status je geplantem Job"
              action={
                <Link className="section-link" href="/dashboard/trading/operations">
                  Operations →
                </Link>
              }
            >
              {worker && worker.jobs.length > 0 ? (
                <div className="stack-list compact">
                  {worker.jobs.map((job) => (
                    <div className="list-row" key={job.jobKey}>
                      <div>
                        <strong>{job.jobKey}</strong>
                        <span className="muted small">
                          {job.lastRun
                            ? `${job.lastRun.status} · ${formatUtcDateTime(job.lastRun.startedAt)}`
                            : "Noch nie gelaufen"}
                        </span>
                      </div>
                      <div className="right-meta">
                        <CircuitBreakerBadge allowed={job.circuitBreaker.allowed} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Kein Worker-Status verfügbar." />
              )}
            </SectionCard>
          </div>

          <div style={{ marginTop: 16 }}>
            <SectionCard
              title="Kritische Risk Events"
              subtitle="Unbestätigte Ereignisse mit Severity CRITICAL"
              action={
                <Link className="section-link" href="/dashboard/trading/risk">
                  Alle Risk Events →
                </Link>
              }
            >
              {criticalRiskEvents.length > 0 ? (
                <div className="stack-list compact">
                  {criticalRiskEvents.map((event) => (
                    <div className="list-row" key={event.id}>
                      <div>
                        <strong>{event.type}</strong>
                        <span className="muted small">{event.reasonCode}</span>
                      </div>
                      <div className="right-meta">
                        <span className="muted small">{formatUtcDateTime(event.createdAt)}</span>
                        <RiskSeverityBadge value={event.severity} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Keine kritischen Risk Events." tone="calm" />
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </>
  );
}

function StatusRow({
  overview,
  worker,
  now
}: {
  overview: TradingOverview;
  worker: WorkerStatus | null;
  now: Date;
}) {
  const reconcileStale = isDataStale(overview.lastReconciledAt, RECONCILE_STALE_MS, now);
  const workerStale = isDataStale(overview.workerHeartbeatAt, WORKER_HEARTBEAT_STALE_MS, now);

  return (
    <div className="stack-list compact">
      <div className="list-row">
        <div>
          <strong>Session</strong>
          <span className="muted small">
            {overview.session ? overview.session.id : "Keine Session vorhanden"}
          </span>
        </div>
        <div className="right-meta">
          {overview.session ? (
            <>
              <SessionStatusBadge value={overview.session.status} />
              <KillSwitchBadge engaged={overview.session.killSwitchEngaged} />
            </>
          ) : (
            <span className="muted small">{UNKNOWN_LABEL}</span>
          )}
        </div>
      </div>
      <div className="list-row">
        <div>
          <strong>Letztes Reconcile</strong>
          <span className="muted small">{formatUtcDateTime(overview.lastReconciledAt)}</span>
        </div>
        <div className="right-meta">
          <ReconciliationFreshnessBadge stale={reconcileStale} />
        </div>
      </div>
      <div className="list-row">
        <div>
          <strong>Worker-Heartbeat</strong>
          <span className="muted small">{formatUtcDateTime(overview.workerHeartbeatAt)}</span>
        </div>
        <div className="right-meta">
          <StaleDataBadge stale={workerStale} label="Heartbeat" />
        </div>
      </div>
      <div className="list-row">
        <div>
          <strong>Circuit Breaker</strong>
          <span className="muted small">
            {worker ? `${worker.jobs.length} Jobs geprüft` : "Worker-Status nicht verfügbar"}
          </span>
        </div>
        <div className="right-meta">
          <CircuitBreakerBadge allowed={!overview.circuitBreakerBlocked} />
        </div>
      </div>
      <div className="list-row">
        <div>
          <strong>Kritische Risk Events</strong>
          <span className="muted small">unbestätigt</span>
        </div>
        <div className="right-meta">
          <span
            className={`badge trading-${overview.activeCriticalRiskEventCount > 0 ? "critical" : "good"}`}
          >
            {overview.activeCriticalRiskEventCount}
          </span>
        </div>
      </div>
    </div>
  );
}
