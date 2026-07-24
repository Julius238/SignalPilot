import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card section-card${className ? ` ${className}` : ""}`}>
      {title || action ? (
        <div className="section-header">
          <div>
            {title ? <h2 className="section-title">{title}</h2> : null}
            {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
          </div>
          {action ?? null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value ?? "—"}</strong>
      {sub ? <span className="muted small">{sub}</span> : null}
    </div>
  );
}
