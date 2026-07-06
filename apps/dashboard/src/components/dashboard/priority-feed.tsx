import Link from "next/link";

import { EmptyState } from "../empty-state";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import { severityColor, severityLabel, type Severity } from "./shared";

// "Wichtig jetzt": eine priorisierte Liste über alle Quellen hinweg —
// das Erste, was nach der Marktlage gelesen werden soll.

export type PriorityItem = {
  id: string;
  kind: "Event" | "Radar" | "Chart";
  severity: Severity;
  title: string;
  detail: string;
  time: string;
  href?: string;
  externalUrl?: string | null;
};

export function PriorityFeed({ items, now }: { items: PriorityItem[]; now: Date }) {
  return (
    <section className="cmd-section" aria-label="Wichtig jetzt">
      <div className="section-header">
        <h2 className="section-title">Wichtig jetzt</h2>
        <span className="muted small">
          Höchste Priorität aus Radar, Chart-Patterns und globalen Ereignissen · keine
          Handlungsempfehlung
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState title="Aktuell nichts Hochprioritäres — ruhige Lage." />
      ) : (
        <ol className="priority-list">
          {items.map((item) => (
            <li key={item.id} className="priority-item">
              <span
                className="priority-severity"
                style={{ color: severityColor(item.severity) }}
                title={`Priorität: ${severityLabel(item.severity)}`}
              >
                {severityLabel(item.severity)}
              </span>
              <div className="priority-body">
                <div className="priority-title">
                  <span className="priority-kind">{item.kind}</span>
                  {item.externalUrl ? (
                    <a href={item.externalUrl} target="_blank" rel="noreferrer noopener">
                      {item.title}
                    </a>
                  ) : item.href ? (
                    <Link href={item.href}>{item.title}</Link>
                  ) : (
                    item.title
                  )}
                </div>
                <div className="muted small">{item.detail}</div>
              </div>
              <span className="muted small priority-time" title={formatDateTime(item.time)}>
                {formatRelativeTime(item.time, now)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
