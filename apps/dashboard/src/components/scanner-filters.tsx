"use client";

import { type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const assetTypes = ["", "CRYPTO", "STOCK", "ETF"];
const timeframes = ["", "1h", "4h", "1d"];

export function ScannerFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = new URLSearchParams();

    for (const key of [
      "assetType",
      "timeframe",
      "minScore",
      "showOnlyAlertWorthy",
      "watchlistOnly"
    ]) {
      const value = String(formData.get(key) ?? "").trim();

      if (value) {
        query.set(key, value);
      }
    }

    router.push(`/dashboard/scanner${query.toString() ? `?${query.toString()}` : ""}`);
  }

  return (
    <form className="filter-bar scanner-filter-bar" onSubmit={submit}>
      <select defaultValue={searchParams.get("assetType") ?? ""} name="assetType">
        {assetTypes.map((value) => (
          <option key={value} value={value}>
            {value || "ALL Assets"}
          </option>
        ))}
      </select>
      <select defaultValue={searchParams.get("timeframe") ?? ""} name="timeframe">
        {timeframes.map((value) => (
          <option key={value} value={value}>
            {value || "ALL Timeframes"}
          </option>
        ))}
      </select>
      <input
        defaultValue={searchParams.get("minScore") ?? ""}
        inputMode="decimal"
        min="0"
        name="minScore"
        placeholder="Min Score"
        type="number"
      />
      <label className="check-filter">
        <input
          defaultChecked={searchParams.get("showOnlyAlertWorthy") === "true"}
          name="showOnlyAlertWorthy"
          type="checkbox"
          value="true"
        />
        Alert worthy
      </label>
      <label className="check-filter">
        <input
          defaultChecked={searchParams.get("watchlistOnly") === "true"}
          name="watchlistOnly"
          type="checkbox"
          value="true"
        />
        Watchlist only
      </label>
      <button type="submit">Apply</button>
    </form>
  );
}
