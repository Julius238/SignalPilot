"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import {
  mutateApi,
  type WatchlistItem,
  type WatchlistPriority
} from "../lib/signalpilot-api";

const priorities: WatchlistPriority[] = ["LOW", "MEDIUM", "HIGH"];

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
    return <WatchlistItemEditor item={watchlistItem} submitLabel="Update Watchlist" />;
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

    setStatus({ tone: "ok", message: "Added to watchlist." });
    router.refresh();
  }

  return (
    <form className="watchlist-form" onSubmit={submit}>
      <div className="watchlist-state">Add to Watchlist</div>
      <label>
        Priority
        <select defaultValue="MEDIUM" name="priority">
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notes
        <textarea name="notes" placeholder="Context, trigger, invalidation..." rows={4} />
      </label>
      <label className="check-filter">
        <input defaultChecked name="alertEnabled" type="checkbox" value="true" />
        Alerts enabled
      </label>
      <button disabled={pending} type="submit">
        {pending ? "Adding..." : "Add to Watchlist"}
      </button>
      <FormMessage status={status} />
    </form>
  );
}

export function WatchlistItemEditor({
  item,
  submitLabel = "Save"
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

    setStatus({ tone: "ok", message: "Watchlist updated." });
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
      <div className="watchlist-state">In Watchlist</div>
      <label>
        Priority
        <select defaultValue={item.priority} name="priority">
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notes
        <textarea defaultValue={item.notes ?? ""} name="notes" rows={4} />
      </label>
      <label className="check-filter">
        <input
          defaultChecked={item.alertEnabled}
          name="alertEnabled"
          type="checkbox"
          value="true"
        />
        Alerts enabled
      </label>
      <div className="watchlist-actions">
        <button disabled={pending} type="submit">
          {pending ? "Saving..." : submitLabel}
        </button>
        <button className="danger-button" disabled={pending} onClick={remove} type="button">
          Remove
        </button>
      </div>
      <FormMessage status={status} />
    </form>
  );
}

function FormMessage({ status }: { status: FormStatus }) {
  if (!status) {
    return null;
  }

  return <p className={`form-message form-message-${status.tone}`}>{status.message}</p>;
}
