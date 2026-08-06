"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Erneut laden ohne vollen Reload: `router.refresh()` rendert die Server-Komponenten
// der aktuellen Route neu und holt damit auch die fehlgeschlagenen API-Aufrufe erneut.
export function RetryButton({ label = "Erneut versuchen" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="retry-button"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {isPending ? "Wird geladen…" : label}
    </button>
  );
}
