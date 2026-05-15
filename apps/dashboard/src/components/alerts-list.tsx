import { EmptyState } from "./empty-state";
import { formatDateTime } from "../lib/format";
import type { Alert } from "../lib/signalpilot-api";

export function AlertsList({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return <EmptyState title="Keine Alerts gefunden." />;
  }

  return (
    <div className="stack-list">
      {alerts.map((alert) => (
        <div className="list-row" key={alert.id}>
          <div>
            <strong>{alert.signal?.symbol ?? alert.signalId ?? "Alert"}</strong>
            <span>{alert.signal?.signalType ?? alert.channel}</span>
          </div>
          <div className="right-meta">
            <span className={`badge alert-${alert.status.toLowerCase()}`}>{alert.status}</span>
            <span>{formatDateTime(alert.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
