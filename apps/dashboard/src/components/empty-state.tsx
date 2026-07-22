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

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function LoadingState({ title = "Lädt…" }: { title?: string }) {
  return <div className="loading-state">{title}</div>;
}
