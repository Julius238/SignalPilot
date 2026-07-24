import Link from "next/link";

// Eine Zeile beantwortet "Läuft alles?" — grün heißt: weiterlesen lohnt sich
// nicht. Nur bei Problemen wird die Zeile gelb/rot und benennt sie konkret.
// Details (einzelne Worker, Läufe, Logs) liegen unter Betrieb.

export type StatusTone = "ok" | "warn" | "error";
export type WorkerStatusItem = {
  label: string;
  status: "SUCCESS" | "FAILED" | "RUNNING" | string | null;
};

const toneColor: Record<StatusTone, string> = {
  ok: "var(--good)",
  warn: "var(--warn)",
  error: "var(--bad)"
};

export function StatusLine({
  tone,
  headline,
  meta,
  issues,
  workers
}: {
  tone: StatusTone;
  headline: string;
  meta?: string;
  issues?: string[];
  workers?: WorkerStatusItem[];
}) {
  const modifier =
    tone === "error" ? " status-line--error" : tone === "warn" ? " status-line--warn" : "";

  return (
    <div className={`status-line${modifier}`} role={tone === "ok" ? undefined : "status"}>
      <div className="status-line-summary">
        <span className="status-dot" style={{ backgroundColor: toneColor[tone] }} />
        <span className="status-line-text">{headline}</span>
        {meta ? <span className="status-line-meta">{meta}</span> : null}
        <Link href="/dashboard/operations" className="status-line-link">
          Systemdetails
        </Link>
      </div>
      {workers && workers.length > 0 ? (
        <div className="status-line-workers" aria-label="Worker-Status">
          {workers.map((worker) => {
            const state =
              worker.status === "FAILED"
                ? "error"
                : worker.status === "RUNNING"
                  ? "running"
                  : worker.status === "SUCCESS"
                    ? "ok"
                    : "unknown";
            return (
              <span className={`worker-pill worker-pill--${state}`} key={worker.label}>
                <span aria-hidden="true" />
                {worker.label}
              </span>
            );
          })}
        </div>
      ) : null}
      {issues && issues.length > 0 ? (
        <ul className="status-line-issues">
          {issues.map((issue) => (
            <li key={issue} className="status-line-issue">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
