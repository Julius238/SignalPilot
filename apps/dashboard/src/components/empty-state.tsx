export function EmptyState({ title }: { title: string }) {
  return <div className="empty-state">{title}</div>;
}

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="error-state">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function LoadingState({ title = "Lädt…" }: { title?: string }) {
  return <div className="loading-state">{title}</div>;
}
