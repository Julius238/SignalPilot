"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import {
  mutateApi,
  type WatchlistItem,
  type WatchlistPriority
} from "../lib/signalpilot-api";

const priorities: WatchlistPriority[] = ["LOW", "MEDIUM", "HIGH"];

const PRIORITY_LABELS: Record<WatchlistPriority, string> = {
  LOW: "Niedrig",
  MEDIUM: "Mittel",
  HIGH: "Hoch"
};

type FormStatus = {
  tone: "ok" | "error";
  message: string;
} | null;

export function AssetWatchlistControls({
  symbol,
  watchlistItem
}: {
  symbol: string;
  watchlistItem: WatchlistItem | null;
}) {
  if (watchlistItem) {
    return <WatchlistItemEditor item={watchlistItem} submitLabel="Aktualisieren" />;
  }

  return <AddWatchlistForm symbol={symbol} />;
}

export function AddWatchlistForm({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<FormStatus>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const formData = new FormData(event.currentTarget);
    const result = await mutateApi<WatchlistItem>("/watchlist", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        priority: formData.get("priority"),
        notes: formData.get("notes"),
        alertEnabled: formData.get("alertEnabled") === "true"
      })
    });

    setPending(false);

    if (result.error) {
      setStatus({ tone: "error", message: result.error });
      return;
    }

    setStatus({ tone: "ok", message: "Zur Watchlist hinzugefügt." });
    router.refresh();
  }

  return (
    <form className="watchlist-form" onSubmit={submit}>
      <div className="watchlist-state">Zur Watchlist hinzufügen</div>
      <label>
        Priorität
        <select defaultValue="MEDIUM" name="priority">
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notizen
        <textarea name="notes" placeholder="Kontext, Notizen…" rows={4} />
      </label>
      <label className="check-filter">
        <input defaultChecked name="alertEnabled" type="checkbox" value="true" />
        Benachrichtigungen aktiv
      </label>
      <button disabled={pending} type="submit">
        {pending ? "Hinzufügen…" : "Hinzufügen"}
      </button>
      <FormMessage status={status} />
    </form>
  );
}

export function WatchlistItemEditor({
  item,
  submitLabel = "Speichern"
}: {
  item: WatchlistItem;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<FormStatus>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const formData = new FormData(event.currentTarget);
    const result = await mutateApi<WatchlistItem>(`/watchlist/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        priority: formData.get("priority"),
        notes: formData.get("notes"),
        alertEnabled: formData.get("alertEnabled") === "true"
      })
    });

    setPending(false);

    if (result.error) {
      setStatus({ tone: "error", message: result.error });
      return;
    }

    setStatus({ tone: "ok", message: "Watchlist aktualisiert." });
    router.refresh();
  }

  async function remove() {
    setPending(true);
    setStatus(null);

    const result = await mutateApi<null>(`/watchlist/${encodeURIComponent(item.id)}`, {
      method: "DELETE"
    });

    setPending(false);

    if (result.error) {
      setStatus({ tone: "error", message: result.error });
      return;
    }

    router.refresh();
  }

  return (
    <form className="watchlist-form" onSubmit={submit}>
      <div className="watchlist-state">Auf meiner Watchlist</div>
      <label>
        Priorität
        <select defaultValue={item.priority} name="priority">
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notizen
        <textarea defaultValue={item.notes ?? ""} name="notes" rows={4} />
      </label>
      <label className="check-filter">
        <input
          defaultChecked={item.alertEnabled}
          name="alertEnabled"
          type="checkbox"
          value="true"
        />
        Benachrichtigungen aktiv
      </label>
      <div className="watchlist-actions">
        <button disabled={pending} type="submit">
          {pending ? "Speichern…" : submitLabel}
        </button>
        <button className="danger-button" disabled={pending} onClick={remove} type="button">
          Entfernen
        </button>
      </div>
      <FormMessage status={status} />
    </form>
  );
}

function FormMessage({ status }: { status: FormStatus }) {
  if (!status) return null;
  return <p className={`form-message form-message-${status.tone}`}>{status.message}</p>;
}
