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
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  /** Erklärung des Fachbegriffs — erscheint als Tooltip am Label. */
  hint?: string;
  /** Hebt eine Kachel hervor, statt alle gleich zu gewichten. */
  tone?: MetricTone;
}) {
  return (
    <div className={`card metric-card${tone ? ` metric-card--${tone}` : ""}`}>
      <span className="metric-label">
        {label}
        {hint ? <InfoHint text={hint} /> : null}
      </span>
      <strong className="metric-value">{value ?? "—"}</strong>
      {sub ? <span className="muted small">{sub}</span> : null}
    </div>
  );
}

export type MetricTone = "good" | "warn" | "bad" | "quiet";

/**
 * Beantwortet oben auf jeder technischen Seite drei Fragen auf einen Blick:
 * Was zeigt die Seite? Ist der Zustand gut, neutral oder problematisch?
 * Was sollte als Nächstes geprüft werden?
 */
export type PageVerdictTone = "good" | "neutral" | "warn" | "bad";

const verdictDot: Record<PageVerdictTone, string> = {
  good: "var(--good)",
  neutral: "var(--muted)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

export function PageIntro({
  purpose,
  tone,
  verdict,
  detail,
  nextStep,
  action,
}: {
  /** Ein Satz: Was zeigt diese Seite? */
  purpose: string;
  tone: PageVerdictTone;
  /** Die wichtigste Aussage — der Zustand in Klartext. */
  verdict: string;
  /** Optionale Präzisierung des Zustands. */
  detail?: string;
  /** Was der Nutzer als Nächstes prüfen sollte. */
  nextStep?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={`page-intro page-intro--${tone}`}
      role={tone === "bad" || tone === "warn" ? "status" : undefined}
    >
      <p className="page-intro-purpose">{purpose}</p>
      <div className="page-intro-verdict">
        <span className="status-dot" style={{ backgroundColor: verdictDot[tone] }} />
        <strong>{verdict}</strong>
        {detail ? <span className="page-intro-detail">{detail}</span> : null}
      </div>
      {nextStep ? (
        <p className="page-intro-next">
          <span className="page-intro-next-label">Als Nächstes:</span> {nextStep}
        </p>
      ) : null}
      {action ? <div className="page-intro-action">{action}</div> : null}
    </section>
  );
}

/** Kleines Fragezeichen mit Tooltip für Fachbegriffe und Kennzahlen. */
export function InfoHint({ text }: { text: string }) {
  return (
    <span className="info-hint" tabIndex={0} role="note" aria-label={text} title={text}>
      ?
    </span>
  );
}

/**
 * Technische Rohdaten bleiben erreichbar, dominieren aber nicht die Hauptansicht.
 * Standardmäßig zugeklappt.
 */
export function TechnicalDetails({
  summary,
  children,
  count,
}: {
  summary: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <details className="technical-details">
      <summary>
        {summary}
        {typeof count === "number" ? <span className="technical-details-count">{count}</span> : null}
      </summary>
      <div className="technical-details-body">{children}</div>
    </details>
  );
}
