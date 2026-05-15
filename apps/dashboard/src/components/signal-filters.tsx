"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent } from "react";

const assetTypes = ["", "STOCK", "ETF", "CRYPTO"];
const statuses = ["", "STRONG_WATCH", "WATCH", "WAIT", "AVOID", "NO_EDGE"];
const directions = ["", "BULLISH", "BEARISH", "NEUTRAL", "MIXED"];
const limits = ["25", "50", "100", "200"];

export function SignalFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = new URLSearchParams();

    for (const key of ["symbol", "assetType", "status", "direction", "timeframe", "limit"]) {
      const value = String(formData.get(key) ?? "").trim();

      if (value) {
        query.set(key, value);
      }
    }

    router.push(`/dashboard/signals${query.toString() ? `?${query.toString()}` : ""}`);
  }

  return (
    <form className="filter-bar" onSubmit={submit}>
      <input
        defaultValue={searchParams.get("symbol") ?? ""}
        name="symbol"
        placeholder="Symbol"
      />
      <select defaultValue={searchParams.get("assetType") ?? ""} name="assetType">
        {assetTypes.map((value) => (
          <option key={value} value={value}>
            {value || "Asset Type"}
          </option>
        ))}
      </select>
      <select defaultValue={searchParams.get("status") ?? ""} name="status">
        {statuses.map((value) => (
          <option key={value} value={value}>
            {value || "Status"}
          </option>
        ))}
      </select>
      <select defaultValue={searchParams.get("direction") ?? ""} name="direction">
        {directions.map((value) => (
          <option key={value} value={value}>
            {value || "Direction"}
          </option>
        ))}
      </select>
      <input
        defaultValue={searchParams.get("timeframe") ?? ""}
        name="timeframe"
        placeholder="Timeframe"
      />
      <select defaultValue={searchParams.get("limit") ?? "50"} name="limit">
        {limits.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button type="submit">Apply</button>
    </form>
  );
}
