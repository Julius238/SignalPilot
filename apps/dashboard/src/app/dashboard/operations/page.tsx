import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime } from "../../../lib/format";
import {
  fetchApi,
  type Alert,
  type AlertState,
  type BotRun
} from "../../../lib/signalpilot-api";

function RunStatusBadge({ status }: { status: BotRun["status"] }) {
  const cls =
    status === "SUCCESS"
      ? "alert-sent"
      : status === "FAILED"
        ? "alert-failed"
        : "alert-pending";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function AlertStatusBadge({ status }: { status: Alert["status"] }) {
  const cls =
    status === "SENT"
      ? "alert-sent"
      : status === "FAILED"
        ? "alert-failed"
        : "alert-pending";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function duration(start: string, end: string | null): string {
  if (!end) return "laufend";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function jobLabel(jobName: string): string {
  if (jobName.toLowerCase().includes("crypto")) return "Crypto Pipeline";
  if (jobName.toLowerCase().includes("equity")) return "Equity Pipeline";
  return jobName;
}

export default async function OperationsPage() {
  const [botRuns, alerts, alertStates] = await Promise.all([
    fetchApi<BotRun[]>("/bot-runs?limit=50"),
    fetchApi<Alert[]>("/alerts?limit=100"),
    fetchApi<AlertState[]>("/alerts/states?limit=100")
  ]);

  const runs = botRuns.data ?? [];
  const alertList = alerts.data ?? [];
  const stateList = alertStates.data ?? [];

  const failedRuns = runs.filter((r) => r.status === "FAILED");
  const activeRuns = runs.filter((r) => r.status === "RUNNING");
  const failedAlerts = alertList.filter((a) => a.status === "FAILED");
  const sentAlerts = alertList.filter((a) => a.status === "SENT");

  const lastCrypto = runs.find((r) => r.jobName.toLowerCase().includes("crypto")) ?? null;
  const lastEquity = runs.find((r) => r.jobName.toLowerCase().includes("equity")) ?? null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Operations</h1>
          <p className="muted">Pipeline-Status, Alert-Dispatch und Systemereignisse.</p>
        </div>
        <Link className="primary-link" href="/dashboard/logs">
          System Logs →
        </Link>
      </div>

      {botRuns.error ? <ErrorState title="Pipeline-Daten nicht verfügbar" message={botRuns.error} /> : null}
      {alerts.error ? <ErrorState title="Alert-Daten nicht verfügbar" message={alerts.error} /> : null}
      {alertStates.error ? <ErrorState title="Alert-States nicht verfügbar" message={alertStates.error} /> : null}

      {/* ── Status-Übersicht ── */}
      <div className="grid metrics">
        <div className="card">
          <span className="metric-label">Crypto Pipeline</span>
          <span className="metric-value">
            {lastCrypto ? (
              <RunStatusBadge status={lastCrypto.status} />
            ) : (
              <span className="muted">—</span>
            )}
          </span>
          {lastCrypto && (
            <span className="muted small">{formatDateTime(lastCrypto.finishedAt ?? lastCrypto.startedAt)}</span>
          )}
        </div>
        <div className="card">
          <span className="metric-label">Equity Pipeline</span>
          <span className="metric-value">
            {lastEquity ? (
              <RunStatusBadge status={lastEquity.status} />
            ) : (
              <span className="muted">—</span>
            )}
          </span>
          {lastEquity && (
            <span className="muted small">{formatDateTime(lastEquity.finishedAt ?? lastEquity.startedAt)}</span>
          )}
        </div>
        <div className="card">
          <span className="metric-label">Aktive Runs</span>
          <strong className="metric-value">{activeRuns.length}</strong>
          <span className="muted small">aktuell laufend</span>
        </div>
        <div className="card">
          <span className="metric-label">Fehlgeschlagene Runs</span>
          <strong
            className="metric-value"
            style={{ color: failedRuns.length > 0 ? "var(--bad)" : undefined }}
          >
            {failedRuns.length}
          </strong>
          <span className="muted small">der letzten 50</span>
        </div>
        <div className="card">
          <span className="metric-label">Fehlgeschlagene Alerts</span>
          <strong
            className="metric-value"
            style={{ color: failedAlerts.length > 0 ? "var(--bad)" : undefined }}
          >
            {failedAlerts.length}
          </strong>
          <span className="muted small">nicht zugestellt</span>
        </div>
        <div className="card">
          <span className="metric-label">Alerts zugestellt</span>
          <strong className="metric-value">{sentAlerts.length}</strong>
          <span className="muted small">der letzten 100</span>
        </div>
      </div>

      {/* ── Fehlgeschlagene Alerts (prominent wenn vorhanden) ── */}
      {failedAlerts.length > 0 && (
        <section className="card" style={{ marginTop: 16, borderColor: "rgba(248,81,73,0.4)" }}>
          <h2>Fehlgeschlagene Alerts ({failedAlerts.length})</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Diese Alerts konnten nicht zugestellt werden. Mögliche Ursachen: Webhook-Fehler, ungültige
            Konfiguration oder Netzwerkprobleme.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Signal</th>
                  <th>Kanal</th>
                  <th>Fehler</th>
                </tr>
              </thead>
              <tbody>
                {failedAlerts.slice(0, 20).map((alert) => (
                  <tr key={alert.id}>
                    <td>{formatDateTime(alert.createdAt)}</td>
                    <td>
                      {alert.signal ? (
                        <Link href={`/dashboard/signals/${alert.signalId}`}>
                          {alert.signal.symbol} · {alert.signal.timeframe}
                        </Link>
                      ) : (
                        <span className="muted">{alert.signalId ?? "—"}</span>
                      )}
                    </td>
                    <td>{alert.channel}</td>
                    <td className="muted small">{alert.error ?? "Unbekannter Fehler"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid two" style={{ marginTop: 16 }}>
        {/* ── Pipeline Runs ── */}
        <section className="card">
          <h2>Pipeline Runs</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>
            Letzte 50 Ausführungen · fehlgeschlagene Runs erfordern manuelle Prüfung
          </p>
          {runs.length > 0 ? (
            <div className="stack-list compact">
              {runs.slice(0, 25).map((run) => (
                <div className="list-row" key={run.id}>
                  <div>
                    <strong>{jobLabel(run.jobName)}</strong>
                    <span className="muted small">{formatDateTime(run.startedAt)}</span>
                  </div>
                  <div className="right-meta">
                    <span className="muted small">{duration(run.startedAt, run.finishedAt)}</span>
                    <RunStatusBadge status={run.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Keine Pipeline-Runs gefunden." />
          )}
        </section>

        {/* ── Alert-Dispatch Verlauf ── */}
        <section className="card">
          <h2>Alert-Dispatch</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>
            Letzte Benachrichtigungen · SENT = zugestellt, PENDING = ausstehend
          </p>
          {alertList.length > 0 ? (
            <div className="stack-list compact">
              {alertList.slice(0, 25).map((alert) => (
                <div className="list-row" key={alert.id}>
                  <div>
                    <strong>
                      {alert.signal?.symbol
                        ? `${alert.signal.symbol} · ${alert.signal.timeframe}`
                        : alert.channel}
                    </strong>
                    <span className="muted small">
                      {alert.signal?.signalType ?? alert.channel} · {formatDateTime(alert.createdAt)}
                    </span>
                  </div>
                  <div className="right-meta">
                    <AlertStatusBadge status={alert.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Keine Alert-Einträge gefunden." />
          )}
        </section>
      </div>

      {/* ── Alert States ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Alert-Zustände</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>
          Aktuell registrierte Signal-Beobachtungen mit Alert-Versand-Zähler.
          Hoher sendCount = Signal wurde wiederholt benachrichtigt.
        </p>
        {stateList.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>TF</th>
                  <th>Signaltyp</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Risiko</th>
                  <th>Letzter Alert</th>
                  <th>Versandanzahl</th>
                </tr>
              </thead>
              <tbody>
                {stateList.map((state) => (
                  <tr key={state.id}>
                    <td>
                      <Link href={`/dashboard/assets/${encodeURIComponent(state.symbol)}`}>
                        {state.symbol}
                      </Link>
                    </td>
                    <td>{state.timeframe}</td>
                    <td>{state.signalType}</td>
                    <td>
                      <span className={`badge status-${state.status.toLowerCase()}`}>
                        {state.status}
                      </span>
                    </td>
                    <td>{state.lastScore.toFixed(1)}</td>
                    <td>{state.lastRiskLevel}</td>
                    <td>{formatDateTime(state.lastSentAt)}</td>
                    <td>
                      <span
                        style={{
                          color: state.sendCount > 10 ? "var(--warn)" : undefined,
                          fontWeight: state.sendCount > 10 ? 700 : undefined
                        }}
                      >
                        {state.sendCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Keine Alert-Zustände vorhanden." />
        )}
      </section>
    </>
  );
}
