import { fetchApi, type AuditLog } from "../../../lib/signalpilot-api";
import { formatDateTime } from "../../../lib/format";

export default async function AuditLogsPage() {
  const { data: logs, error } = await fetchApi<AuditLog[]>("/audit-logs?limit=200");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit Logs</h1>
          <p>Admin actions and security events.</p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p className="form-message form-message-error">{error}</p>
        </div>
      ) : (
        <div className="card">
          {logs && logs.length > 0 ? (
            <div className="stack-list">
              {logs.map((log) => (
                <div className="list-row" key={log.id}>
                  <div>
                    <strong>{log.action}</strong>
                    <span>
                      {log.actor}
                      {log.targetType ? ` → ${log.targetType}${log.targetId ? ` #${log.targetId}` : ""}` : ""}
                    </span>
                  </div>
                  <div className="right-meta">
                    <span>{log.ip}</span>
                    <span>{formatDateTime(log.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No audit log entries found.</p>
          )}
        </div>
      )}
    </>
  );
}
