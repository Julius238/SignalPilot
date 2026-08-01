"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { mutateApi } from "../lib/signalpilot-api";

type DiscoveryControlsProps = {
  assetId: string;
  isCore: boolean;
  isPinned: boolean;
  isExcluded: boolean;
  manualActive: boolean;
  observeOnly: boolean;
};

export function DiscoveryControls({
  assetId,
  isCore,
  isPinned,
  isExcluded,
  manualActive,
  observeOnly
}: DiscoveryControlsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(
    action: string,
    preference: Record<string, boolean>
  ) {
    setPending(action);
    setError(null);
    const result = await mutateApi(`/assets/${assetId}/universe-preference`, {
      method: "PATCH",
      body: JSON.stringify(preference)
    });
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="discovery-controls">
      <div className="discovery-control-buttons">
        <button
          type="button"
          disabled={pending !== null || isCore}
          className={isPinned ? "active" : ""}
          onClick={() =>
            update("pin", {
              isPinned: !isPinned,
              isExcluded: false,
              manualActive: false,
              observeOnly: false
            })
          }
        >
          {pending === "pin" ? "…" : isPinned ? "Lösen" : "Anheften"}
        </button>
        <button
          type="button"
          disabled={pending !== null || isCore}
          className={manualActive ? "active" : ""}
          onClick={() =>
            update("manual", {
              isPinned: false,
              isExcluded: false,
              manualActive: !manualActive,
              observeOnly: false
            })
          }
        >
          {pending === "manual" ? "…" : "Aktiv"}
        </button>
        <button
          type="button"
          disabled={pending !== null || isCore}
          className={observeOnly ? "active" : ""}
          onClick={() =>
            update("observe", {
              isPinned: false,
              isExcluded: false,
              manualActive: false,
              observeOnly: !observeOnly
            })
          }
        >
          {pending === "observe" ? "…" : "Nur beobachten"}
        </button>
        <button
          type="button"
          disabled={pending !== null || isCore}
          className={isExcluded ? "danger active" : "danger"}
          onClick={() =>
            update("exclude", {
              isPinned: false,
              isExcluded: !isExcluded,
              manualActive: false,
              observeOnly: false
            })
          }
        >
          {pending === "exclude" ? "…" : isExcluded ? "Freigeben" : "Ausschließen"}
        </button>
      </div>
      {isCore ? <span className="muted small">Core ist geschützt.</span> : null}
      {error ? <span className="form-error small">{error}</span> : null}
    </div>
  );
}
