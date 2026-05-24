import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card${className ? ` ${className}` : ""}`}>
      {title || action ? (
        <div className="section-header">
          {title ? <h2 className="section-title">{title}</h2> : null}
          {action ?? null}
        </div>
      ) : null}
      {children}
    </div>
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
