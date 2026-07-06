import Link from "next/link";

import { SectionCard } from "../ui";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import { pipelineStatusColor } from "./shared";

// Kompakter System-Status: Worker/Pipelines mit Status-Punkt und relativer Zeit.
// Beantwortet "Läuft alles?" ohne Log-Tauchgang; Details unter Ops/Logs.

export type WorkerStatusRow = {
  label: string;
  status?: string;
  time?: string | null;
  note?: string;
};

export function SystemPanel({
  healthOk,
  workerRows,
  failedAlertCount,
  lastAlertSummary,
  now
}: {
  healthOk: boolean;
  workerRows: WorkerStatusRow[];
  failedAlertCount: number;
  lastAlertSummary: string | null;
  now: Date;
}) {
  return (
    <SectionCard
      title="System & Worker"
      action={
        <Link href="/dashboard/operations" className="section-link">
          Ops →
        </Link>
      }
    >
      <div className="health-rows">
        <div className="health-row">
          <span className="health-row-label">
            <span
              className="status-dot"
              style={{ backgroundColor: healthOk ? "var(--good)" : "var(--bad)" }}
            />
            API
          </span>
          <span className="health-row-value" style={{ color: healthOk ? "var(--good)" : "var(--bad)" }}>
            {healthOk ? "Erreichbar" : "Nicht erreichbar"}
          </span>
        </div>
        {workerRows.map((row) => (
          <div key={row.label} className="health-row">
            <span className="health-row-label">
              <span
                className="status-dot"
                style={{
                  backgroundColor: row.status ? (pipelineStatusColor(row.status) ?? "var(--muted)") : "var(--line)"
                }}
              />
              {row.label}
            </span>
            <span
              className="health-row-value muted small"
              title={row.time ? formatDateTime(row.time) : undefined}
            >
              {row.status ? `${row.status} · ${formatRelativeTime(row.time ?? null, now)}` : (row.note ?? "inaktiv")}
            </span>
          </div>
        ))}
        <div className="health-row">
          <span className="health-row-label">
            <span
              className="status-dot"
              style={{ backgroundColor: failedAlertCount > 0 ? "var(--bad)" : "var(--good)" }}
            />
            Alerts
          </span>
          <span
            className="health-row-value muted small"
            style={failedAlertCount > 0 ? { color: "var(--bad)" } : undefined}
          >
            {failedAlertCount > 0
              ? `${failedAlertCount} fehlgeschlagen`
              : (lastAlertSummary ?? "Keine Alerts")}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
