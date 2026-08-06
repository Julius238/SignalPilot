import type { ReactNode } from "react";

// Leere Zustände erklären, warum nichts zu sehen ist und was den Bereich füllt.
// tone="calm": Leere ist hier eine gute Nachricht (ruhige Lage), grüner Punkt.

export function EmptyState({
  title,
  description,
  tone = "neutral"
}: {
  title: string;
  description?: string;
  tone?: "neutral" | "calm";
}) {
  return (
    <div className={`empty-state${tone === "calm" ? " empty-state--calm" : ""}`}>
      <span className="empty-state-dot" aria-hidden="true" />
      <div className="empty-state-body">
        <span className="empty-state-title">{title}</span>
        {description ? <span className="empty-state-description">{description}</span> : null}
      </div>
    </div>
  );
}

// `hint` trägt den nächsten Schritt (oder die technische Meldung), `action` eine
// konkrete Handlungsmöglichkeit — z. B. <RetryButton />. Nur ReactNode, keine
// Funktions-Props: der Aufrufer ist meist eine Server-Komponente.
export function ErrorState({
  title,
  message,
  hint,
  action
}: {
  title: string;
  message: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
      {hint ? <span className="error-state-hint">{hint}</span> : null}
      {action ? <div className="error-state-action">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ title = "Lädt…" }: { title?: string }) {
  return <div className="loading-state">{title}</div>;
}
