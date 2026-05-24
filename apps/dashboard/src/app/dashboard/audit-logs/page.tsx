import { fetchApi, type AuditLog } from "../../../lib/signalpilot-api";
import { formatDateTime } from "../../../lib/format";
import { ErrorState, EmptyState } from "../../../components/empty-state";

function actionBadgeClass(action: string): string {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("REMOVE")) return "alert-failed";
  if (a.includes("CREATE") || a.includes("ADD")) return "alert-sent";
  if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("CHANGE")) return "badge-info";
  if (a.includes("LOGIN") || a.includes("LOGOUT") || a.includes("AUTH")) return "alert-pending";
  return "status-no_edge";
}

function MetaDetail({ value }: { value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return null;
  }
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return (
      <pre
        style={{
          margin: "6px 0 0",
          padding: "6px 8px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: 4,
          fontSize: 11,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--muted)"
        }}
      >
        {str}
      </pre>
    );
  } catch {
    return null;
  }
}

export default async function AuditLogsPage() {
  const { data: logs, error } = await fetchApi<AuditLog[]>("/audit-logs?limit=200");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit-Logs</h1>
          <p className="muted">Admin-Aktionen und sicherheitsrelevante Ereignisse.</p>
        </div>
      </div>

      {error ? (
        <ErrorState title="Audit-Logs nicht verfügbar" message={error} />
      ) : null}

      <section className="card">
        {logs && logs.length > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12
              }}
            >
              <h2 style={{ margin: 0 }}>Einträge ({logs.length})</h2>
              <span className="muted small">Neueste zuerst</span>
            </div>
            <div className="stack-list">
              {logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: "12px 0",
                    borderBottom: "1px solid var(--line)"
                  }}
                >
                  <div className="list-row" style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className={`badge ${actionBadgeClass(log.action)}`}>
                          {log.action}
                        </span>
                        {log.targetType && (
                          <span className="muted small">
                            {log.targetType}
                            {log.targetId ? ` #${log.targetId}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Ausgeführt von: <strong style={{ color: "var(--text)" }}>{log.actor}</strong>
                      </div>
                      <MetaDetail value={log.metadataJson} />
                    </div>
                    <div
                      className="right-meta"
                      style={{ flexShrink: 0, textAlign: "right", paddingLeft: 16 }}
                    >
                      <div className="muted small">{log.ip}</div>
                      <div className="muted small">{formatDateTime(log.createdAt)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState title="Keine Audit-Log-Einträge gefunden." />
        )}
      </section>
    </>
  );
}
