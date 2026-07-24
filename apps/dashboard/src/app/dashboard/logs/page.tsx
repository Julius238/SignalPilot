import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/ui";
import { formatDateTime } from "../../../lib/format";
import { fetchApi, type BotLog } from "../../../lib/signalpilot-api";

type LogLevel = "ERROR" | "WARN" | "WARNING" | "INFO" | "DEBUG" | string;

function LevelBadge({ level }: { level: LogLevel }) {
  const upper = level.toUpperCase();
  let cls = "";
  if (upper === "ERROR") cls = "alert-failed";
  else if (upper === "WARN" || upper === "WARNING") cls = "alert-pending";
  else if (upper === "INFO") cls = "alert-sent";
  else cls = "status-no_edge";
  return <span className={`badge ${cls}`}>{upper}</span>;
}

function MetaCell({ value }: { value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return <span className="muted">—</span>;
  }
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11 }}>{str}</pre>;
  } catch {
    return <span className="muted">—</span>;
  }
}

export default async function LogsPage() {
  const botLogs = await fetchApi<BotLog[]>("/logs?limit=200");
  const logs = botLogs.data ?? [];

  const errorCount = logs.filter((l) => l.level.toUpperCase() === "ERROR").length;
  const warnCount = logs.filter(
    (l) => l.level.toUpperCase() === "WARN" || l.level.toUpperCase() === "WARNING"
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="System · Technische Ebene"
        title="Ausführungsprotokoll"
        subtitle="Technische Meldungen der letzten Worker- und Datenläufe."
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/operations">
            Zur Systemübersicht
          </Link>
        }
      />

      {botLogs.error ? (
        <ErrorState title="Logs nicht verfügbar" message={botLogs.error} />
      ) : null}

      {(errorCount > 0 || warnCount > 0) && (
        <div className="warning-section" style={{ marginBottom: 16 }}>
          <h3 className="warning-section-title">
            Log-Auffälligkeiten
          </h3>
          <ul className="warning-list">
            {errorCount > 0 && (
              <li className="warning-item">
                <span className="warning-icon">✕</span>
                <span>
                  <strong>{errorCount} ERROR</strong>-Einträge gefunden — Details in der Tabelle
                  unten prüfen.
                </span>
              </li>
            )}
            {warnCount > 0 && (
              <li className="warning-item">
                <span className="warning-icon">⚠</span>
                <span>
                  <strong>{warnCount} WARN</strong>-Einträge — können auf
                  Konfigurationsprobleme oder Datenlücken hinweisen.
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      <section className="card">
        <h2>Log-Einträge ({logs.length})</h2>
        {logs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Level</th>
                  <th>Service</th>
                  <th>Meldung</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(log.createdAt)}</td>
                    <td>
                      <LevelBadge level={log.level} />
                    </td>
                    <td>
                      <span className="muted small">{log.service}</span>
                    </td>
                    <td>{log.message}</td>
                    <td className="wide-cell">
                      <MetaCell value={log.metadataJson} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Keine Log-Einträge gefunden." />
        )}
      </section>
    </>
  );
}
